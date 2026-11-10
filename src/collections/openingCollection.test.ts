import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collection, ValidationResult } from '../types/api';
import { adjacentCollection, collectionUrlOf, extentsOf, geoJsonLinksOf, withLocationsValidation, withoutLocationsValidation } from './openingCollection';

const collection = (overrides: Partial<Collection> = {}) => ({
  id: 'a',
  links: [],
  extent: {},
  ...overrides,
}) as unknown as Collection;
const GEOJSON = { href: 'https://api.test/a/items', rel: 'items', type: 'application/geo+json', title: 'Items' };
const WITH_TIME = { extent: { temporal: { interval: [['2026-01-01T00:00:00Z', null]] } } } as unknown as Partial<Collection>;

describe('adjacentCollection', () => {
  const [one, two, three] = [collection({ id: 'one' }), collection({ id: 'two' }), collection({ id: 'three' })];
  const list = [one, two, three];

  it('finds the one before and the one after', () => {
    expect(adjacentCollection(list, two, -1)).toBe(one);
    expect(adjacentCollection(list, two, 1)).toBe(three);
  });

  it('has nothing beyond either end', () => {
    expect(adjacentCollection(list, one, -1)).toBeNull();
    expect(adjacentCollection(list, three, 1)).toBeNull();
  });

  it('starts at the first with none open', () => {
    expect(adjacentCollection(list, null, 1)).toBe(one);
    expect(adjacentCollection(list, null, -1)).toBeNull();
  });

  it('starts at the first with one open that is not in the list', () => {
    expect(adjacentCollection(list, collection({ id: 'two' }), 1)).toBe(one);
    expect(adjacentCollection(list, collection({ id: 'two' }), -1)).toBeNull();
  });

  it('has nothing in an empty list', () => {
    expect(adjacentCollection([], null, 1)).toBeNull();
    expect(adjacentCollection([], one, -1)).toBeNull();
  });

  it('tells apart two that share an ID', () => {
    const [first, second] = [collection({ id: 'same' }), collection({ id: 'same' })];
    expect(adjacentCollection([first, second, three], second, 1)).toBe(three);
    expect(adjacentCollection([first, second, three], second, -1)).toBe(first);
  });
});

describe('geoJsonLinksOf', () => {
  it('takes only GeoJSON links', () => {
    const links = [GEOJSON, { href: 'https://api.test/a', rel: 'self', type: 'application/json' }];
    expect(geoJsonLinksOf(collection({ links } as Partial<Collection>))).toEqual([{ url: GEOJSON.href, title: 'Items' }]);
  });

  it('names a link by its rel, or as a layer', () => {
    const links = [{ ...GEOJSON, title: undefined }, { ...GEOJSON, title: undefined, rel: '' }];
    expect(geoJsonLinksOf(collection({ links } as Partial<Collection>)).map(link => link.title)).toEqual(['items', 'GeoJSON Layer']);
  });

  it('skips a link it cannot read', () => {
    expect(geoJsonLinksOf(collection({ links: [{ ...GEOJSON, href: undefined }] } as unknown as Partial<Collection>))).toEqual([]);
  });

  it('copes with no links', () => {
    expect(geoJsonLinksOf(collection({ links: undefined } as unknown as Partial<Collection>))).toEqual([]);
  });

  it('adds the time chosen, if the collection has time', () => {
    const timed = collection({ links: [GEOJSON], ...WITH_TIME } as Partial<Collection>);
    expect(geoJsonLinksOf(timed, '2026-01-02')[0].url).toBe(`${GEOJSON.href}?datetime=2026-01-02`);
    expect(geoJsonLinksOf(collection({ links: [GEOJSON] } as Partial<Collection>), '2026-01-02')[0].url).toBe(GEOJSON.href);
  });

  it('adds nothing when no time is chosen', () => {
    expect(geoJsonLinksOf(collection({ links: [GEOJSON], ...WITH_TIME } as Partial<Collection>))[0].url).toBe(GEOJSON.href);
  });

  it('adds a range once both ends are chosen, an open one included', () => {
    const timed = collection({ links: [GEOJSON], ...WITH_TIME } as Partial<Collection>);
    expect(geoJsonLinksOf(timed, 'a/b')[0].url).toBe(`${GEOJSON.href}?datetime=a/b`);
    expect(geoJsonLinksOf(timed, 'a/..')[0].url).toBe(`${GEOJSON.href}?datetime=a/..`);
    expect(geoJsonLinksOf(timed, 'a/')[0].url).toBe(GEOJSON.href);
    expect(geoJsonLinksOf(timed, '/b')[0].url).toBe(GEOJSON.href);
  });

  it('adds to a query that is already there', () => {
    const links = [{ ...GEOJSON, href: 'https://api.test/a/items?f=json' }];
    expect(geoJsonLinksOf(collection({ links, ...WITH_TIME } as Partial<Collection>), 'x')[0].url).toBe('https://api.test/a/items?f=json&datetime=x');
  });
});

describe('collectionUrlOf', () => {
  it('is the collection itself, not a query its data links name', () => {
    // As MeteoCore's ecmwf-ifs-pressure links its queries, 2026-11-08
    const links = [
      { href: 'https://api.test/edr/collections/a', rel: 'self' },
      { href: 'https://api.test/edr/collections/a/position', rel: 'data' },
      { href: 'https://api.test/edr/collections/a/area', rel: 'data' },
    ];
    expect(collectionUrlOf(collection({ links } as Partial<Collection>), 'https://api.test/edr')).toBe('https://api.test/edr/collections/a');
    expect(collectionUrlOf(collection({ links: undefined } as unknown as Partial<Collection>), 'https://api.test/edr')).toBe('https://api.test/edr/collections/a');
  });

  it("doesn't double the slash a service URL ends in", () => {
    // KNMI is listed as https://geoservices.knmi.nl/edr/
    expect(collectionUrlOf(collection(), 'https://api.test/edr/')).toBe('https://api.test/edr/collections/a');
    expect(collectionUrlOf(collection(), 'https://api.test//')).toBe('https://api.test/collections/a');
  });

  it("writes an id's ':' and '@' as they are, as a path may hold them, and ';' encoded", () => {
    expect(collectionUrlOf(collection({ id: 'urn:wmo:md:a@b;c' }), 'https://api.test')).toBe('https://api.test/collections/urn:wmo:md:a@b%3Bc');
  });

  it('keeps an id that would end the path inside the path', () => {
    expect(collectionUrlOf(collection({ id: 'a b#c?d/e' }), 'https://api.test')).toBe('https://api.test/collections/a%20b%23c%3Fd%2Fe');
    expect(collectionUrlOf(collection({ id: 7 as unknown as string }), 'https://api.test')).toBe('https://api.test/collections/7');
  });
});

describe('extentsOf', () => {
  afterEach(() => vi.restoreAllMocks());
  const withBbox = (bbox: unknown) => collection({ extent: { spatial: { bbox } } } as unknown as Partial<Collection>);

  it('reads the boxes', () => {
    expect(extentsOf(withBbox([[1, 2, 3, 4]]))).toEqual([[1, 2, 3, 4]]);
  });

  it('has none without a box, which is nothing to warn about', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extentsOf(collection())).toBeNull();
    expect(extentsOf(withBbox([]))).toBeNull();
    expect(extentsOf(withBbox('x'))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('has none when the box is nonsense', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(extentsOf(withBbox([['a']]))).toBeNull();
  });
});

const LOCATIONS_ERROR = { message: 'bad', section: 'Locations' };
const OTHER_ERROR = { message: 'bad', section: 'collections' };

describe('withoutLocationsValidation', () => {
  it('leaves a result without any alone, the same object', () => {
    const result: ValidationResult = { isValid: false, errors: [OTHER_ERROR] };
    expect(withoutLocationsValidation(result)).toBe(result);
  });

  it('removes the section and its errors, keeping the rest', () => {
    const result = withoutLocationsValidation({
      isValid: false,
      errors: [OTHER_ERROR, LOCATIONS_ERROR],
      locationsValidation: { isValid: false, errors: [LOCATIONS_ERROR] },
    });
    expect(result.locationsValidation).toBeUndefined();
    expect(result.errors).toEqual([OTHER_ERROR]);
    expect(result.isValid).toBe(false);
  });

  it('makes the service valid again if that was all that was wrong', () => {
    const result = withoutLocationsValidation({ isValid: false, errors: [LOCATIONS_ERROR], locationsValidation: { isValid: false, errors: [LOCATIONS_ERROR] } });
    expect(result).toEqual({ isValid: true, errors: null });
  });

  it("doesn't count notes against the service", () => {
    const note = { message: 'fyi', severity: 'info' as const };
    expect(withoutLocationsValidation({ isValid: false, errors: [note, LOCATIONS_ERROR] }).isValid).toBe(true);
  });

  it('keeps another section that is still invalid', () => {
    const result = withoutLocationsValidation({
      isValid: false,
      errors: [LOCATIONS_ERROR],
      collectionsValidation: { isValid: false, errors: null },
    });
    expect(result.isValid).toBe(false);
  });

  it('also removes errors left without a section', () => {
    expect(withoutLocationsValidation({ isValid: true, errors: [LOCATIONS_ERROR] }).errors).toBeNull();
  });
});

describe('withLocationsValidation', () => {
  it('adds what was found', () => {
    const result = withLocationsValidation({ isValid: true, errors: [OTHER_ERROR] }, { isValid: false, errors: [LOCATIONS_ERROR] }, '1.1');
    expect(result.locationsValidation).toEqual({ isValid: false, errors: [LOCATIONS_ERROR], schemaResults: [{ schema: 'EDR 1.1 Locations', isValid: false }] });
    expect(result.errors).toEqual([OTHER_ERROR, LOCATIONS_ERROR]);
    expect(result.isValid).toBe(false);
  });

  it('replaces what was found before', () => {
    const result = withLocationsValidation({ isValid: true, errors: [LOCATIONS_ERROR] }, { isValid: true, errors: [] }, '1.1');
    expect(result.errors).toBeNull();
    expect(result.locationsValidation?.errors).toBeNull();
  });

  it("doesn't make an invalid service valid", () => {
    expect(withLocationsValidation({ isValid: false, errors: [OTHER_ERROR] }, { isValid: true, errors: [] }, '1.1').isValid).toBe(false);
  });
});
