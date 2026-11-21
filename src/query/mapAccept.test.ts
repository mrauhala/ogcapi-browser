import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { withLinkQueries } from './mapQuery';
import { sentAccept } from './mapAccept';
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
