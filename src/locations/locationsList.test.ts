import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isLocationsUrl, locationsListOf, locationsSchemaOf, validateQueryResponse } from './locationsList';
import type { LocationsSchema } from '../validation/locationsValidator';
import knmi from './__fixtures__/knmi-tg1-oper-locations.json';

const KNMI_API = 'https://geoservices.knmi.nl/edr/';
const KNMI = 'https://geoservices.knmi.nl/edr/collections/Tg_1_oper/locations';
const KNMI_TEXT = JSON.stringify(knmi);
const core = (version: string) => `http://www.opengis.net/spec/ogcapi-edr-1/${version}/conf/core`;
const edrGeojsonClass = (version: string) => `http://www.opengis.net/spec/ogcapi-edr-1/${version}/conf/edr-geojson`;
// What KNMI declares, as its /conformance said on 2026-11-10
const KNMI_CLASSES = ['core', 'oas30', 'geojson', 'queries'].map(name => `http://www.opengis.net/spec/ogcapi-edr-1/1.0/conf/${name}`);
const NOT_EDR_GEOJSON = 'GeoJSON FeatureCollection (the API declares GeoJSON, not EDR GeoJSON)';
const EDR_1_2: LocationsSchema = { kind: 'edr-geojson', version: '1.2', name: 'EDR 1.2 Locations' };

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

describe('locationsSchemaOf', () => {
  it('goes by what the loaded API declares, for a list of its own', () => {
    // KNMI declares EDR 1.0's GeoJSON class, not its EDR GeoJSON one
    expect(locationsSchemaOf(KNMI, KNMI_API, KNMI_CLASSES)).toEqual({ kind: 'geojson', name: NOT_EDR_GEOJSON });
    expect(locationsSchemaOf(KNMI, 'https://geoservices.knmi.nl/edr', [core('1.1'), core('1.2'), edrGeojsonClass('1.2')])).toEqual({ kind: 'edr-geojson', version: '1.2', name: 'EDR 1.2 Locations' });
  });

  it('knows nothing of another API’s', () => {
    expect(locationsSchemaOf(KNMI, 'https://meteocore.app.meteo.fi/edr/', [core('1.2'), edrGeojsonClass('1.2')]).name).toBe('GeoJSON FeatureCollection (not the loaded API’s, so what it declares isn’t known)');
    expect(locationsSchemaOf(KNMI, '', [core('1.2'), edrGeojsonClass('1.2')]).kind).toBe('geojson');
  });
});

describe('validateQueryResponse', () => {
  it('checks KNMI’s list, sent as CoverageJSON, as the GeoJSON its API declares, not as CoverageJSON', async () => {
    const result = await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', KNMI, locationsSchemaOf(KNMI, KNMI_API, KNMI_CLASSES));
    expect(result).toEqual({ matched: true, schemaName: NOT_EDR_GEOJSON, valid: true, errors: [] });
  });

  it('checks a list as EDR GeoJSON where that’s declared, which KNMI’s isn’t', async () => {
    const result = await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', KNMI, EDR_1_2);
    expect(result).toMatchObject({ matched: true, schemaName: 'EDR 1.2 Locations', valid: false });
    const messages = result.errors?.map(error => error.message) ?? [];
    // EDR GeoJSON's locations have a label, a time, parameters and an endpoint, which KNMI's have none of
    expect(messages).toContain("/features/*/properties: must have required property 'label' (10 of 10 features)");
    expect(messages).toHaveLength(4);
    expect(result.errors?.every(error => error.schema === 'EDR 1.2 Locations')).toBe(true);
  });

  it('checks a list against the schema given, whatever its Content-Type', async () => {
    for (const contentType of ['application/geo+json', 'text/plain', '']) {
      expect((await validateQueryResponse(KNMI_TEXT, contentType, KNMI, EDR_1_2)).schemaName).toBe('EDR 1.2 Locations');
    }
  });

  it('passes a list with all EDR GeoJSON asks', async () => {
    const list = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [24.9, 60.2] },
        properties: { datetime: '2026-11-01T00:00:00Z/..', label: 'A', 'parameter-name': ['t2m'], edrqueryendpoint: 'https://example.org/edr/collections/c/locations/a' },
      }],
    };
    expect(await validateQueryResponse(JSON.stringify(list), 'application/geo+json', KNMI, EDR_1_2)).toEqual({ matched: true, schemaName: 'EDR 1.2 Locations', valid: true, errors: [] });
  });

  it('leaves anything else to the query result schemas', async () => {
    const coverage = JSON.stringify({ type: 'Coverage' });
    expect((await validateQueryResponse(coverage, 'application/prs.coverage+json', 'https://example.org/edr/collections/c/position', EDR_1_2)).schemaName).toBe('CoverageJSON 1.0');
    // The same body from a location's own data is that location's data, not a list
    expect((await validateQueryResponse(KNMI_TEXT, 'application/prs.coverage+json', `${KNMI}/EDDK`, EDR_1_2)).schemaName).toBe('CoverageJSON 1.0');
    expect(await validateQueryResponse(KNMI_TEXT, 'application/geo+json', 'https://example.org/edr/collections/c/items', EDR_1_2)).toEqual({ matched: false });
  });
});
