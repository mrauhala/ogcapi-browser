import type { Collection } from '../types/api';
import { normalizeTemporal, getOverallTemporalExtent, expandTemporalValues } from '../utils/extents/temporal';
import { normalizeVertical, expandVerticalValues } from '../utils/extents/vertical';
import { normalizeBbox } from '../utils/extents/bbox';
import { REPEATING_LEVELS } from './levels';
import { effectiveOutputFormats, parameterIdsOf, unitsFor } from './queryTypes';
import type { QueryModel } from './queryModel';
import type { BBox, IssueSeverity, IssueSource, QueryIssue } from './types';
import { intervalEnds, wholeValue } from './dimensionText';
import { SEVERITY_ORDER } from './types';
import type { ApiDocsCheck } from '../validation/openapi/checkQueryUrl';

// ── Collection extents, computed once per collection (validation runs on every slider tick) ──

interface Range {
  min: number;
  max: number;
}
interface Extents {
  time: Range | null;
  levels: { values: number[]; range: Range | null } | null;
  bbox: [number, number, number, number] | null; // lon/lat, axes sorted
}

const extentsCache = new WeakMap<Collection, Extents>();

// The collection's spatial extent as a sorted lon/lat box, if it has one in lon/lat
export const spatialExtentOf = (collection: Collection): BBox | null => extentsOf(collection).bbox;

const toTime = (value: string | null | undefined, open: number) => {
  if (!value || value === '..') return open;
  const time = Date.parse(value);
  return isNaN(time) ? open : time;
};

function rangeOf(values: number[]): Range | null {
  return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

function extentsOf(collection: Collection): Extents {
  const cached = extentsCache.get(collection);
  if (cached) return cached;
  const extent = collection.extent;

  let time: Range | null = null;
  if (extent?.temporal) {
    const temporal = normalizeTemporal(extent.temporal);
    const overall = temporal ? getOverallTemporalExtent(temporal.intervals) : null;
    time = overall
      ? { min: toTime(overall[0], -Infinity), max: toTime(overall[1], Infinity) }
      : rangeOf(expandTemporalValues(extent.temporal).map(value => Date.parse(value)).filter(t => !isNaN(t)));
  }

  let levels: Extents['levels'] = null;
  if (extent?.vertical) {
    const vertical = normalizeVertical(extent.vertical);
    const values = expandVerticalValues(extent.vertical).map(Number).filter(isFinite);
    // Ends may come in either order: pressure levels run high to low (FMI: [1000, 50])
    const bounds = vertical?.intervals.map(([a, b]) => (a !== null && b !== null
      ? { min: Math.min(a, b), max: Math.max(a, b) }
      : { min: a ?? -Infinity, max: b ?? Infinity })) ?? [];
    levels = {
      values: extent.vertical.values?.length ? values : [],
      range: bounds.length > 0
        ? { min: Math.min(...bounds.map(b => b.min)), max: Math.max(...bounds.map(b => b.max)) }
        : rangeOf(values),
    };
  }

  let bbox: Extents['bbox'] = null;
  const spatial = extent?.spatial;
  if (spatial?.bbox && (!spatial.crs || /CRS84|4326/i.test(spatial.crs))) {
    const boxes = normalizeBbox(spatial.bbox);
    if (boxes && boxes.length > 0) {
      const [x1, y1, x2, y2] = boxes[0];
      bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }
  }

  const result = { time, levels, bbox };
  extentsCache.set(collection, result);
  return result;
}

// ── Checks ──

type Add = (severity: IssueSeverity, source: IssueSource, field: string, rule: string, message: string, input?: QueryIssue['input']) => void;

const inBbox = ([lon, lat]: [number, number], [west, south, east, north]: [number, number, number, number]) =>
  lon >= west && lon <= east && lat >= south && lat <= north;

function checkGeometry(model: QueryModel, add: Add) {
  const { queryType, points, polygons } = model;
  const bbox = extentsOf(model.collection).bbox;

  switch (queryType) {
    case 'position':
    case 'radius':
      if (points.length === 0) add('missing', 'edr', 'coords', 'required', 'Click a point on the map', 'map');
      if (bbox) {
        points.forEach((point, i) => {
          if (!inBbox(point, bbox)) {
            add('warning', 'metadata', 'coords', `outside-${i}`, `Point ${i + 1} is outside the collection's spatial extent`, 'map');
          }
        });
      }
      break;
    case 'trajectory':
      if (points.length < 2) add('missing', 'edr', 'coords', 'required', 'Draw the trajectory on the map (at least 2 points)', 'map');
      break;
    case 'area':
      if (polygons.length === 0) add('missing', 'edr', 'coords', 'required', 'Draw an area on the map', 'map');
      polygons.forEach((polygon, i) => {
        const corners = new Set(polygon.map(([lon, lat]) => `${lon},${lat}`)).size;
        if (corners < 3) add('error', 'edr', 'coords', `corners-${i}`, `Area ${i + 1} needs at least 3 corners`, 'map');
        if (bbox && polygon.length > 0 && !polygon.some(point => inBbox(point, bbox))) {
          add('warning', 'metadata', 'coords', `outside-${i}`, `Area ${i + 1} is outside the collection's spatial extent`, 'map');
        }
      });
      break;
    case 'cube':
      checkBox(model.bbox, bbox, add);
      break;
    case 'corridor':
      if (points.length < 2) add('missing', 'edr', 'coords', 'required', "Draw the corridor's centre line on the map (at least 2 points)", 'map');
      checkLength(model, 'corridor-width', 'width-units', 'width', 'corridor width', add);
      checkCorridorHeight(model, add);
      break;
    case 'items':
      if (model.bbox) checkBox(model.bbox, bbox, add);
      checkLimit(model, add);
      break;
  }

  if (queryType === 'radius') {
    const { value, units } = model.radius;
    if (value === null) add('missing', 'edr', 'within', 'required', 'Set the radius', 'form');
    else if (!(value > 0)) add('error', 'edr', 'within', 'positive', 'The radius must be greater than 0', 'form');
    const offered = unitsFor(model.variables, 'within');
    if (!units) add('missing', 'edr', 'within-units', 'required', 'Pick the unit of the radius', 'form');
    else if (offered.length > 0 && !offered.includes(units)) {
      add('error', 'metadata', 'within-units', 'offered', `Radius unit "${units}" isn't offered by this collection (${offered.join(', ')})`, 'form');
    }
  }
}

// A cube's box: drawn or typed, a real lon/lat box, and over the collection
function checkBox(box: BBox | null, extent: BBox | null, add: Add) {
  if (!box) {
    add('missing', 'edr', 'bbox', 'required', 'Draw a box on the map, or enter its edges', 'map');
    return;
  }
  const [west, south, east, north] = box;
  if ([west, east].some(lon => lon < -180 || lon > 180) || [south, north].some(lat => lat < -90 || lat > 90)) {
    add('error', 'edr', 'bbox', 'range', 'Box edges must be longitudes from -180 to 180 and latitudes from -90 to 90', 'form');
  } else if (west >= east || south >= north) {
    add('error', 'edr', 'bbox', 'order', 'The west edge must be less than the east edge, and the south edge less than the north edge', 'form');
  } else if (extent && (east < extent[0] || west > extent[2] || north < extent[1] || south > extent[3])) {
    add('warning', 'metadata', 'bbox', 'outside', "The box is outside the collection's spatial extent", 'map');
  }
}

// Items come a page at a time: limit sets the page size, else the server picks it (the field says so)
function checkLimit(model: QueryModel, add: Add) {
  const limit = model.queryParams.limit?.trim() ?? '';
  if (limit && (!/^\d+$/.test(limit) || Number(limit) < 1)) {
    add('error', 'edr', 'limit', 'positive', 'The limit must be a whole number of at least 1', 'form');
  }
}

// EDR requires a corridor height, measured from the centre line's level: z, since the map draws a 2D
// line. Without vertical levels there is no such level, and servers reject a height (FMI: "requires
// 3D coords or an explicit z"), so the corridor goes without one.
function checkCorridorHeight(model: QueryModel, add: Add) {
  if (!extentsOf(model.collection).levels) {
    add('info', 'edr', 'corridor-height', 'no-levels',
      'EDR asks for a corridor height, but this collection has no vertical levels, so the corridor is sent without one');
    return;
  }
  checkLength(model, 'corridor-height', 'height-units', 'height', 'corridor height', add);
  if (model.queryParams['corridor-height']?.trim() && !wholeValue(model.vertical)) {
    add('missing', 'edr', 'z', 'corridor-centre', "Pick the level of the corridor's centre: its height is measured from there", 'form');
  }
}

// A size and its unit set in the builder (corridor width and height): EDR requires both
function checkLength(model: QueryModel, field: string, unitField: string, unitKind: 'width' | 'height', label: string, add: Add) {
  const value = model.queryParams[field]?.trim() ?? '';
  if (!value) add('missing', 'edr', field, 'required', `Set the ${label}`, 'form');
  else if (!(Number(value) > 0)) add('error', 'edr', field, 'positive', `The ${label} must be a number greater than 0`, 'form');

  const unit = model.queryParams[unitField]?.trim() ?? '';
  const offered = unitsFor(model.variables, unitKind);
  if (!unit) add('missing', 'edr', unitField, 'required', `Pick the unit of the ${label}`, 'form');
  else if (offered.length > 0 && !offered.includes(unit)) {
    add('error', 'metadata', unitField, 'offered', `Unit "${unit}" isn't offered for the ${label} (${offered.join(', ')})`, 'form');
  }
}

function checkFormat(model: QueryModel, add: Add) {
  const formats = effectiveOutputFormats(model.collection, model.queryKey);
  // Left out, the server's default: the field says so (fieldSpecs)
  if (model.format && formats.length > 0 && !formats.includes(model.format)) {
    add('error', 'metadata', 'f', 'offered', `Output format "${model.format}" isn't offered for this query`, 'form');
  }
}

function checkParameters(model: QueryModel, add: Add) {
  const ids = parameterIdsOf(model.collection);
  if (ids.length === 0) return;
  const unknown = model.parameters.filter(parameter => !ids.includes(parameter));
  if (unknown.length > 0) {
    add('error', 'metadata', 'parameter-name', 'offered', `Unknown parameter${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, 'form');
  }
}

const formatTime = (time: number) => (isFinite(time) ? new Date(time).toISOString().replace(':00.000Z', 'Z') : '…');

function checkDatetime(model: QueryModel, add: Add) {
  if (!model.collection.extent?.temporal) return;
  // Left out, the server decides, or a list isn't filtered: the field says so (fieldSpecs)
  const text = model.datetime.trim();
  if (!text) return;
  const ends = intervalEnds(text);
  if (ends && (!ends.start || !ends.end)) {
    add('missing', 'metadata', 'datetime', 'range', `Pick ${ends.start ? 'an end' : 'a start'} time for the range`, 'form');
    return;
  }
  // `..` is an open end of an interval
  const closed = (ends ? [ends.start, ends.end] : [text]).filter(time => time !== '..');
  const times = closed.map(time => Date.parse(time));
  closed.forEach((time, i) => {
    if (isNaN(times[i])) add('error', 'metadata', 'datetime', `parse-${i}`, `"${time}" isn't a valid date-time`, 'form');
  });
  if (times.some(isNaN)) return;
  if (ends && times.length === 2 && times[0] > times[1]) {
    add('error', 'metadata', 'datetime', 'order', 'The time range starts after it ends', 'form');
  }
  const extent = extentsOf(model.collection).time;
  if (extent && times.some(time => time < extent.min || time > extent.max)) {
    add('warning', 'metadata', 'datetime', 'extent',
      `The selected time is outside the collection's time extent (${formatTime(extent.min)} – ${formatTime(extent.max)})`, 'form');
  }
}

// z and custom dimensions: a range with one end picked, sent as start/ or /end, is missing the other
function checkDimension(text: string, field: string, label: string, add: Add) {
  const ends = intervalEnds(text);
  if (ends && Boolean(ends.start) !== Boolean(ends.end)) {
    add('missing', 'metadata', field, 'range', `Pick ${ends.start ? 'the upper' : 'the lower'} end of the ${label} range`, 'form');
    return false;
  }
  return true;
}

// z as EDR 1.1 has it (/req/edr/z-response): a level, a list of them, a range, or a repeating interval. EDR 1.2 adds
// ranges open at an end, ../level and level/..
function checkVertical(model: QueryModel, add: Add) {
  const levels = extentsOf(model.collection).levels;
  if (!levels || !checkDimension(model.vertical, 'z', 'level', add)) return;
  const value = model.vertical;
  const range = intervalEnds(value);
  const repeating = range ? null : REPEATING_LEVELS.exec(value.trim());
  const items = range ? [range.start, range.end] : repeating ? [repeating[2], repeating[3]] : value.split(',').map(text => text.trim());
  if (!range && !repeating && items.length > 1 && items.some(text => !text)) {
    add('error', 'metadata', 'z', 'empty', `The list of levels "${value}" has an empty entry`, 'form');
  }
  if (repeating && items.some(text => !text.trim())) {
    add('error', 'metadata', 'z', 'empty', `The repeating interval "${value}" needs its lowest level and its step, as R3/500/100`, 'form');
  }
  const chosen = items.filter(text => text && !(range && text === '..'));
  const numbers = chosen.map(Number);
  chosen.forEach((text, i) => {
    if (!isFinite(numbers[i])) add('error', 'metadata', 'z', `number-${i}`, `Level "${text}" isn't a number`, 'form');
  });
  if (numbers.some(n => !isFinite(n))) return;
  const list = !range && !repeating;
  if (list && levels.values.length > 0) {
    const unlisted = chosen.filter((_, i) => !levels.values.includes(numbers[i]));
    if (unlisted.length === 1) add('error', 'metadata', 'z', 'offered', `Level ${unlisted[0]} isn't one of the collection's levels`, 'form');
    else if (unlisted.length > 1) add('error', 'metadata', 'z', 'offered', `Levels ${unlisted.join(', ')} aren't among the collection's levels`, 'form');
  }
  // No order check for ranges: levels can run either way (pressure 1000/500 is a natural range). A repeating interval
  // runs from its lowest level, the number of intervals times its step
  const span = levels.range;
  const ends = repeating && numbers.length === 2 ? [numbers[0], numbers[0] + Number(repeating[1]) * numbers[1]] : numbers;
  if (!span || !ends.some(n => n < span.min || n > span.max)) return;
  const extent = `the collection's vertical extent (${span.min} – ${span.max})`;
  if (list && chosen.length > 1) {
    const outside = chosen.filter((_, i) => numbers[i] < span.min || numbers[i] > span.max);
    add('warning', 'metadata', 'z', 'extent', `${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} outside ${extent}`, 'form');
  } else {
    add('warning', 'metadata', 'z', 'extent', `The selected ${repeating ? 'levels go' : 'level is'} outside ${extent}`, 'form');
  }
}

// What the query is still missing and what looks wrong, by EDR and the collection's metadata
export function validateQuery(model: QueryModel): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const add: Add = (severity, source, field, rule, message, input) =>
    issues.push({ id: `${source}:${field}:${rule}`, severity, source, field, message, input });

  checkGeometry(model, add);
  checkFormat(model, add);
  if (model.rule?.featureList) {
    if (model.datetime.trim()) checkDatetime(model, add);
  } else if (model.queryType !== 'instances') {
    checkParameters(model, add);
    checkDatetime(model, add);
    checkVertical(model, add);
    Object.entries(model.customDims).forEach(([id, text]) => checkDimension(text, `dim:${id}`, id, add));
  }
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const FORM_FIELDS = new Set(['f', 'parameter-name', 'datetime', 'z']);

// Add the API docs' view to the query's own issues. Their issues go under the builder's field names,
// except on a field EDR or the metadata already flags: those are the stronger source, and one issue
// is enough. A parameter EDR requires but the API docs mark optional still counts as missing, noted.
// The model is null for requests that aren't a data query yet (an instance list or description).
export function addApiDocsIssues(model: QueryModel | null, issues: QueryIssue[], check: ApiDocsCheck): QueryIssue[] {
  const optional = new Set((check.operation?.entry.params ?? []).filter(param => param.in === 'query' && !param.required).map(param => param.name));
  const own = issues.map(issue => (issue.severity === 'missing' && optional.has(issue.field)
    ? { ...issue, message: `${issue.message} (the server's API docs mark it optional)` }
    : issue));
  const dimensionIds = new Set([...(model?.collection.extent?.custom ?? []).map(dim => dim.id), ...Object.keys(model?.customDims ?? {})]);
  const flagged = new Set(own.filter(issue => issue.severity !== 'info').map(issue => issue.field));
  const placed = check.issues
    .map(issue => {
      const field = dimensionIds.has(issue.field) ? `dim:${issue.field}` : issue.field;
      const input = FORM_FIELDS.has(field) || field.startsWith('dim:') ? 'form' as const : undefined;
      return { ...issue, id: issue.id.replace(`:${issue.field}:`, `:${field}:`), field, input };
    })
    .filter(issue => !flagged.has(issue.field));
  return [...own, ...placed].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface IssueSummary {
  missing: number;
  error: number;
  warning: number;
  info: number;
  needsAttention: boolean; // something is missing or wrong
}

export function summarizeIssues(issues: QueryIssue[]): IssueSummary {
  const count = (severity: IssueSeverity) => issues.filter(issue => issue.severity === severity).length;
  const summary = { missing: count('missing'), error: count('error'), warning: count('warning'), info: count('info') };
  return { ...summary, needsAttention: summary.missing + summary.error > 0 };
}
