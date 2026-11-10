import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isEdrGeojsonSchema, locationsSchemaFor, locationsSchemaRuleOf, validateLocationsResponse, type LocationsSchema } from './locationsValidator';
import { EDR, EDR11, EDR12, type DeclaredEdr } from '../standards';
import meteogate from './__fixtures__/meteogate-nl-daily-locations.json';
import fmi from '../locations/__fixtures__/fmi-ecmwf-locations.json';
import knmi from '../locations/__fixtures__/knmi-tg1-oper-locations.json';
import meteocore from '../locations/__fixtures__/meteocore-fmi-obs-locations-first-5.json';

// The EDR classes each server declares, as their /conformance said on 2026-11-10
const EDR_1_0 = 'http://www.opengis.net/spec/ogcapi-edr-1/1.0/conf';
const EDR_1_1 = 'http://www.opengis.net/spec/ogcapi-edr-1/1.1/conf';
const EDR_1_2 = 'https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf';
const KNMI = ['core', 'oas30', 'geojson', 'queries'].map(name => `${EDR_1_0}/${name}`);
const FMI = [
  ...['core', 'collections', 'queries', 'json', 'geojson', 'covjson'].map(name => `http://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/${name}`),
  ...['core', 'collections', 'json', 'geojson', 'covjson'].map(name => `${EDR_1_0}/${name}`),
];
const METEOCORE = [
  ...['core', 'collections', 'queries', 'instances', 'json', 'geojson', 'edr-geojson', 'covjson', 'html', 'oas30'].map(name => `${EDR_1_2}/${name}`),
  ...['core', 'collections', 'queries', 'json', 'geojson', 'edr-geojson', 'covjson', 'html', 'oas30'].map(name => `${EDR_1_1}/${name}`),
];
const NOT_EDR_GEOJSON = 'GeoJSON FeatureCollection (the API declares GeoJSON, not EDR GeoJSON)';
const edrGeojson = (version: DeclaredEdr): LocationsSchema => ({ kind: 'edr-geojson', version, name: `EDR ${version} Locations` });
const GEOJSON = locationsSchemaFor(FMI, '1.2');

// The validator fetches its schema from the app's public directory
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join('public', url), 'utf8')));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('locationsSchemaFor', () => {
  it('is EDR GeoJSON only for an API declaring that version’s EDR GeoJSON class, as MeteoCore does', () => {
    expect(locationsSchemaFor(METEOCORE, '1.2')).toEqual(edrGeojson('1.2'));
    expect(locationsSchemaFor(METEOCORE, '1.1')).toEqual(edrGeojson('1.1'));
    // 1.1's class doesn't stand for 1.2's
    expect(locationsSchemaFor([`${EDR_1_2}/core`, `${EDR_1_1}/edr-geojson`], '1.2').kind).toBe('geojson');
  });

  it('is a GeoJSON FeatureCollection for an API declaring only GeoJSON, as FMI and KNMI do', () => {
    expect(locationsSchemaFor(FMI, '1.2')).toEqual({ kind: 'geojson', name: NOT_EDR_GEOJSON });
    expect(locationsSchemaFor(KNMI, '1.0')).toEqual({ kind: 'geojson', name: NOT_EDR_GEOJSON });
  });

  it('says why where nothing calls for EDR GeoJSON', () => {
    expect(locationsSchemaFor([`${EDR_1_2}/core`], '1.2').name).toBe('GeoJSON FeatureCollection (the API declares neither GeoJSON nor EDR GeoJSON)');
    expect(locationsSchemaFor([], null).name).toBe('GeoJSON FeatureCollection (the API declares no EDR version)');
    expect(locationsSchemaFor(null, null).name).toBe('GeoJSON FeatureCollection (the API declares no EDR version)');
    // Another API's response: what the loaded one declares says nothing of it
    expect(locationsSchemaFor(METEOCORE, '1.2', true)).toEqual({ kind: 'geojson', name: 'GeoJSON FeatureCollection (not the loaded API’s, so what it declares isn’t known)' });
  });
});

describe('locationsSchemaRuleOf', () => {
  it('finds each schema’s rule by the name it’s shown under, and nothing else', () => {
    expect(locationsSchemaRuleOf('EDR 1.2 Locations')).toBe(EDR12.edrGeojsonContent);
    // EDR 1.0's text isn't cited
    expect(locationsSchemaRuleOf('EDR 1.0 Locations')).toBe(EDR11.edrGeojsonContent);
    expect(locationsSchemaRuleOf(NOT_EDR_GEOJSON)).toBe(EDR.geojsonContent);
    // Another schema's name, though it has a version in it, isn't a locations schema's
    expect(locationsSchemaRuleOf('CoverageJSON 1.0')).toBeUndefined();
    expect(locationsSchemaRuleOf('EDR 1.2 Locations FeatureCollection')).toBeUndefined();
    expect(locationsSchemaRuleOf('GeoJSON FeatureCollection')).toBeUndefined();
    expect(locationsSchemaRuleOf(null)).toBeUndefined();
  });

  it('knows a list checked as EDR GeoJSON by its schema’s name', () => {
    expect(isEdrGeojsonSchema('EDR 1.2 Locations')).toBe(true);
    expect(isEdrGeojsonSchema('EDR 1.0 Locations')).toBe(true);
    expect(isEdrGeojsonSchema(NOT_EDR_GEOJSON)).toBe(false);
    expect(isEdrGeojsonSchema('CoverageJSON 1.0')).toBe(false);
    expect(isEdrGeojsonSchema(null)).toBe(false);
  });

  it('cites /req/geojson/content A in both versions, linked to its item for features', () => {
    expect(EDR.geojsonContent.edr).toEqual({ '1.1': EDR11.geojsonContent, '1.2': EDR12.geojsonContent });
    expect(EDR11.geojsonContent.label).toBe('EDR 1.1 /req/geojson/content A, test B.28');
    expect(EDR12.geojsonContent.label).toBe('EDR 1.2 /req/geojson/content A, test B.30');
  });
});

describe('validateLocationsResponse', () => {
  it('passes FMI’s and KNMI’s real lists as the GeoJSON their APIs declare', async () => {
    expect(await validateLocationsResponse(fmi, locationsSchemaFor(FMI, '1.2'))).toEqual({ isValid: true, errors: [] });
    expect(await validateLocationsResponse(knmi, locationsSchemaFor(KNMI, '1.0'))).toEqual({ isValid: true, errors: [] });
  });

  it('would find FMI’s list lacks EDR’s properties, which only EDR GeoJSON asks for', async () => {
    const { isValid, errors } = await validateLocationsResponse(fmi, edrGeojson('1.2'));
    expect(isValid).toBe(false);
    expect(errors.map(error => error.message)).toEqual([
      "/features/*/properties: must have required property 'parameter-name' (308 of 308 features)",
      "/features/*/properties: must have required property 'label' (308 of 308 features)",
      "/features/*/properties: must have required property 'edrqueryendpoint' (308 of 308 features)",
    ]);
  });

  it('passes MeteoCore’s real list as the EDR GeoJSON its API declares', async () => {
    expect(await validateLocationsResponse(meteocore, locationsSchemaFor(METEOCORE, '1.2'))).toEqual({ isValid: true, errors: [] });
  });

  it('finds what isn’t a GeoJSON FeatureCollection, citing /req/geojson/content A', async () => {
    const broken = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: ['24.9', 60.2] }, properties: null },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [25, 61] } },
      ],
    };
    const { isValid, errors } = await validateLocationsResponse(broken, GEOJSON);
    expect(isValid).toBe(false);
    const messages = errors.map(error => error.message);
    expect(messages).toContain('/features/0/geometry/coordinates/0: must be number');
    expect(messages).toContain("/features/1: must have required property 'properties'");
    expect(errors.every(error => error.rule === EDR.geojsonContent && error.schema === NOT_EDR_GEOJSON)).toBe(true);
    // Properties may be null, as GeoJSON has them
    expect((await validateLocationsResponse({ type: 'FeatureCollection', features: [broken.features[1]] }, GEOJSON)).isValid).toBe(false);
    expect((await validateLocationsResponse({ type: 'FeatureCollection', features: [{ ...broken.features[1], properties: null }] }, GEOJSON)).isValid).toBe(true);
    expect((await validateLocationsResponse({ type: 'FeatureCollection' }, GEOJSON)).errors.map(error => error.message)).toEqual([": must have required property 'features'"]);
  });

  it('reports a property missing from every feature once, with how many features lack it (Meteogate)', async () => {
    const { isValid, errors } = await validateLocationsResponse(meteogate.response, edrGeojson('1.1'));
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
      const { errors } = await validateLocationsResponse(meteogate.response, edrGeojson(version));
      expect(errors.length, version).toBeGreaterThan(0);
      expect(errors.every(error => error.rule === rule && error.schema === `EDR ${version} Locations`), version).toBe(true);
    }
  });

  it('keeps a single error as it is', async () => {
    const response = structuredClone(meteogate.response);
    response.features = response.features.slice(0, 1);
    const { errors } = await validateLocationsResponse(response, edrGeojson('1.1'));
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
    expect(await validateLocationsResponse(response, edrGeojson('1.1'))).toEqual({ isValid: true, errors: [] });
  });
});
