// The Accept header a request is sent with, which the request line can't show: the one the form holds for a map
// request, where the line is a map request of the collection the form is on. Anything else goes with the app's own,
// */*. Pure.
import type { Collection } from '../types/api';
import { matchDataQuery } from './parseQueryUrl';
import { queryTypeOf } from './queryTypes';

export function sentAccept(url: string, collection: Collection | null | undefined, accept: string): string | null {
  const value = accept.trim();
  if (!value || !collection) return null;
  const target = matchDataQuery(url, collection);
  return target && queryTypeOf(collection, target.queryKey) === 'map' ? value : null;
}
