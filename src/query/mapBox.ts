// A map's box, size and CRS: bbox · bbox-crs, width × height and crs as fields, what the map can write into them (its
// view, a box drawn on it, its size), and what's wrong with what a request asks of them. Quoted from OGC API - Maps -
// Part 1: Core 1.0 (OGC 20-058, an approved standard published 2024-08-09). The map is Web Mercator, so the form can
// read and write a box only in CRS84, EPSG:4326 and EPSG:3857; a box in any other CRS is the developer's, typed. Pure.
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import type { Collection } from '../types/api';
import type { BBox, QueryIssue } from './types';
import type { FieldSpec, Hint, Requirement } from './fieldSpecs';
import { declarersOf, type ApiDocsParam, type Offer } from './declared';
import type { MapLimits } from '../validation/openapi/operationIndex';
import { boxDecimals, mapCrsOf, rounded } from './mapLayer';
import { subsetParts, axisOfPart } from './subsetText';
import { geometryKindOf } from './queryTypes';
import { MAPS1 } from '../standards';

// CRS84 as OGC-NA names it: bbox-crs's default, /req/spatial-subsetting/bbox-crs C, and the map's without a storageCrs
export const CRS84_URI = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';

// ---- CRSs, whichever way they're written ----

// What a CRS is, as the form tells them apart: CRS84, or EPSG:n, from a URI, a safe or unsafe CURIE, a URN or a short
// identifier. Null for one it doesn't know
export function crsCode(crs: string): string | null {
  const text = crs.trim().replace(/^\[(.*)\]$/, '$1').trim();
  if (!text) return null;
  if (/(^|[/:])CRS:?84$/i.test(text)) return 'CRS84';
  const epsg = /EPSG(?:\/[\d.]+\/|::?)(\d+)$/i.exec(text)?.[1];
  return epsg ? `EPSG:${Number(epsg)}` : null;
}

export const sameCrs = (a: string, b: string): boolean => {
  const [codeA, codeB] = [crsCode(a), crsCode(b)];
  return codeA !== null || codeB !== null ? codeA === codeB : !!a.trim() && a.trim() === b.trim();
};

// A CRS as a toggle shows it: EPSG:3857 for the URI
export const shortCrs = (crs: string): string => crsCode(crs) ?? crs.trim();

// A CURIE without its square brackets, as EPSG:3857 or CRS:84: not a URI, a URN or a safe CURIE
export function isUnsafeCurie(crs: string): boolean {
  const text = crs.trim();
  return /^[A-Za-z][\w.-]*:[^\s/[\]]+$/.test(text) && !/^urn:/i.test(text);
}

const listedCrs = (collection: Collection): string[] =>
  (Array.isArray(collection.crs) ? collection.crs : []).filter((crs): crs is string => typeof crs === 'string' && !!crs.trim()).map(crs => crs.trim());

const storageCrsOf = (collection: Collection): string => {
  const storage = (collection as { storageCrs?: unknown }).storageCrs;
  return typeof storage === 'string' ? storage.trim() : '';
};

// The CRS the map comes back in: the crs asked, else the storage CRS, else CRS84 (/req/core/map-response B)
export function outputCrs(collection: Collection, crs: string): { crs: string; from: 'crs' | 'storageCrs' | 'CRS84' } {
  if (crs.trim()) return { crs: crs.trim(), from: 'crs' };
  const storage = storageCrsOf(collection);
  return storage ? { crs: storage, from: 'storageCrs' } : { crs: CRS84_URI, from: 'CRS84' };
}

// bbox-crs's valid values, as /req/spatial-subsetting/bbox-crs A has them: CRS84, the storage CRS where it's another,
// and the crs asked. Each as the collection's crs list writes it where it lists it
export interface CrsChoice {
  value: string;
  label: string;
  why: 'CRS84' | 'storage' | 'crs asked';
}

export function bboxCrsChoices(collection: Collection, crs: string): CrsChoice[] {
  const listed = listedCrs(collection);
  const asListed = (value: string) => listed.find(each => sameCrs(each, value)) ?? value;
  const choices: CrsChoice[] = [];
  const add = (value: string, why: CrsChoice['why']) => {
    if (value && !choices.some(choice => sameCrs(choice.value, value))) choices.push({ value, label: shortCrs(value), why });
  };
  add(asListed(CRS84_URI), 'CRS84');
  add(storageCrsOf(collection), 'storage');
  add(crs.trim(), 'crs asked');
  return choices;
}

// ---- The box ----

// bbox's numbers, or what's wrong with them: four or six numbers, /req/spatial-subsetting/bbox-definition A
export function readBox(text: string): { numbers: number[] } | { error: string } | null {
  if (!text.trim()) return null;
  const parts = text.split(',').map(part => part.trim());
  const wrong = parts.find(part => part === '' || !Number.isFinite(Number(part)));
  if (wrong !== undefined) return { error: wrong ? `"${wrong}" in bbox isn't a number` : 'bbox has an empty value between its commas' };
  if (parts.length !== 4 && parts.length !== 6) {
    return { error: `bbox has ${parts.length} number${parts.length === 1 ? '' : 's'}: Maps 1.0 takes four, or six for a box with heights` };
  }
  return { numbers: parts.map(Number) };
}

// The CRSs the map can write a drawn box in, or read one in to draw it: bbox-crs left out is CRS84
export type DrawableCrs = 'CRS84' | 'EPSG:4326' | 'EPSG:3857';
const DRAWABLE: readonly string[] = ['CRS84', 'EPSG:4326', 'EPSG:3857'];
export function drawableCrs(bboxCrs: string): DrawableCrs | null {
  if (!bboxCrs.trim()) return 'CRS84';
  const code = crsCode(bboxCrs);
  return code && DRAWABLE.includes(code) ? code as DrawableCrs : null;
}

// The box asked in CRS84, its two dimensions, from CRS84, EPSG:4326 (latitude first) or EPSG:3857: west past east across
// the antimeridian, as CRS84 writes it. Null where it can't be read or turned into CRS84
export function boxInCrs84(text: string, bboxCrs: string): BBox | null {
  const read = readBox(text);
  const crs = drawableCrs(bboxCrs);
  if (!read || 'error' in read || !crs) return null;
  const n = read.numbers;
  const [a, b, c, d] = n.length === 6 ? [n[0], n[1], n[3], n[4]] : n;
  let box: BBox;
  if (crs === 'CRS84') box = [a, b, c, d];
  else if (crs === 'EPSG:4326') box = [b, a, d, c];
  else box = [...toLonLat([a, b]), ...toLonLat([c, d])] as BBox;
  const [, south, , north] = box;
  return box.every(Number.isFinite) && Math.abs(south) <= 90 && Math.abs(north) <= 90 ? box : null;
}

// The box asked, as lon/lat to draw on the map: a box across the antimeridian runs east past 180. Null where it can't
// be read or drawn
export function boxLonLat(text: string, bboxCrs: string): BBox | null {
  const box = boxInCrs84(text, bboxCrs);
  if (!box) return null;
  const [west, south, east, north] = box;
  return [west, south, west > east ? east + 360 : east, north];
}

// ---- The box across a switch of query ----

// What a box does when the query is switched between a map and a query that takes a box from the map (items, cube): it
// goes across in CRS84, the box both take without a bbox-crs. A map's box in EPSG:4326 or EPSG:3857 is turned into
// CRS84; one in another CRS, or one that can't be read, stays behind, and the note says why. Nothing for other switches
export function boxAcross(from: string, to: string, box: { drawn: BBox | null; bbox: string; bboxCrs: string }):
  { bbox?: string; drawn?: BBox; leftBehind?: string } {
  if (to === 'map' && geometryKindOf(from) === 'bbox') return box.drawn ? { bbox: boxTextIn(box.drawn, 'CRS84') } : {};
  if (from !== 'map' || geometryKindOf(to) !== 'bbox' || !box.bbox.trim()) return {};
  const drawn = boxInCrs84(box.bbox, box.bboxCrs);
  if (drawn) return { drawn };
  return {
    leftBehind: drawableCrs(box.bboxCrs)
      ? `The map's bbox ${box.bbox.trim()} wasn't kept: it can't be read as a box`
      : `The map's bbox wasn't kept: it's in ${shortCrs(box.bboxCrs)}, which the form can't turn into CRS84, the box ${to} takes`,
  };
}

// A lon/lat box written in a CRS the map can write: CRS84's degrees, EPSG:4326's latitude first, EPSG:3857's metres.
// Degrees at the decimals given, metres whole
export function boxTextIn([west, south, east, north]: BBox, crs: DrawableCrs, decimals = 3): string {
  const degrees = (values: number[]) => values.map(value => rounded(value, decimals)).join(',');
  if (crs === 'CRS84') return degrees([west, south, east, north]);
  if (crs === 'EPSG:4326') return degrees([south, west, north, east]);
  return [...fromLonLat([west, south]), ...fromLonLat([east, north])].map(value => String(Math.round(value))).join(',');
}

const DRAWABLE_SAID: Record<DrawableCrs, string> = {
  CRS84: 'in CRS84, at 3 decimals',
  'EPSG:4326': 'in EPSG:4326, latitude first, at 3 decimals',
  'EPSG:3857': 'in EPSG:3857, in whole metres',
};
export const drawnBoxSaid = (crs: DrawableCrs): string => DRAWABLE_SAID[crs];

// ---- The map's view ----

// What Match the map view writes: bbox as the view in CRS84, at a tenth of a pixel and at least 3 decimals, the view's
// size in CSS pixels, and EPSG:3857 as the collection's crs lists it. Only together do they make an image that lies on
// the map pixel for pixel. crs is null where the collection doesn't list EPSG:3857. Null without a view
export function viewMatch(collection: Collection, viewExtent: readonly number[] | null, viewSize: readonly number[] | null):
  { bbox: string; width: number; height: number; crs: string | null } | null {
  if (!viewExtent || !viewSize) return null;
  const [width, height] = viewSize.map(Math.round);
  if (!(width > 0 && height > 0)) return null;
  // As a layer's view asks for it: the box OpenLayers gives is in Web Mercator
  const bbox = transformExtent([...viewExtent], 'EPSG:3857', 'EPSG:4326') as BBox;
  const decimals = boxDecimals({ bbox, width, height, crs: '' });
  const crs = mapCrsOf(collection);
  return { bbox: bbox.map(edge => rounded(edge, decimals)).join(','), width, height, crs: crs.listed ? crs.crs : null };
}

// ---- The size ----

const positiveInteger = (text: string): number | null => (/^\s*\d+\s*$/.test(text) && Number(text) > 0 ? Number(text) : null);

// The size that keeps the box's shape in the CRS the map comes back in: the width kept and the height worked out, or
// the width from the height where only it's given. Degrees for CRS84 and EPSG:4326, which draw longitude across, and
// metres for EPSG:3857. Or why it can't be
export function keptShape(collection: Collection, q: { bbox: string; bboxCrs: string; crs: string; width: string; height: string }):
  { width: number; height: number; wrote: 'width' | 'height'; inCrs: string } | { reason: string } {
  const box = boxLonLat(q.bbox, q.bboxCrs);
  if (!q.bbox.trim()) return { reason: 'Needs a `bbox`: its shape is what the size keeps' };
  if (!box) {
    return { reason: drawableCrs(q.bboxCrs) ? "The form can't read `bbox`"
      : `Only for a box in CRS84, EPSG:4326 or EPSG:3857, and \`bbox-crs\` is ${shortCrs(q.bboxCrs)}` };
  }
  const out = outputCrs(collection, q.crs);
  const code = crsCode(out.crs);
  if (!code || !DRAWABLE.includes(code)) {
    return { reason: `Only for a map in CRS84, EPSG:4326 or EPSG:3857, and it comes back in ${shortCrs(out.crs)}${out.from === 'storageCrs' ? ', the storage CRS' : ''}` };
  }
  const [west, south, east, north] = box;
  let across = east - west;
  let down = north - south;
  if (code === 'EPSG:3857') {
    const [x0, y0] = fromLonLat([west, south]);
    const [x1, y1] = fromLonLat([east, north]);
    [across, down] = [x1 - x0, y1 - y0];
  }
  if (!(across > 0 && down > 0)) return { reason: 'The box has no area' };
  const width = positiveInteger(q.width);
  const height = positiveInteger(q.height);
  if (width) return { width, height: Math.max(1, Math.round(width * down / across)), wrote: 'height', inCrs: code };
  if (height) return { width: Math.max(1, Math.round(height * across / down)), height, wrote: 'width', inCrs: code };
  return { reason: 'Needs `width` or `height` to keep' };
}

// ---- The fields ----

// What the API docs say the server does without a parameter: the sentence of its description that begins "Omitted",
// or says "if omitted" or "when omitted". MeteoCore's width: "Omitted over an area (…): the width that keeps pixels
// square, 1024 for the longer side when `height` is omitted too, …"
export function apiDocsLeftOut(param: ApiDocsParam | undefined): string | null {
  const sentence = param?.description?.split(/(?<=[.!?])\s+|\n+/).find(text => /^omitted\b|\b(if|when) omitted\b/i.test(text.trim()));
  return sentence ? sentence.trim() : null;
}

const LIMITS_SAID = (limits: MapLimits) => [
  limits.maxWidth ? `${limits.maxWidth} wide` : '', limits.maxHeight ? `${limits.maxHeight} high` : '', limits.maxPixels ? `${limits.maxPixels} pixels in all` : '',
].filter(Boolean).join(', ');

// The box, the size and the CRS, in that order, each where it's declared or the request has it
export function mapBoxSpecs(collection: Collection, offer: Offer, inRequest: ReadonlySet<string>, requirementOf: (name: string) => Requirement,
  limits: MapLimits | null | undefined): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const docs = (name: string) => offer.apiDocs?.find(param => param.name === name);
  const unit = (name: string): FieldSpec => ({ title: '', name, id: name, requirement: requirementOf(name), hints: [] });

  const boxBy = declarersOf('bbox', offer);
  if (boxBy.length || inRequest.has('bbox') || inRequest.has('bbox-crs')) {
    fields.push({
      title: 'Box', name: 'bbox', id: 'bbox', requirement: requirementOf('bbox'),
      unit: unit('bbox-crs'),
      hints: [{ text: "`bbox-crs` takes CRS84, the storage CRS or the `crs` asked; left out, it's CRS84", rule: [MAPS1.bboxCrs, MAPS1.bboxCrsDefault] }],
      leftOut: { text: "the whole map: the collection's extent", rule: MAPS1.wholeMap },
      grammar: 'Typed: `west,south,east,north` in CRS84, else in the order of the CRS `bbox-crs` names (EPSG:4326 latitude first). Four numbers, or six with heights',
      declaredBy: boxBy,
    });
  }

  const sizeBy = declarersOf('width', offer);
  if (sizeBy.length || inRequest.has('width') || inRequest.has('height')) {
    const hints: Hint[] = [];
    const widest = docs('width')?.maximum;
    const highest = docs('height')?.maximum;
    if (widest || highest) {
      hints.push({
        text: widest === highest ? `The API docs allow up to ${widest} each` : `The API docs allow up to ${widest ?? 'any'} wide and ${highest ?? 'any'} high`,
        rule: MAPS1.maxSizeApiDocs,
      });
    }
    if (limits && LIMITS_SAID(limits)) hints.push({ text: `\`x-OGC-limits.maps\` allows up to ${LIMITS_SAID(limits)}`, rule: MAPS1.maxSizeLimits });
    const docsSay = apiDocsLeftOut(docs('width'));
    fields.push({
      title: 'Size', name: 'width', id: 'width', requirement: requirementOf('width'), figure: 'pixels',
      unit: unit('height'), unitJoin: '×',
      hints,
      leftOut: { text: `the server picks one${docsSay ? `. The API docs: ${docsSay}` : ''}`, rule: [MAPS1.widthDefinitionH, MAPS1.heightDefinitionH] },
      grammar: 'Whole numbers of pixels, at least 1',
      declaredBy: sizeBy,
    });
  }

  const crsBy = declarersOf('crs', offer);
  if (crsBy.length || inRequest.has('crs')) {
    const listed = listedCrs(collection);
    const storage = storageCrsOf(collection);
    fields.push({
      title: 'Coordinate system', name: 'crs', id: 'crs', requirement: requirementOf('crs'),
      figure: listed.length ? `${listed.length} listed` : undefined,
      options: listed,
      hints: [listed.length
        ? "From the collection's `crs`, sent as it lists them"
        : { text: "The collection lists no `crs`: only CRS84 is sure to be supported", rule: MAPS1.crsListed }],
      leftOut: { text: storage ? `the storage CRS, \`storageCrs\` ${shortCrs(storage)}` : 'CRS84: the collection has no `storageCrs`', rule: MAPS1.mapResponseB },
      grammar: 'A URI from the list, or its safe CURIE: `[EPSG:3857]`',
      declaredBy: crsBy,
    });
  }
  return fields;
}

// ---- What's wrong with a request's box, size and CRS ----

// What the form can say from the collection alone: bbox's numbers, a box across the antimeridian, bbox-crs among its
// valid values, the size's integers, crs in the collection's list, and unsafe CURIEs
export function mapBoxIssues(collection: Collection, q: { bbox: string; bboxCrs: string; width: string; height: string; crs: string }): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const add = (issue: Omit<QueryIssue, 'id' | 'input'> & { key: string }) => {
    const { key, ...rest } = issue;
    issues.push({ ...rest, id: `${rest.source}:${rest.field}:${key}`, input: 'form' });
  };
  const bbox = q.bbox.trim();
  const bboxCrs = q.bboxCrs.trim();
  const crs = q.crs.trim();

  const read = readBox(bbox);
  if (read && 'error' in read) add({ key: 'numbers', severity: 'error', source: 'maps', field: 'bbox', message: read.error, rule: MAPS1.bboxNumbers });
  // West past east where the east axis wraps: longitude first in CRS84, second in EPSG:4326, and EPSG:3857's x first
  const wraps = drawableCrs(bboxCrs);
  if (read && 'numbers' in read && wraps) {
    const n = read.numbers;
    const at = n.length === 6 ? [0, 3] : [0, 2];
    const [west, east] = wraps === 'EPSG:4326' ? [n[at[0] + 1], n[at[1] + 1]] : [n[at[0]], n[at[1]]];
    if (west > east) {
      add({ key: 'antimeridian', severity: 'info', source: 'maps', field: 'bbox',
        message: `West ${west} is past east ${east}: the box crosses the antimeridian. Maps 1.0 says this of subset's low and high; of bbox, nothing`,
        rule: MAPS1.subsetAntimeridian });
    }
  }

  if (bboxCrs) {
    if (!bbox) {
      add({ key: 'alone', severity: 'info', source: 'maps', field: 'bbox-crs', message: 'bbox-crs without bbox: the server ignores it', rule: MAPS1.bboxCrsAlone });
    }
    const choices = bboxCrsChoices(collection, crs);
    if (!choices.some(choice => sameCrs(choice.value, bboxCrs))) {
      const said = choices.map(choice => (choice.why === 'CRS84' ? 'CRS84' : `${choice.label} (${choice.why === 'storage' ? 'the storage CRS' : 'the crs asked'})`));
      add({ key: 'valid', severity: 'warning', source: 'maps', field: 'bbox-crs',
        message: `${shortCrs(bboxCrs)} isn't one of bbox-crs's valid values, ${said.join(', ')}: a server needn't take it`, rule: [MAPS1.bboxCrs, MAPS1.crsForBbox] });
    }
    if (isUnsafeCurie(bboxCrs)) {
      add({ key: 'curie', severity: 'info', source: 'maps', field: 'bbox-crs',
        message: `${bboxCrs} is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [${bboxCrs}] SHALL be supported`,
        rule: MAPS1.subsettingCrsCurie });
    }
  }

  for (const [name, rule] of [['width', MAPS1.widthDefinitionC], ['height', MAPS1.heightDefinitionC]] as const) {
    const value = (name === 'width' ? q.width : q.height).trim();
    if (value && positiveInteger(value) === null) {
      add({ key: 'integer', severity: 'error', source: 'maps', field: name, message: `${name} ${value} isn't a positive integer: the server SHALL answer with a 4xx`, rule });
    }
  }

  if (crs) {
    const listed = listedCrs(collection);
    if (listed.length && !listed.some(each => sameCrs(each, crs))) {
      add({ key: 'listed', severity: 'warning', source: 'maps', field: 'crs',
        message: `${shortCrs(crs)} isn't in the collection's crs list: only those listed SHALL be supported`, rule: MAPS1.crsListed });
    } else if (!listed.length && crsCode(crs) !== 'CRS84') {
      add({ key: 'listed', severity: 'warning', source: 'maps', field: 'crs',
        message: `The collection lists no crs: only CRS84 SHALL be supported, and ${shortCrs(crs)} may not be`, rule: MAPS1.crsListed });
    }
    if (isUnsafeCurie(crs)) {
      add({ key: 'curie', severity: 'info', source: 'maps', field: 'crs',
        message: `${crs} is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [${crs}] SHALL be supported`,
        rule: [MAPS1.crsCurie, MAPS1.crsDefinition] });
    }
  }
  return issues;
}

// The axes of a map's 2D box in subset: those a spatial subset gives the box by
const BOX_AXES = new Set(['Lon', 'Lat', 'E', 'N']);

// What needs the rest of the line, the API's conformance and its API docs: bbox with center; a size with an area and
// scale-denominator; a size past the API docs' maximum or the service's x-OGC-limits.maps
export function mapLineIssues(offer: Offer, line: { bbox: string; center: string; width: string; height: string; scaleDenominator: string; subset: string },
  limits: MapLimits | null | undefined): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const has = (value: string) => !!value.trim();
  if (has(line.bbox) && has(line.center) && offer.classes?.has('spatial-subsetting')) {
    issues.push({
      id: 'maps:bbox:with-center', severity: 'error', source: 'maps', field: 'bbox', input: 'form',
      message: 'bbox with center: Maps 1.0 asks a 4xx for either with the other', rule: [MAPS1.bboxDefinition, MAPS1.centerDefinition],
    });
  }
  const sized = (['width', 'height'] as const).filter(name => has(line[name]));
  const area = has(line.bbox) || subsetParts(line.subset).some(part => BOX_AXES.has(axisOfPart(part) ?? ''));
  if (sized.length && area && has(line.scaleDenominator) && offer.classes?.has('scaling')) {
    issues.push({
      id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: sized[0], input: 'form',
      message: `${sized.join(' and ')} with ${has(line.bbox) ? 'bbox' : 'a spatial subset'} and scale-denominator: Maps 1.0 asks a 4xx`,
      rule: [...sized.map(name => (name === 'width' ? MAPS1.widthDefinitionF : MAPS1.heightDefinitionF)), MAPS1.scaleDenominatorWithBbox],
    });
  } else if (sized.length && has(line.scaleDenominator) && offer.classes?.has('scaling') && !offer.classes.has('spatial-subsetting')) {
    // Without spatial subsetting, a size doesn't set the area, so it can't go with a scale at all
    issues.push({
      id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: sized[0], input: 'form',
      message: `${sized.join(' and ')} with scale-denominator, where the API doesn't declare spatial subsetting: Maps 1.0 asks a 4xx`,
      rule: MAPS1.scaleDenominatorWithSize,
    });
  }
  const number = (text: string) => (has(text) && Number.isFinite(Number(text)) ? Number(text) : null);
  for (const name of ['width', 'height'] as const) {
    const value = number(line[name]);
    const docs = offer.apiDocs?.find(param => param.name === name);
    if (value !== null && docs?.maximum !== undefined && value > docs.maximum) {
      issues.push({
        id: `openapi:${name}:maximum`, severity: 'error', source: 'openapi', field: name, input: 'form', pointer: docs.pointer,
        message: `${name} ${value} is past the API docs' maximum, ${docs.maximum}: expect a 4xx`, rule: MAPS1.maxSizeApiDocs,
      });
    }
    const most = name === 'width' ? limits?.maxWidth : limits?.maxHeight;
    if (value !== null && most && value > most) {
      issues.push({
        id: `openapi:${name}:max-limit`, severity: 'error', source: 'openapi', field: name, input: 'form', pointer: limits!.pointer,
        message: `${name} ${value} is past x-OGC-limits.maps.max${name === 'width' ? 'Width' : 'Height'}, ${most}: the server SHALL answer with a 4xx`,
        rule: name === 'width' ? MAPS1.widthDefinitionD : MAPS1.heightDefinitionD,
      });
    }
  }
  const [width, height] = [number(line.width), number(line.height)];
  if (width !== null && height !== null && limits?.maxPixels && width * height > limits.maxPixels) {
    issues.push({
      id: 'openapi:width:max-pixels', severity: 'error', source: 'openapi', field: 'width', input: 'form', pointer: limits.pointer,
      message: `width × height, ${width * height} pixels, is past x-OGC-limits.maps.maxPixels, ${limits.maxPixels}: the server SHALL answer with a 4xx`,
      rule: [MAPS1.widthDefinitionE, MAPS1.heightDefinitionE],
    });
  }
  return issues;
}
