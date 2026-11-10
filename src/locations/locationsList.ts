import { QueryResultValidator, type QueryResultValidation } from '../QueryResultValidator';
import { belongsToApi } from '../hooks/useCitedEdr';
import { detectEdrVersion, type DeclaredEdr } from '../standards';
import { locationsSchemaName, validateLocationsResponse } from '../validation/locationsValidator';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// A collection's or an instance's /locations: the list of them, not /locations/{id}, which is a location's data
export function isLocationsUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith('/locations');
  } catch {
    return false;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// A locations list: a GeoJSON FeatureCollection from a /locations URL, whatever its Content-Type says. Its JSON is read
// from the text where it hasn't been already, as for a Content-Type that doesn't say JSON. Null for anything else
export function locationsListOf(url: string, text: string | null, parsed: unknown = null): { json: Json; features: unknown[] } | null {
  if (!text || !isLocationsUrl(url)) return null;
  const json = parsed ?? parseJson(text);
  if (!isObject(json) || json.type !== 'FeatureCollection') return null;
  return { json, features: Array.isArray(json.features) ? json.features : [] };
}

// The EDR version a locations list is checked against: the one the loaded API declares, for a list from that API. With
// none declared, or for another API's, whose isn't known, EDR 1.1's, the version its findings are then cited against
export function locationsSchemaVersion(url: string, apiUrl: string, conformsTo: readonly string[] | null): DeclaredEdr {
  return (belongsToApi(url, apiUrl) ? detectEdrVersion(conformsTo) : null) ?? '1.1';
}

// A response's check: a locations list by the validator the app checks a collection's locations with, never as
// CoverageJSON, whatever its Content-Type says; anything else by the query result schemas
export async function validateQueryResponse(text: string, contentType: string, url: string, edrVersion: DeclaredEdr): Promise<QueryResultValidation> {
  const list = locationsListOf(url, text);
  if (!list) return QueryResultValidator.getInstance().validate(text, contentType, url);
  const { isValid, errors } = await validateLocationsResponse(list.json, edrVersion);
  return { matched: true, schemaName: locationsSchemaName(edrVersion), valid: isValid, errors };
}
