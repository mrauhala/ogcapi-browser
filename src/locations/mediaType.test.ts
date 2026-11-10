import { describe, expect, it } from 'vitest';
import { geojsonMediaTypeFindings } from './mediaType';
import { EDR, EDR11, EDR12 } from '../standards';

// As a list is checked from an API declaring EDR's GeoJSON class, as FMI and KNMI do, and from one declaring EDR GeoJSON
const severities = (contentType: string) => geojsonMediaTypeFindings(contentType, false).map(each => each.severity);
const message = (contentType: string) => geojsonMediaTypeFindings(contentType, false)[0].message;

describe('geojsonMediaTypeFindings', () => {
  it('passes GeoJSON’s media type, whatever its case or parameters', () => {
    expect(geojsonMediaTypeFindings('application/geo+json', false)).toEqual([{ severity: 'pass', message: 'Content-Type is application/geo+json', rule: EDR.geojsonDefinition }]);
    expect(severities('Application/GEO+JSON; charset=utf-8')).toEqual(['pass']);
  });

  it('makes an issue of CoverageJSON’s, which a client would read the list by', () => {
    expect(geojsonMediaTypeFindings('application/prs.coverage+json', false)).toEqual([{
      severity: 'warning',
      message: 'Content-Type is application/prs.coverage+json, CoverageJSON\'s, so a client going by it reads this GeoJSON as CoverageJSON. EDR\'s for feature content, such as a locations list, is application/geo+json',
      rule: EDR.geojsonDefinition,
    }]);
    expect(message('application/vnd.cov+json; charset=utf-8')).toBe('Content-Type is application/vnd.cov+json, CoverageJSON\'s, so a client going by it reads this GeoJSON as CoverageJSON. EDR\'s for feature content, such as a locations list, is application/geo+json');
  });

  it('makes an issue of any other, or of none', () => {
    // EDR gives application/json to resources without feature content
    expect(geojsonMediaTypeFindings('application/json', false)).toEqual([{
      severity: 'warning', message: 'Content-Type is application/json. EDR\'s for feature content, such as a locations list, is application/geo+json', rule: EDR.geojsonDefinition,
    }]);
    expect(message('Text/Plain')).toBe('Content-Type is text/plain. EDR\'s for feature content, such as a locations list, is application/geo+json');
    expect(message('')).toBe('The response has no Content-Type. EDR\'s for feature content, such as a locations list, is application/geo+json');
  });

  it('names no locations list for a data query’s features', () => {
    expect(geojsonMediaTypeFindings('application/json', false, false)).toEqual([{
      severity: 'warning', message: 'Content-Type is application/json. EDR\'s for feature content is application/geo+json', rule: EDR.geojsonDefinition,
    }]);
    expect(geojsonMediaTypeFindings('application/geo+json', true, false)).toEqual([{ severity: 'pass', message: 'Content-Type is application/geo+json', rule: EDR.edrGeojsonDefinition }]);
  });

  it('cites the class the list was checked by: GeoJSON’s /req/geojson/definition A, or EDR GeoJSON’s', () => {
    expect(geojsonMediaTypeFindings('application/geo+json', true)[0].rule).toBe(EDR.edrGeojsonDefinition);
    expect(geojsonMediaTypeFindings('application/json', true)).toEqual([{
      severity: 'warning', message: 'Content-Type is application/json. EDR\'s for feature content, such as a locations list, is application/geo+json', rule: EDR.edrGeojsonDefinition,
    }]);
  });

  it('cites each in both versions, linked to its item for feature content', () => {
    expect(EDR.geojsonDefinition.edr).toEqual({ '1.1': EDR11.geojsonDefinition, '1.2': EDR12.geojsonDefinition });
    expect(EDR11.geojsonDefinition.label).toBe('EDR 1.1 /req/geojson/definition A, test B.27');
    expect(EDR12.geojsonDefinition.label).toBe('EDR 1.2 /req/geojson/definition A, test B.29');
    expect(EDR.edrGeojsonDefinition.edr).toEqual({ '1.1': EDR11.edrGeojsonDefinition, '1.2': EDR12.edrGeojsonDefinition });
    expect(EDR11.edrGeojsonDefinition.label).toBe('EDR 1.1 /req/edr-geojson/definition A, test B.29');
    expect(EDR12.edrGeojsonDefinition.label).toBe('EDR 1.2 /req/edr-geojson/definition A, test B.31');
  });
});
