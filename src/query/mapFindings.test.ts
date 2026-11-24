import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/meteocore-map-checks.json';
import type { Citation, Collection, Rule, ValidationError } from '../types/api';
import type { ResponseHeader } from '../api/sendRequest';
import type { ResolvedParam } from '../validation/openapi/operationIndex';
import { apiDocsParams, type ApiDocsParam } from './declared';
import { readImageBytes, type ImageBytes } from './mapResponse';
import { mapCheckContext, mapFindings, mentions, refusalsAsked, serverMessage, type MapFindings, type MapFindingsInput } from './mapFindings';

// MeteoCore's responses, collections, Maps classes and API docs, as fetched (meteocore-map-checks.json). A response
// changed here is made up: MeteoCore doesn't send it, and each test says what was changed
type Name = keyof typeof fixture.responses;
interface Captured { url: string; status: number; headers: ResponseHeader[]; start?: string; body?: string }
const RADAR = fixture.collections.radar as unknown as Collection;
const IFS = fixture.collections.ifs as unknown as Collection;
const DOCS: ApiDocsParam[] = apiDocsParams(fixture.apiParams.map(param => ({
  ...param, enumValues: (param.schema as { enum?: string[] }).enum ?? null, isArray: false,
})) as unknown as ResolvedParam[]);
const MAPS = fixture.conformsTo;
const GENERAL = [...MAPS, 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/general-subsetting'];
const CORS = [...MAPS, 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/cors'];
const M3857 = 'http://www.opengis.net/def/crs/EPSG/0/3857';
const M4326 = 'http://www.opengis.net/def/crs/EPSG/0/4326';
const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
// The request line holds a subset's quotes as typed
const lineOf = (url: string) => url.replace(/%22/g, '"');

interface Change {
  url?: string;
  status?: number;
  headers?: Record<string, string | null>;
  image?: ImageBytes | null;
  body?: string | null;
  collection?: Collection | null;
  conformsTo?: string[] | null;
  apiDocs?: ApiDocsParam[] | null;
  limits?: MapFindingsInput['limits'];
  accept?: string | null;
}

// A fixture's response, read as the pane reads it, with what a test changes
function inputOf(name: Name, change: Change = {}): MapFindingsInput {
  const response = fixture.responses[name] as Captured;
  let headers = response.headers.map(header => ({ ...header }));
  for (const [header, value] of Object.entries(change.headers ?? {})) {
    headers = headers.filter(each => each.name !== header);
    if (value !== null) headers.push({ name: header, value });
  }
  const url = lineOf(change.url ?? response.url);
  return {
    url,
    status: change.status ?? response.status,
    headers,
    contentType: headers.find(header => header.name === 'content-type')?.value ?? '',
    image: change.image !== undefined ? change.image : response.start ? readImageBytes(bytesOf(response.start)) : null,
    body: change.body !== undefined ? change.body : response.body ?? null,
    collection: change.collection !== undefined ? change.collection : url.includes('ecmwf-ifs-pressure') ? IFS : RADAR,
    conformsTo: change.conformsTo !== undefined ? change.conformsTo : MAPS,
    apiDocs: change.apiDocs !== undefined ? change.apiDocs : DOCS,
    limits: change.limits ?? null,
    accept: change.accept ?? null,
  };
}

const labels = (rule: ValidationError['rule']) => (rule === undefined ? [] : (Array.isArray(rule) ? rule : [rule as Citation])).map(each => (each as Rule).label.replace(/^Maps 1 /, ''));
// Each finding as a line: its severity, message, and the rules it cites
const said = (found: ValidationError[]) => found.map(each => `${each.severity}: ${each.message}${each.rule ? ` | ${labels(each.rule).join(' · ')}` : ''}`);
const run = (name: Name, change?: Change): MapFindings => mapFindings(inputOf(name, change));
const mapSaid = (name: Name, change?: Change) => said(run(name, change).map);
const one = (lines: string[], pattern: RegExp) => lines.filter(line => pattern.test(line));

describe('serverMessage', () => {
  it("takes an error's own words: OGC's detail, MeteoCore's description, a message or a title", () => {
    expect(serverMessage(fixture.responses.widthZero.body)).toBe("width '0' must be a positive integer");
    expect(serverMessage('{"type":"x","title":"Bad Request","status":400,"detail":"crs not supported"}')).toBe('crs not supported');
    expect(serverMessage('{"message":"no"}')).toBe('no');
    expect(serverMessage('{"title":"Not Found"}')).toBe('Not Found');
    expect(serverMessage('{"code":400}')).toBe('{"code":400}');
    // An empty one says nothing
    expect(serverMessage('{"detail":" ","description":"bbox is wrong"}')).toBe('bbox is wrong');
  });

  it('takes the start of any other text, and nothing of none', () => {
    expect(serverMessage('  Bad\n request  ')).toBe('Bad request');
    expect(serverMessage('x'.repeat(250))).toBe(`${'x'.repeat(200)}…`);
    expect(serverMessage('')).toBe('');
    expect(serverMessage(null)).toBe('');
  });
});

describe('mentions', () => {
  it('finds a word of its own, in any letter case', () => {
    expect(mentions("CRS 'EPSG:2393' is not supported", 'crs')).toBe(true);
    expect(mentions("subset axis 'vertical' is not supported", 'vertical')).toBe(true);
    expect(mentions('the bbox-crs is wrong', 'crs')).toBe(false);
    expect(mentions('verticality', 'vertical')).toBe(false);
    expect(mentions('anything', ' ')).toBe(false);
  });
});

describe('a map that came back', () => {
  it('passes every check on the matched view, each citing its rule, with the pixels the request asked for apart', () => {
    const found = run('matched');
    expect(said(found.map)).toEqual([
      'pass: Status 200 | /req/core/map-response A',
      'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
      'pass: The image is 478 × 721, the width and height asked | /req/scaling/width-definition B · /req/scaling/height-definition B',
      'pass: Content-Crs is the crs asked, EPSG:3857 | /req/core/map-response C · /req/crs/map-success A',
      'pass: Content-Bbox has four numbers, and is the bbox asked, 15.5,58.5,35.5,71 | /req/core/map-response D · /req/core/map-response E · /req/spatial-subsetting/map-success A',
      "pass: Content-Datetime 2026-11-16T21:40:00Z, the server's choice with no time asked | /req/core/map-response F · /req/core/map-response H",
    ]);
    expect(said(found.request)).toEqual(["info: Pixels aren't square: 4,658 m wide and 4,617 m tall, since 478 × 721 isn't the box's shape. 715 tall would keep it"]);
    expect(said(found.browser)).toEqual(['pass: Content-Crs, Content-Bbox and Content-Datetime reached the browser: Access-Control-Expose-Headers: *']);
  });

  it('checks a bare map against storageCrs and the extent it should cover', () => {
    expect(mapSaid('bare')).toEqual([
      'pass: Status 200 | /req/core/map-response A',
      'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
      'pass: With no width or height asked, the server chose 1024 × 905, which keeps pixels square | /rec/core/map-op B',
      'pass: Content-Crs is storageCrs, EPSG:3067 | /req/core/map-response C · /req/core/map-response B',
      "pass: Content-Bbox has four numbers, and with no box asked covers the collection's storageCrsBbox | /req/core/map-response D · /req/core/map-response E · /rec/core/map-op A",
      "pass: Content-Datetime 2026-11-16T21:40:00Z, the server's choice with no time asked | /req/core/map-response F · /req/core/map-response H",
    ]);
  });

  it("isn't 200: an error, or a 204 only where Maps 1.0 asks for one", () => {
    expect(mapSaid('bare', { status: 203 })[0]).toBe('error: Status 203: a successful map is a 200 | /req/core/map-response A');
    expect(mapSaid('bare', { status: 204, image: null })).toEqual(['error: 204, no map: a successful map is a 200 | /req/core/map-response A']);
    expect(mapSaid('timeOutside', { status: 204, image: null, body: null })).toEqual([
      'pass: 204, no map, for subset=time("2020-01-01T00:00:00Z"): it\'s outside the collection\'s times, and Maps 1.0 asks a 204 or 404 | /req/datetime/subset-definition D',
    ]);
  });

  describe('its Content-Type and body', () => {
    it('is the format f asked, and says so; another image type is an issue', () => {
      expect(one(mapSaid('jpeg'), /Content-Type/)).toEqual(['pass: Content-Type image/jpeg, as f asked, and the body is a JPEG | /req/core/map-response I · /req/jpeg/content A']);
      expect(one(mapSaid('bare', { url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?f=image/jpeg' }), /Content-Type/)).toEqual([
        'warning: f=image/jpeg asked, and the Content-Type is image/png | /req/core/map-response I',
        'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
      ]);
    });

    it("is an error where it isn't an image, unless f asked for that (made up)", () => {
      const json = { headers: { 'content-type': 'application/json' }, image: null, body: '{"type":"FeatureCollection"}' };
      expect(one(mapSaid('bare', json), /Content-Type/)).toEqual([`error: Content-Type application/json: a map's 200 is the map itself, encoded as an image: it starts with {"type":"FeatureCollection"} | /req/core/map-response I`]);
      expect(one(mapSaid('bare', { ...json, url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?f=application/json' }), /Content-Type/))
        .toEqual(['pass: Content-Type application/json, as f asked | /req/core/map-response I']);
      // With no image, nothing is said of its size, and its headers are still read
      const found = mapSaid('bare', json);
      expect(one(found, /image is|pixels/)).toEqual([]);
      expect(one(found, /Content-Crs is storageCrs/)).toHaveLength(1);
    });

    it("is an error where the body isn't what Content-Type says (made up), citing the format's class", () => {
      const json = readImageBytes(new TextEncoder().encode('{"code":"BadRequest","description":"x"}'));
      expect(one(mapSaid('bare', { image: json }), /Content-Type/)).toEqual(['error: Content-Type image/png, and the body isn\'t a PNG: it starts with {"code":"BadRequest","de | /req/png/content A']);
      expect(one(mapSaid('bare', { headers: { 'content-type': 'image/jpeg' } }), /Content-Type/)).toEqual(['error: Content-Type image/jpeg, and the body is a PNG | /req/jpeg/content A']);
      // WebP has no class of its own in Maps 1.0
      expect(one(mapSaid('bare', { headers: { 'content-type': 'image/webp' } }), /Content-Type/)).toEqual(['error: Content-Type image/webp, and the body is a PNG | /req/core/map-response I']);
      expect(one(mapSaid('bare', { headers: { 'content-type': 'image/gif' } }), /Content-Type/)).toEqual(["pass: Content-Type image/gif: an image, whose bytes the app doesn't read | /req/core/map-response I"]);
    });
  });

  // MeteoCore ignores Accept: asked for image/jpeg with no f, it sends image/png, as 'bare' has it
  describe('its format, against the Accept it was sent with', () => {
    const format = (change: Change, name: Name = 'bare') => {
      const found = run(name, change);
      return [...one(said(found.map), /Content-Type|Accept/), ...said(found.request).map(line => `request ${line}`)];
    };
    const BARE = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';

    it('says nothing of the app’s */*, nor where none is known', () => {
      const plain = ['pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A'];
      expect(format({})).toEqual(plain);
      expect(format({ accept: '*/*' })).toEqual(plain);
      expect(format({ accept: '*/*;q=0.5' })).toEqual(plain);
    });

    it('passes a Content-Type Accept takes, by its type, type/* or */*', () => {
      expect(format({ accept: 'image/png' })).toEqual(['pass: Content-Type image/png, as Accept asked, and the body is a PNG | /req/core/map-response I · /req/png/content A']);
      expect(format({ accept: 'image/*' })).toEqual(['pass: Content-Type image/png, as Accept asked, and the body is a PNG | /req/core/map-response I · /req/png/content A']);
      expect(format({ accept: 'image/jpeg, */*;q=0.1' })).toEqual(['pass: Content-Type image/png, as Accept asked, and the body is a PNG | /req/core/map-response I · /req/png/content A']);
      expect(format({ accept: 'image/jpeg' }, 'jpeg')).toEqual(['pass: Content-Type image/jpeg, as f and Accept asked, and the body is a JPEG | /req/core/map-response I · /req/jpeg/content A']);
      // Made up: a JSON 200 Accept asked for, as f would
      expect(format({ accept: 'application/json', headers: { 'content-type': 'application/json' }, image: null, body: '{}' })).toEqual(['pass: Content-Type application/json, as Accept asked | /req/core/map-response I']);
    });

    it('is an error where it isn’t one Accept takes, citing the test of the class the API declares for what was asked', () => {
      expect(format({ accept: 'image/jpeg' })).toEqual([
        'error: Accept: image/jpeg asked, and the Content-Type is image/png | /req/core/map-response I · /conf/jpeg/content, test A.56',
        'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
      ]);
      // Its most specific range takes image/png out
      expect(format({ accept: 'image/*, image/png;q=0' })[0]).toBe('error: Accept: image/*, image/png;q=0 asked, and the Content-Type is image/png | /req/core/map-response I · /conf/jpeg/content, test A.56');
      // WebP has no Maps class: the API docs' f lists it
      expect(format({ accept: 'image/webp' })[0]).toBe('error: Accept: image/webp asked, and the Content-Type is image/png | /req/core/map-response I');
      // JPEG that only the API docs' f lists, where the API doesn't declare the class: no test of its to cite
      expect(format({ accept: 'image/jpeg', conformsTo: MAPS.filter(uri => !uri.endsWith('/conf/jpeg')) })[0]).toBe('error: Accept: image/jpeg asked, and the Content-Type is image/png | /req/core/map-response I');
      // Where nothing is known of what the API makes
      expect(format({ accept: 'image/gif', conformsTo: null, apiDocs: null })[0]).toBe('error: Accept: image/gif asked, and the Content-Type is image/png | /req/core/map-response I');
    });

    it('is about the request where Accept takes no format the API declares or lists, which HTTP lets a server disregard', () => {
      expect(format({ accept: 'image/gif' })).toEqual([
        'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
        "request info: Accept: image/gif asked, and the Content-Type is image/png: Accept takes no format the API declares or its API docs list, and HTTP lets a server disregard an Accept it can't meet (RFC 9110, 12.5.1)",
      ]);
    });

    it('with f asking for another, passes the one the server followed, and says the clash is the request’s', () => {
      const negotiation = 'request info: f=image/png and Accept: image/jpeg ask for different formats: the server sent image/png, as f asked | 7.2.3 NOTE 2';
      expect(format({ url: `${BARE}?f=image/png`, accept: 'image/jpeg' })).toEqual([
        'pass: Content-Type image/png, as f asked, and the body is a PNG | /req/core/map-response I · /req/png/content A', negotiation,
      ]);
      expect(format({ url: `${BARE}?f=image/jpeg`, accept: 'image/png' })).toEqual([
        'pass: Content-Type image/png, as Accept asked, and the body is a PNG | /req/core/map-response I · /req/png/content A',
        'request info: f=image/jpeg and Accept: image/png ask for different formats: the server sent image/png, as Accept asked | 7.2.3 NOTE 2',
      ]);
      // Both asked for what the server didn't send: each is checked as alone
      expect(format({ url: `${BARE}?f=image/jpeg`, accept: 'image/jpeg' })).toEqual([
        'error: Accept: image/jpeg asked, and the Content-Type is image/png | /req/core/map-response I · /conf/jpeg/content, test A.56',
        'warning: f=image/jpeg asked, and the Content-Type is image/png | /req/core/map-response I',
        'pass: Content-Type image/png, and the body is a PNG | /req/core/map-response I · /req/png/content A',
      ]);
      expect(format({ url: `${BARE}?f=image/png`, accept: 'image/png' })).toEqual(['pass: Content-Type image/png, as f and Accept asked, and the body is a PNG | /req/core/map-response I · /req/png/content A']);
    });
  });

  describe('its size', () => {
    it('is the width and height asked, or an error (made up)', () => {
      expect(one(mapSaid('matched', { image: { format: 'PNG', width: 478, height: 700, start: '' } }), /The image/))
        .toEqual(['error: The image is 478 × 700, not the width 478 and height 721 asked | /req/scaling/width-definition B · /req/scaling/height-definition B']);
      expect(one(mapSaid('jpeg'), /The image|With no/)).toEqual([
        'pass: The image is 256 × 226, the width asked | /req/scaling/width-definition B',
        'pass: With no height asked, the server chose 256 × 226, which keeps pixels square | /rec/core/map-op B',
      ]);
    });

    it("chosen by the server, should keep pixels square: an issue where it doesn't (made up)", () => {
      expect(one(mapSaid('bare', { image: { format: 'PNG', width: 1024, height: 700, start: '' } }), /With no/))
        .toEqual(["warning: With no width or height asked, the server chose 1024 × 700, whose pixels aren't square: 2,208 m wide and 2,855 m tall. 905 tall would keep the box's shape | /rec/core/map-op B"]);
    });

    it("isn't the box's shape as asked: about the request, only where the image and its box are what was asked", () => {
      expect(said(run('snapped').request)).toEqual(["info: Pixels aren't square: 4,824 m wide and 7,221 m tall, since 300 × 400 isn't the box's shape. 599 tall would keep it"]);
      // The box isn't the one asked: the server's doing, which its own check says
      expect(run('matched', { headers: { 'content-bbox': '1725452.1072957402,8073093.6119444575,3951841.9231612114,11000000' } }).request).toEqual([]);
      expect(run('matched', { image: { format: 'PNG', width: 478, height: 715, start: '' } }).request).toEqual([]);
    });
  });

  describe('its Content-Crs', () => {
    it('is the crs asked, else storageCrs, else CRS84: an error where it isn’t (made up)', () => {
      expect(one(mapSaid('matched', { headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/3067' } }), /Content-Crs/))
        .toEqual(['error: Content-Crs is EPSG:3067, not the crs asked, EPSG:3857 | /req/crs/map-success A']);
      expect(one(mapSaid('bare', { headers: { 'content-crs': M3857 } }), /Content-Crs/)).toEqual(['error: Content-Crs is EPSG:3857, not storageCrs, EPSG:3857'.replace('storageCrs, EPSG:3857', 'storageCrs, EPSG:3067') + ' | /req/core/map-response B']);
      const noStorage = { ...RADAR, storageCrs: undefined } as unknown as Collection;
      expect(one(mapSaid('bare', { collection: noStorage }), /Content-Crs/)).toEqual(['error: Content-Crs is EPSG:3067, not CRS84, CRS84 | /req/core/map-response B']);
      // Read in the forms Maps 1.0 writes it
      expect(one(mapSaid('matched', { headers: { 'content-crs': `<${M3857}>` } }), /Content-Crs/)).toEqual(['pass: Content-Crs is the crs asked, EPSG:3857 | /req/core/map-response C · /req/crs/map-success A']);
      expect(one(mapSaid('matched', { headers: { 'content-crs': '[EPSG:3857]' } }), /Content-Crs/)).toEqual(['pass: Content-Crs is the crs asked, EPSG:3857 | /req/core/map-response C · /req/crs/map-success A']);
      expect(one(mapSaid('matched', { collection: null }), /Content-Crs/)).toEqual(['pass: Content-Crs is the crs asked, EPSG:3857 | /req/core/map-response C · /req/crs/map-success A']);
      expect(one(mapSaid('bare', { collection: null }), /Content-Crs/)).toEqual(['pass: Content-Crs EPSG:3067 | /req/core/map-response C']);
    });

    it('is a URI or a safe CURIE: an unsafe one is an error (made up)', () => {
      expect(one(mapSaid('matched', { headers: { 'content-crs': 'EPSG:3857' } }), /Content-Crs/))
        .toEqual(['error: Content-Crs EPSG:3857 is an unsafe CURIE: Maps 1.0 asks for the URI or a safe CURIE, [EPSG:3857] | /req/core/map-response C']);
    });

    it("is there, unless the map is in CRS84, where it's still recommended (made up)", () => {
      // Every header exposed: it wasn't sent
      expect(one(mapSaid('matched', { headers: { 'content-crs': null } }), /Content-Crs/))
        .toEqual(['error: No Content-Crs, so the map reads as CRS84, where the crs asked is EPSG:3857 | /req/core/map-response C · /req/crs/map-success A']);
      expect(one(mapSaid('elevation', { headers: { 'content-crs': null } }), /Content-Crs/))
        .toEqual(['warning: No Content-Crs: the map reads as CRS84, which Maps 1.0 recommends saying too | /rec/core/content-crs A']);
    });
  });

  describe('its Content-Bbox', () => {
    it('is four numbers, in the CRS’s order: an error otherwise (made up)', () => {
      expect(one(mapSaid('bare', { headers: { 'content-bbox': '1,2,3,4,5,6' } }), /Content-Bbox/)).toEqual(["error: Content-Bbox 1,2,3,4,5,6 isn't four numbers | /req/core/map-response E"]);
      expect(one(mapSaid('bare', { headers: { 'content-bbox': '1,2,x,4' } }), /Content-Bbox/)).toEqual(["error: Content-Bbox 1,2,x,4 isn't four numbers | /req/core/map-response E"]);
      const crs84 = { headers: { 'content-crs': CRS84, 'content-bbox': '19,95,32,100' }, url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map' };
      expect(one(mapSaid('bare', { ...crs84, collection: null }), /Content-Bbox/)).toEqual(["error: Content-Bbox 19,95,32,100 isn't in CRS84's order: 95 can't be a latitude, which CRS84 has second | /req/core/map-response E"]);
      const lat4326 = { headers: { 'content-crs': M4326, 'content-bbox': '95,19,100,32' }, url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map', collection: null };
      expect(one(mapSaid('bare', lat4326), /Content-Bbox/)).toEqual(["error: Content-Bbox 95,19,100,32 isn't in EPSG:4326's order: 95 can't be a latitude, which EPSG:4326 has first | /req/core/map-response E"]);
      const latFirst = `https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=19,59,32,70&crs=${M4326}&width=300&height=254`;
      expect(one(mapSaid('bare', { url: latFirst, headers: { 'content-crs': M4326, 'content-bbox': '59,19,70,32' }, image: { format: 'PNG', width: 300, height: 254, start: '' } }), /Content-Bbox/))
        .toEqual(['pass: Content-Bbox has four numbers, and is the bbox asked, 19,59,32,70 | /req/core/map-response D · /req/core/map-response E · /req/spatial-subsetting/map-success A']);
      expect(one(mapSaid('bare', { url: latFirst, headers: { 'content-crs': M4326, 'content-bbox': '19,59,32,70' }, image: { format: 'PNG', width: 300, height: 254, start: '' } }), /Content-Bbox/))
        .toEqual(['error: Content-Bbox 19,59,32,70 is the bbox asked in the other axis order: EPSG:4326 has latitude first | /req/core/map-response E']);
    });

    it('is there: an error where it surely wasn’t sent (made up)', () => {
      expect(one(mapSaid('bare', { headers: { 'content-bbox': null } }), /Content-Bbox/)).toEqual(['error: No Content-Bbox: the map has no box to be placed by | /req/core/map-response D']);
      // Named, in any letter case, by Access-Control-Expose-Headers
      expect(one(mapSaid('bare', { headers: { 'content-bbox': null, 'access-control-expose-headers': 'Content-Crs, Content-Bbox, Content-Datetime' } }), /Content-Bbox/))
        .toEqual(['error: No Content-Bbox: the map has no box to be placed by | /req/core/map-response D']);
    });

    it("is the bbox asked: a note where it isn't quite, an error where it doesn't meet it (made up)", () => {
      expect(one(mapSaid('matched', { headers: { 'content-bbox': '1725452.1072957402,8073093.6119444575,3951841.9231612114,11000000' } }), /Content-Bbox/)).toEqual([
        'pass: Content-Bbox has four numbers, in EPSG:3857 | /req/core/map-response D · /req/core/map-response E',
        "info: Content-Bbox isn't quite the bbox asked: its north edge, by up to 99.09 px | /req/spatial-subsetting/map-success A",
      ]);
      expect(one(mapSaid('matched', { headers: { 'content-bbox': '0,0,10,10' } }), /Content-Bbox/))
        .toEqual(["error: Content-Bbox doesn't meet the bbox asked: the map is of somewhere else | /req/spatial-subsetting/map-success A"]);
    });

    it('with no box asked, covers the extent: an issue where it leaves some out (made up)', () => {
      expect(one(mapSaid('bare', { headers: { 'content-bbox': '-758912.6774445442,6198787.525751867,900000,8197054.085172687' } }), /Content-Bbox/)).toEqual([
        'pass: Content-Bbox has four numbers, in EPSG:3067 | /req/core/map-response D · /req/core/map-response E',
        "warning: With no box asked, Content-Bbox leaves out part of the collection's storageCrsBbox: its east edge, by up to 89 px | /rec/core/map-op A",
      ]);
      // In CRS84 against the extent itself
      expect(one(mapSaid('elevation'), /Content-Bbox/)).toEqual(["pass: Content-Bbox has four numbers, and with no box asked covers the collection's extent | /req/core/map-response D · /req/core/map-response E · /rec/core/map-op A"]);
    });

    it("is only said to have four numbers where there's nothing to compare it with", () => {
      expect(one(mapSaid('bare', { collection: null }), /Content-Bbox/)).toEqual(['pass: Content-Bbox has four numbers, in EPSG:3067 | /req/core/map-response D · /req/core/map-response E']);
      // A bbox asked in a CRS the app can't turn into the map's
      const other = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=1,2,3,4&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3035';
      expect(one(mapSaid('bare', { url: other }), /Content-Bbox/))
        .toEqual(["pass: Content-Bbox has four numbers, in EPSG:3067; the bbox asked is in EPSG:3035, which the app can't turn into EPSG:3067 to compare | /req/core/map-response D · /req/core/map-response E"]);
    });
  });

  describe('its Content-Datetime', () => {
    it('is the time asked, or one Maps 1.0 permits, or an error', () => {
      expect(one(mapSaid('snapped'), /Content-Datetime/))
        .toEqual(['info: Content-Datetime 2026-11-16T12:00:00Z, not the 2026-11-16T12:02:00Z asked: a server may draw the closest time, or the last before it, that it has | /per/datetime/closest A']);
      const at = (datetime: string, header: string) => one(mapSaid('snapped', {
        url: `https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=19,59,32,70&crs=${M3857}&width=300&height=400&datetime=${datetime}`,
        headers: { 'content-datetime': header },
      }), /Content-Datetime/);
      expect(at('2026-11-16T12:00:00Z', '2026-11-16T12:00:00Z')).toEqual(['pass: Content-Datetime is the datetime asked | /req/core/map-response F · /req/datetime/map-success A']);
      expect(at('2026-11-16T12:00:00Z', '2026-11-16T11:55:00Z/2026-11-16T12:05:00Z'))
        .toEqual(['pass: Content-Datetime 2026-11-16T11:55:00Z/2026-11-16T12:05:00Z, an interval holding the datetime asked | /req/core/map-response F · /req/datetime/map-success A']);
      expect(at('2026-11-16T00:00:00Z/2026-11-16T06:00:00Z', '2026-11-16T06:00:00Z'))
        .toEqual(['pass: Content-Datetime 2026-11-16T06:00:00Z, inside the interval asked | /req/core/map-response F · /req/datetime/datetime-response A']);
      expect(at('2026-11-16T00:00:00Z/2026-11-16T06:00:00Z', '2026-11-16T12:00:00Z'))
        .toEqual(['error: Content-Datetime 2026-11-16T12:00:00Z is outside the interval asked, 2026-11-16T00:00:00Z/2026-11-16T06:00:00Z | /req/datetime/datetime-response A · /req/datetime/map-success A']);
      expect(at('yesterday', '2026-11-16T12:00:00Z'))
        .toEqual(["pass: Content-Datetime 2026-11-16T12:00:00Z, the server's choice with a datetime it can't be compared with | /req/core/map-response F · /req/core/map-response H"]);
    });

    it('is read as RFC 3339: an error otherwise (made up)', () => {
      expect(one(mapSaid('bare', { headers: { 'content-datetime': 'today' } }), /Content-Datetime/))
        .toEqual(["error: Content-Datetime today isn't an RFC 3339 time, or two with a / between | /req/core/map-response G · /req/core/map-response H"]);
      expect(one(mapSaid('bare', { headers: { 'content-datetime': '2026-11-16T12:00:00' } }), /Content-Datetime/)[0]).toMatch(/^error: /);
    });

    it('is there where the collection has time: an error where it surely wasn’t sent (made up)', () => {
      expect(one(mapSaid('bare', { headers: { 'content-datetime': null } }), /Content-Datetime/)).toEqual(['error: No Content-Datetime, though the collection has a temporal extent | /req/core/map-response F']);
      const noTime = { ...RADAR, extent: { ...RADAR.extent, temporal: undefined } } as unknown as Collection;
      expect(one(mapSaid('bare', { headers: { 'content-datetime': null }, collection: noTime }), /Content-Datetime/)).toEqual([]);
    });
  });

  describe('what the browser could read', () => {
    it('says which headers reached it, citing CORS only where the API declares it', () => {
      expect(said(run('bare', { conformsTo: CORS }).browser)).toEqual(['pass: Content-Crs, Content-Bbox and Content-Datetime reached the browser: Access-Control-Expose-Headers: * | /req/cors/cors A']);
    });

    it("says which didn't, and doesn't check them, where they may not have been exposed (made up)", () => {
      const found = run('bare', { headers: { 'access-control-expose-headers': 'Content-Crs', 'content-bbox': null, 'content-datetime': null } });
      expect(said(found.browser)).toEqual([
        "info: Content-Bbox and Content-Datetime didn't reach the browser: the server didn't send them, or didn't expose them with Access-Control-Expose-Headers (Content-Crs). Not checked",
        'pass: Content-Crs reached the browser',
      ]);
      expect(one(said(found.map), /Content-Bbox|Content-Datetime/)).toEqual([]);
      expect(said(run('bare', { headers: { 'access-control-expose-headers': null, 'content-crs': null, 'content-bbox': null, 'content-datetime': null } }).browser)).toEqual([
        "info: Content-Crs, Content-Bbox and Content-Datetime didn't reach the browser: the server didn't send them, or didn't expose them with Access-Control-Expose-Headers. Not checked",
      ]);
    });
  });

  describe('a request a standard asks to be refused, answered 200 (made up)', () => {
    it('is an error by Maps 1.0', () => {
      const bare = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
      expect(one(mapSaid('bare', { url: `${bare}?width=0` }), /^error/)).toEqual(["error: 200 for width=0: it isn't a positive integer, and Maps 1.0 asks a 4xx | /req/scaling/width-definition C"]);
      expect(one(mapSaid('bare', { url: `${bare}?bbox=19,59,32,70&center=25,62` }), /200 for/))
        .toEqual(['error: 200 for bbox with center: Maps 1.0 asks a 4xx | /req/spatial-subsetting/bbox-definition B · /req/spatial-subsetting/center-definition B']);
      expect(one(mapSaid('bare', { url: `${bare}?subset=foo(1:2)` }), /200 for/))
        .toEqual(['error: 200 for subset=foo(1:2): no Maps class the API declares has the axis foo, and Maps 1.0 asks a 4xx | /req/spatial-subsetting/subset-definition D · /req/datetime/subset-definition C']);
      expect(one(mapSaid('bare', { url: `${bare}?subset=time("2020-01-01T00:00:00Z")` }), /200 for/))
        .toEqual(['error: 200 for subset=time("2020-01-01T00:00:00Z"): it\'s outside the collection\'s times, and Maps 1.0 asks a 204 or 404 | /req/datetime/subset-definition D']);
    });

    it("is a note where a server may take it: Common Part 1's invalid values, an axis the API docs name", () => {
      const bare = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
      expect(one(mapSaid('bare', { url: `${bare}?crs=http://www.opengis.net/def/crs/EPSG/0/2393`, headers: { 'content-crs': 'http://www.opengis.net/def/crs/EPSG/0/2393' } }), /200 for/))
        .toEqual(["info: 200 for crs=EPSG:2393, though the collection's crs list doesn't have it: the server tolerated it, as Common Part 1 lets it | Common 1 /req/core/query-param-value-invalid A · /req/crs/crs-definition B"]);
      expect(one(mapSaid('run'), /200 for/))
        .toEqual(['info: 200 for subset=reference_time("2026-11-16T12:00:00Z"), an axis the API docs\' subset names, though no Maps class the API declares has the axis reference_time, where Maps 1.0 asks a 4xx: general-subsetting would make it Maps 1.0\'s']);
    });
  });
});

describe('a refusal', () => {
  it('passes where Maps 1.0 asks for it, quoting the server', () => {
    expect(mapSaid('widthZero')).toEqual([`pass: 400 for width=0: it isn't a positive integer, and Maps 1.0 asks a 4xx. The server says: "width '0' must be a positive integer" | /req/scaling/width-definition C`]);
    expect(mapSaid('bboxCenter')).toEqual(['pass: 400 for bbox with center: Maps 1.0 asks a 4xx. The server says: "bbox and center cannot be used together: both set the map area" | /req/spatial-subsetting/bbox-definition B · /req/spatial-subsetting/center-definition B']);
    expect(mapSaid('unknownAxis')).toEqual([`pass: 400 for subset=foo(1:2): no Maps class the API declares has the axis foo, and Maps 1.0 asks a 4xx. The server says: "subset axis 'foo' is not supported; valid axes: Lon, Lat, E, N, time" | /req/spatial-subsetting/subset-definition D · /req/datetime/subset-definition C`]);
    expect(mapSaid('timeOutside')).toEqual([`pass: 404 for subset=time("2020-01-01T00:00:00Z"): it's outside the collection's times, and Maps 1.0 asks a 204 or 404. The server says: "No data for subset time 2020-01-01T00:00:00Z: the collection's time axis has none" | /req/datetime/subset-definition D`]);
  });

  it('passes where Common Part 1 asks for it, of a value that isn’t one', () => {
    const crs = mapSaid('crsUnlisted');
    expect(crs).toHaveLength(1);
    expect(crs[0].startsWith(`pass: 400 for crs=EPSG:2393: the collection's crs list doesn't have it, and Common Part 1 asks a 400 for an invalid value. The server says: "CRS '${fixture.responses.crsUnlisted.url.split('crs=')[1]}' is not supported.`)).toBe(true);
    expect(crs[0].endsWith('" | Common 1 /req/core/query-param-value-invalid A · /req/crs/crs-definition B')).toBe(true);
    const bare = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
    expect(mapSaid('widthZero', { url: `${bare}?bbox=1,2,3`, body: null })).toEqual(['pass: 400 for bbox=1,2,3: bbox has 3 numbers: Maps 1.0 takes four, or six for a box with heights, and Common Part 1 asks a 400 for an invalid value | Common 1 /req/core/query-param-value-invalid A']);
    expect(mapSaid('widthZero', { url: `${bare}?datetime=today`, body: null })).toEqual(["pass: 400 for datetime=today: it isn't an RFC 3339 time or interval, and Common Part 1 asks a 400 for an invalid value | Common 1 /req/core/query-param-value-invalid A"]);
    expect(mapSaid('widthZero', { url: `${bare}?foo=1`, body: null })).toEqual(['pass: 400 for foo: no Maps class the API declares, nor the API docs, names it, and Common Part 1 asks a 400 for a parameter the API docs leave out | Common 1 /req/core/query-param-name-unknown A']);
  });

  it("is an error where Maps 1.0 asks a 204 or 404 and it's another 4xx (made up)", () => {
    expect(mapSaid('timeOutside', { status: 400 })[0]).toMatch(/^error: 400 for subset=time\("2020-01-01T00:00:00Z"\): it's outside the collection's times, and Maps 1\.0 asks a 204 or 404\./);
  });

  it('of a level, passes by Maps 1.0, and says the draft profile meant it to work, citing nothing of it', () => {
    expect(mapSaid('vertical')).toEqual([
      `pass: 400 for subset=vertical(850): no Maps class the API declares has the axis vertical, and Maps 1.0 asks a 4xx. The server says: "subset axis 'vertical' is not supported; valid axes: Lon, Lat, E, N, time, reference_time" | /req/spatial-subsetting/subset-definition D · /req/datetime/subset-definition C`,
      "info: subset=vertical(850) should have worked by the MetOcean Maps draft, which picks a level with subset=vertical(…), and extent.vertical.values lists 850. The draft isn't a standard yet; in Maps 1.0, general-subsetting, which the API doesn't declare, would make vertical an axis",
    ]);
  });

  it('of a level, says the extent lists it only where it lists every level asked, written either way', () => {
    const ifs = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map';
    expect(one(mapSaid('vertical', { url: `${ifs}?subset=vertical(850.0)` }), /^info/)[0]).toContain(', and extent.vertical.values lists 850.0. The draft');
    expect(one(mapSaid('vertical', { url: `${ifs}?subset=vertical(850:5)` }), /^info/)[0]).toContain('with subset=vertical(…). The draft');
  });

  it('of a level, where the API declares general-subsetting, is an error by its rule (made up)', () => {
    expect(mapSaid('vertical', { conformsTo: GENERAL })).toEqual([
      `error: 400 for subset=vertical(850), though general-subsetting, which the API declares, makes vertical an axis, and extent.vertical.values lists 850. The server says: "subset axis 'vertical' is not supported; valid axes: Lon, Lat, E, N, time, reference_time" | /req/general-subsetting/subset-definition B`,
    ]);
    // A level outside the extent's, which general-subsetting asks a 204 or 404 for
    expect(mapSaid('timeOutside', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?subset=vertical(5000)', conformsTo: GENERAL }))
      .toEqual([`pass: 404 for subset=vertical(5000): it's outside extent.vertical, 10 to 1000, and Maps 1.0 asks a 204 or 404. The server says: "No data for subset time 2020-01-01T00:00:00Z: the collection's time axis has none" | /req/general-subsetting/subset-definition D`]);
  });

  it("of an axis the API docs name, says the server's own docs meant it to work (made up)", () => {
    expect(mapSaid('vertical', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?subset=reference_time("2026-11-16T12:00:00Z")' })[1])
      .toBe('warning: subset=reference_time("2026-11-16T12:00:00Z") is in the API docs\' subset, which names the axis: by the server\'s own docs, it should have worked');
  });

  it("for a request the form found nothing wrong with, cites what in the API said it would work: a style's", () => {
    expect(mapSaid('contours')).toEqual([
      `warning: 404 for the style contours, though the collection's styles list has it, and styled-map, which the API declares, has each style's map at …/styles/{styleId}/map. Its own map link adds parameter-name=z, which the request doesn't have, so whether its path alone must work is arguable. The server says: "Style 'contours' not found for collection 'ecmwf-ifs-pressure'. Available: default" | /req/styled-map/map-operation A`,
    ]);
    // With its link's query, or a style whose link has none, the path SHALL work
    expect(mapSaid('contours', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/styles/contours/map?parameter-name=z' })[0])
      .toMatch(/^error: 404 for the style contours, though the collection's styles list has it, and styled-map, which the API declares, has each style's map at …\/styles\/\{styleId\}\/map\. The server says: .* \| \/req\/styled-map\/map-operation A$/);
    expect(mapSaid('contours', { conformsTo: MAPS.filter(uri => !uri.endsWith('/styled-map')) })[0]).toMatch(/^warning: 404 for the style contours, though the collection's styles list has it\. Its own map link/);
    // A style the list doesn't have: the request's
    const found = run('contours', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/styles/nope/map', body: '{"description":"Style \'nope\' not found"}' });
    expect(said(found.map)).toEqual([]);
    expect(said(found.request)).toEqual([`info: 404 for the style nope, which nothing the API declares names. The server says: "Style 'nope' not found"`]);
    // Where nothing is known of what the API declares, nothing says either way
    expect(said(run('contours', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/styles/nope/map', body: '{"description":"Style \'nope\' not found"}', conformsTo: null, apiDocs: null, collection: null }).request))
      .toEqual([`info: 404 for the style nope: the API's conformance and its API docs aren't known here, so nothing says whether it should have worked. The server says: "Style 'nope' not found"`]);
  });

  it("for a request the form found nothing wrong with, cites what in the API said it would work: a parameter's", () => {
    const ifs = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map';
    const refused = (query: string, message: string, change: Change = {}) => mapSaid('vertical', { url: `${ifs}?${query}`, body: JSON.stringify({ description: message }), ...change });
    expect(refused(`crs=${M3857}`, 'CRS not supported')).toEqual(["error: 400 for crs=EPSG:3857, though the collection's crs list has it, and the API declares crs, which makes any CRS listed SHALL be supported. The server says: \"CRS not supported\" | /req/crs/crs-definition B"]);
    expect(refused('width=256', 'width is wrong')).toEqual(['error: 400 for width=256, though scaling and spatial-subsetting, which the API declares, have the server support width. The server says: "width is wrong" | /req/scaling/width-definition A']);
    expect(refused('datetime=2026-11-17T00:00:00Z', 'no datetime')).toEqual(['error: 400 for datetime=2026-11-17T00:00:00Z, though datetime, which the API declares, has the server support datetime. The server says: "no datetime" | /req/datetime/datetime-definition A']);
    expect(refused('elevation=850', 'elevation is wrong')).toEqual(["warning: 400 for elevation=850, though the API docs' operation lists elevation, and extent.vertical.values lists 850. The server says: \"elevation is wrong\""]);
    expect(refused('quality=80', 'quality is wrong')).toEqual(["warning: 400 for quality=80, though the API docs' operation lists quality. The server says: \"quality is wrong\""]);
    expect(refused('f=image/webp', 'no such format')).toEqual(["warning: 400 for f=image/webp, though the API docs' f lists it. The server says: \"no such format\""]);
    // A value the API docs' f doesn't list: nothing says it works
    expect(said(run('vertical', { url: `${ifs}?f=image/gif`, body: JSON.stringify({ description: 'no such format' }) }).request))
      .toEqual(['info: 400 for f=image/gif, which nothing the API declares names. The server says: "no such format"']);
    // A parameter a class has, where the API doesn't declare the class: the API docs' word only
    expect(refused('width=256', 'width is wrong', { conformsTo: MAPS.filter(uri => !/scaling|spatial-subsetting/.test(uri)) }))
      .toEqual(["warning: 400 for width=256, though the API docs' operation lists width. The server says: \"width is wrong\""]);
    expect(refused('parameter-name=t', 'parameter t is wrong')).toEqual(["warning: 400 for parameter-name=t, though the API docs' operation lists parameter-name, and the collection's parameter_names has it. The server says: \"parameter t is wrong\""]);
    expect(refused('parameter-name=t', 'parameter t is wrong', { apiDocs: null }))
      .toEqual(["info: 400 for parameter-name=t, though the collection's parameter_names has it, which the MetOcean Maps draft picks with parameter-name. The draft isn't a standard yet, and names no rule to cite. The server says: \"parameter t is wrong\""]);
    expect(refused('subset=time("2026-11-17T00:00:00Z")', 'time is wrong')).toEqual(['error: 400 for subset=time("2026-11-17T00:00:00Z"), though datetime, which the API declares, makes time an axis. The server says: "time is wrong" | /req/datetime/subset-definition B']);
    expect(refused('subset=Lon(19:32)', 'Lon is wrong')).toEqual(['error: 400 for subset=Lon(19:32), though spatial-subsetting, which the API declares, makes Lon an axis. The server says: "Lon is wrong" | /req/spatial-subsetting/subset-definition B']);
    // A box outside the extent: what's recommended there is a map of the background
    expect(mapSaid('outsideArea')).toEqual([
      "warning: 400 for bbox=-100,0,-90,10, though the box is outside the collection's extent, where spatial-subsetting, which the API declares, recommends a map filled with the background color, or transparent. The server says: \"bbox is outside the valid area of the requested crs\" | /rec/spatial-subsetting/map-outside-bounds A",
    ]);
    expect(mapSaid('outsideArea', { url: 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map?bbox=19,59,32,70' })[0]).toMatch(/^error: 400 for bbox=19,59,32,70, though spatial-subsetting, which the API declares, has the server support bbox\..* \| \/req\/spatial-subsetting\/bbox-definition A$/);
  });

  it("says what the API says of each part where the server's message names none of them", () => {
    expect(mapSaid('vertical', { url: `https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?width=256&crs=${M3857}`, body: '{"description":"Something failed"}' })).toEqual([
      "warning: 400 for a request the form found nothing wrong with, and the server's message names none of its parameters. The server says: \"Something failed\". What the API says of each: width=256: scaling and spatial-subsetting, which the API declares, have the server support width; crs=EPSG:3857: the collection's crs list has it, and the API declares crs, which makes any CRS listed SHALL be supported | /req/scaling/width-definition A · /req/crs/crs-definition B",
    ]);
    // Nothing asked of the collection's own map: it SHALL be there
    expect(mapSaid('vertical', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map', status: 404, body: '' }))
      .toEqual(["error: 404 for the collection's own map, with nothing asked of it: Maps 1.0 says every map SHALL be available at its /map | /req/core/map-op A"]);
  });

  it('that the form expected is about the request, and counts for nothing', () => {
    const found = run('parameterUnknown');
    expect(said(found.map)).toEqual([]);
    expect(said(found.request)).toEqual([
      `info: 400, which the form expected: before sending, it said nope isn't among the collection's parameter_names. The server says: "parameter-name 'nope' is not available for collection 'ecmwf-ifs-pressure'. Available: d, dpt, gh, q, r, t, u, v, vo, w, ws, z"`,
    ]);
    // What the API docs say of the URL counts too
    const docs = mapFindings({ ...inputOf('vertical', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?f=image/gif', body: '{"description":"no gif"}' }),
      apiDocsIssues: [{ id: 'openapi:f:enum', severity: 'warning', source: 'openapi', field: 'f', message: "image/gif isn't one of the API docs' values for f." }] });
    expect(said(docs.request)).toEqual([`info: 400, which the form expected: before sending, it said image/gif isn't one of the API docs' values for f. The server says: "no gif"`]);
  });

  it('that the form expected from what the API docs say, or a parameter nobody declares, is about the request', () => {
    const radar = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
    expect(said(run('widthZero', { url: `${radar}?subset=time("2026-11-16T12:00:00Z")&datetime=2026-11-16T12:00:00Z`, body: '{"description":"not both"}' }).request))
      .toEqual([`info: 400, which the form expected: before sending, it said time in subset with datetime: the API docs say "Not with subset=time(…) (400).". The server says: "not both"`]);
    expect(said(run('widthZero', { url: `${radar}?foo=1`, body: '{"description":"foo?"}', apiDocs: null }).request))
      .toEqual([`info: 400, which the form expected: before sending, it said Not declared: no Maps class the API declares names foo. The server says: "foo?"`]);
  });

  it("is the server's where the form's only note is an aside", () => {
    // EPSG:3857 unsafe as a CURIE is only a note: the CRS is listed, so its refusal is the server's
    expect(mapSaid('vertical', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?crs=EPSG:3857', body: '{"description":"CRS not supported"}' }))
      .toEqual(["error: 400 for crs=EPSG:3857, though the collection's crs list has it, and the API declares crs, which makes any CRS listed SHALL be supported. The server says: \"CRS not supported\" | /req/crs/crs-definition B"]);
    expect(mapSaid('vertical', { url: `https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?crs=${M3857}`, body: '{"description":"CRS not supported"}', conformsTo: MAPS.filter(uri => !uri.endsWith('/crs')) }))
      .toEqual(["warning: 400 for crs=EPSG:3857, though the collection's crs list has it. The server says: \"CRS not supported\""]);
  });

  it("of an axis, where nothing is known of the API's classes, says what the API docs or the draft say", () => {
    const run_ = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map?subset=reference_time("2026-11-16T12:00:00Z")';
    const body = '{"description":"reference_time is wrong"}';
    expect(mapSaid('vertical', { url: run_, body, conformsTo: null }))
      .toEqual(["warning: 400 for subset=reference_time(\"2026-11-16T12:00:00Z\"), though the API docs' subset names the axis reference_time, and extent.reference_time.grid.coordinates lists 2026-11-16T12:00:00Z. The server says: \"reference_time is wrong\""]);
    expect(mapSaid('vertical', { url: run_, body, conformsTo: null, apiDocs: null }))
      .toEqual(["info: 400 for subset=reference_time(\"2026-11-16T12:00:00Z\"), though the MetOcean Maps draft picks a model run with subset=reference_time(…), and extent.reference_time.grid.coordinates lists 2026-11-16T12:00:00Z. The draft isn't a standard yet, and names no rule to cite. The server says: \"reference_time is wrong\""]);
  });

  it("leaves out what nothing says works when the message names nothing", () => {
    expect(mapSaid('vertical', { url: 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/styles/nope/map?width=256', body: '{"description":"Something failed"}' })).toEqual([
      "warning: 400 for a request the form found nothing wrong with, and the server's message names none of its parameters. The server says: \"Something failed\". What the API says of each: width=256: scaling and spatial-subsetting, which the API declares, have the server support width | /req/scaling/width-definition A",
    ]);
  });

  describe('a 406 for a format asked by Accept (made up)', () => {
    const notAcceptable = (accept: string | null, change: Change = {}) => {
      const found = run('vertical', { status: 406, body: JSON.stringify({ description: 'Not Acceptable' }), accept, ...change });
      return [...said(found.map), ...said(found.request).map(line => `request ${line}`)];
    };

    it('is an error where Accept takes a format of a class the API declares, citing its test', () => {
      expect(notAcceptable('image/jpeg')).toEqual(['error: 406 for Accept: image/jpeg, though jpeg, which the API declares, makes maps in image/jpeg. The server says: "Not Acceptable" | /conf/jpeg/content, test A.56']);
      expect(notAcceptable('image/png, image/jpeg;q=0.5')).toEqual([
        'error: 406 for Accept: image/png, image/jpeg;q=0.5, though png and jpeg, which the API declares, make maps in image/png and image/jpeg. The server says: "Not Acceptable" | /conf/png/content, test A.55 · /conf/jpeg/content, test A.56',
      ]);
    });

    it("is an issue where only the API docs' f lists one Accept takes", () => {
      expect(notAcceptable('image/webp')).toEqual(["warning: 406 for Accept: image/webp, though the API docs' f lists image/webp. The server says: \"Not Acceptable\""]);
    });

    it("passes where Accept takes no format the API makes, as Common Part 1 has a 406 say, and says nothing where that isn't known", () => {
      expect(notAcceptable('image/gif')).toEqual(['pass: 406 for Accept: image/gif, which takes no format the API declares or its API docs list: content negotiation failed. The server says: "Not Acceptable" | Common 1 8.2, Table 2']);
      // Its API docs known, its conformance not: what they list says enough
      expect(notAcceptable('image/gif', { conformsTo: null })[0]).toMatch(/^pass: 406 for Accept: image\/gif, which takes no format/);
      expect(notAcceptable('image/gif', { conformsTo: null, apiDocs: null })).toEqual([
        'request info: 406 for Accept: image/gif: the API\'s conformance and its API docs aren\'t known here, so nothing says whether it should have worked. The server says: "Not Acceptable"',
      ]);
    });

    it('is read as any refusal where the app’s */* went', () => {
      expect(notAcceptable('*/*')).toEqual(notAcceptable(null));
      expect(notAcceptable(null)[0]).toMatch(/^pass: 406 for subset=vertical\(850\)/);
    });
  });

  it('of the server itself, a 5xx, is an issue', () => {
    expect(mapSaid('widthZero', { status: 502, body: 'Bad gateway' })).toEqual(['warning: 502: the server failed on the request. The server says: "Bad gateway"']);
    expect(mapSaid('widthZero', { status: 302 })).toEqual([]);
  });
});

describe('refusalsAsked', () => {
  const context = (url: string, change: Change = {}) => mapCheckContext(inputOf('bare', { url, ...change }));
  const bare = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
  const whats = (url: string, change?: Change) => refusalsAsked(context(url, change)).map(refusal => `${refusal.what}${refusal.strict ? '' : ' (may be tolerated)'}`);

  it("finds a size that isn't a positive integer, or is past the limits", () => {
    expect(whats(`${bare}?width=1.5&height=-2`)).toEqual(['width=1.5', 'height=-2']);
    // Width is spatial subsetting's too
    expect(whats(`${bare}?width=0`, { conformsTo: MAPS.filter(uri => !uri.endsWith('/scaling')) })).toEqual(['width=0']);
    expect(whats(`${bare}?width=9000`)).toEqual(['width=9000 (may be tolerated)']);
    expect(whats(`${bare}?width=8000&height=8000`)).toEqual([]);
    const limits = { maxWidth: 1000, maxHeight: 1000, maxPixels: 500000, pointer: '/info/x-OGC-limits/maps' };
    expect(whats(`${bare}?width=1001&height=600`, { limits })).toEqual(['width=1001', 'width × height, 600600 pixels']);
    expect(whats(`${bare}?width=600&height=1001`, { limits })).toEqual(['height=1001', 'width × height, 600600 pixels']);
    expect(whats(`${bare}?width=1000&height=500`, { limits })).toEqual([]);
    // Past both the limit and the API docs' maximum: the limit, which Maps 1.0 makes a SHALL
    expect(whats(`${bare}?width=9000&height=10`, { limits })).toEqual(['width=9000']);
  });

  it('finds a size with a box and a scale, a spatial axis with a box, and an axis nobody has', () => {
    expect(whats(`${bare}?bbox=19,59,32,70&width=256&scale-denominator=1000000`)).toEqual(['width with bbox and scale-denominator']);
    expect(whats(`${bare}?subset=Lon(19:32)&height=256&scale-denominator=1000000`)).toEqual(['height with a spatial subset and scale-denominator']);
    expect(whats(`${bare}?subset=N(1:2)&subset-crs=${M3857}&height=256&scale-denominator=1000000`)).toEqual(['height with a spatial subset and scale-denominator']);
    expect(whats(`${bare}?bbox=19,59,32,70&subset=Lat(59:70)`)).toEqual(['Lat in subset with bbox']);
    expect(whats(`${bare}?center=25,62&subset=Lat(59:70)`)).toEqual(['Lat in subset with center']);
    expect(whats(`${bare}?subset=E(1:2)`)).toEqual(['subset=E(1:2)']);
    expect(whats(`${bare}?subset=E(1:2)&subset-crs=${M3857}`)).toEqual([]);
  });

  it("goes by the classes the API declares, and by none of them while its conformance isn't known", () => {
    expect(whats(`${bare}?width=0&bbox=1,2,3,4&center=1,2&scale-denominator=1`, { conformsTo: MAPS.filter(uri => !/scaling|spatial-subsetting/.test(uri)) })).toEqual([]);
    // With no class that has subset, an axis isn't a class's to refuse
    expect(whats(`${bare}?subset=foo(1)`, { conformsTo: MAPS.filter(uri => !/subsetting|datetime/.test(uri)) })).toEqual([]);
    expect(refusalsAsked(context(`${bare}?subset=foo(1)`, { conformsTo: GENERAL })).map(refusal => labels(refusal.rule)))
      .toEqual([['/req/spatial-subsetting/subset-definition D', '/req/datetime/subset-definition C', '/req/general-subsetting/subset-definition C']]);
    expect(whats(`${bare}?width=0&bbox=1,2,3,4&center=1,2&subset=foo(1)`, { conformsTo: null })).toEqual(['width=0', 'bbox with center']);
  });

  it('finds a time or a level outside its axis, from either end', () => {
    expect(whats(`${bare}?subset=time("2030-01-01T00:00:00Z")`)).toEqual(['subset=time("2030-01-01T00:00:00Z")']);
    expect(whats(`${bare}?subset=time(*:"2020-01-01T00:00:00Z")`)).toEqual(['subset=time(*:"2020-01-01T00:00:00Z")']);
    expect(whats(`${bare}?subset=time("2026-11-16T12:00:00Z")`)).toEqual([]);
    const ifs = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map';
    expect(whats(`${ifs}?subset=vertical(5:5000)`, { conformsTo: GENERAL, collection: IFS })).toEqual(['subset=vertical(5:5000)']);
    expect(whats(`${ifs}?subset=vertical(500:5000)`, { conformsTo: GENERAL, collection: IFS })).toEqual([]);
  });

  it('finds values that aren’t ones, which a server may tolerate', () => {
    expect(whats(`${bare}?subset=Lon(1:2:3)&datetime=x&crs=${CRS84}`)).toEqual(['subset=Lon(1:2:3) (may be tolerated)', 'datetime=x (may be tolerated)']);
    expect(whats(`${bare}?crs=http://www.opengis.net/def/crs/EPSG/0/2393`, { collection: { ...RADAR, crs: undefined } as unknown as Collection })).toEqual(['crs=EPSG:2393 (may be tolerated)']);
    expect(whats(`${bare}?crs=${CRS84}`, { collection: { ...RADAR, crs: undefined } as unknown as Collection })).toEqual([]);
    // Of a collection not known, nothing says which CRSs it has
    expect(whats(`${bare}?crs=http://www.opengis.net/def/crs/EPSG/0/2393`, { collection: null })).toEqual([]);
    expect(whats(`${bare}?foo=1`, { apiDocs: null })).toEqual([]);
  });
});
