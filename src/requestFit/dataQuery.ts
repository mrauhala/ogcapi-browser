import { paramOf } from '../query/requestUrl';

// What a request asked of a data query, for checking its response against: which query it is, by the path EDR gives
// each (/collections/{id}/position, or an instance's, /collections/{id}/instances/{instanceId}/position), and the
// parameters it names. A locations query is for data with a location's id, and for a list of locations without one,
// which is checked as a list

const DATA_QUERIES = new Set(['position', 'radius', 'area', 'cube', 'trajectory', 'corridor', 'locations']);
const PATH = /\/collections\/[^/]+(\/instances\/[^/]+)?\/([^/]+)(\/[^/]+)?$/;

export interface DataQuery {
  type: string;
  // Of an instance, whose parameters may not be the collection's
  instance: boolean;
}

export function dataQueryOf(url: string): DataQuery | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
  const match = PATH.exec(path);
  if (!match || !DATA_QUERIES.has(match[2])) return null;
  const [, instance, type, below] = match;
  // A location's id is the one thing below a query, and a list of locations has none
  if ((type === 'locations') !== Boolean(below)) return null;
  return { type, instance: Boolean(instance) };
}

// The parameters a request names, EDR's "comma delimited string", each once, or null where it names none. An empty
// parameter-name is neither, so it's an empty list
export function askedParameters(url: string): string[] | null {
  const value = paramOf(url, 'parameter-name');
  if (value === null) return null;
  return [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
}
