import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapsLinks, getStyleLinks, hasMapsSupport, resolveWebMercatorTileTemplates, tileTemplatesOf } from './maps';
import type { Collection } from '../types/api';
import fixture from '../query/__fixtures__/meteocore-map-layers.json';

// What each URL answers: a body, or a failure
const served = vi.hoisted(() => ({ bodies: {} as Record<string, unknown>, asked: [] as string[] }));
vi.mock('axios', () => ({
  default: {
    get: async (url: string) => {
      served.asked.push(url);
      if (!(url in served.bodies)) throw new Error(`404 ${url}`);
      return { data: served.bodies[url] };
    },
    isCancel: () => false,
  },
}));

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

const TILESETS = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map/tiles';
const XYZ = `${TILESETS}/WebMercatorQuad/{z}/{y}/{x}`;

describe('tileTemplatesOf', () => {
  it('reads MeteoCore’s templated item link, in OpenLayers’ placeholders, with its type', () => {
    expect(tileTemplatesOf(fixture.tilesets.tilesets[0].links)).toEqual([{ href: XYZ, type: 'image/png' }]);
  });

  it('reads Tiles’ tile relation too, each template, and no link that isn’t one', () => {
    const links = [
      { href: `${TILESETS}/WebMercatorQuad`, rel: 'item' },
      { href: `${TILESETS}/WebMercatorQuad/{tileMatrix}/{tileRow}/{tileCol}?f=jpeg`, rel: 'http://www.opengis.net/def/rel/ogc/1.0/tile', type: 'image/jpeg' },
      { href: `${TILESETS}/WebMercatorQuad/{z}/{y}/{x}`, rel: 'item' },
      { href: `${TILESETS}/WebMercatorQuad/{tileMatrix}/{tileRow}/{tileCol}`, rel: 'self' },
    ];
    expect(tileTemplatesOf(links)).toEqual([{ href: `${XYZ}?f=jpeg`, type: 'image/jpeg' }, { href: XYZ }]);
    expect(tileTemplatesOf(undefined)).toEqual([]);
  });
});

describe('resolveWebMercatorTileTemplates', () => {
  beforeEach(() => {
    served.bodies = {};
    served.asked = [];
  });

  it('takes the templates from the WebMercatorQuad entry of the tilesets list', async () => {
    served.bodies[TILESETS] = fixture.tilesets;
    expect(await resolveWebMercatorTileTemplates(TILESETS)).toEqual([{ href: XYZ, type: 'image/png' }]);
    expect(served.asked).toEqual([TILESETS]);
  });

  it('from the tileset’s own document where its entry has none, and none where there’s no WebMercatorQuad', async () => {
    const tileset = `${TILESETS}/WebMercatorQuad`;
    served.bodies[TILESETS] = { tilesets: [{ tileMatrixSetId: 'WorldCRS84Quad', links: [] }, { tileMatrixSetId: 'WebMercatorQuad', links: [{ href: tileset, rel: 'self' }] }] };
    served.bodies[tileset] = { links: fixture.tilesets.tilesets[0].links };
    expect(await resolveWebMercatorTileTemplates(TILESETS)).toEqual([{ href: XYZ, type: 'image/png' }]);
    served.bodies[TILESETS] = { tilesets: [{ tileMatrixSetId: 'WorldCRS84Quad', links: fixture.tilesets.tilesets[0].links }] };
    expect(await resolveWebMercatorTileTemplates(TILESETS)).toEqual([]);
    delete served.bodies[TILESETS];
    expect(await resolveWebMercatorTileTemplates(TILESETS)).toEqual([]);
  });
});
