import { describe, expect, it } from 'vitest';
import { coverageParameters, distinctLabel, getTimeSeriesError, isTimeSeriesCoverage, parameterLabel, parameterUnit } from './coverageTimeSeries';
import dwdPosition from './__fixtures__/dwd-position-multipolygonseries.json';
import dwdArea from './__fixtures__/dwd-area-multipolygonseries.json';
import fmiPosition from './__fixtures__/fmi-position-pointseries.json';
import fmiLocation from './__fixtures__/fmi-location-pointseries-5d.json';
import hidrografico from './__fixtures__/hidrografico-collection-parameters.json';
import dmiPosition from './__fixtures__/dmi-position-grid.json';
import knmiProfile from '../coverage/__fixtures__/profiles/knmi-pl-position.json';

const firstCoverage = (doc: { type: string; coverages?: unknown[] }) =>
  doc.type === 'CoverageCollection' ? doc.coverages![0] : doc;

describe('getTimeSeriesError', () => {
  it('accepts a MultiPolygonSeries with a single grid cell polygon (DWD position)', () => {
    expect(getTimeSeriesError(firstCoverage(dwdPosition))).toBeNull();
  });

  it('accepts PointSeries coverages (FMI)', () => {
    expect(getTimeSeriesError(fmiPosition)).toBeNull();
    expect(getTimeSeriesError(fmiLocation)).toBeNull();
  });

  it('rejects a MultiPolygonSeries with many polygons (DWD area) and names the axis', () => {
    expect(getTimeSeriesError(firstCoverage(dwdArea))).toMatch(/composite/);
  });

  it.each([
    ['single-point Grid', { domain: { axes: { x: { values: [1] }, y: { values: [2] }, t: { values: ['2026-01-01T00:00:00Z'] } } } }, null],
    ['regular axis with num 1', { domain: { axes: { x: { start: 1, stop: 1, num: 1 }, y: { values: [2] }, t: { values: ['a'] } } } }, null],
    ['Grid with several z levels', { domain: { axes: { x: { values: [1] }, y: { values: [2] }, z: { values: [1, 2, 3] }, t: { values: ['a'] } } } }, /z/],
    ['vertical profile without t', { domain: { axes: { x: { values: [1] }, y: { values: [2] }, z: { values: [1, 2] } } } }, /time axis/],
    ['domain given by URL', { domain: 'http://example.com/domain' }, /axes/],
    ['null', null, /axes/],
  ])('%s', (_name, coverage, expected) => {
    const error = getTimeSeriesError(coverage);
    if (expected === null) {
      expect(error).toBeNull();
    } else {
      expect(error).toMatch(expected);
    }
    expect(isTimeSeriesCoverage(coverage)).toBe(expected === null);
  });
});

// Instituto Hidrográfico (tide_obs_nrt): the CoverageCollection defines parameters once, the coverages
// have only ranges, and the range lists only its t axis (x and y hold one value each)
describe('coverage collection parameters', () => {
  const [coverage] = hidrografico.coverages;

  it('charts a coverage whose range names only the t axis', () => {
    expect(isTimeSeriesCoverage(coverage)).toBe(true);
  });

  it("uses the collection's parameters when the coverage has none", () => {
    expect(coverage).not.toHaveProperty('parameters');
    const parameters = coverageParameters(coverage as { parameters?: Record<string, unknown> }, hidrografico.parameters);
    expect(parameters).toEqual(hidrografico.parameters);
    expect(Object.keys(parameters!)).toEqual(Object.keys(coverage.ranges));
  });

  it("keeps a coverage's own parameter definitions over the collection's", () => {
    const own = { t2m: { label: 'own' } };
    expect(coverageParameters({ parameters: own }, { t2m: { label: 'collection' }, rh: { label: 'collection' } }))
      .toEqual({ t2m: { label: 'own' }, rh: { label: 'collection' } });
    expect(coverageParameters({ parameters: own })).toEqual(own);
    expect(coverageParameters({})).toBeUndefined();
  });
});

describe('parameterLabel', () => {
  it("prefers the observed property's label, then the description, then the id", () => {
    expect(parameterLabel('t2m', { observedProperty: { label: { en: 'Air temperature' } }, description: { en: 'Temperature at 2 m' } })).toBe('Air temperature');
    expect(parameterLabel('t2m', { observedProperty: { label: { fi: 'Lämpötila' } } })).toBe('Lämpötila');
    expect(parameterLabel('t2m', { description: { en: 'Temperature at 2 m' } })).toBe('Temperature at 2 m');
    expect(parameterLabel('t2m', {})).toBe('t2m');
    expect(parameterLabel('t2m')).toBe('t2m');
  });

  it('skips labels that are links (DMI)', () => {
    expect(parameterLabel('dew-point-temperature-2m', dmiPosition.parameters['dew-point-temperature-2m'])).toBe('2 metre dewpoint temperature');
    expect(parameterLabel('x', { observedProperty: { label: { en: 'http://vocab.nerc.ac.uk/x' } } })).toBe('x');
  });

  it('skips blank labels', () => {
    expect(parameterLabel('x', { observedProperty: { label: { en: ' ' } }, description: { en: 'Wind speed' } })).toBe('Wind speed');
  });

  // CoverageJSON 9.3: a parameter's label is its name
  it('takes the parameter’s own label first', () => {
    expect(parameterLabel('t2m', { label: { en: 'Temperature at 2 m' }, observedProperty: { label: { en: 'Air temperature' } } })).toBe('Temperature at 2 m');
    expect(parameterLabel('t2m', { label: 'Temperature at 2 m', observedProperty: { label: { en: 'Air temperature' } } })).toBe('Temperature at 2 m');
    const knmi = knmiProfile.coverages[0].parameters.air_temperature_pl;
    expect(parameterLabel('air_temperature_pl', knmi)).toBe('UWCW_HA43(DINI) Air temperature at pressure level');
  });

  it('passes over its own label where it only repeats the id, is a link or is blank (DWD)', () => {
    const t2m = firstCoverage(dwdArea) as { parameters: Record<string, Parameters<typeof parameterLabel>[1]> };
    expect(parameterLabel('T_2M', t2m.parameters.T_2M)).toBe('Air Temperature');
    expect(parameterLabel('t2m', { label: { en: 'T2M' }, observedProperty: { label: { en: 'Air temperature' } } })).toBe('Air temperature');
    expect(parameterLabel('t2m', { label: { en: 'https://example.org/t2m' }, observedProperty: { label: { en: 'Air temperature' } } })).toBe('Air temperature');
    expect(parameterLabel('t2m', { label: { en: ' ' }, observedProperty: { label: { en: 'Air temperature' } } })).toBe('Air temperature');
    expect(parameterLabel('t2m', { label: { en: 'T2M' } })).toBe('t2m');
  });

  it('reads any language, English first', () => {
    expect(parameterLabel('t2m', { label: { de: 'Lufttemperatur' } })).toBe('Lufttemperatur');
    expect(parameterLabel('t2m', { observedProperty: { label: { fi: 'Lämpötila', 'en-GB': 'Air temperature' } } })).toBe('Air temperature');
    expect(parameterLabel('t2m', { observedProperty: { label: { und: 'T2m' } } })).toBe('T2m');
    expect(parameterLabel('t2m', { description: { de: 'Temperatur in 2 m' } })).toBe('Temperatur in 2 m');
  });
});

describe('text where text should be', () => {
  it('takes a unit that isn’t text as none', () => {
    expect(parameterUnit({ unit: { symbol: 5 } })).toBe('');
    expect(parameterUnit({ unit: { symbol: { value: 1, type: 'x' } } })).toBe('');
    expect(parameterUnit({ unit: { symbol: null } })).toBe('');
    expect(parameterUnit({ unit: { label: { en: 5 } } })).toBe('');
    expect(parameterUnit({ unit: { label: { fi: 5 } } })).toBe('');
    expect(parameterUnit({ unit: { symbol: { value: 7 }, label: { en: 'kelvin' } } })).toBe('kelvin');
  });

  it('takes a label that isn’t text as none, and goes on to the next', () => {
    expect(parameterLabel('t', { observedProperty: { label: { en: 123 } } })).toBe('t');
    expect(parameterLabel('t', { observedProperty: { label: { en: 123, fi: 'Lämpötila' } } })).toBe('Lämpötila');
    expect(parameterLabel('t', { observedProperty: { label: { en: { text: 'x' } } }, description: { en: 'Temperature' } })).toBe('Temperature');
  });
});

describe('distinctLabel', () => {
  it('keeps a label that says more than the id', () => {
    expect(distinctLabel('t', 'Temperature')).toBe('Temperature');
  });

  it('drops one that only repeats it, whatever the capitals (FMI’s WindSpeedMS)', () => {
    expect(distinctLabel('t2m', 't2m')).toBeNull();
    expect(distinctLabel('windspeedms', 'WindSpeedMS')).toBeNull();
    expect(distinctLabel('DBZH', 'dbzh')).toBeNull();
  });
});

describe('parameterUnit', () => {
  it('reads a symbol written either way', () => {
    expect(parameterUnit({ unit: { symbol: 'K' } })).toBe('K');
    expect(parameterUnit({ unit: { symbol: { value: 'K' } } })).toBe('K');
  });

  it('falls back on the label', () => {
    expect(parameterUnit({ unit: { label: { en: 'kelvin' } } })).toBe('kelvin');
    expect(parameterUnit({ unit: { label: { fi: 'kelviniä' } } })).toBe('kelviniä');
    expect(parameterUnit({ unit: { symbol: {}, label: { en: 'kelvin' } } })).toBe('kelvin');
  });

  it('reads a label in any language, English first', () => {
    expect(parameterUnit({ unit: { label: { de: 'Kelvin' } } })).toBe('Kelvin');
    expect(parameterUnit({ unit: { label: { fi: 'kelviniä', 'en-GB': 'kelvin' } } })).toBe('kelvin');
    expect(parameterUnit({ unit: { label: 'kelvin' } })).toBe('kelvin');
  });

  it('has none without one, or where UCUM says so', () => {
    expect(parameterUnit(undefined)).toBe('');
    expect(parameterUnit({})).toBe('');
    expect(parameterUnit({ unit: { symbol: { value: '1' } } })).toBe('');
  });
});
