import type { Collection, ValidationResult } from '../types/api';
import { normalizeBbox } from '../utils/extents/bbox';
import { normalizeHref } from '../utils/href';
import { wholeValue } from '../query/dimensionText';
import { allSectionsValid, isProblem } from '../validation/severity';

// What opening a collection works out, apart from the state it goes into

// The one before or after in the API's list, if there is one. With none open, the next one is the first. By the
// collection itself, since two can share an ID.
export function adjacentCollection(collections: Collection[], open: Collection | null, step: -1 | 1): Collection | null {
  const index = open ? collections.indexOf(open) : -1;
  return collections[index + step] ?? null;
}

// A collection's GeoJSON links as map layers, at the time chosen if it has a time at all and it's whole (a range still
// missing an end isn't). Without a bbox, which OpenLayers adds as the view moves.
export function geoJsonLinksOf(collection: Collection, datetime = ''): { url: string; title: string }[] {
  if (!Array.isArray(collection?.links)) return [];
  const temporal = collection.extent?.temporal;
  const hasTime = !!temporal && !!(temporal.interval || temporal.values);
  const time = hasTime ? wholeValue(datetime) : '';

  return collection.links.flatMap(link => {
    if (link.type !== 'application/geo+json') return [];
    const href = normalizeHref(link.href);
    if (!href) return [];
    const url = time ? `${href}${href.includes('?') ? '&' : '?'}datetime=${time}` : href;
    return [{ url, title: link.title || link.rel || 'GeoJSON Layer' }];
  });
}

// The collection's own URL, which is the request while no query is chosen. Not one of its data links:
// servers link each of its queries as data (MeteoCore's and Polytope's first is /position, FMI's /area),
// and a query nobody chose isn't the request. The service URL's own trailing slash would double the one here.
export function collectionUrlOf(collection: Collection, apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/collections/${encodeURIComponent(String(collection.id))}`;
}

export function extentsOf(collection: Collection): [number, number, number, number][] | null {
  const bbox = collection.extent?.spatial?.bbox;
  // Having no box isn't worth the warning normalizeBbox gives
  return Array.isArray(bbox) && bbox.length > 0 ? normalizeBbox(bbox) : null;
}

const isLocationsError = (error: { section?: string }) => error.section === 'Locations';

// A result without what was found about a collection's locations, once that's no longer the one open
export function withoutLocationsValidation(result: ValidationResult): ValidationResult {
  if (!result.locationsValidation && !result.errors?.some(isLocationsError)) return result;
  const errors = (result.errors || []).filter(error => !isLocationsError(error));
  const { locationsValidation: _, ...rest } = result;
  return {
    ...rest,
    errors: errors.length > 0 ? errors : null,
    // Notes, such as the API definition's, don't make the service invalid
    isValid: allSectionsValid(rest) && !errors.some(isProblem),
  };
}

export function withLocationsValidation(
  result: ValidationResult,
  validation: { isValid: boolean; errors: NonNullable<ValidationResult['errors']> },
  // The schema's name, as it was checked against
  schemaName: string,
): ValidationResult {
  const errors = [...(result.errors || []).filter(error => !isLocationsError(error)), ...validation.errors];
  return {
    ...result,
    locationsValidation: {
      isValid: validation.isValid,
      errors: validation.errors.length > 0 ? validation.errors : null,
      schemaResults: [{ schema: schemaName, isValid: validation.isValid }],
    },
    errors: errors.length > 0 ? errors : null,
    isValid: result.isValid && validation.isValid,
  };
}
