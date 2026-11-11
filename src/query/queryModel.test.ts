import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { buildQueryModel, timeIsOnlyAFilter, type QueryModelInput } from './queryModel';
import meteocoreObs from './__fixtures__/meteocore-fmi-obs.json';

const ITEMS = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items';
const input = (overrides: Partial<QueryModelInput> = {}): QueryModelInput => ({
  collection: meteocoreObs as unknown as Collection, queryKey: 'items', format: 'GeoJSON', parameters: [],
  datetime: '2026-10-06T06:00:00Z/..', vertical: '', customDims: {}, points: [], polygons: [], bbox: [24, 60, 25, 61],
  bboxAsCoords: false, radius: { value: null, units: '' }, queryParams: { limit: '50', crs: 'CRS84' }, locationFeature: null, ...overrides,
});

describe('buildQueryModel', () => {
  it('makes one item its path, with none of the list’s choices but f', () => {
    const model = buildQueryModel(input({ itemId: '0-148-0-CHD64901' }))!;
    expect(model.baseHref).toBe(`${ITEMS}/0-148-0-CHD64901`);
    expect(model.datetime).toBe('');
    expect(model.bbox).toBeNull();
    expect(model.queryParams).toEqual({ crs: 'CRS84' });
    expect(model.format).toBe('GeoJSON');
    expect(model.queryType).toBe('items');
  });

  it('keeps the list’s choices for the list', () => {
    for (const itemId of ['', undefined]) {
      const model = buildQueryModel(input({ itemId }))!;
      expect(model.baseHref).toBe(ITEMS);
      expect(model.datetime).toBe('2026-10-06T06:00:00Z/..');
      expect(model.bbox).toEqual([24, 60, 25, 61]);
      expect(model.queryParams).toEqual({ limit: '50', crs: 'CRS84' });
    }
  });

  it('takes an item only for an items query', () => {
    const model = buildQueryModel(input({ queryKey: 'position', itemId: 'x' }))!;
    expect(model.baseHref).toBe('https://meteocore.app.meteo.fi/edr/collections/fmi-obs/position');
    expect(model.datetime).toBe('2026-10-06T06:00:00Z/..');
  });

  it('is nothing without a query the collection has', () => {
    expect(buildQueryModel(input({ queryKey: '' }))).toBeNull();
    expect(buildQueryModel(input({ queryKey: 'cube' }))).toBeNull();
  });
});

describe('timeIsOnlyAFilter', () => {
  it.each(['position', 'radius', 'area', 'cube', 'trajectory', 'corridor'])('lets the time select the data of a %s query', queryType => {
    expect(timeIsOnlyAFilter(queryType, false)).toBe(false);
  });

  it('lets it select the data of one location', () => {
    expect(timeIsOnlyAFilter('locations', true)).toBe(false);
  });

  it('only filters a list of locations', () => {
    expect(timeIsOnlyAFilter('locations', false)).toBe(true);
  });

  it('only filters items, location or not', () => {
    expect(timeIsOnlyAFilter('items', false)).toBe(true);
    expect(timeIsOnlyAFilter('items', true)).toBe(true);
  });

  it('has no opinion on no query', () => {
    expect(timeIsOnlyAFilter('', false)).toBe(false);
  });
});
