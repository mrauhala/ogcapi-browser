import { describe, expect, it } from 'vitest';
import { locationIdFindings } from './locationIds';
import { EDR, EDR11, EDR12, RFC } from '../standards';
import fmi from './__fixtures__/fmi-ecmwf-locations.json';
import knmi from './__fixtures__/knmi-tg1-oper-locations.json';
import meteocore from './__fixtures__/meteocore-fmi-obs-locations-first-5.json';

const point = (id: unknown, properties: Record<string, unknown> = {}) => ({ type: 'Feature', ...(id === undefined ? {} : { id }), geometry: { type: 'Point', coordinates: [24.9, 60.2] }, properties });
const ENDPOINT = 'https://example.org/edr/collections/c/locations/a';
const severities = (features: readonly unknown[]) => locationIdFindings(features).map(each => each.severity);

describe('locationIdFindings', () => {
  it('passes the real lists, each naming every location by its id', () => {
    expect(locationIdFindings(fmi.features)).toEqual([{ severity: 'pass', message: 'Every location has an id: 308 of 308', rule: [EDR.locationsList, RFC.featureId] }]);
    expect(locationIdFindings(knmi.features)[0].message).toBe('Every location has an id: 10 of 10');
    expect(locationIdFindings(meteocore.features)[0].message).toBe('Every location has an id: 5 of 5');
  });

  it('makes an issue of locations with no id, once, at the first of them', () => {
    const features = [point('a', { edrqueryendpoint: ENDPOINT }), point(undefined, { edrqueryendpoint: ENDPOINT }), point('c'), point(undefined, { edrqueryendpoint: ENDPOINT })];
    expect(locationIdFindings(features)).toEqual([{
      severity: 'warning',
      path: '/features/1',
      message: '2 of 4 locations have no id, so a client can\'t tell what to put in /locations/{locationId}',
      rule: [EDR.locationsQuery, EDR.locationsList, RFC.featureId],
    }]);
    expect(locationIdFindings([point('a'), point(undefined, { edrqueryendpoint: ENDPOINT })])[0].message).toBe('1 of 2 locations has no id, so a client can\'t tell what to put in /locations/{locationId}');
  });

  it('notes those that have no edrqueryendpoint either, which a client can neither name nor reach', () => {
    const features = [point('a'), point(undefined, { edrqueryendpoint: ENDPOINT }), point(undefined), point(undefined, { edrqueryendpoint: '' })];
    expect(severities(features)).toEqual(['warning', 'info']);
    expect(locationIdFindings(features)[1]).toEqual({
      severity: 'info',
      path: '/features/2',
      message: '2 of 4 locations have neither an id nor an edrqueryendpoint, so a client can\'t name or reach them',
      rule: EDR.locationsQuery,
    });
    // A location with an id is named, whatever else it has
    expect(severities([point('a'), point(undefined, { edrqueryendpoint: ENDPOINT })])).toEqual(['warning']);
  });

  it('takes only a string with something in it, or a number, for an id, as GeoJSON has them', () => {
    expect(severities([point(0), point(-1.5), point('0')])).toEqual(['pass']);
    for (const id of ['', null, {}, [1], true]) {
      expect(locationIdFindings([point(id)])[0].message, JSON.stringify(id)).toBe('1 of 1 locations has no id, so a client can\'t tell what to put in /locations/{locationId}');
    }
  });

  it('counts what isn’t a feature as a location with nothing to name it by', () => {
    expect(locationIdFindings(['junk', null, point('a')]).map(each => each.message)).toEqual([
      '2 of 3 locations have no id, so a client can\'t tell what to put in /locations/{locationId}',
      '2 of 3 locations have neither an id nor an edrqueryendpoint, so a client can\'t name or reach them',
    ]);
  });

  it('says nothing of an empty list, and groups thousands', () => {
    expect(locationIdFindings([])).toEqual([]);
    const many = Array.from({ length: 6102 }, (_, index) => point(index === 0 ? undefined : `s${index}`));
    expect(locationIdFindings(many)[0].message).toBe('1 of 6,102 locations has no id, so a client can\'t tell what to put in /locations/{locationId}');
  });

  it('cites the locations query and its list, in both versions, and GeoJSON’s id', () => {
    expect(EDR.locationsQuery.edr).toEqual({ '1.1': EDR11.locationsQuery, '1.2': EDR12.locationsQuery });
    expect(EDR.locationsList.edr).toEqual({ '1.1': EDR11.locationsList, '1.2': EDR12.locationsList });
    expect(EDR11.locationsQuery.label).toBe('EDR 1.1 8.2.8');
    // The clause's own paragraph, "If a location id is not defined …", which the standards' test can't tell from another
    // paragraph's, as it names no requirement
    expect(EDR11.locationsQuery.url).toBe('https://docs.ogc.org/is/19-086r6/19-086r6.html#_76907fac-bf01-f4f3-6672-cbc8f25486c0');
    expect(EDR12.locationsQuery.url).toBe('https://docs.ogc.org/is/19-086r9/19-086r9.html#_c7ea2a8a-9696-0d9f-7141-fb986d941c20');
    expect(EDR12.locationsList.label).toBe('EDR 1.2 /req/edr/rc-locations B, test B.151');
    expect(EDR11.locationsList.label).toBe('EDR 1.1 /req/edr/rc-locations D, test B.159');
    expect(RFC.featureId).toEqual({ label: 'GeoJSON (RFC 7946) §3.2', url: 'https://www.rfc-editor.org/rfc/rfc7946.html#section-3.2' });
  });
});
