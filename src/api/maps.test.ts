import { describe, expect, it } from 'vitest';
import { getMapsLinks, getStyleLinks, hasMapsSupport } from './maps';
import type { Collection } from '../types/api';

const BASE = 'https://meteocore.app.meteo.fi/collections/one';
const collectionWith = (rels: Record<string, string>) =>
  ({ id: 'one', links: Object.entries(rels).map(([path, rel]) => ({ href: `${BASE}/${path}`, rel })) }) as unknown as Collection;

describe('getMapsLinks', () => {
  it('reads each form of the Maps links’ rels: http as OGC-NA names them, https as Maps 1.0 writes them, a safe CURIE, the bare name', () => {
    for (const form of [(name: string) => `http://www.opengis.net/def/rel/ogc/1.0/${name}`, (name: string) => `https://www.opengis.net/def/rel/ogc/1.0/${name}`,
      (name: string) => `[ogc-rel:${name}]`, (name: string) => name]) {
      const links = getMapsLinks(collectionWith({ map: form('map'), 'map/tiles': form('tilesets-map'), styles: form('styles') }));
      expect(links.mapLink?.href).toBe(`${BASE}/map`);
      expect(links.tilesetsLink?.href).toBe(`${BASE}/map/tiles`);
      expect(links.stylesLink?.href).toBe(`${BASE}/styles`);
    }
  });

  it('reads no other rel as one', () => {
    const links = getMapsLinks(collectionWith({ map: 'ogc-rel:map', 'map/tiles': 'https://www.opengis.net/def/rel/ogc/1.0/tilesets-vector', styles: 'stylesheet' }));
    expect(links).toEqual({});
    expect(hasMapsSupport(collectionWith({ map: 'https://www.opengis.net/def/rel/ogc/1.0/map' }))).toBe(true);
  });

  it('reads a style’s own map link by any of the forms', () => {
    expect(getStyleLinks({ id: 'night', links: [{ href: `${BASE}/styles/night/map`, rel: 'https://www.opengis.net/def/rel/ogc/1.0/map' }] }).mapLink?.href)
      .toBe(`${BASE}/styles/night/map`);
  });
});
