import {
  ABSENT_CODE, NULL_CODE, TEXT_CODE, fadedNullColour, hatchColours, lutCss, medianCode, type Highlight, type ThemeMode,
} from './colourScale';
import { invMercY, mercY, type CellCrs, type DrawableCells, type GridGeometry, type PolygonsGeometry, type SamplesGeometry } from './coverageCells';
import type { Waypoint } from './coverageSection';
import { formatValue } from './coverageSummary';
import type { SectionPlane } from './sectionCells';
import { pickLevelLabels } from './verticalAxis';

// Cells to pixels, for the pane and the map alike: the same code draws both, so they agree by eye. No React.

export interface CellsPalette {
  mode: ThemeMode;
  plot: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
  // For what was asked for and isn't there
  warning: string;
}

// x runs left to right. y0 is the top and y1 the bottom, in the display's y
export interface PlotView {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PlotBox {
  width: number;
  height: number;
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
  v: PlotView;
}

export interface GridMaps {
  ex: Float64Array;
  ey: Float64Array;
  px: { start: Int32Array; end: Int32Array };
  py: { start: Int32Array; end: Int32Array };
}

// Which cells each pixel covers along one axis, from cell edges in pixel units. Each cell belongs to exactly one
// pixel, by its centre, so none is skipped
export function axisToPixels(edges: Float64Array, n: number, pixels: number) {
  const start = new Int32Array(pixels).fill(-1);
  const end = new Int32Array(pixels).fill(-1);
  let k = 0;
  for (let p = 0; p < pixels; p++) {
    const next = p + 1;
    while (k < n && edges[k + 1] <= p) k++;
    if (k >= n) break;
    if (edges[k] >= next) continue;
    let from = -1;
    let to = -1;
    for (let j = k; j < n && edges[j] < next; j++) {
      const middle = (edges[j] + edges[j + 1]) / 2;
      if (middle >= p && middle < next) {
        if (from < 0) from = j;
        to = j + 1;
      }
    }
    if (from < 0) {
      let j = k;
      const centre = p + 0.5;
      while (j < n && edges[j + 1] <= centre) j++;
      if (j < n && edges[j] <= centre) {
        from = j;
        to = j + 1;
      }
    }
    start[p] = from;
    end[p] = to;
  }
  return { start, end };
}

// How much a cell stands out among those that share a pixel: a null or what's off the scale first, then the value
// furthest from the median. Nothing sent never wins over something
export const standOut = (code: number, median: number) => (code === ABSENT_CODE ? -1 : code > 255 ? 1000 + code : Math.abs(code - median));

export function gridMaps(g: GridGeometry, v: PlotView, W: number, H: number): GridMaps {
  const ex = new Float64Array(g.nx + 1);
  const ey = new Float64Array(g.ny + 1);
  const kx = W / (v.x1 - v.x0);
  const ky = H / (v.y0 - v.y1);
  for (let i = 0; i <= g.nx; i++) ex[i] = (g.xEdges[i] - v.x0) * kx;
  for (let j = 0; j <= g.ny; j++) ey[j] = (v.y0 - g.yEdges[j]) * ky;
  return { ex, ey, px: axisToPixels(ex, g.nx, W), py: axisToPixels(ey, g.ny, H) };
}

interface PaintOptions {
  scale: number;
  mode: ThemeMode;
  highlight: Highlight | null;
  // On the map a null is a hole: the coast shows through a sea model's land, which is the check for a flip
  nullClear?: boolean;
}

export function paintGrid(
  ctx: CanvasRenderingContext2D, ox: number, oy: number, W: number, H: number,
  g: GridGeometry, codes: Uint16Array, lut: Uint32Array, maps: GridMaps, { scale, mode, highlight, nullClear }: PaintOptions,
) {
  if (W <= 0 || H <= 0) return;
  const image = ctx.createImageData(W, H);
  const out = new Uint32Array(image.data.buffer);
  const median = medianCode(codes);
  const { px, py } = maps;
  const [hatchA, hatchB] = hatchColours(mode);
  const period = Math.round(5 * scale);
  const band = Math.max(1, Math.round(period * 0.4));
  const nullLit = !highlight || highlight.kind === 'null';
  const textLit = !highlight || highlight.kind === 'text';
  const nullFaded = fadedNullColour(mode);
  for (let y = 0; y < H; y++) {
    const rowFrom = py.start[y];
    const rowTo = py.end[y];
    if (rowFrom < 0) continue;
    const line = y * W;
    for (let x = 0; x < W; x++) {
      const colFrom = px.start[x];
      const colTo = px.end[x];
      if (colFrom < 0) continue;
      let best = codes[rowFrom * g.nx + colFrom];
      if (rowTo - rowFrom > 1 || colTo - colFrom > 1) {
        let bestDistance = standOut(best, median);
        for (let r = rowFrom; r < rowTo; r++) {
          const offset = r * g.nx;
          for (let c = colFrom; c < colTo; c++) {
            const code = codes[offset + c];
            const distance = standOut(code, median);
            if (distance > bestDistance) {
              bestDistance = distance;
              best = code;
            }
          }
        }
      }
      // Nothing sent is left as paper
      if (best === ABSENT_CODE) continue;
      // What isn't a number looks as a null does, until it's drawn as what it is, and lights apart
      if (best === NULL_CODE || best === TEXT_CODE) {
        if (nullClear) continue;
        out[line + x] = (best === NULL_CODE ? nullLit : textLit) ? ((x + y) % period < band ? hatchA : hatchB) : nullFaded;
      } else {
        out[line + x] = lut[best];
      }
    }
  }
  ctx.putImageData(image, ox, oy);
}

// The cell a pixel shows: the same choice painting made, so what you point at is what you see
export function cellAtPixel(g: GridGeometry, codes: Uint16Array, maps: GridMaps, x: number, y: number) {
  const { px, py } = maps;
  if (x < 0 || y < 0 || x >= px.start.length || y >= py.start.length) return null;
  const rowFrom = py.start[y];
  const rowTo = py.end[y];
  const colFrom = px.start[x];
  const colTo = px.end[x];
  if (rowFrom < 0 || colFrom < 0) return null;
  const median = medianCode(codes);
  let best = rowFrom * g.nx + colFrom;
  let bestDistance = -1;
  for (let r = rowFrom; r < rowTo; r++) {
    for (let c = colFrom; c < colTo; c++) {
      const distance = standOut(codes[r * g.nx + c], median);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = r * g.nx + c;
      }
    }
  }
  return { cell: best, under: (rowTo - rowFrom) * (colTo - colFrom) };
}

// ---- Layout of the picture --------------------------------------------------------------------

export function fullView({ geometry: g, crs }: Pick<DrawableCells, 'geometry' | 'crs'>): PlotView {
  if (g.kind === 'grid') return { x0: g.xEdges[0], x1: g.xEdges[g.nx], y0: g.yEdges[0], y1: g.yEdges[g.ny] };
  const project = crs.geographic ? mercY : (value: number) => value;
  let west: number;
  let south: number;
  let east: number;
  let north: number;
  if (g.kind === 'samples') {
    west = Infinity;
    south = Infinity;
    east = -Infinity;
    north = -Infinity;
    for (let i = 0; i < g.cells; i++) {
      west = Math.min(west, g.xs[i]);
      east = Math.max(east, g.xs[i]);
      south = Math.min(south, g.ys[i]);
      north = Math.max(north, g.ys[i]);
    }
  } else {
    [west, south, east, north] = g.bbox;
  }
  const padX = (east - west || 1) * 0.04;
  const padY = (project(north) - project(south) || 1) * 0.04;
  return { x0: west - padX, x1: east + padX, y0: project(north) + padY, y1: project(south) - padY };
}

export function clampView(cells: DrawableCells, v: PlotView): PlotView | null {
  const full = fullView(cells);
  const width = v.x1 - v.x0;
  const height = v.y0 - v.y1;
  if (width >= full.x1 - full.x0 && height >= full.y0 - full.y1) return null;
  let { x0, x1, y0, y1 } = v;
  if (x0 < full.x0) {
    x1 += full.x0 - x0;
    x0 = full.x0;
  }
  if (x1 > full.x1) {
    x0 -= x1 - full.x1;
    x1 = full.x1;
  }
  if (y0 > full.y0) {
    y1 -= y0 - full.y0;
    y0 = full.y0;
  }
  if (y1 < full.y1) {
    y0 += full.y1 - y1;
    y1 = full.y1;
  }
  return { x0, x1, y0, y1 };
}

function niceStep(span: number, n: number) {
  const raw = span / Math.max(n, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const leading = raw / power;
  return (leading < 1.5 ? 1 : leading < 3.5 ? 2 : leading < 7.5 ? 5 : 10) * power;
}

export function ticks(a: number, b: number, n: number) {
  if (!(b > a)) return { list: [a], step: 1 };
  const step = niceStep(b - a, n);
  const list: number[] = [];
  for (let tick = Math.ceil(a / step) * step; tick <= b + step * 1e-9; tick += step) list.push(Number(tick.toFixed(10)));
  return { list, step };
}

const decimalsFor = (step: number) => Math.max(0, -Math.floor(Math.log10(step)));

function yTicksOf({ geometry: g, crs }: DrawableCells, v: PlotView, plotH: number) {
  const geographic = crs.geographic;
  const unit = geographic ? '°' : '';
  if (g.kind === 'grid' && g.ny === 1) return [{ at: geographic ? mercY(g.ys[0]) : g.ys[0], label: `${Number(g.ys[0].toFixed(5))}${unit}` }];
  const top = geographic ? invMercY(v.y0) : v.y0;
  const bottom = geographic ? invMercY(v.y1) : v.y1;
  const { list, step } = ticks(bottom, top, Math.max(2, Math.floor(plotH / 44)));
  const decimals = decimalsFor(step);
  return list.map(tick => ({ at: geographic ? mercY(tick) : tick, label: `${tick.toFixed(decimals)}${unit}` }));
}

function xTicksOf({ geometry: g, crs }: DrawableCells, v: PlotView, plotW: number) {
  const unit = crs.geographic ? '°' : '';
  if (g.kind === 'grid' && g.nx === 1) return [{ at: g.xs[0], label: `${Number(g.xs[0].toFixed(5))}${unit}` }];
  const { list, step } = ticks(v.x0, v.x1, Math.max(2, Math.floor(plotW / 76)));
  const decimals = decimalsFor(step);
  return list.map(tick => ({ at: tick, label: `${tick.toFixed(decimals)}${unit}` }));
}

const ROOM_RIGHT = 8;
const ROOM_TOP = 10;
const ROOM_BOTTOM = 20;
const CHARACTER = 6.7;

// A section's room: z's unit above the plot, the km labels below, and the waypoints' letters under them
const SECTION_TOP = 16;
const SECTION_BOTTOM = 20;
const SECTION_LETTERS = 14;
const SECTION_SHORTEST = 150;
const SECTION_TALLEST = 420;

const lettered = (section: SectionPlane) => section.data.waypoints.some(waypoint => waypoint.km !== null);

// The room above and below the plot, which the picture's height is fitted around
export function marginsOf(cells: DrawableCells): number {
  if (!cells.section) return ROOM_TOP + ROOM_BOTTOM;
  return SECTION_TOP + SECTION_BOTTOM + (lettered(cells.section) ? SECTION_LETTERS : 0);
}

// A section fills the width, as a profile's panel does. Its x and y are a distance and a level, so there's no aspect to
// keep: its height follows the width, within bounds. The level axis is as wide as its longest label
function sectionLayout(section: SectionPlane, cells: DrawableCells, width: number, zoom: PlotView | null, tallest: number): PlotBox {
  const v = zoom ?? fullView(cells);
  const longest = section.data.levels.reduce<number>((most, level) => Math.max(most, formatValue(Number(level)).length), 1);
  const roomLeft = Math.ceil(longest * CHARACTER) + 14;
  const plotW = Math.max(1, width - roomLeft - ROOM_RIGHT);
  const plotH = Math.max(SECTION_SHORTEST, Math.min(Math.round(plotW * 0.6), tallest, SECTION_TALLEST));
  return { width, height: plotH + marginsOf(cells), plotX: roomLeft, plotY: SECTION_TOP, plotW, plotH, v };
}

// Height is capped, so that a wide pane doesn't push all that's below the picture out of sight
export function plotLayout(cells: DrawableCells, width: number, zoom: PlotView | null, tallest: number): PlotBox {
  if (cells.section) return sectionLayout(cells.section, cells, width, zoom, tallest);
  const v = zoom ?? fullView(cells);
  const aspect = (v.y0 - v.y1) / (v.x1 - v.x0);
  const g = cells.geometry;
  const oneCell = g.kind === 'grid' && g.cells === 1;
  const maxH = Math.min(tallest, width * 1.05);
  const roughH = Math.min(maxH, width * aspect);
  // As wide as its longest label needs, so no label is cut
  const longest = Math.max(...yTicksOf(cells, v, Math.max(roughH, 44)).map(tick => tick.label.length));
  const roomLeft = Math.ceil(longest * CHARACTER) + 10;
  const available = width - roomLeft - ROOM_RIGHT;
  let plotW = oneCell ? Math.min(150, available) : available;
  let plotH = oneCell ? plotW : plotW * aspect;
  if (plotH > maxH) {
    plotH = maxH;
    plotW = plotH / aspect;
  }
  if (plotH < 44) plotH = 44;
  return {
    width,
    height: Math.round(plotH) + ROOM_TOP + ROOM_BOTTOM,
    plotX: roomLeft + Math.round((available - plotW) / 2),
    plotY: ROOM_TOP,
    plotW: Math.round(plotW),
    plotH: Math.round(plotH),
    v,
  };
}

export function paintAxes(ctx: CanvasRenderingContext2D, box: PlotBox, cells: DrawableCells, scale: number, palette: CellsPalette, zoomed: boolean) {
  if (cells.section && cells.geometry.kind === 'grid') {
    paintSectionAxes(ctx, box, cells.section, cells.geometry, scale, palette);
    return;
  }
  const { v } = box;
  ctx.fillStyle = palette.textSecondary;
  ctx.strokeStyle = palette.border;
  ctx.font = `${11 * scale}px monospace`;
  ctx.lineWidth = scale;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const tick of xTicksOf(cells, v, box.plotW)) {
    const x = (box.plotX + ((tick.at - v.x0) / (v.x1 - v.x0)) * box.plotW) * scale;
    const y = (box.plotY + box.plotH) * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 3 * scale);
    ctx.stroke();
    const half = ctx.measureText(tick.label).width / 2;
    ctx.fillText(tick.label, Math.min(x, box.width * scale - half), y + 15 * scale);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of yTicksOf(cells, v, box.plotH)) {
    const y = (box.plotY + ((v.y0 - tick.at) / (v.y0 - v.y1)) * box.plotH) * scale;
    const x = box.plotX * scale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3 * scale, y);
    ctx.stroke();
    ctx.fillText(tick.label, x - 5 * scale, y);
  }
  // Where values[0] is, outside the cells: north first or south first is the first thing to check
  if (cells.order && !zoomed) {
    const atX = (cells.order.firstX === 'left' ? box.plotX : box.plotX + box.plotW) * scale;
    const atY = (cells.order.firstY === 'top' ? box.plotY : box.plotY + box.plotH) * scale;
    const signX = cells.order.firstX === 'left' ? -1 : 1;
    const signY = cells.order.firstY === 'top' ? -1 : 1;
    ctx.fillStyle = palette.primary;
    ctx.beginPath();
    ctx.moveTo(atX + signX * scale * 0.5, atY);
    ctx.lineTo(atX + signX * 6 * scale, atY);
    ctx.lineTo(atX, atY + signY * 6 * scale);
    ctx.closePath();
    ctx.fill();
  }
}

// A cell's size on screen, on average, in CSS px
const cellSizeOf = (box: PlotBox, g: GridGeometry) => [
  (box.plotW * ((g.xEdges[g.nx] - g.xEdges[0]) / (box.v.x1 - box.v.x0))) / g.nx,
  (box.plotH * ((g.yEdges[0] - g.yEdges[g.ny]) / (box.v.y0 - box.v.y1))) / g.ny,
];
const holdsValues = ([cellW, cellH]: number[]) => cellW >= 30 && cellH >= 15;

// Black or white, whichever reads on a cell's colour
function inkOn(lut: Uint32Array, code: number) {
  const colour = lut[code];
  const lightness = (0.2126 * (colour & 255) + 0.7152 * ((colour >> 8) & 255) + 0.0722 * ((colour >> 16) & 255)) / 255;
  return lightness > 0.5 ? '#000' : '#fff';
}

// Where a value was written over its cell, in canvas pixels
export interface PrintedText {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// A monospace digit is about this much of the font's size across
const MONO_ADVANCE = 0.6;

// Gridlines once a cell is big enough to have edges, and its value once it can hold one. Says where it wrote, so that
// what's drawn over the cells can keep clear of it
export function paintGridDetail(
  ctx: CanvasRenderingContext2D, box: PlotBox, g: GridGeometry, maps: GridMaps, codes: Uint16Array, lut: Uint32Array,
  valueAt: (cell: number) => unknown, scale: number, palette: CellsPalette,
): PrintedText[] {
  const printed: PrintedText[] = [];
  const { ex, ey } = maps;
  const W = box.plotW * scale;
  const H = box.plotH * scale;
  const ox = box.plotX * scale;
  const oy = box.plotY * scale;
  const [cellW, cellH] = cellSizeOf(box, g);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, W, H);
  ctx.clip();
  if (cellW >= 6 && cellH >= 6) {
    ctx.fillStyle = palette.mode === 'dark' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.55)';
    for (let i = 0; i <= g.nx; i++) if (ex[i] >= 0 && ex[i] <= W) ctx.fillRect(ox + Math.round(ex[i]), oy, 1, H);
    for (let j = 0; j <= g.ny; j++) if (ey[j] >= 0 && ey[j] <= H) ctx.fillRect(ox, oy + Math.round(ey[j]), W, 1);
  }
  if (holdsValues([cellW, cellH])) {
    const size = Math.min(11, Math.floor(cellW / 3.4)) * scale;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${size}px monospace`;
    const write = (text: string, x: number, y: number) => {
      ctx.fillText(text, x, y);
      const half = (text.length * size * MONO_ADVANCE) / 2;
      if (half > 0) printed.push({ x0: x - half, x1: x + half, y0: y - size / 2, y1: y + size / 2 });
    };
    for (let row = 0; row < g.ny; row++) {
      if (ey[row + 1] < 0 || ey[row] > H) continue;
      for (let col = 0; col < g.nx; col++) {
        if (ex[col + 1] < 0 || ex[col] > W) continue;
        const cell = row * g.nx + col;
        const code = codes[cell];
        if (code === ABSENT_CODE) continue;
        const x = ox + (ex[col] + ex[col + 1]) / 2;
        const y = oy + (ey[row] + ey[row + 1]) / 2;
        if (code === NULL_CODE || code === TEXT_CODE) {
          ctx.fillStyle = palette.textSecondary;
          // Text as it is, cut to what a number would take
          const text = code === NULL_CODE ? 'null' : JSON.stringify(valueAt(cell)) ?? '';
          write(text.length > 7 ? `${text.slice(0, 6)}…` : text, x, y);
          continue;
        }
        ctx.fillStyle = inkOn(lut, code);
        const raw = valueAt(cell);
        write(typeof raw === 'number' ? String(Number(raw.toPrecision(4))) : '', x, y);
      }
    }
  }
  ctx.restore();
  return printed;
}

// ---- A section: distance along the path by level ----------------------------------------------

export interface AxisTick {
  // In CSS px from the plot's left or top
  at: number;
  label: string;
}

// The km axis: nice numbers within the path and the view. Where x and y aren't lon/lat, positions are counted from 1
export function sectionXTicks(v: PlotView, total: number, plotW: number, byPosition: boolean): AxisTick[] {
  const from = Math.max(v.x0, 0);
  const to = Math.min(v.x1, total);
  if (!(to >= from)) return [];
  const toPixels = (km: number) => ((km - v.x0) / (v.x1 - v.x0)) * plotW;
  const n = Math.max(2, Math.floor(plotW / 76));
  if (byPosition) return ticks(from + 1, to + 1, n).list.filter(Number.isInteger).map(tick => ({ at: toPixels(tick - 1), label: String(tick) }));
  const { list, step } = ticks(from, to, n);
  const decimals = decimalsFor(step);
  return list.map(tick => ({ at: toPixels(tick), label: tick.toFixed(decimals) }));
}

// A short tick under each position, only where all of them in view are at least minGap apart: closer, they'd be a bar.
// A position sent twice, as at a break, is one tick
export function positionRug(km: ArrayLike<number>, v: PlotView, plotW: number, minGap = 3): number[] {
  const out: number[] = [];
  for (let col = 0; col < km.length; col++) {
    const x = ((km[col] - v.x0) / (v.x1 - v.x0)) * plotW;
    if (x < 0 || x > plotW) continue;
    const gap = out.length ? x - out[out.length - 1] : Infinity;
    if (gap === 0) continue;
    if (gap < minGap) return [];
    out.push(x);
  }
  return out;
}

export interface WaypointMark {
  // In CSS px from the plot's left
  x: number;
  // Null where it would sit on the last letter drawn. Its line is still drawn
  label: string | null;
}

// The request's vertices among the positions, each a line, and a letter where it has room
export function waypointMarks(waypoints: Waypoint[], v: PlotView, plotW: number, minGap = 12): WaypointMark[] {
  const marks: WaypointMark[] = [];
  let lastLetter = -Infinity;
  for (const { km, label } of waypoints) {
    if (km === null) continue;
    const x = ((km - v.x0) / (v.x1 - v.x0)) * plotW;
    if (x < 0 || x > plotW) continue;
    const room = x - lastLetter >= minGap;
    if (room) lastLetter = x;
    marks.push({ x, label: room ? label : null });
  }
  return marks;
}

export interface LevelTick {
  level: number;
  // In CSS px from the plot's top
  at: number;
  // Asked for and not sent
  missing: boolean;
  label: string | null;
}

// Labels this far apart, centre to centre, leave a clear gap between two lines of 11 px figures: 13 px left them all
// but touching, the top one too
export const LEVEL_LABEL_GAP = 18;

// The level axis, as the profile's: a tick at every level in view, and a label at those pickLevelLabels chooses, which
// always has those asked for and not sent
export function levelTicks(section: SectionPlane, g: GridGeometry, v: PlotView, plotH: number): LevelTick[] {
  const inView: { level: number; at: number }[] = [];
  for (let row = 0; row < g.ny; row++) {
    const at = ((v.y0 - section.rowY[row]) / (v.y0 - v.y1)) * plotH;
    if (at >= -0.5 && at <= plotH + 0.5) inView.push({ level: g.ys[row], at });
  }
  const pixels = new Map(inView.map(({ level, at }) => [level, at]));
  const { notBack } = section.data;
  const labelled = pickLevelLabels([...pixels.keys()], level => pixels.get(level)!, { minGap: LEVEL_LABEL_GAP, must: notBack.filter(level => pixels.has(level)) });
  return inView.map(({ level, at }) => ({ level, at, missing: notBack.includes(level), label: labelled.has(level) ? formatValue(level) : null }));
}

// A vertical line from top to bottom at x, as the stretches that keep clear of what's written where it crosses: pad
// pixels above and below each piece of text. All of it where nothing's written
export function clearOfText(x: number, top: number, bottom: number, printed: PrintedText[], pad: number): [number, number][] {
  const across = printed
    .filter(text => x >= text.x0 - pad && x <= text.x1 + pad && text.y1 + pad > top && text.y0 - pad < bottom)
    .sort((a, b) => a.y0 - b.y0);
  const stretches: [number, number][] = [];
  let from = top;
  for (const text of across) {
    if (text.y0 - pad > from) stretches.push([from, text.y0 - pad]);
    from = Math.max(from, text.y1 + pad);
  }
  if (bottom > from) stretches.push([from, bottom]);
  return stretches;
}

// The lowest beam as lines in the plane: one for each stretch with a height at each position, broken where there's none,
// and at each break of a MULTILINESTRING
export function floorRuns(floor: ArrayLike<number>, km: ArrayLike<number>, breaks: number[], yOf: (value: number) => number): [number, number][][] {
  const runs: [number, number][][] = [];
  const breakAt = new Set(breaks);
  let run: [number, number][] = [];
  for (let col = 0; col < floor.length; col++) {
    const y = yOf(floor[col]);
    if ((breakAt.has(col) || !Number.isFinite(y)) && run.length) {
      runs.push(run);
      run = [];
    }
    if (Number.isFinite(y)) run.push([km[col], y]);
  }
  if (run.length) runs.push(run);
  return runs;
}

// What z's unit is called at the top of the level axis, where it has none
const levelCaption = ({ data }: SectionPlane) => data.z?.unit || (data.z?.kind === 'modelLevel' ? 'level' : 'z');

// km along the bottom, with the waypoints' letters under it, and the profile's level axis on the left
function paintSectionAxes(ctx: CanvasRenderingContext2D, box: PlotBox, section: SectionPlane, g: GridGeometry, scale: number, palette: CellsPalette) {
  const { v } = box;
  const { data } = section;
  const byPosition = !data.crs.geographic;
  const left = box.plotX * scale;
  const bottom = (box.plotY + box.plotH) * scale;
  ctx.font = `${11 * scale}px monospace`;
  ctx.lineWidth = scale;
  ctx.fillStyle = palette.textSecondary;
  ctx.strokeStyle = palette.border;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const tickDown = (x: number, length: number) => {
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + length * scale);
    ctx.stroke();
  };
  for (const tick of sectionXTicks(v, data.km[data.colCount - 1] ?? 0, box.plotW, byPosition)) {
    const x = left + tick.at * scale;
    tickDown(x, 4);
    const half = ctx.measureText(tick.label).width / 2;
    ctx.fillText(tick.label, Math.min(x, box.width * scale - half), bottom + 15 * scale);
  }
  for (const x of positionRug(data.km, v, box.plotW)) tickDown(left + x * scale, 2);
  ctx.textAlign = 'left';
  ctx.fillText(byPosition ? '#' : 'km', 2 * scale, bottom + 15 * scale);
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.text;
  for (const mark of waypointMarks(data.waypoints, v, box.plotW)) if (mark.label) ctx.fillText(mark.label, left + mark.x * scale, bottom + 29 * scale);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of levelTicks(section, g, v, box.plotH)) {
    const y = (box.plotY + tick.at) * scale;
    ctx.strokeStyle = tick.missing ? palette.warning : palette.border;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left - (tick.missing ? 7 : 4) * scale, y);
    ctx.stroke();
    if (!tick.label) continue;
    ctx.fillStyle = tick.missing ? palette.warning : palette.textSecondary;
    ctx.fillText(tick.label, left - (tick.missing ? 9 : 6) * scale, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.textSecondary;
  ctx.fillText(levelCaption(section), 2 * scale, (box.plotY - 6) * scale);
}

// Over a section's cells: a dashed line at each waypoint, a solid rule at each break, the lowest beam, and a dot where
// each sample is, once the cells are big enough to show it isn't always in their middle. A waypoint's line stops short
// of a value written in a cell, which it would otherwise cut through
export function paintSectionDetail(
  ctx: CanvasRenderingContext2D, box: PlotBox, cells: DrawableCells, maps: GridMaps, codes: Uint16Array, lut: Uint32Array,
  slice: number, scale: number, palette: CellsPalette, printed: PrintedText[] = [],
) {
  const { section, geometry: g } = cells;
  if (!section || g.kind !== 'grid') return;
  const { data } = section;
  const { v } = box;
  const ox = box.plotX * scale;
  const oy = box.plotY * scale;
  const W = box.plotW * scale;
  const H = box.plotH * scale;
  const xOf = (km: number) => ox + ((km - v.x0) / (v.x1 - v.x0)) * W;
  const yOf = (y: number) => oy + ((v.y0 - y) / (v.y0 - v.y1)) * H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, W, H);
  ctx.clip();

  ctx.strokeStyle = palette.text;
  ctx.lineWidth = scale;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([3 * scale, 3 * scale]);
  for (const mark of waypointMarks(data.waypoints, v, box.plotW)) {
    const x = Math.round(ox + mark.x * scale) + 0.5;
    ctx.beginPath();
    for (const [from, to] of clearOfText(x, oy, oy + H, printed, 2 * scale)) {
      ctx.moveTo(x, from);
      ctx.lineTo(x, to);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.text;
  for (const col of data.breaks) ctx.fillRect(Math.round(xOf(data.km[col]) - scale), oy, 2 * scale, H);

  const floor = data.beamFloor?.values[slice];
  if (floor) {
    const runs = floorRuns(floor, data.km, data.breaks, section.yOf);
    ctx.lineJoin = 'round';
    for (const [width, colour] of [[3, 'rgba(0,0,0,.85)'], [1.5, '#fff']] as const) {
      ctx.lineWidth = width * scale;
      ctx.strokeStyle = colour;
      for (const run of runs) {
        ctx.beginPath();
        run.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(xOf(x), yOf(y)) : ctx.lineTo(xOf(x), yOf(y))));
        ctx.stroke();
      }
    }
  }

  // A printed value marks its cell already
  if (!holdsValues(cellSizeOf(box, g))) {
    const { ex, ey } = maps;
    for (let row = 0; row < g.ny; row++) {
      if ((ey[row + 1] - ey[row]) / scale < 7) continue;
      for (let col = 0; col < g.nx; col++) {
        const code = codes[row * g.nx + col];
        if ((ex[col + 1] - ex[col]) / scale < 9 || code === ABSENT_CODE) continue;
        ctx.fillStyle = code === NULL_CODE || code === TEXT_CODE ? palette.textSecondary : inkOn(lut, code);
        ctx.beginPath();
        ctx.arc(xOf(data.km[col]), yOf(section.rowY[row]), scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function pixelOf(box: Pick<PlotBox, 'plotX' | 'plotY' | 'plotW' | 'plotH' | 'v'>, crs: CellCrs, x: number, y: number, scale: number): [number, number] {
  const projected = crs.geographic ? mercY(y) : y;
  const { v } = box;
  return [
    (box.plotX + ((x - v.x0) / (v.x1 - v.x0)) * box.plotW) * scale,
    (box.plotY + ((v.y0 - projected) / (v.y0 - v.y1)) * box.plotH) * scale,
  ];
}

// A dot with a ring if scattered, a mark as wide as the spacing if evenly spaced
function sampleSize(box: Pick<PlotBox, 'plotW' | 'v'>, g: SamplesGeometry) {
  if (!g.spacing.regular || !g.spacing.km) return { size: 10, ring: true };
  let sum = 0;
  for (let i = 0; i < g.cells; i++) sum += g.ys[i];
  const degrees = g.spacing.km / (111.32 * Math.cos(((sum / g.cells) * Math.PI) / 180));
  const size = degrees * (box.plotW / (box.v.x1 - box.v.x0));
  return size >= 14 ? { size: Math.min(size * 0.92, 28), ring: false } : { size: Math.max(size, 3), ring: false };
}

export function paintSamples(
  ctx: CanvasRenderingContext2D, box: Pick<PlotBox, 'plotX' | 'plotY' | 'plotW' | 'plotH' | 'v'>, g: SamplesGeometry, crs: CellCrs,
  codes: Uint16Array, lut: Uint32Array, scale: number, palette: CellsPalette, surface: string | null,
) {
  const { size, ring } = sampleSize(box, g);
  const s = size * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.plotX * scale, box.plotY * scale, box.plotW * scale, box.plotH * scale);
  ctx.clip();
  for (let i = 0; i < g.cells; i++) {
    const [x, y] = pixelOf(box, crs, g.xs[i], g.ys[i], scale);
    const code = codes[i];
    if (ring && surface) {
      ctx.beginPath();
      ctx.arc(x, y, s / 2 + 2 * scale, 0, Math.PI * 2);
      ctx.fillStyle = surface;
      ctx.fill();
    }
    if (code === NULL_CODE || code === TEXT_CODE) {
      ctx.strokeStyle = palette.textSecondary;
      ctx.lineWidth = scale;
      ctx.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s - 1, s - 1);
      ctx.beginPath();
      ctx.moveTo(x - s / 2, y + s / 2);
      ctx.lineTo(x + s / 2, y - s / 2);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = lutCss(lut, code);
    if (ring) {
      ctx.beginPath();
      ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
  ctx.restore();
}

function polygonPath(ctx: CanvasRenderingContext2D, g: PolygonsGeometry, i: number, toPixel: (x: number, y: number) => [number, number]) {
  ctx.beginPath();
  for (let k = g.offsets[i]; k < g.offsets[i + 1]; k++) {
    const [x, y] = toPixel(g.pts[k * 2], g.pts[k * 2 + 1]);
    if (k === g.offsets[i]) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function paintPolygons(
  ctx: CanvasRenderingContext2D, box: Pick<PlotBox, 'plotX' | 'plotY' | 'plotW' | 'plotH' | 'v'>, g: PolygonsGeometry, crs: CellCrs,
  codes: Uint16Array, lut: Uint32Array, scale: number, palette: CellsPalette, nullClear = false,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.plotX * scale, box.plotY * scale, box.plotW * scale, box.plotH * scale);
  ctx.clip();
  const toPixel = (x: number, y: number) => pixelOf(box, crs, x, y, scale);
  for (let i = 0; i < g.cells; i++) {
    const code = codes[i];
    const noNumber = code === NULL_CODE || code === TEXT_CODE;
    if (noNumber && nullClear) continue;
    polygonPath(ctx, g, i, toPixel);
    ctx.fillStyle = noNumber ? (palette.mode === 'dark' ? '#3a3a3a' : '#cfcfcf') : lutCss(lut, code);
    ctx.fill();
    ctx.strokeStyle = palette.plot;
    ctx.lineWidth = scale * 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

// ---- The hover and the pin, on a layer of their own, so that pointing doesn't repaint the cells --

export interface PaintedPlot {
  box: PlotBox;
  maps: GridMaps | null;
  codes: Uint16Array;
  scale: number;
}

function paintMark(ctx: CanvasRenderingContext2D, plot: PaintedPlot, cells: DrawableCells, cell: number, strong: boolean) {
  const { box, maps, scale } = plot;
  const g = cells.geometry;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.plotX * scale, box.plotY * scale, box.plotW * scale, box.plotH * scale);
  ctx.clip();
  const stroke = (width: number, colour: string) => {
    ctx.lineWidth = width * scale;
    ctx.strokeStyle = colour;
    ctx.stroke();
  };
  if (g.kind === 'grid' && maps) {
    const row = Math.floor(cell / g.nx);
    const col = cell - row * g.nx;
    let x0 = maps.ex[col] / scale;
    let x1 = maps.ex[col + 1] / scale;
    let y0 = maps.ey[row] / scale;
    let y1 = maps.ey[row + 1] / scale;
    if (x1 - x0 < 7 || y1 - y0 < 7) {
      const middleX = (x0 + x1) / 2;
      const middleY = (y0 + y1) / 2;
      x0 = middleX - 4;
      x1 = middleX + 4;
      y0 = middleY - 4;
      y1 = middleY + 4;
      // Lines out to the edges, since a cell of a pixel can't be seen by itself
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect((box.plotX + middleX) * scale, box.plotY * scale, scale, box.plotH * scale);
      ctx.fillRect(box.plotX * scale, (box.plotY + middleY) * scale, box.plotW * scale, scale);
    }
    ctx.beginPath();
    ctx.rect((box.plotX + x0) * scale, (box.plotY + y0) * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    stroke(3, 'rgba(0,0,0,.9)');
    stroke(1.5, strong ? '#fff' : 'rgba(255,255,255,.85)');
  } else if (g.kind === 'samples') {
    const [x, y] = pixelOf(box, cells.crs, g.xs[cell], g.ys[cell], scale);
    const size = Math.max(sampleSize(box, g).size, 8) * scale;
    ctx.beginPath();
    ctx.rect(x - size / 2 - 2 * scale, y - size / 2 - 2 * scale, size + 4 * scale, size + 4 * scale);
    stroke(3, 'rgba(0,0,0,.9)');
    stroke(1.5, '#fff');
  } else if (g.kind === 'polygons') {
    polygonPath(ctx, g, cell, (a, b) => pixelOf(box, cells.crs, a, b, scale));
    stroke(3, 'rgba(0,0,0,.9)');
    stroke(1.5, '#fff');
  }
  ctx.restore();
}

export function paintMarks(canvas: HTMLCanvasElement, plot: PaintedPlot, cells: DrawableCells, pin: number | null, hover: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (pin !== null) paintMark(ctx, plot, cells, pin, true);
  if (hover !== null && hover !== pin) paintMark(ctx, plot, cells, hover, false);
}

export function hitTest(plot: PaintedPlot, cells: DrawableCells, x: number, y: number) {
  const { box, maps, codes, scale } = plot;
  const g = cells.geometry;
  const px = x - box.plotX;
  const py = y - box.plotY;
  if (px < 0 || py < 0 || px >= box.plotW || py >= box.plotH) return null;
  if (g.kind === 'grid') return maps ? cellAtPixel(g, codes, maps, Math.floor(px * scale), Math.floor(py * scale)) : null;
  if (g.kind === 'samples') {
    let best: number | null = null;
    let bestDistance = 22 * 22;
    for (let i = 0; i < g.cells; i++) {
      const [a, b] = pixelOf(box, cells.crs, g.xs[i], g.ys[i], 1);
      const distance = (a - x) ** 2 + (b - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best === null ? null : { cell: best, under: 1 };
  }
  for (let i = 0; i < g.cells; i++) {
    let inside = false;
    for (let a = g.offsets[i], b = g.offsets[i + 1] - 1; a < g.offsets[i + 1]; b = a++) {
      const [xa, ya] = pixelOf(box, cells.crs, g.pts[a * 2], g.pts[a * 2 + 1], 1);
      const [xb, yb] = pixelOf(box, cells.crs, g.pts[b * 2], g.pts[b * 2 + 1], 1);
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    if (inside) return { cell: i, under: 1 };
  }
  return null;
}

// The zoom row's sentence
export function scaleText(plot: PaintedPlot, cells: DrawableCells): string {
  const { box, scale } = plot;
  const g = cells.geometry;
  if (g.kind === 'samples') return sampleSize(box, g).ring ? 'Each dot is a point. A dot has no area' : 'A mark per point, as wide as the spacing';
  if (g.kind === 'polygons') return 'Each polygon as the response gives it';
  const columns = (g.nx * (box.v.x1 - box.v.x0)) / (g.xEdges[g.nx] - g.xEdges[0]);
  const rows = (g.ny * (box.v.y0 - box.v.y1)) / (g.yEdges[0] - g.yEdges[g.ny]);
  const deviceW = (box.plotW * scale) / columns;
  const deviceH = (box.plotH * scale) / rows;
  if (deviceW >= 1 && deviceH >= 1) {
    const cssW = box.plotW / columns;
    const cssH = box.plotH / rows;
    return cssW >= 1 && cssH >= 1 ? `1 cell = ${cssW.toFixed(1)} × ${cssH.toFixed(1)} px` : 'A cell is about a screen pixel. Zoom in to see them apart';
  }
  return `1 px holds up to ${Math.ceil(1 / Math.min(deviceW, 1))} × ${Math.ceil(1 / Math.min(deviceH, 1))} cells, and shows the one that stands out`;
}

// A parameter in small, for the picker and Figures
export function paintThumb(
  canvas: HTMLCanvasElement, cells: DrawableCells, codes: Uint16Array, lut: Uint32Array, width: number, height: number, scale: number, palette: CellsPalette,
) {
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = palette.plot;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const v = fullView(cells);
  const g = cells.geometry;
  if (g.kind === 'grid') {
    paintGrid(ctx, 0, 0, canvas.width, canvas.height, g, codes, lut, gridMaps(g, v, canvas.width, canvas.height), { scale, mode: palette.mode, highlight: null });
    return;
  }
  const box = { plotX: 0, plotY: 0, plotW: width, plotH: height, v };
  if (g.kind === 'polygons') {
    paintPolygons(ctx, box, g, cells.crs, codes, lut, scale, palette);
    return;
  }
  for (let i = 0; i < g.cells; i++) {
    const [x, y] = pixelOf(box, cells.crs, g.xs[i], g.ys[i], scale);
    ctx.fillStyle = codes[i] === NULL_CODE || codes[i] === TEXT_CODE ? palette.textSecondary : lutCss(lut, codes[i]);
    ctx.fillRect(x - scale, y - scale, 2 * scale, 2 * scale);
  }
}

