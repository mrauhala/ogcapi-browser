import { describe, expect, it } from 'vitest';
import { fromItemsLink, itemHref, withItemsQuery } from './itemsQuery';
import type { Collection } from '../types/api';

// MSC GeoMet's hydrometric-stations, as pygeoapi links its items: GeoJSON, JSON-LD and HTML, each by f
const MSC = 'https://api.weather.gc.ca/collections/hydrometric-stations';
const msc = () => ({
  id: 'hydrometric-stations',
  itemType: 'feature',
  links: [
    { href: `${MSC}?f=json`, rel: 'self', type: 'application/json' },
    { href: `${MSC}/items?f=html`, rel: 'items', type: 'text/html' },
    { href: `${MSC}/items?f=json`, rel: 'items', type: 'application/geo+json' },
    { href: `${MSC}/items?f=jsonld`, rel: 'items', type: 'application/ld+json' },
    { href: `${MSC}/items?f=json#top`, rel: 'items', type: 'application/json' },
  ],
}) as unknown as Collection;

const itemsOf = (collection: Collection) => collection.data_queries?.items?.link;

describe('withItemsQuery', () => {
  it('makes the items link an items query: the GeoJSON one, without what it asks for, and its formats from each link’s f', () => {
    const view = withItemsQuery(msc());
    expect(itemsOf(view)).toEqual({
      href: `${MSC}/items`,
      rel: 'items',
      type: 'application/geo+json',
      variables: { query_type: 'items', output_formats: ['html', 'json', 'jsonld'] },
    });
  });

  it('keeps the rest of the collection, and leaves the collection itself as served', () => {
    const collection = msc();
    const view = withItemsQuery(collection);
    expect(view).not.toBe(collection);
    expect(view.id).toBe('hydrometric-stations');
    expect(view.links).toBe(collection.links);
    expect(collection.data_queries).toBeUndefined();
  });

  it('keeps the queries a collection has beside its items', () => {
    const collection = { ...msc(), data_queries: { position: { link: { href: `${MSC}/position`, rel: 'data' } } } } as unknown as Collection;
    expect(Object.keys(withItemsQuery(collection).data_queries)).toEqual(['position', 'items']);
  });

  it('is the same view each time, for comparing and memoising', () => {
    const collection = msc();
    expect(withItemsQuery(collection)).toBe(withItemsQuery(collection));
    // And a view given again is itself
    expect(withItemsQuery(withItemsQuery(collection))).toBe(withItemsQuery(collection));
  });

  it('takes the GeoJSON link’s path where another link has another, and leaves out its fragment', () => {
    const elsewhere = { id: 'odd', links: [
      { href: 'https://a.example/collections/odd/items.html', rel: 'items', type: 'text/html' },
      { href: 'https://a.example/collections/odd/items?f=json#features', rel: 'items', type: 'application/geo+json' },
    ] } as unknown as Collection;
    expect(itemsOf(withItemsQuery(elsewhere))?.href).toBe('https://a.example/collections/odd/items');
  });

  it('takes the first items link where none is GeoJSON, and no formats where none asks for one', () => {
    const plain = { id: 'observation', links: [{ href: 'https://opendataapi.dmi.dk/v2/metObs/collections/observation/items', rel: 'items', type: 'application/json' }] } as unknown as Collection;
    expect(itemsOf(withItemsQuery(plain))).toEqual({
      href: 'https://opendataapi.dmi.dk/v2/metObs/collections/observation/items',
      rel: 'items',
      type: undefined,
      variables: { query_type: 'items' },
    });
  });

  it('leaves alone EDR’s own items query, a collection with no items link, and no collection', () => {
    const edr = { id: 'fmi-obs', links: msc().links, data_queries: { items: { link: { href: 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items', rel: 'data' } } } } as unknown as Collection;
    expect(withItemsQuery(edr)).toBe(edr);
    const none = { id: 'none', links: [{ href: `${MSC}?f=json`, rel: 'self' }] } as unknown as Collection;
    expect(withItemsQuery(none)).toBe(none);
    const noLinks = { id: 'odd', links: 'nope' } as unknown as Collection;
    expect(withItemsQuery(noLinks)).toBe(noLinks);
    expect(withItemsQuery(null)).toBeNull();
  });

  it('leaves a collection whose items link isn’t a URL', () => {
    const relative = { id: 'odd', links: [{ href: 'items', rel: 'items', type: 'application/geo+json' }] } as unknown as Collection;
    expect(withItemsQuery(relative)).toBe(relative);
    const empty = { id: 'odd', links: [{ href: '', rel: 'items' }] } as unknown as Collection;
    expect(withItemsQuery(empty)).toBe(empty);
  });

  it('reads a format only from a link that’s a URL', () => {
    const odd = { id: 'odd', links: [
      { href: `${MSC}/items?f=json`, rel: 'items', type: 'application/geo+json' },
      { href: 'not a url?f=csv', rel: 'items' },
    ] } as unknown as Collection;
    expect(itemsOf(withItemsQuery(odd))?.variables?.output_formats).toEqual(['json']);
  });
});

describe('fromItemsLink', () => {
  it('tells the items query made from a link from EDR’s own', () => {
    const collection = msc();
    expect(fromItemsLink(withItemsQuery(collection))).toBe(true);
    expect(fromItemsLink(collection)).toBe(false);
    const edr = { id: 'fmi-obs', data_queries: { items: { link: { href: 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items', rel: 'data' } } } } as unknown as Collection;
    expect(fromItemsLink(withItemsQuery(edr))).toBe(false);
  });
});

describe('itemHref', () => {
  const ITEMS = `${MSC}/items`;

  it('puts one item’s id in the path, and leaves the list for none', () => {
    expect(itemHref(ITEMS, '01AD001')).toBe(`${ITEMS}/01AD001`);
    expect(itemHref(ITEMS, '')).toBe(ITEMS);
    expect(itemHref(`${ITEMS}/`, '01AD001')).toBe(`${ITEMS}/01AD001`);
  });

  it('writes an id as servers do: a record’s : as it is, and what a path can’t hold escaped', () => {
    expect(itemHref('https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items', 'urn:wmo:md:ca-eccc-msc:5e8247ca'))
      .toBe('https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items/urn:wmo:md:ca-eccc-msc:5e8247ca');
    expect(itemHref(ITEMS, 'a b/c?d')).toBe(`${ITEMS}/a%20b%2Fc%3Fd`);
  });

  it('keeps what the href asks for', () => {
    expect(itemHref(`${ITEMS}?f=json`, '01AD001')).toBe(`${ITEMS}/01AD001?f=json`);
  });

  it('leaves an href that isn’t a URL', () => {
    expect(itemHref('items', '01AD001')).toBe('items');
  });
});
