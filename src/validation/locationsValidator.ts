import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { EDR, EDR11, EDR12, type DeclaredEdr } from '../standards';
import type { Citation, ValidationError } from '../types/api';
import { condenseAjvErrors, groupArrayItemErrors } from './ajvErrors';
import { publicUrl } from '../utils/publicUrl';

// Which EDR a server declares is decided with the citations that rest on it, by detectEdrVersion in standards.ts
type EdrVersion = DeclaredEdr;

const EDR_GEOJSON_PATHS: Record<EdrVersion, string> = {
  '1.0': '/schemas/edr/1.0/edrFeatureCollectionGeoJSON.json',
  '1.1': '/schemas/edr/1.1/edrFeatureCollectionGeoJSON.json',
  '1.2': '/schemas/edr/1.2/edrFeatureCollectionGeoJSON.json',
};
// OGC API Features Part 1's: EDR's own GeoJSON feature takes its properties from EDR GeoJSON
const GEOJSON_PATH = '/schemas/geojson/featureCollectionGeoJSON.json';

const ajv = new Ajv({ allErrors: true, verbose: true, strict: false, validateFormats: true });
addFormats(ajv);

const compiledValidators = new Map<string, ValidateFunction>();

// What a locations list is checked against. EDR's GeoJSON class asks only for a GeoJSON FeatureCollection, its
// /req/geojson/content A: "Every 200-response with the media type application/geo+json SHALL be a GeoJSON
// FeatureCollection Object for features". Its EDR GeoJSON class adds EDR's properties (label, parameter-name,
// edrqueryendpoint), /req/edr-geojson/content A: "… SHALL be an EDR GeoJSON FeatureCollection Object for features". No
// statement asks a locations list to be EDR GeoJSON of an API that doesn't declare that class
export type LocationsSchema =
  | { kind: 'edr-geojson'; version: EdrVersion; name: string }
  | { kind: 'geojson'; name: string };

const GEOJSON_NAME = 'GeoJSON FeatureCollection';
const edrGeojsonName = (version: EdrVersion) => `EDR ${version} Locations`;

// Whether the API declares one of that EDR version's classes, by its path, as detectEdrVersion finds the version
const declares = (conformsTo: readonly string[] | null | undefined, version: EdrVersion, conformanceClass: string) =>
  conformsTo?.some(url => url.endsWith(`/spec/ogcapi-edr-1/${version}/conf/${conformanceClass}`)) ?? false;

// The EDR GeoJSON schema of the version the API declares, if it declares that version's EDR GeoJSON class; GeoJSON's
// FeatureCollection otherwise, saying why. Nothing is known of what another API than the loaded one declares
export function locationsSchemaFor(conformsTo: readonly string[] | null | undefined, version: EdrVersion | null, elsewhere = false): LocationsSchema {
  if (!elsewhere && version && declares(conformsTo, version, 'edr-geojson')) return { kind: 'edr-geojson', version, name: edrGeojsonName(version) };
  const why = elsewhere ? 'not the loaded API’s, so what it declares isn’t known'
    : !version ? 'the API declares no EDR version'
      : declares(conformsTo, version, 'geojson') ? 'the API declares GeoJSON, not EDR GeoJSON'
        : 'the API declares neither GeoJSON nor EDR GeoJSON';
  return { kind: 'geojson', name: `${GEOJSON_NAME} (${why})` };
}

// Whether a list was checked as EDR GeoJSON, by the name its schema is shown under
export const isEdrGeojsonSchema = (schemaName: string | null | undefined) =>
  (Object.keys(EDR_GEOJSON_PATHS) as EdrVersion[]).some(version => edrGeojsonName(version) === schemaName);

// EDR 1.0's text isn't cited, so its schema's findings cite 1.1's. GeoJSON's are cited in the version the API declares
function ruleOf(schema: LocationsSchema): Citation {
  if (schema.kind === 'geojson') return EDR.geojsonContent;
  return schema.version === '1.2' ? EDR12.edrGeojsonContent : EDR11.edrGeojsonContent;
}

// The rule a locations schema's findings rest on, by the name it's shown under; none for another schema's name
export function locationsSchemaRuleOf(schemaName: string | null | undefined): Citation | undefined {
  if (schemaName?.startsWith(`${GEOJSON_NAME} (`)) return EDR.geojsonContent;
  const version = (Object.keys(EDR_GEOJSON_PATHS) as EdrVersion[]).find(each => edrGeojsonName(each) === schemaName);
  return version && ruleOf({ kind: 'edr-geojson', version, name: edrGeojsonName(version) });
}

async function getValidator(schema: LocationsSchema): Promise<ValidateFunction | null> {
  const path = schema.kind === 'geojson' ? GEOJSON_PATH : EDR_GEOJSON_PATHS[schema.version];
  const cached = compiledValidators.get(path);
  if (cached) return cached;

  try {
    const response = await fetch(publicUrl(path));
    if (!response.ok) return null;
    const validator = ajv.compile(await response.json());
    compiledValidators.set(path, validator);
    return validator;
  } catch (error) {
    console.error(`Error loading the locations schema ${path}:`, error);
    return null;
  }
}

/**
 * Validate a locations response (parsed GeoJSON object) against the schema its API's classes call for.
 */
export async function validateLocationsResponse(
  data: unknown,
  schema: LocationsSchema,
): Promise<{ isValid: boolean; errors: ValidationError[] }> {
  const displayName = schema.name;
  const rule = ruleOf(schema);

  const validator = await getValidator(schema);
  if (!validator) {
    return {
      isValid: false,
      errors: [{ message: `Failed to load schema: ${displayName}`, type: 'schema', section: 'Locations' }],
    };
  }

  const isValid = validator(data) as boolean;

  if (isValid) {
    console.log(`✅ ${displayName}: Valid`);
    return { isValid: true, errors: [] };
  }

  // One error per kind, with how many features have it: a large locations response would otherwise
  // give one error per feature and property (91,888 for a Meteogate collection)
  const features = (data as { features?: unknown } | null)?.features;
  const featureCount = Array.isArray(features) ? features.length : undefined;
  const groups = groupArrayItemErrors(condenseAjvErrors(validator.errors || [], Infinity));
  const errors: ValidationError[] = groups.map(({ error, genericPath, array, count }) => ({
    message: count > 1
      ? `${genericPath}: ${error.message} (${count.toLocaleString('en')}${array === 'features' && featureCount ? ` of ${featureCount.toLocaleString('en')}` : ''} ${array})`
      : `${error.instancePath || ''}: ${error.message}`,
    path: error.instancePath || 'root',
    keyword: error.keyword,
    schema: displayName,
    section: 'Locations',
    type: 'schema' as const,
    rule,
  }));

  console.warn(`❌ ${displayName}: ${validator.errors?.length ?? 0} validation error(s) in ${errors.length} group(s)`);
  return { isValid: false, errors };
}
