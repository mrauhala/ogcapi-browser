import { describe, expect, it } from 'vitest';
import { locationsMediaTypeFindings } from './mediaType';
import { EDR, EDR11, EDR12 } from '../standards';

const severities = (contentType: string) => locationsMediaTypeFindings(contentType).map(each => each.severity);
const message = (contentType: string) => locationsMediaTypeFindings(contentType)[0].message;

describe('locationsMediaTypeFindings', () => {
  it('passes GeoJSON’s media type, whatever its case or parameters', () => {
    expect(locationsMediaTypeFindings('application/geo+json')).toEqual([{ severity: 'pass', message: 'Content-Type is application/geo+json', rule: EDR.edrGeojsonDefinition }]);
    expect(severities('Application/GEO+JSON; charset=utf-8')).toEqual(['pass']);
  });

  it('makes an issue of CoverageJSON’s, which a client would read the list by', () => {
    expect(locationsMediaTypeFindings('application/prs.coverage+json')).toEqual([{
      severity: 'warning',
      message: 'Content-Type is application/prs.coverage+json, CoverageJSON\'s, so a client going by it reads this GeoJSON as CoverageJSON. EDR\'s for feature content, such as a locations list, is application/geo+json',
      rule: EDR.edrGeojsonDefinition,
    }]);
    expect(message('application/vnd.cov+json; charset=utf-8')).toBe('Content-Type is application/vnd.cov+json, CoverageJSON\'s, so a client going by it reads this GeoJSON as CoverageJSON. EDR\'s for feature content, such as a locations list, is application/geo+json');
  });

  it('makes an issue of any other, or of none', () => {
    // EDR gives application/json to resources without feature content
    expect(locationsMediaTypeFindings('application/json')).toEqual([{
      severity: 'warning', message: 'Content-Type is application/json. EDR\'s for feature content, such as a locations list, is application/geo+json', rule: EDR.edrGeojsonDefinition,
    }]);
    expect(message('Text/Plain')).toBe('Content-Type is text/plain. EDR\'s for feature content, such as a locations list, is application/geo+json');
    expect(message('')).toBe('The response has no Content-Type. EDR\'s for feature content, such as a locations list, is application/geo+json');
  });

  it('cites /req/edr-geojson/definition A in each version, linked to its item for feature content', () => {
    expect(EDR.edrGeojsonDefinition.edr).toEqual({ '1.1': EDR11.edrGeojsonDefinition, '1.2': EDR12.edrGeojsonDefinition });
    expect(EDR11.edrGeojsonDefinition.label).toBe('EDR 1.1 /req/edr-geojson/definition A, test B.29');
    expect(EDR12.edrGeojsonDefinition.label).toBe('EDR 1.2 /req/edr-geojson/definition A, test B.31');
  });
});
