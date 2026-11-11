import type { Collection, QueryVariables } from '../types/api';
import { normalizeHref } from '../utils/href';
import { TYPE_PARAMS } from './buildQueryUrl';
import { EDR_QUERY_RULES, type EdrQueryRule } from './edrRules';
import { itemHref } from './itemsQuery';
import { queryTypeOf } from './queryTypes';
import type { BBox } from './types';

// The parts of a selected location feature that address it
export interface LocationFeature {
  id?: string | number;
  properties?: { href?: string } | null;
}

// Everything the query builder and the map have chosen for a data query. The same model drives
// both the request URL and its validation, so the two can't disagree.
export interface QueryModelInput {
  collection: Collection;
  queryKey: string; // key in collection.data_queries
  format: string;
  parameters: string[];
  // As sent: one value, a list, an interval or a repeating interval, '' for none. See dimensionText.ts
  datetime: string;
  vertical: string;
  customDims: Record<string, string>;
  points: [number, number][]; // map clicks: position/radius points, trajectory vertices
  polygons: [number, number][][]; // drawn areas
  bbox: BBox | null; // the box drawn or typed for cube queries: west, south, east, north (lon/lat)
  bboxAsCoords: boolean; // also send the box as a coords polygon, for servers whose API docs require it
  radius: { value: number | null; units: string }; // null and '' until chosen
  queryParams: Record<string, string>; // parameters of the query type, e.g. corridor-width; empty ones aren't sent
  locationFeature: LocationFeature | null; // selected location feature, for locations queries
  itemId?: string; // one item of an items query, a part of its path: '' or left out for the list
}

export interface QueryModel extends QueryModelInput {
  queryType: string;
  rule?: EdrQueryRule;
  variables?: QueryVariables;
  baseHref: string | null;
}

export function buildQueryModel(input: QueryModelInput): QueryModel | null {
  const query = input.queryKey ? input.collection.data_queries?.[input.queryKey] : undefined;
  if (!query) return null;
  const queryType = queryTypeOf(input.collection, input.queryKey);
  const baseHref = normalizeHref(query.link?.href);
  const model = {
    ...input,
    queryType,
    rule: EDR_QUERY_RULES[queryType],
    variables: query.link?.variables,
    baseHref,
  };
  if (queryType !== 'items' || !input.itemId || !baseHref) return model;
  // One item: its path, and of the list's choices only f. The form keeps the rest for going back to the list
  const listOnly = new Set(TYPE_PARAMS.items);
  return {
    ...model,
    baseHref: itemHref(baseHref, input.itemId),
    datetime: '',
    bbox: null,
    queryParams: Object.fromEntries(Object.entries(input.queryParams).filter(([name]) => !listOnly.has(name))),
  };
}

// The time selects a query's data, but only filters a list: items, or a locations query with no
// location picked. A list is complete without one, so it takes a time only if asked to.
export function timeIsOnlyAFilter(queryType: string, hasLocation: boolean): boolean {
  return !!EDR_QUERY_RULES[queryType]?.featureList || (queryType === 'locations' && !hasLocation);
}
