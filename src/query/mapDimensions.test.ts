import { describe, expect, it } from 'vitest';
import type { Collection, Temporal } from '../types/api';
import type { ResolvedParam } from '../validation/openapi/operationIndex';
import { apiDocsParams, type ApiDocsParam } from './declared';
import { fieldSpecs, type FieldSpec } from './fieldSpecs';
import { withLinkQueries } from './mapQuery';
import { METOCEAN_MAPS_DRAFT, mapOffer, mapProfileNames } from './mapOffer';
import {
  apiDocsAxes, apiDocsTimeClash, axisChips, crsKind, declaredAxes, dimensionValueChips, extentDimensions, latestTimeAsked, listedValues,
  mapDimensionIssues, runAsked, runsOf, runsUpTo, subsetAxisIssues, timesFromRun,
} from './mapDimensions';
import { buildQueryModel, type QueryModelInput } from './queryModel';
import { validateQuery } from './validateQuery';
import { COMMON2_DRAFT, MAPS1 } from '../standards';
import dims from './__fixtures__/meteocore-maps-dimensions.json';

const MAPS = 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/';
const collectionOf = (id: string) => withLinkQueries(structuredClone(dims.collections.find(each => each.id === id)) as unknown as Collection);
const ifs = () => collectionOf('ecmwf-ifs-pressure');
const radar = () => collectionOf('fmi-radar-composite-dbz');
const aifs = () => collectionOf('ecmwf-aifs-single');
const DOCS: ApiDocsParam[] = apiDocsParams(dims.apiParams.map(param => ({ ...param, enumValues: null, isArray: param.schema.type === 'array' })) as ResolvedParam[]);
const offerFor = (collection: Collection, apiDocs: ApiDocsParam[] | null = DOCS, conformsTo: string[] | null = dims.conformsTo) =>
  mapOffer(mapProfileNames(collection), conformsTo, apiDocs);
const RUNS = ['2026-11-12T00:00:00Z', '2026-11-11T18:00:00Z'];
const tags = (field: FieldSpec | undefined) => (field?.declaredBy ?? []).map(each => (each.kind === 'api-docs' ? 'API docs' : each.name));
const specsOf = (collection: Collection, apiDocs: ApiDocsParam[] | null = DOCS, conformsTo: string[] | null = dims.conformsTo, inRequest: string[] = []) =>
  fieldSpecs(collection, 'map', { parameters: 0 }, { conformsTo, apiDocs, inRequest });
const byId = (fields: FieldSpec[], id: string) => fields.find(field => field.id === id);

describe('the extent’s other dimensions', () => {
  it('are each member beyond space and time, keyed by name, with what it lists and where', () => {
    const [vertical, run] = extentDimensions(ifs());
    expect(vertical).toMatchObject({ id: 'vertical', interval: [10, 1000], temporal: false, listed: { from: 'extent.vertical.values' } });
    expect(vertical.listed.values).toEqual([1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10]);
    expect(run).toMatchObject({ id: 'reference_time', temporal: true, listed: { values: ['2026-11-11T18:00:00Z', '2026-11-12T00:00:00Z'], from: 'extent.reference_time.grid.coordinates' } });
    expect(extentDimensions(radar())).toEqual([]);
    expect(extentDimensions(aifs()).map(each => each.id)).toEqual(['reference_time']);
    // EDR's custom array isn't one, nor a member that isn't a dimension
    expect(extentDimensions({ extent: { custom: [{ id: 'member' }], other: 'x', notes: { text: 'y' } } } as unknown as Collection)).toEqual([]);
  });

  it('list a grid’s coordinates, or a regular grid from its first coordinate by its resolution', () => {
    expect(listedValues({ grid: { coordinates: [1000, 850] } }, 'extent.vertical')).toEqual({ values: [1000, 850], from: 'extent.vertical.grid.coordinates' });
    // Without the float noise of adding 0.1s
    expect(listedValues({ grid: { firstCoordinate: 0.1, resolution: 0.1, cellsCount: 3 } }, 'extent.angle')).toEqual({ values: [0.1, 0.2, 0.3], from: 'extent.angle.grid' });
    expect(listedValues({ grid: { firstCoordinate: '2026-11-12T00:00:00+00:00', resolution: 'PT6H', cellsCount: 2 } }, 'extent.reference_time'))
      .toEqual({ values: ['2026-11-12T00:00:00Z', '2026-11-12T06:00:00Z'], from: 'extent.reference_time.grid' });
    expect(listedValues({ interval: [[1, 2]] }, 'extent.x')).toEqual({ values: [], from: '' });
    expect(listedValues({ grid: { firstCoordinate: 1, resolution: 'P1D', cellsCount: 2 } }, 'extent.x')).toEqual({ values: [], from: '' });
  });

  it('give the model runs newest first', () => {
    expect(runsOf(ifs())).toEqual(RUNS);
    expect(runsOf(radar())).toEqual([]);
    // Runs that aren't times, in the reverse of the listed order
    expect(runsOf({ extent: { reference_time: { values: ['a', 'b'] } } } as unknown as Collection)).toEqual(['b', 'a']);
  });
});

describe('what a request asks of time and runs', () => {
  it('is the latest time datetime or subset asks, an open end its start', () => {
    expect(latestTimeAsked('2026-11-12T00:00:00Z', '')).toBe(Date.parse('2026-11-12T00:00:00Z'));
    expect(latestTimeAsked('2026-11-12T00:00:00Z/2026-11-12T06:00:00Z', '')).toBe(Date.parse('2026-11-12T06:00:00Z'));
    expect(latestTimeAsked('2026-11-12T00:00:00Z/..', '')).toBe(Date.parse('2026-11-12T00:00:00Z'));
    expect(latestTimeAsked('', 'time("2026-11-12T03:00:00Z")')).toBe(Date.parse('2026-11-12T03:00:00Z'));
    expect(latestTimeAsked('2026-11-12T00:00:00Z', 't("2026-11-11T00:00:00Z":"2026-11-13T00:00:00Z")')).toBe(Date.parse('2026-11-13T00:00:00Z'));
    for (const [datetime, subset] of [['', ''], ['', 'time(*)'], ['nonsense', ''], ['../..', ''], ['', 'time(2026-11-12)']]) expect(latestTimeAsked(datetime, subset)).toBeNull();
  });

  it('is the run subset names, unquoted, none for * or none at all', () => {
    expect(runAsked('vertical(850),reference_time("2026-11-12T00:00:00Z")')).toBe('2026-11-12T00:00:00Z');
    expect(runAsked('reference_time(*)')).toBeNull();
    expect(runAsked('vertical(850)')).toBeNull();
  });

  it('keeps the runs that can have the time, and the times of the run', () => {
    expect(runsUpTo(RUNS, Date.parse('2026-11-11T21:00:00Z'))).toEqual(['2026-11-11T18:00:00Z']);
    expect(runsUpTo(RUNS, Date.parse('2026-11-12T00:00:00Z'))).toEqual(RUNS);
    expect(runsUpTo(RUNS, null)).toEqual(RUNS);
    const temporal = ifs().extent!.temporal as Temporal;
    expect(timesFromRun(temporal, '2026-11-12T00:00:00Z')).toEqual({
      temporal: { trs: temporal.trs, values: ['2026-11-12T00:00:00Z', '2026-11-12T03:00:00Z', '2026-11-12T06:00:00Z', '2026-11-12T09:00:00Z'] }, kept: 4, of: 6,
    });
    // The same for the same run, for the time control to keep its zoom
    expect(timesFromRun(temporal, '2026-11-12T00:00:00Z')).toBe(timesFromRun(temporal, '2026-11-12T00:00:00Z'));
    expect(timesFromRun(temporal, '2026-11-12T03:00:00Z')!.kept).toBe(3);
    expect(timesFromRun(temporal, null)).toBeNull();
    expect(timesFromRun(temporal, 'not a run')).toBeNull();
  });
});

describe('who declares each axis', () => {
  it('tells a geographic CRS from a projected one', () => {
    for (const crs of ['', 'http://www.opengis.net/def/crs/OGC/1.3/CRS84', '[OGC:CRS84]', 'CRS:84', 'EPSG:4326', 'http://www.opengis.net/def/crs/EPSG/0/4258']) expect(crsKind(crs), crs).toBe('geographic');
    for (const crs of ['EPSG:3067', '[EPSG:3857]', 'http://www.opengis.net/def/crs/EPSG/0/3035', 'urn:ogc:def:crs:EPSG::32635']) expect(crsKind(crs), crs).toBe('projected');
    expect(crsKind('ESRI:102100')).toBe('unknown');
  });

  it('reads the axes the API docs’ subset writes in its examples', () => {
    expect(apiDocsAxes(DOCS)).toEqual(['Lon', 'Lat', 'reference_time']);
    expect(apiDocsAxes(null)).toEqual([]);
    expect(apiDocsAxes(DOCS.filter(param => param.name !== 'subset'))).toEqual([]);
  });

  it('are the classes the API declares, the draft for the levels and runs, and the API docs', () => {
    const axes = declaredAxes(ifs(), offerFor(ifs()), '');
    expect([...axes.keys()]).toEqual(['Lon', 'Lat', 'time', 'Time', 't', 'T', 'vertical', 'reference_time']);
    const said = (axis: string) => axes.get(axis)!.map(each => (each.kind === 'api-docs' ? 'API docs' : each.name));
    expect(said('Lon')).toEqual(['spatial-subsetting', 'API docs']);
    expect(said('t')).toEqual(['datetime']);
    expect(said('vertical')).toEqual(['MetOcean Maps (draft)']);
    expect(axes.get('reference_time')).toEqual([METOCEAN_MAPS_DRAFT, { kind: 'api-docs', pointer: '/paths/~1collections~1ecmwf-ifs-pressure~1map/get/parameters/2' }]);
  });

  it('are E and N in a projected subset CRS, both pairs where it isn’t known, and each dimension under General Subsetting', () => {
    expect([...declaredAxes(radar(), offerFor(radar(), null), 'EPSG:3067').keys()]).toEqual(['E', 'N', 'time', 'Time', 't', 'T']);
    expect([...declaredAxes(radar(), offerFor(radar(), null), 'ESRI:102100').keys()].slice(0, 4)).toEqual(['Lon', 'Lat', 'E', 'N']);
    const general = declaredAxes(ifs(), offerFor(ifs(), null, [...dims.conformsTo, `${MAPS}general-subsetting`]), '');
    expect(general.get('vertical')!.map(each => (each.kind === 'class' || each.kind === 'profile' ? each.name : each.kind))).toEqual(['general-subsetting', 'MetOcean Maps (draft)']);
    // A three-dimensional box adds h
    const tall = { ...radar(), extent: { spatial: { bbox: [[6, 55, 0, 43, 72, 1000]] } } } as unknown as Collection;
    expect([...declaredAxes(tall, offerFor(tall, null), '').keys()].slice(0, 3)).toEqual(['Lon', 'Lat', 'h']);
  });

  it('without the conformance, are the draft’s and the API docs’ alone', () => {
    expect([...declaredAxes(ifs(), offerFor(ifs(), DOCS, null), '').keys()]).toEqual(['vertical', 'reference_time', 'Lon', 'Lat']);
  });
});

describe('the axes to pick', () => {
  it('add each axis over the collection’s extent, but those with fields of their own', () => {
    const own = ['vertical', 'reference_time'];
    expect(axisChips(ifs(), declaredAxes(ifs(), offerFor(ifs()), ''), '', own)).toEqual({
      chips: [{ axis: 'Lon', body: '-180:180' }, { axis: 'Lat', body: '-90:90' }, { axis: 'time', body: '"2026-11-11T18:00:00Z":"2026-11-12T09:00:00Z"' }],
      typed: [],
    });
    // The radar's box, outward at 3 decimals
    expect(axisChips(radar(), declaredAxes(radar(), offerFor(radar()), ''), '', []).chips.slice(0, 2)).toEqual([{ axis: 'Lon', body: '6.682:43.121' }, { axis: 'Lat', body: '55.934:72.856' }]);
  });

  it('give E and N the storage CRS’s box where the subset CRS is it, and leave them to type in another', () => {
    const storage = 'http://www.opengis.net/def/crs/EPSG/0/3067';
    expect(axisChips(radar(), declaredAxes(radar(), offerFor(radar()), storage), storage, []).chips.slice(0, 2))
      .toEqual([{ axis: 'E', body: '-196593.004:1044176.942' }, { axis: 'N', body: '6255329.699:8084432.005' }]);
    expect(axisChips(radar(), declaredAxes(radar(), offerFor(radar()), 'EPSG:3857'), 'EPSG:3857', []).typed).toEqual(['E', 'N']);
  });

  it('offer the values of another dimension that lists a few, and add it over its range', () => {
    const member = { ...radar(), extent: { ...radar().extent, member: { interval: [[1, 3]], values: [1, 2, 3] }, era: { interval: [['2020-01-01T00:00:00Z', null]] } } } as unknown as Collection;
    expect(dimensionValueChips(member, [])).toEqual([{ axis: 'member', values: ['1', '2', '3'] }]);
    const general = declaredAxes(member, offerFor(member, null, [...dims.conformsTo, `${MAPS}general-subsetting`]), '');
    expect(axisChips(member, general, '', []).chips.slice(3)).toEqual([{ axis: 'member', body: '1:3' }, { axis: 'era', body: '"2020-01-01T00:00:00Z":*' }]);
    expect(dimensionValueChips(ifs(), ['vertical', 'reference_time'])).toEqual([]);
  });
});

describe('a map’s fields for time, levels, runs and subset', () => {
  it('are the time, the level, the API docs’ elevation, the model run and subset, each tagged by who declared it', () => {
    const fields = specsOf(ifs());
    expect(fields.map(field => field.id)).toEqual(['datetime', 'subset:vertical', 'elevation', 'subset:reference_time', 'subset']);
    expect(fields.map(tags)).toEqual([['datetime', 'API docs'], ['MetOcean Maps (draft)'], ['API docs'], ['MetOcean Maps (draft)', 'API docs'], ['spatial-subsetting', 'datetime', 'MetOcean Maps (draft)', 'API docs']]);
    // Nothing is filled in: each says what the server does without it
    expect(fields.map(field => field.leftOut)).toEqual([
      'the server decides which time', "the server's default level", "the server's default level", 'the latest run, as `MetOcean Maps (draft)` has it', 'nothing subset: the whole extent',
    ]);
  });

  it('say where the times come from, citing Common Part 2’s grid', () => {
    expect(byId(specsOf(ifs()), 'datetime')!.hints).toEqual([{ text: '6 times, every 3 h, Nov 11 18:00 to Nov 12 09:00 UTC, from `extent.temporal.grid.coordinates`', rule: COMMON2_DRAFT.gridDescription }]);
    expect(byId(specsOf(radar()), 'datetime')!.hints[0]).toEqual({ text: '6 times, every 5 min, Nov 11 08:40 to Nov 11 09:05 UTC, from `extent.temporal.grid.coordinates`', rule: COMMON2_DRAFT.gridDescription });
    expect(byId(specsOf(aifs()), 'datetime')!.hints[0]).toEqual({ text: '62 times, every 6 h, Nov 11 18:00 to Nov 27 00:00 UTC, from `extent.temporal.grid`', rule: COMMON2_DRAFT.gridDescription });
    const timeless = { ...radar(), extent: { spatial: radar().extent!.spatial } } as Collection;
    expect(byId(specsOf(timeless), 'datetime')!.hints).toEqual(["The collection's extent has no time"]);
  });

  it('give a level its values, unit and the draft’s word, and elevation the same values and its hint', () => {
    const [level, elevation] = [byId(specsOf(ifs()), 'subset:vertical')!, byId(specsOf(ifs()), 'elevation')!];
    expect(level).toMatchObject({ title: 'Level', name: 'subset', axis: 'vertical', figure: 'hPa', choice: 'one' });
    expect(level.options).toEqual(['1000', '925', '850', '700', '600', '500', '400', '300', '250', '200', '150', '100', '50', '10']);
    expect(level.hints[0]).toBe('14 levels in `extent.vertical.values`, 1000 to 10 hPa');
    expect(level.hints[1]).toMatchObject({ rule: [COMMON2_DRAFT.additionalDimension, MAPS1.generalSubsetAxes] });
    expect(elevation).toMatchObject({ title: 'Level', name: 'elevation', figure: 'hPa', options: level.options, grammar: 'A number' });
    expect(elevation.hints[1]).toBe('`MetOcean Maps (draft)` picks a level with `subset=vertical(…)` instead');
    expect(byId(specsOf(radar()), 'elevation')!.hints[0]).toBe("The collection's extent has no levels");
  });

  it('give a model run Latest and the runs, newest first', () => {
    const run = byId(specsOf(ifs()), 'subset:reference_time')!;
    expect(run).toMatchObject({ title: 'Model run', name: 'subset', axis: 'reference_time', figure: '2 listed', options: ['*', ...RUNS] });
    expect(run.hints).toEqual([
      'From `extent.reference_time.grid.coordinates`, newest first',
      { text: '`Latest` writes `reference_time(*)`: a single `*` is the latest of a temporal dimension', rule: MAPS1.generalSubsetGrammar },
    ]);
  });

  it('show a level and a run on the draft’s word alone, and subset with them, and the rest only as declared or asked', () => {
    expect(specsOf(ifs(), null, null).map(field => field.id)).toEqual(['subset:vertical', 'subset:reference_time', 'subset']);
    expect(byId(specsOf(ifs(), null, null), 'subset')!.hints).toEqual(['`vertical` and `reference_time` are picked in their fields above, and written here']);
    expect(byId(specsOf(aifs(), null, null), 'subset')!.hints).toEqual(['`reference_time` is picked in its field above, and written here']);
    expect(specsOf(radar(), null, null)).toEqual([]);
    expect(specsOf(radar(), null, null, ['datetime', 'subset', 'elevation']).map(field => field.id)).toEqual(['datetime', 'subset']);
  });
});

describe('what’s wrong with a map’s subset, levels and run', () => {
  const issuesOf = (collection: Collection, request: { subset?: string; elevation?: string; datetime?: string }) =>
    mapDimensionIssues(collection, { subset: '', elevation: '', datetime: '', ...request }).map(issue => [issue.severity, issue.field, issue.message]);

  it('is each part not in the grammar, an error citing it', () => {
    const [issue] = mapDimensionIssues(ifs(), { subset: 'Lon(19:32),time(2026-11-12)', elevation: '', datetime: '' });
    expect(issue).toEqual({
      id: 'maps:subset:grammar-1', severity: 'error', source: 'maps', field: 'subset', input: 'form',
      message: "2026-11-12 in time(…) isn't a number, text in double quotes, or *: a time goes in double quotes", rule: [MAPS1.subsetGrammar, MAPS1.generalSubsetGrammar],
    });
    expect(issuesOf(ifs(), { subset: 'Lon(1:2),Lon(3:4)' })).toEqual([['warning', 'subset', 'Lon is in subset more than once']]);
  });

  it('is a level not listed, and one outside them all, as for EDR’s z', () => {
    expect(issuesOf(ifs(), { subset: 'vertical(777)' })).toEqual([['warning', 'subset:vertical', "Level 777 isn't one of the collection's levels"]]);
    expect(issuesOf(ifs(), { subset: 'vertical(2000)' })).toEqual([['warning', 'subset:vertical', "Level 2000 is outside the collection's levels (10 – 1000): expect a 204 or 404"]]);
    expect(issuesOf(ifs(), { subset: 'vertical(1100:1050)' })).toEqual([['warning', 'subset:vertical', "The levels 1100 to 1050 are outside the collection's levels (10 – 1000): expect a 204 or 404"]]);
    expect(mapDimensionIssues(ifs(), { subset: 'vertical(2000)', elevation: '', datetime: '' })[0].rule).toBe(MAPS1.generalSubsetOutside);
    expect(issuesOf(ifs(), { elevation: '777' })).toEqual([['warning', 'elevation', "Level 777 isn't one of the collection's levels"]]);
    // An interval needn't end on listed levels, and one reaching past them still has some
    for (const subset of ['vertical(850)', 'vertical(850.0)', 'vertical(1000:500)', 'vertical(950:520)', 'vertical(1100:500)', 'vertical(*)']) expect(issuesOf(ifs(), { subset }), subset).toEqual([]);
    // Without levels, nothing to say: who declares vertical is said elsewhere
    expect(issuesOf(radar(), { subset: 'vertical(777)', elevation: '777' })).toEqual([]);
  });

  it('is a run not listed, and one later than the time asked', () => {
    expect(issuesOf(ifs(), { subset: 'reference_time("2020-01-01T00:00:00Z")' })).toEqual([['warning', 'subset:reference_time', "The run 2020-01-01T00:00:00Z isn't among the 2 runs extent.reference_time lists"]]);
    expect(issuesOf(ifs(), { subset: 'reference_time("2026-11-12T00:00:00Z")', datetime: '2026-11-11T21:00:00Z' })).toEqual([
      ['warning', 'subset:reference_time', 'The run 2026-11-12T00:00:00Z is later than the time asked, 2026-11-11T21:00:00Z: its times start at the run. Expect a 4xx'],
    ]);
    for (const request of [{ subset: 'reference_time(*)', datetime: '2020-01-01T00:00:00Z' }, { subset: 'reference_time("2026-11-11T18:00:00Z")', datetime: '2026-11-11T21:00:00Z' }]) {
      expect(issuesOf(ifs(), request)).toEqual([]);
    }
  });

  it('is another dimension’s value not among those it lists', () => {
    const member = { ...radar(), extent: { member: { values: [1, 2, 3] } } } as unknown as Collection;
    expect(issuesOf(member, { subset: 'member(4)' })).toEqual([['warning', 'subset', "member(4) isn't one of the values extent.member.values lists"]]);
    for (const subset of ['member(2)', 'member(2.0)', 'member(1:5)', 'member(*)']) expect(issuesOf(member, { subset }), subset).toEqual([]);
  });

  it('checks a map’s datetime by Maps 1.0’s grammar, and a time outside the extent may be snapped', () => {
    const input = (datetime: string): QueryModelInput => ({
      collection: ifs(), queryKey: 'map', format: '', parameters: [], datetime, vertical: '', customDims: {}, points: [], polygons: [], bbox: null,
      bboxAsCoords: false, radius: { value: null, units: '' }, queryParams: {}, locationFeature: null,
    });
    expect(validateQuery(buildQueryModel(input('yesterday'))!)).toEqual([{
      id: 'maps:datetime:parse-0', severity: 'error', source: 'maps', field: 'datetime', input: 'form', message: '"yesterday" isn\'t a valid date-time', rule: [MAPS1.datetimeSyntax, MAPS1.datetimeInstant],
    }]);
    expect(validateQuery(buildQueryModel(input('2020-01-01T00:00:00Z'))!)).toEqual([expect.objectContaining({
      severity: 'warning', field: 'datetime', rule: MAPS1.datetimeClosest,
      message: "The selected time is outside the collection's time extent (2026-11-11T18:00Z – 2026-11-12T09:00Z): the server may draw the closest time it has",
    })]);
    expect(validateQuery(buildQueryModel(input('2026-11-12T00:00:00Z/'))!)[0]).toMatchObject({ severity: 'missing', source: 'maps', rule: MAPS1.datetimeSyntax });
    expect(validateQuery(buildQueryModel({ ...input('2026-11-12T00:00:00Z'), queryParams: { subset: 'vertical(777)' } })!).map(issue => issue.field)).toEqual(['subset:vertical']);
  });
});

describe('what the line and the API say of a map’s subset', () => {
  const line = { subset: '', datetime: '', bbox: '', center: '', subsetCrs: '' };
  const issuesOf = (request: Partial<typeof line>, offer = offerFor(ifs())) => subsetAxisIssues(ifs(), offer, { ...line, ...request });

  it('warns of an axis nobody declares, naming those declared', () => {
    expect(issuesOf({ subset: 'foo(1),Lon(1:2),E(1:2)' })).toEqual([
      {
        id: 'maps:subset:undeclared-foo', severity: 'warning', source: 'maps', field: 'subset', input: 'form', rule: [MAPS1.subsetDefinition, MAPS1.generalSubsetUnknownAxis, MAPS1.datetimeSubsetDefinition],
        message: 'Nobody declares the axis foo: those declared are Lon, Lat, time, vertical, reference_time. Expect a 4xx',
      },
      expect.objectContaining({ id: 'maps:subset:undeclared-E' }),
    ]);
    // E and N in a projected subset CRS, and Lon there isn't an axis
    expect(issuesOf({ subset: 'E(1:2),Lon(1:2)', subsetCrs: 'EPSG:3067' }).map(issue => issue.id)).toEqual(['maps:subset:undeclared-Lon']);
    expect(issuesOf({ subset: 'foo(1)' }, offerFor(ifs(), null, null))).toEqual([]);
  });

  it('is an error for a spatial axis with bbox or center, citing each rule', () => {
    expect(issuesOf({ subset: 'Lon(19:32),vertical(850)', bbox: '19,59,32,70' })).toEqual([{
      id: 'maps:subset:with-bbox', severity: 'error', source: 'maps', field: 'subset', input: 'form',
      message: 'Lon in subset with bbox: Maps 1.0 asks a 4xx for a spatial axis with either', rule: [MAPS1.subsetWithBbox, MAPS1.bboxDefinition],
    }]);
    expect(issuesOf({ subset: 'Lon(19:32),Lat(59:70)', bbox: '19,59,32,70', center: '25,62' })[0]).toMatchObject({
      message: 'Lon, Lat in subset with bbox and center: Maps 1.0 asks a 4xx for a spatial axis with either', rule: [MAPS1.subsetWithBbox, MAPS1.bboxDefinition, MAPS1.centerDefinition],
    });
    expect(issuesOf({ subset: 'vertical(850)', bbox: '19,59,32,70' })).toEqual([]);
    // Where the API doesn't declare spatial subsetting, the axis is undeclared instead
    const plain = offerFor(ifs(), null, dims.conformsTo.filter(uri => !uri.endsWith('spatial-subsetting')));
    expect(issuesOf({ subset: 'Lon(19:32)', bbox: '19,59,32,70' }, plain).map(issue => issue.id)).toEqual(['maps:subset:undeclared-Lon']);
    expect(issuesOf({ subset: 'Lon(19:32)', bbox: '19,59,32,70' }, offerFor(ifs(), null, null))).toEqual([]);
  });

  it('warns of a time with datetime where the API docs say they don’t go together, quoting them', () => {
    expect(apiDocsTimeClash(DOCS)).toEqual({ said: 'Not with `subset=time(…)` (400).', pointer: '/paths/~1collections~1ecmwf-ifs-pressure~1map/get/parameters/10' });
    expect(issuesOf({ subset: 'time("2026-11-12T00:00:00Z")', datetime: '2026-11-12T00:00:00Z' })).toEqual([{
      id: 'openapi:subset:time-with-datetime', severity: 'warning', source: 'openapi', field: 'subset', input: 'form', pointer: '/paths/~1collections~1ecmwf-ifs-pressure~1map/get/parameters/10',
      message: 'time in subset with datetime: the API docs say "Not with subset=time(…) (400)."',
    }]);
    expect(issuesOf({ subset: 'time("2026-11-12T00:00:00Z")' })).toEqual([]);
    // Subset's own sentence where datetime says nothing; nothing where neither says no
    const subsetOnly = DOCS.map(param => (param.name === 'datetime' ? { ...param, description: 'A time.' } : param));
    expect(apiDocsTimeClash(subsetOnly)?.said).toBe('Spatial axes not with `bbox` or `center`, `time` not with `datetime` (400).');
    expect(apiDocsTimeClash(DOCS.map(param => ({ ...param, description: 'Works with subset=time and datetime together.' })))).toBeNull();
  });
});
