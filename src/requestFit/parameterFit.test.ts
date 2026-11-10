import { describe, expect, it } from 'vitest';
import { askedParameterFindings, coverageParameters, featureParameters } from './parameterFit';
import { EDR } from '../standards';
import type { Collection } from '../types/api';
import meteocore from './__fixtures__/meteocore-ecmwf-aifs-single-collection.json';
import meteocoreNone from './__fixtures__/meteocore-ecmwf-aifs-single-none.json';
import knmi from './__fixtures__/knmi-hagl-collection.json';
import knmiNone from './__fixtures__/knmi-hagl-none.json';
import knmiComponents from './__fixtures__/knmi-hagl-components.json';
import fmi from './__fixtures__/fmi-ecmwf-collection.json';
import fmiUpper from './__fixtures__/fmi-ecmwf-temperature-upper.json';
import fmiGeojson from './__fixtures__/fmi-ecmwf-geojson.json';

// Each response as its server sent it, on 2026-11-11, with the collection it's of
const MC = meteocore as unknown as Collection;
const KNMI = knmi as unknown as Collection;
const FMI = fmi as unknown as Collection;
const MC_URL = 'https://meteocore.app.meteo.fi/edr/collections/ecmwf-aifs-single/position?coords=POINT(24.94 60.17)';
const KNMI_URL = 'https://geoservices.knmi.nl/edr/collections/uwcw-ha-det-dini-5p5km.hagl/position?coords=POINT(5.18 52.1)&datetime=2026-11-12T00:00:00Z';
const FMI_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf/position?coords=POINT(24.94 60.17)&datetime=2026-11-12T00:00:00Z';

// A coverage of these parameters, one value each
const coverage = (...ids: string[]) => ({
  type: 'Coverage',
  domain: { type: 'Domain', domainType: 'Point', axes: { x: { values: [1] }, y: { values: [2] } } },
  ranges: Object.fromEntries(ids.map(id => [id, { type: 'NdArray', dataType: 'float', values: [1] }])),
});
const URL_ = 'https://api.example.com/collections/a/position?coords=POINT(1 2)';
const asked = (names: string) => `${URL_}&parameter-name=${names}`;
const messages = (found: { message: string }[]) => found.map(each => each.message);

describe('coverageParameters', () => {
  it('names each parameter with a range, where it first is', () => {
    expect(coverageParameters(coverage('t', 'a/b'))).toEqual([{ id: 't', path: '/ranges/t' }, { id: 'a/b', path: '/ranges/a~1b' }]);
    expect(coverageParameters(knmiNone)?.slice(0, 2)).toEqual([
      { id: 'air_temperature_hagl', path: '/coverages/0/ranges/air_temperature_hagl' },
      { id: 'dew_point_temperature_hagl', path: '/coverages/1/ranges/dew_point_temperature_hagl' },
    ]);
  });

  it('names one in several coverages where it first is', () => {
    const twice = { type: 'CoverageCollection', coverages: [{ type: 'Coverage', domain: {} }, coverage('t'), coverage('t', 'u')] };
    expect(coverageParameters(twice)).toEqual([{ id: 't', path: '/coverages/1/ranges/t' }, { id: 'u', path: '/coverages/2/ranges/u' }]);
  });

  it('is null for what holds no ranges, or isn’t coverage data', () => {
    expect(coverageParameters({ type: 'Coverage', domain: {} })).toBeNull();
    expect(coverageParameters({ type: 'CoverageCollection', coverages: [] })).toBeNull();
    expect(coverageParameters(fmiGeojson)).toBeNull();
    expect(coverageParameters(null)).toBeNull();
  });
});

describe('featureParameters', () => {
  it('takes a feature’s properties named as a parameter asked for or listed, in any letter case or in parts', () => {
    // FMI's: its time isn't a parameter, nor its parameters' ids, Temperature and Pressure, outside the features
    expect(featureParameters(fmiGeojson, ['temperature', 'pressure', 'humidity'])).toEqual([
      { id: 'pressure', path: '/features/0/properties/pressure' },
      { id: 'temperature', path: '/features/0/properties/temperature' },
    ]);
    const features = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'x' } }, { type: 'Feature', properties: { T: [1], 'wind.u': [2] } }] };
    expect(featureParameters(features, ['t', 'wind'])).toEqual([{ id: 'T', path: '/features/1/properties/T' }, { id: 'wind.u', path: '/features/1/properties/wind.u' }]);
    // A part is after a mark, not a longer word: temperature and t2m aren't parts of t
    expect(featureParameters({ type: 'FeatureCollection', features: [{ properties: { temperature: 1, t2m: 1, t_max: 2 } }] }, ['t'])).toEqual([{ id: 't_max', path: '/features/0/properties/t_max' }]);
  });

  it('names each once, where it first is, however many features have it', () => {
    const features = { type: 'FeatureCollection', features: [{ properties: { a: 1 } }, { properties: { b: 1, a: 2 } }, { properties: { a: 3 } }] };
    expect(featureParameters(features, ['a', 'b'])).toEqual([{ id: 'a', path: '/features/0/properties/a' }, { id: 'b', path: '/features/1/properties/b' }]);
  });

  it('is null where none is, as for what isn’t GeoJSON', () => {
    expect(featureParameters(fmiGeojson, ['humidity'])).toBeNull();
    expect(featureParameters({ type: 'FeatureCollection', features: [] }, ['t'])).toBeNull();
    expect(featureParameters(coverage('t'), ['t'])).toBeNull();
    // Features with no FeatureCollection around them aren't one
    expect(featureParameters({ type: 'Topology', features: [{ properties: { t: 1 } }] }, ['t'])).toBeNull();
  });
});

describe('askedParameterFindings, with parameter-name', () => {
  it('passes the parameters asked for, and only those', () => {
    expect(askedParameterFindings(coverage('2t', 'msl'), { url: asked('msl,2t'), collection: null })).toEqual([
      { severity: 'pass', path: '/ranges/2t', rule: EDR.parameterNameResponseA, message: 'The response has the parameters asked for, and only those: msl and 2t' },
    ]);
  });

  it('makes an error of one not asked for: only those named must come back', () => {
    expect(askedParameterFindings(coverage('2t', 'msl', 'sp', 'tp', 'tcc'), { url: asked('2t'), collection: null })).toEqual([{
      severity: 'error', path: '/ranges/msl', rule: EDR.parameterNameResponseA,
      message: 'The response has 4 parameters not asked for: msl, sp, tp and 1 more. Only those asked for must come back',
    }]);
  });

  it('notes one asked for and missing, which breaks nothing', () => {
    expect(askedParameterFindings(coverage('2t'), { url: asked('2t,msl'), collection: null })).toEqual([{ severity: 'info', message: "Asked for msl, and the response hasn't it" }]);
    expect(messages(askedParameterFindings(coverage('2t'), { url: asked('2t,msl,sp'), collection: null }))).toEqual(["Asked for msl and sp, and the response hasn't them"]);
  });

  it('makes an error of a parameter sent in parts named after it, as KNMI sends a vector', () => {
    const [found, ...rest] = askedParameterFindings(knmiComponents, { url: `${KNMI_URL}&parameter-name=wind_speed_components_hagl`, collection: KNMI });
    expect(rest).toEqual([]);
    expect(found).toEqual({
      severity: 'error', path: '/coverages/0/ranges/wind_speed_components_hagl.speed_component', rule: EDR.parameterNameResponseA,
      message: 'Asked for wind_speed_components_hagl, and the response has 6 parameters named after it instead: wind_speed_components_hagl.speed_component, wind_speed_components_hagl.direction_component, wind_speed_components_hagl.eastward_component and 3 more',
    });
  });

  it('makes an error of a name sent in another letter case', () => {
    // The collection lists the name asked for, or isn't known
    const listsIt = { ...FMI, parameter_names: { Temperature: {} } } as unknown as Collection;
    for (const collection of [listsIt, null]) {
      expect(askedParameterFindings(fmiUpper, { url: `${FMI_URL}&parameter-name=Temperature`, collection })).toEqual([{
        severity: 'error', path: '/ranges/temperature', rule: EDR.parameterNameResponseA,
        message: 'Asked for Temperature, and the response has temperature instead: the names differ in letter case',
      }]);
    }
  });

  it('notes a name asked for in another letter case than the collection lists, sent as it lists it: as FMI does', () => {
    expect(askedParameterFindings(fmiUpper, { url: `${FMI_URL}&parameter-name=Temperature`, collection: FMI })).toEqual([{
      severity: 'info', path: '/ranges/temperature', rule: EDR.parameterNameResponseB,
      message: "Asked for Temperature, which the collection doesn't list, and the response has temperature, as the collection lists it: the server read the name in any letter case",
    }]);
    // Where the collection lists both, the one asked for is another parameter, and the server sent the wrong one
    const both = { ...FMI, parameter_names: { Temperature: {}, temperature: {} } } as unknown as Collection;
    expect(askedParameterFindings(fmiUpper, { url: `${FMI_URL}&parameter-name=Temperature`, collection: both }).map(each => each.severity)).toEqual(['error']);
  });

  it('says several of a kind in one finding, the first three by name', () => {
    expect(messages(askedParameterFindings(coverage('A', 'B', 'c'), { url: asked('a,b,c'), collection: null })))
      .toEqual(['Asked for a and b, and the response has A and B instead: the names differ in letter case']);
    expect(messages(askedParameterFindings(coverage('a', 'x', 'y', 'z'), { url: asked('a'), collection: null })))
      .toEqual(['The response has 3 parameters not asked for: x, y and z. Only those asked for must come back']);
    const listsThem = { ...FMI, parameter_names: { temperature: {}, pressure: {} } } as unknown as Collection;
    expect(messages(askedParameterFindings(coverage('temperature', 'pressure'), { url: asked('Temperature,Pressure'), collection: listsThem })))
      .toEqual(["Asked for Temperature and Pressure, which the collection doesn't list, and the response has temperature and pressure, as the collection lists them: the server read the names in any letter case"]);
  });

  it('checks an instance’s query as any other against what it asked for', () => {
    const instance = `${KNMI_URL.replace('/position', '/instances/2026-11-10T00:00:00Z/position')}&parameter-name=wind_speed_components_hagl`;
    expect(askedParameterFindings(knmiComponents, { url: instance, collection: KNMI }).map(each => each.severity)).toEqual(['error']);
  });

  it('reads a GeoJSON response’s features, as FMI sends them', () => {
    expect(messages(askedParameterFindings(fmiGeojson, { url: `${FMI_URL}&parameter-name=temperature,pressure&f=GeoJSON`, collection: FMI })))
      .toEqual(['The response has the parameters asked for, and only those: temperature and pressure']);
    expect(messages(askedParameterFindings(fmiGeojson, { url: `${FMI_URL}&parameter-name=temperature&f=GeoJSON`, collection: FMI })))
      .toEqual(['The response has 1 parameter not asked for: pressure. Only those asked for must come back']);
    // Without the collection, by the names asked for
    expect(messages(askedParameterFindings(fmiGeojson, { url: `${FMI_URL}&parameter-name=temperature,pressure&f=GeoJSON`, collection: null })))
      .toEqual(['The response has the parameters asked for, and only those: temperature and pressure']);
  });
});

describe('askedParameterFindings, without parameter-name', () => {
  it('passes every parameter the collection lists, against the collection', () => {
    const all = coverage('air_temperature_hagl', 'dew_point_temperature_hagl', 'relative_humidity_hagl', 'wind_chill_temperature_hagl', 'wind_from_direction_hagl', 'wind_speed_components_hagl', 'wind_speed_hagl', 'wind_speed_of_gust_components_01h_hagl');
    expect(askedParameterFindings(all, { url: KNMI_URL, collection: KNMI })).toEqual([{
      severity: 'pass', source: 'collection', path: '/ranges/air_temperature_hagl', rule: EDR.parameterNameResponseA,
      message: 'No parameter-name was asked for, and the response has all 8 parameters the collection lists',
    }]);
  });

  it('makes an error of each it leaves out, as KNMI leaves out its vectors', () => {
    expect(askedParameterFindings(knmiNone, { url: KNMI_URL, collection: KNMI })).toEqual([{
      severity: 'error', source: 'collection', rule: EDR.parameterNameResponseA,
      message: "No parameter-name was asked for, so every parameter the collection lists must come back, and 2 parameters don't: wind_speed_components_hagl and wind_speed_of_gust_components_01h_hagl",
    }]);
  });

  it('notes one with no data at the datetime asked by its own extent, as MeteoCore leaves gh and z out', () => {
    const url = `${MC_URL}&datetime=2026-11-12T00:00:00Z`;
    expect(askedParameterFindings(meteocoreNone, { url, collection: MC })).toEqual([
      {
        severity: 'info', source: 'collection', rule: EDR.parameterObject,
        message: "gh and z aren't in the response, and by their own extent have no data at the datetime asked, 2026-11-12T00:00:00Z",
      },
      {
        severity: 'pass', source: 'collection', path: '/ranges/10si', rule: EDR.parameterNameResponseA,
        message: 'No parameter-name was asked for, and the response has all 17 parameters the collection lists with data at the datetime asked',
      },
    ]);
    // Without a datetime, or at one their extent has, they're left out like any other
    for (const without of [MC_URL, `${MC_URL}&datetime=2026-11-10T06:00:00Z/2026-11-12T00:00:00Z`]) {
      expect(messages(askedParameterFindings(meteocoreNone, { url: without, collection: MC })))
        .toEqual(["No parameter-name was asked for, so every parameter the collection lists must come back, and 2 parameters don't: gh and z"]);
    }
  });

  it('excuses none by its extent at a datetime that can’t be read', () => {
    expect(messages(askedParameterFindings(meteocoreNone, { url: `${MC_URL}&datetime=tomorrow`, collection: MC })))
      .toEqual(["No parameter-name was asked for, so every parameter the collection lists must come back, and 2 parameters don't: gh and z"]);
  });

  it('reads a collection’s parameters listed as an array, by their ids', () => {
    const listed = { ...KNMI, parameter_names: [{ id: 't', type: 'Parameter' }, { id: 'u', type: 'Parameter' }] } as unknown as Collection;
    expect(messages(askedParameterFindings(coverage('t'), { url: KNMI_URL, collection: listed })))
      .toEqual(["No parameter-name was asked for, so every parameter the collection lists must come back, and 1 parameter doesn't: u"]);
  });

  it('makes an error of a name in another letter case, or sent in parts, where the collection lists it', () => {
    const one = { ...KNMI, parameter_names: { wind_speed_hagl: {}, Wind_Dir: {} } } as unknown as Collection;
    expect(askedParameterFindings(coverage('wind_speed_hagl.u', 'wind_speed_hagl.v', 'wind_dir'), { url: KNMI_URL, collection: one })).toEqual([
      {
        severity: 'error', source: 'collection', path: '/ranges/wind_dir', rule: EDR.parameterNameResponseA,
        message: 'The response has wind_dir where the collection lists Wind_Dir: the names differ in letter case',
      },
      {
        severity: 'error', source: 'collection', path: '/ranges/wind_speed_hagl.u', rule: EDR.parameterNameResponseA,
        message: 'The response has 2 parameters named after wind_speed_hagl where the collection lists wind_speed_hagl: wind_speed_hagl.u and wind_speed_hagl.v',
      },
    ]);
  });

  it('makes an issue of one the collection doesn’t list, beside the pass for those it does', () => {
    const one = { ...KNMI, parameter_names: { t: {} } } as unknown as Collection;
    expect(askedParameterFindings(coverage('t', 'extra'), { url: KNMI_URL, collection: one })).toEqual([
      { severity: 'warning', source: 'collection', path: '/ranges/extra', message: "The response has 1 parameter the collection doesn't list: extra" },
      { severity: 'pass', source: 'collection', path: '/ranges/t', rule: EDR.parameterNameResponseA, message: 'No parameter-name was asked for, and the response has the one parameter the collection lists' },
    ]);
  });

  it('says nothing without the collection, of an instance, whose parameters the app hasn’t, or of a collection listing none', () => {
    expect(askedParameterFindings(knmiNone, { url: KNMI_URL, collection: null })).toEqual([]);
    const instance = KNMI_URL.replace('/position', '/instances/2026-11-10T00:00:00Z/position');
    expect(askedParameterFindings(knmiNone, { url: instance, collection: KNMI })).toEqual([]);
    expect(askedParameterFindings(knmiNone, { url: KNMI_URL, collection: { ...KNMI, parameter_names: {} } })).toEqual([]);
  });
});

describe('askedParameterFindings says nothing', () => {
  it('of what isn’t a data query’s answer, or holds no parameters to compare', () => {
    expect(askedParameterFindings(coverage('t'), { url: 'https://api.example.com/collections/a/items?parameter-name=x', collection: null })).toEqual([]);
    expect(askedParameterFindings(coverage('t'), { url: 'https://api.example.com/collections/a/locations?parameter-name=x', collection: null })).toEqual([]);
    expect(askedParameterFindings({ type: 'CoverageCollection', coverages: [] }, { url: asked('t'), collection: null })).toEqual([]);
    expect(askedParameterFindings({ code: 'x' }, { url: asked('t'), collection: null })).toEqual([]);
  });

  it('for an empty parameter-name, which names nothing and isn’t left out', () => {
    expect(askedParameterFindings(coverage('t'), { url: asked(''), collection: KNMI })).toEqual([]);
  });
});
