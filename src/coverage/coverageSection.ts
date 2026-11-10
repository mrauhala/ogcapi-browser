import { EDR } from '../standards';
import type { ValidationError } from '../types/api';
import { coverageParameters, distinctLabel, parameterLabel, parameterUnit } from '../utils/coverageTimeSeries';
import { parseTime } from '../utils/utcTime';
import { waypointLetter } from '../utils/waypointLetter';
import { axisFault, axisValues, crsOf, pointerPart, type CellCrs } from './coverageCells';
import { formatValue, type ParameterFigures } from './coverageSummary';
import { askedLevels, expectedLevels, isNumber, readVerticalAxis, withUnit, zFindings, type VerticalAxis, type VerticalKind } from './verticalAxis';

// A response along a path, as frames × levels × positions: what the section view draws and its table lists. EDR's
// trajectory answers come in many shapes: a coverage per level (FMI, MeteoCore), a radar's Section with a z axis, z in
// the tuples (LINESTRINGZ), time in the tuples (LINESTRINGM), a time per coverage, or times inside the tuples. Each
// coverage's tuples are grouped by time: if each time has the same positions, each time is a frame; if not, time runs
// along the path. The range's own axisNames give its order. Nothing is interpolated, and every cell keeps where it
// came from. A path at one place is a profile, which coverageToProfile takes. No DOM.

export type SectionKind = 'section' | 'track' | 'line';

export interface SectionFrame {
  key: string;
  // As sent, or null where the frame has no time of its own: there's none in the response, or it runs along the path
  raw: string | null;
  // NaN where raw isn't a time
  ms: number;
}

// A cell's value in data: a number as sent, NaN for null, and these two for the rest. JSON can't hold either infinity
export const NOT_SENT = Infinity;
export const NOT_A_NUMBER = -Infinity;

export interface SectionParameter extends ParameterFigures {
  // Per frame, level × position, a level's positions together: data[frame][level * colCount + col]
  data: Float64Array[];
}

export interface Waypoint {
  // A, B, C... in the order of the request's coords
  label: string;
  // Which line of a MULTILINESTRING it's on, from 0
  line: number;
  lon: number;
  lat: number;
  // Where it is among the positions, if it is
  col: number | null;
  km: number | null;
}

export interface SectionCell {
  raw: unknown;
  // RFC 6901 pointer to the value in the response
  path: string;
}

// MeteoCore's lowest radar beam along the path, from meteocore:beamCoverage.floor. It changes with time, so it's per frame
export interface BeamFloor {
  // Per frame, a height per position in z's unit. NaN where there's none
  values: Float64Array[];
  // Where a position's height is in the response, e.g. /coverages/3/domain/meteocore:beamCoverage/floor/12
  pathAt: (frame: number, col: number) => string | null;
}

export interface SectionData {
  // 'line': one level or none. 'track': one level per position, as z in the tuples gives
  kind: SectionKind;
  domainType: string;
  coverageCount: number;
  // Ascending: the levels sent and those asked for and not sent. [null] if there's no z at all
  levels: (number | null)[];
  // Asked for and not sent. They have rows, and no values
  notBack: number[];
  z: VerticalAxis | null;
  colCount: number;
  // x and y of each position, in order along the path
  positions: [number, number][];
  crs: CellCrs;
  // Along the path, from the response's own positions. The position's number where they aren't lon/lat
  km: Float64Array;
  spacing: { min: number; median: number; max: number; total: number };
  // In time order, one per data array: one with no time if there's none, or if time runs along the path
  frames: SectionFrame[];
  // Each position's time, if time runs along the path, NaN where it isn't one
  timeAlong: number[] | null;
  parameters: SectionParameter[];
  waypoints: Waypoint[];
  // Positions where a new line of a MULTILINESTRING starts
  breaks: number[];
  // The lowest radar beam, if the response has one that can be drawn
  beamFloor: BeamFloor | null;
  // Why one that's there isn't drawn
  beamFloorFault: string | null;
  notes: ValidationError[];
  // Where a cell's value is in the response, and the value as sent. Null where nothing was sent
  cellAt: (parameterId: string, frame: number, cell: number) => SectionCell | null;
}

export interface SectionCant {
  kind: 'cant';
  reason: string;
}

export type SectionResult = SectionData | SectionCant | null;

type Json = Record<string, unknown>;
type Position = [number, number];
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? '' : 's'}`;
const shown = (value: unknown) => (value === undefined ? 'nothing' : JSON.stringify(value));
const one = (n: number, singular: string, several: string) => (n === 1 ? singular : several);
const cant = (reason: string): SectionCant => ({ kind: 'cant', reason });
// "14.75, 53.12 and 2.95"
const listed = (texts: string[]) => (texts.length < 2 ? texts.join('') : `${texts.slice(0, -1).join(', ')} and ${texts[texts.length - 1]}`);
const levelsListed = (values: number[]) => `${values.slice(0, 5).join(', ')}${values.length > 5 ? ` and ${values.length - 5} more` : ''}`;
const kmText = (km: number) => km.toLocaleString('en-US', km >= 0.1 || km === 0 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 2 });
// A, B... Z, then AA, AB

const PATH_TYPE = /^(trajectory|section)$/i;
const EARTH_KM = 6371.0088;
// A vendor member of the domain: a height per tuple, under the radar's lowest beam
const BEAM = 'meteocore:beamCoverage';
const KIND_WORDS: Record<VerticalKind, string> = {
  pressure: 'pressure', height: 'a height', depth: 'a depth', modelLevel: 'a model level', angle: 'an elevation angle', unknown: "of a kind the response doesn't name",
};

function greatCircleKm([x1, y1]: Position, [x2, y2]: Position): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The upper of the two middle ones
const median = (numbers: number[]) => (numbers.length === 0 ? 0 : [...numbers].sort((a, b) => a - b)[numbers.length >> 1]);
// Without spreading them into a call, which a long path would overflow
const lowest = (numbers: number[]) => numbers.reduce((a, b) => Math.min(a, b), Infinity);
const highest = (numbers: number[]) => numbers.reduce((a, b) => Math.max(a, b), -Infinity);

// The lines a request's coords give, in any WKT form of one: LINESTRING with Z, M or ZM, and MULTILINESTRING. Only lon
// and lat are kept. Null if it isn't a line, or a vertex can't be read
function requestLines(url: string | undefined): Position[][] | null {
  if (!url) return null;
  let coords: string | null;
  try {
    coords = new URL(url).searchParams.get('coords');
  } catch {
    return null;
  }
  const match = coords ? /^\s*(MULTI)?LINESTRING\s*(?:ZM|Z|M)?\s*\((.*)\)\s*$/is.exec(coords) : null;
  if (!match) return null;
  const body = match[2];
  if (match[1] && body.replace(/\([^()]*\)/g, '').replace(/[\s,]/g, '')) return null;
  const texts = match[1] ? [...body.matchAll(/\(([^()]*)\)/g)].map(line => line[1]) : [body];
  const lines = texts.map(text => text.split(',').map(vertex => vertex.trim().split(/\s+/).map(Number)));
  if (lines.some(line => line.some(vertex => vertex.length < 2 || !vertex.every(Number.isFinite)))) return null;
  return lines.map(line => line.map(([lon, lat]): Position => [lon, lat]));
}

interface Coverage {
  json: Json;
  where: string;
  tuples: unknown[][];
  ix: number;
  iy: number;
  it: number;
  iz: number;
  // Its z axis, if it has one
  z: number[] | null;
  tAxis: unknown;
  // Its meteocore:beamCoverage, as sent
  beam: unknown;
}

// Positions in order, as the first coverage and time that sent them have them
interface Part {
  start: number;
  coverage: number;
  tuples: number[];
  positions: Position[];
  times: unknown[];
}

// One coverage's tuples at one time, or all of them where time runs along the path
interface Strip {
  coverage: number;
  tuples: number[];
  part: Part;
  frameKey: string;
}

// The summary and the picture read the same response for the same request, and a radar's takes tens of ms, so it's
// read once. What's returned is shared, and never changed by those who use it
const readBefore = new WeakMap<object, { url: string | undefined; result: SectionResult }>();

// A response along a path, or why it can't be read, or null if it isn't along one. A reader that throws is a bug in
// it, and is said to be: a response mustn't take the page down with it
export function toSection(json: unknown, requestUrl?: string): SectionResult {
  const known = isObject(json) ? readBefore.get(json) : undefined;
  if (known && known.url === requestUrl) return known.result;
  let result: SectionResult;
  try {
    result = readSection(json, requestUrl);
  } catch (error) {
    console.error('toSection failed on this response:', error);
    result = cant(`This response couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (isObject(json)) readBefore.set(json, { url: requestUrl, result });
  return result;
}

function readSection(json: unknown, requestUrl: string | undefined): SectionResult {
  if (!isObject(json)) return null;
  const isCollection = json.type === 'CoverageCollection' && Array.isArray(json.coverages);
  if (json.type !== 'Coverage' && !isCollection) return null;
  const list = (isCollection ? (json.coverages as unknown[]) : [json]).map(item => (isObject(item) ? item : {}));
  if (list.length === 0) return null;
  const prefix = (c: number) => (isCollection ? `/coverages/${c}` : '');
  const named = (c: number) => (isCollection ? `/coverages/${c}` : 'The coverage');
  const domainOf = (coverage: Json) => (isObject(coverage.domain) ? coverage.domain : null);
  const compositeOf = (coverage: Json) => {
    const axes = domainOf(coverage)?.axes;
    const composite = isObject(axes) ? axes.composite : null;
    return isObject(composite) && Array.isArray(composite.values) ? composite : null;
  };
  const coordinatesOf = (composite: Json) => (Array.isArray(composite.coordinates) ? composite.coordinates : []);

  // ---- Whether it's a path at all: tuples of x and y that go somewhere, in a Trajectory, a Section or with t ----

  const domainTypes = list.map(coverage => domainOf(coverage)?.domainType ?? json.domainType);
  const isPath = list.some((coverage, c) => {
    const composite = compositeOf(coverage);
    const names = composite ? coordinatesOf(composite) : [];
    return names.includes('x') && names.includes('y') && (PATH_TYPE.test(String(domainTypes[c] ?? '')) || names.includes('t'));
  });
  if (!isPath) return null;
  // Places as coverageToProfile counts them, so that a path at one place is its profile's, and no response is both
  const places = new Set<string>();
  for (const coverage of list) {
    const composite = compositeOf(coverage);
    if (!composite) continue;
    const names = coordinatesOf(composite);
    for (const tuple of composite.values as unknown[]) {
      const value = (name: string) => (Array.isArray(tuple) && names.includes(name) ? tuple[names.indexOf(name)] : undefined);
      places.add(`${String(value('x'))},${String(value('y'))}`);
    }
  }
  if (places.size <= 1) return null;

  // ---- The domains: each coverage's tuples, read and checked, then grouped into strips of positions ----

  const coverages: Coverage[] = [];
  for (let c = 0; c < list.length; c++) {
    const coverage = list[c];
    const where = prefix(c);
    if (typeof coverage.domain === 'string') return cant(`${where}/domain is a link, and not in this response`);
    const domain = domainOf(coverage);
    if (!domain) return cant(`${named(c)} has no domain`);
    const axes = isObject(domain.axes) ? domain.axes : {};
    const composite = compositeOf(coverage);
    if (!composite) return cant(`${named(c)} has no composite axis of positions, where the rest of the response is along a path`);
    const names = coordinatesOf(composite);
    const [ix, iy, it, iz] = ['x', 'y', 't', 'z'].map(name => names.indexOf(name));
    if (ix < 0 || iy < 0) return cant(`${where}/domain/axes/composite has the coordinates ${names.join(', ')}, without x and y`);
    for (const name of Object.keys(axes)) {
      const length = axisValues(axes[name])?.length ?? 0;
      if (name !== 'composite' && name !== 'z' && length > 1) return cant(`${named(c)} runs along ${name} as well, with ${count(length)} values. A path is read along composite and z`);
    }
    const zFault = axisFault('z', axes.z);
    if (zFault) return cant(`${zFault}, at ${where}/domain/axes/z`);
    const z = axisValues(axes.z);
    const badZ = z ? z.findIndex(value => !isNumber(value)) : -1;
    if (z && badZ >= 0) return cant(`${where}/domain/axes/z/values/${badZ} is ${shown(z[badZ])}, which isn't a number`);
    if (z && z.length > 1 && iz >= 0) return cant(`${named(c)} has z in its tuples and a z axis of ${count(z.length)} values`);
    const tuples = composite.values as unknown[];
    for (let k = 0; k < tuples.length; k++) {
      const tuple = tuples[k];
      const at = `${where}/domain/axes/composite/values/${k}`;
      if (!Array.isArray(tuple)) return cant(`${at} is ${shown(tuple)}, not a tuple`);
      for (const [name, index] of [['x', ix], ['y', iy], ['z', iz]] as const) {
        if (index >= 0 && !isNumber(tuple[index])) return cant(`${at} has ${name} ${shown(tuple[index])}, which isn't a number`);
      }
    }
    coverages.push({ json: coverage, where, tuples: tuples as unknown[][], ix, iy, it, iz, z: z as number[] | null, tAxis: axisValues(axes.t)?.[0], beam: domain[BEAM] });
  }

  const hasZ = coverages.some(coverage => coverage.iz >= 0 || coverage.z !== null);
  const lacking = coverages.findIndex(coverage => coverage.tuples.length > 0 && coverage.iz < 0 && coverage.z === null);
  if (hasZ && lacking >= 0) return cant(`${named(lacking)} has no z, where the rest of the response has one`);

  const parts = new Map<string, Part>();
  const strips: Strip[] = [];
  const frameKeys = new Map<string, SectionFrame>();
  const alongIn: number[] = [];
  const timedIn: number[] = [];
  const sentLevels = new Set<number>();
  const repeats: { col: number; path: string }[] = [];
  let colCount = 0;

  coverages.forEach((coverage, c) => {
    const { tuples, ix, iy, it, iz } = coverage;
    if (tuples.length === 0) return;
    const timeOf = (k: number) => (it >= 0 ? tuples[k][it] : coverage.tAxis);
    const byTime = new Map<unknown, number[]>();
    tuples.forEach((_, k) => {
      const time = timeOf(k);
      if (!byTime.has(time)) byTime.set(time, []);
      byTime.get(time)!.push(k);
    });
    const signature = (indices: number[]) => indices.map(k => `${tuples[k][ix]} ${tuples[k][iy]}`).join(',');
    const groups = [...byTime.entries()].map(([time, indices]) => ({ time, indices, signature: signature(indices) }));
    const along = groups.length > 1 && groups.some(group => group.signature !== groups[0].signature);
    const add = (indices: number[], key: string, frame: SectionFrame, sig: string) => {
      let part = parts.get(sig);
      if (!part) {
        part = { start: colCount, coverage: c, tuples: indices, positions: indices.map(k => [tuples[k][ix] as number, tuples[k][iy] as number]), times: indices.map(timeOf) };
        parts.set(sig, part);
        // The same tuple twice in a row: the same place, and the same level and time if the tuples have them
        for (let n = 1; n < indices.length; n++) {
          const [before, now] = [tuples[indices[n - 1]], tuples[indices[n]]];
          if (now.length === before.length && now.every((value, i) => value === before[i])) repeats.push({ col: colCount + n, path: `${coverage.where}/domain/axes/composite/values/${indices[n]}` });
        }
        colCount += indices.length;
      }
      if (!frameKeys.has(key)) frameKeys.set(key, frame);
      strips.push({ coverage: c, tuples: indices, part, frameKey: key });
    };
    if (along) {
      alongIn.push(c);
      add(tuples.map((_, k) => k), 'along', { key: 'along', raw: null, ms: NaN }, signature(tuples.map((_, k) => k)));
    } else {
      timedIn.push(c);
      for (const { time, indices, signature: sig } of groups) {
        const none = time === undefined || time === null;
        const key = none ? 'none' : `t ${String(time)}`;
        add(indices, key, { key, raw: none ? null : String(time), ms: parseTime(time) }, sig);
      }
    }
    if (iz >= 0) for (const tuple of tuples) sentLevels.add(tuple[iz] as number);
    else for (const level of coverage.z ?? []) sentLevels.add(level);
  });
  if (strips.length === 0) return cant(`The composite axis has no positions${isCollection ? `, in any of the ${plural(coverages.length, 'coverage')}` : ''}`);
  if (alongIn.length > 0 && timedIn.length > 0) {
    // Only a collection can have both
    return cant(`${named(alongIn[0])} has a time per position, and ${named(timedIn[0])} one time for all its positions`);
  }

  // ---- Levels and frames ----

  const asked = askedLevels(requestUrl);
  const sent = [...sentLevels].sort((a, b) => a - b);
  // Asked levels count only if one came back: radar angles asked of a section in metres are another axis
  const notBack = hasZ ? expectedLevels(asked, [], sent).filter(level => !sentLevels.has(level)) : [];
  const levels: (number | null)[] = hasZ ? [...sent, ...notBack].sort((a, b) => a - b) : [null];
  const levelIndex = new Map(levels.map((level, i) => [level, i]));
  // In time order, any that aren't times last
  const frames = [...frameKeys.values()].sort((a, b) => (Number.isFinite(a.ms) ? (Number.isFinite(b.ms) ? a.ms - b.ms : -1) : Number.isFinite(b.ms) ? 1 : 0));
  const frameIndex = new Map(frames.map((frame, i) => [frame.key, i]));
  const cells = levels.length * colCount;

  // ---- The lowest beam: a height per tuple, read along with the values, and kept only if z is a height ----

  const beamSent = coverages.some(coverage => coverage.beam !== undefined);
  let beamFloorFault: string | null = null;
  const floorOf: (unknown[] | null)[] = coverages.map(() => null);
  for (let c = 0; beamSent && c < coverages.length && !beamFloorFault; c++) {
    const { beam, tuples, where } = coverages[c];
    if (tuples.length === 0) continue;
    const floor = isObject(beam) ? beam.floor : undefined;
    const at = `${where}/domain/${BEAM}/floor`;
    if (beam === undefined) beamFloorFault = `${named(c)} has no ${BEAM}, where the rest of the response has one, so the lowest beam isn't drawn`;
    else if (!Array.isArray(floor)) beamFloorFault = `${at} isn't a list of heights, so the lowest beam isn't drawn`;
    else if (floor.length !== tuples.length) beamFloorFault = `${at} has ${plural(floor.length, 'value')}, and composite has ${plural(tuples.length, 'position')}, so the lowest beam isn't drawn`;
    else floorOf[c] = floor;
  }
  const floorValues = frames.map(() => new Float64Array(colCount).fill(NaN));
  const floorFrom = frames.map(() => ({ coverage: new Int32Array(colCount).fill(-1), tuple: new Int32Array(colCount).fill(-1) }));

  // ---- The values: each into its cell, through its range's own axisNames ----

  interface Reading { parameter: SectionParameter; sum: number; source: { coverage: Int32Array; value: Int32Array }[] }
  const readings = new Map<string, Reading>();
  const collectionParameters = isObject(json.parameters) ? json.parameters : undefined;
  const sentCells = new Uint8Array(cells);
  let duplicates = 0;
  let firstDuplicate = '';

  for (const strip of strips) {
    const coverage = coverages[strip.coverage];
    const { json: covJson, where, tuples, iz, z } = coverage;
    const ranges = isObject(covJson.ranges) ? covJson.ranges : {};
    const definitions = coverageParameters({ parameters: isObject(covJson.parameters) ? covJson.parameters : undefined }, collectionParameters) ?? {};
    const frame = frameIndex.get(strip.frameKey)!;
    const floor = floorOf[strip.coverage];
    if (floor) {
      const from = floorFrom[frame];
      strip.tuples.forEach((k, n) => {
        const col = strip.part.start + n;
        // The first coverage to give a position a height keeps it, as with the values
        if (from.coverage[col] >= 0 || !isNumber(floor[k])) return;
        floorValues[frame][col] = floor[k];
        from.coverage[col] = strip.coverage;
        from.tuple[col] = k;
      });
    }
    const axes = domainOf(covJson)!.axes as Json;
    const lengths: Record<string, number> = { composite: tuples.length };
    for (const name of Object.keys(axes)) if (name !== 'composite') lengths[name] = axisValues(axes[name])?.length ?? 0;
    const zLength = z && z.length > 1 ? z.length : 1;

    for (const [id, range] of Object.entries(ranges)) {
      let reading = readings.get(id);
      if (!reading) {
        const definition = definitions[id] as Parameters<typeof parameterLabel>[1] & Parameters<typeof parameterUnit>[0];
        reading = {
          parameter: {
            id, label: distinctLabel(id, parameterLabel(id, definition)), unit: parameterUnit(definition),
            count: 0, nulls: 0, others: 0, numbers: 0, min: null, max: null, mean: null, notIncluded: false,
            data: frames.map(() => new Float64Array(cells).fill(NOT_SENT)),
          },
          sum: 0,
          source: frames.map(() => ({ coverage: new Int32Array(cells).fill(-1), value: new Int32Array(cells).fill(-1) })),
        };
        readings.set(id, reading);
      }
      const values = isObject(range) && Array.isArray(range.values) ? range.values : null;
      if (!isObject(range) || !values) {
        reading.parameter.notIncluded = true;
        continue;
      }
      const rangeAt = `${where}/ranges/${pointerPart(id)}`;
      const names = Array.isArray(range.axisNames) ? range.axisNames.map(String) : ['composite', ...(zLength > 1 ? ['z'] : [])];
      const unknown = names.find(name => !Object.prototype.hasOwnProperty.call(lengths, name));
      if (unknown !== undefined) return cant(`${rangeAt}/axisNames has "${unknown}", which isn't an axis of the domain`);
      if (zLength > 1 && !names.includes('z')) return cant(`${rangeAt}/axisNames has no z, and z has ${count(zLength)} values`);
      const expected = names.reduce((product, name) => product * lengths[name], 1);
      if (values.length !== expected) {
        const axesSay = names.length === 1 && names[0] === 'composite'
          ? `composite has ${plural(tuples.length, 'position')}`
          : `its axes make ${names.map(name => count(lengths[name])).join(' × ')} = ${count(expected)}`;
        return cant(`${rangeAt}/values has ${plural(values.length, 'value')}, and ${axesSay}`);
      }
      const shape = Array.isArray(range.shape) ? range.shape : null;
      const wrong = shape ? names.findIndex((name, i) => shape[i] !== lengths[name]) : -1;
      if (shape && (shape.length !== names.length || wrong >= 0)) {
        return cant(`${rangeAt}/shape is ${shown(shape)}, and its axes, ${names.join(', ')}, have ${names.map(name => count(lengths[name])).join(', ')}`);
      }
      // How far one step along composite or z moves in the flat values
      const strides: Record<string, number> = {};
      let stride = 1;
      for (let i = names.length - 1; i >= 0; i--) {
        strides[names[i]] = stride;
        stride *= lengths[names[i]];
      }
      const [byTuple, byLevel] = [strides.composite ?? 0, strides.z ?? 0];
      const { parameter, source } = reading;
      const data = parameter.data[frame];
      const from = source[frame];
      for (let n = 0; n < strip.tuples.length; n++) {
        const k = strip.tuples[n];
        const col = strip.part.start + n;
        for (let zi = 0; zi < zLength; zi++) {
          const level = !hasZ ? null : zLength > 1 ? z![zi] : iz >= 0 ? (tuples[k][iz] as number) : z![0];
          const cell = levelIndex.get(level)! * colCount + col;
          const at = k * byTuple + zi * byLevel;
          if (data[cell] !== NOT_SENT) {
            duplicates++;
            firstDuplicate ||= `${rangeAt}/values/${at}`;
            continue;
          }
          const value = values[at];
          from.coverage[cell] = strip.coverage;
          from.value[cell] = at;
          sentCells[cell] = 1;
          parameter.count++;
          if (value === null) {
            data[cell] = NaN;
            parameter.nulls++;
          } else if (isNumber(value)) {
            data[cell] = value;
            parameter.numbers++;
            reading.sum += value;
            if (parameter.min === null || value < parameter.min) parameter.min = value;
            if (parameter.max === null || value > parameter.max) parameter.max = value;
          } else {
            data[cell] = NOT_A_NUMBER;
            parameter.others++;
          }
        }
      }
    }
  }
  if (readings.size === 0) return cant(`The ${isCollection ? 'coverages have' : 'coverage has'} no ranges`);
  if ([...readings.values()].every(({ parameter }) => parameter.count === 0)) return cant("The values aren't in this response");
  for (const reading of readings.values()) reading.parameter.mean = reading.parameter.numbers > 0 ? reading.sum / reading.parameter.numbers : null;
  const parameters = [...readings.values()].map(reading => reading.parameter);

  const cellAt = (parameterId: string, frame: number, cell: number): SectionCell | null => {
    const from = readings.get(parameterId)?.source[frame];
    const c = from && cell >= 0 && cell < cells ? from.coverage[cell] : -1;
    if (!from || c < 0) return null;
    const at = from.value[cell];
    const range = (coverages[c].json.ranges as Json)[parameterId] as Json;
    return { raw: (range.values as unknown[])[at], path: `${prefix(c)}/ranges/${pointerPart(parameterId)}/values/${at}` };
  };

  // ---- The path: distance along it, from the response's own positions and not from what was asked ----

  const partList = [...parts.values()];
  const positions = partList.flatMap(part => part.positions);
  const placeOf = (col: number) => {
    const part = partList.find(each => col >= each.start && col < each.start + each.positions.length)!;
    return `${prefix(part.coverage)}/domain/axes/composite/values/${part.tuples[col - part.start]}`;
  };
  const first = coverages[0].json;
  const crs = crsOf(domainOf(first)?.referencing ?? json.referencing, positions.map(([x]) => x), positions.map(([, y]) => y));
  const breaks = partList.slice(1).map(part => part.start);
  const breakSet = new Set(breaks);
  const km = new Float64Array(colCount);
  const gaps: { col: number; km: number }[] = [];
  for (let col = 1; col < colCount; col++) {
    if (!crs.geographic) {
      km[col] = col;
      continue;
    }
    if (breakSet.has(col)) {
      km[col] = km[col - 1];
      continue;
    }
    const step = greatCircleKm(positions[col - 1], positions[col]);
    gaps.push({ col, km: step });
    km[col] = km[col - 1] + step;
  }
  const steps = gaps.map(gap => gap.km);
  const spacing = {
    min: steps.length ? lowest(steps) : 0,
    median: median(steps),
    max: steps.length ? highest(steps) : 0,
    total: km[colCount - 1] ?? 0,
  };
  const timeAlong = alongIn.length > 0 ? partList.flatMap(part => part.times.map(parseTime)) : null;

  // ---- Notes: what the response does along the path. EDR has no rule for it, so each is a note, but a value sent twice,
  // which is the server's to fix. Whether each position is on the line asked for is EDR's /req/edr/linestring-coords-
  // response A ("Only those resources that are representative of the requested geometry … SHALL be part of the result
  // set"), which these don't check: they say whether the path reaches each vertex, which a server may rightly not where
  // its data ends ----

  const notes: ValidationError[] = [];
  const note = (message: string, path: string, rule?: ValidationError['rule']) => notes.push({ message, path, severity: 'info', ...(rule ? { rule } : {}) });

  // Waypoints: the request's vertices, found in order among the positions, within 0.6 of their usual spacing. Looser,
  // and the closed path's dropped vertex was "found" among the positions on the way back
  const lines = requestLines(requestUrl) ?? [];
  // Coverages that don't share their positions are read as parts of the path, which only a MULTILINESTRING asks for
  if (partList.length > Math.max(1, lines.length)) {
    const [firstPart, second] = partList;
    note(`The coverages don't share their positions: coverage ${second.coverage + 1}'s differ from coverage ${firstPart.coverage + 1}'s, so the path is read in ${plural(partList.length, 'part')}`, placeOf(second.start));
  }
  const waypoints: Waypoint[] = lines.flatMap((line, l) => line.map(([lon, lat]) => ({ label: '', line: l, lon, lat, col: null, km: null })));
  waypoints.forEach((waypoint, i) => (waypoint.label = waypointLetter(i)));
  if (crs.geographic && waypoints.length > 0) {
    const near = Math.max(0.5, spacing.median * 0.6);
    // A line each to a part where there are as many, else all the vertices along the whole path
    const byLine = lines.length > 1 && lines.length === partList.length;
    const groups = byLine
      ? partList.map((part, l) => ({ vertices: waypoints.filter(waypoint => waypoint.line === l), from: part.start, to: part.start + part.positions.length - 1, l }))
      : [{ vertices: waypoints, from: 0, to: colCount - 1, l: -1 }];
    const said = (end: 'starts' | 'ends', l: number) => (l >= 0 ? `Line ${l + 1} of the path ${end}` : `The path ${end}`);
    const whose = (which: 'first' | 'last', l: number) => (l >= 0 ? `its ${which} vertex` : lines.length > 1 ? `the ${which} line's ${which} vertex` : `the line's ${which} vertex`);
    for (const { vertices, from, to, l } of groups) {
      let after = from;
      vertices.forEach((vertex, i) => {
        const end = i === 0 ? from : i === vertices.length - 1 ? to : null;
        if (end !== null) {
          const off = greatCircleKm([vertex.lon, vertex.lat], positions[end]);
          if (off <= near) {
            vertex.col = end;
            after = end;
          } else {
            note(`${said(i === 0 ? 'starts' : 'ends', l)} ${kmText(off)} km from ${whose(i === 0 ? 'first' : 'last', l)}`, placeOf(end));
          }
          return;
        }
        let best = after;
        let bestKm = Infinity;
        for (let col = after; col <= to; col++) {
          const off = greatCircleKm([vertex.lon, vertex.lat], positions[col]);
          if (off < bestKm) {
            bestKm = off;
            best = col;
          }
        }
        if (bestKm <= near) {
          vertex.col = best;
          after = best;
        } else {
          note(`Vertex ${vertex.label} isn't among the positions: the nearest is ${kmText(bestKm)} km from it`, placeOf(best));
        }
      });
    }
    for (const waypoint of waypoints) waypoint.km = waypoint.col === null ? null : km[waypoint.col];
  }

  // Uneven spacing: steps over 2.5 times the usual. A short step is how a path sampled at a fixed step reaches its
  // vertex, so only long ones count. Not where the positions are the vertices alone, which are spaced as asked
  const atVertices = new Set(waypoints.map(waypoint => waypoint.col));
  const verticesOnly = waypoints.length > 0 && positions.every((_, col) => atVertices.has(col));
  const long = gaps.map((gap, i) => (gap.km > spacing.median * 2.5 ? i : -1)).filter(i => i >= 0);
  if (crs.geographic && !verticesOnly && gaps.length >= 3 && spacing.median > 0 && long.length > 0) {
    // Long steps a few apart are one stretch
    const stretches: [number, number][] = [];
    for (const i of long) {
      const last = stretches[stretches.length - 1];
      if (last && i - last[1] <= 3) last[1] = i;
      else stretches.push([i, i]);
    }
    const rest = gaps.filter((_, i) => !stretches.some(([a, b]) => i >= a && i <= b)).map(gap => gap.km);
    const span = (values: number[]) => {
      const [low, high] = [kmText(lowest(values)), kmText(highest(values))];
      return low === high ? low : `${low} to ${high}`;
    };
    const [a, b] = stretches[0];
    const theirs = gaps.slice(a, b + 1).map(gap => gap.km);
    // 1-based, as positions are counted for a reader: the one before the first long step to the one after the last
    const [from, to] = [gaps[a].col, gaps[b].col + 1];
    const apart = theirs.length <= 8 ? listed(theirs.map(kmText)) : span(theirs);
    const usual = rest.length === 0 ? '' : `, where the rest are ${span(rest)}`;
    const others = stretches.length - 1;
    const more = others > 0 ? `, and ${count(others)} more ${one(others, 'stretch is', 'stretches are')} like it` : '';
    note(`Positions ${from} ${to - from === 1 ? 'and' : 'to'} ${to} are ${apart} km apart${usual}${more}`, placeOf(gaps[a].col - 1));
  }

  if (repeats.length > 0) {
    const [{ col, path }] = repeats;
    const others = repeats.length - 1;
    note(`Position ${col + 1} repeats position ${col}${others > 0 ? `, and ${plural(others, 'more position')} ${one(others, 'repeats the one before it', 'repeat the one before them')}` : ''}`, path);
  }

  // Levels: what was asked for and not sent, or none of it, where the response's z is another axis
  const z = hasZ ? readVerticalAxis(json, first) : null;
  // What the response says of z, as a profile's is checked: on its z axis, or in the tuples
  if (z) {
    const domain = domainOf(first);
    const zAt = `${coverages[0].where}/domain/axes/${coverages[0].z ? 'z' : 'composite'}`;
    notes.push(...zFindings(z, zAt, domain && Array.isArray(domain.referencing) ? `${coverages[0].where}/domain/referencing` : '/referencing'));
  }
  let beamFloor: BeamFloor | null = null;
  if (beamSent && !beamFloorFault) {
    if (!z) beamFloorFault = `${BEAM}.floor is a height, and the response has no z, so the lowest beam isn't drawn`;
    else if (z.kind !== 'height') beamFloorFault = `${BEAM}.floor is read as a height, and z here is ${KIND_WORDS[z.kind]}, so the lowest beam isn't drawn`;
    else {
      beamFloor = {
        values: floorValues,
        pathAt(frame, col) {
          const from = floorFrom[frame];
          const c = from && col >= 0 && col < colCount ? from.coverage[col] : -1;
          return c < 0 ? null : `${prefix(c)}/domain/${BEAM}/floor/${from.tuple[col]}`;
        },
      };
    }
  }
  const unit = z?.unit ?? '';
  // Where a missing level would be: on a z axis, or a coverage of the collection's, one per level, or in the tuples
  const levelsAt = coverages.some(coverage => (coverage.z?.length ?? 0) > 1) || (!isCollection && coverages[0].z)
    ? `${coverages[0].where}/domain/axes/z/values`
    : isCollection ? '/coverages' : '/domain/axes/composite/values';
  if (notBack.length > 0) {
    note(`z=${levelsListed(notBack)} ${one(notBack.length, 'was', 'were')} asked for, and ${one(notBack.length, "isn't", "aren't")} in the response`, levelsAt);
  } else if (asked?.kind === 'list' && !asked.values.some(level => sentLevels.has(level))) {
    const span = hasZ ? `, ${formatValue(sent[0])} to ${withUnit(formatValue(sent[sent.length - 1]), unit)}` : '';
    const theirs = hasZ ? "the response's levels" : 'what the response sent, which has no z';
    note(asked.values.length === 1
      ? `z=${asked.values[0]} was asked for, and isn't among ${theirs}${span}`
      : `z=${levelsListed(asked.values)} were asked for, and none of them is among ${theirs}${span}`, hasZ ? levelsAt : `${coverages[0].where}/domain/axes`,
    // EDR /req/edr/z-response: "only resources that have a vertical geometry that intersects the vertical information
    // in the z parameter SHALL be part of the result set", and in 1.2, "If the z parameter is provided and a vertical
    // extent is not defined in a collection, the z value SHALL be ignored". Still a note: the path's z needn't be the z
    // asked for, as radars are asked angles and answer in metres, and nothing here knows the collection's vertical extent
    [EDR.zResponse, EDR.zIgnored]);
  }
  // Two values for one position, level and time: the server's to fix, since a client can't tell which is meant
  if (duplicates > 0) notes.push({ message: `${plural(duplicates, 'value')} ${one(duplicates, 'is', 'are')} sent again for a position, level and time already sent. The first is used`, path: firstDuplicate, severity: 'warning' });

  // A parameter null all along some levels, as FMI's windspeedms is at 50 and 200 hPa. Only a few levels: on most of
  // them it's the response's nulls, which the summary counts
  if (hasZ && sent.length > 1) {
    for (const parameter of parameters) {
      if (parameter.numbers === 0) continue;
      const empty: number[] = [];
      let path = '';
      for (let row = 0; row < levels.length; row++) {
        let any = false;
        let firstNull = '';
        for (let frame = 0; frame < frames.length && !any; frame++) {
          for (let col = 0; col < colCount && !any; col++) {
            const value = parameter.data[frame][row * colCount + col];
            if (value === value && value !== NOT_SENT) any = true;
            else if (!firstNull && value !== NOT_SENT) firstNull = cellAt(parameter.id, frame, row * colCount + col)!.path;
          }
        }
        if (!any && firstNull) {
          empty.push(levels[row] as number);
          path ||= firstNull;
        }
      }
      if (empty.length > 0 && empty.length < sent.length / 3) {
        note(`${parameter.id} is null at every position on ${plural(empty.length, 'level')}: ${levelsListed(empty)}${unit ? ` ${unit}` : ''}`, path);
      }
    }
  }

  // ---- Which picture it is: a line for one level, a track where each position has one level of several ----

  let kind: SectionKind = 'section';
  if (sent.length <= 1) kind = 'line';
  else {
    let most = 0;
    for (let col = 0; col < colCount; col++) {
      let filled = 0;
      for (let row = 0; row < levels.length; row++) filled += sentCells[row * colCount + col];
      most = Math.max(most, filled);
    }
    if (most === 1) kind = 'track';
  }

  const types = new Set(domainTypes);
  const [onlyType] = types;
  return {
    kind,
    domainType: types.size > 1 ? 'Mixed' : typeof onlyType === 'string' && onlyType ? onlyType : 'Coverage',
    coverageCount: coverages.length,
    levels, notBack, z,
    colCount, positions, crs, km, spacing,
    frames, timeAlong,
    parameters, waypoints, breaks, beamFloor, beamFloorFault, notes, cellAt,
  };
}
