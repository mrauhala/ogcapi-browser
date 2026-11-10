import { analyse, shareText, type CellFigures, type SliceFigures } from './cellFigures';
import { formatValue } from './coverageSummary';
import { rangeMisfit } from './rangeFit';
import { parameterLabel, parameterUnit } from '../utils/coverageTimeSeries';
import { i18nText } from '../utils/i18nText';
import { NAMED } from './parameterChecks';
import { parseTime } from '../utils/utcTime';
import { COVJSON } from '../standards';
import type { Rule, ValidationError } from '../types/api';
import type { SectionPlane } from './sectionCells';

// A parsed CoverageJSON response in, what can be drawn out, or why not. It reads the response, and assumes nothing
// about it: real APIs answer an area or a cube with a Grid, with thousands of Point coverages, with stations or with
// triangles. No DOM.

type Json = Record<string, unknown>;

export interface CellCrs {
  declared: boolean;
  geographic: boolean;
  label: string;
  inDegrees?: boolean;
}

export interface GridGeometry {
  kind: 'grid';
  nx: number;
  ny: number;
  cells: number;
  // Left to right, top to bottom: north up and west left, whatever the array's order
  xs: number[];
  ys: number[];
  xEdges: Float64Array;
  // Top to bottom, in the display's y: Web Mercator's for lon/lat, in which a lon/lat grid stays rectilinear
  yEdges: Float64Array;
  assumedSize: boolean;
  fromPoints?: boolean;
}

export interface SamplesGeometry {
  kind: 'samples';
  cells: number;
  xs: Float64Array;
  ys: Float64Array;
  spacing: { km: number | null; regular: boolean };
}

export interface PolygonsGeometry {
  kind: 'polygons';
  cells: number;
  pts: Float64Array;
  offsets: Uint32Array;
  bbox: [number, number, number, number];
}

export type CellGeometry = GridGeometry | SamplesGeometry | PolygonsGeometry;

export interface StepAxis {
  name: string;
  values: unknown[];
}

export interface CellRaw {
  value: unknown;
  index: number | null;
  pointer: string | null;
  coverage: number | null;
  absent?: boolean;
}

interface ParameterBase {
  id: string;
  label: string | null;
  unit: string;
  // Where the response defines it, for a finding about its unit
  definedAt: string;
}

export interface CellParameter extends ParameterBase {
  // Per step, per cell, in the geometry's order. NaN for what isn't a number
  data: Float32Array;
  figures: CellFigures;
  // The cells whose NaN is a value that isn't a number, or null if there's none. Text, if every one is a string
  notNumberAt: Uint8Array | null;
  notNumbersAreText: boolean;
  // The cells nothing was sent for, as a level asked for and not sent, or a track's other levels. Null or left out if
  // there are none
  absentAt?: Uint8Array | null;
  rawAt: (cell: number, slice: number) => CellRaw;
  indicesAt: (cell: number, slice: number) => [string, number][];
}

export interface BrokenParameter extends ParameterBase {
  problem: string;
}

export interface CellNote {
  level: 'info' | 'warn' | 'error';
  text: string;
  parameter?: string;
  // How Checks counts it, if it's about the response and not about how it's drawn: a guess or a fact is a note, what
  // the server should fix an issue, and a rule broken an error
  checks?: 'info' | 'warning' | 'error';
  // Where it is: a path, or else its parameter's first such value, by its place in the data, or its unit
  path?: string;
  at?: number | 'unit';
  rule?: Rule | readonly Rule[];
}

export interface DrawableCells {
  drawable: true;
  source: 'grid' | 'points' | 'points-grid' | 'polygons' | 'section';
  viewLabel: 'Grid' | 'Points' | 'Cells' | 'Section';
  domainType: string;
  geometry: CellGeometry;
  dims: StepAxis[];
  fixed: Record<string, unknown>;
  slices: number;
  cells: number;
  // A section's plane is distance along the path by level, so it isn't lon/lat whatever the path's CRS: its geographic
  // is false, which keeps it off the map, and the path's own CRS is in section.data.crs
  crs: CellCrs;
  parameters: CellParameter[];
  broken: BrokenParameter[];
  notes: CellNote[];
  // Where values[0] is
  order: { firstX: 'left' | 'right'; firstY: 'top' | 'bottom' } | null;
  zUnit: string;
  // The coverages it was put together from, if there were several
  coverageCount: number | null;
  // Only for source 'section': the path behind the plane, and how its levels are laid out
  section?: SectionPlane;
}

export interface UndrawableCells {
  drawable: false;
  reason: string;
  // 'other-view': it's a line or a place, not cells on a plane. 'too-large': it can be drawn if asked for
  why: 'cant' | 'other-view' | 'too-large';
}

export type CellsReading = DrawableCells | UndrawableCells;

const isObj = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;
export const pointerPart = (text: string) => text.replace(/~/g, '~0').replace(/\//g, '~1');
const cant = (reason: string, why: UndrawableCells['why'] = 'cant'): UndrawableCells => ({ drawable: false, reason, why });

// ---- Axes ----------------------------------------------------------------------------------

// The most values an axis given by start, stop and num is taken to have. More is no axis: no response can fill it
export const MOST_AXIS_VALUES = 10_000_000;
const countable = (num: unknown): num is number => isNum(num) && Number.isInteger(num) && num >= 1 && num <= MOST_AXIS_VALUES;

export function axisValues(axis: unknown): unknown[] | null {
  if (!isObj(axis)) return null;
  if (Array.isArray(axis.values)) return axis.values;
  const { start, stop, num } = axis;
  if (isNum(start) && isNum(stop) && countable(num)) {
    const out = new Array<number>(num);
    const step = num > 1 ? (stop - start) / (num - 1) : 0;
    for (let i = 0; i < num; i++) out[i] = start + i * step;
    return out;
  }
  return null;
}

// Why an axis given by start, stop and num has no values, if that's how it's given
export function axisFault(name: string, axis: unknown): string | null {
  if (!isObj(axis) || Array.isArray(axis.values) || !('num' in axis)) return null;
  const { start, stop, num } = axis;
  if (!isNum(num) || !Number.isInteger(num) || num < 1) return `${name} has num: ${JSON.stringify(num)}, which isn't a whole number of values`;
  if (num > MOST_AXIS_VALUES) return `${name} has num: ${num}, more values than a response could hold`;
  if (!isNum(start) || !isNum(stop)) return `${name} has num, but its start and stop aren't both numbers`;
  return null;
}

function runsOneWay(values: number[]): boolean {
  if (values.length < 2) return true;
  const up = values[1] > values[0];
  for (let i = 1; i < values.length; i++) if (up ? !(values[i] > values[i - 1]) : !(values[i] < values[i - 1])) return false;
  return true;
}

// Cell edges: half way between centres, half a step beyond the ends. With one value there's no step
function edgesOf(ascending: number[], fallbackStep: number): Float64Array {
  const n = ascending.length;
  const edges = new Float64Array(n + 1);
  if (n === 1) {
    edges[0] = ascending[0] - fallbackStep / 2;
    edges[1] = ascending[0] + fallbackStep / 2;
    return edges;
  }
  for (let i = 1; i < n; i++) edges[i] = (ascending[i - 1] + ascending[i]) / 2;
  edges[0] = ascending[0] - (ascending[1] - ascending[0]) / 2;
  edges[n] = ascending[n - 1] + (ascending[n - 1] - ascending[n - 2]) / 2;
  return edges;
}

// An axis can give each cell's edges itself, in bounds: [from, to, from, to, ...]. DMI does for a cell of its own.
// Used when they meet end to end, which a picture needs, and otherwise the edges are worked out as usual
function boundsEdges(axis: unknown, order: ArrayLike<number>, n: number): Float64Array | null {
  const bounds = isObj(axis) ? axis.bounds : null;
  if (!Array.isArray(bounds) || bounds.length !== n * 2 || !bounds.every(isNum)) return null;
  const numbers = bounds as number[];
  const lows: number[] = [];
  const highs: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = numbers[order[k] * 2];
    const b = numbers[order[k] * 2 + 1];
    lows.push(Math.min(a, b));
    highs.push(Math.max(a, b));
  }
  for (let k = 1; k < n; k++) if (Math.abs(lows[k] - highs[k - 1]) > (highs[n - 1] - lows[0]) * 1e-6) return null;
  return Float64Array.from([...lows, highs[n - 1]]);
}

// How even an axis is: its step's spread, and how far it strays from a straight line, in cells
export function axisDrift(values: number[]) {
  if (values.length < 3) return null;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < values.length; i++) {
    const distance = Math.abs(values[i] - values[i - 1]);
    if (distance < min) min = distance;
    if (distance > max) max = distance;
  }
  const step = (values[values.length - 1] - values[0]) / (values.length - 1);
  let strayed = 0;
  for (let i = 0; i < values.length; i++) strayed = Math.max(strayed, Math.abs(values[i] - (values[0] + step * i)));
  return { min, max, spread: (max - min) / Math.abs(step), strayCells: strayed / Math.abs(step) };
}

// Web Mercator's y, the map's own, in degrees: a lon/lat grid stays rectilinear in it, so the pane and the map agree
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.06, Math.min(85.06, lat)) * Math.PI) / 360)) * (180 / Math.PI);
export const invMercY = (y: number) => (Math.atan(Math.exp((y * Math.PI) / 180)) * 360) / Math.PI - 90;

// xName: what the response calls x, if not x
export function crsOf(referencing: unknown, xs: number[], ys: number[], xName = 'x'): CellCrs {
  const entry = Array.isArray(referencing)
    ? (referencing as unknown[]).find(item => isObj(item) && Array.isArray(item.coordinates) && item.coordinates.includes(xName)) as Json | undefined
    : undefined;
  const system = entry && isObj(entry.system) ? entry.system : null;
  const id = system && typeof system.id === 'string' ? system.id : null;
  const inDegrees = xs.every(v => v >= -360 && v <= 360) && ys.every(v => v >= -90 && v <= 90);
  if (!system) return { declared: false, geographic: inDegrees, label: 'not declared' };
  const geographic = system.type === 'GeographicCRS' || /CRS84|4326|WGS ?84/i.test(id ?? '');
  const label = id ? id.replace(/^.*\/def\/crs\//, '').replace(/\/0\//, ':').replace('OGC/1.3/', '') : String(system.type ?? 'unnamed');
  return { declared: true, geographic, label, inDegrees };
}

function zUnitOf(referencing: unknown, zName = 'z'): string {
  const entry = Array.isArray(referencing)
    ? (referencing as unknown[]).find(item => isObj(item) && Array.isArray(item.coordinates) && item.coordinates.includes(zName)) as Json | undefined
    : undefined;
  const system = entry && isObj(entry.system) ? entry.system : null;
  const cs = system && isObj(system.cs) ? system.cs : null;
  const axis = cs && Array.isArray(cs.csAxes) && isObj(cs.csAxes[0]) ? cs.csAxes[0] : null;
  const unit = axis && isObj(axis.unit) ? axis.unit.symbol : null;
  if (typeof unit === 'string') return unit;
  if (isObj(unit) && typeof unit.value === 'string') return unit.value;
  const description = i18nText(system?.description);
  const said = description === undefined ? null : /in\s+(\S+)$/.exec(description);
  return said ? said[1] : '';
}

// ---- A range, read through its own axis order -------------------------------------------------

// The values, if they're in the range itself
const inlineValues = (range: unknown): unknown[] | null =>
  isObj(range) && range.type !== 'TiledNdArray' && !Array.isArray(range.tileSets) && Array.isArray(range.values) ? range.values : null;

// Says why a range can't be read as these axes, in numbers an API developer can check
function rangeProblem(id: string, range: unknown, axisLen: Record<string, number>): string | null {
  if (typeof range === 'string') return `${id}: its values are at a link, not in this response`;
  if (!isObj(range)) return `${id}: its range isn't an object`;
  if (range.type === 'TiledNdArray' || Array.isArray(range.tileSets)) return `${id}: a TiledNdArray keeps its values in tiles, which would take more requests`;
  if (!Array.isArray(range.values)) return `${id}: its range has no values array`;
  return rangeMisfit(id, range, axisLen)?.message ?? null;
}

// How many values along each named axis one step moves in a flat values array
function stridesOf(range: Json, fallbackOrder: string[], axisLen: Record<string, number>): Record<string, number> {
  const names = Array.isArray(range.axisNames)
    ? (range.axisNames as string[])
    : fallbackOrder.filter(name => axisLen[name] > 1 || fallbackOrder.length === 1);
  const shape = Array.isArray(range.shape) ? (range.shape as number[]) : names.map(name => axisLen[name]);
  const strides: Record<string, number> = {};
  let stride = 1;
  for (let i = names.length - 1; i >= 0; i--) {
    strides[names[i]] = stride;
    stride *= shape[i];
  }
  return strides;
}

function sliceOffsets(dims: StepAxis[], strides: Record<string, number>): Int32Array {
  const total = dims.reduce((a, dim) => a * dim.values.length, 1);
  const out = new Int32Array(total);
  for (let slice = 0; slice < total; slice++) {
    let rest = slice;
    let offset = 0;
    for (let d = dims.length - 1; d >= 0; d--) {
      const length = dims[d].values.length;
      offset += (rest % length) * (strides[dims[d].name] ?? 0);
      rest = Math.floor(rest / length);
    }
    out[slice] = offset;
  }
  return out;
}

// Where a slice is along each axis
export function stepsOfSlice(dims: StepAxis[], slice: number): Record<string, number> {
  const steps: Record<string, number> = {};
  let rest = slice;
  for (let d = dims.length - 1; d >= 0; d--) {
    const length = dims[d].values.length;
    steps[dims[d].name] = rest % length;
    rest = Math.floor(rest / length);
  }
  return steps;
}

// ---- Parameters -------------------------------------------------------------------------------

function parameterBase(id: string, definition: unknown, definedAt = `/parameters/${pointerPart(id)}`): ParameterBase {
  const def = isObj(definition) ? definition : undefined;
  const label = parameterLabel(id, def as Parameters<typeof parameterLabel>[1]);
  return { id, label: label === id ? null : label, unit: parameterUnit(def as Parameters<typeof parameterUnit>[0]), definedAt };
}

// A coverage's own definition of a parameter comes before the collection's
const definedIn = (coverage: Json, id: string, prefix: string) =>
  `${isObj(coverage.parameters) && coverage.parameters[id] !== undefined ? prefix : ''}/parameters/${pointerPart(id)}`;

// What the picture found that Checks should say too, each with where it is in the response
export function cellFindings(reading: CellsReading | null): ValidationError[] {
  if (!reading?.drawable) return [];
  return reading.notes.flatMap(note => {
    if (!note.checks) return [];
    const parameter = note.parameter === undefined ? undefined : reading.parameters.find(each => each.id === note.parameter);
    const path = note.path
      ?? (parameter && note.at === 'unit' ? `${parameter.definedAt}/unit`
        : parameter && typeof note.at === 'number' ? parameter.rawAt(note.at % reading.cells, Math.floor(note.at / reading.cells)).pointer ?? undefined
          : undefined);
    return [{ message: note.text, severity: note.checks, ...(path ? { path } : {}), ...(note.rule ? { rule: note.rule } : {}) }];
  });
}

// ---- Reading a response ---------------------------------------------------------------------

const NOT_A_PLANE = /trajectory|verticalprofile|section|corridor/i;
const ONE_PLACE = /^(point|pointseries|polygon|polygonseries)$/i;
// More than this isn't drawn until it's asked for
export const MOST_VALUES_DRAWN = 5000000;

function valuesIn(coverages: Json[]): number {
  let total = 0;
  for (const coverage of coverages) {
    if (!isObj(coverage.ranges)) continue;
    for (const range of Object.values(coverage.ranges)) if (isObj(range) && Array.isArray(range.values)) total += range.values.length;
  }
  return total;
}

// A response's cells, or why they can't be drawn. A reader that throws is a bug in it, and is said to be: a response
// mustn't take the page down with it, since this runs above every error boundary
export function readCells(json: unknown, options: { drawAnyway?: boolean } = {}): CellsReading {
  try {
    return readCellsOf(json, options);
  } catch (error) {
    console.error('readCells failed on this response:', error);
    return cant(`This response couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readCellsOf(json: unknown, { drawAnyway = false }: { drawAnyway?: boolean }): CellsReading {
  if (!isObj(json)) return cant('This response is not a coverage', 'other-view');
  const isCollection = json.type === 'CoverageCollection' && Array.isArray(json.coverages);
  if (json.type !== 'Coverage' && !isCollection) return cant('This response is not a coverage', 'other-view');
  const coverages = isCollection ? (json.coverages as unknown[]).filter(isObj) : [json];
  if (coverages.length === 0) return cant('The collection has no coverages', 'other-view');
  const paramDefs = isObj(json.parameters) ? json.parameters : {};
  const topRef = json.referencing;

  const first = coverages[0];
  if (!isObj(first.domain)) return cant(typeof first.domain === 'string' ? 'The domain is at a link, not in this response' : 'The coverage has no domain');
  const type = String(first.domain.domainType ?? json.domainType ?? '');
  if (NOT_A_PLANE.test(type)) return cant(`A ${type} is a line through the data, not cells on a plane`, 'other-view');
  if (!drawAnyway) {
    const values = valuesIn(coverages);
    if (values > MOST_VALUES_DRAWN) return cant(`${count(values)} values is more than this draws by itself`, 'too-large');
  }
  const axes = isObj(first.domain.axes) ? first.domain.axes : {};
  if (isObj(axes.composite)) {
    const values = Array.isArray(axes.composite.values) ? axes.composite.values : [];
    const looksPolygon = Array.isArray(values[0]) && Array.isArray(values[0][0]) && Array.isArray(values[0][0][0]);
    if (coverages.length === 1 && looksPolygon) {
      // One polygon is one place, which a chart says better. DWD answers a position with one
      return values.length > 1 ? readPolygons(first, type, paramDefs, topRef, isCollection ? '/coverages/0' : '') : cant(`A ${type || 'polygon'} of one polygon is one place`, 'other-view');
    }
    const coordinates = axes.composite.coordinates;
    const roles = compositeRoles(coordinates);
    if (coverages.length === 1 && roles) return readMultiPoint(first, type, paramDefs, topRef, roles, isCollection ? '/coverages/0' : '');
    return cant(`A composite axis of ${Array.isArray(coordinates) ? coordinates.join(', ') : 'unknown coordinates'} isn't cells on a plane`, 'other-view');
  }

  const lengthOf = (coverage: Json, name: string) => axisValues(isObj(coverage.domain) && isObj(coverage.domain.axes) ? coverage.domain.axes[name] : null)?.length ?? 0;
  const allPoints = coverages.every(coverage => isObj(coverage.domain) && lengthOf(coverage, 'x') === 1 && lengthOf(coverage, 'y') === 1);
  if (coverages.length > 1) {
    if (allPoints) return readPoints(coverages, type, paramDefs, topRef);
    return cant(`${plural(coverages.length, 'coverage')} with axes of their own aren't drawn as one picture`);
  }
  // One place is a chart's, not a picture's, whatever it's called: DMI answers a position with a Grid of one cell, over time.
  // The axes decide, not the name: a PointSeries with two x is two places
  if (ONE_PLACE.test(type) && lengthOf(first, 'x') <= 1 && lengthOf(first, 'y') <= 1) return cant(`A ${type} is one place`, 'other-view');
  if (lengthOf(first, 'x') === 1 && lengthOf(first, 'y') === 1 && Object.keys(axes).some(name => name !== 'x' && name !== 'y' && lengthOf(first, name) > 1)) {
    return cant('One cell with steps of its own is one place', 'other-view');
  }
  return readGrid(first, type, paramDefs, topRef, isCollection ? '/coverages/0' : '');
}

// A count's word for what isn't a number: "5 text", "2 not a number"
export const notNumberWord = (parameter: Pick<CellParameter, 'notNumbersAreText'>) => (parameter.notNumbersAreText ? 'text' : 'not a number');

// "5 values are text", "1 value isn't a number"
export function notNumbersText(count: number, text: boolean): string {
  const verb = count === 1 ? (text ? 'is text' : "isn't a number") : text ? 'are text' : "aren't numbers";
  return `${plural(count, 'value')} ${verb}`;
}

// What every reader ends with: its figures, and the cells whose value is there but isn't a number, read from what each
// cell holds, so that text isn't counted as a null
function finished(parameter: Omit<CellParameter, 'figures' | 'notNumberAt' | 'notNumbersAreText'>, slices: number, cells: number): CellParameter {
  const { data, rawAt } = parameter;
  let notNumberAt: Uint8Array | null = null;
  let text = true;
  for (let slice = 0; slice < slices; slice++) {
    for (let cell = 0; cell < cells; cell++) {
      const at = slice * cells + cell;
      if (data[at] === data[at]) continue;
      const { value } = rawAt(cell, slice);
      if (value === null || value === undefined) continue;
      (notNumberAt ??= new Uint8Array(data.length))[at] = 1;
      if (typeof value !== 'string') text = false;
    }
  }
  return { ...parameter, notNumberAt, notNumbersAreText: notNumberAt !== null && text, figures: analyse(data, slices, cells, notNumberAt) };
}

function stepAxes(names: string[], axes: Json) {
  const dims: StepAxis[] = [];
  const fixed: Record<string, unknown> = {};
  for (const name of names) {
    const values = axisValues(axes[name]);
    if (!values) continue;
    if (values.length > 1) dims.push({ name, values });
    else if (values.length === 1) [fixed[name]] = values;
  }
  return { dims, fixed };
}

function readGrid(coverage: Json, type: string, paramDefs: Json, topRef: unknown, prefix: string): CellsReading {
  const domain = coverage.domain as Json;
  const axes = isObj(domain.axes) ? domain.axes : {};
  const xRaw = axisValues(axes.x);
  const yRaw = axisValues(axes.y);
  if (!xRaw || !yRaw) {
    const name = !xRaw ? 'x' : 'y';
    return cant(axisFault(name, axes[name]) ?? `The domain has no ${name} axis to draw along: its axes are ${Object.keys(axes).join(', ') || 'missing'}`);
  }
  if (!xRaw.every(isNum) || !yRaw.every(isNum)) return cant(`The ${!xRaw.every(isNum) ? 'x' : 'y'} axis has values that aren't numbers`);
  const xv = xRaw as number[];
  const yv = yRaw as number[];
  if (!runsOneWay(xv) || !runsOneWay(yv)) return cant(`The ${!runsOneWay(xv) ? 'x' : 'y'} axis doesn't run in one direction, so its cells have no edges`);
  const nx = xv.length;
  const ny = yv.length;
  const axisLen: Record<string, number> = {};
  for (const name of Object.keys(axes)) axisLen[name] = axisValues(axes[name])?.length ?? 0;
  const others = Object.keys(axes).filter(name => name !== 'x' && name !== 'y');
  const { dims, fixed } = stepAxes(others, axes);
  const slices = dims.reduce((a, dim) => a * dim.values.length, 1);
  const cells = nx * ny;

  const ascendingX = xv[nx - 1] >= xv[0];
  const northFirst = yv[ny - 1] <= yv[0];
  const colAxis = Int32Array.from({ length: nx }, (_, i) => (ascendingX ? i : nx - 1 - i));
  const rowAxis = Int32Array.from({ length: ny }, (_, i) => (northFirst ? i : ny - 1 - i));
  const xs = Array.from(colAxis, i => xv[i]);
  const ysAscending = Array.from(rowAxis, i => yv[i]).reverse();

  const refs = domain.referencing ?? topRef;
  const crs = crsOf(refs, xv, yv);
  const stepX = nx > 1 ? Math.abs(xs[1] - xs[0]) : null;
  const stepY = ny > 1 ? Math.abs(ysAscending[1] - ysAscending[0]) : null;
  const xBounds = boundsEdges(axes.x, colAxis, nx);
  const yBounds = boundsEdges(axes.y, Array.from(rowAxis).reverse(), ny);
  const xEdges = xBounds ?? edgesOf(xs, stepY ?? 1);
  const yEdgesAscending = yBounds ?? edgesOf(ysAscending, stepX ?? 1);
  const project = crs.geographic ? mercY : (value: number) => value;

  const geometry: GridGeometry = {
    kind: 'grid', nx, ny, cells, xs, ys: ysAscending.slice().reverse(), xEdges,
    yEdges: Float64Array.from(yEdgesAscending, project).reverse(),
    assumedSize: (nx === 1 && !xBounds) || (ny === 1 && !yBounds),
  };

  const parameters: CellParameter[] = [];
  const broken: BrokenParameter[] = [];
  const definitions = { ...paramDefs, ...(isObj(coverage.parameters) ? coverage.parameters : {}) };
  const ranges = isObj(coverage.ranges) ? coverage.ranges : {};
  for (const [id, range] of Object.entries(ranges)) {
    const base = parameterBase(id, definitions[id], definedIn(coverage, id, prefix));
    const problem = rangeProblem(id, range, axisLen);
    if (problem) {
      broken.push({ ...base, problem });
      continue;
    }
    const theRange = range as Json;
    // rangeProblem has seen to it that x and y are in axisNames if they have more than one value
    const strides = stridesOf(theRange, Object.keys(axes), axisLen);
    const strideX = strides.x ?? 0;
    const strideY = strides.y ?? 0;
    const data = new Float32Array(slices * cells);
    const values = theRange.values as unknown[];
    const rowOffsets = Int32Array.from(rowAxis, row => row * strideY);
    const colOffsets = Int32Array.from(colAxis, col => col * strideX);
    const offsets = sliceOffsets(dims, strides);
    for (let slice = 0; slice < slices; slice++) {
      const sliceOffset = offsets[slice];
      let at = slice * cells;
      for (let row = 0; row < ny; row++) {
        const rowOffset = sliceOffset + rowOffsets[row];
        for (let col = 0; col < nx; col++) {
          const value = values[rowOffset + colOffsets[col]];
          data[at++] = typeof value === 'number' ? value : NaN;
        }
      }
    }
    parameters.push(finished({
      ...base,
      data,
      rawAt(cell, slice) {
        const row = Math.floor(cell / nx);
        const col = cell - row * nx;
        const index = offsets[slice] + rowOffsets[row] + colOffsets[col];
        return { value: values[index], index, pointer: `${prefix}/ranges/${pointerPart(id)}/values/${index}`, coverage: null };
      },
      indicesAt(cell, slice) {
        const row = Math.floor(cell / nx);
        const col = cell - row * nx;
        const at: Record<string, number> = { y: rowAxis[row], x: colAxis[col], ...stepsOfSlice(dims, slice) };
        const names = Array.isArray(theRange.axisNames) ? (theRange.axisNames as string[]) : Object.keys(at);
        return names.filter(name => at[name] !== undefined || fixed[name] !== undefined).map(name => [name, at[name] ?? 0]);
      },
    }, slices, cells));
  }
  if (parameters.length === 0) return cant(broken[0]?.problem ?? 'The coverage has no ranges');
  const referencingAt = domain.referencing !== undefined ? `${prefix}/domain/referencing` : topRef !== undefined ? '/referencing' : `${prefix}/domain`;
  const notes = gridNotes({ xv, yv, crs, nx: nx === 1 && xBounds ? 2 : nx, ny: ny === 1 && yBounds ? 2 : ny, parameters, broken, prefix, referencingAt });
  return {
    drawable: true, source: 'grid', viewLabel: 'Grid', domainType: type || 'Coverage', geometry, dims, fixed, slices, cells, crs,
    parameters, broken, notes, order: { firstX: ascendingX ? 'left' : 'right', firstY: northFirst ? 'top' : 'bottom' },
    zUnit: zUnitOf(refs), coverageCount: null,
  };
}

// ---- Points: FMI's answer to area and cube ------------------------------------------------------

// How the points came, for the notes, and what the response calls x and z
interface PointsSent {
  // "66 points on a composite axis"
  as: string;
  // Where the kth point is in the response
  placeAt: (k: number) => string;
  each: 'coverage' | 'point';
  xName: string;
  zName: string;
}

function readPoints(coverages: Json[], type: string, paramDefs: Json, topRef: unknown, sent?: PointsSent): CellsReading {
  const axesOf = (coverage: Json) => (coverage.domain as Json).axes as Json;
  const places = new Map<string, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const times = new Set<unknown>();
  const levels = new Set<unknown>();
  for (const coverage of coverages) {
    const axes = axesOf(coverage);
    const x = axisValues(axes.x)?.[0];
    const y = axisValues(axes.y)?.[0];
    if (!isNum(x) || !isNum(y)) return cant("A point's x or y isn't a number");
    const key = `${x},${y}`;
    if (!places.has(key)) {
      places.set(key, xs.length);
      xs.push(x);
      ys.push(y);
    }
    for (const time of axisValues(axes.t) ?? []) times.add(time);
    for (const level of axisValues(axes.z) ?? []) levels.add(level);
  }
  const n = xs.length;
  const ts = [...times].sort((a, b) => parseTime(a) - parseTime(b));
  const zs = [...levels].sort((a, b) => Number(b) - Number(a));
  const timeIndex = new Map(ts.map((time, i) => [time, i]));
  const levelIndex = new Map(zs.map((level, i) => [level, i]));
  const dims: StepAxis[] = [];
  const fixed: Record<string, unknown> = {};
  if (ts.length > 1) dims.push({ name: 't', values: ts });
  else if (ts.length === 1) [fixed.t] = ts;
  if (zs.length > 1) dims.push({ name: 'z', values: zs });
  else if (zs.length === 1) [fixed.z] = zs;
  const tLength = Math.max(ts.length, 1);
  const zLength = Math.max(zs.length, 1);
  const slices = tLength * zLength;
  const refs = (coverages[0].domain as Json).referencing ?? topRef;
  const crs = crsOf(refs, xs, ys, sent?.xName);

  // A complete lattice on lon/lat lines is a Grid sent the long way round
  const distinctX = [...new Set(xs)].sort((a, b) => a - b);
  const distinctY = [...new Set(ys)].sort((a, b) => a - b);
  const product = distinctX.length * distinctY.length;
  const isLattice = distinctX.length > 1 && distinctY.length > 1 && n >= 4 && n / product >= 0.5 && n >= Math.max(distinctX.length, distinctY.length) * 1.5;

  let geometry: GridGeometry | SamplesGeometry;
  let cellOfPlace: number[];
  let cells: number;
  if (isLattice) {
    const column = new Map(distinctX.map((value, i) => [value, i]));
    const rowY = distinctY.slice().reverse();
    const row = new Map(rowY.map((value, i) => [value, i]));
    cells = product;
    cellOfPlace = xs.map((x, i) => row.get(ys[i])! * distinctX.length + column.get(x)!);
    const project = crs.geographic ? mercY : (value: number) => value;
    geometry = {
      kind: 'grid', nx: distinctX.length, ny: distinctY.length, cells, xs: distinctX, ys: rowY,
      xEdges: edgesOf(distinctX, 1),
      yEdges: Float64Array.from(edgesOf(distinctY, 1), project).reverse(),
      assumedSize: false, fromPoints: true,
    };
  } else {
    cells = n;
    cellOfPlace = xs.map((_, i) => i);
    geometry = { kind: 'samples', cells: n, xs: Float64Array.from(xs), ys: Float64Array.from(ys), spacing: spacingOf(xs, ys) };
  }

  // Where each coverage's values land. A place and time can come twice: fmi-obs sends every station in two records,
  // each with the other's nulls, so a number beats a null, per parameter, and the repeats are counted
  const placed = coverages.map(coverage => {
    const axes = axesOf(coverage);
    const x = axisValues(axes.x)![0];
    const y = axisValues(axes.y)![0];
    const cell = cellOfPlace[places.get(`${x},${y}`)!];
    const theirTimes = axisValues(axes.t) ?? [null];
    const theirLevels = axisValues(axes.z) ?? [null];
    const spots: number[] = [];
    for (let t = 0; t < theirTimes.length; t++) {
      for (let z = 0; z < theirLevels.length; z++) {
        const atTime = theirTimes[t] === null ? 0 : timeIndex.get(theirTimes[t])!;
        const atLevel = theirLevels[z] === null ? 0 : levelIndex.get(theirLevels[z])!;
        spots.push((atTime * zLength + atLevel) * cells + cell, t * theirLevels.length + z);
      }
    }
    return spots;
  });
  const taken = new Uint8Array(slices * cells);
  let repeats = 0;
  let firstRepeat = -1;
  placed.forEach((spots, k) => {
    let again = false;
    for (let i = 0; i < spots.length; i += 2) {
      if (taken[spots[i]]) again = true;
      taken[spots[i]] = 1;
    }
    if (!again) return;
    repeats++;
    if (firstRepeat < 0) firstRepeat = k;
  });

  const rangeOf = (coverage: Json, id: string) => {
    const range = isObj(coverage.ranges) ? coverage.ranges[id] : null;
    return isObj(range) && Array.isArray(range.values) ? (range.values as unknown[]) : null;
  };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const coverage of coverages) {
    for (const id of isObj(coverage.ranges) ? Object.keys(coverage.ranges) : []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  const parameters: CellParameter[] = [];
  let disagree = 0;
  for (const id of ids) {
    const data = new Float32Array(slices * cells).fill(NaN);
    const owner = new Int32Array(slices * cells).fill(-1);
    const ownerAt = new Int32Array(slices * cells).fill(-1);
    coverages.forEach((coverage, k) => {
      const values = rangeOf(coverage, id);
      if (!values) return;
      const spots = placed[k];
      for (let i = 0; i < spots.length; i += 2) {
        const at = spots[i];
        const index = spots[i + 1];
        const value = values[index];
        if (typeof value === 'number') {
          if (data[at] === data[at]) {
            if (data[at] !== Math.fround(value)) disagree++;
            continue;
          }
          data[at] = value;
          owner[at] = k;
          ownerAt[at] = index;
        } else {
          if (owner[at] < 0) {
            owner[at] = k;
            ownerAt[at] = index;
          }
        }
      }
    });
    parameters.push(finished({
      ...parameterBase(id, paramDefs[id]),
      data,
      rawAt(cell, slice) {
        const k = owner[slice * cells + cell];
        if (k < 0) return { value: undefined, index: null, pointer: null, coverage: null, absent: true };
        const at = ownerAt[slice * cells + cell];
        return { value: rangeOf(coverages[k], id)?.[at], index: at, pointer: `/coverages/${k}/ranges/${pointerPart(id)}/values/${at}`, coverage: k };
      },
      indicesAt(cell, slice) {
        const k = owner[slice * cells + cell];
        return k < 0 ? [] : [['coverage', k]];
      },
    }, slices, cells));
  }
  if (parameters.length === 0) return cant('The coverages have no ranges');
  const notes: CellNote[] = [];
  const kind = type || 'Point';
  const sentAs = sent?.as ?? plural(coverages.length, `${kind} coverage`);
  const each = sent?.each ?? 'coverage';
  if (isLattice) {
    const missing = product - n;
    notes.push({ level: 'info', checks: 'info', text: `Sent as ${sentAs}, which line up as a ${count(distinctX.length)} × ${count(distinctY.length)} grid${missing ? `, with ${plural(missing, 'position')} missing` : ''}. A Grid domain would say that in a fraction of the size` });
  } else {
    const { spacing } = geometry as SamplesGeometry;
    notes.push({ level: 'info', text: `Sent as ${sentAs}, with ${count(distinctX.length)} different x and ${count(distinctY.length)} different y, so they aren't on lon/lat lines. Each is drawn at its own place${spacing.regular && spacing.km !== null ? `, about ${formatValue(spacing.km)} km apart` : ''}` });
  }
  if (repeats > 0) {
    notes.push({ level: 'warn', checks: 'warning', path: sent ? sent.placeAt(firstRepeat) : `/coverages/${firstRepeat}`, text: `${count(repeats)} of the ${count(coverages.length)} ${each}s repeat${repeats === 1 ? 's' : ''} a place and time another one has. A number is drawn over a null${disagree ? `, and ${plural(disagree, 'pair')} of numbers disagree, where the first is drawn` : ', and no two numbers disagree'}` });
  }
  parameters.forEach(parameter => addParameterNotes(notes, parameter));
  return {
    drawable: true, source: isLattice ? 'points-grid' : 'points', viewLabel: isLattice ? 'Grid' : 'Points', domainType: kind,
    geometry, dims, fixed, slices, cells, crs, parameters, broken: [], notes, order: null, zUnit: zUnitOf(refs, sent?.zName),
    coverageCount: each === 'coverage' ? coverages.length : null,
  };
}

// The median distance to a neighbour, in km, to size a marker. A hash keeps it to about n
function spacingOf(xs: number[], ys: number[]): SamplesGeometry['spacing'] {
  const n = xs.length;
  if (n < 2) return { km: null, regular: false };
  const midLat = ys.reduce((a, b) => a + b, 0) / n;
  const kmX = 111.32 * Math.cos((midLat * Math.PI) / 180);
  const kmY = 111.32;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(Math.sqrt(((width * kmX || 1) * (height * kmY || 1)) / n), 1e-6);
  const buckets = new Map<number, number[]>();
  const keyOf = (a: number, b: number) => a * 100003 + b;
  for (let i = 0; i < n; i++) {
    const key = keyOf(Math.floor((xs[i] * kmX) / size), Math.floor((ys[i] * kmY) / size));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  const near: number[] = [];
  const stride = Math.max(1, Math.floor(n / 800));
  for (let i = 0; i < n; i += stride) {
    const bucketX = Math.floor((xs[i] * kmX) / size);
    const bucketY = Math.floor((ys[i] * kmY) / size);
    let best = Infinity;
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (const j of buckets.get(keyOf(bucketX + a, bucketY + b)) ?? []) {
          if (j === i) continue;
          const distance = Math.hypot((xs[i] - xs[j]) * kmX, (ys[i] - ys[j]) * kmY);
          if (distance < best) best = distance;
        }
      }
    }
    if (best < Infinity) near.push(best);
  }
  near.sort((a, b) => a - b);
  if (!near.length) return { km: null, regular: false };
  const median = near[near.length >> 1];
  const high = near[Math.floor(near.length * 0.9)];
  const low = near[Math.floor(near.length * 0.1)];
  return { km: median, regular: high < median * 1.3 && low > median * 0.7 };
}

// ---- Polygons: DWD's ICON triangles, each cell as it really is -----------------------------------

// A polygon as CoverageJSON has it: rings, the first its outline, each a list of positions of at least x and y
const isPosition = (position: unknown) => Array.isArray(position) && position.length >= 2 && isNum(position[0]) && isNum(position[1]);
const isPolygon = (polygon: unknown) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(ring => Array.isArray(ring) && ring.every(isPosition));

function readPolygons(coverage: Json, type: string, paramDefs: Json, topRef: unknown, prefix: string): CellsReading {
  const domain = coverage.domain as Json;
  const axes = domain.axes as Json;
  // A list of more than one, as readCellsOf sends only those
  const raw = (axes.composite as Json).values as unknown[];
  // Half a picture would hide the fault, so one that can't be read draws none
  const bad = raw.findIndex(polygon => !isPolygon(polygon));
  if (bad !== -1) return cant(`Polygon ${bad + 1} isn't a list of rings of [x, y] positions`);
  const polygons = raw as number[][][][];
  const n = polygons.length;
  const axisLen: Record<string, number> = { composite: n };
  for (const name of Object.keys(axes)) if (name !== 'composite') axisLen[name] = axisValues(axes[name])?.length ?? 0;
  const others = Object.keys(axes).filter(name => name !== 'composite');
  const { dims, fixed } = stepAxes(others, axes);
  const slices = dims.reduce((a, dim) => a * dim.values.length, 1);
  const offsets = new Uint32Array(n + 1);
  const pts: number[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    for (const [x, y] of polygons[i][0]) {
      pts.push(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    offsets[i + 1] = pts.length / 2;
  }
  const refs = domain.referencing ?? topRef;
  const crs = crsOf(refs, [minX, maxX], [minY, maxY]);
  const parameters: CellParameter[] = [];
  const broken: BrokenParameter[] = [];
  const definitions = { ...paramDefs, ...(isObj(coverage.parameters) ? coverage.parameters : {}) };
  for (const [id, range] of Object.entries(isObj(coverage.ranges) ? coverage.ranges : {})) {
    const base = parameterBase(id, definitions[id], definedIn(coverage, id, prefix));
    const problem = rangeProblem(id, range, axisLen);
    if (problem) {
      broken.push({ ...base, problem });
      continue;
    }
    const theRange = range as Json;
    const values = theRange.values as unknown[];
    const strides = stridesOf(theRange, Object.keys(axes), axisLen);
    const stride = strides.composite ?? 1;
    const sliceAt = sliceOffsets(dims, strides);
    const data = new Float32Array(slices * n);
    for (let slice = 0; slice < slices; slice++) {
      for (let i = 0; i < n; i++) {
        const value = values[sliceAt[slice] + i * stride];
        data[slice * n + i] = typeof value === 'number' ? value : NaN;
      }
    }
    parameters.push(finished({
      ...base,
      data,
      rawAt(cell, slice) {
        const index = sliceAt[slice] + cell * stride;
        return { value: values[index], index, pointer: `${prefix}/ranges/${pointerPart(id)}/values/${index}`, coverage: null };
      },
      indicesAt(cell, slice) {
        const steps = stepsOfSlice(dims, slice);
        return [...dims.map((dim): [string, number] => [dim.name, steps[dim.name]]), ['composite', cell]];
      },
    }, slices, n));
  }
  if (!parameters.length) return cant(broken[0]?.problem ?? 'The coverage has no ranges');
  // Triangles only if every one is: an outline of three corners, closed, and no holes
  const triangles = polygons.every(polygon => polygon.length === 1 && polygon[0].length === 4);
  const notes: CellNote[] = [{ level: 'info', text: `Sent as ${plural(n, 'polygon')} on a composite axis${triangles ? ', triangles of the model’s own grid' : ''}. Each is drawn as it is` }];
  parameters.forEach(parameter => addParameterNotes(notes, parameter));
  return {
    drawable: true, source: 'polygons', viewLabel: 'Cells', domainType: type,
    geometry: { kind: 'polygons', cells: n, pts: Float64Array.from(pts), offsets, bbox: [minX, minY, maxX, maxY] },
    dims, fixed, slices, cells: n, crs, parameters, broken, notes, order: null, zUnit: zUnitOf(refs), coverageCount: null,
  };
}

// Which of a composite axis's coordinates is which, by name first: Polytope sends latitude, longitude, levelist, where a
// MultiPoint has x, y and z, in that order. What's left, if one is, is z by its place. With t, it's a line
export interface CompositeRoles {
  x: number;
  y: number;
  z: number;
  names: string[];
  // Not just x, y and z
  byName: boolean;
}

const X_NAMES = /^(lon|long|longitude|easting)$/i;
const Y_NAMES = /^(lat|latitude|northing)$/i;

export function compositeRoles(coordinates: unknown): CompositeRoles | null {
  if (!Array.isArray(coordinates) || !coordinates.every(name => typeof name === 'string')) return null;
  const names = coordinates as string[];
  if (names.includes('t')) return null;
  const find = (exact: string, like: RegExp) => (names.includes(exact) ? names.indexOf(exact) : names.findIndex(name => like.test(name)));
  const x = find('x', X_NAMES);
  const y = find('y', Y_NAMES);
  const rest = names.map((_, i) => i).filter(i => i !== x && i !== y);
  if (x < 0 || y < 0 || rest.length > 1) return null;
  const z = rest.length ? rest[0] : -1;
  return { x, y, z, names, byName: names[x] !== 'x' || names[y] !== 'y' || (z >= 0 && names[z] !== 'z') };
}

// Every point on a composite axis as a coverage of its own, read through its range's strides, so the same reader
// does both. A MultiPointSeries steps through t as well. Raw's paths and the readout's indices are the response's own
function readMultiPoint(coverage: Json, type: string, paramDefs: Json, topRef: unknown, roles: CompositeRoles, prefix: string): CellsReading {
  const domain = coverage.domain as Json;
  const axes = domain.axes as Json;
  const tuples = axisValues(axes.composite) ?? [];
  const n = tuples.length;
  const lengths: Record<string, number> = {};
  for (const name of Object.keys(axes)) lengths[name] = axisValues(axes[name])?.length ?? 0;
  const odd = Object.keys(axes).find(name => name !== 'composite' && name !== 't' && name !== 'z' && lengths[name] > 1);
  if (odd) return cant(`The points step through ${odd} too, which this doesn't draw`);
  const t = axisValues(axes.t);
  const z = axisValues(axes.z);
  const tLength = t?.length ?? 1;
  const zLength = z?.length ?? 1;
  const own = tLength * zLength;
  const { names } = roles;
  const notes: CellNote[] = [];
  if (roles.byName) {
    const third = roles.z >= 0 ? `, and ${names[roles.z]}${names[roles.z] === 'z' ? '' : ', the third,'} as z` : '';
    // CoverageJSON: a MultiPoint's composite axis MUST have the coordinates x, y or x, y, z, in that order. The schema
    // makes that its error, so this only says how they're read, and where the rule is
    notes.push({
      level: 'warn', text: `The composite axis's coordinates are ${names.join(', ')}, not x, y${roles.z >= 0 ? ', z' : ''}. They're read by name: ${names[roles.x]} as x, ${names[roles.y]} as y${third}`,
      checks: 'info', path: `${prefix}/domain/axes/composite/coordinates`,
      ...(/^multipoint(series)?$/i.test(type) ? { rule: /series$/i.test(type) ? COVJSON.multiPointSeriesComposite : COVJSON.multiPointComposite } : {}),
    });
  }

  const definitions = { ...paramDefs, ...(isObj(coverage.parameters) ? coverage.parameters : {}) };
  const broken: BrokenParameter[] = [];
  // Per parameter, where each point's values are in the response's values, and the axes in its values' order
  const indices = new Map<string, Int32Array>();
  const orders = new Map<string, string[]>();
  for (const [id, range] of Object.entries(isObj(coverage.ranges) ? coverage.ranges : {})) {
    const problem = rangeProblem(id, range, lengths);
    const values = inlineValues(range);
    // When only the composite axis has more than one value, a value per point is the only way to read them
    const oneWay = values !== null && values.length === n && Object.keys(lengths).every(name => name === 'composite' || lengths[name] <= 1);
    if (problem && !oneWay) {
      broken.push({ ...parameterBase(id, definitions[id]), problem });
      continue;
    }
    if (problem) notes.push({ level: 'warn', text: `${problem}. Its ${count(n)} values are read one per point, the only way they fit`, parameter: id });
    const strides = problem ? { composite: 1 } : stridesOf(range as Json, Object.keys(axes), lengths);
    // stridesOf goes from the fastest axis out, so its keys are the other way round
    orders.set(id, Object.keys(strides).reverse().filter(name => name === 'composite' || lengths[name] > 1));
    const at = new Int32Array(n * own);
    for (let i = 0; i < n; i++) {
      for (let ti = 0; ti < tLength; ti++) {
        for (let zi = 0; zi < zLength; zi++) at[i * own + ti * zLength + zi] = i * (strides.composite ?? 0) + ti * (strides.t ?? 0) + zi * (strides.z ?? 0);
      }
    }
    indices.set(id, at);
  }
  if (indices.size === 0) return cant(broken[0]?.problem ?? 'The coverage has no ranges');

  const ranges = isObj(coverage.ranges) ? coverage.ranges : {};
  const asPoints: Json[] = tuples.map((tuple, i) => {
    const place = Array.isArray(tuple) ? tuple : [];
    const level = z ?? (roles.z >= 0 ? [place[roles.z]] : null);
    return {
      domain: { axes: { x: { values: [place[roles.x]] }, y: { values: [place[roles.y]] }, ...(t ? { t: { values: t } } : {}), ...(level ? { z: { values: level } } : {}) } },
      ranges: Object.fromEntries([...indices].map(([id, at]) => {
        const values = (ranges[id] as Json).values as unknown[];
        return [id, { values: Array.from(at.subarray(i * own, (i + 1) * own), index => values[index]) }];
      })),
    };
  });
  const reading = readPoints(asPoints, type, definitions, domain.referencing ?? topRef, {
    as: `${plural(n, 'point')} on a composite axis`, placeAt: k => `${prefix}/domain/axes/composite/values/${k}`, each: 'point', xName: names[roles.x], zName: roles.z >= 0 ? names[roles.z] : 'z',
  });
  if (!reading.drawable) return reading;
  return {
    ...reading,
    broken,
    notes: [...broken.map(({ problem }): CellNote => ({ level: 'error', text: problem })), ...notes, ...reading.notes],
    parameters: reading.parameters.map(parameter => {
      const at = indices.get(parameter.id)!;
      return {
        ...parameter,
        definedAt: definedIn(coverage, parameter.id, prefix),
        rawAt(cell, slice) {
          const raw = parameter.rawAt(cell, slice);
          if (raw.coverage === null || raw.index === null) return raw;
          const index = at[raw.coverage * own + raw.index];
          return { ...raw, index, pointer: `${prefix}/ranges/${pointerPart(parameter.id)}/values/${index}`, coverage: null };
        },
        // Where it is along each of the response's axes, from where it is in its point's own values
        indicesAt(cell, slice) {
          const raw = parameter.rawAt(cell, slice);
          if (raw.coverage === null || raw.index === null) return [];
          const along: Record<string, number> = { composite: raw.coverage, t: Math.floor(raw.index / zLength), z: raw.index % zLength };
          return orders.get(parameter.id)!.map((name): [string, number] => [name, along[name]]);
        },
      };
    }),
  };
}

// ---- Notes, in the same voice as coverageSummary's --------------------------------------------

// Values that are a code by long habit, here only to word a note
const FILL_LIKE = new Set([-9999, 9999, -999, 999, -99, -32768, 32767, 65535, -999.9, 9999.9]);
const looksLikeFill = (value: number) => Math.abs(value) >= 1e20 || FILL_LIKE.has(Math.round(value * 10) / 10);

export function addParameterNotes(notes: CellNote[], parameter: CellParameter) {
  const { id, unit, figures, data, absentAt } = parameter;
  const cells = data.length / figures.perSlice.length;
  // Where the first value that passes is, in the data, which cellFindings makes a path of
  const first = (test: (value: number, at: number) => boolean) => {
    for (let at = 0; at < data.length; at++) if (test(data[at], at)) return at;
    return undefined;
  };
  if (figures.numbers === 0) {
    // All null is the summary's to say, from the response's own values
    if (figures.notNumbers) notes.push({ level: 'warn', text: `${id} has no numbers: ${notNumbersText(figures.notNumbers, parameter.notNumbersAreText)}`, parameter: id, checks: 'info', at: first((_, at) => parameter.notNumberAt?.[at] === 1) });
    else notes.push({ level: 'warn', text: `All ${plural(figures.total, 'value')} of ${id} are null`, parameter: id });
    return;
  }
  for (const apart of figures.apart) {
    const value = apart.min === apart.max ? formatValue(apart.min) : `${formatValue(apart.min)} to ${formatValue(apart.max)}`;
    const fill = looksLikeFill(apart.min) ? ', which looks like a fill value' : '';
    notes.push({
      level: 'warn', text: `${id} has ${plural(apart.count, 'value')} of ${value}${fill}, far from the rest (${formatValue(figures.lo!)} to ${formatValue(figures.hi!)})`, parameter: id,
      checks: 'info', at: first(each => each >= apart.min && each <= apart.max),
    });
  }
  const { spike } = figures;
  if (spike && !figures.apart.some(apart => apart.min === spike.value && apart.max === spike.value) && figures.numbers >= 50) {
    const guess = spike.value !== 0 ? '. It may be a code and not a measurement' : '';
    notes.push({ level: guess ? 'warn' : 'info', checks: 'info', at: first(each => each === spike.value), text: `${formatValue(spike.value)}${unit ? ` ${unit}` : ''} is in ${count(spike.count)} of ${count(figures.total)} ${id} values (${shareText(spike.count / figures.total)}), at the ${spike.atLow ? 'bottom' : 'top'} of the range${guess}`, parameter: id });
  }
  // A step with nothing sent isn't null: nothing was there to be
  const allNull = (slice: SliceFigures) => slice.numbers === 0 && slice.nulls + slice.notNumbers > 0;
  const empty = figures.perSlice.filter(allNull).length;
  if (empty > 0 && empty < figures.perSlice.length) {
    let at = figures.perSlice.findIndex(allNull) * cells;
    while (absentAt?.[at]) at++;
    notes.push({ level: 'warn', text: `${plural(empty, 'step')} of ${id} ${empty === 1 ? 'is' : 'are'} all null`, parameter: id, checks: 'info', at });
  }
  addUnitNote(notes, parameter);
}

// Only where a wrong unit can't be read any other way, and only for what's named plainly
function addUnitNote(notes: CellNote[], { id, label, unit, figures }: CellParameter) {
  const name = `${id} ${label ?? ''}`.toLowerCase();
  const symbol = unit.toLowerCase();
  const lo = figures.lo!;
  const hi = figures.hi!;
  const say = (text: string) => notes.push({ level: 'warn', text, parameter: id, checks: 'info', at: 'unit' });
  const values = `its values (${formatValue(lo)} to ${formatValue(hi)})`;
  if (NAMED.temperature.test(name)) {
    if (/°?c$|deg_?c|celsius/.test(symbol) && lo > 150) say(`${id} says ${unit}, and ${values} look like kelvin`);
    if (/^k$|kelvin/.test(symbol) && hi < 100) say(`${id} says ${unit}, and ${values} look like °C`);
  }
  if (NAMED.pressure.test(name)) {
    if (/hpa/.test(symbol) && lo > 10000) say(`${id} says ${unit}, and ${values} look like Pa`);
    if (/^pa$/.test(symbol) && hi < 2000) say(`${id} says ${unit}, and ${values} look like hPa`);
  }
  if (NAMED.humidity.test(name) && symbol === '%' && hi <= 1.5) say(`${id} says %, and ${values} look like a fraction`);
}

function gridNotes({ xv, yv, crs, nx, ny, parameters, broken, prefix, referencingAt }: {
  xv: number[]; yv: number[]; crs: CellCrs; nx: number; ny: number; parameters: CellParameter[]; broken: BrokenParameter[]; prefix: string; referencingAt: string;
}): CellNote[] {
  const notes: CellNote[] = broken.map(({ problem }) => ({ level: 'error', text: problem }));
  // CoverageJSON: x, y and z MUST be referenced by a spatial coordinate reference system
  if (!crs.declared) notes.push({ level: 'warn', text: `referencing says nothing about x and y. They're taken as ${crs.geographic ? 'lon/lat, since they fit' : 'plain numbers, since they don’t fit lon/lat'}`, checks: 'error', path: referencingAt, rule: COVJSON.spatialReferenced });
  // CoverageJSON 9.10: with longitude and latitude axes, "x" MUST refer to longitude and "y" to latitude, and 9.5.1.1:
  // in the defined domain types "x" is geodetic longitude and "y" geodetic latitude
  if (crs.declared && crs.geographic && !crs.inDegrees) notes.push({ level: 'error', text: 'x or y is beyond what degrees can be, so they may be swapped or not in this CRS', checks: 'error', path: `${prefix}/domain/axes`, rule: [COVJSON.xIsLongitude, COVJSON.geographicAxes] });
  if (crs.geographic) {
    for (const [name, values] of [['x', xv], ['y', yv]] as const) {
      const drift = axisDrift(values);
      // Floating point noise is far below this. A true lon/lat grid has even steps
      if (drift && drift.spread > 0.0005 && drift.strayCells > 0.02) {
        notes.push({ level: 'warn', text: `The ${name} steps aren't even: ${formatValue(drift.min)}° to ${formatValue(drift.max)}°. A lon/lat grid has even steps, so this may be a projected grid labelled lon/lat, where one axis can't place every row. Check a cell with position`, checks: 'info', path: `${prefix}/domain/axes/${name}/values` });
        break;
      }
    }
  }
  if (nx === 1 || ny === 1) {
    const what = nx === 1 && ny === 1
      ? 'One cell, so the response doesn’t say how big it is. The size drawn'
      : ny === 1 ? 'One row, so the response doesn’t say how tall its cells are. The height drawn' : 'One column, so the response doesn’t say how wide its cells are. The width drawn';
    notes.push({ level: 'info', text: `${what} is only for show` });
  }
  parameters.forEach(parameter => addParameterNotes(notes, parameter));
  return notes;
}
