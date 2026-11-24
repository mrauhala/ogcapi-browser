import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/meteocore-map-responses.json';
import type { Collection } from '../types/api';
import type { ResponseHeader } from '../api/sendRequest';
import {
  NOT_RECEIVED, differingEdges, instantMs, isMapRequest, notAnImage, pointAt, readContentBbox, readContentCrs, readImageBytes, readMapResponse, typedFormat,
  type ImageBytes, type MapResponseReading,
} from './mapResponse';

const RADAR = fixture.collection as unknown as Collection;
type Name = keyof typeof fixture.responses;
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const imageOf = (name: Name) => readImageBytes(bytesOf(fixture.responses[name].start));
const typeOf = (headers: ResponseHeader[]) => headers.find(header => header.name === 'content-type')?.value ?? '';

// A fixture's response read as the pane reads it, its headers changed or taken out where a test says
function read(name: Name, change: { url?: string; headers?: Record<string, string | null>; collection?: Collection | null; image?: ImageBytes; accept?: string } = {}): MapResponseReading {
  const response = fixture.responses[name];
  let headers: ResponseHeader[] = response.headers.map(header => ({ ...header }));
  for (const [header, value] of Object.entries(change.headers ?? {})) {
    headers = headers.filter(each => each.name !== header);
    if (value !== null) headers.push({ name: header, value });
  }
  return readMapResponse({
    url: change.url ?? response.url, headers, contentType: typeOf(headers), image: change.image ?? imageOf(name),
    collection: change.collection === undefined ? RADAR : change.collection, accept: change.accept,
  });
}
const row = (reading: MapResponseReading, name: string) => reading.rows.find(each => each.name === name);
const said = (reading: MapResponseReading, name: string) => {
  const found = row(reading, name);
  return found ? [found.value, found.more, found.against, found.tone].filter(part => part !== undefined).join(' | ') : null;
};
const M3857 = 'http://www.opengis.net/def/crs/EPSG/0/3857';

describe('isMapRequest', () => {
  it("is a collection's map, a style's and a dataset's", () => {
    expect(isMapRequest('https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=1,2,3,4')).toBe(true);
    expect(isMapRequest('https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/styles/radar_fmi/map')).toBe(true);
    expect(isMapRequest('https://example.com/ogc/map/')).toBe(true);
    expect(isMapRequest('https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/styles/radar_fmi/legend')).toBe(false);
    expect(isMapRequest('https://example.com/collections/maps')).toBe(false);
    expect(isMapRequest('not a URL /map')).toBe(false);
  });
});

describe('readImageBytes', () => {
  it("reads a PNG's size from its IHDR", () => {
    expect(imageOf('bare')).toEqual({ format: 'PNG', width: 1024, height: 905, start: '89 50 4e 47 0d 0a 1a 0a' });
    expect(imageOf('matchView')).toMatchObject({ format: 'PNG', width: 478, height: 721 });
  });

  it("reads a JPEG's size from its frame header, past the segments before it", () => {
    expect(imageOf('jpeg')).toEqual({ format: 'JPEG', width: 200, height: 334, start: 'ff d8 ff e0 00 10 4a 46' });
    // A baseline frame after an APP0 and a DQT, and a progressive one (C2); DHT (C4) isn't a frame
    const jpeg = (marker: number) => new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x03, 0x00, 0xff, 0xc4, 0x00, 0x03, 0x00,
      0xff, marker, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00,
    ]);
    expect(readImageBytes(jpeg(0xc0))).toMatchObject({ format: 'JPEG', width: 600, height: 300 });
    expect(readImageBytes(jpeg(0xc2))).toMatchObject({ width: 600, height: 300 });
    // JPG (C8) and DAC (CC) aren't frames either
    expect(readImageBytes(jpeg(0xc8))).toMatchObject({ format: 'JPEG', width: null, height: null });
    expect(readImageBytes(jpeg(0xcc))).toMatchObject({ format: 'JPEG', width: null, height: null });
    // Fill bytes before a marker are skipped
    expect(readImageBytes(new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00,
    ]))).toMatchObject({ format: 'JPEG', width: 600, height: 300 });
    // Cut short before its frame
    expect(readImageBytes(jpeg(0xc0).subarray(0, 20))).toMatchObject({ format: 'JPEG', width: null });
  });

  it("reads a WebP's size from its VP8L, VP8 and VP8X chunks", () => {
    expect(imageOf('webp')).toEqual({ format: 'WebP', width: 200, height: 334, start: '52 49 46 46 5e 3a 00 00' });
    const riff = (chunk: string, body: number[]) => new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...`WEBP${chunk}`].map(c => c.charCodeAt(0)), [0, 0, 0, 0], body));
    // VP8: a key frame's start code, then 14-bit width and height, little-endian, each under 2 bits of scale
    expect(readImageBytes(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x41, 0x58, 0x82]))).toMatchObject({ format: 'WebP', width: 300, height: 600 });
    // VP8L: its signature byte, then 14-bit width - 1 and height - 1, packed; without the signature its size isn't read
    expect(readImageBytes(riff('VP8L', [0x2f, 0xc7, 0x40, 0x53, 0x10]))).toMatchObject({ format: 'WebP', width: 200, height: 334 });
    expect(readImageBytes(riff('VP8L', [0x00, 0xc7, 0x40, 0x53, 0x10]))).toMatchObject({ format: 'WebP', width: null });
    // VP8X: flags, 3 reserved bytes, then width - 1 and height - 1 in 24 bits each
    expect(readImageBytes(riff('VP8X', [0, 0, 0, 0, 0x2b, 0x01, 0x00, 0x57, 0x02, 0x00]))).toMatchObject({ width: 300, height: 600 });
    expect(readImageBytes(riff('ALPH', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ format: 'WebP', width: null });
    // A RIFF that isn't WebP
    const wave = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x01, 0x58, 0x02]);
    wave.set([...'WAVE'].map(c => c.charCodeAt(0)), 8);
    expect(readImageBytes(wave)).toMatchObject({ format: null, width: null });
  });

  it("says what a body that isn't an image starts with: text as text, bytes as hex", () => {
    expect(imageOf('widthZero')).toEqual({ format: null, width: null, height: null, start: '{"code":"BadRequest","de' });
    expect(readImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x01, 0x02]))).toEqual({ format: null, width: null, height: null, start: '47 49 46 38 39 61 00 01' });
    expect(readImageBytes(new Uint8Array([]))).toMatchObject({ format: null, start: 'nothing: the body is empty' });
    // Text over lines, as JSON is indented: its whitespace as one space
    expect(readImageBytes(new TextEncoder().encode('{\n  "code": "BadRequest",\n  "description": "x"\n}')).start).toBe('{ "code": "BadRequest"');
    // A PNG signature cut short, one cut before its IHDR is whole, and one whose first chunk isn't IHDR
    const png = bytesOf(fixture.responses.bare.start);
    expect(readImageBytes(png.subarray(0, 7)).format).toBeNull();
    expect(readImageBytes(png.subarray(0, 20))).toMatchObject({ format: 'PNG', width: null });
    const noHeader = png.slice(0, 32);
    noHeader.set([...'IDAT'].map(c => c.charCodeAt(0)), 12);
    expect(readImageBytes(noHeader)).toMatchObject({ format: 'PNG', width: null, height: null });
  });

  it('checks only the formats it can read against the Content-Type', () => {
    expect(typedFormat('image/png; charset=binary')).toBe('PNG');
    expect(typedFormat('IMAGE/JPEG')).toBe('JPEG');
    // Not registered, but seen
    expect(typedFormat('image/jpg')).toBe('JPEG');
    expect(typedFormat('image/webp')).toBe('WebP');
    expect(typedFormat('image/svg+xml')).toBeNull();
    expect(notAnImage('image/png', imageOf('widthZero'))).toBe(true);
    expect(notAnImage('image/png', imageOf('webp'))).toBe(false);
    expect(notAnImage('image/gif', imageOf('widthZero'))).toBe(false);
    expect(notAnImage('image/png', null)).toBe(false);
  });
});

describe('Content-Crs and Content-Bbox as written', () => {
  it('reads the three forms of Content-Crs: a URI in angle brackets, a bare URI, and a CURIE', () => {
    expect(readContentCrs(`<${M3857}>`)).toBe(M3857);
    expect(readContentCrs(` ${M3857} `)).toBe(M3857);
    expect(readContentCrs('[EPSG:3857]')).toBe('[EPSG:3857]');
    for (const form of [`<${M3857}>`, M3857, '[EPSG:3857]', 'EPSG:3857']) {
      const reading = read('matchView', { headers: { 'content-crs': form } });
      expect(said(reading, 'Content-Crs')).toBe('EPSG:3857 | = crs asked | ok');
      expect(reading.place?.projection).toBe('EPSG:3857');
    }
  });

  it('reads four numbers, or six with heights, and nothing else', () => {
    expect(readContentBbox('19,59,32,70')).toEqual([19, 59, 32, 70]);
    expect(readContentBbox(' 19, 59, 0, 32, 70, 10 ')).toEqual([19, 59, 32, 70]);
    expect(readContentBbox('19,59,32')).toBeNull();
    expect(readContentBbox('19,59,,70')).toBeNull();
    expect(readContentBbox('19,59,32,north')).toBeNull();
  });
});

describe('readMapResponse', () => {
  it("Match the map view's request: each header is what was asked, and the map lies it in EPSG:3857", () => {
    const reading = read('matchView');
    expect(said(reading, 'image')).toBe('478 × 721 px, PNG | = width × height asked | ok');
    expect(said(reading, 'Content-Crs')).toBe('EPSG:3857 | = crs asked | ok');
    expect(said(reading, 'Content-Bbox')).toBe('1725452.11, 8073093.61, 3951841.92, 11402272.16 | = 15.500, 58.500, 35.500, 71.000 lon/lat | = bbox asked | ok');
    expect(said(reading, 'Content-Datetime')).toBe('2026-11-16T15:25:00Z | none asked: the server chose | none');
    // The height typed wasn't the box's shape
    expect(said(reading, 'a pixel')).toBe("4,658 × 4,617 m (Web Mercator) | not square: 715 px tall keeps the box's shape | differs");
    expect(reading.notPlaced).toBeNull();
    expect(reading.place).toMatchObject({ projection: 'EPSG:3857', extent: [1725452.1072957402, 8073093.6119444575, 3951841.9231612114, 11402272.159297233] });
    expect(reading.place?.lonLat.map(edge => Number(edge.toFixed(9)))).toEqual([15.5, 58.5, 35.5, 71]);
    expect(reading.place?.pixelDegrees?.map(size => Number(size.toFixed(6)))).toEqual([0.041841, 0.017337]);
  });

  it("a bare map: EPSG:3067, the storage CRS, which the map can't place, and the reason", () => {
    const reading = read('bare');
    expect(said(reading, 'image')).toBe('1024 × 905 px, PNG | none asked: the server chose | none');
    expect(said(reading, 'Content-Crs')).toBe('EPSG:3067 | = storageCrs, as none was asked | ok');
    // Compared with the collection's own box in its storage CRS, which the app can't convert
    expect(said(reading, 'Content-Bbox')).toBe("-758912.68, 6198787.53, 1502000.67, 8197054.09 | none asked; the collection's storageCrsBbox differs: every edge, by up to 254.7 px | none");
    expect(said(reading, 'a pixel')).toBe('2,208 × 2,208 m (EPSG:3067) | square | ok');
    expect(reading.place).toBeNull();
    expect(reading.notPlaced).toBe("The response isn't drawn here: it's in EPSG:3067 (Content-Crs), and the map can place only CRS84, EPSG:4326 and EPSG:3857. Data shows it");
  });

  it('a CRS84 box: drawn as EPSG:4326 at the box, with no lon/lat line, since it is lon/lat', () => {
    const reading = read('crs84');
    expect(said(reading, 'image')).toBe('300 × 254 px, PNG | = width asked | ok');
    expect(said(reading, 'Content-Crs')).toBe('CRS84 | = crs asked | ok');
    expect(said(reading, 'Content-Bbox')).toBe('19, 59, 32, 70 | = bbox asked | ok');
    expect(said(reading, 'a pixel')).toBe('0.04333 × 0.04331° (CRS84) | square | ok');
    expect(reading.place).toMatchObject({ projection: 'EPSG:4326', extent: [19, 59, 32, 70], lonLat: [19, 59, 32, 70] });
  });

  it('an EPSG:4326 box is latitude first: written as sent, swapped to lie on the map', () => {
    const reading = read('epsg4326');
    expect(fixture.responses.epsg4326.headers.find(header => header.name === 'content-bbox')?.value).toBe('59,19,70,32');
    expect(said(reading, 'Content-Bbox')).toBe('59, 19, 70, 32 | = 19.000, 59.000, 32.000, 70.000 lon/lat | = bbox asked | ok');
    expect(said(reading, 'a pixel')).toBe('0.04333 × 0.04331° (EPSG:4326) | square | ok');
    expect(reading.place).toMatchObject({ projection: 'EPSG:4326', extent: [19, 59, 32, 70] });
    expect(reading.box).toEqual([19, 59, 32, 70]);
    // A bbox asked latitude first in bbox-crs is compared the same way
    const url = `${fixture.responses.epsg4326.url.replace('bbox=19,59,32,70', 'bbox=59,19,70,32')}&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326`;
    expect(row(read('epsg4326', { url }), 'Content-Bbox')?.against).toBe('= bbox asked');
  });

  it('a north-first geographic CRS the app knows besides EPSG:4326: ETRS89, EPSG:4258', () => {
    const reading = read('crs84', { headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/4258', 'content-bbox': '59,19,70,32' } });
    expect(said(reading, 'a pixel')).toBe('0.04333 × 0.04331° (EPSG:4258) | square | ok');
    expect(pointAt(reading, 0, 0)?.inCrs).toBe('69.978, 19.022 EPSG:4258, north first');
    expect(reading.notPlaced).toMatch(/it's in EPSG:4258/);
  });

  it('a north-first projected CRS the app knows: EPSG:3035', () => {
    // MeteoCore's answer for crs EPSG:3035 and width=300, fetched 2026-11-16
    const reading = read('crs84', {
      url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=19,59,32,70&crs=http://www.opengis.net/def/crs/EPSG/0/3035&width=300',
      headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/3035', 'content-bbox': '4021520.214563329,4667887.7949858755,5342329.8541937955,5564353.186588148' },
      image: { format: 'PNG', width: 300, height: 442, start: '' },
    });
    expect(said(reading, 'a pixel')).toBe('2,988 × 2,988 m (EPSG:3035) | square | ok');
    // North first: the top left pixel's northing, then its easting
    expect(pointAt(reading, 0, 0)?.inCrs).toBe('5340836, 4669382 EPSG:3035, north first');
    expect(reading.notPlaced).toMatch(/it's in EPSG:3035/);
  });

  it("a CRS the app knows nothing of: its axes as written, said so, and no comparison", () => {
    const reading = read('bare', {
      url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?crs=http://www.opengis.net/def/crs/EPSG/0/2393',
      headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/2393' },
    });
    expect(said(reading, 'Content-Crs')).toBe('EPSG:2393 | = crs asked | ok');
    expect(said(reading, 'a pixel')).toBe("2,208 × 2,208 in EPSG:2393's units, its first axis taken as across | square | ok");
    expect(row(reading, 'Content-Bbox')?.against).toBe("none asked: the collection's extent is in CRS84, which the app can't turn into EPSG:2393 to compare");
  });

  it('a time that snaps: the time asked, short on the same day', () => {
    const reading = read('snapped');
    expect(fixture.responses.snapped.url).toContain('datetime=2026-11-16T12:02:00Z');
    expect(said(reading, 'Content-Datetime')).toBe('2026-11-16T12:00:00Z | snapped: asked 12:02:00Z | note');
    const otherDay = fixture.responses.snapped.url.replace('2026-11-16T12:02:00Z', '2020-01-01T00:00:00Z');
    expect(row(read('snapped', { url: otherDay }), 'Content-Datetime')?.against).toBe('snapped: asked 2020-01-01T00:00:00Z');
    // The same instant written with an offset is the time asked
    const offset = fixture.responses.snapped.url.replace('2026-11-16T12:02:00Z', '2026-11-16T14:00:00%2B02:00');
    expect(row(read('snapped', { url: offset }), 'Content-Datetime')?.against).toBe('= datetime asked');
  });

  it('a time against an interval asked, open or closed, and against subset’s time', () => {
    const base = fixture.responses.snapped.url.replace(/&datetime=.*$/, '');
    const against = (query: string) => row(read('snapped', { url: `${base}&${query}` }), 'Content-Datetime')?.against;
    expect(against('datetime=2026-11-16T00:00:00Z/2026-11-16T12:00:00Z')).toBe('inside the interval asked');
    expect(against('datetime=../2026-11-16T12:00:00Z')).toBe('inside the interval asked');
    expect(against('datetime=2026-11-16T12:30:00Z/..')).toBe('outside the interval asked, 2026-11-16T12:30:00Z/..');
    expect(against('datetime=2026-11-16T00:00:00Z/2026-11-16T11:00:00Z')).toBe('outside the interval asked, 2026-11-16T00:00:00Z/2026-11-16T11:00:00Z');
    expect(against('datetime=2026-11-16T12:00:00Z/2026-11-16T12:00:00Z')).toBe('= datetime asked');
    expect(against('subset=time("2026-11-16T12:00:00Z")')).toBe('= subset time asked');
    expect(against('subset=time("2026-11-16T11:00:00Z":*)')).toBe('inside the interval asked');
    expect(against('subset=Lon(19:32),time("2026-11-16T12:05:00Z")')).toBe('snapped: asked 12:05:00Z');
    expect(against('datetime=yesterday')).toBe("the datetime asked can't be read");
    // An interval received around the instant asked
    const interval = read('snapped', { headers: { 'content-datetime': '2026-11-16T12:00:00Z/2026-11-16T12:05:00Z' } });
    expect(row(interval, 'Content-Datetime')?.against).toBe('an interval holding the datetime asked');
    expect(row(read('snapped', { headers: { 'content-datetime': 'noon' } }), 'Content-Datetime')).toMatchObject({ against: "can't be read as an RFC 3339 time or interval", tone: 'wrong' });
  });

  it('reads the shorter times Content-Datetime may have', () => {
    expect(instantMs('2026')).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(instantMs('2026-11')).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(instantMs('2026-11-16')).toBe(Date.parse('2026-11-16T00:00:00Z'));
    expect(instantMs('2026-11-16T12Z')).toBe(Date.parse('2026-11-16T12:00:00Z'));
    expect(instantMs('2026-11-16T12-04:00')).toBe(Date.parse('2026-11-16T16:00:00Z'));
    expect(instantMs('2026-11-16T12:30Z')).toBe(Date.parse('2026-11-16T12:30:00Z'));
    expect(instantMs('2026-11-16T12:30:15.250z')).toBe(Date.parse('2026-11-16T12:30:15.250Z'));
    expect(instantMs('2026-11-16T12:30:00')).toBeNull();
    expect(instantMs('2026-13-40')).toBeNull();
  });

  it('a missing header shows as one the browser may not have been let see', () => {
    const noBox = read('matchView', { headers: { 'content-bbox': null } });
    expect(said(noBox, 'Content-Bbox')).toBe(`${NOT_RECEIVED} | the map can’t be placed without it | missing`);
    expect(noBox.place).toBeNull();
    expect(noBox.notPlaced).toBe(`The response isn't drawn here: it has no Content-Bbox (${NOT_RECEIVED}), so the map can't place it. Data shows it`);
    expect(noBox.rows.map(each => each.name)).toEqual(['image', 'Content-Crs', 'Content-Bbox', 'Content-Datetime']);
    // Without Content-Crs it's CRS84, by /req/core/map-response C: wrong where another was asked
    expect(said(read('matchView', { headers: { 'content-crs': null } }), 'Content-Crs')).toBe(`${NOT_RECEIVED} | read as CRS84, as Maps 1.0 has it, not the crs asked, EPSG:3857 | wrong`);
    const crs84 = read('crs84', { headers: { 'content-crs': null } });
    expect(said(crs84, 'Content-Crs')).toBe(`${NOT_RECEIVED} | read as CRS84, as Maps 1.0 has it | missing`);
    expect(crs84.place).toMatchObject({ projection: 'EPSG:4326', extent: [19, 59, 32, 70] });
    expect(said(read('crs84', { headers: { 'content-datetime': null } }), 'Content-Datetime')).toBe(`${NOT_RECEIVED} | the collection has a temporal extent | missing`);
    // Not for a map with no time, asked or in the collection
    const timeless = { ...RADAR, extent: { spatial: RADAR.extent!.spatial } } as Collection;
    expect(row(read('crs84', { headers: { 'content-datetime': null }, collection: timeless }), 'Content-Datetime')).toBeUndefined();
    expect(row(read('snapped', { headers: { 'content-datetime': null }, collection: timeless }), 'Content-Datetime')?.against).toBe('datetime asked 2026-11-16T12:02:00Z');
  });

  it("JSON sent as image/png: the body says what it starts with, and isn't drawn", () => {
    const reading = read('widthZero', { url: fixture.responses.matchView.url, headers: { 'content-type': 'image/png' } });
    expect(said(reading, 'image')).toBe('The body isn\'t a PNG: it starts with {"code":"BadRequest","de | Content-Type image/png | wrong');
    expect(reading.place).toBeNull();
    expect(reading.notPlaced).toBe("The response isn't drawn here: its body isn't the image its Content-Type says. Data says what it starts with");
  });

  it('an image of another format than its Content-Type says', () => {
    const reading = read('webp', { headers: { 'content-type': 'image/png' } });
    expect(said(reading, 'image')).toBe('200 × 334 px, WebP | but Content-Type says image/png; = width asked | wrong');
    // An image type the app doesn't read is taken as it says
    expect(said(read('webp', { headers: { 'content-type': 'image/svg+xml' } }), 'image')).toBe('200 × 334 px, WebP | = width asked | ok');
    // And bytes it can't read, of a type it doesn't check: a GIF, sent as one
    const gif = readImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0x58, 0x02]));
    expect(said(read('webp', { headers: { 'content-type': 'image/gif' }, image: gif }), 'image')).toBe("its size unread | width asked: the bytes don't say the size | none");
  });

  it('the format against the Accept sent, only where it asked for one: f may have asked for another, which the server followed', () => {
    const bare = fixture.responses.bare.url;
    expect(row(read('bare'), 'Content-Type')).toBeUndefined();
    expect(row(read('bare', { accept: '*/*' }), 'Content-Type')).toBeUndefined();
    expect(said(read('bare', { accept: 'image/png' }), 'Content-Type')).toBe('image/png | as Accept: image/png asked | ok');
    expect(said(read('bare', { accept: 'image/*;q=0.9, image/jpeg' }), 'Content-Type')).toBe('image/png | as Accept: image/*;q=0.9, image/jpeg asked | ok');
    expect(said(read('bare', { accept: 'image/jpeg' }), 'Content-Type')).toBe('image/png | but Accept: image/jpeg asked | wrong');
    expect(said(read('bare', { accept: 'image/jpeg', url: `${bare}${bare.includes('?') ? '&' : '?'}f=image/png` }), 'Content-Type')).toBe('image/png | as f asked, not Accept: image/jpeg | differs');
    // Next to the image's, before the headers'
    expect(read('bare', { accept: 'image/jpeg' }).rows.map(each => each.name).slice(0, 3)).toEqual(['image', 'Content-Type', 'Content-Crs']);
  });

  it('a size not what was asked, and one the bytes don’t give', () => {
    const url = fixture.responses.matchView.url.replace('height=721', 'height=700');
    expect(said(read('matchView', { url }), 'image')).toBe('478 × 721 px, PNG | ≠ width × height asked, 478 × 700 | wrong');
    // An image with no height has no pixel
    const flat = read('matchView', { image: { format: 'PNG', width: 478, height: 0, start: '' } });
    expect(row(flat, 'a pixel')).toBeUndefined();
    expect(flat.pixel).toBeNull();
    expect(flat.place?.pixelDegrees).toBeNull();
    const unread = read('matchView', { image: { format: 'PNG', width: null, height: null, start: '' } });
    expect(said(unread, 'image')).toBe("its size unread, PNG | width × height asked: the bytes don't say the size | none");
    expect(row(unread, 'a pixel')).toBeUndefined();
    expect(unread.place?.pixelDegrees).toBeNull();
    // A size that isn't a whole number isn't compared
    expect(row(read('matchView', { url: url.replace('width=478', 'width=1.5').replace('height=700', 'height=x') }), 'image')?.against).toBe('none asked: the server chose');
  });

  it('a Content-Crs other than the one asked, or than the storage CRS', () => {
    expect(said(read('matchView', { headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/4326', 'content-bbox': '58.5,15.5,71,35.5' } }), 'Content-Crs'))
      .toBe('EPSG:4326 | ≠ crs asked, EPSG:3857 | wrong');
    expect(said(read('bare', { headers: { 'content-crs': M3857 } }), 'Content-Crs')).toBe('EPSG:3857 | ≠ storageCrs, EPSG:3067 | wrong');
    const noStorage = { ...RADAR, storageCrs: undefined } as Collection;
    expect(said(read('crs84', { url: fixture.responses.crs84.url.replace(/&?crs=[^&]*/, ''), collection: noStorage }), 'Content-Crs'))
      .toBe('CRS84 | = CRS84, as none was asked and the collection has no storageCrs | ok');
    // A request not for the open collection has no storage CRS to compare with
    expect(said(read('bare', { collection: null }), 'Content-Crs')).toBe('EPSG:3067 | none asked | none');
    expect(row(read('bare', { collection: null }), 'Content-Bbox')?.against).toBe('none asked');
  });

  it('a Content-Bbox against the bbox asked: equal to a tenth of a pixel, the edges that differ and by how much, or not meeting', () => {
    const url = fixture.responses.crs84.url;
    const box = (value: string) => row(read('crs84', { url, headers: { 'content-bbox': value } }), 'Content-Bbox');
    // A pixel of the image in the box received: 13/300° across, and down 9/254° in a box to 68° north
    expect(box('19.004,59,32,70')?.against).toBe('= bbox asked');
    expect(box('19,59,32,68')).toMatchObject({ against: '≠ bbox asked: its north edge, by up to 56.44 px', tone: 'differs' });
    expect(box('19.1,59,32,68')?.against).toBe('≠ bbox asked: its west and north edges, by up to 56.44 px');
    expect(box('19.1,59.1,31.9,68')?.against).toBe('≠ bbox asked: every edge, by up to 57.08 px');
    expect(box('40,59,50,70')).toMatchObject({ against: "doesn't meet the bbox asked", tone: 'wrong' });
    // Touching at an edge isn't meeting
    expect(box('32,59,45,70')).toMatchObject({ against: "doesn't meet the bbox asked", tone: 'wrong' });
    expect(box('19,59,32')).toMatchObject({ value: '19,59,32', against: "can't be read as four numbers", tone: 'wrong' });
    // Degrees at 6 decimals, metres at 2
    expect(box('19.1234567,59,32,70')?.value).toBe('19.123457, 59, 32, 70');
    // Coarse pixels: the lon/lat line keeps 3 decimals
    const world = read('matchView', { headers: { 'content-bbox': '-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244' },
      image: { format: 'PNG', width: 256, height: 256, start: '' } });
    expect(row(world, 'Content-Bbox')?.more).toBe('= -180.000, -85.051, 180.000, 85.051 lon/lat');
    expect(read('crs84', { url, headers: { 'content-bbox': '19,59,32' } }).notPlaced).toBe("The response isn't drawn here: its Content-Bbox can't be read as four numbers. Data shows it");
    expect(read('crs84', { url, headers: { 'content-bbox': '19,70,32,59' } }).notPlaced).toBe("The response isn't drawn here: its Content-Bbox has no area. Data shows it");
    // Asked in EPSG:3857 metres, answered in CRS84: converted to compare
    const metres = `${url.replace('bbox=19,59,32,70', 'bbox=2115070.325072198,8180386.885935248,3562223.705384754,11068715.65937949')}&bbox-crs=${M3857}`;
    expect(row(read('crs84', { url: metres }), 'Content-Bbox')?.against).toBe('= bbox asked');
    // Asked in CRS84, answered in EPSG:3067: the app can't convert
    expect(row(read('bboxStorage'), 'Content-Bbox')?.against).toBe("the bbox asked is in CRS84, which the app can't turn into EPSG:3067 to compare");
    // Asked in EPSG:3067 and answered in it: compared as written
    const storage = `https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=41085.7679951248,6540069.207725588,787090.182972304,7785896.539012969&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3067&width=200`;
    expect(row(read('bboxStorage', { url: storage }), 'Content-Bbox')?.against).toBe('= bbox asked');
    expect(row(read('bboxStorage', { url: `${url.replace('bbox=19,59,32,70', 'bbox=19,59')}` }), 'Content-Bbox')?.against).toBe("the bbox asked can't be read");
  });

  it('with no bbox asked: the collection’s extent, the server’s box around a center, or a subset’s', () => {
    const noBox = fixture.responses.matchView.url.replace('bbox=15.5,58.5,35.5,71&', '');
    expect(row(read('matchView', { url: noBox }), 'Content-Bbox')?.against).toBe("none asked; the collection's extent differs: every edge, by up to 210.7 px");
    expect(row(read('matchView', { url: `${noBox}&center=25,62` }), 'Content-Bbox')?.against).toBe('none asked: the box is the server’s, around the center asked');
    expect(row(read('matchView', { url: `${noBox}&subset=Lon(19:32),Lat(59:70)` }), 'Content-Bbox')?.against).toBe('none asked by bbox: subset gives the box');
    expect(row(read('matchView', { url: `${noBox}&subset=E(0:500000),N(6600000:7000000)` }), 'Content-Bbox')?.against).toBe('none asked by bbox: subset gives the box');
    // A box that doesn't meet the extent: worth a look, but none was asked
    expect(row(read('matchView', { url: noBox, headers: { 'content-bbox': '-11131949,-1118890,-8905559,1118890' } }), 'Content-Bbox'))
      .toMatchObject({ against: "doesn't meet the collection's extent", tone: 'differs' });
    // The extent itself, in CRS84
    const extent = fixture.collection.extent.spatial.bbox[0];
    const whole = read('crs84', { url: fixture.responses.crs84.url.replace('bbox=19,59,32,70&', ''), headers: { 'content-bbox': extent.join(',') } });
    expect(row(whole, 'Content-Bbox')?.against).toBe("= collection's extent");
  });

  it('a box across the antimeridian lies east past 180', () => {
    const reading = read('crs84', { url: fixture.responses.crs84.url.replace('bbox=19,59,32,70', 'bbox=170,-10,-170,10'), headers: { 'content-bbox': '170,-10,-170,10' } });
    expect(reading.place).toMatchObject({ projection: 'EPSG:4326', lonLat: [170, -10, 190, 10], extent: [170, -10, 190, 10] });
    expect(reading.pixel).toBeNull();
  });
});

describe('pointAt', () => {
  it("is a pixel's middle, in the map's CRS and in lon/lat", () => {
    const reading = read('matchView');
    // The top left pixel: half a pixel in from west and north
    expect(pointAt(reading, 0, 0)).toEqual({ inCrs: '1727781, 11399963 EPSG:3857', lonLat: '15.521°, 70.993° lon/lat' });
    expect(pointAt(reading, 477, 720)).toEqual({ inCrs: '3949513, 8075402 EPSG:3857', lonLat: '35.479°, 58.511° lon/lat' });
  });

  it('in lon/lat once for CRS84, latitude first for EPSG:4326, and in its own CRS only for one the app can’t convert', () => {
    expect(pointAt(read('crs84'), 0, 0)).toEqual({ inCrs: '19.022°, 69.978° lon/lat', lonLat: null });
    expect(pointAt(read('epsg4326'), 0, 0)).toEqual({ inCrs: '69.978, 19.022 EPSG:4326, north first', lonLat: '19.022°, 69.978° lon/lat' });
    expect(pointAt(read('bare'), 0, 0)).toEqual({ inCrs: '-757809, 8195950 EPSG:3067', lonLat: null });
    expect(pointAt(read('matchView', { headers: { 'content-bbox': null } }), 0, 0)).toBeNull();
  });
});

describe('differingEdges', () => {
  it('names the edges a tenth of a pixel apart or more', () => {
    const none = { west: false, south: false, east: false, north: false };
    expect(differingEdges([19, 59, 32, 70], [19, 59, 32, 70], [0.04, 0.04])).toEqual(none);
    expect(differingEdges([19.003, 59, 32, 70], [19, 59, 32, 70], [0.04, 0.04])).toEqual(none);
    expect(differingEdges([19.004, 59, 32, 70], [19, 59, 32, 70], [0.04, 0.04])).toEqual({ ...none, west: true });
    expect(differingEdges([19, 59, 32, 70], [19, 59, 32, 68], [0.04, 0.04])).toEqual({ ...none, north: true });
    expect(differingEdges([18, 58, 33, 71], [19, 59, 32, 70], [0.04, 0.04])).toEqual({ west: true, south: true, east: true, north: true });
    // Each axis in its own pixels: 0.05° is 5 pixels down here, and a twentieth of one across
    expect(differingEdges([19.05, 59, 32, 70.05], [19, 59, 32, 70], [1, 0.01])).toEqual({ ...none, north: true });
  });
});
