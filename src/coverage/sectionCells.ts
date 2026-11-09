import { analyse } from './cellFigures';
import {
  MOST_VALUES_DRAWN, addParameterNotes, pointerPart, readCells,
  type BrokenParameter, type CellNote, type CellParameter, type CellRaw, type CellsReading, type DrawableCells, type GridGeometry, type UndrawableCells,
} from './coverageCells';
import { NOT_A_NUMBER, NOT_SENT, toSection, type SectionData, type Waypoint } from './coverageSection';
import { defaultScale, levelPosition, valuePosition, type Direction, type LevelScale, type LevelSpacing } from './verticalAxis';

// A path response as cells on a plane, distance along the path by level, so that the grid view draws it with all it
// has: the picker, Figures, the legend, the readout, zoom and steps. A cell is a position at a level, and a step is a
// time. Nothing is interpolated, and every cell leads back to its value in the response. No DOM.

export interface SectionPlane {
  // What toSection read: km, positions, the path's own CRS, waypoints, breaks, z, levels not sent, frames, the lowest beam
  data: SectionData;
  // Each display row's index into data.levels, top row first, as the response's direction has it, unflipped
  rowLevel: Int32Array;
  // As drawn
  spacing: LevelSpacing;
  defaultSpacing: LevelScale;
  canLog: boolean;
  flipped: boolean;
  // Each display row's level in the plane's y, which runs up, for the dots at the samples
  rowY: Float64Array;
  // Any value of z in the plane's y: a level, or a beam's floor between two
  yOf: (value: number) => number;
  // The most values a range has, for the readout's kept room
  mostValues: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (n: number) => n.toLocaleString('en-US');
const cant = (reason: string, why: UndrawableCells['why']): UndrawableCells => ({ drawable: false, reason, why });

// Cell edges along the path: half way between neighbouring positions, and half a step beyond each end. A position sent
// twice, as at a MULTILINESTRING's break, makes two cells that meet at its km. An end with no step takes fallbackStep
export function pathEdges(km: ArrayLike<number>, fallbackStep: number): Float64Array {
  const n = km.length;
  const edges = new Float64Array(n + 1);
  if (n === 0) return edges;
  for (let i = 1; i < n; i++) edges[i] = (km[i - 1] + km[i]) / 2;
  const first = n > 1 ? km[1] - km[0] : 0;
  const last = n > 1 ? km[n - 1] - km[n - 2] : 0;
  edges[0] = km[0] - (first || fallbackStep) / 2;
  edges[n] = km[n - 1] + (last || fallbackStep) / 2;
  return edges;
}

export interface LevelRows {
  rowLevel: Int32Array;
  // Each row's level in the plane's y: 1 at the top, 0 at the bottom
  rowY: Float64Array;
  // Top to bottom, as a grid's yEdges are
  yEdges: Float64Array;
}

// The levels as rows, top first, where levelPosition puts them: log, linear or even, the response's way up or turned
// over. Each row reaches half way to its neighbours in that scale, and an end row half a step beyond
export function levelRows(levels: number[], direction: Direction, spacing: LevelSpacing, flipped: boolean): LevelRows {
  const at = levelPosition(levels, { spacing, direction, flipped });
  const rowLevel = Int32Array.from(levels.map((_, i) => i).sort((a, b) => at(levels[a]) - at(levels[b])));
  // From 0 at the top to 1 at the bottom
  const down = Array.from(rowLevel, i => at(levels[i]));
  const n = down.length;
  const yEdges = new Float64Array(n + 1);
  for (let r = 1; r < n; r++) yEdges[r] = 1 - (down[r - 1] + down[r]) / 2;
  yEdges[0] = 1 - (down[0] - (n > 1 ? down[1] - down[0] : 1) / 2);
  yEdges[n] = 1 - (down[n - 1] + (n > 1 ? down[n - 1] - down[n - 2] : 1) / 2);
  return { rowLevel, rowY: Float64Array.from(down, p => 1 - p), yEdges };
}

// The most values any range has, wherever it is
function mostValuesOf(json: unknown): number {
  const coverages = isObject(json) ? (Array.isArray(json.coverages) ? json.coverages : [json]) : [];
  let most = 0;
  for (const coverage of coverages) {
    if (!isObject(coverage) || !isObject(coverage.ranges)) continue;
    for (const range of Object.values(coverage.ranges)) if (isObject(range) && Array.isArray(range.values)) most = Math.max(most, range.values.length);
  }
  return most;
}

// Where a parameter is defined, for a finding about its unit: by the first coverage that sends it, if it defines it
// itself, as toSection reads it, and else by the collection
function definedAtOf(json: unknown, id: string): string {
  const own = `/parameters/${pointerPart(id)}`;
  if (!isObject(json) || !Array.isArray(json.coverages)) return own;
  const c = json.coverages.findIndex(coverage => isObject(coverage) && isObject(coverage.ranges) && coverage.ranges[id] !== undefined);
  const coverage = json.coverages[c];
  return isObject(coverage) && isObject(coverage.parameters) && coverage.parameters[id] !== undefined ? `/coverages/${c}${own}` : own;
}

// A section or a track as cells: a column per position and a row per level, the levels laid out as the profile's are.
// A cell nothing was sent for, as a level asked for and not sent or a track's other levels, is absent, not null
export function sectionCells(section: SectionData, json: unknown): DrawableCells {
  const { colCount: nx, km, frames, z } = section;
  // A section has z, and so a number for each level
  const levels = section.levels.map(Number);
  const ny = levels.length;
  const cells = nx * ny;
  const slices = frames.length;
  const direction = z?.direction ?? 'up';
  const { scale: defaultSpacing, canLog } = defaultScale(z?.kind ?? 'unknown', levels);
  const { rowLevel, rowY, yEdges } = levelRows(levels, direction, defaultSpacing, false);
  const at = valuePosition(levels, { spacing: defaultSpacing, direction });

  const parameters: CellParameter[] = [];
  const broken: BrokenParameter[] = [];
  for (const sent of section.parameters) {
    const base = { id: sent.id, label: sent.label, unit: sent.unit, definedAt: definedAtOf(json, sent.id) };
    if (sent.count === 0) {
      broken.push({ ...base, problem: `${sent.id}: its values aren't in this response` });
      continue;
    }
    const data = new Float32Array(slices * cells);
    let notNumberAt: Uint8Array | null = null;
    let absentAt: Uint8Array | null = null;
    for (let frame = 0; frame < slices; frame++) {
      const from = sent.data[frame];
      for (let row = 0; row < ny; row++) {
        const source = rowLevel[row] * nx;
        const to = frame * cells + row * nx;
        for (let col = 0; col < nx; col++) {
          const value = from[source + col];
          if (value === NOT_SENT) {
            data[to + col] = NaN;
            (absentAt ??= new Uint8Array(slices * cells))[to + col] = 1;
          } else if (value === NOT_A_NUMBER) {
            data[to + col] = NaN;
            (notNumberAt ??= new Uint8Array(slices * cells))[to + col] = 1;
          } else {
            data[to + col] = value;
          }
        }
      }
    }
    const rawAt = (cell: number, slice: number): CellRaw => {
      const row = Math.floor(cell / nx);
      const found = section.cellAt(sent.id, slice, rowLevel[row] * nx + (cell - row * nx));
      return found ? { value: found.raw, index: null, pointer: found.path, coverage: null } : { value: undefined, index: null, pointer: null, coverage: null, absent: true };
    };
    // Text only if each value that isn't a number is. Looked up for those alone: a radar's nulls are a million cells
    let text = notNumberAt !== null;
    for (let i = 0; notNumberAt && text && i < notNumberAt.length; i++) {
      if (notNumberAt[i] && typeof rawAt(i % cells, Math.floor(i / cells)).value !== 'string') text = false;
    }
    parameters.push({
      ...base, data, notNumberAt, notNumbersAreText: text, absentAt,
      figures: analyse(data, slices, cells, notNumberAt, absentAt),
      rawAt,
      indicesAt: () => [],
    });
  }

  const notes: CellNote[] = broken.map(({ problem }): CellNote => ({ level: 'error', text: problem }));
  if (section.beamFloorFault) notes.push({ level: 'warn', text: section.beamFloorFault });
  parameters.forEach(parameter => addParameterNotes(notes, parameter));

  const geometry: GridGeometry = {
    kind: 'grid', nx, ny, cells,
    xs: Array.from(km),
    ys: Array.from(rowLevel, i => levels[i]),
    xEdges: pathEdges(km, section.spacing.median || 1),
    yEdges,
    assumedSize: false,
  };
  return {
    drawable: true, source: 'section', viewLabel: 'Section', domainType: section.domainType, geometry,
    // Each frame is a step. A single frame is none: its time, if it has one, is fixed, and a time along the path is
    // each position's
    dims: slices > 1 ? [{ name: 't', values: frames.map(frame => frame.raw ?? 'no time') }] : [],
    fixed: slices === 1 && frames[0].raw !== null ? { t: frames[0].raw } : {},
    slices, cells,
    crs: { ...section.crs, geographic: false },
    parameters, broken, notes, order: null, zUnit: z?.unit ?? '', coverageCount: null,
    section: {
      data: section, rowLevel, spacing: defaultSpacing, defaultSpacing, canLog, flipped: false, rowY,
      yOf: value => 1 - at(value),
      mostValues: mostValuesOf(json),
    },
  };
}

const planes = new WeakMap<DrawableCells, Map<string, DrawableCells>>();

// The plane with its levels laid out as chosen: log, linear or even, and turned over or not. The values stay where they
// are, a row per level as the response's direction has it, and a flipped picture reads them through sourceCell. Made
// once for each choice, so that switching back and forth repaints and doesn't rebuild
export function planeFor(cells: DrawableCells, spacing: LevelSpacing, flipped: boolean): DrawableCells {
  const { section, geometry: g } = cells;
  if (!section || g.kind !== 'grid') return cells;
  // Log can't place a level at or below 0
  const chosen = spacing === 'log' && !section.canLog ? section.defaultSpacing : spacing;
  if (chosen === section.spacing && flipped === section.flipped) return cells;
  const key = `${chosen} ${flipped}`;
  let known = planes.get(cells);
  if (!known) {
    known = new Map();
    planes.set(cells, known);
  }
  const made = known.get(key);
  if (made) return made;
  const levels = section.data.levels.map(Number);
  const direction = section.data.z?.direction ?? 'up';
  const rows = levelRows(levels, direction, chosen, flipped);
  const at = valuePosition(levels, { spacing: chosen, direction, flipped });
  const plane: DrawableCells = {
    ...cells,
    geometry: { ...g, ys: Array.from(rows.rowLevel, i => levels[i]), yEdges: rows.yEdges },
    section: { ...section, spacing: chosen, flipped, rowY: rows.rowY, yOf: value => 1 - at(value) },
  };
  known.set(key, plane);
  return plane;
}

// km as the readout writes it: to the metre and no further, and without a thousands comma in a line of figures
export const kmWords = (km: number) => String(Number(km.toFixed(2)));

// Which line of a MULTILINESTRING a position is on, from 0
const lineOf = (breaks: number[], col: number) => breaks.filter(start => start <= col).length;

// Where a position is from the nearest of the request's vertices: "A+112.5 km", "at B", "B−0.4 km". On a
// MULTILINESTRING, among those on its own line, which it names: "line 2, at C". Null where none is among the positions
export function fromWaypoint({ waypoints, breaks, km }: Pick<SectionData, 'waypoints' | 'breaks' | 'km'>, col: number): string | null {
  const line = lineOf(breaks, col);
  let nearest: Waypoint | null = null;
  let off = Infinity;
  for (const waypoint of waypoints) {
    if (waypoint.col === null || waypoint.km === null || lineOf(breaks, waypoint.col) !== line) continue;
    const distance = Math.abs(km[col] - waypoint.km);
    if (distance < off) {
      nearest = waypoint;
      off = distance;
    }
  }
  if (!nearest) return null;
  const signed = km[col] - (nearest.km ?? 0);
  const said = nearest.col === col || kmWords(off) === '0' ? `at ${nearest.label}` : `${nearest.label}${signed < 0 ? '−' : '+'}${kmWords(off)} km`;
  return breaks.length > 0 ? `line ${line + 1}, ${said}` : said;
}

// A response's cells, or why not: a path as its section, and anything else as readCells reads it. A path at one level
// or none is a line, not cells on a plane: Figures and the Table say what it holds
export function readResponseCells(json: unknown, { drawAnyway = false, url }: { drawAnyway?: boolean; url?: string } = {}): CellsReading {
  const section = toSection(json, url);
  if (section === null) return readCells(json, { drawAnyway });
  // The pane says why already, from the same reading
  if (section.kind === 'cant') return cant(section.reason, 'other-view');
  if (section.kind === 'line') return cant('A path at one level is a line along it', 'other-view');
  // Cells and not values: a track sends a value per position, and draws a cell at every level of each
  const cells = section.frames.length * section.levels.length * section.colCount * section.parameters.length;
  if (!drawAnyway && cells > MOST_VALUES_DRAWN) return cant(`${count(cells)} cells is more than this draws by itself`, 'too-large');
  // A reader that throws is a bug in it, and is said to be: a response mustn't take the page down with it
  try {
    return sectionCells(section, json);
  } catch (error) {
    console.error('sectionCells failed on this response:', error);
    return cant(`This response couldn't be read: ${error instanceof Error ? error.message : String(error)}`, 'cant');
  }
}
