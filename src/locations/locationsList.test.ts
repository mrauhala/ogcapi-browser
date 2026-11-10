import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isLocationsUrl, locationsListOf, locationsSchemaVersion, validateQueryResponse } from './locationsList';
import knmi from './__fixtures__/knmi-tg1-oper-locations.json';

const KNMI_API = 'https://geoservices.knmi.nl/edr/';
const KNMI = 'https://geoservices.knmi.nl/edr/collections/Tg_1_oper/locations';
const KNMI_TEXT = JSON.stringify(knmi);
const core = (version: string) => `http://www.opengis.net/spec/ogcapi-edr-1/${version}/conf/core`;

// The validators fetch their schemas from the app's public directory, and say what they found on the console
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join('public', url), 'utf8')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isLocationsUrl', () => {
  it('takes a collection’s or an instance’s list of locations', () => {
    expect(isLocationsUrl(KNMI)).toBe(true);
    expect(isLocationsUrl(`${KNMI}/`)).toBe(true);
    expect(isLocationsUrl(`${KNMI}?f=GeoJSON&datetime=2026-11-01T00:00:00Z`)).toBe(true);
    expect(isLocationsUrl('https://example.org/edr/collections/c/instances/i/locations')).toBe(true);
  });

  it('leaves a location’s data, and any other query, alone', () => {
    expect(isLocationsUrl(`${KNMI}/EDDK`)).toBe(false);
    expect(isLocationsUrl(`${KNMI}/EDDK/position`)).toBe(false);
    expect(isLocationsUrl('https://example.org/edr/collections/c/position?coords=POINT(1 2)&next=/locations')).toBe(false);
    expect(isLocationsUrl('https://example.org/edr/collections/locations-of-things')).toBe(false);
    expect(isLocationsUrl('not a URL')).toBe(false);
  });
});

describe('locationsListOf', () => {
  it('finds the features of a GeoJSON FeatureCollection from /locations, read from its text', () => {
    const list = locationsListOf(KNMI, KNMI_TEXT);
    expect(list?.features).toHaveLength(10);
    expect(list?.json.type).toBe('FeatureCollection');
  });

  it('takes the JSON already read, rather than read it again', () => {
    const parsed = { type: 'FeatureCollection', features: [{ type: 'Feature' }] };
    expect(locationsListOf(KNMI, 'not JSON', parsed)?.features).toEqual(parsed.features);
  });

  it('has no features for a list without them, which its schema then finds', () => {
    expect(locationsListOf(KNMI, '{"type":"FeatureCollection"}')?.features).toEqual([]);
  });

  it('is nothing for anything else', () => {
    expect(locationsListOf(KNMI, '{"type":"Coverage"}')).toBeNull();
    expect(locationsListOf(KNMI, 'not JSON')).toBeNull();
    expect(locationsListOf(KNMI, '')).toBeNull();
    expect(locationsListOf(KNMI, null)).toBeNull();
    expect(locationsListOf('https://example.org/edr/collections/c/items', KNMI_TEXT)).toBeNull();
  });
});

describe('locationsSchemaVersion', () => {
  it('is the newest version the loaded API declares, for a list of its own', () => {
    expect(locationsSchemaVersion(KNMI, KNMI_API, [core('1.0')])).toBe('1.0');
    expect(locationsSchemaVersion(KNMI, 'https://geoservices.knmi.nl/edr', [core('1.1'), core('1.2')])).toBe('1.2');
  });

  it('is 1.1 without a version declared, and for another API’s list, whose isn’t known', () => {
    expect(locationsSchemaVersion(KNMI, KNMI_API, [])).toBe('1.1');
    expect(locationsSchemaVersion(KNMI, KNMI_API, null)).toBe('1.1');
    expect(locationsSchemaVersion(KNMI, 'https://meteocore.app.meteo.fi/edr/', [core('1.2')])).toBe('1.1');
    expect(locationsSchemaVersion(KNMI, '', [core('1.2')])).toBe('1.1');
  });
});

describe('validateQueryResponse', () => {
  it('checks KNMI’s list, sent as CoverageJSON, as locations against the version declared, not as CoverageJSON', async () => {
    const result = await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', KNMI, '1.0');
    expect(result).toMatchObject({ matched: true, schemaName: 'EDR 1.0 Locations', valid: false });
    const messages = result.errors?.map(error => error.message) ?? [];
    // EDR's locations need a label, a time, parameters and an endpoint, which KNMI's have none of
    expect(messages).toContain("/features/*/properties: must have required property 'label' (10 of 10 features)");
    expect(messages).toHaveLength(4);
    expect(result.errors?.every(error => error.schema === 'EDR 1.0 Locations')).toBe(true);
    expect((await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', KNMI, '1.2')).schemaName).toBe('EDR 1.2 Locations');
  });

  it('checks a list against the version given, whatever its Content-Type', async () => {
    for (const contentType of ['application/geo+json', 'text/plain', '']) {
      expect((await validateQueryResponse(KNMI_TEXT, contentType, KNMI, '1.1')).schemaName).toBe('EDR 1.1 Locations');
    }
  });

  it('passes a list with all EDR asks', async () => {
    const list = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [24.9, 60.2] },
        properties: { datetime: '2026-11-01T00:00:00Z/..', label: 'A', 'parameter-name': ['t2m'], edrqueryendpoint: 'https://example.org/edr/collections/c/locations/a' },
      }],
    };
    expect(await validateQueryResponse(JSON.stringify(list), 'application/geo+json', KNMI, '1.2')).toEqual({ matched: true, schemaName: 'EDR 1.2 Locations', valid: true, errors: [] });
  });

  it('leaves anything else to the query result schemas', async () => {
    const coverage = JSON.stringify({ type: 'Coverage' });
    expect((await validateQueryResponse(coverage, 'application/prs.coverage+json', 'https://example.org/edr/collections/c/position', '1.2')).schemaName).toBe('CoverageJSON 1.0');
    // The same body from a location's own data is that location's data, not a list
    expect((await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', `${KNMI}/EDDK`, '1.2')).schemaName).toBe('CoverageJSON 1.0');
    expect(await validateQueryResponse(KNMI_TEXT, 'application/geo+json', 'https://example.org/edr/collections/c/items', '1.2')).toEqual({ matched: false });
  });
});
