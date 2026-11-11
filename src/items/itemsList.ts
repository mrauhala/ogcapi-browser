// A collection's items as sent, for the response pane's Data tab: the list, a GeoJSON FeatureCollection from an items
// URL, or one item, a Feature from an item's URL below it. Features, Records and EDR's items query alike.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ItemsAnswer {
  features: unknown[];
  one: boolean; // one item, by its path, rather than a list
  // As the answer gives them, null where it doesn't
  numberMatched: number | null;
  numberReturned: number | null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const countOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// The path's last two segments: …/items for the list, …/items/{id} for one
function itemsPath(url: string): 'list' | 'one' | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'items') return 'list';
    if (segments[segments.length - 2] === 'items') return 'one';
    return null;
  } catch {
    return null;
  }
}

// The items in an answer, whatever its Content-Type says, its JSON read from the text where it hasn't been already. Null
// for anything else, as an HTML page or an error
export function itemsOf(url: string, text: string | null, parsed: unknown = null): ItemsAnswer | null {
  const path = text ? itemsPath(url) : null;
  if (!path) return null;
  const json = parsed ?? parseJson(text!);
  if (!isObject(json)) return null;
  if (path === 'list' && json.type === 'FeatureCollection') {
    return {
      features: Array.isArray(json.features) ? json.features : [],
      one: false,
      numberMatched: countOf(json.numberMatched),
      numberReturned: countOf(json.numberReturned),
    };
  }
  if (path === 'one' && json.type === 'Feature') return { features: [json], one: true, numberMatched: null, numberReturned: null };
  return null;
}
