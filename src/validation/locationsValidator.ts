import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { EDR11, EDR12, type DeclaredEdr } from '../standards';
import type { Rule, ValidationError } from '../types/api';
import { condenseAjvErrors, groupArrayItemErrors } from './ajvErrors';
import { publicUrl } from '../utils/publicUrl';

// Which EDR a server declares is decided with the citations that rest on it, by detectEdrVersion in standards.ts
type EdrVersion = DeclaredEdr;

const SCHEMA_PATHS: Record<EdrVersion, string> = {
  '1.0': '/schemas/edr/1.0/edrFeatureCollectionGeoJSON.json',
  '1.1': '/schemas/edr/1.1/edrFeatureCollectionGeoJSON.json',
  '1.2': '/schemas/edr/1.2/edrFeatureCollectionGeoJSON.json',
};

const ajv = new Ajv({ allErrors: true, verbose: true, strict: false, validateFormats: true });
addFormats(ajv);

const compiledValidators = new Map<EdrVersion, ValidateFunction>();

// The name a locations schema is shown under
export const locationsSchemaName = (edrVersion: EdrVersion) => `EDR ${edrVersion} Locations`;

// /req/edr-geojson/content A: "Every 200-response with the media type application/geo+json SHALL be an EDR GeoJSON
// FeatureCollection Object for features". EDR 1.0's text isn't cited, so its schema's findings cite 1.1's
const locationsRuleOf = (edrVersion: EdrVersion): Rule => (edrVersion === '1.2' ? EDR12.edrGeojsonContent : EDR11.edrGeojsonContent);

// The rule a locations schema's findings rest on, by the name it's shown under; none for another schema's name
export function locationsSchemaRuleOf(schemaName: string | null | undefined): Rule | undefined {
  const version = (Object.keys(SCHEMA_PATHS) as EdrVersion[]).find(each => locationsSchemaName(each) === schemaName);
  return version && locationsRuleOf(version);
}

async function getValidator(version: EdrVersion): Promise<ValidateFunction | null> {
  const cached = compiledValidators.get(version);
  if (cached) return cached;

  try {
    const response = await fetch(publicUrl(SCHEMA_PATHS[version]));
    if (!response.ok) return null;
    const schema = await response.json();
    const validator = ajv.compile(schema);
    compiledValidators.set(version, validator);
    return validator;
  } catch (error) {
    console.error(`Error loading EDR ${version} locations schema:`, error);
    return null;
  }
}

/**
 * Validate a locations response (parsed GeoJSON object) against the EDR schema.
 */
export async function validateLocationsResponse(
  data: unknown,
  edrVersion: EdrVersion
): Promise<{ isValid: boolean; errors: ValidationError[] }> {
  const displayName = locationsSchemaName(edrVersion);
  const rule = locationsRuleOf(edrVersion);

  const validator = await getValidator(edrVersion);
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
