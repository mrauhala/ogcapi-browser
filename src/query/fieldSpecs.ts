// What the form shows for a query: a field per query parameter, named as it's sent, in the order the design has them,
// each saying whether it's required, what the collection allows, and what the server does when it's left out. Pure,
// from the metadata: the form puts today's controls inside the fields. Text in `backticks` is shown as code.
import type { Citation, Collection, Temporal, Vertical } from '../types/api';
import { EDR, FEATURES1, RECORDS1 } from '../standards';
import { EDR_QUERY_RULES } from './edrRules';
import { fromItemsLink } from './itemsQuery';
import { effectiveOutputFormats, queryTypeOf, queryVariables, unitsFor } from './queryTypes';
import { timeIsOnlyAFilter } from './queryModel';
import { expandTemporalValues, getOverallTemporalExtent, gridStepMs, listedTimesForm, normalizeTemporal } from '../utils/extents/temporal';
import { getVerticalUnit } from '../utils/extents/vertical';
import { expandCustomDimensionValues, getEffectiveCustomDimensions } from '../utils/extents/custom';
import type { ApiDocsParam, Declarer } from './declared';
import { mapFieldSpecs } from './mapOffer';

export type Requirement = 'required' | 'optional' | 'required by the API docs';

// A line under a field: what the metadata says, or why the field is there, with the rule it rests on
export type Hint = string | { text: string; rule: Citation | readonly Citation[] };

export interface FieldSpec {
  title: string; // in plain words, before the name: Position, Output format, or a dimension's label
  name: string; // as sent: coords, within, parameter-name, datetime, z, member, f
  id: string; // after query-field-, which the status line and the issues jump to: z, dim:member
  requirement: Requirement;
  figure?: string; // what the metadata says, at the right of the name: 13 listed, hPa
  hints: Hint[]; // what the collection allows, then how to fill it in
  link?: { label: string; href: string }; // a custom dimension's reference
  leftOut?: string; // what the server does while the field is empty
  grammar?: string; // the forms a typed value takes, said while the field is empty or wrong
  unit?: FieldSpec; // a size's unit, in the same block and on the same row: within-units with within
  marked?: string; // the value the metadata names as the default, as default_output_format: marked, not sent
  options?: string[]; // the values to pick from where the API docs list them, as a map's f
  choice?: 'one' | 'several'; // how many values it takes, where the form can tell: a map's parameter-name
  axis?: string; // the axis of subset it writes, where it's a field of its own: a map's level, vertical, sent as subset
  declaredBy?: Declarer[]; // who declared it, tagged in its head: a conformance class, a draft profile, the API docs
}

export interface FieldContext {
  apiRequired?: string[]; // the parameters the API docs' operation requires
  hasLocation?: boolean; // a location is picked: a locations query is for its data, not a list
  hasItem?: boolean; // an item is named: an items query is for that one, not a list, and takes only f
  inRequest?: string[]; // the parameters the request line has: a field shows for one the metadata has nothing for
  conformsTo?: readonly string[] | null; // the API's conformance classes, which declare a map's parameters
  apiDocs?: ApiDocsParam[] | null; // the API docs' operation's query parameters, where there's one to read
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
// A time as people read it, in UTC, with the year only where the two ends' years differ
function timeOf(iso: string, withYear: boolean): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const day = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}${withYear ? ` ${date.getUTCFullYear()}` : ''}`;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

// A step between times, as people say it: 5 min, 3 h, 1 day, 36 h
export function stepSaid(ms: number): string {
  const minutes = ms / 60000;
  if (minutes < 1) return `${ms / 1000} s`;
  if (minutes < 60) return `${minutes} min`;
  const days = minutes / (24 * 60);
  if (Number.isInteger(days)) return `${days} day${days === 1 ? '' : 's'}`;
  return `${Number((minutes / 60).toFixed(1))} h`;
}

// A grid's times: how many, their step where it's even, from when to when, and where they're listed
function gridTimesSaid(temporal: Temporal, form: 'coordinates' | 'regular'): string | null {
  const listed = expandTemporalValues(temporal, 100000);
  if (!listed.length) return null;
  const first = listed[0];
  const last = listed[listed.length - 1];
  const withYear = new Date(first).getUTCFullYear() !== new Date(last).getUTCFullYear();
  const step = gridStepMs(temporal);
  const where = form === 'regular' ? 'extent.temporal.grid' : 'extent.temporal.grid.coordinates';
  const span = listed.length === 1 ? timeOf(first, false) + ' UTC' : `${timeOf(first, withYear)} to ${timeOf(last, withYear)} UTC`;
  return `${listed.length} time${listed.length === 1 ? '' : 's'}${step ? `, every ${stepSaid(step)}` : ''}, ${span}, from \`${where}\``;
}

// The times a collection has: how many it lists, and from when to when
export function timesSaid(temporal: Temporal): string | null {
  const form = listedTimesForm(temporal);
  if (form === 'coordinates' || form === 'regular') return gridTimesSaid(temporal, form);
  const normalized = normalizeTemporal(temporal);
  const overall = normalized ? getOverallTemporalExtent(normalized.intervals) : null;
  const listed = temporal.values?.length ? expandTemporalValues(temporal, 2001) : [];
  const first = overall?.[0] ?? listed[0] ?? null;
  const last = overall?.[1] ?? listed[listed.length - 1] ?? null;
  if (!first && !last) return listed.length ? `${listed.length} times listed` : null;
  // An end left open says nothing of the year, so the other end gives its own
  const withYear = !first || !last || new Date(first).getUTCFullYear() !== new Date(last).getUTCFullYear();
  const span = `${first ? timeOf(first, withYear) : 'open'} to ${last ? timeOf(last, withYear) : 'open'} UTC`;
  if (!listed.length) return `From ${span}`;
  return `${listed.length > 2000 ? 'Over 2,000' : listed.length} times listed, ${span}`;
}

// A level's unit: from the vertical reference system, else the query's height units
export function levelUnit(vertical: Vertical, heightUnits: string[]): string {
  return getVerticalUnit(vertical.vrs ?? '') || heightUnits.join(', ');
}

// The levels a collection has, in the order it lists them
export function levelsSaid(vertical: Vertical, unit: string): string | null {
  const values = vertical.values ?? [];
  const tail = unit ? ` ${unit}` : '';
  if (values.length) return `${values.length} level${values.length === 1 ? '' : 's'} listed, ${values[0]} to ${values[values.length - 1]}${tail}`;
  const interval = vertical.interval?.[0];
  return interval ? `From ${interval[0] ?? 'open'} to ${interval[1] ?? 'open'}${tail}` : null;
}

const parameterIds = (collection: Collection): string[] => (Array.isArray(collection.parameter_names)
  ? collection.parameter_names.map(parameter => String(parameter.id))
  : Object.keys(collection.parameter_names ?? {}));

// Each field's title, what the parameter is in plain words; coords by what the query's geometry is
const TITLES: Record<string, string> = {
  bbox: 'Box',
  within: 'Radius',
  'within-units': 'Radius unit',
  'corridor-width': 'Corridor width',
  'width-units': 'Width unit',
  'corridor-height': 'Corridor height',
  'height-units': 'Height unit',
  limit: 'Limit',
  'parameter-name': 'Parameters',
  datetime: 'Time',
  z: 'Levels',
  f: 'Output format',
};
const COORDS_TITLES: Record<string, string> = {
  position: 'Position',
  radius: 'Centre',
  trajectory: 'Path',
  corridor: 'Centre line',
  area: 'Area',
};

// A custom dimension's title: the label its metadata gives, else its id in words (ensemble_member: Ensemble member)
export function dimensionTitle(dimension: { id: string; label?: unknown; title?: unknown }): string {
  const given = [dimension.label, dimension.title].find(each => typeof each === 'string' && each.trim());
  if (typeof given === 'string') return given.trim();
  const words = dimension.id.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : dimension.id;
}

// The geometry's field, and how the map fills it
const GEOMETRY_HINTS: Record<string, string> = {
  position: 'Each click on the map adds a point',
  radius: 'Each click on the map adds a point: the circle is around it',
  trajectory: 'Click points along the path on the map, and double-click to finish',
  corridor: "Click points along the corridor's centre line on the map, and double-click to finish",
  area: 'Click the corners on the map, and double-click to finish each polygon',
};

// What each typed value can be, as EDR has it
const COORDS_GRAMMAR: Record<string, string> = {
  position: 'Typed: `POINT(lon lat)`, or `MULTIPOINT((lon lat),(lon lat))`',
  radius: 'Typed: `POINT(lon lat)`, or `MULTIPOINT((lon lat),(lon lat))`',
  trajectory: 'Typed: `LINESTRING(lon lat, lon lat, …)`',
  corridor: 'Typed: `LINESTRING(lon lat, lon lat, …)`',
  area: 'Typed: `POLYGON((lon lat, …, the first again))`, or `MULTIPOLYGON`',
};
export const DATETIME_GRAMMAR = 'One time, an interval `start/end`, or one open at an end, `start/..` or `../end`';
const LEVEL_GRAMMAR = 'One level, a list `1000,850`, an interval `1000/500`, or `R5/100/50` for 5 levels 50 apart from 100';
const VALUE_GRAMMAR = 'One value, a list `1,2,3`, or an interval `1/5`';

const unitsHint = (offered: string[], variable: string) => (offered.length
  ? `Units from the query's \`${variable}\``
  : `The query lists no \`${variable}\`: type a unit`);

// Why an items query has datetime when its collection gives no time: each standard has every items query take it, so
// it's typed, with nothing to pick from. EDR's items query takes Features' parameters
const ITEMS_TIME = ". The collection's extent gives no time, so there's none to pick: type one";
function itemsTime(collection: Collection): Hint {
  if (collection.itemType === 'record') return { text: `Records servers SHALL support \`datetime\` on items${ITEMS_TIME}`, rule: RECORDS1.datetime };
  if (fromItemsLink(collection)) return { text: `Features servers SHALL support \`datetime\` on items${ITEMS_TIME}`, rule: FEATURES1.timeDefinition };
  return {
    text: `EDR's items query takes the parameters of Features, whose servers SHALL support \`datetime\`${ITEMS_TIME}`,
    rule: [EDR.itemsParameters, FEATURES1.timeDefinition],
  };
}

// The fields a query shows, in order: its geometry, its sizes and their units, then parameter-name, datetime, z, the
// custom dimensions and f
export function fieldSpecs(collection: Collection, queryKey: string, chosen: { parameters: number }, context: FieldContext = {}): FieldSpec[] {
  const queryType = queryTypeOf(collection, queryKey);
  // A map's: its style is a part of the path, and of its parameters those this form has fields for, as declared
  if (queryType === 'map') return mapFieldSpecs(collection, chosen, context);
  const rule = EDR_QUERY_RULES[queryType];
  const variables = queryVariables(collection, queryKey);
  const apiRequired = context.apiRequired ?? [];
  const requirementOf = (name: string): Requirement => (rule?.required.includes(name) ? 'required'
    : apiRequired.includes(name) ? 'required by the API docs' : 'optional');
  const field = (name: string, spec: Partial<FieldSpec> = {}): FieldSpec => ({
    title: TITLES[name] ?? name, name, id: name, requirement: requirementOf(name), hints: [], ...spec,
  });
  const fields: FieldSpec[] = [];
  const extent = collection.extent;
  const oneItem = queryType === 'items' && !!context.hasItem;
  // A Records collection's items are records
  const items = collection.itemType === 'record' ? 'records' : 'items';
  const hasLevels = !!extent?.vertical && !!(extent.vertical.values?.length || extent.vertical.interval?.length);

  if (GEOMETRY_HINTS[queryType]) {
    fields.push(field('coords', { title: COORDS_TITLES[queryType], hints: [GEOMETRY_HINTS[queryType]], grammar: COORDS_GRAMMAR[queryType] }));
  }
  const box = { hints: ['Drag a box on the map, or type its edges'], grammar: 'Typed: `west,south,east,north`, in degrees' };
  if (queryType === 'cube') fields.push(field('bbox', box));
  if (queryType === 'items' && !oneItem) fields.push(field('bbox', { ...box, leftOut: `${items} anywhere` }));

  // A size and its unit: one block, the number then the unit, as they're read. EDR requires the two together
  const sized = (name: string, unitName: string, kind: 'within' | 'width' | 'height', hints: string[]): FieldSpec =>
    field(name, { hints: [...hints, unitsHint(unitsFor(variables, kind), `${kind}_units`)], unit: field(unitName), grammar: 'A number' });
  if (queryType === 'radius') fields.push(sized('within', 'within-units', 'within', ['The map draws the circle once both are set']));
  if (queryType === 'corridor') {
    fields.push(sized('corridor-width', 'width-units', 'width', []));
    // A height needs a level to be measured from, so only collections with levels get one
    if (hasLevels) fields.push(sized('corridor-height', 'height-units', 'height', ['Measured from the level in `z`']));
  }
  if (queryType === 'items' && !oneItem) {
    fields.push(field('limit', { leftOut: `the server decides how many ${items} (often 10)`, grammar: 'A whole number of at least 1' }));
  }

  const selectsData = !rule?.featureList && !(queryType === 'locations' && !context.hasLocation);
  const ids = parameterIds(collection);
  if (selectsData && collection.parameter_names !== undefined) {
    fields.push(field('parameter-name', {
      figure: chosen.parameters ? `${chosen.parameters} of ${ids.length}` : `${ids.length} listed`,
      // EDR 1.1 /req/edr/parameter-name-response A: without parameter-name, all of the collection's parameters
      leftOut: `the server sends all ${ids.length}`,
    }));
  }

  // A field for what the metadata has, or for what the request has though the metadata hasn't
  const inRequest = new Set(context.inRequest ?? []);
  // Every items query takes one, whatever the extent says
  if ((extent?.temporal || inRequest.has('datetime') || queryType === 'items') && queryType !== 'instances' && !oneItem) {
    const said: Hint | null = extent?.temporal ? timesSaid(extent.temporal)
      : queryType === 'items' ? itemsTime(collection) : "The collection's extent has no time";
    const list = timeIsOnlyAFilter(queryType, !!context.hasLocation);
    fields.push(field('datetime', {
      hints: said ? [said] : [],
      leftOut: list ? `no time filter: all ${queryType === 'locations' ? 'locations' : items} are listed` : 'the server decides which times',
      grammar: DATETIME_GRAMMAR,
    }));
  }

  const customs = selectsData ? getEffectiveCustomDimensions(extent) : [];
  if (selectsData && hasLevels && extent?.vertical) {
    const unit = levelUnit(extent.vertical, queryType === 'corridor' ? [] : unitsFor(variables, 'height'));
    const said = levelsSaid(extent.vertical, unit);
    // Polytope's era5-pressure-levels also declares z among its custom dimensions: one field, since both are sent as z
    const twin = customs.find(dimension => dimension.id === 'z');
    const twinCount = twin ? expandCustomDimensionValues(twin, 500).length : 0;
    fields.push(field('z', {
      figure: unit || undefined,
      hints: [
        ...(said ? [said] : []),
        ...(twin ? [`Also declared as a custom dimension \`z\` in \`extent.custom\`, with ${twinCount} value${twinCount === 1 ? '' : 's'}. One field, since both are sent as \`z\``] : []),
      ],
      leftOut: 'the server decides which levels',
      grammar: LEVEL_GRAMMAR,
    }));
  } else if (selectsData && inRequest.has('z')) {
    fields.push(field('z', { hints: ["The collection's extent has no levels"], leftOut: 'the server decides which levels', grammar: LEVEL_GRAMMAR }));
  }
  for (const dimension of customs) {
    if (dimension.id === 'z' && hasLevels) continue;
    const count = expandCustomDimensionValues(dimension, 500).length;
    const reference = dimension.reference ?? '';
    const isLink = /^https?:\/\//.test(reference);
    fields.push({
      title: dimensionTitle(dimension),
      name: dimension.id,
      id: `dim:${dimension.id}`,
      requirement: apiRequired.includes(dimension.id) ? 'required by the API docs' : 'optional',
      figure: count ? `${count} listed` : undefined,
      hints: reference && !isLink ? [`In ${reference}`] : [],
      link: isLink ? { label: 'reference', href: reference } : undefined,
      leftOut: 'the server decides',
      grammar: VALUE_GRAMMAR,
    });
  }

  // A list of locations is GeoJSON whatever the query lists: f isn't sent with it (buildQueryUrl)
  const formats = queryType === 'locations' && !context.hasLocation ? [] : effectiveOutputFormats(collection, queryKey);
  if (formats.length > 0) {
    // The default the query names, else the collection: marked among the formats, sent only once pressed (#196)
    const collectionDefault = (collection as { default_output_format?: unknown }).default_output_format;
    const fromQuery = typeof variables?.default_output_format === 'string' && variables.default_output_format.trim() ? variables.default_output_format : '';
    const named = fromQuery || (typeof collectionDefault === 'string' ? collectionDefault.trim() : '');
    const marked = named ? formats.find(format => format === named) ?? formats.find(format => format.toLowerCase() === named.toLowerCase()) : undefined;
    const whose = fromQuery ? 'the query' : 'the collection';
    fields.push(field('f', {
      hints: named ? [marked
        ? `Marked default: ${whose}'s \`default_output_format\``
        : `${whose[0].toUpperCase()}${whose.slice(1)} names \`${named}\` as \`default_output_format\`, which isn't among its formats`] : [],
      leftOut: "the server's default",
      marked,
    }));
  }
  return fields;
}

// What a collection has, said before a query is picked: its queries draw on these
export function collectionOffers(collection: Collection): string[] {
  const said: string[] = [];
  const ids = parameterIds(collection);
  if (ids.length) said.push(`${ids.length} parameter${ids.length === 1 ? '' : 's'} in \`parameter_names\``);
  const times = collection.extent?.temporal ? timesSaid(collection.extent.temporal) : null;
  if (times) said.push(times);
  const vertical = collection.extent?.vertical;
  const levels = vertical ? levelsSaid(vertical, levelUnit(vertical, [])) : null;
  if (levels) said.push(levels);
  // The collection's own, else those its queries list
  const formats = [...new Set([...(collection.output_formats ?? []), ...Object.keys(collection.data_queries ?? {}).flatMap(key => effectiveOutputFormats(collection, key))])];
  if (formats.length) said.push(`Formats: ${formats.map(format => `\`${format}\``).join(', ')}`);
  return said;
}

// The CRSs a query lists in its crs_details, by the names sent as crs
export function crsOffered(collection: Collection, queryKey: string): string[] {
  const details = queryVariables(collection, queryKey)?.crs_details;
  return Array.isArray(details) ? details.map(detail => detail?.crs).filter((crs): crs is string => typeof crs === 'string' && !!crs.trim()) : [];
}

// The names the form's fields hold for a query. A parameter the request has under any other name is an other
// parameter, under More, sent as typed
export function heldNames(specs: FieldSpec[], queryType: string, crs: string[]): Set<string> {
  return new Set([
    ...specs.flatMap(spec => [spec.name, ...(spec.unit ? [spec.unit.name] : [])]),
    // A cube's box may also go as coords, for servers whose API docs ask for them
    ...(queryType === 'cube' ? ['coords'] : []),
    ...(crs.length > 0 ? ['crs'] : []),
  ]);
}

// Where a query selects data from a collection with neither time nor levels, and the request has neither: one line
// where those fields would be, rather than nothing
export function lacksTimeAndLevels(collection: Collection, specs: FieldSpec[]): boolean {
  const extent = collection.extent;
  const levels = !!extent?.vertical && !!(extent.vertical.values?.length || extent.vertical.interval?.length);
  return !extent?.temporal && !levels && specs.some(spec => spec.name === 'parameter-name')
    && !specs.some(spec => spec.name === 'datetime' || spec.name === 'z');
}
