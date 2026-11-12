// A map's time, levels, model runs and subset: what the collection's extent lists for each, who declares each axis of
// subset, the fields the form shows for them, and what's wrong with what a request asks. Quoted from OGC API - Maps -
// Part 1: Core 1.0 (OGC 20-058, an approved standard published 2024-08-09); Common Part 2 (OGC 20-024) is a draft and
// is cited only for what the extent's grids and additional dimensions are. The MetOcean Maps profile being drafted has
// a level as subset=vertical(…) and a model run as subset=reference_time(…): those fields say so, and nothing is checked
// against it. Pure.
import type { Collection, DimensionGrid, Temporal } from '../types/api';
import type { QueryIssue } from './types';
import { DATETIME_GRAMMAR, levelUnit, timesSaid, type FieldSpec } from './fieldSpecs';
import { declarersOf, type ApiDocsParam, type Declarer, type Offer } from './declared';
import { intervalEnds } from './dimensionText';
import { axisBody, axisOfPart, isNumber, parsePart, subsetAxes, subsetParts, subsetValue, unquoted } from './subsetText';
import { expandTemporalValues, listedTimesForm } from '../utils/extents/temporal';
import { COMMON2_DRAFT, MAPS1 } from '../standards';

type Json = Record<string, unknown>;
type Scalar = string | number;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: unknown): value is Scalar => (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && !!value.trim());
const RFC3339 = /^\d{4}-\d{2}-\d{2}T/;
// As many of a dimension's values as are worth listing
const MOST = 1000;

// ---- What the extent lists ----

// A dimension's values and where they're listed: its values, as EDR has them, else its grid's coordinates, else its
// regular grid from its first coordinate by its resolution (Common Part 2's grid, a draft)
export interface Listed {
  values: Scalar[];
  from: string; // extent.vertical.values, extent.reference_time.grid.coordinates, extent.x.grid; '' for none
}

export function listedValues(dimension: Json, path: string): Listed {
  if (Array.isArray(dimension.values) && dimension.values.some(isScalar)) return { values: dimension.values.filter(isScalar), from: `${path}.values` };
  const grid = isObject(dimension.grid) ? dimension.grid as DimensionGrid : null;
  if (!grid) return { values: [], from: '' };
  if (Array.isArray(grid.coordinates) && grid.coordinates.some(isScalar)) return { values: grid.coordinates.filter(isScalar), from: `${path}.grid.coordinates` };
  const count = typeof grid.cellsCount === 'number' && grid.cellsCount > 0 ? Math.min(Math.floor(grid.cellsCount), MOST) : 0;
  const { firstCoordinate: first, resolution } = grid;
  if (count && typeof first === 'number' && typeof resolution === 'number') {
    return { values: Array.from({ length: count }, (_, i) => Number((first + i * resolution).toPrecision(12))), from: `${path}.grid` };
  }
  if (count && typeof first === 'string' && typeof resolution === 'string') {
    return { values: expandTemporalValues({ values: [`R${count}/${first}/${resolution}`] }, count), from: `${path}.grid` };
  }
  return { values: [], from: '' };
}

// A dimension of the extent beyond space and time, keyed by its name: Maps 1.0's additional dimensions,
// /req/general-subsetting/uniform-additional-dimensions A, "using the name of the dimension as a key and an object as
// value, with that object containing an interval property", as EDR's vertical and a map collection's reference_time
// are. EDR's custom array, being an array, isn't one
export interface ExtentDimension {
  id: string;
  listed: Listed;
  interval: [Scalar | null, Scalar | null] | null; // the overall interval, the first
  temporal: boolean; // its values are times, written in double quotes
}

const NOT_DIMENSIONS = new Set(['spatial', 'temporal']);
const endOf = (value: unknown): Scalar | null => (isScalar(value) ? value : null);

export function extentDimensions(collection: Collection): ExtentDimension[] {
  const extent = collection.extent;
  if (!isObject(extent)) return [];
  return Object.entries(extent).flatMap(([id, value]) => {
    if (NOT_DIMENSIONS.has(id) || !isObject(value) || !('interval' in value || 'values' in value || 'grid' in value)) return [];
    const listed = listedValues(value, `extent.${id}`);
    const first = Array.isArray(value.interval) && Array.isArray(value.interval[0]) ? value.interval[0] as unknown[] : null;
    const interval: ExtentDimension['interval'] = first && first.length >= 2 ? [endOf(first[0]), endOf(first[1])] : null;
    const sample = listed.values[0] ?? interval?.find(end => end !== null);
    const temporal = typeof value.trs === 'string' || (typeof sample === 'string' && RFC3339.test(sample));
    return [{ id, listed, interval, temporal }];
  });
}

export const dimensionOf = (collection: Collection, id: string): ExtentDimension | null =>
  extentDimensions(collection).find(dimension => dimension.id === id) ?? null;

// The model runs, newest first: extent.reference_time's, as listed. Where they aren't all times, in the reverse of their
// order, as lists run oldest first
export function runsOf(collection: Collection): string[] {
  const runs = (dimensionOf(collection, 'reference_time')?.listed.values ?? []).map(String);
  const times = runs.map(run => Date.parse(run));
  if (times.some(isNaN)) return [...runs].reverse();
  return runs.map((run, i) => ({ run, time: times[i] })).sort((a, b) => b.time - a.time).map(each => each.run);
}

// ---- What a request asks of time and runs, and what goes with it ----

// time, and its aliases: /req/datetime/subset-definition C, "a recommended alias for time (Time, t and T)"
export const TIME_AXES = ['time', 'Time', 't', 'T'];
const timeOf = (value: string) => (value === '*' || value === '..' || !value ? null : Date.parse(unquoted(value)));

// The latest time a request asks: datetime's instant, or its interval's end (its start where the end is open), and a time
// axis's value in subset likewise. Null where it asks none that can be read
export function latestTimeAsked(datetime: string, subset: string): number | null {
  const times: (number | null)[] = [];
  const ends = intervalEnds(datetime);
  if (ends) times.push(timeOf(ends.end) ?? timeOf(ends.start));
  else if (datetime.trim()) times.push(timeOf(datetime.trim()));
  for (const part of subsetParts(subset)) {
    const parsed = parsePart(part);
    if ('error' in parsed || !TIME_AXES.includes(parsed.axis)) continue;
    const [low, high] = parsed.values;
    times.push(timeOf(high ?? low) ?? timeOf(low));
  }
  const read = times.filter((time): time is number => time !== null && !isNaN(time));
  return read.length ? Math.max(...read) : null;
}

// The run a request names in subset, unquoted: null for none, or for * (the latest)
export function runAsked(subset: string): string | null {
  const body = axisBody(subset, 'reference_time');
  return body === null || body === '*' ? null : unquoted(body);
}

// A forecast's times start at its run: so a run can have a time only at or after it, and a time only runs at or before it
export const runsUpTo = (runs: string[], time: number | null): string[] => (time === null ? runs : runs.filter(run => !(Date.parse(run) > time)));

// The time control's times once a run is asked: those from the run on. Null where none is asked. The same object for the
// same extent and run, since the time control works its times out again, and leaves its zoom, for another
type FromRun = { temporal: Temporal; kept: number; of: number };
const fromRunCache = new WeakMap<Temporal, Map<string, FromRun>>();
export function timesFromRun(temporal: Temporal, run: string | null): FromRun | null {
  const from = run === null ? NaN : Date.parse(run);
  if (isNaN(from)) return null;
  const cached = fromRunCache.get(temporal)?.get(run!);
  if (cached) return cached;
  const times = expandTemporalValues(temporal, 100000);
  const kept = times.filter(time => !(Date.parse(time) < from));
  const made = { temporal: { trs: temporal.trs, values: kept }, kept: kept.length, of: times.length };
  fromRunCache.set(temporal, (fromRunCache.get(temporal) ?? new Map()).set(run!, made));
  return made;
}

// ---- Who declares each axis ----

// Whether a CRS is geographic, as Lon and Lat name its axes, or projected, with E and N. CRS84 where none is given, as
// /req/spatial-subsetting/subset-definition G has it. EPSG numbers its geographic CRSs from 4000 to 4999
export function crsKind(crs: string): 'geographic' | 'projected' | 'unknown' {
  const text = crs.trim();
  if (!text || /CRS:?84h?\b/i.test(text)) return 'geographic';
  const epsg = /EPSG(?:\/\d+\/|::?)(\d+)/i.exec(text)?.[1];
  if (!epsg) return 'unknown';
  return Number(epsg) >= 4000 && Number(epsg) < 5000 ? 'geographic' : 'projected';
}

const sameCrs = (a: string, b: string) => {
  const code = (crs: string) => /EPSG(?:\/\d+\/|::?)(\d+)/i.exec(crs)?.[1] ?? (crsKind(crs) === 'geographic' && /84/.test(crs) ? 'CRS84' : crs.trim());
  return !!a.trim() && !!b.trim() && code(a) === code(b);
};

// The axes the API docs' subset names, as its examples write them: name( inside `code`
export function apiDocsAxes(apiDocs: readonly ApiDocsParam[] | null): string[] {
  const description = apiDocs?.find(param => param.name === 'subset')?.description ?? '';
  const axes = new Set<string>();
  for (const span of description.split('`').filter((_, i) => i % 2 === 1)) {
    for (const match of span.matchAll(/([A-Za-z][A-Za-z0-9_]*)\(/g)) axes.add(match[1]);
  }
  return [...axes];
}

// The extent's box has a third dimension: then h, or z in a projected CRS, is an axis too
function spatial3d(collection: Collection): boolean {
  const bbox = collection.extent?.spatial?.bbox;
  const boxes = Array.isArray(bbox?.[0]) ? bbox as number[][] : bbox ? [bbox as number[]] : [];
  return boxes.some(box => box.length === 6);
}

// Who declares each axis a map's subset can take, in the order they're offered: the spatial-subsetting class, Lon and
// Lat in a geographic subset CRS and E and N in a projected one (/req/spatial-subsetting/subset-definition B, "Axis
// names Lat and Lon SHALL be supported for geographic CRS and E and N for projected CRS"), and h or z where the extent's
// box has three dimensions (C); the datetime class, time and its aliases (/req/datetime/subset-definition C, "Time, t
// and T"); the general-subsetting class, each additional dimension of the extent (/req/general-subsetting/
// subset-definition B); the MetOcean Maps draft, vertical and reference_time where the extent has them; and the API
// docs, those their subset names
export function declaredAxes(collection: Collection, offer: Offer, subsetCrs: string): Map<string, Declarer[]> {
  const axes = new Map<string, Declarer[]>();
  const add = (axis: string, by: Declarer) => axes.set(axis, [...(axes.get(axis) ?? []), by]);
  const classOf = (name: string): Declarer | null => {
    const uri = offer.classes?.get(name);
    return uri ? { kind: 'class', name, uri } : null;
  };
  const kind = crsKind(subsetCrs);
  const third = spatial3d(collection);
  // A spatial axis of the other kind of CRS isn't one of the subset CRS's, whoever names it (D)
  const otherKind = new Set([...(kind === 'projected' ? ['Lon', 'Lat', 'h'] : []), ...(kind === 'geographic' ? ['E', 'N', 'z'] : [])]);
  const spatial = classOf('spatial-subsetting');
  if (spatial) {
    const names = [
      ...(kind !== 'projected' ? ['Lon', 'Lat', ...(third ? ['h'] : [])] : []),
      ...(kind !== 'geographic' ? ['E', 'N', ...(third ? ['z'] : [])] : []),
    ];
    names.forEach(name => add(name, spatial));
  }
  const time = classOf('datetime');
  if (time) TIME_AXES.forEach(name => add(name, time));
  const dimensions = extentDimensions(collection).map(dimension => dimension.id);
  const general = classOf('general-subsetting');
  if (general) dimensions.forEach(name => add(name, general));
  if (offer.profile) {
    for (const name of ['vertical', 'reference_time']) if (dimensions.includes(name)) add(name, offer.profile.declarer);
  }
  const docs = offer.apiDocs?.find(param => param.name === 'subset');
  if (docs) apiDocsAxes(offer.apiDocs).filter(name => !otherKind.has(name)).forEach(name => add(name, { kind: 'api-docs', pointer: docs.pointer }));
  return axes;
}

// ---- The axes to pick in subset ----

// What an axis offered adds: the axis over the collection's whole extent, to narrow in the text
export interface AxisChip {
  axis: string;
  body: string;
}

const down = (value: number) => Math.floor(value * 1000) / 1000;
const up = (value: number) => Math.ceil(value * 1000) / 1000;
const span = (low: number, high: number) => `${down(low)}:${up(high)}`;
const ALIASES = new Set(TIME_AXES.slice(1));
const ends = (values: Scalar[], temporal: boolean): [Scalar, Scalar] | null => {
  if (!values.length) return null;
  if (temporal || values.some(value => typeof value === 'string')) return [values[0], values[values.length - 1]];
  const numbers = values as number[];
  return [Math.min(...numbers), Math.max(...numbers)];
};

// Each axis declared that the form can write over the extent, in order, but those with fields of their own; and those
// a class or the draft declares whose extent isn't known, which are typed
export function axisChips(collection: Collection, declared: Map<string, Declarer[]>, subsetCrs: string, own: readonly string[]): { chips: AxisChip[]; typed: string[] } {
  const chips: AxisChip[] = [];
  const typed: string[] = [];
  const spatial = collection.extent?.spatial;
  const bbox = Array.isArray(spatial?.bbox?.[0]) ? spatial!.bbox![0] as number[] : spatial?.bbox as number[] | undefined;
  const lonLat = bbox && bbox.length >= 4 && (!spatial?.crs || crsKind(spatial.crs) === 'geographic') ? bbox : null;
  const storageCrs = (collection as { storageCrs?: unknown }).storageCrs;
  const storageBox = (spatial as { storageCrsBbox?: unknown } | undefined)?.storageCrsBbox;
  const projected = typeof storageCrs === 'string' && sameCrs(subsetCrs, storageCrs) && Array.isArray(storageBox)
    ? (Array.isArray(storageBox[0]) ? storageBox[0] : storageBox) as number[] : null;
  const third = (box: number[] | null) => (box?.length === 6 ? span(box[2], box[5]) : null);
  const geographic = crsKind(subsetCrs) === 'geographic';
  const dimensions = extentDimensions(collection);
  const temporal = collection.extent?.temporal;

  for (const axis of declared.keys()) {
    if (ALIASES.has(axis) || own.includes(axis)) continue;
    let body: string | null = null;
    if (axis === 'Lon' && geographic && lonLat) body = span(lonLat[0], lonLat[lonLat.length === 6 ? 3 : 2]);
    else if (axis === 'Lat' && geographic && lonLat) body = span(lonLat[1], lonLat[lonLat.length === 6 ? 4 : 3]);
    else if (axis === 'h' && geographic) body = third(lonLat);
    else if (axis === 'E' && projected) body = span(projected[0], projected[projected.length === 6 ? 3 : 2]);
    else if (axis === 'N' && projected) body = span(projected[1], projected[projected.length === 6 ? 4 : 3]);
    else if (axis === 'z' && !geographic) body = third(projected);
    else if (axis === 'time' && temporal) {
      const times = expandTemporalValues(temporal, 100000);
      const interval = temporal.interval?.[0];
      const first = times[0] ?? interval?.[0];
      const last = times[times.length - 1] ?? interval?.[1];
      body = first && last ? `${subsetValue(first)}:${subsetValue(last)}` : null;
    } else {
      const dimension = dimensions.find(each => each.id === axis);
      const range = dimension ? ends(dimension.listed.values, dimension.temporal) ?? dimension.interval : null;
      // An end left open is *, "the minimum/maximum value"
      if (range && (range[0] !== null || range[1] !== null)) {
        const write = (value: Scalar | null) => (value === null ? '*' : dimension!.temporal ? `"${value}"` : subsetValue(value));
        body = `${write(range[0])}:${write(range[1])}`;
      }
    }
    if (body) chips.push({ axis, body });
    // One only the API docs name, whose extent isn't known, is left to their words: MeteoCore's name reference_time for
    // every collection, with or without runs
    else if (declared.get(axis)!.some(by => by.kind !== 'api-docs')) typed.push(axis);
  }
  return { chips, typed };
}

// The values to pick of each other dimension of the extent that lists a few: written as the axis's one value
export function dimensionValueChips(collection: Collection, own: readonly string[]): { axis: string; values: string[] }[] {
  return extentDimensions(collection)
    .filter(dimension => !own.includes(dimension.id) && dimension.listed.values.length > 0 && dimension.listed.values.length <= 40)
    .map(dimension => ({ axis: dimension.id, values: dimension.listed.values.map(value => (dimension.temporal ? `"${value}"` : subsetValue(value))) }));
}

// ---- The fields ----

const SUBSET_GRAMMAR = 'Typed: `axis(low:high)` or `axis(value)`, comma-separated, a time in double quotes: `Lon(19:32),Lat(59:70)`, `time("2026-11-10T12:00:00Z")`';

// The levels as the hint says them: how many, from which to which, and where they're listed
function levelsSaid(listed: Listed, unit: string): string {
  const { values, from } = listed;
  if (!values.length) return '';
  return `${values.length} level${values.length === 1 ? '' : 's'} in \`${from}\`, ${values[0]} to ${values[values.length - 1]}${unit ? ` ${unit}` : ''}`;
}

// The fields for a map's time, levels, model run and subset, in order: Time, Level as subset=vertical(…), Level as the
// API docs' elevation, Model run as subset=reference_time(…), Subset. Each shows where it's declared or the request has
// it; a level and a run where the extent has them
export function mapDimensionSpecs(collection: Collection, offer: Offer, inRequest: ReadonlySet<string>, requirementOf: (name: string) => FieldSpec['requirement']): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const docs = (name: string) => offer.apiDocs?.find(param => param.name === name);
  const axes = declaredAxes(collection, offer, '');
  const vertical = dimensionOf(collection, 'vertical');
  const unit = collection.extent?.vertical ? levelUnit(collection.extent.vertical, []) || String(collection.extent.vertical.unit ?? '') : '';
  const levels = vertical?.listed ?? { values: [], from: '' };

  const timeBy = declarersOf('datetime', offer);
  if (timeBy.length || inRequest.has('datetime')) {
    const temporal = collection.extent?.temporal;
    const said = temporal ? timesSaid(temporal) : null;
    const grid = temporal && ['coordinates', 'regular'].includes(listedTimesForm(temporal) ?? '');
    fields.push({
      title: 'Time', name: 'datetime', id: 'datetime', requirement: requirementOf('datetime'),
      hints: said ? [grid ? { text: said, rule: COMMON2_DRAFT.gridDescription } : said] : ["The collection's extent has no time"],
      leftOut: 'the server decides which time',
      grammar: DATETIME_GRAMMAR,
      declaredBy: timeBy,
    });
  }

  if (vertical) {
    fields.push({
      title: 'Level', name: 'subset', axis: 'vertical', id: 'subset:vertical', requirement: requirementOf('subset'),
      figure: unit || undefined,
      options: levels.values.map(String),
      hints: [
        levelsSaid(levels, unit) || "`extent.vertical` lists no levels to pick: type `vertical(…)` in `subset`",
        {
          text: 'As `MetOcean Maps (draft)` has it: `vertical(850)` in `subset`, beside the other axes. `extent.vertical` is an additional '
            + "dimension in Common Part 2's sense (a draft), and Maps 1.0's General Subsetting takes those as axes",
          rule: [COMMON2_DRAFT.additionalDimension, MAPS1.generalSubsetAxes],
        },
      ],
      leftOut: "the server's default level",
      declaredBy: axes.get('vertical') ?? [],
      choice: 'one',
    });
  }

  const elevation = docs('elevation');
  if (elevation) {
    fields.push({
      title: 'Level', name: 'elevation', id: 'elevation', requirement: requirementOf('elevation'),
      figure: unit || undefined,
      options: levels.values.map(String),
      hints: [
        levelsSaid(levels, unit) || "The collection's extent has no levels",
        '`MetOcean Maps (draft)` picks a level with `subset=vertical(…)` instead',
      ],
      leftOut: "the server's default level",
      grammar: 'A number',
      declaredBy: declarersOf('elevation', offer),
      choice: 'one',
    });
  }

  const runs = runsOf(collection);
  const runsFrom = dimensionOf(collection, 'reference_time')?.listed.from;
  if (dimensionOf(collection, 'reference_time')) {
    fields.push({
      title: 'Model run', name: 'subset', axis: 'reference_time', id: 'subset:reference_time', requirement: requirementOf('subset'),
      figure: `${runs.length} listed`,
      options: ['*', ...runs],
      hints: [
        runs.length ? `From \`${runsFrom}\`, newest first` : "`extent.reference_time` lists no runs to pick: type one in `subset`",
        { text: '`Latest` writes `reference_time(*)`: a single `*` is the latest of a temporal dimension', rule: MAPS1.generalSubsetGrammar },
      ],
      leftOut: 'the latest run, as `MetOcean Maps (draft)` has it',
      declaredBy: axes.get('reference_time') ?? [],
      choice: 'one',
    });
  }

  const subsetBy = declarersOf('subset', offer);
  const own = fields.filter(field => field.axis).map(field => `\`${field.axis}\``);
  // The draft declares subset wherever there's a level or a run, so subset has a field beside theirs
  if (subsetBy.length || inRequest.has('subset')) {
    fields.push({
      title: 'Subset', name: 'subset', id: 'subset', requirement: requirementOf('subset'),
      hints: own.length ? [`${own.join(' and ')} ${own.length > 1 ? 'are' : 'is'} picked in ${own.length > 1 ? 'their fields' : 'its field'} above, and written here`] : [],
      leftOut: 'nothing subset: the whole extent',
      grammar: SUBSET_GRAMMAR,
      declaredBy: subsetBy,
    });
  }
  return fields;
}

// ---- What's wrong with a request's subset, levels and run ----

type Add = (issue: Omit<QueryIssue, 'id' | 'input'> & { key: string }) => void;

// A level against the levels listed and their range: one not listed may get nothing back, one outside them is "entirely
// outside the range of valid values", for which General Subsetting asks a 204 or 404
function checkLevel(values: string[], levels: number[], range: [number, number] | null, field: string, add: Add) {
  const numbers = values.filter(value => value !== '*').map(Number);
  if (numbers.some(isNaN)) return;
  if (range && numbers.length && numbers.every(level => level < range[0] || level > range[1])) {
    add({ key: 'extent', severity: 'warning', source: 'metadata', field,
      message: `${numbers.length > 1 ? `The levels ${numbers.join(' to ')} are` : `Level ${numbers[0]} is`} outside the collection's levels (${range[0]} – ${range[1]}): expect a 204 or 404`,
      rule: MAPS1.generalSubsetOutside });
  } else if (numbers.length === 1 && levels.length && !levels.includes(numbers[0])) {
    add({ key: 'offered', severity: 'warning', source: 'metadata', field, message: `Level ${numbers[0]} isn't one of the collection's levels` });
  }
}

// What the form can say of a map's subset, levels and run from the collection alone: the grammar of each part, a level
// not among the levels, a run not among the runs, and a run later than the time asked
export function mapDimensionIssues(collection: Collection, { subset, elevation, datetime }: { subset: string; elevation: string; datetime: string }): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const add: Add = ({ key, ...issue }) => issues.push({ ...issue, id: `${issue.source}:${issue.field}:${key}`, input: 'form' });
  const vertical = dimensionOf(collection, 'vertical');
  const levels = (vertical?.listed.values ?? []).map(Number).filter(level => !isNaN(level));
  const verticalRange = vertical?.interval && typeof vertical.interval[0] === 'number' && typeof vertical.interval[1] === 'number'
    ? [Math.min(vertical.interval[0], vertical.interval[1]), Math.max(vertical.interval[0], vertical.interval[1])] as [number, number]
    : levels.length ? [Math.min(...levels), Math.max(...levels)] as [number, number] : null;

  // The grammar, part by part. A part that isn't one is an error: the server SHALL support the grammar, not other text
  subsetParts(subset).forEach((part, i) => {
    const parsed = parsePart(part);
    if ('error' in parsed) {
      add({ key: `grammar-${i}`, severity: 'error', source: 'maps', field: 'subset', message: parsed.error, rule: [MAPS1.subsetGrammar, MAPS1.generalSubsetGrammar] });
      return;
    }
    if (parsed.axis === 'vertical' && vertical) checkLevel(parsed.values, levels, verticalRange, 'subset:vertical', add);
  });
  const axes = subsetAxes(subset);
  const twice = axes.filter((axis, i) => axes.indexOf(axis) !== i);
  if (twice.length) {
    add({ key: 'twice', severity: 'warning', source: 'maps', field: 'subset', message: `${[...new Set(twice)].join(', ')} ${twice.length > 1 ? 'are' : 'is'} in subset more than once` });
  }

  if (elevation.trim() && isNumber(elevation.trim()) && vertical) checkLevel([elevation.trim()], levels, verticalRange, 'elevation', add);

  // A run not among those listed; one after the time asked, which none of its times can be
  const runs = runsOf(collection);
  const run = runAsked(subset);
  if (run !== null && dimensionOf(collection, 'reference_time')) {
    if (runs.length && !runs.includes(run)) {
      add({ key: 'offered', severity: 'warning', source: 'metadata', field: 'subset:reference_time', message: `The run ${run} isn't among the ${runs.length} runs extent.reference_time lists` });
    }
    const latest = latestTimeAsked(datetime, subset);
    if (latest !== null && Date.parse(run) > latest) {
      add({ key: 'after-time', severity: 'warning', source: 'metadata', field: 'subset:reference_time',
        message: `The run ${run} is later than the time asked, ${new Date(latest).toISOString().replace('.000Z', 'Z')}: its times start at the run. Expect a 4xx` });
    }
  }

  // Another dimension's value not among those it lists
  for (const dimension of extentDimensions(collection)) {
    if (dimension.id === 'vertical' || dimension.id === 'reference_time' || !dimension.listed.values.length) continue;
    const body = axisBody(subset, dimension.id);
    if (body === null || body === '*' || body.includes(':')) continue;
    const listed = dimension.listed.values.map(String);
    if (!listed.includes(unquoted(body)) && !(isNumber(body) && listed.map(Number).includes(Number(body)))) {
      add({ key: `offered-${dimension.id}`, severity: 'warning', source: 'metadata', field: 'subset', message: `${dimension.id}(${body}) isn't one of the values ${dimension.listed.from} lists` });
    }
  }
  return issues;
}

// The sentence of the API docs that says a time in subset doesn't go with datetime, and where: datetime's own, else
// subset's. MeteoCore's datetime says "Not with `subset=time(…)` (400)". Null where neither says so
export function apiDocsTimeClash(apiDocs: readonly ApiDocsParam[] | null): { said: string; pointer: string } | null {
  const NOT = /\bnot\b|n't\b|\bcannot\b|\bnever\b/i;
  for (const [name, other] of [['datetime', /subset/], ['subset', /datetime/]] as const) {
    const param = apiDocs?.find(each => each.name === name);
    const sentence = param?.description?.split(/(?<=[.!?])\s+|\n+/).find(text => other.test(text) && /time/.test(text.replace(/datetime/g, '')) && NOT.test(text));
    if (param && sentence) return { said: sentence.trim(), pointer: param.pointer };
  }
  return null;
}

// The axes of the map's box: those a spatial subset takes, which bbox and center already give
export const SPATIAL_AXES = new Set(['Lon', 'Lat', 'E', 'N', 'h', 'z']);

// What can only be said with the API's conformance, its API docs and the rest of the line: an axis nobody declares, a
// spatial axis with bbox or center, and a time with datetime where the API docs say they don't go together
export function subsetAxisIssues(collection: Collection, offer: Offer, line: { subset: string; datetime: string; bbox: string; center: string; subsetCrs: string }): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const axes = [...new Set(subsetParts(line.subset).map(axisOfPart).filter((axis): axis is string => !!axis))];
  if (!axes.length) return issues;
  const declared = declaredAxes(collection, offer, line.subsetCrs);
  if (offer.classes) {
    const named = [...declared.keys()].filter(axis => !ALIASES.has(axis));
    for (const axis of axes.filter(each => !declared.has(each))) {
      issues.push({
        id: `maps:subset:undeclared-${axis}`, severity: 'warning', source: 'maps', field: 'subset', input: 'form',
        message: `Nobody declares the axis ${axis}: ${named.length ? `those declared are ${named.join(', ')}` : 'no Maps class the API declares, nor the API docs, names one'}. Expect a 4xx`,
        rule: [MAPS1.subsetDefinition, MAPS1.generalSubsetUnknownAxis, MAPS1.datetimeSubsetDefinition],
      });
    }
  }
  // Only where the API declares spatial subsetting, whose rule it is: otherwise these axes are undeclared, and without
  // its conformance nothing can be said
  const spatial = axes.filter(axis => SPATIAL_AXES.has(axis));
  const by = [line.bbox.trim() ? 'bbox' : '', line.center.trim() ? 'center' : ''].filter(Boolean);
  if (spatial.length && by.length && offer.classes?.has('spatial-subsetting')) {
    issues.push({
      id: 'maps:subset:with-bbox', severity: 'error', source: 'maps', field: 'subset', input: 'form',
      message: `${spatial.join(', ')} in subset with ${by.join(' and ')}: Maps 1.0 asks a 4xx for a spatial axis with either`,
      rule: [MAPS1.subsetWithBbox, ...(line.bbox.trim() ? [MAPS1.bboxDefinition] : []), ...(line.center.trim() ? [MAPS1.centerDefinition] : [])],
    });
  }
  const clash = apiDocsTimeClash(offer.apiDocs);
  const time = axes.find(axis => TIME_AXES.includes(axis));
  if (clash && time && line.datetime.trim()) {
    issues.push({
      id: 'openapi:subset:time-with-datetime', severity: 'warning', source: 'openapi', field: 'subset', input: 'form', pointer: clash.pointer,
      // As the docs read: their `code` marks aren't shown in a finding
      message: `${time} in subset with datetime: the API docs say "${clash.said.replace(/`/g, '')}"`,
    });
  }
  return issues;
}

