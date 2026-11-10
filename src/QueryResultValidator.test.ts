import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryResultValidator, schemaRuleOf } from './QueryResultValidator';
import { COVJSON, EDR, EDR11, EDR12 } from './standards';

const POLYTOPE = readFileSync('src/coverage/__fixtures__/polytope-op-multipoint-area.json', 'utf8');
const edited = (edit: (json: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const json = JSON.parse(POLYTOPE);
  edit(json);
  return JSON.stringify(json);
};
const validate = (data: string) => QueryResultValidator.getInstance().validate(data, 'application/json');

// The validator fetches its schema from the app's public directory, and says what it found on the console
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join('public', url), 'utf8')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QueryResultValidator: CoverageJSON', () => {
  it('checks each coverage as the domainType it inherits, which finds Polytope’s coordinates', async () => {
    const result = await validate(POLYTOPE);
    expect(result).toMatchObject({ matched: true, schemaName: 'CoverageJSON 1.0', valid: false });
    expect(result.errors).toEqual([{
      message: '/coverages/0/domain/axes/composite/coordinates: must be equal to one of the allowed values: ["x","y","z"], ["x","y"]',
      path: '/coverages/0/domain/axes/composite/coordinates',
      keyword: 'enum',
      schema: 'CoverageJSON 1.0',
      section: 'Query Result',
      type: 'schema',
    }]);
  });

  it('finds nothing of the kind without a type to inherit, as the schema alone checks it', async () => {
    expect(await validate(edited(json => { delete json.domainType; }))).toMatchObject({ valid: true, errors: [] });
  });

  it('passes the same points with the coordinates a MultiPoint has', async () => {
    expect(await validate(edited(json => { json.coverages[0].domain.axes.composite.coordinates = ['x', 'y', 'z']; }))).toMatchObject({ valid: true });
  });

  it('checks a coverage by its own domainType where it has one', async () => {
    const result = await validate(edited(json => { json.coverages[0].domain.domainType = 'Grid'; }));
    expect(result.errors?.map(error => error.message)).toEqual([
      "/coverages/0/domain/axes: must have required property 'x'",
      "/coverages/0/domain/axes: must have required property 'y'",
      '/coverages/0/domain/axes: must NOT have additional properties',
    ]);
  });

  it('leaves out what only says a deeper error is there', async () => {
    const result = await validate(edited(json => { json.coverages[0].domain.domainType = 'Grid'; }));
    expect(result.errors?.map(error => error.keyword)).not.toEqual(expect.arrayContaining(['if']));
    expect(result.errors?.some(error => /must match/.test(error.message))).toBe(false);
  });

  // CoverageJSON 10: application/vnd.cov+json. A wrong type isn't passed over as no schema applying
  it('knows CoverageJSON by its media type, whatever its type says', async () => {
    const wrong = JSON.stringify({ type: 'coverage', domain: { type: 'Domain', axes: {} }, ranges: {} });
    // A media type is the same in any case (RFC 9110)
    for (const contentType of ['application/vnd.cov+json', 'Application/VND.Cov+JSON', 'application/vnd.cov+json; profile="https://covjson.org/def/core#standalone"', 'application/prs.coverage+json']) {
      const result = await QueryResultValidator.getInstance().validate(wrong, contentType);
      expect(result, contentType).toMatchObject({ matched: true, schemaName: 'CoverageJSON 1.0', valid: false });
    }
    expect(await QueryResultValidator.getInstance().validate(wrong, 'application/json')).toMatchObject({ matched: false });
  });

  it('says what isn’t JSON, citing EDR’s "SHALL be a CoverageJSON Object"', async () => {
    expect(await QueryResultValidator.getInstance().validate('{"type":"Coverage",', 'application/prs.coverage+json')).toMatchObject({ valid: false, errors: [{ message: 'Failed to parse response as JSON', rule: EDR.covjsonContentA }] });
  });

  it('names the rule each schema’s findings rest on', () => {
    expect(schemaRuleOf('CoverageJSON 1.0')).toEqual([COVJSON.conformance, EDR.covjsonContentB]);
    // A locations list's, by the version it was checked against: EDR 1.0's text isn't cited, so 1.1's stands for it
    expect(schemaRuleOf('EDR 1.2 Locations')).toBe(EDR12.edrGeojsonContent);
    expect(schemaRuleOf('EDR 1.1 Locations')).toBe(EDR11.edrGeojsonContent);
    expect(schemaRuleOf('EDR 1.0 Locations')).toBe(EDR11.edrGeojsonContent);
    expect(schemaRuleOf('EDR 1.3 Locations')).toBeUndefined();
    expect(schemaRuleOf('Something else')).toBeUndefined();
    expect(schemaRuleOf(null)).toBeUndefined();
  });
});
