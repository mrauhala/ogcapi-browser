import { describe, expect, it } from 'vitest';
import { itemsOf } from './itemsList';

const ITEMS = 'https://api.weather.gc.ca/collections/hydrometric-stations/items';
const station = (id: string) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-68.6, 47.5] }, properties: { STATION_NAME: id } });
const list = { type: 'FeatureCollection', features: [station('01AA002'), station('01AD001')], numberMatched: 8057, numberReturned: 2 };

describe('itemsOf', () => {
  it('reads a list of items, with the counts the answer gives', () => {
    expect(itemsOf(`${ITEMS}?f=json&limit=2`, JSON.stringify(list))).toEqual({
      features: list.features, one: false, numberMatched: 8057, numberReturned: 2,
    });
  });

  it('leaves out a count the answer doesn’t give, or gives as something else', () => {
    const bare = { type: 'FeatureCollection', features: [station('a')], numberMatched: '12', numberReturned: null };
    expect(itemsOf(ITEMS, JSON.stringify(bare))).toMatchObject({ numberMatched: null, numberReturned: null });
    // As read already: JSON itself has no such number
    expect(itemsOf(ITEMS, 'read', { ...bare, numberMatched: Infinity, numberReturned: NaN }))
      .toMatchObject({ numberMatched: null, numberReturned: null });
  });

  it('reads a list with no features, or features that aren’t a list, as empty', () => {
    expect(itemsOf(ITEMS, '{"type":"FeatureCollection","features":[]}')?.features).toEqual([]);
    expect(itemsOf(ITEMS, '{"type":"FeatureCollection"}')?.features).toEqual([]);
    expect(itemsOf(ITEMS, '{"type":"FeatureCollection","features":{}}')?.features).toEqual([]);
  });

  it('reads one item by its path, a record’s id with its : as it is', () => {
    const one = station('01AD001');
    expect(itemsOf(`${ITEMS}/01AD001`, JSON.stringify(one))).toEqual({ features: [one], one: true, numberMatched: null, numberReturned: null });
    const record = { type: 'Feature', id: 'urn:wmo:md:ca-eccc-msc:x', geometry: null, properties: { title: 'A record' } };
    expect(itemsOf('https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items/urn:wmo:md:ca-eccc-msc:x?f=json', JSON.stringify(record))?.one).toBe(true);
  });

  it('takes the JSON already read, whatever the text', () => {
    expect(itemsOf(ITEMS, 'not read again', list)?.features).toHaveLength(2);
  });

  it('reads a path with a trailing slash', () => {
    expect(itemsOf(`${ITEMS}/`, JSON.stringify(list))?.one).toBe(false);
    expect(itemsOf(`${ITEMS}/01AD001/`, JSON.stringify(station('01AD001')))?.one).toBe(true);
  });

  it('is nothing for an HTML page, an error, no text, or what the path doesn’t say it is', () => {
    expect(itemsOf(`${ITEMS}?f=html`, '<html><body>Items</body></html>')).toBeNull();
    expect(itemsOf(ITEMS, '{"code":"InvalidParameterValue","description":"Invalid bbox"}')).toBeNull();
    expect(itemsOf(ITEMS, '[1,2]')).toBeNull();
    expect(itemsOf(ITEMS, null)).toBeNull();
    expect(itemsOf(ITEMS, '')).toBeNull();
    // A list where one item was asked for, and one item where a list was
    expect(itemsOf(`${ITEMS}/01AD001`, JSON.stringify(list))).toBeNull();
    expect(itemsOf(ITEMS, JSON.stringify(station('a')))).toBeNull();
  });

  it('is nothing for what isn’t a collection’s items, as its locations or a query', () => {
    const MC = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs';
    expect(itemsOf(`${MC}/locations`, JSON.stringify(list))).toBeNull();
    expect(itemsOf(`${MC}/position?coords=POINT(24 60)&f=GeoJSON`, JSON.stringify(list))).toBeNull();
    expect(itemsOf(`${MC}/items/a/b`, JSON.stringify(station('b')))).toBeNull();
    expect(itemsOf('not a url', JSON.stringify(list))).toBeNull();
  });
});
