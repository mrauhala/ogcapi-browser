// A collection's map, from OGC API Maps, as a query like EDR's: its `map` link, with a style as a part of the path.
// Pure: the collection stays as served, and the query builder reads this view of it, as it reads the items link's.
import type { Collection } from '../types/api';
import { getMapsLinks, getStyleLinks, type StyleEntry } from '../api/maps';
import { normalizeHref, pathSegment } from '../utils/href';
import { withItemsQuery } from './itemsQuery';

const views = new WeakMap<Collection, Collection>();
// The queries made, to tell a map made from the map link from a query an EDR server names `map`
const made = new WeakSet<object>();

// Whether a collection's map query is the one made from its map link
export const fromMapLink = (collection: Collection): boolean => {
  const query = collection.data_queries?.map;
  return !!query && made.has(query);
};

// The collection with a `map` query where it has a map link and no query of that name. Its href is the link's as the
// server gives it, what it asks for included: a server's link is what's tested. The same object for the same collection,
// so that it can be compared and memoised. A collection with nothing to add is returned as it is.
export function withMapQuery<C extends Collection | null>(collection: C): C {
  if (!collection || collection.data_queries?.map) return collection;
  const known = views.get(collection);
  if (known) return known as C;
  const { mapLink } = getMapsLinks(collection);
  const href = normalizeHref(mapLink?.href);
  if (!mapLink || !href) return collection;
  try {
    new URL(href);
  } catch {
    return collection;
  }
  const view = {
    ...collection,
    data_queries: {
      ...collection.data_queries,
      map: { link: { href, rel: mapLink.rel, type: mapLink.type, variables: { query_type: 'map' } } },
    },
  } as Collection;
  views.set(collection, view);
  made.add(view.data_queries.map);
  return view as C;
}

// The queries a collection's links make: its items and its map, beside any its data_queries name
export const withLinkQueries = <C extends Collection | null>(collection: C): C => withMapQuery(withItemsQuery(collection));

// Where a collection's styled maps are, from its map: …/collections/{collectionId} before /map. A map link that doesn't
// end in /map has them beside it
function collectionPathOf(mapPath: string): string {
  const path = mapPath.replace(/\/+$/, '');
  return path.endsWith('/map') ? path.slice(0, -'/map'.length) : path.slice(0, path.lastIndexOf('/'));
}

// A style's map by the path Maps gives it, /req/styled-map/map-operation A: "…/styles/{styleId}/map". For a style
// without a map link of its own, or one a typed URL names
export function styleMapHref(mapHref: string, styleId: string): string {
  try {
    const url = new URL(mapHref);
    url.pathname = `${collectionPathOf(url.pathname)}/styles/${pathSegment(styleId)}/map`;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return mapHref;
  }
}

// The style a map URL's path names, given the path of the collection's map, both with their origin and decoded:
// …/styles/{styleId}/map. Null for another path
export function styleOfPath(path: string, mapPath: string): string | null {
  const prefix = `${collectionPathOf(mapPath)}/styles/`;
  if (!path.startsWith(prefix) || !path.endsWith('/map')) return null;
  const id = path.slice(prefix.length, -'/map'.length);
  return id && !id.includes('/') ? id : null;
}

// A style as the form offers it: its id, as the path has it, its title, and its own map link
export interface MapStyle {
  id: string;
  title?: string;
  href: string | null; // the style's map link, as the server gives it, what it asks for included
  parameters: string[]; // the parameters the style is for, where the server says (MeteoCore's `parameters`)
}

// The styles of a styles document's `styles`, or of a collection's own `styles` array: those with an id, in their order
export function mapStylesOf(styles: unknown): MapStyle[] {
  if (!Array.isArray(styles)) return [];
  return styles.flatMap((style: StyleEntry & { parameters?: unknown }) => {
    if (!style || typeof style !== 'object' || (typeof style.id !== 'string' && typeof style.id !== 'number')) return [];
    const id = String(style.id).trim();
    if (!id) return [];
    const parameters = Array.isArray(style.parameters) ? style.parameters.filter((each): each is string => typeof each === 'string') : [];
    return [{
      id,
      title: typeof style.title === 'string' && style.title.trim() ? style.title.trim() : undefined,
      href: normalizeHref(getStyleLinks(style).mapLink?.href),
      parameters,
    }];
  });
}

// What a link's href asks for besides its path, as name=value pairs: MeteoCore's `parameter-name=gh` on a style's map
export function linkQuery(href: string | null): string[] {
  if (!href) return [];
  try {
    return [...new URL(href).searchParams].map(([name, value]) => `${name}=${value}`);
  } catch {
    return [];
  }
}
