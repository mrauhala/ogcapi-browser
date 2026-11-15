import axios from 'axios';
import type { AuthCredentials, Collection, Link } from '../types/api';
import { OGC_REL } from '../types/api';
import { normalizeHref } from '../utils/href';
import { getAxiosConfig, addApiKeyToUrl } from './auth';

export interface MapsLinks {
  mapLink?: Link;
  tilesetsLink?: Link;
  stylesLink?: Link;
}

export interface StyleEntry {
  id: string;
  title?: string;
  description?: string;
  links?: Link[];
}

export interface StylesDocument {
  styles: StyleEntry[];
  links?: Link[];
}

export interface TilesetSummary {
  tileMatrixSetId?: string;
  tileMatrixSetURI?: string;
  links?: Link[];
}

export interface TilesetListDocument {
  tilesets: TilesetSummary[];
  links?: Link[];
}

export interface TilesetDocument {
  tileMatrixSetURI?: string;
  tileMatrixSetId?: string;
  links?: Link[];
}

function matchesRel(link: Link, rels: readonly string[]): boolean {
  return !!link.rel && rels.includes(link.rel);
}

export function getMapsLinks(collection: Collection): MapsLinks {
  if (!collection?.links || !Array.isArray(collection.links)) return {};
  const out: MapsLinks = {};
  for (const link of collection.links) {
    if (!out.mapLink && matchesRel(link, OGC_REL.map)) out.mapLink = link;
    else if (!out.tilesetsLink && matchesRel(link, OGC_REL.tilesetsMap)) out.tilesetsLink = link;
    else if (!out.stylesLink && matchesRel(link, OGC_REL.styles)) out.stylesLink = link;
  }
  return out;
}

export function hasMapsSupport(collection: Collection): boolean {
  const links = getMapsLinks(collection);
  return !!(links.mapLink || links.tilesetsLink);
}

// Pick a style entry's links by rel — used to find that style's map/tilesets endpoint.
export function getStyleLinks(style: StyleEntry): MapsLinks {
  const out: MapsLinks = {};
  if (!style.links) return out;
  for (const link of style.links) {
    if (!out.mapLink && matchesRel(link, OGC_REL.map)) out.mapLink = link;
    else if (!out.tilesetsLink && matchesRel(link, OGC_REL.tilesetsMap)) out.tilesetsLink = link;
  }
  return out;
}

export async function fetchStyles(stylesUrl: string, auth?: AuthCredentials, signal?: AbortSignal): Promise<StylesDocument | null> {
  try {
    const finalUrl = addApiKeyToUrl(stylesUrl, auth);
    const response = await axios.get(finalUrl, { ...getAxiosConfig(auth, signal), responseType: 'json' });
    const data = response.data;
    if (data && Array.isArray(data.styles)) return data as StylesDocument;
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Error fetching styles document:', error);
    return null;
  }
}

export async function fetchTilesetsList(url: string, auth?: AuthCredentials, signal?: AbortSignal): Promise<TilesetListDocument | null> {
  try {
    const finalUrl = addApiKeyToUrl(url, auth);
    const response = await axios.get(finalUrl, { ...getAxiosConfig(auth, signal), responseType: 'json' });
    const data = response.data;
    if (data && Array.isArray(data.tilesets)) return data as TilesetListDocument;
    return null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Error fetching tilesets list:', error);
    return null;
  }
}

export async function fetchTileset(url: string, auth?: AuthCredentials, signal?: AbortSignal): Promise<TilesetDocument | null> {
  try {
    const finalUrl = addApiKeyToUrl(url, auth);
    const response = await axios.get(finalUrl, { ...getAxiosConfig(auth, signal), responseType: 'json' });
    return response.data ?? null;
  } catch (error) {
    if (axios.isCancel(error)) return null;
    console.error('Error fetching tileset metadata:', error);
    return null;
  }
}

// WebMercatorQuad is the Web Mercator tile-matrix-set we can render directly via ol/source/XYZ.
const WEB_MERCATOR_QUAD_URIS = new Set<string>([
  'http://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad',
  'https://www.opengis.net/def/tilematrixset/OGC/1.0/WebMercatorQuad',
]);

export function isWebMercatorQuad(uriOrId?: string): boolean {
  if (!uriOrId) return false;
  if (WEB_MERCATOR_QUAD_URIS.has(uriOrId)) return true;
  return uriOrId === 'WebMercatorQuad';
}

// A tile URL template, with {z}, {y} and {x}, and its media type where the link gives one
export interface TileTemplate {
  href: string;
  type?: string;
}

// The tile URL templates of a link list: Tiles' "tile" relation, or `item` as MeteoCore's list has them, with
// {tileMatrix}, {tileRow} and {tileCol} as OpenLayers' XYZ writes them, {z}, {y} and {x}, each with its type
export function tileTemplatesOf(links?: Link[]): TileTemplate[] {
  return (links ?? []).flatMap(link => {
    if (link.rel !== 'item' && link.rel !== 'http://www.opengis.net/def/rel/ogc/1.0/tile') return [];
    const href = normalizeHref(link.href);
    if (!href || !(href.includes('{tileMatrix}') || href.includes('{z}'))) return [];
    const xyz = href.replace('{tileMatrix}', '{z}').replace('{tileRow}', '{y}').replace('{tileCol}', '{x}');
    return [{ href: xyz, ...(link.type ? { type: link.type } : {}) }];
  });
}

// The tile URL templates of a tilesets list's WebMercatorQuad tileset: on its entry in the list, else in the tileset's
// own document. Empty where there's none
export async function resolveWebMercatorTileTemplates(tilesetsUrl: string, auth?: AuthCredentials, signal?: AbortSignal): Promise<TileTemplate[]> {
  const list = await fetchTilesetsList(tilesetsUrl, auth, signal);
  const wmq = list?.tilesets.find(t => isWebMercatorQuad(t.tileMatrixSetURI) || isWebMercatorQuad(t.tileMatrixSetId));
  if (!wmq) return [];
  const templates = tileTemplatesOf(wmq.links);
  if (templates.length) return templates;
  const metaUrl = normalizeHref(wmq.links?.find(l => l.rel === 'self' || l.rel === 'item')?.href);
  return metaUrl ? tileTemplatesOf((await fetchTileset(metaUrl, auth, signal))?.links) : [];
}
