import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { ValidationError } from '../../types/api';
import { ajvErrorToValidationError, condenseAjvErrors } from '../ajvErrors';
import { appFault } from '../severity';
import { publicUrl } from '../../utils/publicUrl';
import { resolvePointer, unescapePointerSegment } from './refs';
import { COMMON1, EDR } from '../../standards';

export type OasVersion = '3.0' | '3.1';

// Loads the official OpenAPI schema for a version. The app serves them from /schemas/openapi;
// scripts/download-schemas.js writes them, adapted for AJV (see docs/schemas.md).
export type OasSchemaLoader = (version: OasVersion) => Promise<object>;

const fetchSchema: OasSchemaLoader = async version => {
  const response = await fetch(publicUrl(`/schemas/openapi/${version}/schema.json`));
  if (!response.ok) throw new Error(`OpenAPI ${version} schema not available (${response.status})`);
  return response.json();
};

const validators = new Map<OasVersion, Promise<ValidateFunction>>();

async function compile(version: OasVersion, loadSchema: OasSchemaLoader): Promise<ValidateFunction> {
  const schema = await loadSchema(version);
  if (version === '3.1') {
    // The 2020-12 draft only ships with 3.1 documents: load it on demand (ajv itself is in the main bundle)
    const { default: Ajv2020 } = await import('ajv/dist/2020');
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addFormat('media-range', true); // used by the 3.1 schema, not in ajv-formats
    return ajv.compile(schema);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export function oasVersionOf(doc: Record<string, unknown>): OasVersion | null {
  const version = typeof doc.openapi === 'string' ? doc.openapi : '';
  if (version.startsWith('3.0')) return '3.0';
  if (version.startsWith('3.1')) return '3.1';
  return null;
}

// What a document's structure rests on: EDR's and Common's OpenAPI 3.0 classes, "The JSON representation SHALL conform
// to the OpenAPI Specification, version 3.0", and EDR 1.2's 3.1 class, "… SHALL conform to the OpenAPI Specification
// 3.1." EDR 1.1 has no 3.1 class, so it cites none for 3.1
const RULES: Record<OasVersion, ValidationError['rule']> = {
  '3.0': [EDR.oas30Definition, COMMON1.oas30Definition],
  '3.1': EDR.oas31Definition,
};

const MAX_ERRORS = 200;
const MAX_NAMES = 6;

// The same problem in many places is reported once: Meteogate's climate observations have 153
// parameters without a schema. Says how many and which (by name when they have one), and keeps the
// first one's path to navigate to.
function summarizeRepeated(errors: ErrorObject[], doc: unknown, schemaName: string, rule: ValidationError['rule']): ValidationError[] {
  const groups = new Map<string, { kind: string; errors: ErrorObject[] }>();
  for (const error of errors) {
    // What the error is about: 'parameters' for /paths/~1a/get/parameters/0
    const kind = unescapePointerSegment(error.instancePath.replace(/\/\d+$/, '').split('/').pop() ?? '');
    const key = `${error.keyword}\u0000${error.message}\u0000${kind}`;
    if (!groups.has(key)) groups.set(key, { kind, errors: [] });
    groups.get(key)!.errors.push(error);
  }
  return [...groups.values()].map(({ kind, errors: group }) => {
    const [first] = group;
    const extra = { section: 'OpenAPI', schema: schemaName, severity: 'error' as const, rule };
    if (group.length === 1) return ajvErrorToValidationError(first, extra);
    const names = [...new Set(group
      .map(error => (resolvePointer(doc, error.instancePath) as { name?: unknown } | undefined)?.name)
      .filter((name): name is string => typeof name === 'string'))];
    const which = names.length > 0 ? ` (${names.slice(0, MAX_NAMES).join(', ')}${names.length > MAX_NAMES ? ', …' : ''})` : '';
    return {
      ...ajvErrorToValidationError(first, extra),
      message: `${group.length} ${kind}${which}: ${first.message}`,
    };
  });
}

// What's said when the check of an API definition couldn't run, such as a schema the app couldn't load: the app's own
// notice, which says nothing of the server
export function uncheckedDefinition(error: unknown): ValidationError {
  return appFault(`The API definition could not be checked (${error instanceof Error ? error.message : 'unknown error'})`, { section: 'OpenAPI', schema: 'OpenAPI', type: 'unknown' });
}

// Validate an API definition against the official OpenAPI schema of its version
export async function validateOpenApiStructure(
  doc: Record<string, unknown>,
  loadSchema: OasSchemaLoader = fetchSchema,
): Promise<{ schemaName: string; errors: ValidationError[] }> {
  const version = oasVersionOf(doc);
  if (!version) {
    const declared = doc.openapi ?? doc.swagger ?? 'unknown';
    return {
      schemaName: 'OpenAPI',
      errors: [{
        message: `Only OpenAPI 3.0 and 3.1 can be validated; this document declares version ${declared}`,
        section: 'OpenAPI', schema: 'OpenAPI', keyword: 'version', severity: 'info', type: 'schema',
      }],
    };
  }
  const schemaName = `OpenAPI ${version} schema`;
  if (!validators.has(version)) {
    const pending = compile(version, loadSchema);
    validators.set(version, pending);
    pending.catch(() => validators.delete(version));
  }
  const validate = await validators.get(version)!;
  if (validate(doc)) return { schemaName, errors: [] };
  const summarized = summarizeRepeated(condenseAjvErrors(validate.errors ?? [], Infinity), doc, schemaName, RULES[version]);
  if (summarized.length <= MAX_ERRORS) return { schemaName, errors: summarized };
  // Where the app cut the list short: its own notice, not one more error of the server's
  return {
    schemaName,
    errors: [
      ...summarized.slice(0, MAX_ERRORS),
      appFault(`+${summarized.length - MAX_ERRORS} more errors not shown`, { section: 'OpenAPI', schema: schemaName, keyword: 'truncated', type: 'schema' }),
    ],
  };
}
