import { describe, expect, it } from 'vitest';
import { featureLabel, featureRows, geometryText, nameKeyOf, propertyField, propertyKeysOf } from './featureRows';

const point = (id: unknown, properties: unknown, coordinates: unknown = [24.9384, 60.1699]) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties });

describe('propertyKeysOf', () => {
  it('lists every property any feature has, in the order they first come', () => {
    expect(propertyKeysOf([point('a', { name: 'A', height: 1 }), point('b', { name: 'B', kind: 'x' }), point('c', null), 'junk', null])).toEqual(['name', 'height', 'kind']);
    expect(propertyKeysOf([])).toEqual([]);
  });
});

describe('nameKeyOf', () => {
  it('takes name, then title, then EDR’s label', () => {
    expect(nameKeyOf(['label', 'title', 'name'])).toBe('name');
    expect(nameKeyOf(['label', 'title'])).toBe('title');
    expect(nameKeyOf(['datetime', 'label'])).toBe('label');
    expect(nameKeyOf(['datetime'])).toBeNull();
  });
});

describe('featureLabel', () => {
  it('is the name, title or label, else the id', () => {
    expect(featureLabel(point('a', { label: 'Abéché', title: 'T' }))).toBe('T');
    expect(featureLabel(point('a', { label: 'Abéché' }))).toBe('Abéché');
    expect(featureLabel(point('a', { name: '', label: 'L' }))).toBe('L');
    expect(featureLabel(point(7, {}))).toBe('7');
    expect(featureLabel(point(undefined, null))).toBe('');
    expect(featureLabel({ properties: { name: 3 } })).toBe('');
  });
});

describe('geometryText', () => {
  it('gives a point’s coordinates as sent, a height too', () => {
    expect(geometryText({ type: 'Point', coordinates: [7.1427397728, 50.8658981323] })).toBe('Point 7.1427397728, 50.8658981323');
    expect(geometryText({ type: 'Point', coordinates: [25, 60, 12.5] })).toBe('Point 25, 60, 12.5');
  });

  it('gives anything else’s bounding box: west, south, east, north', () => {
    expect(geometryText({ type: 'Polygon', coordinates: [[[21, 61], [22.5, 61], [22, 62], [21, 61]]] })).toBe('Polygon bbox 21, 61, 22.5, 62');
    expect(geometryText({ type: 'MultiPoint', coordinates: [[25, 60, 3], [24, 65, 9]] })).toBe('MultiPoint bbox 24, 60, 25, 65');
    expect(geometryText({ type: 'LineStringZ', coordinates: [[1, 2, 3], [4, -5, 6]] })).toBe('LineStringZ bbox 1, -5, 4, 2');
    expect(geometryText({
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', coordinates: [10, 50] }, { type: 'LineString', coordinates: [[12, 48], [11, 51]] }],
    })).toBe('GeometryCollection bbox 10, 48, 12, 51');
  });

  it('says what it can of what an API under test can send', () => {
    expect(geometryText(null)).toBe('null');
    expect(geometryText(undefined)).toBe('');
    expect(geometryText('POINT(1 2)')).toBe('');
    expect(geometryText({ coordinates: [[1, 2], [3, 4]] })).toBe('(no type) bbox 1, 2, 3, 4');
    expect(geometryText({ type: 'Polygon', coordinates: [] })).toBe('Polygon');
    expect(geometryText({ type: 'MultiPoint', coordinates: [[1, 2], [Infinity, 4], ['5', 6]] })).toBe('MultiPoint bbox 1, 2, 1, 2');
  });
});

describe('featureRows', () => {
  it('numbers the rows, so that a repeated or missing id doesn’t clash', () => {
    const rows = featureRows([point('a', {}), point('a', {}), point(undefined, {}), point(0, {}), point({ x: 1 }, {})], []);
    expect(rows.map(row => row.id)).toEqual([0, 1, 2, 3, 4]);
    expect(rows.map(row => row.featureId)).toEqual(['a', 'a', '', 0, '{"x":1}']);
  });

  it('keeps the feature as it came, to show it on the map, and an empty one for what isn’t a feature', () => {
    const feature = point('a', {});
    const [row, junk] = featureRows([feature, 'junk'], []);
    expect(row.feature).toBe(feature);
    expect(junk.feature).toEqual({});
    expect(junk.geometry).toBe('');
    expect(row.geometry).toBe('Point 24.9384, 60.1699');
  });

  it('puts each property under its own field, one named id too', () => {
    const [row] = featureRows([point('EDDK', { id: 'own', name: 'Cologne', keywords: ['a', 'b'], nested: { x: 1 }, list: [1, 2], none: null })], ['id', 'name', 'keywords', 'nested', 'list', 'none', 'absent']);
    expect(row.id).toBe(0);
    expect(row.featureId).toBe('EDDK');
    expect(row[propertyField('id')]).toBe('own');
    expect(row[propertyField('name')]).toBe('Cologne');
    // Keywords stay a list for their chips; anything else that isn't a plain value is its JSON
    expect(row[propertyField('keywords')]).toEqual(['a', 'b']);
    expect(row[propertyField('nested')]).toBe('{"x":1}');
    expect(row[propertyField('list')]).toBe('[1,2]');
    expect(row[propertyField('none')]).toBeNull();
    expect(row[propertyField('absent')]).toBeUndefined();
  });
});
