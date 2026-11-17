import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { fromItemsLink } from './itemsQuery';
import { fromMapLink, linkQuery, mapStylesOf, styleLinkFills, styleMapHref, styleOfPath, withLinkQueries, withMapQuery } from './mapQuery';
import { buildQueryModel, type QueryModelInput } from './queryModel';
import { buildQueryUrl } from './buildQueryUrl';
import { isForCollection, matchDataQuery, readQuerySelections } from './parseQueryUrl';
import { fieldSpecs } from './fieldSpecs';
import { addApiDocsIssues, validateQuery } from './validateQuery';
import { checkQueryUrlAgainstOpenApi } from '../validation/openapi/checkQueryUrl';
import { buildOperationIndex } from '../validation/openapi/operationIndex';
import params from './__fixtures__/meteocore-maps-params.json';
import meteocore from './__fixtures__/meteocore-maps.json';

const ROOT = 'https://meteocore.app.meteo.fi/collections';
const collectionOf = (id: string) => meteocore.collections.find(each => each.id === id) as unknown as Collection;
// Fresh copies, as each view is kept for the object it was made from
const radar = () => structuredClone(collectionOf('fmi-radar-composite-dbz'));
const ifs = () => structuredClone(collectionOf('ecmwf-ifs-pressure'));
const alarm = () => structuredClone(collectionOf('meteoalarm-finland'));
const withRel = (rel: string, href = `${ROOT}/one/map`) =>
  ({ id: 'one', links: [{ href: `${ROOT}/one`, rel: 'self' }, { href, rel, type: 'image/png' }] }) as unknown as Collection;
const mapOf = (collection: Collection) => collection.data_queries?.map?.link;

describe('withMapQuery', () => {
  it('makes a Maps collection’s map link its map query, as MeteoCore serves it', () => {
    expect(mapOf(withMapQuery(radar()))).toEqual({
      href: `${ROOT}/fmi-radar-composite-dbz/map`,
      rel: 'http://www.opengis.net/def/rel/ogc/1.0/map',
      type: 'image/png',
      variables: { query_type: 'map' },
    });
  });

  it('reads the map link by each form of its rel: http, https, a safe CURIE, and the bare name', () => {
    for (const rel of ['http://www.opengis.net/def/rel/ogc/1.0/map', 'https://www.opengis.net/def/rel/ogc/1.0/map', '[ogc-rel:map]', 'map']) {
      expect(mapOf(withMapQuery(withRel(rel)))?.href).toBe(`${ROOT}/one/map`);
    }
    for (const rel of ['http://www.opengis.net/def/rel/ogc/1.0/tilesets-map', 'ogc-rel:map', 'https://www.opengis.net/def/rel/ogc/1.0/maps', 'self']) {
      expect(withMapQuery(withRel(rel)).data_queries).toBeUndefined();
    }
  });

  it('keeps what the server’s link asks for: its link is what’s tested', () => {
    expect(mapOf(withMapQuery(withRel('[ogc-rel:map]', `${ROOT}/one/map?f=image%2Fpng`)))?.href).toBe(`${ROOT}/one/map?f=image%2Fpng`);
  });

  it('keeps the rest of the collection, and leaves the collection itself as served', () => {
    const collection = radar();
    const view = withMapQuery(collection);
    expect(view).not.toBe(collection);
    expect(view.links).toBe(collection.links);
    expect(view.id).toBe('fmi-radar-composite-dbz');
    expect(collection.data_queries).toBeUndefined();
    expect(fromMapLink(view)).toBe(true);
    expect(fromMapLink(collection)).toBe(false);
  });

  it('is the same view each time for the same collection', () => {
    const collection = radar();
    expect(withMapQuery(collection)).toBe(withMapQuery(collection));
  });

  it('leaves alone a collection with no map link, one whose href isn’t a URL, and nothing', () => {
    const plain = { id: 'two', links: [{ href: `${ROOT}/two`, rel: 'self' }] } as unknown as Collection;
    expect(withMapQuery(plain)).toBe(plain);
    const relative = withRel('[ogc-rel:map]', '/collections/one/map');
    expect(withMapQuery(relative)).toBe(relative);
    const unsafe = withRel('[ogc-rel:map]', 'javascript:alert(1)');
    expect(withMapQuery(unsafe)).toBe(unsafe);
    expect(withMapQuery(null)).toBeNull();
  });

  it('leaves a query a server already names map as it is, and doesn’t count it as made', () => {
    const own = { ...withRel('[ogc-rel:map]'), data_queries: { map: { link: { href: `${ROOT}/one/edr-map`, rel: 'data' } } } } as unknown as Collection;
    expect(withMapQuery(own)).toBe(own);
    expect(fromMapLink(own)).toBe(false);
  });
});

describe('withLinkQueries', () => {
  it('gives a collection with items and a map both, as MeteoCore’s meteoalarm-finland has, each still told as made', () => {
    const view = withLinkQueries(alarm());
    expect(Object.keys(view.data_queries)).toEqual(['items', 'map']);
    expect(view.data_queries.items.link.href).toBe(`${ROOT}/meteoalarm-finland/items`);
    expect(mapOf(view)?.href).toBe(`${ROOT}/meteoalarm-finland/map`);
    expect(fromItemsLink(view)).toBe(true);
    expect(fromMapLink(view)).toBe(true);
  });

  it('adds to the queries an EDR collection names, and is the same view each time', () => {
    const edr = { ...withRel('[ogc-rel:map]'), data_queries: { position: { link: { href: `${ROOT}/one/position`, rel: 'data' } } } } as unknown as Collection;
    const view = withLinkQueries(edr);
    expect(Object.keys(view.data_queries)).toEqual(['position', 'map']);
    expect(withLinkQueries(edr)).toBe(view);
  });
});

describe('styleMapHref and styleOfPath', () => {
  it('puts a style in the path Maps gives it, without what the map link asks for', () => {
    expect(styleMapHref(`${ROOT}/fmi-radar-composite-dbz/map`, 'radar_fmi')).toBe(`${ROOT}/fmi-radar-composite-dbz/styles/radar_fmi/map`);
    expect(styleMapHref(`${ROOT}/one/map/?f=image%2Fpng#x`, 'a b:c')).toBe(`${ROOT}/one/styles/a%20b:c/map`);
    // One segment, whatever the id holds: a slash or a semicolon is encoded, not a path of its own
    expect(styleMapHref(`${ROOT}/one/map`, 'night/v2;x')).toBe(`${ROOT}/one/styles/night%2Fv2%3Bx/map`);
    // A map link that doesn't end in /map has its styles beside it
    expect(styleMapHref(`${ROOT}/one/render`, 'night')).toBe(`${ROOT}/one/styles/night/map`);
    expect(styleMapHref('not a URL', 'night')).toBe('not a URL');
  });

  it('reads a style back from a styled map’s path', () => {
    const map = `${ROOT}/ecmwf-ifs-pressure/map`;
    expect(styleOfPath(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map`, map)).toBe('contours');
    expect(styleOfPath(`${ROOT}/ecmwf-ifs-pressure/styles/a:b c/map`, map)).toBe('a:b c');
    for (const other of [`${ROOT}/ecmwf-ifs-pressure/styles/contours/legend`, `${ROOT}/ecmwf-ifs-pressure/styles/a/b/map`,
      `${ROOT}/ecmwf-ifs-pressure/styles//map`, `${ROOT}/ecmwf-ifs-pressure/map`, `${ROOT}/fmi-radar-composite-dbz/styles/contours/map`,
      `${ROOT}/ecmwf-ifs-pressure/styles/contours`, `${ROOT}/ecmwf-ifs-pressure/styles/contours/mapx`]) {
      expect(styleOfPath(other, map)).toBeNull();
    }
  });
});

describe('mapStylesOf and linkQuery', () => {
  it('reads a styles document’s styles: id, title, the style’s own map link as given, and the parameters it’s for', () => {
    const styles = mapStylesOf(meteocore.styles['ecmwf-ifs-pressure'].styles);
    expect(styles.map(style => style.id)).toEqual(['default', 'contours', 'fmi-hires']);
    expect(styles[1]).toEqual({
      id: 'contours',
      title: 'contours',
      href: `${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=gh`,
      parameters: ['gh', 'z', 't', 'dpt'],
    });
    expect(styles[0]).toEqual({ id: 'default', title: 'Default', href: `${ROOT}/ecmwf-ifs-pressure/styles/default/map`, parameters: [] });
  });

  it('reads a collection’s own styles the same way, and skips what has no id', () => {
    const styles = mapStylesOf([...(radar() as unknown as { styles: unknown[] }).styles, { title: 'No id' }, { id: ' ' }, null, 'x', { id: 7, links: [] }]);
    expect(styles.map(style => style.id)).toEqual(['default', 'radar_dbz', 'radar_fmi', '7']);
    expect(styles[3]).toEqual({ id: '7', title: undefined, href: null, parameters: [] });
    expect(mapStylesOf(undefined)).toEqual([]);
    // Of the parameters a style is for, only names
    expect(mapStylesOf([{ id: 'p', parameters: ['gh', 7, null, { id: 't' }] }, { id: 'q', parameters: 'gh' }]).map(style => style.parameters))
      .toEqual([['gh'], []]);
    expect(mapStylesOf({ styles: [] })).toEqual([]);
  });

  it('keeps a style’s own tilesets link, where it has one, which MeteoCore’s styles don’t', () => {
    const tilesRel = 'http://www.opengis.net/def/rel/ogc/1.0/tilesets-map';
    const [night] = mapStylesOf([{ id: 'night', links: [{ href: `${ROOT}/one/styles/night/map/tiles`, rel: tilesRel }] }]);
    expect(night.tilesHref).toBe(`${ROOT}/one/styles/night/map/tiles`);
    expect(mapStylesOf(meteocore.styles['ecmwf-ifs-pressure'].styles).every(style => !('tilesHref' in style))).toBe(true);
  });

  it('says what a link asks for besides its path', () => {
    expect(linkQuery(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=gh`)).toEqual(['parameter-name=gh']);
    expect(linkQuery(`${ROOT}/one/map`)).toEqual([]);
    expect(linkQuery(null)).toEqual([]);
    expect(linkQuery('not a URL')).toEqual([]);
  });
});

// What a map query sends: the form's state as the query builder has it, with values left over from another query
const input = (collection: Collection, overrides: Partial<QueryModelInput> = {}): QueryModelInput => ({
  collection: withLinkQueries(collection), queryKey: 'map', format: 'CoverageJSON', parameters: ['t'], datetime: '2026-11-10T12:00:00Z',
  vertical: '850', customDims: { member: '1' }, points: [[24, 60]], polygons: [], bbox: [19, 59, 32, 70], bboxAsCoords: false,
  radius: { value: 10, units: 'km' }, queryParams: { 'corridor-width': '5', limit: '10' }, locationFeature: null, ...overrides,
});
const urlOf = (model: QueryModelInput) => buildQueryUrl(buildQueryModel(model)!);

describe('a map request', () => {
  // Nothing chosen for the map: what's left is another query's, which a map doesn't take
  const bare = { format: '', parameters: [], datetime: '' };

  it('is the collection’s map and nothing else: Maps requires nothing, and another query’s values aren’t sent', () => {
    expect(urlOf(input(radar(), bare))).toBe(`${ROOT}/fmi-radar-composite-dbz/map`);
  });

  it('sends the parameter and the format the form holds, and nothing else', () => {
    expect(urlOf(input(ifs(), { parameters: ['gh'], format: 'image/webp', datetime: '' }))).toBe(`${ROOT}/ecmwf-ifs-pressure/map?parameter-name=gh&f=image%2Fwebp`);
    expect(urlOf(input(ifs(), { parameters: ['gh', 'd'], format: '', datetime: '' }))).toBe(`${ROOT}/ecmwf-ifs-pressure/map?parameter-name=gh%2Cd`);
  });

  it('sends the time, the subset and the elevation the form holds, before the format, and not EDR’s z', () => {
    const queryParams = { limit: '10', subset: ' vertical(850),reference_time("2026-11-12T00:00:00Z") ', elevation: '500' };
    expect(urlOf(input(ifs(), { parameters: ['t'], format: 'image/png', queryParams })))
      .toBe(`${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t&datetime=2026-11-10T12%3A00%3A00Z&subset=vertical%28850%29%2Creference_time%28%222026-11-12T00%3A00%3A00Z%22%29&elevation=500&f=image%2Fpng`);
    // A time switched from another query stays, as switching keeps it where the new query takes one
    expect(urlOf(input(radar(), { format: '', parameters: [] }))).toBe(`${ROOT}/fmi-radar-composite-dbz/map?datetime=2026-11-10T12%3A00%3A00Z`);
    // What's empty isn't sent
    expect(urlOf(input(radar(), { ...bare, queryParams: { subset: ' ', elevation: '' } }))).toBe(`${ROOT}/fmi-radar-composite-dbz/map`);
  });

  it('sends the box, the size and the CRS the form holds, as typed, after the time and before the subset', () => {
    const queryParams = {
      bbox: ' 15.5,58.5,35.5,71 ', 'bbox-crs': '', width: '478', height: '721', crs: 'http://www.opengis.net/def/crs/EPSG/0/3857', subset: 'reference_time(*)',
    };
    expect(urlOf(input(ifs(), { parameters: ['t'], format: '', queryParams })))
      .toBe(`${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t&datetime=2026-11-10T12%3A00%3A00Z&bbox=15.5%2C58.5%2C35.5%2C71&width=478&height=721`
        + '&crs=http%3A%2F%2Fwww.opengis.net%2Fdef%2Fcrs%2FEPSG%2F0%2F3857&subset=reference_time%28*%29');
    // Each as typed, wrong or not: the checks say what's wrong
    const wrong = { bbox: '1,2,3', 'bbox-crs': 'EPSG:3067', width: '0', height: '1.5', crs: 'EPSG:2393' };
    expect(urlOf(input(radar(), { ...bare, queryParams: wrong })))
      .toBe(`${ROOT}/fmi-radar-composite-dbz/map?bbox=1%2C2%2C3&bbox-crs=EPSG%3A3067&width=0&height=1.5&crs=EPSG%3A2393`);
    expect(validateQuery(buildQueryModel(input(radar(), { ...bare, queryParams: wrong }))!).map(issue => issue.id)).toEqual([
      'maps:bbox:numbers', 'maps:width:integer', 'maps:height:integer', 'maps:crs:listed', 'maps:bbox-crs:curie', 'maps:crs:curie',
    ]);
  });

  it('sends what’s under More as typed, after the subset and the elevation and before the format, and checks it', () => {
    const queryParams = {
      subset: 'E(41085:787090)', transparent: 'false', bgcolor: ' 0x0000FF ', 'void-transparent': '', 'void-color': 'red', center: '', 'center-crs': '',
      'scale-denominator': '5000000', 'subset-crs': 'http://www.opengis.net/def/crs/EPSG/0/3067', quality: '80',
    };
    expect(urlOf(input(radar(), { ...bare, format: 'image/jpeg', queryParams })))
      .toBe(`${ROOT}/fmi-radar-composite-dbz/map?subset=E%2841085%3A787090%29&transparent=false&bgcolor=0x0000FF&void-color=red&scale-denominator=5000000`
        + '&subset-crs=http%3A%2F%2Fwww.opengis.net%2Fdef%2Fcrs%2FEPSG%2F0%2F3067&quality=80&f=image%2Fjpeg');
    const wrong = { transparent: 'yes', bgcolor: 'nope', center: '25', 'scale-denominator': '0', 'center-crs': 'EPSG:3067' };
    expect(urlOf(input(radar(), { ...bare, queryParams: wrong })))
      .toBe(`${ROOT}/fmi-radar-composite-dbz/map?transparent=yes&bgcolor=nope&center=25&center-crs=EPSG%3A3067&scale-denominator=0`);
    expect(validateQuery(buildQueryModel(input(radar(), { ...bare, queryParams: wrong }))!).map(issue => issue.id)).toEqual([
      'maps:transparent:boolean', 'maps:bgcolor:colour', 'maps:center:numbers', 'maps:scale-denominator:number', 'maps:center-crs:curie',
    ]);
  });

  it('is a style’s own map link for a style picked, what it asks for included, with the form’s parameter in place of the link’s', () => {
    const href = `${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=gh`;
    // As picking the style fills the field
    expect(urlOf(input(ifs(), { styleId: 'contours', styleHref: href, parameters: ['gh'], format: '', datetime: '' }))).toBe(href);
    // Another chosen, and none: MeteoCore answers the last with 404, which is worth seeing
    expect(urlOf(input(ifs(), { styleId: 'contours', styleHref: href, parameters: ['dpt'], format: '', datetime: '' }))).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=dpt`);
    expect(urlOf(input(ifs(), { styleId: 'contours', styleHref: href, ...bare }))).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map`);
  });

  it('goes by the path Maps gives a style without a link of its own, as for one from a typed URL', () => {
    expect(urlOf(input(ifs(), { styleId: 'contours', ...bare }))).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map`);
    expect(urlOf(input(ifs(), { styleId: '', styleHref: 'https://elsewhere.example/x', ...bare }))).toBe(`${ROOT}/ecmwf-ifs-pressure/map`);
  });

  it('takes a style only for a map query', () => {
    const model = buildQueryModel({ ...input(alarm()), queryKey: 'items', styleId: 'default' })!;
    expect(model.baseHref).toBe(`${ROOT}/meteoalarm-finland/items`);
  });

  it('has fields of its own, none for an EDR query’s, and finds nothing wrong in another query’s values', () => {
    const collection = withLinkQueries(ifs());
    // Its box and time, as the request has them, and its level and model run in subset, as its extent has them
    // and under More only the Accept header, which any map request can be sent with
    expect(fieldSpecs(collection, 'map', { parameters: 1 }, { inRequest: ['datetime', 'z', 'bbox'] }).map(spec => spec.id))
      .toEqual(['bbox', 'parameter-name', 'datetime', 'subset:vertical', 'subset:reference_time', 'subset', 'accept']);
    expect(fieldSpecs(withLinkQueries(radar()), 'map', { parameters: 0 }, { inRequest: ['z', 'bbox'] }).map(spec => spec.id)).toEqual(['bbox', 'accept']);
    // z is EDR's: a map's level is in subset
    expect(validateQuery(buildQueryModel(input(ifs(), { parameters: ['gh'], vertical: '777' }))!)).toEqual([]);
  });
});

describe('a map URL, read back', () => {
  const view = () => withLinkQueries(ifs());
  // Each text a map's form holds, empty
  const NONE_HELD = Object.fromEntries([
    'bbox', 'bbox-crs', 'width', 'height', 'crs', 'subset', 'elevation',
    'transparent', 'bgcolor', 'void-transparent', 'void-color', 'center', 'center-crs', 'scale-denominator', 'subset-crs', 'quality',
  ].map(name => [name, '']));

  it('is the map query, with its style from the path', () => {
    expect(matchDataQuery(`${ROOT}/ecmwf-ifs-pressure/map?bbox=19,59,32,70&width=256`, view())).toEqual({ queryKey: 'map' });
    expect(matchDataQuery(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=gh`, view())).toEqual({ queryKey: 'map', styleId: 'contours' });
    expect(matchDataQuery(`${ROOT}/ecmwf-ifs-pressure/styles/fmi%2Dhires/map`, view())).toEqual({ queryKey: 'map', styleId: 'fmi-hires' });
    expect(matchDataQuery(`${ROOT}/ecmwf-ifs-pressure/styles/contours/legend`, view())).toBeNull();
    expect(matchDataQuery(`${ROOT}/ecmwf-ifs-pressure/map/tiles`, view())).toBeNull();
  });

  it('takes a style from the map query’s path only, not from another query’s beside it', () => {
    const edr = { ...withRel('[ogc-rel:map]'), data_queries: { position: { link: { href: `${ROOT}/one/position`, rel: 'data' } } } } as unknown as Collection;
    expect(matchDataQuery(`${ROOT}/one/styles/night/map`, withLinkQueries(edr))).toEqual({ queryKey: 'map', styleId: 'night' });
  });

  it('is followed for a Maps collection as served', () => {
    expect(isForCollection(`${ROOT}/fmi-radar-composite-dbz/styles/radar_fmi/map`, radar())).toBe(true);
    expect(isForCollection(`${ROOT}/fmi-radar-composite-dbz/map/tiles`, radar())).toBe(false);
  });

  it('gives the form its parameter, time, box, size, CRS, subset, elevation, what’s under More and format, and nothing else: the rest stays in the line, as typed', () => {
    const url = `${ROOT}/ecmwf-ifs-pressure/map?f=image/png&parameter-name=t,%20gh&datetime=2026-11-11T00:00:00Z&z=850&bbox=19,59,32,70&crs=CRS84&within=5&elevation=850`
      + '&bbox-crs=EPSG:4326&width=256&height=0&transparent=false&bgcolor=%23336699&void-color=red&center=25,62&scale-denominator=5000000&quality=80';
    expect(readQuerySelections(url, view(), 'map')).toEqual({
      format: 'image/png', parameters: ['t', 'gh'], datetime: '2026-11-11T00:00:00Z', vertical: '', customDims: {}, points: [], polygons: [], bbox: null,
      bboxAsCoords: false, radius: null, radiusUnits: null,
      queryParams: {
        ...NONE_HELD, bbox: '19,59,32,70', 'bbox-crs': 'EPSG:4326', width: '256', height: '0', crs: 'CRS84', elevation: '850',
        transparent: 'false', bgcolor: '#336699', 'void-color': 'red', center: '25,62', 'scale-denominator': '5000000', quality: '80',
      },
    });
  });

  it('reads several subset parameters as one, comma-separated, as Maps 1.0 has them', () => {
    const url = `${ROOT}/ecmwf-ifs-pressure/map?subset=Lon(19:32)&subset=&subset=vertical(850)`;
    expect(readQuerySelections(url, view(), 'map').queryParams).toEqual({ ...NONE_HELD, subset: 'Lon(19:32),vertical(850)' });
  });
});

describe('styleLinkFills', () => {
  const CONTOURS = `${ROOT}/ecmwf-aifs-single/styles/contours/map?parameter-name=2t`;
  const FMI = `${ROOT}/ecmwf-aifs-single/styles/fmi-hires/map?parameter-name=2t&f=image/webp`;
  const DEFAULT = `${ROOT}/ecmwf-aifs-single/styles/default/map`;
  const empty = { 'parameter-name': '', f: '' };

  it('fills the empty fields with what the style’s link asks for, and empties them where it asks for none', () => {
    expect(styleLinkFills(CONTOURS, empty, {})).toEqual({ fills: { 'parameter-name': '2t', f: '' }, linked: { 'parameter-name': '2t', f: '' } });
    expect(styleLinkFills(FMI, empty, {}).fills).toEqual({ 'parameter-name': '2t', f: 'image/webp' });
    expect(styleLinkFills('', empty, {}).fills).toEqual({ 'parameter-name': '', f: '' });
  });

  it('replaces what the last style’s link put in, but not a value chosen since or before', () => {
    expect(styleLinkFills(DEFAULT, { 'parameter-name': '2t', f: '' }, { 'parameter-name': '2t', f: '' }).fills).toEqual({ 'parameter-name': '', f: '' });
    expect(styleLinkFills(FMI, { 'parameter-name': 'msl', f: '' }, { 'parameter-name': '2t', f: '' })).toEqual({ fills: { f: 'image/webp' }, linked: { f: 'image/webp' } });
    expect(styleLinkFills(CONTOURS, { 'parameter-name': 'tp', f: 'image/png' }, {})).toEqual({ fills: {}, linked: {} });
  });
});

describe('a map request’s issues', () => {
  const aifs = () => withLinkQueries(structuredClone(params.collections.find(each => each.id === 'ecmwf-aifs-single')) as unknown as Collection);
  const aifsStyles = mapStylesOf(params.styles['ecmwf-aifs-single'].styles);
  const index = buildOperationIndex({ url: 'https://meteocore.app.meteo.fi/api', doc: params.api as unknown as Record<string, unknown> });
  const modelOf = (overrides: Partial<QueryModelInput>) => buildQueryModel(input(aifs(), { format: '', parameters: [], styles: aifsStyles, ...overrides }))!;
  const all = (overrides: Partial<QueryModelInput>) => {
    const model = modelOf(overrides);
    return addApiDocsIssues(model, validateQuery(model), checkQueryUrlAgainstOpenApi(buildQueryUrl(model)!, index)).map(issue => `${issue.severity} ${issue.field}: ${issue.message}`);
  };

  it('are none for MeteoCore’s own pairs', () => {
    expect(all({})).toEqual([]);
    expect(all({ parameters: ['2t'], styleId: 'fmi-hires', styleHref: `${ROOT}/ecmwf-aifs-single/styles/fmi-hires/map?parameter-name=2t`, format: 'image/webp' })).toEqual([]);
  });

  it('check its parameter against parameter_names, its style against its parameter, and its count against the API docs', () => {
    expect(all({ parameters: ['nope'] })).toEqual(["error parameter-name: nope isn't among the collection's parameter_names"]);
    expect(all({ parameters: ['tp'], styleId: 'fmi-hires' })).toEqual(["warning style: fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx"]);
    expect(all({ parameters: ['2t', 'msl'] })).toEqual(["warning parameter-name: The API docs' parameter-name is a string, one parameter, and the request has 2"]);
    // One issue on a field: the error is enough
    expect(all({ parameters: ['2t', 'nope'] })).toEqual(["error parameter-name: nope isn't among the collection's parameter_names"]);
    // The API docs' own say on f
    expect(all({ format: 'image/gif' })).toEqual(["warning f: The API docs don't list image/gif for f (they list image/png, image/jpeg, image/webp)"]);
  });
});
