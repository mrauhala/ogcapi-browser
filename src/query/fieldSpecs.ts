// What the form shows for a query: a field per query parameter, named as it's sent, in the order the design has them,
// each saying whether it's required, what the collection allows, and what the server does when it's left out. Pure,
// from the metadata: the form puts today's controls inside the fields. Text in `backticks` is shown as code.
import type { Collection, Temporal, Vertical } from '../types/api';
import { EDR_QUERY_RULES } from './edrRules';
import { effectiveOutputFormats, queryTypeOf, queryVariables, unitsFor } from './queryTypes';
import { timeIsOnlyAFilter } from './queryModel';
import { expandTemporalValues, getOverallTemporalExtent, normalizeTemporal } from '../utils/extents/temporal';
import { getVerticalUnit } from '../utils/extents/vertical';
import { expandCustomDimensionValues, getEffectiveCustomDimensions } from '../utils/extents/custom';

export type Requirement = 'required' | 'optional' | 'required by the API docs';

export interface FieldSpec {
  title: string; // in plain words, before the name: Position, Output format, or a dimension's label
  name: string; // as sent: coords, within, parameter-name, datetime, z, member, f
  id: string; // after query-field-, which the status line and the issues jump to: z, dim:member
  requirement: Requirement;
  figure?: string; // what the metadata says, at the right of the name: 13 listed, hPa
  hints: string[]; // what the collection allows, then how to fill it in
  link?: { label: string; href: string }; // a custom dimension's reference
  leftOut?: string; // what the server does while the field is empty
  unit?: FieldSpec; // a size's unit, in the same block and on the same row: within-units with within
  marked?: string; // the value the metadata names as the default, as default_output_format: marked, not sent
}

export interface FieldContext {
  apiRequired?: string[]; // the parameters the API docs' operation requires
  hasLocation?: boolean; // a location is picked: a locations query is for its data, not a list
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

// The times a collection has: how many it lists, and from when to when
export function timesSaid(temporal: Temporal): string | null {
  const normalized = normalizeTemporal(temporal);
  const overall = normalized ? getOverallTemporalExtent(normalized.intervals) : null;
  const listed = temporal.values?.length ? expandTemporalValues(temporal, 2001) : [];
  const first = overall?.[0] ?? listed[0] ?? null;
  const last = overall?.[1] ?? listed[listed.length - 1] ?? null;
  if (!first && !last) return listed.length ? `${listed.length} times listed` : null;
  const withYear = !!first && !!last && new Date(first).getUTCFullYear() !== new Date(last).getUTCFullYear();
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

const unitsHint = (offered: string[], variable: string) => (offered.length
  ? `Units from the query's \`${variable}\``
  : `The query lists no \`${variable}\`: type a unit`);

// The fields a query shows, in order: its geometry, its sizes and their units, then parameter-name, datetime, z, the
// custom dimensions and f
export function fieldSpecs(collection: Collection, queryKey: string, chosen: { parameters: number }, context: FieldContext = {}): FieldSpec[] {
  const queryType = queryTypeOf(collection, queryKey);
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
  const hasLevels = !!extent?.vertical && !!(extent.vertical.values?.length || extent.vertical.interval?.length);

  if (GEOMETRY_HINTS[queryType]) fields.push(field('coords', { title: COORDS_TITLES[queryType], hints: [GEOMETRY_HINTS[queryType]] }));
  if (queryType === 'cube') fields.push(field('bbox', { hints: ['Drag a box on the map, or type its edges'] }));
  if (queryType === 'items') fields.push(field('bbox', { hints: ['Drag a box on the map, or type its edges'], leftOut: 'items anywhere' }));

  // A size and its unit: one block, the number then the unit, as they're read. EDR requires the two together
  const sized = (name: string, unitName: string, kind: 'within' | 'width' | 'height', hints: string[]): FieldSpec =>
    field(name, { hints: [...hints, unitsHint(unitsFor(variables, kind), `${kind}_units`)], unit: field(unitName) });
  if (queryType === 'radius') fields.push(sized('within', 'within-units', 'within', ['The map draws the circle once both are set']));
  if (queryType === 'corridor') {
    fields.push(sized('corridor-width', 'width-units', 'width', []));
    // A height needs a level to be measured from, so only collections with levels get one
    if (hasLevels) fields.push(sized('corridor-height', 'height-units', 'height', ['Measured from the level in `z`']));
  }
  if (queryType === 'items') {
    fields.push(field('limit', { leftOut: 'the server decides how many items (often 10)' }));
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

  if (extent?.temporal && queryType !== 'instances') {
    const said = timesSaid(extent.temporal);
    const list = timeIsOnlyAFilter(queryType, !!context.hasLocation);
    fields.push(field('datetime', {
      hints: said ? [said] : [],
      leftOut: list ? `no time filter: all ${queryType === 'locations' ? 'locations' : 'items'} are listed` : 'the server decides which times',
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
    }));
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
