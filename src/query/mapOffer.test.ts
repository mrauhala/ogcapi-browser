import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { apiDocsParams, type ApiDocsParam } from './declared';
import { fieldSpecs, type FieldSpec } from './fieldSpecs';
import { mapStylesOf, withLinkQueries } from './mapQuery';
import {
  MAPS_PARAMETER_CLASSES, METOCEAN_MAPS_DRAFT, mapApiDocsIssues, mapOffer, mapQueryIssues, pairSays, parameterRows, parameterStyles,
  styleDeclarers, styleMarks,
} from './mapOffer';
import { buildOperationIndex, matchOperation } from '../validation/openapi/operationIndex';
import { MAPS1 } from '../standards';
import meteocore from './__fixtures__/meteocore-maps-params.json';
import draft from './__fixtures__/metocean-maps-draft.json';

const ROOT = 'https://meteocore.app.meteo.fi';
const collectionOf = (id: string) => withLinkQueries(structuredClone(meteocore.collections.find(each => each.id === id)) as unknown as Collection);
const index = buildOperationIndex({ url: `${ROOT}/api`, doc: meteocore.api as unknown as Record<string, unknown> });
const docsFor = (path: string) => apiDocsParams(matchOperation(index, `${ROOT}${path}`)!.entry.params);
const AIFS_DOCS = docsFor('/collections/ecmwf-aifs-single/map');
const aifs = () => collectionOf('ecmwf-aifs-single');
const ifs = () => collectionOf('ecmwf-ifs-pressure');
const radar = () => collectionOf('fmi-radar-composite-dbz');
const aifsStyles = mapStylesOf(meteocore.styles['ecmwf-aifs-single'].styles);
const ifsStyles = mapStylesOf(meteocore.styles['ecmwf-ifs-pressure'].styles);
const DRAFT = draft.collection as unknown as Collection;
const draftStyles = mapStylesOf(draft.styles);

const specs = (collection: Collection, apiDocs: ApiDocsParam[] | null, more: { inRequest?: string[]; parameters?: number; conformsTo?: string[] | null } = {}) =>
  fieldSpecs(collection, 'map', { parameters: more.parameters ?? 0 }, { conformsTo: 'conformsTo' in more ? more.conformsTo : meteocore.conformsTo, apiDocs, inRequest: more.inRequest });
const one = (fields: FieldSpec[], name: string) => fields.find(field => field.name === name)!;
const tags = (field: FieldSpec) => (field.declaredBy ?? []).map(each => (each.kind === 'api-docs' ? 'API docs' : each.name));

describe('the Maps classes', () => {
  it('give each map parameter the standard defines, by class names Maps 1.0 has', () => {
    const CLASSES = ['background', 'collections-selection', 'scaling', 'display-resolution', 'spatial-subsetting', 'datetime', 'general-subsetting', 'crs', 'orientation', 'projection'];
    expect(Object.keys(MAPS_PARAMETER_CLASSES)).toHaveLength(22);
    expect(new Set(Object.values(MAPS_PARAMETER_CLASSES).flat())).toEqual(new Set(CLASSES));
    // Nothing of MeteoCore's own, and no style: that's in the path
    for (const name of ['f', 'parameter-name', 'elevation', 'quality', 'style', 'styles']) expect(MAPS_PARAMETER_CLASSES[name]).toBeUndefined();
  });

  it('tag the style by styled-map where the API declares it', () => {
    expect(styleDeclarers(mapOffer(true, meteocore.conformsTo, null))).toEqual([{ kind: 'class', name: 'styled-map', uri: 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/styled-map' }]);
    expect(styleDeclarers(mapOffer(true, meteocore.conformsTo.filter(uri => !uri.endsWith('styled-map')), null))).toEqual([]);
    expect(styleDeclarers(mapOffer(true, null, null))).toEqual([]);
  });
});

describe('a map’s fields', () => {
  it('are its parameter, from parameter_names, and its format, from the API docs, each tagged by who declared it', () => {
    const fields = specs(aifs(), AIFS_DOCS);
    expect(fields.map(field => field.name)).toEqual(['parameter-name', 'f']);
    const parameter = one(fields, 'parameter-name');
    expect(parameter).toMatchObject({ title: 'Parameter', requirement: 'optional', figure: '18 listed', choice: 'one' });
    expect(tags(parameter)).toEqual(['MetOcean Maps (draft)', 'API docs']);
    expect(parameter.hints).toEqual(["From the collection's `parameter_names`. One at a time: the API docs' schema is a string"]);
    expect(parameter.leftOut).toBe("the server draws its default, which the collection doesn't name");
    expect(one(specs(aifs(), AIFS_DOCS, { parameters: 1 }), 'parameter-name').figure).toBe('1 of 18');
  });

  it('give the format the API docs’ values, their default marked, and say Maps negotiates it', () => {
    const format = one(specs(aifs(), AIFS_DOCS), 'f');
    expect(format).toMatchObject({ title: 'Output format', options: ['image/png', 'image/jpeg', 'image/webp'], marked: 'image/png' });
    expect(tags(format)).toEqual(['API docs']);
    expect(format.hints).toEqual([
      { text: 'Maps 1.0 negotiates the format by `Accept`, and has no `f`', rule: MAPS1.formatNegotiation },
      "From the API docs' `enum`, the default marked",
    ]);
    expect(format.leftOut).toBe("by `Accept`, which the app sends as `*/*`: the server's default, `image/png` by the API docs");
  });

  it('take several parameters where the API docs’ schema is an array', () => {
    const docs = AIFS_DOCS.map(param => (param.name === 'parameter-name' ? { ...param, isArray: true } : param));
    const parameter = one(specs(aifs(), docs), 'parameter-name');
    expect(parameter).toMatchObject({ title: 'Parameters', choice: 'several' });
    expect(parameter.hints[0]).toBe("From the collection's `parameter_names`. Several at once: the API docs' schema is an array");
  });

  it('without API docs: the parameter on the draft’s word, one at a time, and no format', () => {
    const fields = specs(ifs(), null);
    expect(fields.map(field => field.name)).toEqual(['parameter-name']);
    expect(tags(fields[0])).toEqual(['MetOcean Maps (draft)']);
    expect(fields[0].declaredBy?.[0]).toBe(METOCEAN_MAPS_DRAFT);
    expect(fields[0].hints).toEqual(["From the collection's `parameter_names`. One at a time: nothing says it takes several"]);
  });

  it('for a collection without parameter_names, the API docs’ parameter, typed', () => {
    const fields = specs(radar(), docsFor('/collections/fmi-radar-composite-dbz/map'));
    const parameter = one(fields, 'parameter-name');
    expect(tags(parameter)).toEqual(['API docs']);
    expect(parameter.figure).toBeUndefined();
    expect(parameter.hints).toEqual(['The API docs list `parameter-name`, but the collection has no `parameter_names` to pick from: type one']);
  });

  it('show what the request has though nobody declares it, untagged, and nothing for what isn’t there', () => {
    expect(specs(radar(), null)).toEqual([]);
    const fields = specs(radar(), null, { inRequest: ['parameter-name', 'f', 'bbox'] });
    expect(fields.map(field => [field.name, tags(field)])).toEqual([['parameter-name', []], ['f', []]]);
    expect(one(fields, 'parameter-name').hints).toEqual(['The collection has no `parameter_names` to pick from']);
    expect(one(fields, 'f')).toMatchObject({ options: [], marked: undefined, leftOut: "by `Accept`, which the app sends as `*/*`: the server's default" });
  });

  it('name defaultFields as what’s drawn without a parameter, where the collection has it', () => {
    const collection = { ...aifs(), defaultFields: ['2t'] } as unknown as Collection;
    expect(one(specs(collection, null), 'parameter-name').leftOut).toBe('the server draws its default, which `defaultFields` names: `2t`');
  });

  it('say what the API docs require', () => {
    const required = fieldSpecs(aifs(), 'map', { parameters: 0 }, { apiDocs: AIFS_DOCS, apiRequired: ['parameter-name'] });
    expect(one(required, 'parameter-name').requirement).toBe('required by the API docs');
  });
});

describe('parameterRows', () => {
  it('are parameter_names in order: the id, the label its observed property gives, the unit, and the styles for it', () => {
    const rows = parameterRows(aifs(), aifsStyles);
    expect(rows).toHaveLength(18);
    expect(rows.slice(0, 2).map(row => row.id)).toEqual(['10si', '10u']);
    expect(rows.find(row => row.id === '2t')).toEqual({ id: '2t', label: 'Temperature (2 m above ground)', unit: '°C', styles: ['contours', 'fmi-hires'] });
    expect(rows.find(row => row.id === 'tp')!.styles).toEqual([]);
    expect(parameterRows(ifs(), ifsStyles).find(row => row.id === 'gh')).toMatchObject({ label: 'Geopotential height', styles: ['contours'] });
  });

  it('take a parameter’s own label first, and no label that only repeats the id', () => {
    const collection = { id: 'c', links: [], parameter_names: { a: { label: 'Own', observedProperty: { label: { en: 'Observed' } } }, b: { label: 'B' }, c: {} } } as unknown as Collection;
    expect(parameterRows(collection, []).map(row => [row.id, row.label, row.unit])).toEqual([['a', 'Own', ''], ['b', null, ''], ['c', null, '']]);
  });

  it('read parameter_names as a list too, and the draft’s styles beside the styles’ parameters', () => {
    const listed = { id: 'c', links: [], parameter_names: [{ id: 'x', type: 'Parameter', label: 'Ex', observedProperty: {} }] } as unknown as Collection;
    expect(parameterRows(listed, [])).toEqual([{ id: 'x', label: 'Ex', unit: '', styles: [] }]);
    expect(parameterRows(DRAFT, draftStyles).map(row => [row.id, row.styles])).toEqual([
      ['2d', ['default', 'contours', 'fmi-hires']], ['2t', ['default', 'contours', 'fmi-hires']], ['msl', ['contours', 'isobars']], ['tp', ['default']], ['z', ['contours']],
    ]);
  });
});

describe('styles for a parameter, read both ways', () => {
  it('read a parameter’s metocean:styles and metocean:defaultStyle, and nothing where it has none', () => {
    expect(parameterStyles(DRAFT, '2t')).toEqual({ styles: ['fmi-hires', 'contours', 'default'], defaultStyle: 'fmi-hires' });
    expect(parameterStyles(DRAFT, 'z')).toEqual({ styles: null, defaultStyle: null });
    expect(parameterStyles(aifs(), '2t')).toEqual({ styles: null, defaultStyle: null });
    const odd = { id: 'c', links: [], parameter_names: { a: { 'metocean:styles': ['x', 3], 'metocean:defaultStyle': ' ' } } } as unknown as Collection;
    expect(parameterStyles(odd, 'a')).toEqual({ styles: ['x'], defaultStyle: null });
  });

  it('say who pairs a style with a parameter and who doesn’t; a style with no parameters says nothing', () => {
    expect(pairSays(aifs(), aifsStyles, '2t', 'fmi-hires')).toEqual({ yes: ['style'], no: [] });
    expect(pairSays(aifs(), aifsStyles, 'tp', 'fmi-hires')).toEqual({ yes: [], no: ['style'] });
    expect(pairSays(aifs(), aifsStyles, 'tp', 'default')).toEqual({ yes: [], no: [] });
    expect(pairSays(DRAFT, draftStyles, '2d', 'contours')).toEqual({ yes: ['style'], no: ['parameter'] });
    expect(pairSays(DRAFT, draftStyles, 'tp', 'contours')).toEqual({ yes: [], no: ['parameter', 'style'] });
    expect(pairSays(DRAFT, draftStyles, 'msl', 'isobars')).toEqual({ yes: ['parameter'], no: [] });
  });

  it('mark the styles for the parameters chosen, first, the default one as such, the rest after in their order', () => {
    expect(styleMarks(aifs(), aifsStyles, [])).toEqual({ order: ['default', 'contours', 'fmi-hires'], tags: {} });
    expect(styleMarks(aifs(), aifsStyles, ['2d'])).toEqual({ order: ['contours', 'fmi-hires', 'default'], tags: { contours: 'for 2d', 'fmi-hires': 'for 2d' } });
    expect(styleMarks(aifs(), aifsStyles, ['msl', 'tp']).tags).toEqual({ contours: 'for msl' });
    expect(styleMarks(DRAFT, draftStyles, ['msl'])).toEqual({ order: ['contours', 'isobars', 'default', 'fmi-hires'], tags: { contours: 'for msl', isobars: 'default for msl' } });
  });
});

describe('mapQueryIssues', () => {
  it('finds nothing wrong with MeteoCore’s own pairs, and nothing without a choice', () => {
    expect(mapQueryIssues(aifs(), [], '', aifsStyles)).toEqual([]);
    expect(mapQueryIssues(aifs(), ['2t'], 'fmi-hires', aifsStyles)).toEqual([]);
    expect(mapQueryIssues(aifs(), ['tp'], 'default', aifsStyles)).toEqual([]);
    expect(mapQueryIssues(radar(), ['dbz'], '', [])).toEqual([]);
  });

  it('is an error for a parameter not among parameter_names, as for EDR', () => {
    expect(mapQueryIssues(aifs(), ['2t', 'nope', 'odd'], '', aifsStyles)).toEqual([{
      id: 'metadata:parameter-name:offered', severity: 'error', source: 'metadata', field: 'parameter-name', input: 'form',
      message: "nope, odd aren't among the collection's parameter_names",
    }]);
    expect(mapQueryIssues(aifs(), ['nope'], '', aifsStyles)[0].message).toBe("nope isn't among the collection's parameter_names");
  });

  it('warns of a style not listed for a parameter, saying what each list has: a 4xx is to be expected', () => {
    expect(mapQueryIssues(aifs(), ['tp'], 'fmi-hires', aifsStyles)).toEqual([{
      id: 'metadata:style:unlisted-tp', severity: 'warning', source: 'metadata', field: 'style', input: 'form',
      message: "fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx",
    }]);
    const both = mapQueryIssues(DRAFT, ['tp'], 'contours', draftStyles).filter(issue => issue.severity === 'warning');
    expect(both.map(issue => issue.message)).toEqual(["contours isn't listed for tp (tp's metocean:styles: default; its parameters: 2t, z, 2d, msl, gh): expect a 4xx"]);
    expect(mapQueryIssues(DRAFT, ['2t'], 'isobars', draftStyles).filter(issue => issue.severity === 'warning').map(issue => issue.message))
      .toEqual(["isobars isn't listed for 2t (2t's metocean:styles: fmi-hires, contours, default): expect a 4xx"]);
    // A parameter not listed is wrong already: its style isn't checked against it
    expect(mapQueryIssues(aifs(), ['nope'], 'fmi-hires', aifsStyles).map(issue => issue.field)).toEqual(['parameter-name']);
  });

  it('notes where the styles’ parameters and the parameters’ metocean:styles disagree, whatever is chosen', () => {
    const notes = mapQueryIssues(DRAFT, [], '', draftStyles);
    expect(notes).toEqual([{
      id: 'metadata:style:disagree', severity: 'info', source: 'metadata', field: 'style',
      message: "The styles' parameters and the parameters' metocean:styles disagree: contours lists 2d in its parameters, and 2d's metocean:styles don't name contours",
    }]);
    // Both ways, and past three in a count
    const many = { ...DRAFT, parameter_names: Object.fromEntries(['2t', '2d', 'msl', 'z'].map(id => [id, { 'metocean:styles': ['isobars'] }])) } as unknown as Collection;
    const isobarsFor = draftStyles.map(style => (style.id === 'isobars' ? { ...style, parameters: ['zz'] } : style));
    const message = mapQueryIssues(many, [], '', isobarsFor)[0].message;
    expect(message).toContain("2t's metocean:styles name isobars, whose parameters don't list 2t");
    expect(message).toContain("contours lists 2t in its parameters, and 2t's metocean:styles don't name contours");
    // 2t, 2d, msl and z each with contours and isobars, and 2t and 2d with fmi-hires
    expect(message.endsWith(', and 7 more')).toBe(true);
  });
});

describe('mapApiDocsIssues', () => {
  it('warns when the API docs take one parameter and the request has several', () => {
    expect(mapApiDocsIssues(['2t', 'msl'], AIFS_DOCS)).toEqual([{
      id: 'openapi:parameter-name:one', severity: 'warning', source: 'openapi', field: 'parameter-name', input: 'form',
      pointer: '/paths/~1collections~1ecmwf-aifs-single~1map/get/parameters/18',
      message: "The API docs' parameter-name is a string, one parameter, and the request has 2",
    }]);
    expect(mapApiDocsIssues(['2t'], AIFS_DOCS)).toEqual([]);
    expect(mapApiDocsIssues(['2t', 'msl'], AIFS_DOCS.map(param => ({ ...param, isArray: true })))).toEqual([]);
    expect(mapApiDocsIssues(['2t', 'msl'], AIFS_DOCS.filter(param => param.name !== 'parameter-name'))).toEqual([]);
  });
});
