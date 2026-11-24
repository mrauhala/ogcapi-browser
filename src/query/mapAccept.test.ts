import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { withLinkQueries } from './mapQuery';
import { acceptAsked, acceptsType, sentAccept } from './mapAccept';
import more from './__fixtures__/meteocore-maps-more.json';

const ROOT = 'https://meteocore.app.meteo.fi/collections';
// As the form sees it: its map link a map query
const radar = () => withLinkQueries(structuredClone(more.collections[0]) as unknown as Collection);

describe('the Accept a request is sent with', () => {
  it('is the form’s for a map request of the collection, styled or not, whatever it asks', () => {
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, radar(), 'image/jpeg')).toBe('image/jpeg');
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map?bbox=19,59,32,70&f=image/png`, radar(), ' image/webp ')).toBe('image/webp');
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/styles/radar_fmi/map`, radar(), 'image/jpeg')).toBe('image/jpeg');
  });

  it('is none, the app’s */*, for anything else, or without one', () => {
    for (const url of [`${ROOT}/fmi-radar-composite-dbz`, `${ROOT}/fmi-radar-composite-dbz/map/tiles`, `${ROOT}/ecmwf-ifs-pressure/map`, 'https://example.org/map', 'not a URL']) {
      expect(sentAccept(url, radar(), 'image/jpeg'), url).toBeNull();
    }
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, radar(), '')).toBeNull();
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, radar(), '  ')).toBeNull();
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, null, 'image/jpeg')).toBeNull();
    // Another query of the same collection, as an EDR position query beside its map
    const both = { ...radar(), data_queries: { ...radar().data_queries, position: { link: { href: `${ROOT}/fmi-radar-composite-dbz/position`, rel: 'data' } } } } as unknown as Collection;
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/position?coords=POINT(25 62)`, both, 'image/jpeg')).toBeNull();
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, both, 'image/jpeg')).toBe('image/jpeg');
    // A collection the form sees without its map query has none
    expect(sentAccept(`${ROOT}/fmi-radar-composite-dbz/map`, { ...radar(), data_queries: {} } as Collection, 'image/jpeg')).toBeNull();
  });
});

describe('acceptAsked', () => {
  it('reads each media range, with its q, 1 where it is left out or can’t be read', () => {
    expect(acceptAsked(' image/jpeg ')).toEqual({ sent: 'image/jpeg', ranges: [{ type: 'image', subtype: 'jpeg', q: 1 }] });
    expect(acceptAsked('Image/WebP;q=0.9, image/*; level=1; q=0.5, */*;q=0.1')?.ranges).toEqual([
      { type: 'image', subtype: 'webp', q: 0.9 }, { type: 'image', subtype: '*', q: 0.5 }, { type: '*', subtype: '*', q: 0.1 },
    ]);
    expect(acceptAsked('image/png;q=0, image/jpeg;q=, image/gif;q=x, image/tiff;q=2, image/webp;q=-1')?.ranges.map(range => range.q)).toEqual([0, 1, 1, 1, 1]);
  });

  it('is none for no Accept, the app’s */*, or any that takes every format alike', () => {
    for (const accept of [undefined, null, '', '  ', '*/*', '*/*;q=0.8', '*/*, */*;q=0.5']) expect(acceptAsked(accept), String(accept)).toBeNull();
  });

  it('keeps one that asks for something, even what can’t be read, which takes no format', () => {
    expect(acceptAsked('*/*;q=0')?.ranges).toEqual([{ type: '*', subtype: '*', q: 0 }]);
    expect(acceptAsked('jpeg')).toEqual({ sent: 'jpeg', ranges: [] });
    expect(acceptAsked('image/png/x, image/jpeg')?.ranges).toEqual([{ type: 'image', subtype: 'jpeg', q: 1 }]);
  });
});

describe('acceptsType', () => {
  const takes = (accept: string, type: string) => acceptsType(acceptAsked(accept)?.ranges ?? [], type);

  it('takes a type a range names, by type/*, or by */*, in any letter case, whatever its parameters', () => {
    expect(takes('image/jpeg', 'image/jpeg')).toBe(true);
    expect(takes('image/jpeg', 'IMAGE/JPEG; charset=x')).toBe(true);
    expect(takes('image/*', 'image/png')).toBe(true);
    expect(takes('text/html, */*;q=0.1', 'image/png')).toBe(true);
    expect(takes('image/jpeg', 'image/png')).toBe(false);
    expect(takes('image/*', 'text/html')).toBe(false);
  });

  it('weighs a type by the most specific range that has it: q=0 there takes it out', () => {
    expect(takes('image/*, image/png;q=0', 'image/png')).toBe(false);
    expect(takes('image/*, image/png;q=0', 'image/jpeg')).toBe(true);
    expect(takes('image/*;q=0, image/png', 'image/png')).toBe(true);
    expect(takes('*/*, image/*;q=0', 'image/png')).toBe(false);
    expect(takes('*/*;q=0', 'image/png')).toBe(false);
    // The same range twice: the one that takes it
    expect(takes('image/png;q=0, image/png;q=0.5', 'image/png')).toBe(true);
  });

  it('takes no type that isn’t one: none, or one with no subtype', () => {
    expect(takes('*/*;q=0.5, image/png', '')).toBe(false);
    expect(takes('image/*', 'image')).toBe(false);
    expect(takes('jpeg', 'image/jpeg')).toBe(false);
  });
});
