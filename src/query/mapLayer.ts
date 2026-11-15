// A layer on the map from a collection's map: what the map query's form has chosen, drawn over the map's own view. The
// form's request is taken without what the view decides (its box, size and CRS), and each draw adds the view's: by the
// map, /map, asked for each view, or by tiles where they take every choice. A layer keeps the choices it was added with.
// Pure.
//
// OGC API - Maps - Part 1: Core 1.0 (OGC 20-058, an approved standard published 2024-08-09) is quoted for the box and the
// CRS. Of OGC API - Tiles, only its datetime class is read, from the API's conformance.
import type { Collection, Temporal } from '../types/api';
import { intervalEnds } from './dimensionText';
import { readableQuery } from './requestUrl';
import { axisOfPart, parsePart, subsetParts, unquoted } from './subsetText';
import { TIME_AXES, runAsked, timesFromRun } from './mapDimensions';
import { expandTemporalValues, temporalValuesOf } from '../utils/extents/temporal';
import { declaredClasses } from './declared';
import type { QueryIssue } from './types';
import type { TileTemplate } from '../api/maps';

export type Pairs = [string, string][];

// What a layer's view decides, in place of what the request asks: the box, the size and the CRS, and the other ways of
// giving the box and the size
const VIEW_PARAMS = new Set(['bbox', 'bbox-crs', 'width', 'height', 'crs', 'center', 'center-crs', 'scale-denominator']);
// The axes of a 2D box: /req/spatial-subsetting/subset-definition B, "Axis names Lat and Lon SHALL be supported for
// geographic CRS and E and N for projected CRS", and H asks a 4xx for any of them with a bbox. The layer's box takes
// their place
const BOX_AXES = new Set(['Lon', 'Lat', 'E', 'N']);
// The axes of a third spatial dimension, C: h and z. subset-crs is about these too, so it stays while one does
const HEIGHT_AXES = new Set(['h', 'z']);

// What a layer draws: the map, the collection's or a style's, and what is asked of it besides the view
export interface LayerChoices {
  endpoint: string; // the map's URL without its query
  styleId: string; // '' for the collection's own map
  params: Pairs; // in the request's order, its subset's parts as one subset
}

// The choices in a map request: its path, and its query without the view's parameters, and the box's axes taken out of
// its subset. Several subset parameters are read as one, as /req/spatial-subsetting/subset-definition I has them
export function layerChoicesOf(url: string, styleId = ''): LayerChoices | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.searchParams.getAll('subset').flatMap(subsetParts).filter(part => part && !BOX_AXES.has(axisOfPart(part) ?? ''));
  const keepSubsetCrs = parts.some(part => HEIGHT_AXES.has(axisOfPart(part) ?? ''));
  const params: Pairs = [];
  for (const [name, value] of parsed.searchParams) {
    if (VIEW_PARAMS.has(name) || (name === 'subset-crs' && !keepSubsetCrs)) continue;
    if (name === 'subset') {
      if (parts.length && !params.some(([each]) => each === 'subset')) params.push(['subset', parts.join(',')]);
      continue;
    }
    params.push([name, value]);
  }
  parsed.search = '';
  parsed.hash = '';
  return { endpoint: parsed.href, styleId, params };
}

export const paramOf = (params: Pairs, name: string): string => params.find(([each]) => each === name)?.[1] ?? '';

// ---- The map's CRS ----

// EPSG:3857, the map's, as OGC-NA names it, and the other ways a crs list writes it
const WEB_MERCATOR_URI = 'http://www.opengis.net/def/crs/EPSG/0/3857';
const WEB_MERCATOR = new Set([WEB_MERCATOR_URI, 'https://www.opengis.net/def/crs/EPSG/0/3857', '[EPSG:3857]', 'EPSG:3857', 'urn:ogc:def:crs:EPSG::3857']
  .map(form => form.toLowerCase()));

// The map's CRS as the collection's crs list writes it, else by its URI: /req/crs/crs-definition D, "CRS expressed as
// URIs or as safe CURIEs SHALL be supported", where /per/crs/crs-curie only permits EPSG:3857
export function mapCrsOf(collection: Collection): { crs: string; listed: boolean } {
  const listed = (Array.isArray(collection.crs) ? collection.crs : []).find(
    (crs): crs is string => typeof crs === 'string' && WEB_MERCATOR.has(crs.trim().toLowerCase()),
  );
  return listed ? { crs: listed.trim(), listed: true } : { crs: WEB_MERCATOR_URI, listed: false };
}

// ---- A view's request ----

export interface View {
  bbox: [number, number, number, number]; // west, south, east, north in CRS84, the bbox's default CRS
  width: number;
  height: number;
  crs: string; // '' for none
}

// The box's decimals: a tenth of a pixel, and at least 3
export function boxDecimals({ bbox: [west, south, east, north], width, height }: View): number {
  const perPixel = Math.min(Math.abs(east - west) / Math.max(1, width), Math.abs(north - south) / Math.max(1, height));
  // A hair less, so that a tenth of a pixel of 0.00001° is 6 decimals, not 7 from rounding
  return perPixel > 0 && isFinite(perPixel) ? Math.max(3, Math.ceil(-Math.log10(perPixel / 10) - 1e-6)) : 3;
}

export const rounded = (value: number, decimals: number) => String(Number(value.toFixed(decimals)));

// The map for one view: the view's box, size and CRS, then the choices
export function viewUrl(endpoint: string, params: Pairs, view: View): string {
  const decimals = boxDecimals(view);
  const own: Pairs = [
    ['bbox', view.bbox.map(edge => rounded(edge, decimals)).join(',')],
    ['width', String(view.width)],
    ['height', String(view.height)],
    ...(view.crs ? [['crs', view.crs] as [string, string]] : []),
  ];
  return `${endpoint}?${readableQuery([...own, ...params])}`;
}

// A tile URL template with the choices it carries
export function withParams(template: string, params: Pairs): string {
  if (!params.length) return template;
  return `${template}${template.includes('?') ? '&' : '?'}${readableQuery(params)}`;
}

// Everything a layer sends but the view, as one text: a layer whose text changes is built again, since OpenLayers'
// sources can't change what they ask for
export interface SentByLayer {
  sourceType: 'tiles' | 'dynamic';
  tileUrl?: string;
  dynamicEndpoint?: string;
  params: Pairs;
  crs?: string;
  apiKey?: string;
  apiKeyParam?: string;
}
export const sentKey = (layer: SentByLayer): string => JSON.stringify([
  layer.sourceType, layer.tileUrl ?? '', layer.dynamicEndpoint ?? '', layer.params, layer.crs ?? '', layer.apiKey ?? '', layer.apiKeyParam ?? '',
]);

// ---- Tiles, where they take every choice ----

export interface TilesOffer {
  templates: TileTemplate[]; // the WebMercatorQuad tileset's
  apiDocs: string[] | null; // the query parameters the API docs list for the tile operation; null where they have none
  datetimeClass: boolean; // the API declares Tiles' datetime class
}

export type TilesPlan = { template: string; params: Pairs } | { refused: string };

const mediaType = (type: string | undefined) => (type ?? '').split(';')[0].trim().toLowerCase();

// Tiles' datetime class, as the API declares it
export const tilesDatetimeDeclared = (conformsTo: readonly string[] | null | undefined): boolean =>
  declaredClasses(conformsTo, '/spec/ogcapi-tiles-1/1.0/conf/').has('datetime');

// Whether a tile request takes a choice, and if not, why: datetime where the API docs list it for tiles, or without API
// docs where the API declares Tiles' datetime class; anything else only where the API docs list it for tiles. A time in
// subset isn't put on tiles even then: Maps names its axis time, and MeteoCore's tiles, which list subset, call it
// datetime and answer subset=time(…) with 400
function tilesRefuse(name: string, value: string, { apiDocs, datetimeClass }: TilesOffer): string | null {
  if (name === 'datetime') {
    if (apiDocs ? apiDocs.includes('datetime') : datetimeClass) return null;
    return apiDocs ? "the API docs don't list datetime for its tiles" : "the API declares neither Tiles' datetime class nor API docs for its tiles";
  }
  if (name === 'subset') {
    const time = subsetParts(value).map(axisOfPart).find(axis => axis && TIME_AXES.includes(axis));
    if (time && apiDocs?.includes('subset')) return `its tiles take a time by datetime, not as ${time}(…) in subset`;
  }
  if (apiDocs?.includes(name)) return null;
  return apiDocs ? `the API docs don't list ${name} for its tiles` : `no API docs say its tiles take ${name}`;
}

// The tiles for the choices: the template of the format asked, if any, carrying the rest. A format with no template of
// its own goes as f, where tiles take it. Refused, with the first reason, where they can't draw what was chosen
export function tilesFor(params: Pairs, offer: TilesOffer): TilesPlan {
  if (!offer.templates.length) return { refused: 'it has no WebMercatorQuad tiles' };
  const format = paramOf(params, 'f');
  const ofFormat = format ? offer.templates.find(template => mediaType(template.type) === mediaType(format)) : undefined;
  const carried: Pairs = [];
  for (const [name, value] of params) {
    if (name === 'f' && ofFormat) continue;
    const refused = tilesRefuse(name, value, offer);
    if (refused) return { refused: name === 'f' ? `its tiles are ${offer.templates.map(each => each.type || 'of no stated type').join(', ')}, and ${refused}` : refused };
    carried.push([name, value]);
  }
  return { template: (ofFormat ?? offer.templates[0]).href, params: carried };
}

// ---- What a layer holds, said ----

// The choices as a layer's title says them: the style, the parameter, the time, the level, the run, and anything else
// asked, as written. Only those chosen
export function choicesSaid(choices: Pick<LayerChoices, 'styleId' | 'params'>): string[] {
  const { styleId, params } = choices;
  const levels: string[] = [];
  const runs: string[] = [];
  const otherParts: string[] = [];
  for (const part of subsetParts(paramOf(params, 'subset'))) {
    const parsed = parsePart(part);
    if ('error' in parsed || parsed.values.length !== 1) otherParts.push(part);
    else if (parsed.axis === 'vertical') levels.push(`level ${unquoted(parsed.values[0])}`);
    else if (parsed.axis === 'reference_time') runs.push(parsed.values[0] === '*' ? 'latest run' : `run ${unquoted(parsed.values[0])}`);
    else otherParts.push(part);
  }
  const elevation = paramOf(params, 'elevation');
  if (elevation) levels.push(`elevation ${elevation}`);
  const said = new Set(['parameter-name', 'datetime', 'subset', 'elevation', 'f']);
  return [
    styleId,
    paramOf(params, 'parameter-name'),
    paramOf(params, 'datetime'),
    ...levels,
    ...runs,
    ...otherParts,
    paramOf(params, 'f'),
    ...params.filter(([name]) => !said.has(name)).map(([name, value]) => `${name}=${value}`),
  ].filter(Boolean);
}

export const layerTitle = (collectionTitle: string, choices: Pick<LayerChoices, 'styleId' | 'params'>): string =>
  [collectionTitle, ...choicesSaid(choices)].join(' · ');

// ---- A series ----

// The most frames a series asks for, so that a long range doesn't fire hundreds of requests per view
export const MAX_FRAMES = 48;

export type SeriesTimes = { times: string[]; of: number; from: 'range' | 'extent'; run: string | null } | { error: string };

const at = (time: string) => Date.parse(time);

// The times a series steps through: those the collection lists, from the run asked on where one is, inside the range
// the form has, else all of them. At most MAX_FRAMES, picked evenly, the last kept. A range's open end is the extent's
export function seriesTimes(temporal: Temporal | null | undefined, params: Pairs): SeriesTimes {
  if (!temporal) return { error: 'The collection has no temporal extent to animate' };
  const subset = paramOf(params, 'subset');
  const time = subsetParts(subset).map(axisOfPart).find(axis => axis && TIME_AXES.includes(axis));
  if (time) return { error: `The request asks its time as ${time}(…) in subset: a series steps through datetime` };
  const run = runAsked(subset);
  const base = timesFromRun(temporal, run)?.temporal ?? temporal;
  const ends = intervalEnds(paramOf(params, 'datetime'));
  const open = (end: string | undefined) => !end || end === '..';
  const start = ends && !open(ends.start) ? at(ends.start) : -Infinity;
  const end = ends && !open(ends.end) ? at(ends.end) : Infinity;
  // A collection that lists no times: steps over the range, as for its interval
  const listsTimes = temporalValuesOf(base).length > 0;
  const all = !listsTimes && ends && !open(ends.start) && !open(ends.end)
    ? expandTemporalValues({ interval: [[ends.start, ends.end]] }, 500)
    : expandTemporalValues(base, 100000);
  const times = ends ? all.filter(each => at(each) >= start && at(each) <= end) : all;
  const from = ends ? 'range' : 'extent';
  if (times.length < 2) {
    return { error: from === 'range'
      ? `The range chosen holds ${times.length === 1 ? 'one time' : 'none of the times'}${run ? ' of the run asked' : ''}: a series needs two or more`
      : 'The collection lists fewer than two times to animate' };
  }
  if (times.length <= MAX_FRAMES) return { times, of: times.length, from, run };
  const stride = times.length / MAX_FRAMES;
  const picked = Array.from({ length: MAX_FRAMES }, (_, i) => times[Math.floor(i * stride)]);
  picked[picked.length - 1] = times[times.length - 1];
  return { times: picked, of: times.length, from, run };
}

// A frame's choices: the series' time in place of the request's, or where the form puts one, after the parameter
export function frameParams(params: Pairs, time: string): Pairs {
  if (params.some(([name]) => name === 'datetime')) return params.map(([name, value]) => [name, name === 'datetime' ? time : value]);
  const after = params.findIndex(([name]) => name === 'parameter-name') + 1;
  return [...params.slice(0, after), ['datetime', time], ...params.slice(after)];
}

// ---- What the box draws ----

export type LayerSource =
  | { from: 'form'; choices: LayerChoices; blocked: string | null } // the map query's choices
  | { from: 'collection'; choices: LayerChoices } // no map query picked: the collection's own map
  | { from: 'tiles' } // no map, only tiles
  | { from: 'waiting' }; // the map query is picked and the form's request is still being built

// What the map's view decides, so that an error there doesn't stop a layer, which asks the view's instead
const VIEW_FIELDS = new Set([...VIEW_PARAMS, 'subset-crs']);

export interface LayerSourceInput {
  mapPicked: boolean; // the map query is the one picked in the form
  request: { url: string; issues: readonly QueryIssue[] } | null; // the form's map request and what it found, once built
  styleId: string;
  mapHref: string | null; // the collection's map link
}

// What a layer would draw now: the form's map request where the map query is picked, else the collection's own map,
// else its tiles. An error in the form's request stops it, and says why
export function layerSourceOf({ mapPicked, request, styleId, mapHref }: LayerSourceInput): LayerSource {
  if (mapPicked) {
    const choices = request ? layerChoicesOf(request.url, styleId) : null;
    if (!request || !choices) return { from: 'waiting' };
    const error = request.issues.find(issue => issue.severity === 'error' && !VIEW_FIELDS.has(issue.field));
    return { from: 'form', choices, blocked: error?.message ?? null };
  }
  const choices = mapHref ? layerChoicesOf(mapHref) : null;
  return choices ? { from: 'collection', choices } : { from: 'tiles' };
}
