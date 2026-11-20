// Checks for a map response: what came back, against what was asked and what the API says, each finding citing the rule
// it rests on, mostly in OGC API - Maps - Part 1: Core 1.0 (OGC 20-058, an approved standard published 2024-08-09),
// quoted in standards.ts. Its severity follows the rule's word: a SHALL broken is an error, a SHOULD an issue (warning),
// and what a permission allows, or an aside, a note. A 4xx is read against the request: a refusal the standard asks for
// passes, and one for a request the form judged valid says what in the API suggested it would work, so that a developer
// can tell whether the request or the server is at fault. What's about the request rather than the server goes apart and
// counts for nothing, as does whether the browser could read the headers, which is the server's CORS. Pure.
import type { Citation, Collection, ValidationError } from '../types/api';
import type { ResponseHeader } from '../api/sendRequest';
import type { MapLimits } from '../validation/openapi/operationIndex';
import { COMMON1, MAPS1 } from '../standards';
import { declarersOf, undeclaredIssues, type ApiDocsParam, type Declarer, type Offer } from './declared';
import { mapOffer, mapProfileNames } from './mapOffer';
import { declaredAxes, dimensionOf, SPATIAL_AXES, subsetAxisIssues } from './mapDimensions';
import { CRS84_URI, boxInCrs84, crsCode, isUnsafeCurie, outputCrs, readBox, sameCrs, shortCrs } from './mapBox';
import { linkQuery, mapStylesOf, withLinkQueries, type MapStyle } from './mapQuery';
import { matchDataQuery, readQuerySelections } from './parseQueryUrl';
import { buildQueryModel } from './queryModel';
import { parameterIdsOf, queryTypeOf } from './queryTypes';
import { paramOf, paramsIn } from './requestUrl';
import { axisOfPart, parsePart, subsetIn, subsetParts, unquoted } from './subsetText';
import { spatialExtentOf, validateQuery } from './validateQuery';
import type { QueryIssue } from './types';
import {
  KNOWN, SAME, askedTime, comparedBox, eastFirst, edgePixels, figure, fromLonLatIn, headerOf, lonLatOf, meets,
  placeable, readContentCrs, readMapResponse, readSpan, typedFormat, type Box, type ImageBytes, type ImageFormat,
} from './mapResponse';

export interface MapFindingsInput {
  url: string;
  status: number;
  headers: ResponseHeader[];
  contentType: string;
  // A success's image, its bytes read; null for anything else
  image: ImageBytes | null;
  // The body as text: an error's, or what a success sent that isn't an image
  body: string | null;
  // The collection the request is for, where it's the open one
  collection: Collection | null;
  // The API's conformance, null while it isn't known
  conformsTo: readonly string[] | null;
  // The API docs' operation for the request, null where there's none to read; what they say of the URL; their limits
  apiDocs: ApiDocsParam[] | null;
  apiDocsIssues?: QueryIssue[];
  limits?: MapLimits | null;
}

export interface MapFindings {
  // The response against Maps 1.0 and what the API says: passes, errors, issues and notes about the server
  map: ValidationError[];
  // About the request, not the server: notes, counted for nothing
  request: ValidationError[];
  // Whether the Content-* headers reached the browser
  browser: ValidationError[];
}

type Severity = NonNullable<ValidationError['severity']>;
const finding = (severity: Severity, message: string, rule?: Citation | readonly Citation[]): ValidationError =>
  ({ severity, message, ...(rule && (!Array.isArray(rule) || rule.length) ? { rule } : {}) });

// ---- What the server said ----

// An error's message: the JSON's detail (OGC's exception), description (MeteoCore's), message or title, else the text's
// start. Empty when there's none
export function serverMessage(body: string | null): string {
  const text = body?.trim() ?? '';
  try {
    const json = JSON.parse(text) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const record = json as Record<string, unknown>;
      for (const key of ['detail', 'description', 'message', 'title', 'error']) {
        if (typeof record[key] === 'string' && (record[key] as string).trim()) return (record[key] as string).trim();
      }
    }
  } catch {
    // Not JSON: its text, as it starts
  }
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

// The server's words, after what's said of them as a sentence of their own
const says = (message: string) => (message ? `. The server says: "${message}"` : '');

// Whether a message names a word: as a word of its own, in any letter case, a hyphen or underscore being part of a word
const WORDISH = /[a-z0-9_-]/;
export function mentions(text: string, word: string): boolean {
  const hay = text.toLowerCase();
  const needle = word.trim().toLowerCase();
  if (!needle) return false;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!WORDISH.test(hay[at - 1] ?? ' ') && !WORDISH.test(hay[at + needle.length] ?? ' ')) return true;
  }
  return false;
}

// ---- What the request is, and what the API says of it ----

interface Context {
  url: string;
  // The collection with its map among its queries, where the request is for the open one
  collection: Collection | null;
  offer: Offer;
  // The style in the path, and the collection's own styles list
  styleId: string | null;
  styles: MapStyle[];
  limits: MapLimits | null;
  apiDocsIssues: QueryIssue[];
}

const STYLE_PATH = /\/styles\/([^/]+)\/map\/?$/;
function styleIdOf(url: string): string | null {
  try {
    const id = STYLE_PATH.exec(decodeURIComponent(new URL(url).pathname))?.[1];
    return id ?? null;
  } catch {
    return null;
  }
}

function contextOf(input: MapFindingsInput): Context {
  const collection = input.collection ? withLinkQueries(input.collection) : null;
  return {
    url: input.url,
    collection,
    offer: mapOffer(collection ? mapProfileNames(collection) : [], input.conformsTo, input.apiDocs),
    styleId: styleIdOf(input.url),
    // The collection's own styles, as MeteoCore embeds them; the form reads the styles link, which Checks doesn't fetch
    styles: mapStylesOf((collection as { styles?: unknown } | null)?.styles),
    limits: input.limits ?? null,
    apiDocsIssues: input.apiDocsIssues ?? [],
  };
}

const has = (ctx: Context, name: string) => ctx.offer.classes?.has(name) ?? false;
// A class the rules of which apply: one the API declares, or any while its conformance isn't known
const mayHave = (ctx: Context, ...names: string[]) => ctx.offer.classes === null || names.some(name => has(ctx, name));
const line = (url: string, name: string) => paramsIn(url).filter(([each]) => each === name).map(([, value]) => value).join(',');

// What the form says of the request, as before sending: the collection's lists and Maps 1.0's grammar, the line's
// parameters and subset's axes against the classes and the API docs, and what the API docs say of the URL. What it says
// of the box and size against the rest of the line (bbox with center, a size with a scale, past the limits) is a refusal
// the standards ask for, found before these are read
export function formIssuesOf(ctx: Context): QueryIssue[] {
  const { url, collection, offer } = ctx;
  const issues: QueryIssue[] = [...ctx.apiDocsIssues];
  if (collection) {
    const target = matchDataQuery(url, collection);
    if (target && queryTypeOf(collection, target.queryKey) === 'map') {
      const held = readQuerySelections(url, collection, target.queryKey);
      const model = buildQueryModel({
        collection, queryKey: target.queryKey, format: held.format, parameters: held.parameters, datetime: held.datetime,
        vertical: held.vertical, customDims: held.customDims, points: held.points, polygons: held.polygons, bbox: held.bbox,
        bboxAsCoords: held.bboxAsCoords, radius: { value: held.radius, units: held.radiusUnits ?? '' }, queryParams: held.queryParams,
        locationFeature: null, styleId: target.styleId ?? '', styles: ctx.styles,
      });
      if (model) issues.push(...validateQuery(model));
      issues.push(...subsetAxisIssues(collection, offer, {
        subset: line(url, 'subset'), datetime: line(url, 'datetime'), bbox: line(url, 'bbox'), center: line(url, 'center'), subsetCrs: line(url, 'subset-crs'),
      }));
    }
  }
  issues.push(...undeclaredIssues(paramsIn(url).map(([name]) => name), offer));
  return issues;
}

// ---- Refusals the standards ask for ----

export interface Refusal {
  // What in the request, as said: width=0, bbox with center
  what: string;
  // What's wrong with it, where there's more to say than what it is: it isn't a positive integer
  why?: string;
  // Who asks for the refusal, and what: Maps 1.0 asks a 4xx
  asks: string;
  // What taking it means, where a server may: the server tolerated it, as Common Part 1 lets it
  tolerated?: string;
  rule: Citation | readonly Citation[];
  // Asked with no leeway, so that a 200 breaks it; otherwise a server may tolerate it
  strict: boolean;
  // A 204 or 404 in particular, for values outside an axis's range
  notFound?: boolean;
  // An axis no class the API declares has, that the API docs or the draft profile name as theirs
  namedBy?: Declarer[];
}

const MAPS_4XX = 'Maps 1.0 asks a 4xx';
const positiveInteger = (text: string) => /^\d+$/.test(text) && Number(text) > 0;

// The time an axis's values fall in, from the collection's temporal interval: null where it can't be read
function temporalSpan(collection: Collection | null): [number, number] | null {
  const interval = collection?.extent?.temporal?.interval?.[0];
  if (!Array.isArray(interval)) return null;
  const at = (value: unknown, open: number) => (typeof value === 'string' ? Date.parse(value) : value === null ? open : NaN);
  const span: [number, number] = [at(interval[0], -Infinity), at(interval[1], Infinity)];
  return span.every(value => !Number.isNaN(value)) ? span : null;
}

// What in a request a standard asks a server to refuse: by Maps 1.0, with no leeway (a size that isn't a positive integer
// or is past x-OGC-limits, a size with a box and a scale, bbox with center, a spatial axis with either, an axis no class
// the API declares has, a time or a level outside its axis); by Common Part 1, which lets a server tolerate them (a value
// that isn't one: a box, a time or a subset that can't be read, a CRS the collection doesn't list; a parameter the API
// docs don't name); and past the API docs' maximum, which Maps 1.0 only recommends heeding
export function refusalsAsked(ctx: Context): Refusal[] {
  const { url, collection, offer } = ctx;
  const refusals: Refusal[] = [];
  const text = (name: string) => line(url, name).trim();
  const [bbox, center, scale] = [text('bbox'), text('center'), text('scale-denominator')];
  const subset = subsetIn(url);
  const parts = subsetParts(subset);
  const axes = parts.map(axisOfPart).filter((axis): axis is string => !!axis);

  if (mayHave(ctx, 'scaling', 'spatial-subsetting')) {
    for (const [name, rule] of [['width', MAPS1.widthDefinitionC], ['height', MAPS1.heightDefinitionC]] as const) {
      const value = text(name);
      if (value && !positiveInteger(value)) refusals.push({ what: `${name}=${value}`, why: "it isn't a positive integer", asks: MAPS_4XX, rule, strict: true });
    }
  }
  const sizes = (['width', 'height'] as const).map(name => (positiveInteger(text(name)) ? Number(text(name)) : null));
  const limits = ctx.limits;
  sizes.forEach((value, i) => {
    const name = i === 0 ? 'width' : 'height';
    const most = i === 0 ? limits?.maxWidth : limits?.maxHeight;
    if (value !== null && most && value > most) {
      refusals.push({ what: `${name}=${value}`, why: `it's past x-OGC-limits.maps.max${i === 0 ? 'Width' : 'Height'}, ${most}`, asks: MAPS_4XX,
        rule: i === 0 ? MAPS1.widthDefinitionD : MAPS1.heightDefinitionD, strict: true });
      return;
    }
    const docs = offer.apiDocs?.find(param => param.name === name)?.maximum;
    if (value !== null && docs !== undefined && value > docs) {
      refusals.push({ what: `${name}=${value}`, why: `it's past the API docs' maximum, ${docs}`, asks: 'Maps 1.0 recommends clients keep to it', rule: MAPS1.maxSizeApiDocs,
        strict: false, tolerated: 'the server drew it anyway' });
    }
  });
  if (sizes[0] !== null && sizes[1] !== null && limits?.maxPixels && sizes[0] * sizes[1] > limits.maxPixels) {
    refusals.push({ what: `width × height, ${sizes[0] * sizes[1]} pixels`, why: `it's past x-OGC-limits.maps.maxPixels, ${limits.maxPixels}`, asks: MAPS_4XX,
      rule: [MAPS1.widthDefinitionE, MAPS1.heightDefinitionE], strict: true });
  }
  const area = bbox || axes.some(axis => ['Lon', 'Lat', 'E', 'N'].includes(axis));
  const sized = (['width', 'height'] as const).filter(name => text(name));
  if (sized.length && area && scale && mayHave(ctx, 'scaling')) {
    refusals.push({ what: `${sized.join(' and ')} with ${bbox ? 'bbox' : 'a spatial subset'} and scale-denominator`, asks: MAPS_4XX,
      rule: [...sized.map(name => (name === 'width' ? MAPS1.widthDefinitionF : MAPS1.heightDefinitionF)), MAPS1.scaleDenominatorWithSize], strict: true });
  }
  if (bbox && center && mayHave(ctx, 'spatial-subsetting')) {
    refusals.push({ what: 'bbox with center', asks: MAPS_4XX, rule: [MAPS1.bboxDefinition, MAPS1.centerDefinition], strict: true });
  }
  const spatial = axes.filter(axis => SPATIAL_AXES.has(axis));
  if (spatial.length && (bbox || center) && mayHave(ctx, 'spatial-subsetting')) {
    refusals.push({ what: `${spatial.join(', ')} in subset with ${bbox ? 'bbox' : 'center'}`, asks: MAPS_4XX, rule: MAPS1.subsetWithBbox, strict: true });
  }

  // An axis no class the API declares has. Only where its conformance is known, and subset is a class's
  const subsetClasses = ['spatial-subsetting', 'datetime', 'general-subsetting'].filter(name => has(ctx, name));
  const subsetCrs = text('subset-crs');
  if (offer.classes && subsetClasses.length) {
    const declared = collection ? declaredAxes(collection, offer, subsetCrs) : declaredAxes({ id: '' } as Collection, offer, subsetCrs);
    for (const axis of [...new Set(axes)]) {
      const by = declared.get(axis) ?? [];
      if (by.some(each => each.kind === 'class')) continue;
      const rule = [
        ...(has(ctx, 'spatial-subsetting') ? [MAPS1.subsetDefinition] : []),
        ...(has(ctx, 'datetime') ? [MAPS1.datetimeSubsetDefinition] : []),
        ...(has(ctx, 'general-subsetting') ? [MAPS1.generalSubsetUnknownAxis] : []),
      ];
      const part = parts.find(each => axisOfPart(each) === axis) ?? axis;
      refusals.push({ what: `subset=${part}`, why: `no Maps class the API declares has the axis ${axis}`, asks: MAPS_4XX, rule, strict: !by.length, namedBy: by });
    }
  }

  // A time or a level outside its axis: a 204 or 404
  for (const part of parts) {
    const parsed = parsePart(part);
    if ('error' in parsed) continue;
    if (parsed.axis === 'time' && has(ctx, 'datetime')) {
      const extent = temporalSpan(collection);
      const asked = readSpan(parsed.values.map(value => (value === '*' ? '..' : unquoted(value))).join('/'));
      if (extent && asked && (asked.end < extent[0] || asked.start > extent[1])) {
        refusals.push({ what: `subset=${part}`, why: "it's outside the collection's times", asks: 'Maps 1.0 asks a 204 or 404', rule: MAPS1.timeSubsetOutside, strict: true, notFound: true });
      }
    } else if (collection && has(ctx, 'general-subsetting')) {
      const interval = dimensionOf(collection, parsed.axis)?.interval;
      const numbers = parsed.values.filter(value => value !== '*').map(Number);
      if (interval && typeof interval[0] === 'number' && typeof interval[1] === 'number' && numbers.length && numbers.every(Number.isFinite)) {
        const [low, high] = [Math.min(interval[0], interval[1]), Math.max(interval[0], interval[1])];
        if (numbers.every(value => value < low || value > high)) {
          refusals.push({ what: `subset=${part}`, why: `it's outside extent.${parsed.axis}, ${low} to ${high}`, asks: 'Maps 1.0 asks a 204 or 404', rule: MAPS1.generalSubsetOutside,
            strict: true, notFound: true });
        }
      }
    }
  }

  // Values that aren't ones, which Common Part 1 asks a 400 for, unless the server tolerates them
  const invalid = (what: string, why: string, rule: Citation | readonly Citation[] = COMMON1.invalidValue) =>
    refusals.push({ what, why, asks: 'Common Part 1 asks a 400 for an invalid value', rule, strict: false, tolerated: 'the server tolerated it, as Common Part 1 lets it' });
  const box = readBox(bbox);
  if (box && 'error' in box) invalid(`bbox=${bbox}`, box.error);
  for (const part of parts) {
    const parsed = parsePart(part);
    if ('error' in parsed) invalid(`subset=${part}`, parsed.error);
  }
  const datetime = text('datetime');
  if (datetime && !readSpan(datetime)) invalid(`datetime=${datetime}`, "it isn't an RFC 3339 time or interval");
  const crs = text('crs');
  const listed = (Array.isArray(collection?.crs) ? collection!.crs : []).filter((each): each is string => typeof each === 'string');
  if (crs && collection && (listed.length ? !listed.some(each => sameCrs(each, crs)) : crsCode(crs) !== 'CRS84')) {
    invalid(`crs=${shortCrs(crs)}`, listed.length ? "the collection's crs list doesn't have it" : 'the collection lists no crs, and it isn\'t CRS84', [COMMON1.invalidValue, MAPS1.crsListed]);
  }
  // A parameter nobody declares, where the API docs were read: Common Part 1 asks a 400, unless the server ignores it
  if (offer.apiDocs) {
    for (const issue of undeclaredIssues(paramsIn(url).map(([name]) => name), offer)) {
      refusals.push({ what: issue.field, why: 'no Maps class the API declares, nor the API docs, names it', asks: 'Common Part 1 asks a 400 for a parameter the API docs leave out',
        rule: COMMON1.unknownParameter, strict: false, tolerated: 'the server ignored it, as Common Part 1 lets it' });
    }
  }
  return refusals;
}

// ---- What in the API says a parameter works ----

// The statement of each Maps class that says a parameter SHALL be supported
const SUPPORTED: Readonly<Record<string, Citation>> = {
  width: MAPS1.widthDefinitionA,
  height: MAPS1.heightDefinitionA,
  'scale-denominator': MAPS1.scaleDenominatorDefinition,
  'mm-per-pixel': MAPS1.mmPerPixelDefinition,
  bbox: MAPS1.bboxNumbers,
  'bbox-crs': MAPS1.bboxCrs,
  'subset-crs': MAPS1.subsetCrsDefinition,
  center: MAPS1.centerDefinitionA,
  'center-crs': MAPS1.centerCrsDefinition,
  datetime: MAPS1.datetimeDefinition,
  crs: MAPS1.crsListed,
  bgcolor: MAPS1.bgcolorDefinition,
  transparent: MAPS1.transparentDefinition,
  'void-color': MAPS1.voidColorDefinition,
  'void-transparent': MAPS1.voidTransparentDefinition,
  collections: MAPS1.collectionsParameter,
  orientation: MAPS1.orientation,
  'crs-proj-method': MAPS1.crsProjMethod,
  'crs-proj-params': MAPS1.crsProjParams,
  'crs-proj-center': MAPS1.crsProjCenter,
  'crs-datum': MAPS1.crsDatum,
};

// The rule each class gives an axis of subset
const AXIS_RULE: Readonly<Record<string, Citation>> = {
  'spatial-subsetting': MAPS1.spatialSubsetAxes,
  datetime: MAPS1.timeAxis,
  'general-subsetting': MAPS1.generalSubsetAxes,
};

// What a parameter of the request leans on: what in the API said it works, with that rule's severity, or nothing
export interface Basis {
  // As said: crs=EPSG:3857, subset=vertical(850), the style contours
  what: string;
  // Words the server's message may name it by
  words: string[];
  // What said it works, or null where nothing the API declares does
  said: string | null;
  // What's worth adding, as a sentence of its own
  aside?: string;
  severity: 'error' | 'warning' | 'info';
  rule?: Citation | readonly Citation[];
}

const docsOf = (ctx: Context, name: string) => ctx.offer.apiDocs?.find(param => param.name === name);
const classList = (names: string[]) => names.join(' and ');

// The levels a vertical extent lists, as said
function levelSaid(collection: Collection | null, axis: string, values: string[]): string {
  const listed = collection ? dimensionOf(collection, axis)?.listed : undefined;
  if (!listed?.values.length) return '';
  const shown = values.filter(value => listed.values.map(String).includes(unquoted(value)) || listed.values.map(Number).includes(Number(value)));
  return shown.length === values.length && shown.length ? `, and ${listed.from} lists ${shown.map(unquoted).join(', ')}` : '';
}

function subsetBases(ctx: Context): Basis[] {
  const { collection, offer, url } = ctx;
  const declared = declaredAxes(collection ?? ({ id: '' } as Collection), offer, line(url, 'subset-crs'));
  return subsetParts(subsetIn(url)).flatMap((part): Basis[] => {
    const parsed = parsePart(part);
    if ('error' in parsed) return [];
    const by = declared.get(parsed.axis) ?? [];
    const classes = by.filter((each): each is Extract<Declarer, { kind: 'class' }> => each.kind === 'class').map(each => each.name);
    const base = { what: `subset=${part}`, words: ['subset', parsed.axis, ...parsed.values.map(unquoted)] };
    const listed = levelSaid(collection, parsed.axis, parsed.values);
    if (classes.length) {
      return [{ ...base, severity: 'error' as const, rule: classes.map(name => AXIS_RULE[name]),
        said: `${classList(classes)}, which the API declares, ${classes.length > 1 ? 'make' : 'makes'} ${parsed.axis} an axis${listed}` }];
    }
    if (by.some(each => each.kind === 'api-docs')) {
      return [{ ...base, severity: 'warning' as const, said: `the API docs' subset names the axis ${parsed.axis}${listed}` }];
    }
    if (by.some(each => each.kind === 'profile')) {
      return [{ ...base, severity: 'info' as const,
        said: `the MetOcean Maps draft picks ${parsed.axis === 'vertical' ? 'a level' : 'a model run'} with subset=${parsed.axis}(…)${listed}`,
        aside: "The draft isn't a standard yet, and names no rule to cite" }];
    }
    return [{ ...base, severity: 'info' as const, said: null }];
  });
}

function styleBasis(ctx: Context): Basis | null {
  const id = ctx.styleId;
  if (!id) return null;
  const base = { what: `the style ${id}`, words: ['style', id] };
  const style = ctx.styles.find(each => each.id === id);
  if (!style) return { ...base, severity: 'info', said: null };
  const asked = new Set(paramsIn(ctx.url).map(([name, value]) => `${name}=${value}`));
  const missing = linkQuery(style.href).filter(pair => !asked.has(pair));
  const aside = missing.length ? `Its own map link adds ${missing.join('&')}, which the request doesn't have, so whether its path alone must work is arguable` : undefined;
  if (has(ctx, 'styled-map')) {
    // Its own link asks for more than the path: whether the path alone must work is arguable, so an issue
    return { ...base, severity: missing.length ? 'warning' : 'error', rule: MAPS1.styledMapOperation, aside,
      said: "the collection's styles list has it, and styled-map, which the API declares, has each style's map at …/styles/{styleId}/map" };
  }
  return { ...base, severity: 'warning', said: "the collection's styles list has it", aside };
}

function parameterBasis(ctx: Context, name: string, value: string): Basis {
  const { collection, offer } = ctx;
  const base = { what: `${name}=${value}`, words: [name, value] };
  const docs = docsOf(ctx, name);
  if (name === 'parameter-name') {
    const ids = collection ? parameterIdsOf(collection) : [];
    const names = value.split(',').map(each => each.trim()).filter(Boolean);
    const listed = names.length > 0 && names.every(each => ids.includes(each));
    const words = [...base.words, 'parameter', ...names];
    // One parameter_names doesn't list is flagged by the form, so isn't read here
    if (docs) return { ...base, words, severity: 'warning', said: `the API docs' operation lists parameter-name${listed ? ", and the collection's parameter_names has it" : ''}` };
    if (listed) {
      return { ...base, words, severity: 'info', said: "the collection's parameter_names has it, which the MetOcean Maps draft picks with parameter-name", aside: "The draft isn't a standard yet, and names no rule to cite" };
    }
    return { ...base, words, severity: 'info', said: null };
  }
  if (name === 'f') {
    const words = [...base.words, 'format'];
    if (docs?.enumValues?.includes(value)) return { ...base, words, severity: 'warning', said: "the API docs' f lists it" };
    return { ...base, words, severity: 'info', said: null };
  }
  if (name === 'crs') {
    const listed = (Array.isArray(collection?.crs) ? collection!.crs : []).some(each => typeof each === 'string' && sameCrs(each, value));
    const words = [...base.words, shortCrs(value)];
    const what = `crs=${shortCrs(value)}`;
    if (listed && has(ctx, 'crs')) return { what, words, severity: 'error', rule: MAPS1.crsListed, said: "the collection's crs list has it, and the API declares crs, which makes any CRS listed SHALL be supported" };
    if (listed) return { what, words, severity: 'warning', said: "the collection's crs list has it" };
    return { what, words, severity: 'info', said: null };
  }
  if (name === 'bbox' && has(ctx, 'spatial-subsetting')) {
    const box = boxInCrs84(value, line(ctx.url, 'bbox-crs'));
    const extent = collection ? spatialExtentOf(collection) : null;
    if (box && extent && !(box[0] < extent[2] && extent[0] < box[2] && box[1] < extent[3] && extent[1] < box[3])) {
      return { ...base, severity: 'warning', rule: MAPS1.mapOutsideBounds,
        said: "the box is outside the collection's extent, where spatial-subsetting, which the API declares, recommends a map filled with the background color, or transparent" };
    }
  }
  if (name === 'elevation') {
    const listed = levelSaid(collection, 'vertical', [value]);
    if (docs) return { ...base, severity: 'warning', said: `the API docs' operation lists elevation${listed}` };
  }
  const classes = declarersOf(name, offer).filter((each): each is Extract<Declarer, { kind: 'class' }> => each.kind === 'class').map(each => each.name);
  if (classes.length && SUPPORTED[name]) {
    return { ...base, severity: 'error', rule: SUPPORTED[name], said: `${classList(classes)}, which the API declares, ${classes.length > 1 ? 'have' : 'has'} the server support ${name}` };
  }
  if (docs) return { ...base, severity: 'warning', said: `the API docs' operation lists ${name}` };
  return { ...base, severity: 'info', said: null };
}

// What each part of the request leans on: the style, each parameter, each axis of subset
export function basesOf(ctx: Context): Basis[] {
  const style = styleBasis(ctx);
  const bases: Basis[] = style ? [style] : [];
  for (const [name, value] of paramsIn(ctx.url)) {
    if (name && name !== 'subset') bases.push(parameterBasis(ctx, name, value));
  }
  return [...bases, ...subsetBases(ctx)];
}

// ---- A refusal ----

// A refusal as said after its status: width=0: it isn't a positive integer, and Maps 1.0 asks a 4xx
const refusalSaid = (refusal: Refusal) => `${refusal.what}: ${refusal.why ? `${refusal.why}, and ` : ''}${refusal.asks}`;

function refusalFindings(input: MapFindingsInput, ctx: Context, found: MapFindings) {
  const { status } = input;
  const message = serverMessage(input.body);
  const refusals = refusalsAsked(ctx);
  if (refusals.length) {
    for (const refusal of refusals) {
      found.map.push(finding(refusal.notFound && status !== 404 ? 'error' : 'pass', `${status} for ${refusalSaid(refusal)}${says(message)}`, refusal.rule));
      // An axis the API docs or the draft name: by them, it should have worked
      if (refusal.namedBy?.some(each => each.kind === 'api-docs')) {
        found.map.push(finding('warning', `${refusal.what} is in the API docs' subset, which names the axis: by the server's own docs, it should have worked`));
      } else if (refusal.namedBy?.length) {
        const part = parsePart(refusal.what.slice('subset='.length));
        const axis = 'error' in part ? '' : part.axis;
        const picks = axis === 'vertical' ? 'a level' : axis === 'reference_time' ? 'a model run' : 'it';
        const listed = 'error' in part ? '' : levelSaid(ctx.collection, axis, part.values);
        found.map.push(finding('info', `${refusal.what} should have worked by the MetOcean Maps draft, which picks ${picks} with subset=${axis}(…)${listed}. `
          + `The draft isn't a standard yet; in Maps 1.0, general-subsetting, which the API doesn't declare, would make ${axis} an axis`));
      }
    }
    return;
  }

  // What the form flagged before sending, which the refusal is likely for: about the request
  const flagged = formIssuesOf(ctx).filter(issue => issue.severity !== 'info');
  const flaggedNames = new Set(flagged.map(issue => issue.field.split(':')[0]));
  if (flagged.length) {
    const rules = flagged.flatMap(issue => (issue.rule === undefined ? [] : Array.isArray(issue.rule) ? issue.rule : [issue.rule as Citation]));
    found.request.push(finding('info', `${status}, which the form expected: before sending, it said ${flagged.map(issue => issue.message.replace(/\.$/, '')).join('; ')}${says(message)}`,
      [...new Set(rules)]));
  }
  // What the server's message names that the form found nothing wrong with: what said it works
  const bases = basesOf(ctx);
  const named = bases.filter(basis => basis.words.some(word => mentions(message, word))
    && !flaggedNames.has(basis.what.startsWith('the style') ? 'style' : basis.what.split('=')[0]));
  for (const basis of named) {
    if (basis.said === null) {
      found.request.push(finding('info', ctx.offer.classes === null && !ctx.offer.apiDocs
        ? `${status} for ${basis.what}: the API's conformance and its API docs aren't known here, so nothing says whether it should have worked${says(message)}`
        : `${status} for ${basis.what}, which nothing the API declares names${says(message)}`));
    } else {
      found.map.push(finding(basis.severity, `${status} for ${basis.what}, though ${basis.said}${basis.aside ? `. ${basis.aside}` : ''}${says(message)}`, basis.rule));
    }
  }
  if (named.length || flagged.length) return;
  if (!bases.length) {
    found.map.push(finding('error', `${status} for the collection's own map, with nothing asked of it: Maps 1.0 says every map SHALL be available at its /map${says(message)}`, MAPS1.mapOperation));
    return;
  }
  // The message names nothing the request has: what the API says of each, for the developer to compare
  const supported = bases.filter(basis => basis.said !== null);
  const each = supported.map(basis => `${basis.what}: ${basis.said}`).join('; ');
  const rules = [...new Set(supported.flatMap(basis => (basis.rule === undefined ? [] : Array.isArray(basis.rule) ? basis.rule : [basis.rule as Citation])))];
  found.map.push(finding('warning', `${status} for a request the form found nothing wrong with, and the server's message names none of its parameters${says(message)}${each ? `. What the API says of each: ${each}` : ''}`, rules));
}

// ---- A success ----

// Which headers the browser was let read: Access-Control-Expose-Headers, where the browser was let read that
interface Exposure { said: string | null; all: boolean; names: Set<string> }
function exposureOf(headers: ResponseHeader[]): Exposure {
  const said = headerOf(headers, 'access-control-expose-headers');
  const names = new Set((said ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
  return { said, all: names.has('*'), names };
}
// A header the server didn't send, as far as can be told: the browser would have been let read it
const surelyMissing = (exposure: Exposure, name: string) => exposure.all || exposure.names.has(name.toLowerCase());

const CONTENT_RULES: Partial<Record<ImageFormat, Citation>> = { PNG: MAPS1.pngContent, JPEG: MAPS1.jpegContent };

const unitOf = (crs: string) => {
  const known = KNOWN[crsCode(crs) ?? ''];
  return known ? (known.unit === '°' ? '°' : ' m') : ` in ${shortCrs(crs)}'s units`;
};

function successFindings(input: MapFindingsInput, ctx: Context, found: MapFindings) {
  const { url, status, headers, image, collection } = input;
  const message = serverMessage(input.body);
  const refusals = refusalsAsked(ctx);
  const notFound = refusals.filter(refusal => refusal.notFound);
  if (status === 204) {
    found.map.push(...(notFound.length
      ? notFound.map(refusal => finding('pass', `204, no map, for ${refusalSaid(refusal)}`, refusal.rule))
      : [finding('error', '204, no map: a successful map is a 200', MAPS1.mapResponseA)]));
    return;
  }
  found.map.push(status === 200 ? finding('pass', 'Status 200', MAPS1.mapResponseA) : finding('error', `Status ${status}: a successful map is a 200`, MAPS1.mapResponseA));
  for (const refusal of refusals) {
    if (refusal.strict) {
      found.map.push(finding('error', `${status} for ${refusalSaid(refusal)}`, refusal.rule));
    } else if (refusal.namedBy?.length) {
      const by = refusal.namedBy.some(each => each.kind === 'api-docs') ? "the API docs' subset names" : 'the MetOcean Maps draft names';
      found.map.push(finding('info', `${status} for ${refusal.what}, an axis ${by}, though ${refusal.why}, where ${refusal.asks}: general-subsetting would make it Maps 1.0's`));
    } else {
      found.map.push(finding('info', `${status} for ${refusal.what}, though ${refusal.why}: ${refusal.tolerated ?? 'the server took it'}`, refusal.rule));
    }
  }

  // The Content-Type, and the body it says
  const typed = input.contentType.split(';')[0].trim().toLowerCase();
  const asked = paramOf(url, 'f')?.trim() ?? '';
  if (!typed.startsWith('image/')) {
    if (asked && asked.toLowerCase() === typed) found.map.push(finding('pass', `Content-Type ${typed}, as f asked`, MAPS1.mapResponseI));
    else {
      const start = message ? `: it starts with ${message.slice(0, 60)}` : '';
      found.map.push(finding('error', `Content-Type ${typed || 'none'}: a map's 200 is the map itself, encoded as an image${start}`, MAPS1.mapResponseI));
    }
  } else {
    const format = typedFormat(input.contentType);
    const asF = asked && asked.toLowerCase() === typed ? ', as f asked' : '';
    if (asked && !asF) found.map.push(finding('warning', `f=${asked} asked, and the Content-Type is ${typed}`, MAPS1.mapResponseI));
    if (!format) found.map.push(finding('pass', `Content-Type ${typed}${asF}: an image, whose bytes the app doesn't read`, MAPS1.mapResponseI));
    else if (!image || image.format === null) {
      found.map.push(finding('error', `Content-Type ${typed}, and the body isn't a ${format}: it starts with ${image?.start ?? 'nothing'}`, CONTENT_RULES[format] ?? MAPS1.mapResponseI));
    } else if (image.format !== format) {
      found.map.push(finding('error', `Content-Type ${typed}, and the body is a ${image.format}`, CONTENT_RULES[format] ?? MAPS1.mapResponseI));
    } else {
      found.map.push(finding('pass', `Content-Type ${typed}${asF}, and the body is a ${format}`, CONTENT_RULES[format] ? [MAPS1.mapResponseI, CONTENT_RULES[format]!] : MAPS1.mapResponseI));
    }
  }
  if (!image) {
    headerFindings(input, ctx, null, found);
    return;
  }

  const reading = readMapResponse({ url, headers, contentType: input.contentType, image, collection });
  // The size, against what was asked, or the one the server chose
  const sides = (['width', 'height'] as const).flatMap(name => {
    const value = line(url, name).trim();
    return positiveInteger(value) ? [{ name, asked: Number(value), got: name === 'width' ? image.width : image.height }] : [];
  });
  const sized = image.width !== null && image.height !== null;
  const rulesB = sides.map(side => (side.name === 'width' ? MAPS1.widthDefinitionB : MAPS1.heightDefinitionB));
  if (sized && sides.length) {
    const names = sides.map(side => side.name).join(' and ');
    if (sides.every(side => side.asked === side.got)) found.map.push(finding('pass', `The image is ${image.width} × ${image.height}, the ${names} asked`, rulesB));
    else found.map.push(finding('error', `The image is ${image.width} × ${image.height}, not the ${sides.map(side => `${side.name} ${side.asked}`).join(' and ')} asked`, rulesB));
  }
  const { box, pixel, crs } = reading;
  const square = sized && box && pixel ? Math.max(1, Math.round(image.width! * (box[3] - box[1]) / (box[2] - box[0]))) : null;
  const size = pixel ? `${figure(pixel[0])}${unitOf(crs)} wide and ${figure(pixel[1])}${unitOf(crs)} tall` : '';
  if (square !== null && sides.length < 2) {
    const left = ['width', 'height'].filter(name => !sides.some(side => side.name === name)).join(' or ');
    found.map.push(square === image.height
      ? finding('pass', `With no ${left} asked, the server chose ${image.width} × ${image.height}, which keeps pixels square`, MAPS1.mapOp)
      : finding('warning', `With no ${left} asked, the server chose ${image.width} × ${image.height}, whose pixels aren't square: ${size}. ${square} tall would keep the box's shape`, MAPS1.mapOp));
  }
  const boxAsAsked = headerFindings(input, ctx, reading.box, found);
  // The size asked, drawn as asked over the box asked, isn't the box's shape: the request's doing
  if (square !== null && square !== image.height && sides.length === 2 && sides.every(side => side.asked === side.got) && boxAsAsked) {
    found.request.push(finding('info', `Pixels aren't square: ${size}, since ${image.width} × ${image.height} isn't the box's shape. ${square} tall would keep it`));
  }
}

// Content-Crs, Content-Bbox and Content-Datetime, each where the browser could read it, and whether it could. Gives whether
// Content-Bbox is the box asked, or with none, covers the collection's: the image's shape is then the request's doing
function headerFindings(input: MapFindingsInput, ctx: Context, box: Box | null, found: MapFindings): boolean {
  const { url, headers, collection, image } = input;
  const exposure = exposureOf(headers);
  const unread: string[] = [];
  const reached: string[] = [];
  let boxAsAsked = false;

  // Content-Crs, against the crs asked, else the storage CRS, else CRS84
  const crsHeader = headerOf(headers, 'content-crs');
  const crs = crsHeader === null ? CRS84_URI : readContentCrs(crsHeader);
  const askedCrs = paramOf(url, 'crs')?.trim() ?? '';
  const out = askedCrs ? { crs: askedCrs, said: 'the crs asked', rule: MAPS1.crsMapSuccess }
    : collection ? (() => {
      const { crs: expected, from } = outputCrs(collection, '');
      return { crs: expected, said: from === 'storageCrs' ? 'storageCrs, as no crs was asked' : 'CRS84, as no crs was asked and the collection has no storageCrs', rule: MAPS1.mapResponseB };
    })() : null;
  const expectedSaid = (whole: string) => whole.split(',')[0];
  if (crsHeader !== null) {
    reached.push('Content-Crs');
    if (isUnsafeCurie(crs)) {
      found.map.push(finding('error', `Content-Crs ${crs} is an unsafe CURIE: Maps 1.0 asks for the URI or a safe CURIE, [${crs}]`, MAPS1.mapResponseC));
    } else if (!out) {
      found.map.push(finding('pass', `Content-Crs ${shortCrs(crs)}`, MAPS1.mapResponseC));
    } else if (sameCrs(crs, out.crs)) {
      found.map.push(finding('pass', `Content-Crs is ${expectedSaid(out.said)}, ${shortCrs(out.crs)}`, [MAPS1.mapResponseC, out.rule]));
    } else {
      found.map.push(finding('error', `Content-Crs is ${shortCrs(crs)}, not ${expectedSaid(out.said)}, ${shortCrs(out.crs)}`, out.rule));
    }
  } else if (surelyMissing(exposure, 'content-crs')) {
    found.map.push(!out || sameCrs(out.crs, CRS84_URI)
      ? finding('warning', 'No Content-Crs: the map reads as CRS84, which Maps 1.0 recommends saying too', MAPS1.contentCrs)
      : finding('error', `No Content-Crs, so the map reads as CRS84, where ${expectedSaid(out.said)} is ${shortCrs(out.crs)}`, [MAPS1.mapResponseC, out.rule]));
  } else {
    unread.push('Content-Crs');
  }

  // Content-Bbox: four numbers in the map's CRS, against the bbox asked, or with none, the collection's extent
  const bboxHeader = headerOf(headers, 'content-bbox');
  const code = crsCode(crs);
  if (bboxHeader !== null) {
    reached.push('Content-Bbox');
    const parts = bboxHeader.split(',').map(part => part.trim());
    const known = KNOWN[code ?? ''];
    const latitudes = known?.unit === '°' && parts.length === 4 ? (known.northFirst ? [0, 2] : [1, 3]).map(i => Number(parts[i])) : [];
    if (parts.length !== 4 || parts.some(part => !part || !Number.isFinite(Number(part)))) {
      found.map.push(finding('error', `Content-Bbox ${bboxHeader} isn't four numbers`, MAPS1.mapResponseE));
    } else if (latitudes.some(value => Math.abs(value) > 90)) {
      found.map.push(finding('error', `Content-Bbox ${bboxHeader} isn't in ${shortCrs(crs)}'s order: ${latitudes.find(value => Math.abs(value) > 90)} can't be a latitude, which ${shortCrs(crs)} has ${known!.northFirst ? 'first' : 'second'}`, MAPS1.mapResponseE));
    } else if (box) {
      boxAsAsked = bboxFindings(url, collection, crs, box, image, found);
    }
  } else if (surelyMissing(exposure, 'content-bbox')) {
    found.map.push(finding('error', 'No Content-Bbox: the map has no box to be placed by', MAPS1.mapResponseD));
  } else {
    unread.push('Content-Bbox');
  }

  // Content-Datetime, where the map has a time, against the datetime or subset time asked
  const timeHeader = headerOf(headers, 'content-datetime');
  const askedT = askedTime(url);
  const hasTime = !!collection?.extent?.temporal || !!askedT;
  if (timeHeader !== null) {
    reached.push('Content-Datetime');
    datetimeFindings(timeHeader, askedT, found);
  } else if (hasTime && surelyMissing(exposure, 'content-datetime')) {
    found.map.push(finding('error', `No Content-Datetime, though ${askedT ? `${askedT.from} asked ${askedT.text}` : 'the collection has a temporal extent'}`, MAPS1.mapResponseF));
  } else if (hasTime) {
    unread.push('Content-Datetime');
  }

  // What the browser could read
  const cors = has(ctx, 'cors') ? MAPS1.cors : undefined;
  const listed = (names: string[]) => names.join(', ').replace(/, ([^,]*)$/, ' and $1');
  const exposed = exposure.said !== null ? `: Access-Control-Expose-Headers: ${exposure.said}` : '';
  if (unread.length) {
    const they = unread.length > 1 ? 'them' : 'it';
    found.browser.push(finding('info', `${listed(unread)} didn't reach the browser: the server didn't send ${they}, or didn't expose ${they} with Access-Control-Expose-Headers${exposure.said !== null ? ` (${exposure.said})` : ''}. Not checked`, cors));
    if (reached.length) found.browser.push(finding('pass', `${listed(reached)} reached the browser`, cors));
  } else if (reached.length) {
    found.browser.push(finding('pass', `${listed(reached)} reached the browser${exposed}`, cors));
  }
  return boxAsAsked;
}

// A box as Content-Bbox writes it, in its CRS's own order
const paramOfBox = (box: Box, crs: string) => eastFirst(box, crs).map(edge => String(Number(edge.toPrecision(12)))).join(',');

// Whether the box is the one asked, or with none asked, covers the collection's
function bboxFindings(url: string, collection: Collection | null, crs: string, box: Box, image: ImageBytes | null, found: MapFindings): boolean {
  const structure = [MAPS1.mapResponseD, MAPS1.mapResponseE];
  const compared = comparedBox(url, collection, crs);
  const short = shortCrs(crs);
  if ('none' in compared) {
    found.map.push(finding('pass', `Content-Bbox has four numbers, in ${short}`, structure));
    return true;
  }
  // The box compared with, in the response's CRS, east first: converted where both CRSs are ones the app knows
  const code = placeable(crs);
  const from = placeable(compared.crs);
  const other: Box | null = code && from ? fromLonLatIn(lonLatOf(eastFirst(compared.box, compared.crs), from), code)
    : sameCrs(compared.crs, crs) ? eastFirst(compared.box, compared.crs) : null;
  const asked = compared.said === 'bbox asked';
  if (!other) {
    found.map.push(finding('pass', `Content-Bbox has four numbers, in ${short}; the ${compared.said} is in ${shortCrs(compared.crs)}, which the app can't turn into ${short} to compare`, structure));
    return true;
  }
  const sized = image?.width && image.height ? image : null;
  const pixel: [number, number] = sized ? [(box[2] - box[0]) / sized.width!, (box[3] - box[1]) / sized.height!] : [(box[2] - box[0]) * 1e-6, (box[3] - box[1]) * 1e-6];
  const by = (most: number) => (sized ? `, by up to ${figure(most)} px` : '');
  const EDGE = ['west', 'south', 'east', 'north'];
  const edgesSaid = (off: string[]) => (off.length === 4 ? 'every edge' : `its ${off.join(', ').replace(/, ([^,]*)$/, ' and $1')} edge${off.length === 1 ? '' : 's'}`);
  if (asked) {
    if (!meets(box, other)) {
      // Written in the other order: the box asked, its axes swapped
      const swapped: Box = [box[1], box[0], box[3], box[2]];
      const known = KNOWN[code ?? crsCode(crs) ?? ''];
      if (known && edgePixels(other, swapped, [pixel[1], pixel[0]]).every(apart => Math.abs(apart) < SAME)) {
        found.map.push(finding('error', `Content-Bbox ${paramOfBox(box, crs)} is the bbox asked in the other axis order: ${short} has ${known.unit === '°' ? (known.northFirst ? 'latitude' : 'longitude') : `its ${known.northFirst ? 'north' : 'east'} axis`} first`, MAPS1.mapResponseE));
        return false;
      }
      found.map.push(finding('error', "Content-Bbox doesn't meet the bbox asked: the map is of somewhere else", MAPS1.spatialMapSuccess));
      return false;
    }
    const apart = edgePixels(other, box, pixel).map(Math.abs);
    const off = EDGE.filter((_, i) => !(apart[i] < SAME));
    const text = paramOf(url, 'bbox')?.trim() ?? '';
    if (!off.length) {
      found.map.push(finding('pass', `Content-Bbox has four numbers, and is the bbox asked, ${text}`, [...structure, MAPS1.spatialMapSuccess]));
      return true;
    }
    found.map.push(finding('pass', `Content-Bbox has four numbers, in ${short}`, structure));
    found.map.push(finding('info', `Content-Bbox isn't quite the bbox asked: ${edgesSaid(off)}${by(Math.max(...apart))}`, MAPS1.spatialMapSuccess));
    return false;
  }
  // None asked: the whole map, which should cover the extent. An edge short of it by a tenth of a pixel or more
  const short_ = [other[0] - box[0], other[1] - box[1], box[2] - other[2], box[3] - other[3]].map((gap, i) => -gap / pixel[i % 2]);
  const off = EDGE.filter((_, i) => short_[i] >= SAME);
  if (!off.length) {
    found.map.push(finding('pass', `Content-Bbox has four numbers, and with no box asked covers the ${compared.said}`, [...structure, MAPS1.wholeMap]));
    return true;
  }
  found.map.push(finding('pass', `Content-Bbox has four numbers, in ${short}`, structure));
  found.map.push(finding('warning', `With no box asked, Content-Bbox leaves out part of the ${compared.said}: ${edgesSaid(off)}${by(Math.max(...short_))}`, MAPS1.wholeMap));
  return false;
}

function datetimeFindings(received: string, asked: ReturnType<typeof askedTime>, found: MapFindings) {
  const got = readSpan(received);
  if (!got) {
    found.map.push(finding('error', `Content-Datetime ${received} isn't an RFC 3339 time, or two with a / between`, [MAPS1.mapResponseG, MAPS1.mapResponseH]));
    return;
  }
  const wanted = asked ? readSpan(asked.text) : null;
  if (!asked || !wanted) {
    found.map.push(finding('pass', `Content-Datetime ${received}, the server's choice with ${asked ? `a ${asked.from} it can't be compared with` : 'no time asked'}`, [MAPS1.mapResponseF, MAPS1.mapResponseH]));
    return;
  }
  const what = asked.from === 'datetime' ? 'datetime' : 'subset time';
  if (wanted.start === got.start && wanted.end === got.end) {
    found.map.push(finding('pass', `Content-Datetime is the ${what} asked`, [MAPS1.mapResponseF, MAPS1.datetimeMapSuccess]));
  } else if (wanted.instant && !got.instant && got.start <= wanted.start && wanted.start <= got.end) {
    found.map.push(finding('pass', `Content-Datetime ${received}, an interval holding the ${what} asked`, [MAPS1.mapResponseF, MAPS1.datetimeMapSuccess]));
  } else if (wanted.instant) {
    found.map.push(finding('info', `Content-Datetime ${received}, not the ${asked.text} asked: a server may draw the closest time, or the last before it, that it has`, MAPS1.datetimeClosest));
  } else if (wanted.start <= got.start && got.end <= wanted.end) {
    found.map.push(finding('pass', `Content-Datetime ${received}, inside the interval asked`, [MAPS1.mapResponseF, MAPS1.datetimeResponse]));
  } else {
    found.map.push(finding('error', `Content-Datetime ${received} is outside the interval asked, ${asked.text}`, [MAPS1.datetimeResponse, MAPS1.datetimeMapSuccess]));
  }
}

// ---- All of it ----

export function mapFindings(input: MapFindingsInput): MapFindings {
  const found: MapFindings = { map: [], request: [], browser: [] };
  const ctx = contextOf(input);
  if (input.status >= 200 && input.status < 300) successFindings(input, ctx, found);
  else if (input.status >= 400 && input.status < 500) refusalFindings(input, ctx, found);
  else if (input.status >= 500) {
    found.map.push(finding('warning', `${input.status}: the server failed on the request${says(serverMessage(input.body))}`));
  }
  return found;
}

// What the request is, and what the API says, as the checks read them
export const mapCheckContext = contextOf;
export type { Context as MapCheckContext };
