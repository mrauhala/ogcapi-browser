import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { normalizeHref } from '../utils/href';
import { buildQueryModel, type LocationFeature, type QueryModelInput } from './queryModel';
import { buildQueryUrl } from './buildQueryUrl';
import { intervalText } from './dimensionText';
import fmiEcmwf from './__fixtures__/fmi-ecmwf.json';
import fmiPainepinta from './__fixtures__/fmi-ecmwf-painepinta.json';
import dwdIcon from './__fixtures__/dwd-icon-d2-ruc-single-level.json';
import meteocoreObs from './__fixtures__/meteocore-fmi-obs.json';
import metofficePop from './__fixtures__/metoffice-global-pop-density.json';

const COLLECTIONS = { fmiEcmwf, fmiPainepinta, dwdIcon, meteocoreObs, metofficePop } as unknown as Record<string, Collection>;

// useQueryUrl's buildUrlWithParams before the query model existed, kept verbatim as the reference
function legacyBuildUrl(
  baseUrl: string, format: string, parameters: string[], coords: [number, number][] | null,
  area: [number, number][][] | null, radius: number | undefined, queryType: string, locationFeature: LocationFeature | null,
  datetime: string, dtMode: 'individual' | 'range', dtStart: string, dtEnd: string,
  vertical: string, vMode: 'individual' | 'range', vStart: string, vEnd: string,
  customDims: Record<string, string>, customDimModes: Record<string, 'individual' | 'range'>,
  customDimStarts: Record<string, string>, customDimEnds: Record<string, string>,
): string {
  let url = new URL(baseUrl);
  if (queryType.toLowerCase() === 'locations' && locationFeature) {
    if (locationFeature.properties?.href) {
      url = new URL(locationFeature.properties.href);
    } else if (locationFeature.id) {
      const pathParts = url.pathname.split('/').filter(part => part.length > 0);
      const locationId = String(locationFeature.id);
      if (pathParts[pathParts.length - 1] !== locationId) {
        pathParts.push(locationId);
        url.pathname = '/' + pathParts.join('/');
      }
    }
  }
  if (format) url.searchParams.set('f', format); else url.searchParams.delete('f');
  if (parameters && parameters.length > 0) url.searchParams.set('parameter-name', parameters.join(','));
  else url.searchParams.delete('parameter-name');
  if (dtMode === 'range' && dtStart && dtEnd) url.searchParams.set('datetime', `${dtStart}/${dtEnd}`);
  else if (dtMode === 'individual' && datetime) url.searchParams.set('datetime', datetime);
  else url.searchParams.delete('datetime');
  if (vMode === 'range' && vStart && vEnd) url.searchParams.set('z', `${vStart}/${vEnd}`);
  else if (vMode === 'individual' && vertical) url.searchParams.set('z', vertical);
  else url.searchParams.delete('z');
  Object.keys(customDims).forEach(dimensionId => {
    const mode = customDimModes[dimensionId] || 'individual';
    const value = customDims[dimensionId];
    const start = customDimStarts[dimensionId];
    const end = customDimEnds[dimensionId];
    if (mode === 'range' && start && end) url.searchParams.set(dimensionId, `${start}/${end}`);
    else if (mode === 'individual' && value) url.searchParams.set(dimensionId, value);
    else url.searchParams.delete(dimensionId);
  });
  const q = queryType.toLowerCase();
  if (q === 'position' && coords && coords.length > 0) {
    if (coords.length === 1) {
      const [lon, lat] = coords[0];
      url.searchParams.set('coords', `POINT(${lon.toFixed(3)} ${lat.toFixed(3)})`);
    } else {
      url.searchParams.set('coords', `MULTIPOINT(${coords.map(c => `(${c[0].toFixed(3)} ${c[1].toFixed(3)})`).join(',')})`);
    }
  } else if (q === 'trajectory' && coords && coords.length > 1) {
    url.searchParams.set('coords', `LINESTRING(${coords.map(c => `${c[0].toFixed(3)} ${c[1].toFixed(3)}`).join(', ')})`);
  } else if (q === 'radius' && coords && coords.length > 0) {
    if (coords.length === 1) {
      const [lon, lat] = coords[0];
      url.searchParams.set('coords', `POINT(${lon.toFixed(3)} ${lat.toFixed(3)})`);
    } else {
      url.searchParams.set('coords', `MULTIPOINT(${coords.map(c => `(${c[0].toFixed(3)} ${c[1].toFixed(3)})`).join(',')})`);
    }
    if (radius !== undefined) {
      url.searchParams.set('within', radius.toString());
      url.searchParams.set('within-units', 'km');
    }
  } else if (q === 'area' && area && area.length > 0) {
    if (area.length === 1) {
      url.searchParams.set('coords', `POLYGON((${area[0].map(c => `${c[0].toFixed(2)} ${c[1].toFixed(2)}`).join(',')}))`);
    } else {
      const polygons = area.map(p => `((${p.map(c => `${c[0].toFixed(2)} ${c[1].toFixed(2)}`).join(',')}))`).join(',');
      url.searchParams.set('coords', `MULTIPOLYGON(${polygons})`);
    }
  } else if (q !== 'locations') {
    url.searchParams.delete('coords');
    url.searchParams.delete('within');
    url.searchParams.delete('within-units');
  }
  return url.toString();
}

// The selections the old form held, for the old builder, and the text the form now holds for them
interface DimSelection { mode: 'individual' | 'range'; value: string; start: string; end: string }
const emptyDim = (): DimSelection => ({ mode: 'individual', value: '', start: '', end: '' });
const asText = ({ mode, value, start, end }: DimSelection, open = false) => (mode === 'range' ? intervalText(start, end, open) : value);

const DATETIMES: DimSelection[] = [
  emptyDim(),
  { mode: 'individual', value: '2026-10-05T12:00:00Z', start: '', end: '' },
  { mode: 'range', value: '', start: '2026-10-05T00:00:00Z', end: '2026-10-06T00:00:00Z' },
  { mode: 'range', value: '', start: '2026-10-05T00:00:00Z', end: '' },
];
const VERTICALS: DimSelection[] = [
  emptyDim(),
  { mode: 'individual', value: '850', start: '', end: '' },
  { mode: 'range', value: '', start: '1000', end: '500' },
  { mode: 'range', value: '', start: '1000', end: '' },
];
const POINTS: [number, number][][] = [[], [[24.9384, 60.1699]], [[24.94, 60.17], [25.5, 61.25], [23.1, 62.8]]];
const POLYGONS: [number, number][][][] = [
  [],
  [[[24, 60], [25, 60], [25, 61], [24, 60]]],
  [[[24, 60], [25, 60], [25, 61], [24, 60]], [[20.123, 65.456], [21.5, 65.5], [21, 66], [20.123, 65.456]]],
];
const LOCATIONS = [null, { id: '658225' }, { id: 'x', properties: { href: 'https://example.org/edr/collections/c/locations/abc?f=json' } }];
const CUSTOM_DIMS: Record<string, DimSelection>[] = [{}, { member: { mode: 'individual', value: '5', start: '', end: '' } }];

describe('buildQueryUrl serializes exactly like the previous URL builder', () => {
  for (const [name, collection] of Object.entries(COLLECTIONS)) {
    // Corridor queries were sent without their geometry before, items with data selections they don't
    // take; both are tested below
    for (const queryKey of Object.keys(collection.data_queries).filter(key => key !== 'corridor' && key !== 'items')) {
      it(`${name} / ${queryKey}`, () => {
        const baseUrl = normalizeHref(collection.data_queries[queryKey].link.href)!;
        const format = collection.data_queries[queryKey].link.variables?.output_formats?.[0] ?? '';
        let compared = 0;
        for (const datetime of DATETIMES) for (const vertical of VERTICALS) for (const points of POINTS)
        for (const polygons of POLYGONS) for (const location of LOCATIONS) for (const customDims of CUSTOM_DIMS)
        // The locations list no longer gets the data selection; tested below
        if (queryKey !== 'locations' || location)
        for (const [f, parameters] of [['', []], [format, ['Temperature', 'Humidity']]] as [string, string[]][]) {
          const input: QueryModelInput = {
            collection, queryKey, format: f, parameters, datetime: asText(datetime, true), vertical: asText(vertical),
            customDims: Object.fromEntries(Object.entries(customDims).map(([id, s]) => [id, asText(s)])), points, polygons, bbox: null, bboxAsCoords: false,
            radius: { value: 25, units: 'km' }, queryParams: {}, locationFeature: location,
          };
          const model = buildQueryModel(input)!;
          // A time range with its start only goes in open at its end, as EDR allows: the old builder gets that as typed
          const time: DimSelection = datetime.mode === 'range' && datetime.start && !datetime.end
            ? { mode: 'individual', value: `${datetime.start}/..`, start: '', end: '' }
            : datetime;
          const legacy = legacyBuildUrl(
            baseUrl, f, parameters, points, polygons, 25, queryKey, location,
            time.value, time.mode, time.start, time.end,
            vertical.value, vertical.mode, vertical.start, vertical.end,
            Object.fromEntries(Object.entries(customDims).map(([id, s]) => [id, s.value])),
            Object.fromEntries(Object.entries(customDims).map(([id, s]) => [id, s.mode])),
            Object.fromEntries(Object.entries(customDims).map(([id, s]) => [id, s.start])),
            Object.fromEntries(Object.entries(customDims).map(([id, s]) => [id, s.end])),
          );
          // On purpose: a radius chosen before any point goes in, as it was chosen. A level range with one end stays out, as before.
          const expected = new URL(legacy);
          if (queryKey === 'radius' && points.length === 0) {
            expected.searchParams.set('within', '25');
            expected.searchParams.set('within-units', 'km');
          }
          expect(buildQueryUrl(model)).toBe(expected.toString());
          compared++;
        }
        expect(compared).toBe(4 * 4 * 3 * 3 * (queryKey === 'locations' ? 2 : 3) * 2 * 2);
      });
    }
  }
});

describe('buildQueryUrl', () => {
  const request = (queryKey: string, overrides: Partial<QueryModelInput>) => buildQueryUrl(buildQueryModel({
    collection: COLLECTIONS.fmiEcmwf, queryKey, format: 'CoverageJSON', parameters: [],
    datetime: '', vertical: '', customDims: {}, points: [[24.9384, 60.1699]], polygons: [], bbox: null, bboxAsCoords: false,
    radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null, ...overrides,
  })!)!;
  const position = (overrides: Partial<QueryModelInput>) => request('position', overrides);

  it('sends custom dimensions as they are, a range or a list', () => {
    expect(new URL(position({ customDims: { member: '1/5' } })).searchParams.get('member')).toBe('1/5');
    expect(new URL(position({ customDims: { member: '1,2,3' } })).searchParams.get('member')).toBe('1,2,3');
  });

  it('sends z in each of its forms, as it is', () => {
    for (const z of ['850', '1000,925,850', '1000/500', 'R5/100/50', '500/..', '../500']) {
      expect(new URL(position({ vertical: z })).searchParams.get('z')).toBe(z);
    }
  });

  // EDR 1.1 has only min/max, and 1.2 adds ../level and level/..: 850/ is neither, and 850/.. would choose the end
  it('puts no z in the URL for a level range with one end picked', () => {
    expect(new URL(position({ vertical: '850/' })).searchParams.has('z')).toBe(false);
    expect(new URL(position({ vertical: '/300' })).searchParams.has('z')).toBe(false);
    expect(new URL(position({ vertical: '850/300' })).searchParams.get('z')).toBe('850/300');
  });

  it('puts no custom dimension in the URL for a range of it with one end picked', () => {
    expect(new URL(position({ customDims: { member: '2/' } })).searchParams.has('member')).toBe(false);
    expect(new URL(position({ customDims: { member: '/4' } })).searchParams.has('member')).toBe(false);
    expect(new URL(position({ customDims: { member: '2/4' } })).searchParams.get('member')).toBe('2/4');
  });

  it('sends a time range open at an end, which EDR allows for datetime', () => {
    expect(new URL(position({ datetime: '2026-10-05T00:00:00Z/..' })).searchParams.get('datetime')).toBe('2026-10-05T00:00:00Z/..');
  });

  it('builds a position request', () => {
    expect(position({})).toBe('https://opendata.fmi.fi/edr/collections/ecmwf/position?f=CoverageJSON&coords=POINT%2824.938+60.170%29');
  });

  it('sends the radius in its unit', () => {
    const url = new URL(request('radius', { radius: { value: 500, units: 'm' } }));
    expect([url.searchParams.get('within'), url.searchParams.get('within-units')]).toEqual(['500', 'm']);
  });

  describe('a radius, nothing of it until chosen', () => {
    const sent = (radius: QueryModelInput['radius'], points: [number, number][] = [[24.9384, 60.1699]]) =>
      Object.fromEntries(new URL(request('radius', { format: '', radius, points })).searchParams);

    it('sends neither within nor its unit before they are chosen', () => {
      expect(sent({ value: null, units: '' })).toEqual({ coords: 'POINT(24.938 60.170)' });
      expect(sent({ value: null, units: '' }, [])).toEqual({});
    });

    it('sends each as it is chosen, the radius before a point too', () => {
      expect(sent({ value: 25, units: '' })).toEqual({ coords: 'POINT(24.938 60.170)', within: '25' });
      expect(sent({ value: null, units: 'mi' })).toEqual({ coords: 'POINT(24.938 60.170)', 'within-units': 'mi' });
      expect(sent({ value: 25, units: 'km' }, [])).toEqual({ within: '25', 'within-units': 'km' });
    });

    it('sends a radius of 0 as typed, for the server to answer', () => {
      expect(sent({ value: 0, units: 'km' }, [])).toEqual({ within: '0', 'within-units': 'km' });
    });
  });

  it('sends a corridor as its centre line plus the size parameters that are set', () => {
    const url = new URL(request('corridor', {
      points: [[24.9384, 60.1699], [25.5, 61.25]],
      queryParams: { 'corridor-width': '10', 'width-units': 'km', 'corridor-height': ' ', 'height-units': 'hPa', unrelated: 'x' },
    }));
    expect(url.searchParams.get('coords')).toBe('LINESTRING(24.938 60.170, 25.500 61.250)');
    expect(Object.fromEntries([...url.searchParams].filter(([name]) => name !== 'coords' && name !== 'f'))).toEqual({
      'corridor-width': '10', 'width-units': 'km', 'height-units': 'hPa',
    });
    expect(new URL(position({ queryParams: { 'corridor-width': '10' } })).searchParams.has('corridor-width')).toBe(false);
  });

  it('sends a cube box, and on request the same box as coords', () => {
    const cube = (bboxAsCoords: boolean) => new URL(buildQueryUrl(buildQueryModel({
      collection: COLLECTIONS.fmiPainepinta, queryKey: 'cube', format: 'CoverageJSON', parameters: [],
      datetime: '', vertical: '', customDims: {}, points: [[24.9384, 60.1699]], polygons: [],
      bbox: [24, 60.5, 25.25, 61], bboxAsCoords, radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null,
    })!)!).searchParams;
    expect(cube(false).get('bbox')).toBe('24.000,60.500,25.250,61.000');
    expect(cube(false).has('coords')).toBe(false); // clicked points belong to other query types
    expect(cube(true).get('coords')).toBe('POLYGON((24.000 60.500,24.000 61.000,25.250 61.000,25.250 60.500,24.000 60.500))');
    expect(new URL(position({ bbox: [24, 60, 25, 61] })).searchParams.has('bbox')).toBe(false);
  });

  it('sends items their box and limit, but no data selection', () => {
    const items = (overrides: Partial<QueryModelInput>) => new URL(buildQueryUrl(buildQueryModel({
      collection: COLLECTIONS.meteocoreObs, queryKey: 'items', format: 'GeoJSON', parameters: ['ta'],
      datetime: '2026-10-06T06:00:00Z', vertical: '2', customDims: { member: '5' },
      points: [[24.9384, 60.1699]], polygons: [], bbox: null, bboxAsCoords: false,
      radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null, ...overrides,
    })!)!).searchParams;
    expect(Object.fromEntries(items({}))).toEqual({ f: 'GeoJSON', datetime: '2026-10-06T06:00:00Z' });
    expect(Object.fromEntries(items({ bbox: [24, 60, 25, 61], queryParams: { limit: '50' } }))).toEqual({
      f: 'GeoJSON', datetime: '2026-10-06T06:00:00Z', bbox: '24.000,60.000,25.000,61.000', limit: '50',
    });
  });

  it('lists locations with the time only; a picked location gets the data selection', () => {
    const locations = (locationFeature: QueryModelInput['locationFeature']) => buildQueryUrl(buildQueryModel({
      collection: COLLECTIONS.meteocoreObs, queryKey: 'locations', format: 'CoverageJSON', parameters: ['ta'],
      datetime: '2026-10-06T06:00:00Z', vertical: '2', customDims: { member: '5' },
      points: [], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature,
    })!)!;
    expect(new URL(locations(null)).search).toBe('?datetime=2026-10-06T06%3A00%3A00Z');
    expect(Object.fromEntries(new URL(locations({ id: 'dkbor' })).searchParams)).toMatchObject({ f: 'CoverageJSON', 'parameter-name': 'ta', z: '2' });
  });

  it('returns null for a query the collection does not offer', () => {
    expect(buildQueryModel({
      collection: COLLECTIONS.fmiEcmwf, queryKey: 'nope', format: '', parameters: [], datetime: '',
      vertical: '', customDims: {}, points: [], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null,
    })).toBeNull();
  });
});
