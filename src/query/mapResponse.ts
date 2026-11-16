// A map response, read against what was asked: its image (its size, and its bytes against its Content-Type), and what
// its Content-Crs, Content-Bbox and Content-Datetime headers say, each against the request's crs, bbox and datetime and
// the collection's storageCrs and extent. And where the map can lie the image, which it can in CRS84, EPSG:4326 and
// EPSG:3857 only. The headers' rules are OGC API - Maps - Part 1: Core 1.0's (OGC 20-058, an approved standard published
// 2024-08-09), /req/core/map-response C to H, quoted in standards.ts. Pure.
import { fromLonLat, toLonLat } from 'ol/proj';
import type { Collection } from '../types/api';
import type { ResponseHeader } from '../api/sendRequest';
import type { BBox } from './types';
import { CRS84_URI, crsCode, outputCrs, readBox, sameCrs, shortCrs } from './mapBox';
import { rounded } from './mapLayer';
import { paramOf } from './requestUrl';
import { axisOfPart, parsePart, subsetIn, subsetParts, unquoted } from './subsetText';

// A browser sees only the headers the server exposes, so a header it didn't get may still have been sent
export const NOT_RECEIVED = 'missing, or not exposed by Access-Control-Expose-Headers';

// A map request: a collection's map, a style's, or a dataset's
export function isMapRequest(url: string): boolean {
  try {
    return /\/map$/.test(decodeURIComponent(new URL(url).pathname).replace(/\/+$/, ''));
  } catch {
    return false;
  }
}

// ---- The image's bytes ----

export type ImageFormat = 'PNG' | 'JPEG' | 'WebP';
const MEDIA_TYPES: Record<string, ImageFormat> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/webp': 'WebP' };

export interface ImageBytes {
  // From its signature: PNG's 8 bytes, JPEG's SOI, WebP's RIFF....WEBP. Null for anything else
  format: ImageFormat | null;
  // From its header: PNG's IHDR, JPEG's SOF, WebP's VP8, VP8L or VP8X. Null where the bytes don't say
  width: number | null;
  height: number | null;
  // What it starts with, to say: text as text, anything else as hex
  start: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

function startOf(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 24);
  if (!head.length) return 'nothing: the body is empty';
  const text = [...head].every(byte => (byte >= 0x20 && byte < 0x7f) || byte === 0x09 || byte === 0x0a || byte === 0x0d);
  if (text) return ascii(head, 0, head.length).replace(/\s+/g, ' ').trim();
  return [...bytes.subarray(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join(' ');
}

// JPEG's frame header, after the segments before it: SOF0 to SOF15, but for DHT (C4), JPG (C8) and DAC (CC)
function jpegSize(b: Uint8Array): [number, number] | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [u16be(b, at + 7), u16be(b, at + 5)];
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): [number, number] | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    return [1 + (((b[22] & 0x3f) << 8) | b[21]), 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))];
  }
  if (chunk === 'VP8X' && b.length >= 30) return [1 + u24le(b, 24), 1 + u24le(b, 27)];
  return null;
}

export function readImageBytes(bytes: Uint8Array): ImageBytes {
  const start = startOf(bytes);
  let format: ImageFormat | null = null;
  let size: [number, number] | null = null;
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    format = 'PNG';
    if (bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') size = [u32be(bytes, 16), u32be(bytes, 20)];
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = 'JPEG';
    size = jpegSize(bytes);
  } else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    format = 'WebP';
    size = webpSize(bytes);
  }
  return { format, width: size?.[0] ?? null, height: size?.[1] ?? null, start };
}

// The format a Content-Type says, where it's one the bytes can be checked against
export const typedFormat = (contentType: string): ImageFormat | null => MEDIA_TYPES[contentType.split(';')[0].trim().toLowerCase()] ?? null;

// Bytes that aren't an image at all, sent as one: Raw shows them as text
export const notAnImage = (contentType: string, image: ImageBytes | null): boolean => !!image && image.format === null && typedFormat(contentType) !== null;

// ---- CRSs ----

// What the app knows of a CRS: the order of its axes, and their unit. Others' axes are taken as written, east first
export interface KnownCrs { northFirst: boolean; unit: string; name?: string }
export const KNOWN: Record<string, KnownCrs> = {
  CRS84: { northFirst: false, unit: '°' },
  'EPSG:4326': { northFirst: true, unit: '°' },
  'EPSG:4258': { northFirst: true, unit: '°' },
  'EPSG:3857': { northFirst: false, unit: 'm', name: 'Web Mercator' },
  'EPSG:3067': { northFirst: false, unit: 'm' },
  'EPSG:3035': { northFirst: true, unit: 'm' },
};
// The CRSs the map can lie an image in: OpenLayers knows them without proj4, and the app registers no other
export type Placeable = 'CRS84' | 'EPSG:4326' | 'EPSG:3857';
const PLACEABLE: readonly string[] = ['CRS84', 'EPSG:4326', 'EPSG:3857'];
export const placeable = (crs: string): Placeable | null => {
  const code = crsCode(crs);
  return code && PLACEABLE.includes(code) ? code as Placeable : null;
};

// Content-Crs as the three forms Maps 1.0 writes it: a URI in angle brackets, a bare URI, or a CURIE, safe or not
export const readContentCrs = (value: string): string => value.trim().replace(/^<(.*)>$/, '$1').trim();

// ---- Boxes ----

export type Box = [number, number, number, number];
// A box's two dimensions, from four numbers or six with heights
const flat = (n: number[]): Box => (n.length === 6 ? [n[0], n[1], n[3], n[4]] : n) as Box;

// Content-Bbox's four numbers, or six with heights, as written: in the CRS's own axis order. Null where it isn't that
export function readContentBbox(value: string): Box | null {
  const parts = value.split(',').map(part => part.trim());
  if ((parts.length !== 4 && parts.length !== 6) || parts.some(part => !part || !Number.isFinite(Number(part)))) return null;
  return flat(parts.map(Number));
}

// A box as east, then north, from the CRS's own order: EPSG:4326's latitude-first box swapped
export const eastFirst = (box: Box, crs: string): Box => (KNOWN[crsCode(crs) ?? '']?.northFirst ? [box[1], box[0], box[3], box[2]] : box);
// And back: swapping is its own inverse
const ownOrder = eastFirst;

// A box in CRS84, EPSG:4326 or EPSG:3857, east first, as lon/lat
export function lonLatOf([x0, y0, x1, y1]: Box, crs: Placeable): BBox {
  if (crs !== 'EPSG:3857') return [x0, y0, x1, y1];
  return [...toLonLat([x0, y0]), ...toLonLat([x1, y1])] as BBox;
}

// And back
export function fromLonLatIn([west, south, east, north]: BBox, crs: Placeable): Box {
  if (crs !== 'EPSG:3857') return [west, south, east, north];
  return [...fromLonLat([west, south]), ...fromLonLat([east, north])] as Box;
}

const EDGES = ['west', 'south', 'east', 'north'] as const;
export type Edge = typeof EDGES[number];
export type Edges = Record<Edge, boolean>;

// How far each edge of one box is from another's, in pixels of the image: both east first, in the same CRS
export const edgePixels = (a: Box, b: Box, pixel: [number, number]): number[] => a.map((value, i) => (value - b[i]) / pixel[i % 2]);
export const meets = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
// Equal edges: within a tenth of a pixel
export const SAME = 0.1;

// The edges of the box asked that aren't Content-Bbox's, both lon/lat: a tenth of a pixel apart or more
export function differingEdges(asked: BBox, content: BBox, pixel: [number, number]): Edges {
  const apart = edgePixels(asked, content, pixel);
  return Object.fromEntries(EDGES.map((edge, i) => [edge, !(Math.abs(apart[i]) < SAME)])) as Edges;
}

export const figure = (value: number): string => (Math.abs(value) >= 1000 ? Math.round(value).toLocaleString('en-US') : String(Number(value.toPrecision(4))));
const pixelsSaid = (value: number) => `${figure(value)} px`;

// ---- Times ----

// An instant as Content-Datetime writes it, RFC 3339 or one of its shorter forms (/req/core/map-response H), as the
// millisecond it starts at. Null for anything else
const INSTANT = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/i;
export function instantMs(text: string): number | null {
  const match = INSTANT.exec(text.trim());
  if (!match) return null;
  const [, year, month = '01', day = '01', hour, minute = '00', second = '00', fraction = '', zone] = match;
  // A time of day needs its offset; a date alone is taken in UTC
  if (hour !== undefined && !zone) return null;
  const iso = `${year}-${month}-${day}T${hour ?? '00'}:${minute}:${second}${fraction}${hour === undefined ? 'Z' : zone.toUpperCase()}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export interface Span { start: number; end: number; instant: boolean }
// An instant, or an interval with '..' or an empty end for an open one
export function readSpan(text: string): Span | null {
  const parts = text.trim().split('/');
  if (parts.length === 1) {
    const at = instantMs(parts[0]);
    return at === null ? null : { start: at, end: at, instant: true };
  }
  if (parts.length !== 2) return null;
  const end = (part: string, open: number) => (part === '' || part === '..' ? open : instantMs(part));
  const [start, finish] = [end(parts[0], -Infinity), end(parts[1], Infinity)];
  return start === null || finish === null ? null : { start, end: finish, instant: false };
}

// The time a request asks for: datetime, else subset's time axis, as Maps 1.0's /req/datetime has both. Written as
// datetime writes it, an instant or an interval, with '..' for subset's *
export function askedTime(url: string): { text: string; from: 'datetime' | 'subset' } | null {
  const datetime = paramOf(url, 'datetime');
  if (datetime?.trim()) return { text: datetime.trim(), from: 'datetime' };
  const part = subsetParts(subsetIn(url)).find(each => axisOfPart(each) === 'time');
  const read = part ? parsePart(part) : null;
  if (!read || 'error' in read) return null;
  return { text: read.values.map(value => (value === '*' ? '..' : unquoted(value))).join('/'), from: 'subset' };
}

// A time asked, short where it's the day of the one received: 12:02:00Z
function timeSaid(asked: string, received: string): string {
  const day = /^(\d{4}-\d{2}-\d{2})T(.+)$/i.exec(asked);
  return day && received.startsWith(`${day[1]}T`) ? day[2] : asked;
}

// ---- The reading ----

export type Tone = 'ok' | 'note' | 'differs' | 'wrong' | 'none' | 'missing';

export interface ResponseRow {
  name: string;
  value: string;
  // A second line: the box in lon/lat
  more?: string;
  against: string;
  tone: Tone;
}

export interface MapPlacement {
  // How OpenLayers knows it: CRS84 as EPSG:4326, whose coordinates it holds lon/lat
  projection: 'EPSG:4326' | 'EPSG:3857';
  extent: Box;
  lonLat: BBox;
  // A pixel's size in degrees, across and down, for comparing a box with it
  pixelDegrees: [number, number] | null;
}

export interface MapResponseReading {
  rows: ResponseRow[];
  image: ImageBytes;
  // The CRS the map is in: Content-Crs, or CRS84 without it, as /req/core/map-response C has it
  crs: string;
  // Content-Bbox east first, and a pixel's size in the CRS's units, where the bytes give the image's size
  box: Box | null;
  pixel: [number, number] | null;
  place: MapPlacement | null;
  // Why the map can't draw it
  notPlaced: string | null;
}

export interface MapResponseInput {
  url: string;
  headers: ResponseHeader[];
  contentType: string;
  image: ImageBytes;
  // The collection the request is for, where it's the open one
  collection: Collection | null;
}

export const headerOf = (headers: ResponseHeader[], name: string): string | null =>
  headers.find(header => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;

const storageCrsOf = (collection: Collection | null): string => {
  const storage = (collection as { storageCrs?: unknown } | null)?.storageCrs;
  return typeof storage === 'string' ? storage.trim() : '';
};

function imageRow(url: string, contentType: string, image: ImageBytes): ResponseRow {
  const typed = contentType.split(';')[0].trim();
  const says = typedFormat(contentType);
  if (says && !image.format) return { name: 'image', value: `The body isn't a ${says}: it starts with ${image.start}`, against: `Content-Type ${typed}`, tone: 'wrong' };
  const sized = image.width !== null && image.height !== null;
  const value = `${sized ? `${image.width} × ${image.height} px` : 'its size unread'}${image.format ? `, ${image.format}` : ''}`;
  const against: string[] = [];
  let tone: Tone = 'ok';
  if (says && image.format && says !== image.format) {
    against.push(`but Content-Type says ${typed}`);
    tone = 'wrong';
  }
  // The size asked, each side where it's a whole number
  const asked = (['width', 'height'] as const).flatMap(name => {
    const text = paramOf(url, name)?.trim() ?? '';
    return /^\d+$/.test(text) ? [{ name, asked: Number(text), got: name === 'width' ? image.width : image.height }] : [];
  });
  const names = asked.map(side => side.name).join(' × ');
  const worse = (next: Tone) => {
    if (tone === 'ok') tone = next;
  };
  if (!asked.length) {
    against.push('none asked: the server chose');
    worse('none');
  } else if (!sized) {
    against.push(`${names} asked: the bytes don't say the size`);
    worse('none');
  } else if (asked.every(side => side.asked === side.got)) {
    against.push(`= ${names} asked`);
  } else {
    against.push(`≠ ${names} asked, ${asked.map(side => side.asked).join(' × ')}`);
    tone = 'wrong';
  }
  return { name: 'image', value, against: against.join('; '), tone };
}

function crsRow(url: string, received: string | null, collection: Collection | null): ResponseRow {
  const asked = paramOf(url, 'crs')?.trim() ?? '';
  const expected = asked ? { crs: asked, said: 'crs asked' }
    : collection ? (() => {
      const out = outputCrs(collection, '');
      return { crs: out.crs, said: out.from === 'storageCrs' ? 'storageCrs, as none was asked' : 'CRS84, as none was asked and the collection has no storageCrs' };
    })()
      : null;
  if (received === null) {
    const unlike = expected && !sameCrs(expected.crs, CRS84_URI) ? `, not the ${expected.said.split(',')[0]}, ${shortCrs(expected.crs)}` : '';
    return { name: 'Content-Crs', value: NOT_RECEIVED, against: `read as CRS84, as Maps 1.0 has it${unlike}`, tone: unlike ? 'wrong' : 'missing' };
  }
  const value = shortCrs(received);
  if (!expected) return { name: 'Content-Crs', value, against: 'none asked', tone: 'none' };
  if (sameCrs(received, expected.crs)) return { name: 'Content-Crs', value, against: `= ${expected.said}`, tone: 'ok' };
  return { name: 'Content-Crs', value, against: `≠ ${expected.said.split(',')[0]}, ${shortCrs(expected.crs)}`, tone: 'wrong' };
}

// A box the response is compared with, in its own CRS's order, and where it came from
export interface Compared { box: Box; crs: string; said: string }

export function comparedBox(url: string, collection: Collection | null, crs: string): Compared | { none: string } {
  const bbox = paramOf(url, 'bbox')?.trim() ?? '';
  if (bbox) {
    const read = readBox(bbox);
    if (!read || 'error' in read) return { none: "the bbox asked can't be read" };
    return { box: flat(read.numbers), crs: paramOf(url, 'bbox-crs')?.trim() || CRS84_URI, said: 'bbox asked' };
  }
  if (paramOf(url, 'center')?.trim()) return { none: 'none asked: the box is the server’s, around the center asked' };
  if (subsetParts(subsetIn(url)).some(part => ['Lon', 'Lat', 'E', 'N'].includes(axisOfPart(part) ?? ''))) return { none: 'none asked by bbox: subset gives the box' };
  const spatial = collection?.extent?.spatial as { bbox?: unknown; crs?: unknown; storageCrsBbox?: unknown } | undefined;
  const first = (boxes: unknown): Box | null => {
    const box = Array.isArray(boxes) && Array.isArray(boxes[0]) ? boxes[0] as unknown[] : null;
    if (!box || (box.length !== 4 && box.length !== 6) || !box.every(value => typeof value === 'number')) return null;
    return flat(box as number[]);
  };
  // The storage CRS's own box, where the map is in that CRS, since the app can't convert most
  const storage = storageCrsOf(collection);
  const storageBox = first(spatial?.storageCrsBbox);
  if (storage && storageBox && sameCrs(storage, crs)) return { box: storageBox, crs: storage, said: "collection's storageCrsBbox" };
  const extent = first(spatial?.bbox);
  if (extent) return { box: extent, crs: typeof spatial?.crs === 'string' ? spatial.crs : CRS84_URI, said: "collection's extent" };
  return { none: 'none asked' };
}

function bboxRow(url: string, received: string | null, crs: string, box: Box | null, pixel: [number, number] | null,
  collection: Collection | null): ResponseRow {
  if (received === null) return { name: 'Content-Bbox', value: NOT_RECEIVED, against: 'the map can’t be placed without it', tone: 'missing' };
  if (!box) return { name: 'Content-Bbox', value: received, against: "can't be read as four numbers", tone: 'wrong' };
  const code = placeable(crs);
  const own = ownOrder(box, crs);
  const decimals = KNOWN[crsCode(crs) ?? '']?.unit === '°' ? 6 : 2;
  const value = own.map(edge => rounded(edge, decimals)).join(', ');
  let more: string | undefined;
  if (code) {
    const lonLat = lonLatOf(box, code);
    if (code !== 'CRS84') {
      // A tenth of a pixel, and at least 3 decimals
      const perPixel = pixel ? Math.min((lonLat[2] - lonLat[0]) * pixel[0] / (box[2] - box[0]), (lonLat[3] - lonLat[1]) * pixel[1] / (box[3] - box[1])) : 0;
      const places = perPixel > 0 ? Math.max(3, Math.ceil(-Math.log10(perPixel / 10) - 1e-6)) : 3;
      more = `= ${lonLat.map(edge => edge.toFixed(places)).join(', ')} lon/lat`;
    }
  }
  const compared = comparedBox(url, collection, crs);
  if ('none' in compared) return { name: 'Content-Bbox', value, more, against: compared.none, tone: 'none' };
  // The box compared with, in the response's CRS, east first: converted where both CRSs are ones the app knows
  let other: Box | null = null;
  const from = placeable(compared.crs);
  if (code && from) other = fromLonLatIn(lonLatOf(eastFirst(compared.box, compared.crs), from), code);
  else if (sameCrs(compared.crs, crs)) other = eastFirst(compared.box, compared.crs);
  const asked = compared.said === 'bbox asked';
  if (!other) {
    return {
      name: 'Content-Bbox', value, more, tone: 'none',
      against: `${asked ? '' : 'none asked: '}the ${compared.said} is in ${shortCrs(compared.crs)}, which the app can't turn into ${shortCrs(crs)} to compare`,
    };
  }
  if (!meets(box, other)) return { name: 'Content-Bbox', value, more, against: `doesn't meet the ${compared.said}`, tone: asked ? 'wrong' : 'differs' };
  const span: [number, number] = pixel ?? [(box[2] - box[0]) * 1e-6, (box[3] - box[1]) * 1e-6];
  const apart = edgePixels(other, box, span).map(Math.abs);
  const off = EDGES.filter((_, i) => !(apart[i] < SAME));
  if (!off.length) return { name: 'Content-Bbox', value, more, against: `= ${compared.said}`, tone: 'ok' };
  const most = Math.max(...apart);
  const by = pixel ? `, by up to ${pixelsSaid(most)}` : '';
  const edges = off.length === 4 ? 'every edge' : `its ${off.join(', ').replace(/, ([^,]*)$/, ' and $1')} edge${off.length === 1 ? '' : 's'}`;
  return asked
    ? { name: 'Content-Bbox', value, more, against: `≠ ${compared.said}: ${edges}${by}`, tone: 'differs' }
    : { name: 'Content-Bbox', value, more, against: `none asked; the ${compared.said} differs: ${edges}${by}`, tone: 'none' };
}

function datetimeRow(url: string, received: string | null, collection: Collection | null): ResponseRow | null {
  const asked = askedTime(url);
  const temporal = collection?.extent?.temporal;
  if (received === null) {
    // Only where the map has a time: the collection's, or one asked (/req/core/map-response F)
    if (!asked && !temporal) return null;
    return { name: 'Content-Datetime', value: NOT_RECEIVED, against: asked ? `${asked.from} asked ${asked.text}` : 'the collection has a temporal extent', tone: 'missing' };
  }
  const got = readSpan(received);
  if (!got) return { name: 'Content-Datetime', value: received, against: "can't be read as an RFC 3339 time or interval", tone: 'wrong' };
  if (!asked) return { name: 'Content-Datetime', value: received, against: 'none asked: the server chose', tone: 'none' };
  const wanted = readSpan(asked.text);
  if (!wanted) return { name: 'Content-Datetime', value: received, against: `the ${asked.from} asked can't be read`, tone: 'none' };
  const what = asked.from === 'datetime' ? 'datetime' : 'subset time';
  if (wanted.start === got.start && wanted.end === got.end) return { name: 'Content-Datetime', value: received, against: `= ${what} asked`, tone: 'ok' };
  if (wanted.instant) {
    if (!got.instant && got.start <= wanted.start && wanted.start <= got.end) {
      return { name: 'Content-Datetime', value: received, against: `an interval holding the ${what} asked`, tone: 'ok' };
    }
    return { name: 'Content-Datetime', value: received, against: `snapped: asked ${timeSaid(asked.text, received)}`, tone: 'note' };
  }
  if (wanted.start <= got.start && got.end <= wanted.end) return { name: 'Content-Datetime', value: received, against: `inside the interval asked`, tone: 'ok' };
  return { name: 'Content-Datetime', value: received, against: `outside the interval asked, ${asked.text}`, tone: 'wrong' };
}

function pixelRow(crs: string, box: Box, pixel: [number, number], image: ImageBytes): ResponseRow {
  const known = KNOWN[crsCode(crs) ?? ''];
  const size = `${figure(pixel[0])} × ${figure(pixel[1])}`;
  const value = !known ? `${size} in ${shortCrs(crs)}'s units, its first axis taken as across`
    : `${size}${known.unit === '°' ? '°' : ' m'} (${known.name ?? shortCrs(crs)})`;
  const keep = Math.max(1, Math.round(image.width! * (box[3] - box[1]) / (box[2] - box[0])));
  if (keep === image.height) return { name: 'a pixel', value, against: 'square', tone: 'ok' };
  return { name: 'a pixel', value, against: `not square: ${keep} px tall keeps the box's shape`, tone: 'differs' };
}

export function readMapResponse({ url, headers, contentType, image, collection }: MapResponseInput): MapResponseReading {
  const crsHeader = headerOf(headers, 'content-crs');
  const bboxHeader = headerOf(headers, 'content-bbox');
  const crs = crsHeader === null ? CRS84_URI : readContentCrs(crsHeader);
  const read = bboxHeader === null ? null : readContentBbox(bboxHeader);
  const box = read ? eastFirst(read, crs) : null;
  const sized = image.width !== null && image.height !== null && image.width > 0 && image.height > 0;
  const pixel: [number, number] | null = box && sized && box[2] > box[0] && box[3] > box[1]
    ? [(box[2] - box[0]) / image.width!, (box[3] - box[1]) / image.height!] : null;

  const rows: ResponseRow[] = [
    imageRow(url, contentType, image),
    crsRow(url, crsHeader === null ? null : crs, collection),
    bboxRow(url, bboxHeader, crs, box, pixel, collection),
  ];
  const time = datetimeRow(url, headerOf(headers, 'content-datetime'), collection);
  if (time) rows.push(time);
  if (box && pixel) rows.push(pixelRow(crs, box, pixel, image));

  const code = placeable(crs);
  let place: MapPlacement | null = null;
  let notPlaced: string | null = null;
  if (notAnImage(contentType, image)) notPlaced = "The response isn't drawn here: its body isn't the image its Content-Type says. Data says what it starts with";
  else if (bboxHeader === null) notPlaced = `The response isn't drawn here: it has no Content-Bbox (${NOT_RECEIVED}), so the map can't place it. Data shows it`;
  else if (!box) notPlaced = "The response isn't drawn here: its Content-Bbox can't be read as four numbers. Data shows it";
  else if (!code) {
    notPlaced = `The response isn't drawn here: it's in ${shortCrs(crs)} (Content-Crs), and the map can place only CRS84, EPSG:4326 and EPSG:3857. Data shows it`;
  } else if (!(box[3] > box[1] && (box[2] > box[0] || (code !== 'EPSG:3857' && box[0] > box[2])))) {
    notPlaced = "The response isn't drawn here: its Content-Bbox has no area. Data shows it";
  } else {
    const lonLat = lonLatOf(box, code);
    // Across the antimeridian, as CRS84 writes it: east past 180
    if (lonLat[0] > lonLat[2]) lonLat[2] += 360;
    const extent: Box = code === 'EPSG:3857' ? box : lonLat;
    const pixelDegrees: [number, number] | null = sized ? [(lonLat[2] - lonLat[0]) / image.width!, (lonLat[3] - lonLat[1]) / image.height!] : null;
    place = { projection: code === 'EPSG:3857' ? 'EPSG:3857' : 'EPSG:4326', extent, lonLat, pixelDegrees };
  }
  return { rows, image, crs, box, pixel, place, notPlaced };
}

// ---- The point under the pointer ----

// The middle of a pixel of the image, column and row from its top left: in the map's CRS, in its own axis order, and
// in lon/lat where the app can convert. Null without a box and the image's size
export function pointAt(reading: MapResponseReading, column: number, row: number): { inCrs: string; lonLat: string | null } | null {
  const { box, pixel, crs } = reading;
  if (!box || !pixel) return null;
  const x = box[0] + (column + 0.5) * pixel[0];
  const y = box[3] - (row + 0.5) * pixel[1];
  const places = (size: number) => Math.min(8, Math.max(0, Math.ceil(-Math.log10(size)) + 1));
  const known = KNOWN[crsCode(crs) ?? ''];
  const [first, second] = known?.northFirst ? [y.toFixed(places(pixel[1])), x.toFixed(places(pixel[0]))] : [x.toFixed(places(pixel[0])), y.toFixed(places(pixel[1]))];
  const inCrs = `${first}, ${second} ${shortCrs(crs)}${known?.northFirst ? ', north first' : ''}`;
  const code = placeable(crs);
  if (!code) return { inCrs, lonLat: null };
  const [lon, lat] = code === 'EPSG:3857' ? toLonLat([x, y]) : [x, y];
  const degrees = reading.place?.pixelDegrees ?? pixel;
  const lonLat = `${lon.toFixed(places(degrees[0]))}°, ${lat.toFixed(places(degrees[1]))}° lon/lat`;
  return { inCrs: code === 'CRS84' ? lonLat : inCrs, lonLat: code === 'CRS84' ? null : lonLat };
}
