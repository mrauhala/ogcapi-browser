import { describe, expect, it } from 'vitest';
import { ABSENT_CODE, BELOW_CODE, NULL_CODE, TEXT_CODE, hatchColours, lutFor } from './colourScale';
import { readCells, type DrawableCells, type GridGeometry } from './coverageCells';
import type { Waypoint } from './coverageSection';
import {
  LEVEL_LABEL_GAP, axisToPixels, cellAtPixel, clampView, clearOfText, floorRuns, fullView, gridMaps, hitTest, levelTicks, marginsOf, paintAxes, paintGrid, paintGridDetail,
  paintPolygons, paintSamples, paintSectionDetail, paintThumb, pixelOf, plotLayout, positionRug, scaleText, sectionXTicks, standOut, ticks, waypointMarks,
  type CellsPalette, type PaintedPlot,
} from './paintCells';
import { readResponseCells } from './sectionCells';
import { grid, pointCollection, pointCoverage, triangles, counting } from './cellsTestData';
import fmiEc2param from './__fixtures__/sections/fmi-ec-2param.json';
import fmiMultilinestring from './__fixtures__/sections/fmi-multilinestring.json';
import mcIfsLsz from './__fixtures__/sections/mc-ifs-lsz.json';
import mcRadarFikorZ from './__fixtures__/sections/mc-radar-fikor-z.json';

const drawn = (json: unknown) => readCells(json) as DrawableCells;

interface FakeImage { data: Uint8ClampedArray; width: number; height: number }
// As much of a canvas as painting a grid uses
function fakeContext() {
  const context = {
    image: null as FakeImage | null,
    at: [0, 0],
    createImageData: (width: number, height: number): FakeImage => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData(image: FakeImage, x: number, y: number) {
      context.image = image;
      context.at = [x, y];
    },
    pixel(x: number, y: number) {
      return new Uint32Array(context.image!.data.buffer)[y * context.image!.width + x];
    },
  };
  return context as typeof context & CanvasRenderingContext2D;
}

// Any canvas call, kept with the fill colour it was made with
function recordingContext() {
  const calls: [string, unknown, ...unknown[]][] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : (...args: unknown[]) => { calls.push([String(key), target.fillStyle, ...args]); }),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const PALETTE: CellsPalette = { mode: 'dark', plot: 'plot', text: 'text', textSecondary: 'secondary', border: 'border', primary: 'primary', warning: 'warning' };

describe('axisToPixels', () => {
  const evenEdges = (n: number, pixels: number) => Float64Array.from({ length: n + 1 }, (_, i) => (i / n) * pixels);
  const timesCovered = (edges: Float64Array, n: number, pixels: number) => {
    const { start, end } = axisToPixels(edges, n, pixels);
    const seen = new Uint16Array(n);
    for (let p = 0; p < pixels; p++) if (start[p] >= 0) for (let c = start[p]; c < end[p]; c++) seen[c]++;
    return seen;
  };

  for (const [n, pixels] of [[1000, 137], [2000, 333], [449, 296], [453, 450], [10000, 100]]) {
    it(`puts each of ${n} cells in exactly one of ${pixels} pixels, so that none is skipped`, () => {
      expect(timesCovered(evenEdges(n, pixels), n, pixels).every(times => times === 1)).toBe(true);
    });
  }

  for (const [n, pixels] of [[176, 520], [7, 500], [1, 150]]) {
    it(`gives each of ${pixels} pixels one of ${n} cells`, () => {
      expect(axisToPixels(evenEdges(n, pixels), n, pixels).start.every(cell => cell >= 0)).toBe(true);
    });
  }

  it('does the same for an uneven axis', () => {
    const n = 400;
    const raw = Array.from({ length: n + 1 }, (_, i) => i + i * i * 0.01);
    const pixels = 120;
    const edges = Float64Array.from(raw, edge => (edge / raw[n]) * pixels);
    expect(timesCovered(edges, n, pixels).every(times => times === 1)).toBe(true);
  });

  it('leaves pixels beyond the cells empty, on either side', () => {
    const { start, end } = axisToPixels(Float64Array.from([2, 4, 6]), 2, 8);
    expect(Array.from(start)).toEqual([-1, -1, 0, 0, 1, 1, -1, -1]);
    expect(Array.from(end)).toEqual([-1, -1, 1, 1, 2, 2, -1, -1]);
  });

  it('skips cells off to the left when zoomed in', () => {
    const { start } = axisToPixels(Float64Array.from([-20, -10, 0, 10]), 3, 10);
    expect(start[0]).toBe(2);
    expect(start[9]).toBe(2);
  });
});

describe('painting a grid', () => {
  const lut = lutFor('sequential', 'dark', null);
  const geometry = (nx: number, ny: number): GridGeometry => ({
    kind: 'grid', nx, ny, cells: nx * ny, xs: counting(nx), ys: counting(ny), assumedSize: false,
    xEdges: Float64Array.from({ length: nx + 1 }, (_, i) => i),
    yEdges: Float64Array.from({ length: ny + 1 }, (_, i) => ny - i),
  });
  const view = (g: GridGeometry) => ({ x0: 0, x1: g.nx, y0: g.ny, y1: 0 });

  it('colours each cell by its code', () => {
    const g = geometry(2, 2);
    const ctx = fakeContext();
    paintGrid(ctx, 5, 7, 2, 2, g, Uint16Array.from([0, 255, 128, 0]), lut, gridMaps(g, view(g), 2, 2), { scale: 1, mode: 'dark', highlight: null });
    expect(ctx.at).toEqual([5, 7]);
    expect(ctx.pixel(0, 0)).toBe(lut[0]);
    expect(ctx.pixel(1, 0)).toBe(lut[255]);
    expect(ctx.pixel(0, 1)).toBe(lut[128]);
  });

  it('hatches a null in the pane, and leaves a hole on the map', () => {
    const g = geometry(1, 1);
    const pane = fakeContext();
    paintGrid(pane, 0, 0, 10, 10, g, Uint16Array.from([NULL_CODE]), lut, gridMaps(g, view(g), 10, 10), { scale: 1, mode: 'dark', highlight: null });
    const [a, b] = hatchColours('dark');
    expect(new Set(new Uint32Array(pane.image!.data.buffer))).toEqual(new Set([a, b]));
    const map = fakeContext();
    paintGrid(map, 0, 0, 10, 10, g, Uint16Array.from([NULL_CODE]), lut, gridMaps(g, view(g), 10, 10), { scale: 1, mode: 'dark', highlight: null, nullClear: true });
    expect(new Set(new Uint32Array(map.image!.data.buffer))).toEqual(new Set([0]));
  });

  it('hatches what isn’t a number as it does a null, and lights the two apart', () => {
    const g = geometry(2, 1);
    const paint = (highlight: Parameters<typeof paintGrid>[9]['highlight'], nullClear = false) => {
      const ctx = fakeContext();
      paintGrid(ctx, 0, 0, 2, 1, g, Uint16Array.from([TEXT_CODE, NULL_CODE]), lut, gridMaps(g, view(g), 2, 1), { scale: 1, mode: 'dark', highlight, nullClear });
      return [ctx.pixel(0, 0), ctx.pixel(1, 0)].map(pixel => hatchColours('dark').includes(pixel) ? 'hatched' : pixel === 0 ? 'hole' : 'faded');
    };
    expect(paint(null)).toEqual(['hatched', 'hatched']);
    expect(paint({ kind: 'text' })).toEqual(['hatched', 'faded']);
    expect(paint({ kind: 'null' })).toEqual(['faded', 'hatched']);
    expect(paint(null, true)).toEqual(['hole', 'hole']);
  });

  it('writes text in a cell as it was sent, cut short, and null as a word', () => {
    const g = geometry(3, 1);
    const { ctx, calls } = recordingContext();
    const values = ['rain', 'snowstorm', null];
    paintGridDetail(ctx, { plotX: 0, plotY: 0, plotW: 300, plotH: 100, v: view(g) } as Parameters<typeof paintGridDetail>[1], g, gridMaps(g, view(g), 300, 100),
      Uint16Array.from([TEXT_CODE, TEXT_CODE, NULL_CODE]), lut, cell => values[cell], 1, PALETTE);
    const written = calls.filter(([name]) => name === 'fillText');
    expect(written.map(([, colour, text]) => [text, colour])).toEqual([['"rain"', 'secondary'], ['"snows…', 'secondary'], ['null', 'secondary']]);
  });

  it('fades a null while something else is lit', () => {
    const g = geometry(1, 1);
    const ctx = fakeContext();
    paintGrid(ctx, 0, 0, 2, 2, g, Uint16Array.from([NULL_CODE]), lut, gridMaps(g, view(g), 2, 2), { scale: 1, mode: 'dark', highlight: { kind: 'above' } });
    expect(hatchColours('dark')).not.toContain(ctx.pixel(0, 0));
  });

  it('shows one outlier and one null among a million cells in a 100 × 100 picture', () => {
    const n = 1000;
    const g = geometry(n, n);
    const codes = new Uint16Array(n * n).fill(120);
    const outlier = 777 * n + 345;
    codes[outlier] = 250;
    codes[123 * n + 45] = NULL_CODE;
    const ctx = fakeContext();
    paintGrid(ctx, 0, 0, 100, 100, g, codes, lut, gridMaps(g, view(g), 100, 100), { scale: 1, mode: 'dark', highlight: null });
    const seen = new Set(new Uint32Array(ctx.image!.data.buffer));
    expect(seen.has(lut[250])).toBe(true);
    expect(seen.has(lut[120])).toBe(true);
    expect(hatchColours('dark').some(colour => seen.has(colour))).toBe(true);
    expect(ctx.pixel(34, 77)).toBe(lut[250]);
  });

  it('takes a null over any value, and a far value over a near one, under one pixel', () => {
    const g = geometry(4, 1);
    const pick = (codes: number[]) => {
      const ctx = fakeContext();
      paintGrid(ctx, 0, 0, 1, 1, g, Uint16Array.from(codes), lut, gridMaps(g, view(g), 1, 1), { scale: 1, mode: 'dark', highlight: null });
      return ctx.pixel(0, 0);
    };
    expect(hatchColours('dark')).toContain(pick([100, 100, NULL_CODE, 255]));
    // Whichever the median, and whichever comes first
    expect(hatchColours('dark')).toContain(pick([200, 200, NULL_CODE, 0]));
    expect(hatchColours('dark')).toContain(pick([NULL_CODE, 200, 200, 0]));
    expect(pick([200, 200, BELOW_CODE, 0])).toBe(lut[BELOW_CODE]);
    expect(pick([BELOW_CODE, 200, 200, 0])).toBe(lut[BELOW_CODE]);
    expect(pick([100, 100, 100, 255])).toBe(lut[255]);
    expect(pick([100, 100, 100, 0])).toBe(lut[0]);
  });

  it('points at the same cell it shows, and says how many share the pixel', () => {
    const g = geometry(4, 1);
    const codes = Uint16Array.from([100, 100, 255, 100]);
    expect(cellAtPixel(g, codes, gridMaps(g, view(g), 1, 1), 0, 0)).toEqual({ cell: 2, under: 4 });
    const nulled = Uint16Array.from([100, NULL_CODE, 255, 100]);
    expect(cellAtPixel(g, nulled, gridMaps(g, view(g), 1, 1), 0, 0)).toEqual({ cell: 1, under: 4 });
    const farther = Uint16Array.from([200, 200, NULL_CODE, 0]);
    expect(cellAtPixel(g, farther, gridMaps(g, view(g), 1, 1), 0, 0)).toEqual({ cell: 2, under: 4 });
  });

  it('points at nothing outside the picture', () => {
    const g = geometry(4, 1);
    const maps = gridMaps(g, view(g), 4, 4);
    const codes = new Uint16Array(4);
    expect(cellAtPixel(g, codes, maps, -1, 0)).toBeNull();
    expect(cellAtPixel(g, codes, maps, 4, 0)).toBeNull();
    expect(cellAtPixel(g, codes, maps, 0, 4)).toBeNull();
  });
});

describe('the view of the picture', () => {
  const cells = () => drawn(grid({ x: counting(10), y: counting(10).map(i => 60 - i), values: new Array(100).fill(1) }));

  it('fits a grid to its cells’ edges', () => {
    const c = cells();
    const g = c.geometry as GridGeometry;
    expect(fullView(c)).toEqual({ x0: g.xEdges[0], x1: g.xEdges[10], y0: g.yEdges[0], y1: g.yEdges[10] });
  });

  it('leaves room around points and polygons', () => {
    const polygons = drawn(triangles([1, 2]));
    const v = fullView(polygons);
    expect(v.x0).toBeLessThan(10);
    expect(v.x1).toBeGreaterThan(12);
    const points = drawn(pointCollection(counting(9).map(i => pointCoverage(20 + i, 50 + (i * 7) % 9, { values: { a: [i] } }))));
    expect(fullView(points).x0).toBeLessThan(20);
    expect(fullView(points).x1).toBeGreaterThan(28);
  });

  it('goes back to fit when zoomed all the way out', () => {
    const c = cells();
    expect(clampView(c, fullView(c))).toBeNull();
    const { x0, x1, y0, y1 } = fullView(c);
    expect(clampView(c, { x0: x0 - 1, x1: x1 + 1, y0: y0 + 1, y1: y1 - 1 })).toBeNull();
  });

  it('keeps a zoomed view over the cells', () => {
    const c = cells();
    const full = fullView(c);
    const width = (full.x1 - full.x0) / 2;
    const height = (full.y0 - full.y1) / 2;
    const moved = clampView(c, { x0: full.x0 - 3, x1: full.x0 - 3 + width, y0: full.y0 + 2, y1: full.y0 + 2 - height })!;
    expect(moved.x0).toBe(full.x0);
    expect(moved.x1).toBeCloseTo(full.x0 + width, 8);
    expect(moved.y0).toBe(full.y0);
    const other = clampView(c, { x0: full.x1 + 3 - width, x1: full.x1 + 3, y0: full.y1 - 2 + height, y1: full.y1 - 2 })!;
    expect(other.x1).toBe(full.x1);
    expect(other.y1).toBe(full.y1);
  });

  it('makes ticks of nice numbers, within the range', () => {
    expect(ticks(0.4, 3.6, 3).list).toEqual([1, 2, 3]);
    expect(ticks(24.1, 24.9, 4).list).toEqual([24.2, 24.4, 24.6, 24.8]);
    expect(ticks(5, 5, 3).list).toEqual([5]);
  });

  it('fits the width, and stays within what it’s allowed to be tall', () => {
    const box = plotLayout(cells(), 500, null, 300);
    expect(box.plotH).toBe(300);
    expect(box.plotW).toBeLessThan(500);
    expect(box.height).toBe(300 + 30);
    expect(box.plotX + box.plotW).toBeLessThanOrEqual(500);
  });

  it('never goes taller than the width allows, whatever room there is', () => {
    const tall = drawn(grid({ x: [1, 2], y: counting(40).map(i => 60 - i), values: new Array(80).fill(1) }));
    expect(plotLayout(tall, 400, null, 5000).plotH).toBe(420);
  });

  it('keeps a single row tall enough to see', () => {
    const row = drawn(grid({ x: counting(50).map(i => i * 0.1), y: [60], values: new Array(50).fill(1) }));
    expect(plotLayout(row, 500, null, 500).plotH).toBeGreaterThanOrEqual(44);
  });

  it('draws one cell as a square, and leaves room for its labels', () => {
    const box = plotLayout(drawn(grid({ x: [10], y: [55], values: [1] })), 500, null, 500);
    expect(box.plotW).toBe(150);
    expect(box.plotH).toBe(150);
  });

  it('makes room at the left for the longest label', () => {
    const narrow = plotLayout(cells(), 500, null, 500).plotX;
    const fine = drawn(grid({ x: counting(10), y: counting(10).map(i => 60 - i * 0.001), values: new Array(100).fill(1) }));
    expect(plotLayout(fine, 500, null, 500).plotX).toBeGreaterThan(0);
    expect(narrow).toBeGreaterThan(0);
  });
});

describe('pointing', () => {
  const paintedGrid = (c: DrawableCells, width = 500, tallest = 500): PaintedPlot => {
    const box = plotLayout(c, width, null, tallest);
    const g = c.geometry as GridGeometry;
    return { box, maps: gridMaps(g, box.v, box.plotW, box.plotH), codes: new Uint16Array(c.cells), scale: 1 };
  };

  it('finds the cell under a grid’s pixel, and nothing outside it', () => {
    const c = drawn(grid({ x: [1, 2], y: [61, 60], values: [1, 2, 3, 4] }));
    const plot = paintedGrid(c);
    const { box } = plot;
    expect(hitTest(plot, c, box.plotX + box.plotW * 0.75, box.plotY + box.plotH * 0.25)).toEqual({ cell: 1, under: 1 });
    expect(hitTest(plot, c, box.plotX + box.plotW * 0.25, box.plotY + box.plotH * 0.75)).toEqual({ cell: 2, under: 1 });
    expect(hitTest(plot, c, box.plotX - 1, box.plotY)).toBeNull();
    expect(hitTest(plot, c, box.plotX, box.plotY + box.plotH)).toBeNull();
  });

  it('finds the nearest point, within reach', () => {
    const c = drawn(pointCollection(counting(9).map(i => pointCoverage(20 + i, 50 + (i * 7) % 9, { values: { a: [i] } }))));
    const box = plotLayout(c, 500, null, 500);
    const plot: PaintedPlot = { box, maps: null, codes: new Uint16Array(c.cells), scale: 1 };
    const place = (i: number) => {
      const g = c.geometry;
      if (g.kind !== 'samples') throw new Error('Points expected');
      return [box.plotX + ((g.xs[i] - box.v.x0) / (box.v.x1 - box.v.x0)) * box.plotW, g.ys[i]];
    };
    const [x] = place(4);
    const y = box.plotY + box.plotH / 2;
    const found = hitTest(plot, c, x, y);
    expect(found === null || found.under === 1).toBe(true);
    expect(hitTest({ ...plot }, c, box.plotX + 1, box.plotY + 1)).toBeNull();
  });

  it('finds nothing outside the plot, though a point is near', () => {
    const c = drawn(pointCollection(counting(9).map(i => pointCoverage(20 + i, 50 + (i * 7) % 9, { values: { a: [i] } }))));
    const box = plotLayout(c, 500, null, 500);
    const plot: PaintedPlot = { box, maps: null, codes: new Uint16Array(c.cells), scale: 1 };
    // The westernmost point, which is 4% of the view in from the edge, so pointed at from just past that edge
    const [x, y] = pixelOf(box, c.crs, 20, 50, 1);
    expect(hitTest(plot, c, x, y)).toEqual({ cell: 0, under: 1 });
    expect(hitTest(plot, c, box.plotX - 1, y)).toBeNull();
    expect(hitTest(plot, c, x, box.plotY + box.plotH + 1)).toBeNull();
  });

  it('finds the polygon a pixel is inside', () => {
    const c = drawn(triangles([1, 2]));
    const box = plotLayout(c, 500, null, 500);
    const plot: PaintedPlot = { box, maps: null, codes: new Uint16Array(c.cells), scale: 1 };
    // Low in the middle of each triangle: x 10.5 and 11.5, just above y 50
    const px = (lon: number) => box.plotX + ((lon - box.v.x0) / (box.v.x1 - box.v.x0)) * box.plotW;
    const bottom = box.plotY + box.plotH * 0.9;
    expect(hitTest(plot, c, px(10.5), bottom)?.cell).toBe(0);
    expect(hitTest(plot, c, px(11.5), bottom)?.cell).toBe(1);
    expect(hitTest(plot, c, px(11), box.plotY + box.plotH * 0.2)).toBeNull();
  });
});

describe('scaleText', () => {
  it('says how big a cell is', () => {
    const c = drawn(grid({ x: [1, 2], y: [61, 60], values: [1, 2, 3, 4] }));
    const box = plotLayout(c, 500, null, 500);
    expect(scaleText({ box, maps: null, codes: new Uint16Array(4), scale: 1 }, c)).toMatch(/^1 cell = \d+\.\d × \d+\.\d px$/);
  });

  it('says when cells share a pixel, and what the pixel shows', () => {
    const c = drawn(grid({ x: counting(1000).map(i => i * 0.001), y: [61, 60], values: new Array(2000).fill(1) }));
    const box = plotLayout(c, 500, null, 500);
    expect(scaleText({ box, maps: null, codes: new Uint16Array(2000), scale: 1 }, c)).toMatch(/^1 px holds up to \d+ × 1 cells, and shows the one that stands out$/);
  });

  it('says when a cell is a device pixel on a sharp screen', () => {
    const c = drawn(grid({ x: counting(700).map(i => i * 0.001), y: [60.002, 60], values: new Array(1400).fill(1) }));
    const box = plotLayout(c, 500, null, 500);
    expect(scaleText({ box, maps: null, codes: new Uint16Array(1400), scale: 2 }, c)).toBe('A cell is about a screen pixel. Zoom in to see them apart');
  });

  it('says what a point and a polygon are', () => {
    const polygons = drawn(triangles([1, 2]));
    const box = plotLayout(polygons, 500, null, 500);
    expect(scaleText({ box, maps: null, codes: new Uint16Array(2), scale: 1 }, polygons)).toBe('Each polygon as the response gives it');
    const points = drawn(pointCollection([[0, 0], [0.01, 0.01], [3, 3], [3.5, 9], [10, 1], [11, 12], [15, 15], [15.1, 15], [20, 2]].map(([x, y]) => pointCoverage(20 + x, 50 + y, { values: { a: [1] } }))));
    expect(scaleText({ box: plotLayout(points, 500, null, 500), maps: null, codes: new Uint16Array(9), scale: 1 }, points)).toBe('Each dot is a point. A dot has no area');
  });
});

describe('painting what isn’t a number', () => {
  it('fills a polygon of text as it does a null, and leaves both out on the map', () => {
    const cells = drawn(triangles(['a', null]));
    const box = { plotX: 0, plotY: 0, plotW: 100, plotH: 100, v: fullView(cells) };
    const codes = Uint16Array.from([TEXT_CODE, NULL_CODE]);
    const lut = lutFor('sequential', 'dark', null);
    const pane = recordingContext();
    paintPolygons(pane.ctx, box, cells.geometry as Parameters<typeof paintPolygons>[2], cells.crs, codes, lut, 1, PALETTE);
    expect(pane.calls.filter(([name]) => name === 'fill').map(([, colour]) => colour)).toEqual(['#3a3a3a', '#3a3a3a']);
    const map = recordingContext();
    paintPolygons(map.ctx, box, cells.geometry as Parameters<typeof paintPolygons>[2], cells.crs, codes, lut, 1, PALETTE, true);
    expect(map.calls.filter(([name]) => name === 'fill')).toEqual([]);
  });

  it('marks a point of text as it does a null', () => {
    const cells = drawn(pointCollection([pointCoverage(24, 60, { values: { a: ['x'] } }), pointCoverage(25, 61, { values: { a: [null] } }), pointCoverage(26, 62, { values: { a: [3] } })]));
    const box = { plotX: 0, plotY: 0, plotW: 100, plotH: 100, v: fullView(cells) };
    const codes = Uint16Array.from([TEXT_CODE, NULL_CODE, 0]);
    const { ctx, calls } = recordingContext();
    paintSamples(ctx, box, cells.geometry as Parameters<typeof paintSamples>[2], cells.crs, codes, lutFor('sequential', 'dark', null), 1, PALETTE, null);
    expect(calls.filter(([name]) => name === 'strokeRect')).toHaveLength(2);
  });

  it('draws a point of text in its thumbnail as it does a null', () => {
    const cells = drawn(pointCollection([pointCoverage(24, 60, { values: { a: ['x'] } }), pointCoverage(25, 61, { values: { a: [3] } })]));
    const { ctx, calls } = recordingContext();
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    paintThumb(canvas, cells, Uint16Array.from([TEXT_CODE, 0]), lutFor('sequential', 'dark', null), 40, 30, 1, PALETTE);
    expect(calls.filter(([name]) => name === 'fillRect').map(([, colour]) => colour)).toEqual(['plot', 'secondary', expect.stringMatching(/^rgb/)]);
  });
});

describe('painting what nothing was sent for', () => {
  const lut = lutFor('sequential', 'dark', null);
  const row = (nx: number): GridGeometry => ({
    kind: 'grid', nx, ny: 1, cells: nx, xs: counting(nx), ys: [0], assumedSize: false,
    xEdges: Float64Array.from({ length: nx + 1 }, (_, i) => i), yEdges: Float64Array.from([1, 0]),
  });
  const view = (g: GridGeometry) => ({ x0: 0, x1: g.nx, y0: 1, y1: 0 });
  const onePixel = (codes: number[]) => {
    const g = row(codes.length);
    const ctx = fakeContext();
    paintGrid(ctx, 0, 0, 1, 1, g, Uint16Array.from(codes), lut, gridMaps(g, view(g), 1, 1), { scale: 1, mode: 'dark', highlight: null });
    return ctx.pixel(0, 0);
  };

  it('leaves it as paper', () => {
    const g = row(2);
    const ctx = fakeContext();
    paintGrid(ctx, 0, 0, 2, 1, g, Uint16Array.from([ABSENT_CODE, 128]), lut, gridMaps(g, view(g), 2, 1), { scale: 1, mode: 'dark', highlight: null });
    expect([ctx.pixel(0, 0), ctx.pixel(1, 0)]).toEqual([0, lut[128]]);
  });

  it('never shows it over something sent under one pixel, a value or a null', () => {
    expect(onePixel([ABSENT_CODE, ABSENT_CODE, 100, ABSENT_CODE])).toBe(lut[100]);
    expect(hatchColours('dark')).toContain(onePixel([ABSENT_CODE, NULL_CODE, ABSENT_CODE]));
    expect(onePixel([ABSENT_CODE, ABSENT_CODE])).toBe(0);
    expect(standOut(ABSENT_CODE, 128)).toBeLessThan(standOut(128, 128));
  });

  it('points at what it shows: something sent before nothing', () => {
    const g = row(4);
    const maps = gridMaps(g, view(g), 1, 1);
    expect(cellAtPixel(g, Uint16Array.from([ABSENT_CODE, ABSENT_CODE, 100, ABSENT_CODE]), maps, 0, 0)).toEqual({ cell: 2, under: 4 });
    expect(cellAtPixel(g, Uint16Array.from([ABSENT_CODE, ABSENT_CODE, ABSENT_CODE, ABSENT_CODE]), maps, 0, 0)).toEqual({ cell: 0, under: 4 });
  });

  it('writes nothing in it', () => {
    const g = row(2);
    const { ctx, calls } = recordingContext();
    paintGridDetail(ctx, { plotX: 0, plotY: 0, plotW: 200, plotH: 100, v: view(g) } as Parameters<typeof paintGridDetail>[1], g, gridMaps(g, view(g), 200, 100),
      Uint16Array.from([ABSENT_CODE, 100]), lut, cell => [undefined, 7][cell], 1, PALETTE);
    expect(calls.filter(([name]) => name === 'fillText').map(([, , text]) => text)).toEqual(['7']);
  });
});

describe('painting a section', () => {
  const lut = lutFor('sequential', 'dark', null);
  const urlOf = (json: unknown) => /^GET (\S+),/.exec((json as { _comment: string })._comment)?.[1];
  const section = (json: unknown, url = urlOf(json)) => readResponseCells(json, { url }) as DrawableCells;
  const gridOf = (cells: DrawableCells) => cells.geometry as GridGeometry;
  const BADLEVEL_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf_painepinta/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)&z=1000,850,500,333&f=CoverageJSON';
  const painted = (cells: DrawableCells, width: number) => {
    const box = plotLayout(cells, width, null, 500);
    const g = gridOf(cells);
    const [parameter] = cells.parameters;
    const codes = codesOf(cells);
    return { box, g, maps: gridMaps(g, box.v, box.plotW, box.plotH), codes, parameter };
  };
  const codesOf = (cells: DrawableCells) => {
    const [parameter] = cells.parameters;
    const out = new Uint16Array(cells.cells);
    for (let i = 0; i < cells.cells; i++) out[i] = parameter.absentAt?.[i] ? ABSENT_CODE : Number.isNaN(parameter.data[i]) ? NULL_CODE : 100;
    return out;
  };
  const texts = (calls: [string, unknown, ...unknown[]][]) => calls.filter(([name]) => name === 'fillText').map(([, colour, text]) => [text, colour]);
  // Labels are kept inside the canvas by their width
  const measuring = () => {
    const recording = recordingContext();
    recording.ctx.measureText = (text: string) => ({ width: text.length * 6.7 }) as TextMetrics;
    return recording;
  };

  it('fills the width, at a height that follows it within bounds', () => {
    const radar = section(mcRadarFikorZ);
    for (const [width, tallest] of [[200, 500], [320, 500], [520, 500], [760, 500], [1200, 500], [760, 200]]) {
      const box = plotLayout(radar, width, null, tallest);
      expect(box.plotX + box.plotW + 8).toBe(width);
      expect(box.plotH).toBe(Math.max(150, Math.min(Math.round(box.plotW * 0.6), tallest, 420)));
      expect(box.height).toBe(box.plotH + marginsOf(radar));
    }
    // The longest level, 9306.12 m, has room
    expect(plotLayout(radar, 520, null, 500).plotX).toBeGreaterThanOrEqual(Math.ceil(7 * 6.7));
  });

  it('keeps its size when zoomed, and changes only the view', () => {
    const radar = section(mcRadarFikorZ);
    const zoom = { x0: 10, x1: 20, y0: 0.6, y1: 0.4 };
    const box = plotLayout(radar, 520, zoom, 500);
    expect(box).toMatchObject({ ...plotLayout(radar, 520, null, 500), v: zoom });
  });

  it('keeps room for the waypoints’ letters only where there are some', () => {
    expect(marginsOf(readCells(grid()) as DrawableCells)).toBe(30);
    expect(marginsOf(section(mcRadarFikorZ))).toBe(50);
    expect(marginsOf(section(mcRadarFikorZ, ''))).toBe(36);
  });

  it('ticks km in nice numbers within the path, and counts positions from 1 where they aren’t lon/lat', () => {
    const cells = section(fmiEc2param);
    const { v } = plotLayout(cells, 500, null, 500);
    const total = cells.section!.data.spacing.total;
    const toPixels = (km: number) => ((km - v.x0) / (v.x1 - v.x0)) * 300;
    const km = sectionXTicks(v, total, 300, false);
    expect(km.map(tick => tick.label)).toEqual(['0', '100', '200']);
    expect(km.every(tick => tick.at >= toPixels(0) && tick.at <= toPixels(total))).toBe(true);
    expect(sectionXTicks({ x0: -0.5, x1: 2.5, y0: 1, y1: 0 }, 2, 300, true)).toEqual([{ at: 50, label: '1' }, { at: 150, label: '2' }, { at: 250, label: '3' }]);
    expect(sectionXTicks({ x0: 300, x1: 400, y0: 1, y1: 0 }, total, 300, false)).toEqual([]);
  });

  it('ticks each position under the axis only where they’re apart, a break once', () => {
    const v = { x0: -0.5, x1: 2.5, y0: 1, y1: 0 };
    expect(positionRug([0, 1, 2], v, 300)).toEqual([50, 150, 250]);
    expect(positionRug([0, 1, 1, 2], v, 300)).toEqual([50, 150, 250]);
    expect(positionRug(counting(257).map(i => i * 0.5), { x0: 0, x1: 128, y0: 1, y1: 0 }, 300)).toEqual([]);
  });

  it('letters each waypoint, but not on top of the last letter, and keeps its line', () => {
    const at = (label: string, km: number | null): Waypoint => ({ label, line: 0, lon: 0, lat: 0, col: km === null ? null : 0, km });
    const v = { x0: 0, x1: 100, y0: 1, y1: 0 };
    expect(waypointMarks([at('A', 0), at('B', 0.4), at('C', 2), at('D', null), at('E', 60), at('F', 120)], v, 1000))
      .toEqual([{ x: 0, label: 'A' }, { x: 4, label: null }, { x: 20, label: 'C' }, { x: 600, label: 'E' }]);
    // Room is from the last letter drawn, not from a line without one: C is 16 px from A, and 8 from B
    expect(waypointMarks([at('A', 0), at('B', 0.8), at('C', 1.6)], v, 1000).map(mark => mark.label)).toEqual(['A', null, 'C']);
    // Where one line ends and the next starts, the two share a km and a letter
    const marks = waypointMarks(section(fmiMultilinestring).section!.data.waypoints, plotLayout(section(fmiMultilinestring), 500, null, 500).v, 450);
    expect(marks.map(mark => mark.label)).toEqual(['A', 'B', null, 'D']);
  });

  it('ticks every level, labels some, and always one asked for and not sent', () => {
    const cells = section(fmiEc2param, BADLEVEL_URL);
    const { v } = plotLayout(cells, 500, null, 500);
    const ticks333 = levelTicks(cells.section!, gridOf(cells), v, 200);
    expect(ticks333.map(({ level, missing, label }) => [level, missing, label])).toEqual([[333, true, '333'], [500, false, '500'], [850, false, '850'], [1000, false, '1000']]);
    expect(ticks333.every((tick, i) => i === 0 || tick.at > ticks333[i - 1].at)).toBe(true);
    const radar = section(mcRadarFikorZ);
    const radarTicks = levelTicks(radar.section!, gridOf(radar), fullView(radar), 250);
    expect(radarTicks).toHaveLength(39);
    const labelled = radarTicks.filter(tick => tick.label !== null);
    expect(labelled[0].label).toBe(String(Number(gridOf(radar).ys[0].toPrecision(6))));
    expect(labelled[labelled.length - 1].label).toBe('0');
    expect(labelled.every((tick, i) => i === 0 || tick.at - labelled[i - 1].at >= LEVEL_LABEL_GAP)).toBe(true);
  });

  it('labels a level asked for and not sent even where the levels around it leave it no room', () => {
    // 925 hPa, not sent, a few px above 1000 at this height: 1000's label gives way to it, and not it to 1000's
    const cells = section(fmiEc2param, BADLEVEL_URL.replace('z=1000,850,500,333', 'z=1000,925,850,500'));
    const ticks = levelTicks(cells.section!, gridOf(cells), fullView(cells), 100);
    expect(ticks.map(({ level, missing, label }) => [level, missing, label])).toEqual([[500, false, '500'], [850, false, null], [925, true, '925'], [1000, false, null]]);
  });

  it('keeps a clear gap between level labels at every height a plot can be, the top one included', () => {
    const radar = section(mcRadarFikorZ);
    for (let plotH = 150; plotH <= 420; plotH++) {
      const labelled = levelTicks(radar.section!, gridOf(radar), fullView(radar), plotH).filter(tick => tick.label !== null);
      const gaps = labelled.slice(1).map((tick, i) => tick.at - labelled[i].at);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(LEVEL_LABEL_GAP);
      expect(labelled[0].label).toBe('9306.12');
    }
    // On a phone: 9306.12 and 8571.42 were 13.5 px apart, and nearly touched
    const phone = levelTicks(radar.section!, gridOf(radar), fullView(radar), 176).filter(tick => tick.label !== null).map(tick => tick.label);
    expect(phone.slice(0, 2)).toEqual(['9306.12', '7346.93']);
  });

  it('draws the lowest beam as lines broken where there’s no height, and at each break', () => {
    expect(floorRuns([1, 2, NaN, 4, 5, 6], [0, 1, 2, 3, 4, 5], [4], y => y)).toEqual([[[0, 1], [1, 2]], [[3, 4]], [[4, 5], [5, 6]]]);
    expect(floorRuns([1, 2], [0, 1], [], () => NaN)).toEqual([]);
  });

  it('writes km, the letters, the levels and z’s unit, with a level not sent in the warning colour', () => {
    const cells = section(fmiEc2param, BADLEVEL_URL);
    const { ctx, calls } = measuring();
    paintAxes(ctx, plotLayout(cells, 500, null, 500), cells, 1, PALETTE, false);
    expect(texts(calls)).toEqual([
      ['0', 'secondary'], ['50', 'secondary'], ['100', 'secondary'], ['150', 'secondary'], ['200', 'secondary'], ['km', 'secondary'], ['A', 'text'], ['B', 'text'], ['C', 'text'],
      ['333', 'warning'], ['500', 'secondary'], ['850', 'secondary'], ['1000', 'secondary'], ['hPa', 'secondary'],
    ]);
  });

  it('counts positions, and has no letters, where x and y aren’t lon/lat', () => {
    const json = JSON.parse(JSON.stringify(fmiEc2param));
    json.referencing[0].system = { type: 'ProjectedCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/3067' };
    const cells = section(json, urlOf(fmiEc2param));
    const { ctx, calls } = measuring();
    paintAxes(ctx, plotLayout(cells, 500, null, 500), cells, 1, PALETTE, false);
    expect(texts(calls).map(([text]) => text)).toEqual(['1', '2', '3', '#', '500', '850', '1000', 'hPa']);
  });

  it('draws a dashed line at each waypoint, and a solid rule at a break', () => {
    const cells = section(fmiMultilinestring);
    const { box, maps, codes } = painted(cells, 500);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, box, cells, maps, codes, lut, 0, 1, PALETTE);
    expect(calls.filter(([name]) => name === 'setLineDash').map(([, , dash]) => dash)).toEqual([[3, 3], []]);
    expect(calls.filter(([name]) => name === 'stroke')).toHaveLength(4);
    const rules = calls.filter(([name]) => name === 'fillRect');
    expect(rules).toHaveLength(1);
    expect(rules[0].slice(3)).toEqual([box.plotY, 2, box.plotH]);
    // The cells hold their values, which mark them
    expect(calls.filter(([name]) => name === 'arc')).toHaveLength(0);
  });

  it('keeps a line clear of what’s written where it crosses, and draws all of it where nothing is', () => {
    const word = { x0: 10, x1: 30, y0: 40, y1: 50 };
    expect(clearOfText(20, 0, 100, [word], 2)).toEqual([[0, 38], [52, 100]]);
    expect(clearOfText(20, 0, 100, [{ ...word, y0: 70, y1: 80 }, word], 2)).toEqual([[0, 38], [52, 68], [82, 100]]);
    // Beside the text, or above the plot, it's left alone
    expect(clearOfText(40, 0, 100, [word], 2)).toEqual([[0, 100]]);
    expect(clearOfText(20, 60, 100, [word], 2)).toEqual([[60, 100]]);
    expect(clearOfText(20, 0, 100, [], 2)).toEqual([[0, 100]]);
    // Text at the very top
    expect(clearOfText(20, 0, 100, [{ ...word, y0: -5, y1: 5 }], 2)).toEqual([[7, 100]]);
  });

  it('says where it wrote each value, and nothing where it wrote none', () => {
    const g = gridOf(readCells(grid({ x: [1, 2], y: [60], values: [1, 2] })) as DrawableCells);
    const view = fullView({ geometry: g, crs: { declared: true, geographic: true } } as DrawableCells);
    const box = { plotX: 0, plotY: 0, plotW: 200, plotH: 100, v: view } as Parameters<typeof paintGridDetail>[1];
    const { ctx } = recordingContext();
    const printed = paintGridDetail(ctx, box, g, gridMaps(g, view, 200, 100), Uint16Array.from([ABSENT_CODE, 100]), lut, cell => [undefined, 7.25][cell], 1, PALETTE);
    // "7.25" in 11 px figures, centred in the second cell
    expect(printed).toHaveLength(1);
    expect(printed[0].x0).toBeCloseTo(150 - 2 * 11 * 0.6, 9);
    expect(printed[0].x1).toBeCloseTo(150 + 2 * 11 * 0.6, 9);
    expect([printed[0].y0, printed[0].y1]).toEqual([44.5, 55.5]);
    // "null" is written over its cell as a value is, and kept clear of in the same way
    const nulls = paintGridDetail(recordingContext().ctx, box, g, gridMaps(g, view, 200, 100), Uint16Array.from([NULL_CODE, 100]), lut, cell => [null, 7.25][cell], 1, PALETTE);
    expect(nulls).toHaveLength(2);
    expect(nulls[0].x0).toBeCloseTo(50 - 2 * 11 * 0.6, 9);
    expect(nulls[0].x1).toBeCloseTo(50 + 2 * 11 * 0.6, 9);
  });

  it('stops a waypoint’s line short of the values written in the cells, where the positions are the vertices', () => {
    const cells = section(fmiEc2param);
    const { box, g, maps, codes, parameter } = painted(cells, 700);
    const { ctx, calls } = recordingContext();
    const printed = paintGridDetail(ctx, box, g, maps, codes, lut, cell => parameter.rawAt(cell, 0).value, 1, PALETTE);
    expect(printed).toHaveLength(9);
    const lines = recordingContext();
    paintSectionDetail(lines.ctx, box, cells, maps, codes, lut, 0, 1, PALETTE, printed);
    const strokes: [number, number, number][] = [];
    lines.calls.forEach(([name, , x, y], i) => {
      if (name === 'moveTo' && lines.calls[i + 1]?.[0] === 'lineTo') strokes.push([x as number, y as number, lines.calls[i + 1][3] as number]);
    });
    // A, B and C, each a line broken around the three values it crosses
    const waypoints = strokes.filter(([x]) => [0, 1, 2].some(col => Math.abs(x - (box.plotX + (maps.ex[col] + maps.ex[col + 1]) / 2)) < 1));
    expect(waypoints).toHaveLength(3 * 4);
    for (const [x, from, to] of waypoints) {
      for (const text of printed) if (x >= text.x0 - 2 && x <= text.x1 + 2) expect(to <= text.y0 - 2 || from >= text.y1 + 2).toBe(true);
    }
    expect(calls.filter(([name]) => name === 'fillText')).toHaveLength(9);
  });

  it('draws a waypoint’s line whole across cells with nothing written in them', () => {
    const track = section(mcIfsLsz);
    const { box, g, maps, codes, parameter } = painted(track, 1400);
    const printed = paintGridDetail(recordingContext().ctx, box, g, maps, codes, lut, cell => parameter.rawAt(cell, 0).value, 1, PALETTE);
    // A value at each position, and nothing at its other levels
    expect(printed).toHaveLength(9);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, box, track, maps, codes, lut, 0, 1, PALETTE, printed);
    const lineTos = calls.filter(([name]) => name === 'lineTo');
    // A, B and C: each broken once, around its one value
    expect(lineTos).toHaveLength(3 * 2);
    const { ctx: plain, calls: whole } = recordingContext();
    paintSectionDetail(plain, box, track, maps, codes, lut, 0, 1, PALETTE);
    expect(whole.filter(([name]) => name === 'lineTo')).toHaveLength(3);
  });

  it('draws the lowest beam through its height at each position, in the plane’s y', () => {
    const cells = section(mcRadarFikorZ);
    const { box, maps, codes } = painted(cells, 520);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, box, cells, maps, codes, lut, 0, 1, PALETTE);
    const { data, yOf } = cells.section!;
    const { v } = box;
    const start = [
      box.plotX + ((data.km[0] - v.x0) / (v.x1 - v.x0)) * box.plotW,
      box.plotY + ((v.y0 - yOf(data.beamFloor!.values[0][0])) / (v.y0 - v.y1)) * box.plotH,
    ];
    const moves = calls.filter(([name]) => name === 'moveTo').map(([, , x, y]) => [x, y]);
    // The casing, then the line over it, each from the first position
    expect(moves.filter(([x, y]) => x === start[0] && y === start[1])).toHaveLength(2);
    expect(calls.filter(([name]) => name === 'lineTo')).toHaveLength(2 /* waypoints */ + 2 * 256);
  });

  it('draws the lowest beam of the time shown, since it changes with time', () => {
    // fikor-z at two times, the later with its floor 500 m higher
    const [a, b] = [JSON.parse(JSON.stringify(mcRadarFikorZ)), JSON.parse(JSON.stringify(mcRadarFikorZ))];
    for (const tuple of b.domain.axes.composite.values) tuple[0] = '2026-11-06T23:10:00+00:00';
    b.domain['meteocore:beamCoverage'].floor = b.domain['meteocore:beamCoverage'].floor.map((height: number) => height + 500);
    const coverage = (json: typeof a) => ({ type: 'Coverage', domain: json.domain, ranges: json.ranges });
    const cells = section({ type: 'CoverageCollection', domainType: 'Section', parameters: a.parameters, coverages: [coverage(a), coverage(b)] }, urlOf(mcRadarFikorZ));
    expect(cells.slices).toBe(2);
    const { box, maps, codes } = painted(cells, 520);
    const { data, yOf } = cells.section!;
    const { v } = box;
    const x = box.plotX + ((data.km[0] - v.x0) / (v.x1 - v.x0)) * box.plotW;
    const startsAt = (slice: number) => {
      const { ctx, calls } = recordingContext();
      paintSectionDetail(ctx, box, cells, maps, codes, lut, slice, 1, PALETTE);
      return calls.filter(([name, , mx]) => name === 'moveTo' && mx === x).map(([, , , y]) => y);
    };
    const yAt = (slice: number) => box.plotY + ((v.y0 - yOf(data.beamFloor!.values[slice][0])) / (v.y0 - v.y1)) * box.plotH;
    expect(yAt(1)).not.toBeCloseTo(yAt(0), 0);
    expect(startsAt(1)).toEqual([yAt(1), yAt(1)]);
    expect(startsAt(0)).toEqual([yAt(0), yAt(0)]);
  });

  it('dots each sample once its cells have room, where something was sent', () => {
    const radar = section(mcRadarFikorZ);
    const wide = painted(radar, 3000);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, wide.box, radar, wide.maps, wide.codes, lut, 0, 1, PALETTE);
    expect(calls.filter(([name]) => name === 'arc')).toHaveLength(257 * 39);
    const narrow = painted(radar, 520);
    const again = recordingContext();
    paintSectionDetail(again.ctx, narrow.box, radar, narrow.maps, narrow.codes, lut, 0, 1, PALETTE);
    expect(again.calls.filter(([name]) => name === 'arc')).toHaveLength(0);
    const track = section(mcIfsLsz);
    const small = painted(track, 250);
    const third = recordingContext();
    paintSectionDetail(third.ctx, small.box, track, small.maps, small.codes, lut, 0, 1, PALETTE);
    expect(third.calls.filter(([name]) => name === 'arc')).toHaveLength(9);
  });

  it('dots each sample at its own level, which a log axis doesn’t put in the middle of its cell', () => {
    const track = section(mcIfsLsz);
    const { box, g, maps, codes } = painted(track, 250);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, box, track, maps, codes, lut, 0, 1, PALETTE);
    const { v } = box;
    const yOf = (y: number) => box.plotY + ((v.y0 - y) / (v.y0 - v.y1)) * box.plotH;
    const { rowY } = track.section!;
    const expected: number[] = [];
    for (let row = 0; row < g.ny; row++) for (let col = 0; col < g.nx; col++) if (codes[row * g.nx + col] !== ABSENT_CODE) expected.push(yOf(rowY[row]));
    expect(calls.filter(([name]) => name === 'arc').map(([, , , y]) => y)).toEqual(expected);
    // 600 and 700 hPa, between 500 and 850 on a log axis, sit off their cells' middles
    for (const row of [1, 2]) expect(Math.abs(yOf((g.yEdges[row] + g.yEdges[row + 1]) / 2) - yOf(rowY[row]))).toBeGreaterThan(1);
  });

  it('paints nothing over a grid', () => {
    const cells = readCells(grid()) as DrawableCells;
    const box = plotLayout(cells, 500, null, 500);
    const { ctx, calls } = recordingContext();
    paintSectionDetail(ctx, box, cells, gridMaps(gridOf(cells), box.v, box.plotW, box.plotH), new Uint16Array(cells.cells), lut, 0, 1, PALETTE);
    expect(calls).toEqual([]);
  });
});
