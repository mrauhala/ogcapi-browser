import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SchemaValidator from './SchemaValidator';
import { COMMON1, EDR12, FEATURES1, FEATURES2, MAPS1, RECORDS1 } from './standards';
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

describe('SchemaValidator: the rules Features Part 2’s, Records’ and Maps’ schemas rest on', () => {
  const rulesOf = (result: { errors: Json[] | null }) => [...new Set((result.errors ?? []).map(error => JSON.stringify(error.rule ?? null)))];
  const cited = (rule: unknown) => JSON.stringify(rule);

  // Its one statement: "Each CRS supported by a server SHALL be referenceable by a uniform resource identifier"
  it('cites Features Part 2’s crs-uri on its crs list', async () => {
    await validator.loadSchemaBasedOnConformance(['http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs']);
    const result = await validator.validateCollections({ links: [], collections: [], crs: ['not a uri'] });
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(rulesOf(result)).toEqual([cited(FEATURES2.crsUri)]);
  });

  // The landing page is Features Part 1's, which records-api requires; a catalog has Table 11's properties, in the
  // schema catalog-response defines
  it('cites Records for its catalogs, and Features Part 1 through Records for its landing page', async () => {
    await validator.loadSchemaBasedOnConformance(['http://www.opengis.net/spec/ogcapi-records-1/1.0/conf/core']);
    const catalogs = await validator.validateCollections({ links: [], collections: [{ id: 'one', links: [] }] });
    expect(catalogs.errors?.length).toBeGreaterThan(0);
    expect(rulesOf(catalogs)).toEqual([cited([RECORDS1.catalogsResponseB, RECORDS1.catalogProperties])]);
    const landing = await validator.validateLandingPage({});
    expect(landing.errors?.length).toBeGreaterThan(0);
    expect(rulesOf(landing)).toEqual([cited([RECORDS1.featuresApi, FEATURES1.rootSuccessB])]);
  });

  // Maps names no schema of its own but the extent's for a dimension beyond space and time: the landing page and
  // conformance are Common Part 1's shapes, and the rest of the collections Common Part 2's, a draft, cited nowhere yet
  it('cites Common Part 1 for Maps’ landing page and conformance, and Maps for a dimension’s extent only', async () => {
    await validator.loadSchemaBasedOnConformance(['https://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/core']);
    expect(rulesOf(await validator.validateLandingPage({}))).toEqual([cited(COMMON1.rootSuccessB)]);
    expect(rulesOf(await validator.validateConformance({}))).toEqual([cited(COMMON1.conformanceSuccessB)]);
    // EDR's custom dimensions, an array, where Maps' extent has an object per dimension; a box that isn't one; no id.
    // Then, in a second collection, a time that isn't one, and a dimension whose name only begins as time's does
    const result = await validator.validateCollections({ links: [], collections: [
      { links: [], extent: { custom: [], spatial: { bbox: 'nope' } } },
      { id: 'two', links: [], extent: { temporal: { interval: 'nope' }, temporalResolution: [] } },
    ] });
    const byPath = (pattern: RegExp) => (result.errors ?? []).filter((error: Json) => pattern.test(error.path));
    const citing = (pattern: RegExp, rule: unknown) => {
      expect(byPath(pattern).length, String(pattern)).toBeGreaterThan(0);
      expect(byPath(pattern).every((error: Json) => error.rule === rule), String(pattern)).toBe(true);
    };
    citing(/^\/collections\/0\/extent\/custom/, MAPS1.additionalDimensions);
    citing(/^\/collections\/0\/extent\/spatial/, undefined);
    expect(byPath(/^\/collections\/0$/).every((error: Json) => error.rule === undefined)).toBe(true);
    citing(/^\/collections\/1\/extent\/temporal(?:\/|$)/, undefined);
    citing(/^\/collections\/1\/extent\/temporalResolution/, MAPS1.additionalDimensions);
  });
});
