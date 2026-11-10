import { describe, expect, it } from 'vitest';
import { parameterFindings } from './parameterChecks';
import { COVJSON, EDR12, METOCEAN_COMMON_DRAFT, RFC } from '../standards';
import knmi from './__fixtures__/profiles/knmi-pl-position.json';
import ifs from './__fixtures__/profiles/mc-ifs-1t-all.json';
import fmi from './__fixtures__/profiles/fmi-ecmwf-1t-all.json';
import dmi from './__fixtures__/profiles/dmi-pl-1t-3p.json';

type Json = Record<string, unknown>;

// As the summary calls it
function findings(json: unknown) {
  const doc = json as Json;
  const isCollection = doc.type === 'CoverageCollection';
  const coverages = (isCollection ? doc.coverages as Json[] : [doc]);
  return parameterFindings(doc, coverages, index => (isCollection ? `/coverages/${index}` : ''));
}

// One coverage with these parameters
const coverage = (parameters: Json) => ({ type: 'Coverage', domain: { type: 'Domain', axes: {} }, parameters, ranges: {} });
const parameter = (more: Json = {}) => ({ type: 'Parameter', observedProperty: { label: { en: 'Air temperature' } }, unit: { symbol: 'K' }, ...more });
const ucum = (value: string, type = 'http://www.opengis.net/def/uom/UCUM/') => ({ symbol: { value, type } });
const messages = (json: unknown) => findings(json).map(each => each.message);

describe('parameterFindings: the KNMI response', () => {
  const found = findings(knmi);

  it('finds its four faults, each once', () => {
    expect(found.map(each => [each.severity, each.message])).toEqual([
      ['error', 'air_temperature_pl\'s label has the language "en:", and likewise for 1 more parameter. That isn\'t a language tag, such as "en"'],
      ['warning', 'air_temperature_pl\'s unit type is http://www.opengis.net/def/uom/UCUM, and likewise for 1 more parameter. For UCUM it must be http://www.opengis.net/def/uom/UCUM/'],
      ['warning', 'air_temperature_pl\'s unit is "C" in UCUM. That\'s the coulomb. Degrees Celsius is "Cel"'],
      ['warning', 'relative_humidity_pl\'s unit is "-" in UCUM. That isn\'t a UCUM code. UCUM writes no unit as "1"'],
    ]);
  });

  it('says where each is, in the coverage that first defines it', () => {
    expect(found.map(each => each.path)).toEqual([
      '/coverages/0/parameters/air_temperature_pl/label',
      '/coverages/0/parameters/air_temperature_pl/unit/symbol/type',
      '/coverages/0/parameters/air_temperature_pl/unit/symbol/value',
      '/coverages/1/parameters/relative_humidity_pl/unit/symbol/value',
    ]);
  });

  it('cites the rules', () => {
    expect(found[0].rule).toEqual([COVJSON.i18n, COVJSON.conformance, RFC.languageTag]);
    expect(found[1].rule).toEqual(COVJSON.unit);
    expect(found[2].rule).toEqual(COVJSON.unit);
    expect(found[3].rule).toEqual(COVJSON.unit);
  });
});

describe('parameterFindings: unit types', () => {
  it('notes a QUDT unit in the type once for MeteoCore, citing the custom value it is allowed as, and the MetOcean Common draft that asks for it', () => {
    const [found, ...rest] = findings(ifs);
    expect(rest).toEqual([]);
    expect(found).toEqual({
      severity: 'info',
      message: 'r\'s unit type is https://qudt.org/vocab/unit/PERCENT, and likewise for 2 more parameters. That names a unit, where CoverageJSON\'s type names the scheme the symbol is written in, such as UCUM. A custom one is allowed, but a unit\'s URI fits unit.id',
      path: '/parameters/r/unit/symbol/type',
      rule: [COVJSON.unit, COVJSON.customValue, METOCEAN_COMMON_DRAFT.qudtUnits],
    });
  });

  it('notes UCUM with https, where EDR 1.2 and CoverageJSON differ, citing both', () => {
    const [found, ...rest] = findings(coverage({ t: parameter({ unit: ucum('K', 'https://www.opengis.net/def/uom/UCUM/') }) }));
    expect(rest).toEqual([]);
    expect(found).toEqual({
      severity: 'info',
      message: 't\'s unit type is https://www.opengis.net/def/uom/UCUM/. That\'s EDR 1.2\'s, for a collection\'s parameters. CoverageJSON\'s is http://www.opengis.net/def/uom/UCUM/, so the two standards differ',
      path: '/parameters/t/unit/symbol/type',
      rule: [COVJSON.unit, EDR12.parameterUnit],
    });
  });

  it('calls any other spelling of UCUM an issue', () => {
    for (const type of ['http://www.opengis.net/def/uom/UCUM', 'https://www.opengis.net/def/uom/UCUM', 'http://www.opengis.net/def/uom/ucum/']) {
      const [found] = findings(coverage({ t: parameter({ unit: ucum('K', type) }) }));
      expect(found.severity, type).toBe('warning');
      expect(found.message, type).toBe(`t's unit type is ${type}. For UCUM it must be http://www.opengis.net/def/uom/UCUM/`);
    }
  });

  it('says nothing of UCUM as CoverageJSON has it, another scheme, or a symbol without a type', () => {
    expect(findings(coverage({ t: parameter({ unit: ucum('K') }) }))).toEqual([]);
    expect(findings(coverage({ t: parameter({ unit: ucum('degreeC', 'http://www.opengis.net/def/uom/UDUNITS/') }) }))).toEqual([]);
    expect(findings(coverage({ t: parameter({ unit: { symbol: 'C' } }) }))).toEqual([]);
    expect(findings(coverage({ t: parameter({ unit: { symbol: { value: 'C' } } }) }))).toEqual([]);
  });
});

describe('parameterFindings: UCUM codes that mean something else', () => {
  const said = (id: string, value: string, more: Json = {}) => messages(coverage({ [id]: parameter({ unit: ucum(value), ...more }) }));

  // Each named by its id alone, so that only that name agrees
  const named = (label: string) => ({ observedProperty: { label: { en: label } } });

  it('knows each, where the name agrees', () => {
    expect(said('air_temperature', 'C', named('Air'))).toEqual(['air_temperature\'s unit is "C" in UCUM. That\'s the coulomb. Degrees Celsius is "Cel"']);
    expect(said('t2m', 'degC', named('T'))).toEqual(['t2m\'s unit is "degC" in UCUM. That isn\'t a UCUM code. Degrees Celsius is "Cel"']);
    expect(said('mslp', 'mb', named('Mean sea level'))).toEqual(['mslp\'s unit is "mb" in UCUM. That\'s the millibarn. A millibar is "mbar"']);
    expect(said('wind_speed', 'kt', named('Speed'))).toEqual(['wind_speed\'s unit is "kt" in UCUM. That\'s the kilotonne. A knot is "[kn_i]"']);
    expect(said('gust', 'kts', named('Gust'))).toEqual(['gust\'s unit is "kts" in UCUM. That isn\'t a UCUM code. A knot is "[kn_i]"']);
    expect(said('cloud', '-', named('Cloud'))).toEqual(['cloud\'s unit is "-" in UCUM. That isn\'t a UCUM code. UCUM writes no unit as "1"']);
  });

  it('only where the name is the code’s own kind', () => {
    expect(said('air_temperature', 'mb', named('Air'))).toEqual([]);
    expect(said('air_temperature', 'kt', named('Air'))).toEqual([]);
    expect(said('mslp', 'C', named('Mean sea level'))).toEqual([]);
    expect(said('wind_speed', 'mb', named('Speed'))).toEqual([]);
  });

  it('reads the name from the labels too', () => {
    const named = { observedProperty: { label: { en: 'Something' } } };
    expect(said('ta', 'C', { observedProperty: { label: { en: 'Air temperature' } } })).toHaveLength(1);
    expect(said('ta', 'C', { ...named, label: { en: 'Temperature' } })).toHaveLength(1);
    expect(said('ta', 'C', named)).toEqual([]);
  });

  it('leaves a code be where the name doesn’t agree', () => {
    expect(said('charge', 'C', { observedProperty: { label: { en: 'Charge' } } })).toEqual([]);
    expect(said('cross_section', 'mb', { observedProperty: { label: { en: 'Cross section' } } })).toEqual([]);
    expect(said('yield', 'kt', { observedProperty: { label: { en: 'Yield' } } })).toEqual([]);
  });

  it('only in UCUM, however its type is spelt', () => {
    expect(messages(coverage({ t2m: parameter({ unit: ucum('C', 'http://www.opengis.net/def/uom/UDUNITS/') }) }))).toEqual([]);
    expect(messages(coverage({ t2m: parameter({ unit: ucum('C', 'https://www.opengis.net/def/uom/UCUM/') }) }))).toHaveLength(2);
  });
});

describe('parameterFindings: labels', () => {
  it('calls a label that isn’t an i18n object an error', () => {
    expect(findings(coverage({ t: parameter({ label: 'Temperature' }) }))).toEqual([{
      severity: 'error', message: 't\'s label is text. CoverageJSON has an i18n object: {"en": "Temperature"}', path: '/parameters/t/label', rule: [COVJSON.label, { edr: { '1.2': EDR12.parameterLabel } }],
    }]);
    expect(messages(coverage({ t: parameter({ label: ['Temperature'] }) }))).toEqual(['t\'s label isn\'t an i18n object']);
    expect(messages(coverage({ t: parameter({ label: null }) }))).toEqual(['t\'s label isn\'t an i18n object']);
    expect(findings(coverage({ t: parameter({ label: { en: 'Temperature', fi: 5 } }) }))).toEqual([{
      severity: 'error', message: 't\'s label in "fi" isn\'t text', path: '/parameters/t/label/fi', rule: [COVJSON.i18n, COVJSON.conformance],
    }]);
  });

  it('takes good language tags as they are', () => {
    expect(findings(coverage({ t: parameter({ label: { en: 'Temperature at 2 m', 'en-GB': 'Temperature at 2 m', und: 'T2m' } }) }))).toEqual([]);
  });

  it('notes a label the same as its observed property’s, as FMI sends them', () => {
    const found = findings(fmi);
    expect(found[0]).toEqual({
      severity: 'info',
      message: 'geopheight\'s label repeats its observed property\'s, and likewise for 3 more parameters. CoverageJSON says to leave it out then',
      path: '/parameters/geopheight/label',
      rule: COVJSON.label,
    });
  });

  it('only where every language is the same', () => {
    const observedProperty = { label: { en: 'Air temperature', fi: 'Lämpötila' } };
    expect(messages(coverage({ t: parameter({ observedProperty, label: { en: 'Air temperature', fi: 'Lämpötila' } }) }))).toHaveLength(1);
    expect(messages(coverage({ t: parameter({ observedProperty, label: { en: 'Air temperature' } }) }))).toEqual([]);
    expect(messages(coverage({ t: parameter({ observedProperty, label: { en: 'Air temperature', fi: 'Ilman lämpötila' } }) }))).toEqual([]);
    expect(messages(coverage({ t: parameter({ observedProperty: { label: {} }, label: {} }) }))).toEqual([]);
    // What isn't text is said once, as that, and not as repeated
    expect(messages(coverage({ t: parameter({ observedProperty: { label: { en: 5 } }, label: { en: 5 } }) }))).toEqual(['t\'s label in "en" isn\'t text']);
  });
});

describe('parameterFindings: no unit', () => {
  it('says so once where no parameter has one, naming two', () => {
    expect(findings(dmi)).toEqual([{ severity: 'info', message: 'No parameter has a unit: temperature-850hPa, temperature-1000hPa and 1 more', path: '/parameters/temperature-850hPa', rule: [COVJSON.unit, METOCEAN_COMMON_DRAFT.parameterFields] }]);
    expect(messages(coverage({ a: parameter({ unit: undefined }), b: parameter({ unit: undefined }) }))).toEqual(['No parameter has a unit: a, b']);
    expect(findings(fmi)[1].message).toBe('No parameter has a unit: geopheight, humidity and 2 more');
  });

  it('names the one, where only some lack one', () => {
    expect(findings(coverage({ DBZH: parameter(), RHOHV: parameter({ unit: undefined }) }))).toEqual([{ severity: 'info', message: 'RHOHV has no unit', path: '/parameters/RHOHV', rule: [COVJSON.unit, METOCEAN_COMMON_DRAFT.parameterFields] }]);
    expect(messages(coverage({ a: parameter(), b: parameter({ unit: undefined }), c: parameter({ unit: undefined }) }))).toEqual(['b has no unit, and likewise for 1 more parameter']);
    expect(messages(coverage({ a: parameter({ unit: undefined }) }))).toEqual(['a has no unit']);
  });

  it('leaves out a parameter of categories, which mustn’t have one', () => {
    const categories = { label: { en: 'Land cover' }, categories: [{ id: 'water', label: { en: 'Water' } }] };
    expect(messages(coverage({ land: parameter({ unit: undefined, observedProperty: categories }), t: parameter() }))).toEqual([]);
    expect(messages(coverage({ land: parameter({ unit: undefined, observedProperty: categories }), t: parameter({ unit: undefined }) }))).toEqual(['t has no unit']);
  });
});

describe('parameterFindings: where parameters are defined', () => {
  const collection = (parameters: Json | undefined, own: Json[]) => ({
    type: 'CoverageCollection', ...(parameters ? { parameters } : {}),
    coverages: own.map(each => ({ type: 'Coverage', domain: { type: 'Domain', axes: {} }, parameters: each, ranges: {} })),
  });

  it('checks the collection’s definition, and each parameter once', () => {
    const json = collection({ t: parameter({ unit: ucum('C') }) }, [{ t: parameter({ unit: ucum('C') }) }, { t: parameter({ unit: ucum('C') }) }]);
    const found = findings(json);
    expect(found.map(each => each.path)).toEqual(['/parameters/t/unit/symbol/value']);
    expect(found[0].message).not.toContain('likewise');
  });

  it('checks a coverage’s own, where the collection has none', () => {
    const found = findings(collection(undefined, [{ a: parameter() }, { b: parameter({ unit: ucum('C') }) }]));
    expect(found.map(each => each.path)).toEqual(['/coverages/1/parameters/b/unit/symbol/value']);
  });

  it('writes an id with a slash or a tilde as a JSON pointer has it', () => {
    expect(findings(coverage({ 'a/b~c': parameter({ unit: undefined }) }))[0].path).toBe('/parameters/a~1b~0c');
  });

  it('passes over what isn’t a parameter object', () => {
    expect(findings({ type: 'Coverage', parameters: { t: 'K' } })).toEqual([]);
    expect(findings({ type: 'Coverage', parameters: ['t'] })).toEqual([]);
    expect(findings({ type: 'Coverage' })).toEqual([]);
  });
});
