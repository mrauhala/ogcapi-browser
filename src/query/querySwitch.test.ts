import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import type { BBox } from './types';
import { querySwitch, type QueryNow } from './querySwitch';
import { withLinkQueries } from './mapQuery';
import { buildQueryModel, type QueryModelInput } from './queryModel';
import { buildQueryUrl } from './buildQueryUrl';
import meteocore from './__fixtures__/meteocore-maps.json';
import fmiObs from './__fixtures__/meteocore-fmi-obs.json';

// MeteoCore's meteoalarm-finland, with items and a map both
const ROOT = 'https://meteocore.app.meteo.fi/collections/meteoalarm-finland';
const alarm = () => withLinkQueries(structuredClone(meteocore.collections.find(each => each.id === 'meteoalarm-finland')) as unknown as Collection);
const URI = (code: number) => `http://www.opengis.net/def/crs/EPSG/0/${code}`;
const now = (overrides: Partial<QueryNow> = {}): QueryNow => ({
  format: '', parameters: [], queryParams: {}, drawn: null, datetime: '', filterByTime: false, hasLocation: false, ...overrides,
});

// The request the form then builds, as useQueryUrl builds it from what the switch leaves: the box drawn where it was
// carried, else the one the map keeps for the same kind of geometry
function requestAfter(collection: Collection, queryKey: string, from: string, before: QueryNow): string {
  const next = querySwitch(collection, queryKey, from, before);
  const input: QueryModelInput = {
    collection, queryKey, format: next.format, parameters: next.parameters, datetime: next.filterByTime || next.queryType !== 'items' ? before.datetime : '',
    vertical: '', customDims: {}, points: [], polygons: [], bbox: next.carried ?? (next.queryType === 'map' ? null : before.drawn), bboxAsCoords: false,
    radius: { value: null, units: '' }, queryParams: next.queryParams, locationFeature: null,
  };
  return decodeURIComponent(buildQueryUrl(buildQueryModel(input)!)!);
}

describe('switching from a map to items', () => {
  const map = (queryParams: Record<string, string>, more: Partial<QueryNow> = {}) => now({ queryParams, format: 'image/png', parameters: ['x'], ...more });

  it('keeps the box in CRS84 and the time, single or a range, and nothing else of the map’s', () => {
    const single = map({ bbox: '19,59,32,70', width: '400', height: '300', crs: URI(3857), subset: 'Lat(60:61)' }, { datetime: '2026-11-16T12:00:00Z' });
    expect(querySwitch(alarm(), 'items', 'map', single)).toEqual({
      queryType: 'items', format: '', parameters: [], queryParams: {}, carried: [19, 59, 32, 70], leftBehind: '', filterByTime: true,
    });
    expect(requestAfter(alarm(), 'items', 'map', single)).toBe(`${ROOT}/items?datetime=2026-11-16T12:00:00Z&bbox=19.000,59.000,32.000,70.000`);
    const range = map({ bbox: '19,59,32,70' }, { datetime: '2026-11-16T00:00:00Z/2026-11-17T00:00:00Z' });
    expect(requestAfter(alarm(), 'items', 'map', range)).toBe(`${ROOT}/items?datetime=2026-11-16T00:00:00Z/2026-11-17T00:00:00Z&bbox=19.000,59.000,32.000,70.000`);
  });

  it('turns a box in EPSG:4326, latitude first, or in EPSG:3857 metres into CRS84', () => {
    expect(querySwitch(alarm(), 'items', 'map', map({ bbox: '59,19,70,32', 'bbox-crs': URI(4326) })).carried).toEqual([19, 59, 32, 70]);
    const metres = querySwitch(alarm(), 'items', 'map', map({ bbox: '2433333,9002109,3133310,9491344', 'bbox-crs': '[EPSG:3857]' })).carried!;
    [21.859, 62.597, 28.147, 64.552].forEach((edge, i) => expect(metres[i]).toBeCloseTo(edge, 5));
    expect(requestAfter(alarm(), 'items', 'map', map({ bbox: '2433333,9002109,3133310,9491344', 'bbox-crs': URI(3857) })))
      .toBe(`${ROOT}/items?bbox=21.859,62.597,28.147,64.552`);
    // Its two dimensions, and across the antimeridian as CRS84 writes it
    expect(querySwitch(alarm(), 'items', 'map', map({ bbox: '19,59,0,32,70,500' })).carried).toEqual([19, 59, 32, 70]);
    expect(querySwitch(alarm(), 'items', 'map', map({ bbox: '170,-10,-170,10' })).carried).toEqual([170, -10, -170, 10]);
  });

  it('leaves a box in another CRS behind, and says why; the time still goes', () => {
    const storage = map({ bbox: '-196593,6255330,1044177,8084432', 'bbox-crs': URI(3067) }, { datetime: '2026-11-16T12:00:00Z' });
    expect(querySwitch(alarm(), 'items', 'map', storage)).toMatchObject({
      queryParams: {}, carried: null, filterByTime: true,
      leftBehind: "The map's bbox wasn't kept: it's in EPSG:3067, which the form can't turn into CRS84, the box items takes",
    });
    expect(requestAfter(alarm(), 'items', 'map', storage)).toBe(`${ROOT}/items?datetime=2026-11-16T12:00:00Z`);
    expect(querySwitch(alarm(), 'items', 'map', map({ bbox: '19,59,32' })).leftBehind).toBe("The map's bbox 19,59,32 wasn't kept: it can't be read as a box");
    expect(querySwitch(alarm(), 'items', 'map', map({ 'bbox-crs': URI(3067) })).leftBehind).toBe('');
  });

  it('sends no time the map didn’t have', () => {
    expect(querySwitch(alarm(), 'items', 'map', map({ bbox: '19,59,32,70' })).filterByTime).toBe(false);
    expect(requestAfter(alarm(), 'items', 'map', map({}))).toBe(`${ROOT}/items`);
  });
});

describe('switching from items to a map', () => {
  const items = (drawn: BBox | null, more: Partial<QueryNow> = {}) => now({ drawn, queryParams: { limit: '5' }, format: 'json', ...more });

  it('keeps the box, written in CRS84, and the time items filtered by, and nothing else of items’', () => {
    const before = items([19, 59, 32, 70], { datetime: '2026-11-16T12:00:00Z', filterByTime: true });
    expect(querySwitch(alarm(), 'map', 'items', before)).toEqual({
      queryType: 'map', format: '', parameters: [], queryParams: { bbox: '19,59,32,70' }, carried: null, leftBehind: '', filterByTime: true,
    });
    expect(requestAfter(alarm(), 'map', 'items', before)).toBe(`${ROOT}/map?datetime=2026-11-16T12:00:00Z&bbox=19,59,32,70`);
    const range = items([21.85949, 62.59712, 28.14651, 64.55188], { datetime: '2026-11-16T00:00:00Z/2026-11-17T00:00:00Z', filterByTime: true });
    expect(requestAfter(alarm(), 'map', 'items', range)).toBe(`${ROOT}/map?datetime=2026-11-16T00:00:00Z/2026-11-17T00:00:00Z&bbox=21.859,62.597,28.147,64.552`);
  });

  it('has no box where items had none', () => {
    expect(querySwitch(alarm(), 'map', 'items', items(null)).queryParams).toEqual({});
    expect(requestAfter(alarm(), 'map', 'items', items(null))).toBe(`${ROOT}/map`);
  });
});

describe('switching between other queries', () => {
  const OBS = fmiObs as unknown as Collection;

  it('keeps what it did: the format and parameters where offered, the box the map keeps for the same kind of geometry', () => {
    const position = now({ format: 'CoverageJSON', parameters: ['t2m'], queryParams: { crs: 'CRS84' }, datetime: '2026-11-16T12:00:00Z' });
    expect(querySwitch(OBS, 'area', 'position', position)).toEqual({
      queryType: 'area', format: 'CoverageJSON', parameters: ['t2m'], queryParams: {}, carried: null, leftBehind: '', filterByTime: false,
    });
    // The same query: its fields stay
    expect(querySwitch(OBS, 'position', 'position', position).queryParams).toBe(position.queryParams);
  });

  it('keeps neither the format nor the parameters an EDR query had on a map, though the collection lists the format', () => {
    // fmi-obs as if it had a map: its output_formats, CoverageJSON among them, are the collection's
    const withMap = withLinkQueries({ ...OBS, links: [...(OBS.links ?? []), { href: 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/map', rel: 'http://www.opengis.net/def/rel/ogc/1.0/map', type: 'image/png' }] } as Collection);
    const position = now({ format: 'CoverageJSON', parameters: ['t2m'] });
    expect(querySwitch(withMap, 'map', 'position', position)).toMatchObject({ queryType: 'map', format: '', parameters: [] });
    // Between EDR queries both stay
    expect(querySwitch(withMap, 'area', 'position', position)).toMatchObject({ format: 'CoverageJSON', parameters: ['t2m'] });
  });

  it('filters items by a time the last request sent, not by one a list only held, nor a locations list by any', () => {
    const timed = { datetime: '2026-11-16T12:00:00Z' };
    expect(querySwitch(OBS, 'items', 'position', now(timed)).filterByTime).toBe(true);
    expect(querySwitch(OBS, 'items', 'locations', now(timed)).filterByTime).toBe(false);
    expect(querySwitch(OBS, 'items', 'locations', now({ ...timed, hasLocation: true })).filterByTime).toBe(true);
    expect(querySwitch(OBS, 'items', 'locations', now({ ...timed, filterByTime: true })).filterByTime).toBe(true);
    expect(querySwitch(OBS, 'locations', 'position', now(timed)).filterByTime).toBe(false);
    expect(querySwitch(OBS, 'items', 'position', now({ datetime: ' ' })).filterByTime).toBe(false);
  });
});
