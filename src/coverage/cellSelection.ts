import { analyse, type CellFigures } from './cellFigures';
import { ABOVE_CODE, ABSENT_CODE, BELOW_CODE, NULL_CODE, TEXT_CODE, encode, type RampKind } from './colourScale';
import { pointerPart, stepsOfSlice, type CellGeometry, type CellNote, type CellParameter, type DrawableCells, type StepAxis } from './coverageCells';
import { formatValue } from './coverageSummary';
import { fromWaypoint, kmWords } from './sectionCells';
import { withUnit } from './verticalAxis';
import { parseTime, utcMoment } from '../utils/utcTime';

// What the choices in the view come to: which values, in which colours. No DOM.

export type RangeMode = 'auto' | 'all' | 'set';
export type RangeScope = 'all' | 'this';
export type Flip = 'none' | 'ns' | 'ew';

// Before the first paint a step may be one from a response with more of them
export const stepOf = (dim: StepAxis, steps: Record<string, number>) => Math.max(0, Math.min(dim.values.length - 1, steps[dim.name] ?? 0));
export const sliceIndex = (dims: StepAxis[], steps: Record<string, number>) => dims.reduce((slice, dim) => slice * dim.values.length + stepOf(dim, steps), 0);

// Times share a scale, so a colour means the same in each. Levels don't by default: a temperature at 500 hPa and at
// 1000 hPa are 25 K apart, and one scale over both leaves each level flat
export const scopeOf = (cells: DrawableCells, scope: RangeScope | null): RangeScope => (cells.slices <= 1 ? 'all' : scope ?? (cells.dims.some(dim => dim.name === 'z') ? 'this' : 'all'));

const scoped = new WeakMap<CellParameter, Map<string, CellFigures>>();

export function figuresInScope(parameter: CellParameter, cells: DrawableCells, scope: RangeScope, steps: Record<string, number>): CellFigures {
  if (scope === 'all') return parameter.figures;
  const z = cells.dims.find(dim => dim.name === 'z');
  const key = z ? `z${stepOf(z, steps)}` : `s${sliceIndex(cells.dims, steps)}`;
  let known = scoped.get(parameter);
  if (!known) {
    known = new Map();
    scoped.set(parameter, known);
  }
  const cached = known.get(key);
  if (cached) return cached;
  const slices: number[] = [];
  if (z) {
    for (let slice = 0; slice < cells.slices; slice++) if (stepsOfSlice(cells.dims, slice).z === stepOf(z, steps)) slices.push(slice);
  } else {
    slices.push(sliceIndex(cells.dims, steps));
  }
  const values = new Float32Array(slices.length * cells.cells);
  slices.forEach((slice, i) => values.set(parameter.data.subarray(slice * cells.cells, (slice + 1) * cells.cells), i * cells.cells));
  // The marks for the same slices
  const marksOf = (all: Uint8Array | null | undefined) => {
    if (!all) return null;
    const marks = new Uint8Array(values.length);
    slices.forEach((slice, i) => marks.set(all.subarray(slice * cells.cells, (slice + 1) * cells.cells), i * cells.cells));
    return marks;
  };
  const figures = analyse(values, slices.length, cells.cells, marksOf(parameter.notNumberAt), marksOf(parameter.absentAt));
  known.set(key, figures);
  return figures;
}

export function colourRange(
  figures: CellFigures, range: RangeMode, setLo: number | null, setHi: number | null, ramp: RampKind,
): [number | null, number | null] {
  let lo = figures.lo;
  let hi = figures.hi;
  if (range === 'all') {
    lo = figures.min;
    hi = figures.max;
  }
  if (range === 'set' && setLo !== null && setHi !== null && setHi > setLo) {
    lo = setLo;
    hi = setHi;
  }
  if (ramp === 'diverging' && lo !== null && hi !== null) {
    const furthest = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -furthest;
    hi = furthest;
  }
  return [lo, hi];
}

// The array place a drawn cell comes from, when the picture is flipped to test a guess
export function sourceCell(geometry: CellGeometry, cell: number, flip: Flip): number {
  if (geometry.kind !== 'grid') return cell;
  const row = Math.floor(cell / geometry.nx);
  const col = cell - row * geometry.nx;
  return (flip === 'ns' ? geometry.ny - 1 - row : row) * geometry.nx + (flip === 'ew' ? geometry.nx - 1 - col : col);
}

export function codesFor(parameter: CellParameter, cells: DrawableCells, slice: number, lo: number | null, hi: number | null, flip: Flip): Uint16Array {
  const out = new Uint16Array(cells.cells);
  encode(parameter.data, slice * cells.cells, cells.cells, lo ?? 0, hi ?? 0, out);
  const { notNumberAt, absentAt } = parameter;
  const from = slice * cells.cells;
  if (notNumberAt) for (let i = 0; i < out.length; i++) if (notNumberAt[from + i]) out[i] = TEXT_CODE;
  if (absentAt) for (let i = 0; i < out.length; i++) if (absentAt[from + i]) out[i] = ABSENT_CODE;
  if (flip === 'none' || cells.geometry.kind !== 'grid') return out;
  const flipped = new Uint16Array(out.length);
  for (let i = 0; i < out.length; i++) flipped[i] = out[sourceCell(cells.geometry, i, flip)];
  return flipped;
}

export interface Tallies {
  bins: Uint32Array;
  nulls: number;
  notNumbers: number;
  below: number;
  above: number;
  // Nothing sent: in no bar, since it isn't a value
  absent: number;
}

// The legend's bars: a bar per 1/64th of the range, and one each for nulls, what isn't a number and what's outside it
export function tallies(codes: Uint16Array): Tallies {
  const bins = new Uint32Array(64);
  let nulls = 0;
  let notNumbers = 0;
  let below = 0;
  let above = 0;
  let absent = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code < 256) bins[code >> 2]++;
    else if (code === NULL_CODE) nulls++;
    else if (code === TEXT_CODE) notNumbers++;
    else if (code === BELOW_CODE) below++;
    else if (code === ABOVE_CODE) above++;
    else if (code === ABSENT_CODE) absent++;
  }
  return { bins, nulls, notNumbers, below, above, absent };
}

// How much of each step is there, whatever the other axes are set to, so a bad step shows before you reach it
export function stepKinds({ dims, slices }: DrawableCells, parameter: CellParameter, dim: StepAxis): ('' | 'some' | 'none')[] {
  const numbers = new Float64Array(dim.values.length);
  const gaps = new Float64Array(dim.values.length);
  for (let slice = 0; slice < slices; slice++) {
    const step = stepsOfSlice(dims, slice)[dim.name];
    numbers[step] += parameter.figures.perSlice[slice].numbers;
    // What isn't a number is as much a gap as a null
    gaps[step] += parameter.figures.perSlice[slice].nulls + parameter.figures.perSlice[slice].notNumbers;
  }
  return dim.values.map((_, step) => (numbers[step] === 0 ? 'none' : gaps[step] > 0 ? 'some' : ''));
}

export function stepLabel(cells: DrawableCells, dim: StepAxis, step: number): string {
  const value = dim.values[step];
  if (dim.name === 't') {
    const time = parseTime(value);
    return Number.isNaN(time) ? String(value) : utcMoment(time);
  }
  return `${String(value)}${dim.name === 'z' && cells.zUnit ? ` ${cells.zUnit}` : ''}`;
}

// The label as the step bar shows it
export const stepCaption = (cells: DrawableCells, dim: StepAxis, step: number) => `${stepLabel(cells, dim, step)} (${step + 1}/${dim.values.length})`;

// The longest of a step's captions, so that its bar keeps its width from one step to the next
export const longestStepCaption = (cells: DrawableCells, dim: StepAxis) => dim.values.reduce<number>((most, _, step) => Math.max(most, stepCaption(cells, dim, step).length), 0);

const longestOf = (values: ArrayLike<number>) => {
  let longest = '';
  for (let i = 0; i < values.length; i++) {
    const text = String(values[i]);
    if (text.length > longest.length) longest = text;
  }
  return longest;
};

// A double as long as JavaScript writes one
const LONGEST_NUMBER = '-1.7976931348623157e+308';

const longestText = (texts: Iterable<string>) => {
  let longest = '';
  for (const text of texts) if (text.length > longest.length) longest = text;
  return longest;
};

// Where a section's cell is, in words: km along the path, the level, and the nearest waypoint, then the position as
// sent, with its time if time runs along the path and the lowest beam if there is one. Its level, if that was asked for
// and not sent. Null for what isn't a section. It takes the cell the values are in, which a flipped picture reads
// through sourceCell
export function sectionPlace(cells: DrawableCells, dataCell: number, slice: number): { where: string; place: string; notBack: number | null } | null {
  const { section, geometry: g } = cells;
  if (!section || g.kind !== 'grid') return null;
  const { data } = section;
  const row = Math.floor(dataCell / g.nx);
  const col = dataCell - row * g.nx;
  const level = Number(data.levels[section.rowLevel[row]]);
  const unit = data.z?.unit ?? '';
  const levelText = withUnit(formatValue(level), unit);
  const along = fromWaypoint(data, col);
  // Without lon/lat there's no distance, only the position's number
  const where = data.crs.geographic ? [`${kmWords(data.km[col])} km`, levelText, ...(along ? [along] : [])].join(' · ') : `position ${col + 1} · ${levelText}`;
  const [x, y] = data.positions[col];
  const place = [data.crs.geographic ? `#${col + 1} at x ${x}, y ${y}` : `x ${x}, y ${y}`];
  const time = data.timeAlong?.[col];
  if (time !== undefined && Number.isFinite(time)) place.push(utcMoment(time));
  const floor = data.beamFloor?.values[slice]?.[col];
  if (floor !== undefined && Number.isFinite(floor)) place.push(`lowest beam ${withUnit(formatValue(floor), unit)}`);
  return { where, place: place.join(' · '), notBack: data.notBack.includes(level) ? level : null };
}

// What the readout says over a level asked for and not sent
export const notSentWords = (level: number | null) => `Not in the response${level === null ? '' : `: z=${level} was asked for`}`;

// A section's readout at its longest: the longest km, level and waypoint offset, the longest position, time and beam,
// and a path to the last value of the longest range in the last coverage
function longestSectionReadout(cells: DrawableCells, parameter: CellParameter) {
  const { data, mostValues } = cells.section!;
  const unit = data.z?.unit ?? '';
  const km = `${longestText(Array.from(data.km, kmWords))} km`;
  const level = longestText(data.levels.map(each => withUnit(formatValue(Number(each)), unit)));
  const label = longestText(data.waypoints.filter(waypoint => waypoint.km !== null).map(waypoint => waypoint.label));
  const along = label ? `${data.breaks.length > 0 ? `line ${data.breaks.length + 1}, ` : ''}${label}−${km}` : '';
  const where = data.crs.geographic ? [km, level, ...(along ? [along] : [])].join(' · ') : `position ${data.colCount} · ${level}`;
  const place = [`${data.crs.geographic ? `#${data.colCount} at ` : ''}x ${longestText(data.positions.map(([x]) => String(x)))}, y ${longestText(data.positions.map(([, y]) => String(y)))}`];
  if (data.timeAlong?.some(Number.isFinite)) place.push(longestText(data.timeAlong.filter(Number.isFinite).map(time => utcMoment(time))));
  const floors = data.beamFloor?.values.flatMap(values => Array.from(values).filter(Number.isFinite)) ?? [];
  if (floors.length) place.push(`lowest beam ${longestText(floors.map(floor => withUnit(formatValue(floor), unit)))}`);
  // Where the values are: under /coverages in a collection. The first cell sent says which
  let first: string | null = null;
  for (let i = 0; i < cells.slices * cells.cells && first === null; i++) first = parameter.rawAt(i % cells.cells, Math.floor(i / cells.cells)).pointer;
  const inCollection = first?.startsWith('/coverages/') ?? false;
  const number = `${LONGEST_NUMBER}${parameter.unit ? ` ${parameter.unit}` : ''}`;
  return {
    value: longestText([number, ...data.notBack.map(notSentWords)]),
    under: 'one of 999 under this pixel',
    where,
    place: place.join(' · '),
    pointer: `${inCollection ? `/coverages/${data.coverageCount - 1}` : ''}/ranges/${pointerPart(parameter.id)}/values/${Math.max(0, mostValues - 1)}`,
  };
}

// What the readout holds at its longest for this parameter, whichever cell is pointed at, so that the room for it can be
// kept and the readout doesn't change height as the pointer moves
export function longestReadout(cells: DrawableCells, parameter: CellParameter): { value: string; under: string; where: string; place: string | null; pointer: string } {
  if (cells.section && cells.geometry.kind === 'grid') return longestSectionReadout(cells, parameter);
  const { geometry: g, dims, slices, cells: count, coverageCount } = cells;
  const lengths: Record<string, number> = Object.fromEntries(dims.map(dim => [dim.name, dim.values.length]));
  let place: string;
  if (g.kind === 'grid') {
    lengths.x = g.nx;
    lengths.y = g.ny;
    place = `x ${longestOf(g.xs)}, y ${longestOf(g.ys)}`;
  } else if (g.kind === 'samples') {
    place = `x ${longestOf(g.xs)}, y ${longestOf(g.ys)}`;
  } else {
    lengths.composite = g.cells;
    place = 'about x -180.00000, y -90.00000';
  }
  lengths.coverage = coverageCount ?? 1;
  const names = g.kind === 'samples' || coverageCount ? ['coverage'] : parameter.indicesAt(0, 0).map(([name]) => name);
  const indices = names.map(name => `${name} ${(lengths[name] ?? 1) - 1}`).join(', ');
  const tail = `/ranges/${pointerPart(parameter.id)}/values/${(coverageCount ? slices : slices * count) - 1}`;
  return {
    value: `${LONGEST_NUMBER}${parameter.unit ? ` ${parameter.unit}` : ''}`,
    under: 'one of 999 under this pixel',
    where: `[${indices}] ${place}`,
    place: null,
    // A grid's or polygons' paths start where the coverage is, in a collection under /coverages/0
    pointer: coverageCount ? `/coverages/${coverageCount - 1}${tail}` : `${(parameter.rawAt(0, 0).pointer ?? '').split('/ranges/')[0]}${tail}`,
  };
}

// The notes for what's showing: this parameter's, and what's true of the whole response
export function notesFor(cells: DrawableCells, parameter: CellParameter, url: string): CellNote[] {
  const notes = cells.notes.filter(note => !note.parameter || note.parameter === parameter.id);
  const others = cells.parameters.filter(other => other.id !== parameter.id && other.figures.numbers === 0).map(other => other.id);
  if (others.length) {
    notes.push({
      level: 'warn',
      text: `${others.length === 1 ? '1 other parameter is' : `${others.length} other parameters are`} all null: ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}`,
    });
  }
  const noUnit = cells.parameters.filter(other => other.unit === '');
  if (noUnit.length === cells.parameters.length && noUnit.length > 1) notes.push({ level: 'info', text: `None of the ${noUnit.length} parameters has a unit` });
  else if (parameter.unit === '') notes.push({ level: 'info', text: `${parameter.id} has no unit` });
  // A time along a path is each position's, in the readout
  if (/[?&]datetime=/.test(url) && !('t' in cells.fixed) && !cells.dims.some(dim => dim.name === 't') && !cells.section?.data.timeAlong) {
    notes.push({ level: 'info', text: "You asked for a datetime, and the response has no t axis, so it doesn't say which time this is" });
  }
  return notes;
}

// The cells a section's Table has a row for at this step: those anything was sent for, position by position along the
// path and each position's levels from the lowest value up, as the path's own table had them. Cells the values are in,
// unflipped
export function sectionRowCells({ section, geometry: g, parameters, cells }: DrawableCells, slice: number): Uint32Array {
  if (!section || g.kind !== 'grid') return new Uint32Array(0);
  const rowOf = new Int32Array(g.ny);
  section.rowLevel.forEach((level, row) => {
    rowOf[level] = row;
  });
  const from = slice * cells;
  const out = new Uint32Array(cells);
  let n = 0;
  for (let col = 0; col < g.nx; col++) {
    for (let level = 0; level < g.ny; level++) {
      const cell = rowOf[level] * g.nx + col;
      if (parameters.some(parameter => !parameter.absentAt?.[from + cell])) out[n++] = cell;
    }
  }
  return out.slice(0, n);
}

// The cells in a parameter's order at this step, nulls last whichever way, for reaching the worst cells at once. Among
// those given, or all of them
export function sortedCells(parameter: CellParameter, cells: DrawableCells, slice: number, direction: 1 | -1, among?: Uint32Array): Uint32Array {
  const from = slice * cells.cells;
  const { data } = parameter;
  return (among ? Uint32Array.from(among) : Uint32Array.from({ length: cells.cells }, (_, i) => i)).sort((a, b) => {
    const first = data[from + a];
    const second = data[from + b];
    if (first !== first) return second !== second ? 0 : 1;
    if (second !== second) return -1;
    return direction * (first - second);
  });
}

// A time along a path as the path's own table writes it: UTC, to the second unless it has more
const isoTime = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

// A section's rows: the position's number, km where it's lon/lat, x and y as sent, the level and each value, with its
// time where time runs along the path. Each row's id is the cell drawn, so that clicking it pins what's seen
function sectionRows(cells: DrawableCells, from: number, to: number, order: Uint32Array, slice: number, flip: Flip): Record<string, unknown>[] {
  const { section, geometry: g } = cells;
  if (!section || g.kind !== 'grid') return [];
  const { data, rowLevel } = section;
  const rows: Record<string, unknown>[] = [];
  for (let i = from; i < Math.min(to, order.length); i++) {
    const cell = order[i];
    const row = Math.floor(cell / g.nx);
    const col = cell - row * g.nx;
    const out: Record<string, unknown> = { id: sourceCell(g, cell, flip), position: col + 1, x: data.positions[col][0], y: data.positions[col][1], z: data.levels[rowLevel[row]] };
    if (data.crs.geographic) out.km = Number(data.km[col].toFixed(2));
    if (data.timeAlong) out.time = Number.isFinite(data.timeAlong[col]) ? isoTime(data.timeAlong[col]) : '';
    cells.parameters.forEach((parameter, index) => {
      out[`p${index}`] = parameter.rawAt(cell, slice).value;
    });
    rows.push(out);
  }
  return rows;
}

// A table page's rows, in exact values: rows are built only for the page, so a million cells cost one page. A section
// has a row for each cell anything was sent for, in the order given or the path's own. An order is of the cells the
// values are in, as sortedCells gives it; without one, the rows go as drawn
export function cellRows(cells: DrawableCells, from: number, to: number, order: Uint32Array | null, slice: number, flip: Flip): Record<string, unknown>[] {
  if (cells.section) return sectionRows(cells, from, to, order ?? sectionRowCells(cells, slice), slice, flip);
  const g = cells.geometry;
  const end = Math.min(to, cells.cells);
  const rows: Record<string, unknown>[] = [];
  for (let i = from; i < end; i++) {
    // A flip is its own undoing, so the same mirror takes a drawn cell to its values and the values to where they're drawn
    const source = order ? order[i] : sourceCell(g, i, flip);
    const cell = order ? sourceCell(g, source, flip) : i;
    const row: Record<string, unknown> = { id: cell };
    if (g.kind === 'grid') {
      const at = Object.fromEntries(cells.parameters[0].indicesAt(source, slice));
      const gridRow = Math.floor(cell / g.nx);
      row.yi = at.y ?? gridRow;
      row.xi = at.x ?? cell - gridRow * g.nx;
      row.y = g.ys[gridRow];
      row.x = g.xs[cell - gridRow * g.nx];
    } else if (g.kind === 'samples') {
      row.coverage = cells.parameters[0].rawAt(cell, slice).coverage ?? '';
      row.x = g.xs[cell];
      row.y = g.ys[cell];
    } else {
      row.composite = cell;
    }
    cells.parameters.forEach((parameter, index) => {
      row[`p${index}`] = parameter.rawAt(source, slice).value;
    });
    rows.push(row);
  }
  return rows;
}

// The picture opens by itself for anything with at least 9 places or a real grid. Fewer series open on Chart
export const opensAsPicture = (cells: DrawableCells) => cells.geometry.kind !== 'samples' || cells.cells >= 9;

// The same cell asked for by /position, the general test for flips, offsets and axis order, since /position usually
// goes down a different path in the server. Null if the request wasn't for an area
export function positionUrl(url: string, cells: DrawableCells, parameter: CellParameter, cell: number, steps: Record<string, number>): string | null {
  const g = cells.geometry;
  // A section's cell is a place along a path: /position at it is another request, not a check of this one
  if (cells.section || g.kind === 'polygons' || !/\/(area|cube)(\?|$)/.test(url)) return null;
  const [path, query = ''] = url.split('?');
  const sent = new URLSearchParams(query);
  let x: number;
  let y: number;
  if (g.kind === 'grid') {
    const row = Math.floor(cell / g.nx);
    y = g.ys[row];
    x = g.xs[cell - row * g.nx];
  } else {
    x = g.xs[cell];
    y = g.ys[cell];
  }
  const valueOf = (name: string) => {
    const dim = cells.dims.find(axis => axis.name === name);
    return dim ? dim.values[stepOf(dim, steps)] : cells.fixed[name];
  };
  const parts = [`coords=${encodeURIComponent(`POINT(${x} ${y})`)}`];
  const time = valueOf('t') ?? sent.get('datetime');
  if (time) parts.push(`datetime=${encodeURIComponent(String(time))}`);
  const level = valueOf('z') ?? sent.get('z');
  if (level !== null && level !== undefined) parts.push(`z=${encodeURIComponent(String(level))}`);
  parts.push(`parameter-name=${encodeURIComponent(parameter.id)}`);
  for (const name of ['crs', 'f']) {
    const value = sent.get(name);
    if (value) parts.push(`${name}=${encodeURIComponent(value)}`);
  }
  return `${path.replace(/\/(area|cube)$/, '/position')}?${parts.join('&')}`;
}
