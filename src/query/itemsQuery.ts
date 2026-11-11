// A Features or Records collection's items as a query like EDR's items query: its `items` link, and the formats its
// items links ask for by `f`. Pure: the collection stays as served, and the query builder reads this view of it.
import type { Collection } from '../types/api';
import { normalizeHref, pathSegment } from '../utils/href';

const views = new WeakMap<Collection, Collection>();
// The views made, to tell a Features or Records collection's items from EDR's own items query
const made = new WeakSet<Collection>();

// Whether a collection's items query is the one made from its items link, rather than one EDR's data_queries name
export const fromItemsLink = (collection: Collection): boolean => made.has(collection);

const withoutQuery = (href: string) => {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  return url.href;
};

// The collection with an `items` query where it has an items link and no query of that name: the link's href without
// what it asks for, and its formats from the items links' own `f`, in their order. The same object for the same
// collection, so that it can be compared and memoised. A collection with nothing to add is returned as it is.
export function withItemsQuery<C extends Collection | null>(collection: C): C {
  if (!collection || collection.data_queries?.items) return collection;
  const known = views.get(collection);
  if (known) return known as C;
  const links = (Array.isArray(collection.links) ? collection.links : []).filter(link => link?.rel === 'items');
  const hrefs = links.map(link => normalizeHref(link.href)).filter((href): href is string => !!href);
  // The one for GeoJSON first, as a list of items is GeoJSON
  const geoJson = links.find(link => link.type?.includes('geo+json'));
  const first = normalizeHref(geoJson?.href) ?? hrefs[0];
  if (!first) return collection;
  let href: string;
  try {
    href = withoutQuery(first);
  } catch {
    return collection;
  }
  const formats = [...new Set(hrefs.flatMap(each => {
    try {
      const f = new URL(each).searchParams.get('f');
      return f ? [f] : [];
    } catch {
      return [];
    }
  }))];
  const view = {
    ...collection,
    data_queries: {
      ...collection.data_queries,
      items: { link: { href, rel: 'items', type: geoJson?.type, variables: { query_type: 'items', ...(formats.length ? { output_formats: formats } : {}) } } },
    },
  } as Collection;
  views.set(collection, view);
  made.add(view);
  return view as C;
}

// An items query's href for one item, a path segment below it, or the list for none
export function itemHref(itemsHref: string, item: string): string {
  if (!item) return itemsHref;
  try {
    const url = new URL(itemsHref);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${pathSegment(item)}`;
    return url.href;
  } catch {
    return itemsHref;
  }
}
