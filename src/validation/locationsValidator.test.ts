import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { locationsSchemaName, locationsSchemaRuleOf, validateLocationsResponse } from './locationsValidator';
import { EDR11, EDR12 } from '../standards';
import meteogate from './__fixtures__/meteogate-nl-daily-locations.json';

// The validator fetches its schema from the app's public directory
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join('public', url), 'utf8')));
});
afterAll(() => vi.unstubAllGlobals());

describe('the schema’s name and rule', () => {
  it('names each version’s schema, and finds its rule by that name only', () => {
    expect(locationsSchemaName('1.2')).toBe('EDR 1.2 Locations');
    expect(locationsSchemaRuleOf('EDR 1.2 Locations')).toBe(EDR12.edrGeojsonContent);
    // EDR 1.0's text isn't cited
    expect(locationsSchemaRuleOf('EDR 1.0 Locations')).toBe(EDR11.edrGeojsonContent);
    // Another schema's name, though it has a version in it, isn't a locations schema's
    expect(locationsSchemaRuleOf('CoverageJSON 1.0')).toBeUndefined();
    expect(locationsSchemaRuleOf('EDR 1.2 Locations FeatureCollection')).toBeUndefined();
    expect(locationsSchemaRuleOf(null)).toBeUndefined();
  });
});

describe('validateLocationsResponse', () => {
  it('reports a property missing from every feature once, with how many features lack it (Meteogate)', async () => {
    const { isValid, errors } = await validateLocationsResponse(meteogate.response, '1.1');
    expect(isValid).toBe(false);
    const messages = errors.map(error => error.message);
    expect(messages).toContain("/features/*/properties: must have required property 'datetime' (5 of 5 features)");
    expect(messages).toContain("/features/*/properties: must have required property 'label' (5 of 5 features)");
    // One error per kind, not per feature; each points at the first feature, for navigation
    expect(errors.length).toBeLessThan(10);
    expect(errors.every(error => error.path === '/features/0/properties' && error.section === 'Locations')).toBe(true);
  });

  it('cites /req/edr-geojson/content of the version its schema is, 1.0 as 1.1 words it', async () => {
    for (const [version, rule] of [['1.1', EDR11.edrGeojsonContent], ['1.2', EDR12.edrGeojsonContent], ['1.0', EDR11.edrGeojsonContent]] as const) {
      const { errors } = await validateLocationsResponse(meteogate.response, version);
      expect(errors.length, version).toBeGreaterThan(0);
      expect(errors.every(error => error.rule === rule), version).toBe(true);
    }
  });

  it('keeps a single error as it is', async () => {
    const response = structuredClone(meteogate.response);
    response.features = response.features.slice(0, 1);
    const { errors } = await validateLocationsResponse(response, '1.1');
    expect(errors.map(error => error.message)).toContain("/features/0/properties: must have required property 'datetime'");
  });

  it('accepts a valid locations response', async () => {
    const response = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [24.9, 60.2] },
        properties: { datetime: '2026-11-01T00:00:00Z/..', label: 'A', 'parameter-name': ['t2m'], edrqueryendpoint: 'https://example.org/edr/collections/c/locations/a' },
      }],
    };
    expect(await validateLocationsResponse(response, '1.1')).toEqual({ isValid: true, errors: [] });
  });
});
