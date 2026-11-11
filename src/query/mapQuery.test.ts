import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { fromItemsLink } from './itemsQuery';
import { fromMapLink, linkQuery, mapStylesOf, styleMapHref, styleOfPath, withLinkQueries, withMapQuery } from './mapQuery';
import { buildQueryModel, type QueryModelInput } from './queryModel';
import { buildQueryUrl } from './buildQueryUrl';
import { isForCollection, matchDataQuery, readQuerySelections } from './parseQueryUrl';
import { fieldSpecs } from './fieldSpecs';
import { validateQuery } from './validateQuery';
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
  radius: { value: 10, units: 'km' }, queryParams: { crs: 'CRS84' }, locationFeature: null, ...overrides,
});
const urlOf = (model: QueryModelInput) => buildQueryUrl(buildQueryModel(model)!);

describe('a map request', () => {
  it('is the collection’s map and nothing else: Maps requires nothing, and nothing is filled in', () => {
    expect(urlOf(input(radar()))).toBe(`${ROOT}/fmi-radar-composite-dbz/map`);
  });

  it('is a style’s own map link for a style picked, what it asks for included', () => {
    const href = `${ROOT}/ecmwf-ifs-pressure/styles/contours/map?parameter-name=gh`;
    expect(urlOf(input(ifs(), { styleId: 'contours', styleHref: href }))).toBe(href);
  });

  it('goes by the path Maps gives a style without a link of its own, as for one from a typed URL', () => {
    expect(urlOf(input(ifs(), { styleId: 'contours' }))).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/contours/map`);
    expect(urlOf(input(ifs(), { styleId: '', styleHref: 'https://elsewhere.example/x' }))).toBe(`${ROOT}/ecmwf-ifs-pressure/map`);
  });

  it('takes a style only for a map query', () => {
    const model = buildQueryModel({ ...input(alarm()), queryKey: 'items', styleId: 'default' })!;
    expect(model.baseHref).toBe(`${ROOT}/meteoalarm-finland/items`);
  });

  it('has no fields of its own yet, and nothing to find wrong', () => {
    const collection = withLinkQueries(ifs());
    expect(fieldSpecs(collection, 'map', { parameters: 1 }, { inRequest: ['datetime', 'z', 'bbox'] })).toEqual([]);
    expect(validateQuery(buildQueryModel(input(ifs(), { datetime: 'nonsense', vertical: '777' }))!)).toEqual([]);
  });
});

describe('a map URL, read back', () => {
  const view = () => withLinkQueries(ifs());

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

  it('gives the form nothing it holds: what the URL asks for stays in the line, as typed', () => {
    const url = `${ROOT}/ecmwf-ifs-pressure/map?f=image/png&parameter-name=t&datetime=2026-11-11T00:00:00Z&z=850&bbox=19,59,32,70&crs=CRS84&within=5`;
    expect(readQuerySelections(url, view(), 'map')).toEqual({
      format: '', parameters: [], datetime: '', vertical: '', customDims: {}, points: [], polygons: [], bbox: null,
      bboxAsCoords: false, radius: null, radiusUnits: null, queryParams: {},
    });
  });
});
