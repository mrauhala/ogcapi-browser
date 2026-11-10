import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SchemaValidator from './SchemaValidator';
import { EDR12 } from './standards';
import { isProblem } from './validation/severity';
import meteocore from './query/__fixtures__/meteocore-fmi-obs.json';

// The schemas come from the app's public directory, unless a test has nothing for them to come from
const fromPublic = async (url: string) => new Response(readFileSync(join('public', url), 'utf8'));
const EDR_1_2 = ['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core'];
const validator = SchemaValidator.getInstance();
const copy = <T,>(value: T): T => structuredClone(value);
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(() => {
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
beforeEach(() => vi.stubGlobal('fetch', fromPublic));
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SchemaValidator: faults in the app itself', () => {
  it('says it couldn’t check when no schema loaded, as its own notice, and counts nothing against the server', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await validator.loadSchemaBasedOnConformance(EDR_1_2);
    for (const result of [await validator.validateCollections({}), await validator.validateLandingPage({}), await validator.validateConformance({})]) {
      expect(result).toEqual({ valid: true, errors: [{ message: 'No schemas loaded. Validation skipped.', severity: 'info', source: 'app' }] });
      expect(result.errors!.filter(isProblem)).toEqual([]);
    }
  });

  it('says a schema whose check threw wasn’t checked, without failing the server', async () => {
    await validator.loadSchemaBasedOnConformance(EDR_1_2);
    // Its compiled check, as one that throws on what it's given
    const sets = (validator as unknown as { validators: Map<string, Record<string, unknown>> }).validators;
    const set = sets.get('edr-p1-v1.2')!;
    const kept = { ...set };
    for (const part of ['collections', 'landingPage', 'conformance']) set[part] = () => { throw new Error('boom'); };
    try {
      for (const result of [await validator.validateCollections({}), await validator.validateLandingPage({}), await validator.validateConformance({})]) {
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([expect.objectContaining({ message: 'OGC API EDR Part 1 v1.2 could not be checked: boom', schema: 'OGC API EDR Part 1 v1.2', severity: 'info', source: 'app' })]);
        expect(result.schemaResults).toBeUndefined();
      }
    } finally {
      Object.assign(set, kept);
    }
  });
});

describe('SchemaValidator: EDR 1.2’s data query variables, by its text over its schema', () => {
  const VARIABLES = '/collections/0/data_queries/position/link/variables';
  const without = (...fields: string[]) => {
    const collection = copy(meteocore) as Json;
    for (const field of fields) delete collection.data_queries.position.link.variables[field];
    return { links: [], collections: [collection] };
  };
  const findings = async (data: unknown) => {
    await validator.loadSchemaBasedOnConformance(EDR_1_2);
    return validator.validateCollections(data);
  };

  it('passes MeteoCore’s collection as it is', async () => {
    expect(await findings(without())).toMatchObject({ valid: true, errors: null });
  });

  // B, C and F: "A variables property MAY include" a title, output_formats and crs_details; the text says nothing of a
  // description. Each is a note, citing its statement, and the schema passes for what counts
  it('notes a MAY left out, where its schema requires it', async () => {
    const result = await findings(without('title', 'output_formats', 'crs_details', 'description'));
    const found = Object.fromEntries((result.errors ?? []).map((error: Json) => [error.message, [error.severity, error.rule]]));
    expect(found).toEqual({
      [`${VARIABLES}: no title. EDR 1.2 says a variables property MAY include one, where its schema requires it`]: ['info', EDR12.variablesTitle],
      [`${VARIABLES}: no output_formats. EDR 1.2 says a variables property MAY include one, where its schema requires it`]: ['info', EDR12.variablesOutputFormats],
      [`${VARIABLES}: no crs_details. EDR 1.2 says a variables property MAY include one, where its schema requires it`]: ['info', EDR12.variablesCrsDetails],
      [`${VARIABLES}: no description. EDR 1.2's text doesn't ask for one, where its schema requires it`]: ['info', EDR12.collectionsSuccessB],
    });
    expect(result.valid).toBe(true);
    expect(result.schemaResults).toEqual([{ schema: 'OGC API EDR Part 1 v1.2', isValid: true }]);
    // As the collection's Checks show them
    expect(result.collectionErrors?.[meteocore.id]).toHaveLength(4);
  });

  // D: "A variables property SHOULD include a default_output_format property of type string"
  it('makes an issue of the SHOULD left out', async () => {
    const result = await findings(without('default_output_format'));
    expect(result.errors).toEqual([expect.objectContaining({
      message: `${VARIABLES}: no default_output_format. EDR 1.2 says a variables property SHOULD include one`, severity: 'warning', rule: EDR12.variablesDefaultOutputFormat,
    })]);
    expect(result.valid).toBe(false);
  });

  it('keeps what the text does ask for as the schema’s error', async () => {
    const collection = copy(meteocore) as Json;
    collection.data_queries.position.link.variables.title = 5;
    const result = await findings({ links: [], collections: [collection] });
    expect(result.errors).toEqual([expect.objectContaining({ keyword: 'type', path: `${VARIABLES}/title`, rule: EDR12.collectionsSuccessB })]);
    expect(result.errors![0]).not.toHaveProperty('severity');
    expect(result.valid).toBe(false);
  });
});

describe('SchemaValidator: a schema the API doesn’t declare', () => {
  // With no conformance, or none it has a schema for, the app checks against EDR 1.1, which the server doesn't claim
  it('makes issues, not errors, of what the assumed schema finds, and says it was assumed', async () => {
    for (const conformsTo of [undefined, ['http://www.opengis.net/spec/ogcapi-unknown-1/1.0/conf/core']]) {
      await validator.loadSchemaBasedOnConformance(conformsTo);
      const result = await validator.validateCollections({ links: [] });
      expect(result.valid, String(conformsTo)).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors!.every((error: Json) => error.severity === 'warning' && error.schema === 'OGC API EDR Part 1 v1.1 (not declared: assumed)')).toBe(true);
      expect(result.schemaResults).toEqual([{ schema: 'OGC API EDR Part 1 v1.1 (not declared: assumed)', isValid: false }]);
      const landing = await validator.validateLandingPage({});
      expect(landing.errors!.every((error: Json) => error.severity === 'warning')).toBe(true);
    }
  });

  it('makes errors again once the API declares it', async () => {
    await validator.loadSchemaBasedOnConformance(['http://www.opengis.net/spec/ogcapi-edr-1/1.1/conf/core']);
    const result = await validator.validateCollections({ links: [] });
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors!.every((error: Json) => error.severity === undefined && error.schema === 'OGC API EDR Part 1 v1.1')).toBe(true);
  });
});
