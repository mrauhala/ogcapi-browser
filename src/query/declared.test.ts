import { describe, expect, it } from 'vitest';
import { apiDocsParams, declaredClasses, declarersOf, undeclaredIssues, type Offer } from './declared';
import { buildOperationIndex, matchOperation } from '../validation/openapi/operationIndex';
import { COMMON1 } from '../standards';
import meteocore from './__fixtures__/meteocore-maps-params.json';

const ROOT = 'https://meteocore.app.meteo.fi';
const index = buildOperationIndex({ url: `${ROOT}/api`, doc: meteocore.api as unknown as Record<string, unknown> });
const paramsOf = (path: string) => apiDocsParams(matchOperation(index, `${ROOT}${path}`)!.entry.params);
const MAPS = '/spec/ogcapi-maps-1/1.0/conf/';

describe('apiDocsParams', () => {
  it('gives an operation’s query parameters, each with its schema’s kind, values and default, and where it is', () => {
    const params = paramsOf('/collections/ecmwf-aifs-single/map');
    expect(params.map(param => param.name)).toEqual([
      'bbox', 'bbox-crs', 'subset', 'subset-crs', 'center', 'center-crs', 'width', 'height', 'scale-denominator', 'crs', 'datetime',
      'bgcolor', 'transparent', 'void-color', 'void-transparent', 'f', 'quality', 'elevation', 'parameter-name',
    ]);
    expect(params.find(param => param.name === 'f')).toEqual({
      name: 'f', isArray: false, enumValues: ['image/png', 'image/jpeg', 'image/webp'], defaultValue: 'image/png',
      pointer: '/paths/~1collections~1ecmwf-aifs-single~1map/get/parameters/15',
    });
    expect(params.find(param => param.name === 'parameter-name')).toMatchObject({ isArray: false, enumValues: null, defaultValue: null });
    // What the docs say of it, where they say anything: the fixture's parameters have no descriptions
    expect(params.some(param => 'description' in param)).toBe(false);
    expect(apiDocsParams([{ name: 'subset', in: 'query', required: false, enumValues: null, isArray: true, pointer: '/s', description: 'Axes: `Lon(1:2)`' }])[0].description).toBe('Axes: `Lon(1:2)`');
    expect(params.find(param => param.name === 'bbox')).toMatchObject({ isArray: true });
  });

  it('leaves out the path’s parameters, and reads a default of any plain kind', () => {
    expect(paramsOf('/collections/ecmwf-aifs-single/styles/contours/map').some(param => param.name === 'styleId')).toBe(false);
    const made = apiDocsParams([
      { name: 'n', in: 'query', required: false, schema: { type: 'integer', default: 3 }, enumValues: null, isArray: false, pointer: '/x' },
      { name: 'o', in: 'query', required: false, schema: { type: 'object', default: { a: 1 } }, enumValues: null, isArray: false, pointer: '/y' },
      { name: 'h', in: 'header', required: false, enumValues: null, isArray: false, pointer: '/z' },
    ]);
    expect(made.map(param => [param.name, param.defaultValue])).toEqual([['n', '3'], ['o', null]]);
  });
});

describe('declaredClasses', () => {
  it('reads a standard’s classes by name, from http and https URIs alike', () => {
    const classes = declaredClasses(meteocore.conformsTo, MAPS);
    expect([...classes.keys()]).toEqual(['core', 'collection-map', 'styled-map', 'spatial-subsetting', 'scaling', 'datetime', 'crs', 'png', 'jpeg', 'background', 'tilesets']);
    expect(classes.get('styled-map')).toBe('http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/styled-map');
    expect([...declaredClasses([`https://www.opengis.net${MAPS}crs/`, `https://www.opengis.net${MAPS}a/b`, 'https://example.org/other'], MAPS).keys()]).toEqual(['crs']);
    expect(declaredClasses(null, MAPS).size).toBe(0);
  });
});

const offer = (overrides: Partial<Offer> = {}): Offer => ({
  standard: 'Maps',
  classesOf: { bbox: ['spatial-subsetting'], width: ['scaling', 'spatial-subsetting'], orientation: ['orientation'] },
  classes: declaredClasses(meteocore.conformsTo, MAPS),
  profile: { declarer: { kind: 'profile', name: 'A draft', href: 'https://example.org/draft', note: 'Being written' }, names: ['parameter-name'] },
  apiDocs: paramsOf('/collections/ecmwf-aifs-single/map'),
  ...overrides,
});

describe('declarersOf', () => {
  it('names the classes the API declares, then the profile, then the API docs', () => {
    expect(declarersOf('width', offer()).map(each => (each.kind === 'api-docs' ? 'API docs' : each.name))).toEqual(['scaling', 'spatial-subsetting', 'API docs']);
    expect(declarersOf('parameter-name', offer()).map(each => each.kind)).toEqual(['profile', 'api-docs']);
    expect(declarersOf('parameter-name', offer({ profile: null, apiDocs: null }))).toEqual([]);
    // A class the API doesn't declare names nothing
    expect(declarersOf('orientation', offer())).toEqual([]);
    expect(declarersOf('bbox', offer({ classes: null, apiDocs: null }))).toEqual([]);
  });
});

describe('undeclaredIssues', () => {
  it('warns of each name nobody declares, once, on its own field, citing Common where the API docs were read', () => {
    const issues = undeclaredIssues(['styles', 'bbox', 'styles', 'orientation', ''], offer(), '/paths/x/get');
    expect(issues).toEqual([
      {
        id: 'openapi:styles:undeclared', severity: 'warning', source: 'openapi', field: 'styles', rule: COMMON1.unknownParameter, pointer: '/paths/x/get',
        message: "Not declared: no Maps class the API declares, and not the API docs' operation, names styles. Expect a 400, unless the server ignores parameters it doesn't know",
      },
      expect.objectContaining({ field: 'orientation' }),
    ]);
  });

  it('says no more than the classes and the profile can, without API docs, and nothing without the conformance', () => {
    const without = undeclaredIssues(['styles', 'bbox', 'parameter-name'], offer({ apiDocs: null }));
    expect(without).toEqual([{
      id: 'metadata:styles:undeclared', severity: 'warning', source: 'metadata', field: 'styles', message: 'Not declared: no Maps class the API declares names styles',
    }]);
    expect(undeclaredIssues(['styles'], offer({ classes: null }))).toEqual([]);
  });
});
