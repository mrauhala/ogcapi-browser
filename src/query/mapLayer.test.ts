import { describe, expect, it } from 'vitest';
import type { Collection, Temporal } from '../types/api';
import type { QueryIssue } from './types';
import {
  MAX_FRAMES, choicesSaid, frameParams, layerChoicesOf, layerSourceOf, layerTitle, mapCrsOf, paramOf, sentKey, seriesTimes,
  tilesDatetimeDeclared, tilesFor, viewUrl, withParams, type Pairs, type SentByLayer, type TilesOffer,
} from './mapLayer';
import { buildQueryModel } from './queryModel';
import { buildQueryUrl } from './buildQueryUrl';
import { readableUrl } from './requestUrl';
import { withMapQuery } from './mapQuery';
import { tileTemplatesOf } from '../api/maps';
import fixture from './__fixtures__/meteocore-map-layers.json';

const ROOT = 'https://meteocore.app.meteo.fi/collections';
const collectionOf = (id: string) => structuredClone(fixture.collections.find(each => each.id === id)) as unknown as Collection;
const ifs = () => collectionOf('ecmwf-ifs-pressure');
const radar = () => collectionOf('fmi-radar-composite-dbz');
const RUN = '2026-11-12T18:00:00Z';
const TILES = `${ROOT}/ecmwf-ifs-pressure/map/tiles/WebMercatorQuad/{z}/{y}/{x}`;
const templates = tileTemplatesOf(fixture.tilesets.tilesets[0].links);
const tileParams = fixture.tileOperation.parameters.filter(param => param.in === 'query').map(param => param.name);
const offer = (over: Partial<TilesOffer> = {}): TilesOffer => ({ templates, apiDocs: tileParams, datetimeClass: true, ...over });

// The map request as the form builds it, from what it holds
const formUrl = (collection: Collection, held: { styleId?: string; styleHref?: string; parameters?: string[]; datetime?: string; subset?: string; elevation?: string; format?: string }) => {
  const model = buildQueryModel({
    collection: withMapQuery(collection), queryKey: 'map', format: held.format ?? '', parameters: held.parameters ?? [], datetime: held.datetime ?? '',
    vertical: '', customDims: {}, points: [], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: null, units: '' },
    queryParams: { subset: held.subset ?? '', elevation: held.elevation ?? '' }, locationFeature: null, styleId: held.styleId ?? '', styleHref: held.styleHref ?? '',
  });
  return readableUrl(buildQueryUrl(model!)!);
};

describe('layerChoicesOf', () => {
  it('takes what the form chose: the style’s map, its parameter, the run and elevation, in the request’s order', () => {
    const url = formUrl(ifs(), {
      styleId: 'fmi-hires', styleHref: `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?parameter-name=t`, parameters: ['t'],
      subset: `reference_time("${RUN}")`, elevation: '850',
    });
    expect(url).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?parameter-name=t&subset=reference_time("${RUN}")&elevation=850`);
    expect(layerChoicesOf(url, 'fmi-hires')).toEqual({
      endpoint: `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map`,
      styleId: 'fmi-hires',
      params: [['parameter-name', 't'], ['subset', `reference_time("${RUN}")`], ['elevation', '850']],
    });
  });

  it('takes the time and the format as chosen, a range included', () => {
    const url = formUrl(ifs(), { parameters: ['gh'], datetime: '2026-11-12T18:00:00Z/2026-11-13T00:00:00Z', subset: 'vertical(500),reference_time(*)', format: 'image/webp' });
    expect(layerChoicesOf(url)?.params).toEqual([
      ['parameter-name', 'gh'], ['datetime', '2026-11-12T18:00:00Z/2026-11-13T00:00:00Z'], ['subset', 'vertical(500),reference_time(*)'], ['f', 'image/webp'],
    ]);
  });

  it('leaves out what the view decides: the box, the size, the CRS, center and scale', () => {
    const choices = layerChoicesOf(`${ROOT}/x/map?bbox=19,59,32,70&bbox-crs=EPSG:4326&width=300&height=200&crs=EPSG:3067&center=25,62&center-crs=CRS84&scale-denominator=5000000&parameter-name=t`);
    expect(choices).toEqual({ endpoint: `${ROOT}/x/map`, styleId: '', params: [['parameter-name', 't']] });
  });

  it('takes the box’s axes out of the subset, keeping the others, several subsets as one', () => {
    const choices = layerChoicesOf(`${ROOT}/x/map?subset=Lon(19:32),Lat(59:70)&subset=reference_time(*)&transparent=false&subset=E(1:2),N(3:4),vertical(850)`);
    expect(choices?.params).toEqual([['subset', 'reference_time(*),vertical(850)'], ['transparent', 'false']]);
  });

  it('leaves no subset where it had only the box’s axes, and subset-crs only while a height axis needs it', () => {
    expect(layerChoicesOf(`${ROOT}/x/map?subset=Lon(19:32),Lat(59:70)&subset-crs=CRS84`)?.params).toEqual([]);
    expect(layerChoicesOf(`${ROOT}/x/map?subset=Lon(19:32),h(0:100)&subset-crs=CRS84h`)?.params).toEqual([['subset', 'h(0:100)'], ['subset-crs', 'CRS84h']]);
  });

  it('reads the collection’s own map link alike, and nothing that isn’t a URL', () => {
    expect(layerChoicesOf(`${ROOT}/fmi-radar-composite-dbz/map`)).toEqual({ endpoint: `${ROOT}/fmi-radar-composite-dbz/map`, styleId: '', params: [] });
    expect(layerChoicesOf('not a url')).toBeNull();
  });
});

describe('mapCrsOf', () => {
  it('writes EPSG:3857 as MeteoCore’s crs list does, the URI', () => {
    expect(mapCrsOf(ifs())).toEqual({ crs: 'http://www.opengis.net/def/crs/EPSG/0/3857', listed: true });
  });

  it('writes it as any list has it: a safe CURIE, a code, the https URI', () => {
    for (const listed of ['[EPSG:3857]', 'EPSG:3857', 'https://www.opengis.net/def/crs/EPSG/0/3857', 'urn:ogc:def:crs:EPSG::3857']) {
      expect(mapCrsOf({ ...ifs(), crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84', listed] })).toEqual({ crs: listed, listed: true });
    }
  });

  it('asks by the URI, which every server SHALL take, where the list hasn’t it or there’s no list', () => {
    expect(mapCrsOf({ ...ifs(), crs: ['http://www.opengis.net/def/crs/OGC/1.3/CRS84', 'http://www.opengis.net/def/crs/EPSG/0/3067'] }))
      .toEqual({ crs: 'http://www.opengis.net/def/crs/EPSG/0/3857', listed: false });
    expect(mapCrsOf({ ...ifs(), crs: undefined } as unknown as Collection).listed).toBe(false);
  });
});

describe('viewUrl', () => {
  const crs = 'http://www.opengis.net/def/crs/EPSG/0/3857';
  it('asks the view’s box at a tenth of a pixel, its size and the map’s CRS, then the choices as the line writes them', () => {
    const url = viewUrl(`${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map`, [['parameter-name', 't'], ['subset', `reference_time("${RUN}")`], ['elevation', '850']],
      { bbox: [4.191234567891234, 53.32412345678912, 46.11512345678912, 69.65312345678912], width: 954, height: 800, crs });
    expect(url).toBe(`${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?bbox=4.191,53.324,46.115,69.653&width=954&height=800`
      + `&crs=${crs}&parameter-name=t&subset=reference_time("${RUN}")&elevation=850`);
  });

  it('has more decimals zoomed in, and nothing nobody chose: no styles, transparent or f', () => {
    const url = viewUrl(`${ROOT}/x/map`, [], { bbox: [24.9412345678, 60.1612345678, 24.9512345678, 60.1712345678], width: 1000, height: 1000, crs });
    expect(url).toBe(`${ROOT}/x/map?bbox=24.941235,60.161235,24.951235,60.171235&width=1000&height=1000&crs=${crs}`);
    expect(viewUrl(`${ROOT}/x/map`, [], { bbox: [0, 0, 1, 1], width: 10, height: 10, crs: '' })).toBe(`${ROOT}/x/map?bbox=0,0,1,1&width=10&height=10`);
  });

  it('keeps 3 decimals over the whole world, and takes them from the finer of the two axes', () => {
    expect(viewUrl(`${ROOT}/x/map`, [], { bbox: [-180.12345, -85.0511287, 180.12345, 85.0511287], width: 256, height: 256, crs }))
      .toBe(`${ROOT}/x/map?bbox=-180.123,-85.051,180.123,85.051&width=256&height=256&crs=${crs}`);
    // 0.00001° a pixel across, 0.1° up: the finer sets 6
    expect(viewUrl(`${ROOT}/x/map`, [], { bbox: [24.9412345678, 60.1612345678, 24.9512345678, 61.1612345678], width: 1000, height: 10, crs }))
      .toBe(`${ROOT}/x/map?bbox=24.941235,60.161235,24.951235,61.161235&width=1000&height=10&crs=${crs}`);
  });
});

describe('withParams', () => {
  it('puts the choices on a tile template, which keeps its placeholders and its own query', () => {
    expect(withParams(TILES, [['parameter-name', 't'], ['subset', `reference_time("${RUN}")`]])).toBe(`${TILES}?parameter-name=t&subset=reference_time("${RUN}")`);
    expect(withParams(`${TILES}?f=png`, [['datetime', RUN]])).toBe(`${TILES}?f=png&datetime=${RUN}`);
    expect(withParams(TILES, [])).toBe(TILES);
  });
});

describe('tilesFor', () => {
  it('carries what MeteoCore’s API docs list for its tiles: the parameter, the time, elevation and the run', () => {
    const params: Pairs = [['parameter-name', 't'], ['datetime', RUN], ['subset', `reference_time("${RUN}")`], ['elevation', '850']];
    expect(tilesFor(params, offer())).toEqual({ template: TILES, params });
  });

  it('takes the template of the format asked, and doesn’t send f for it', () => {
    expect(tilesFor([['parameter-name', 't'], ['f', 'image/png']], offer())).toEqual({ template: TILES, params: [['parameter-name', 't']] });
  });

  it('picks the template of the format among several, its type read without its parameters or case', () => {
    const webp = `${ROOT}/ecmwf-ifs-pressure/map/tiles/WebMercatorQuad/{z}/{y}/{x}.webp`;
    const both = offer({ templates: [{ href: TILES, type: 'Image/PNG; mode=8bit' }, { href: webp, type: 'image/webp' }] });
    expect(tilesFor([['f', 'image/webp']], both)).toEqual({ template: webp, params: [] });
    expect(tilesFor([['f', 'image/png']], both)).toEqual({ template: TILES, params: [] });
  });

  it('sends f where there’s no template of the format but the API docs list f for tiles', () => {
    expect(tilesFor([['f', 'image/webp']], offer())).toEqual({ template: TILES, params: [['f', 'image/webp']] });
    expect(tilesFor([['f', 'image/webp']], offer({ apiDocs: tileParams.filter(name => name !== 'f') })))
      .toEqual({ refused: "its tiles are image/png, and the API docs don't list f for its tiles" });
  });

  it('refuses a time in subset, which MeteoCore’s tiles answer with 400, and what the API docs don’t list', () => {
    expect(tilesFor([['subset', `time("${RUN}")`]], offer())).toEqual({ refused: 'its tiles take a time by datetime, not as time(…) in subset' });
    expect(tilesFor([['subset', `t("${RUN}")`]], offer())).toEqual({ refused: 'its tiles take a time by datetime, not as t(…) in subset' });
    expect(tilesFor([['parameter-name', 't'], ['transparent', 'false'], ['foo', '1']], offer())).toEqual({ refused: "the API docs don't list foo for its tiles" });
  });

  it('with no API docs for its tiles, carries only Tiles’ datetime, where the API declares its class', () => {
    expect(tilesFor([['datetime', RUN]], offer({ apiDocs: null }))).toEqual({ template: TILES, params: [['datetime', RUN]] });
    expect(tilesFor([['datetime', RUN]], offer({ apiDocs: null, datetimeClass: false })))
      .toEqual({ refused: "the API declares neither Tiles' datetime class nor API docs for its tiles" });
    expect(tilesFor([['parameter-name', 't']], offer({ apiDocs: null }))).toEqual({ refused: 'no API docs say its tiles take parameter-name' });
    expect(tilesFor([['datetime', RUN]], offer({ apiDocs: ['parameter-name'] }))).toEqual({ refused: "the API docs don't list datetime for its tiles" });
  });

  it('takes tiles with nothing chosen, and refuses where there are none', () => {
    expect(tilesFor([], offer())).toEqual({ template: TILES, params: [] });
    expect(tilesFor([], offer({ templates: [] }))).toEqual({ refused: 'it has no WebMercatorQuad tiles' });
  });

  it('reads Tiles’ datetime class from MeteoCore’s conformance', () => {
    expect(tilesDatetimeDeclared(fixture.conformsTo)).toBe(true);
    expect(tilesDatetimeDeclared(fixture.conformsTo.filter(uri => !uri.endsWith('/datetime')))).toBe(false);
    expect(tilesDatetimeDeclared(null)).toBe(false);
  });
});

describe('choicesSaid and layerTitle', () => {
  it('say the style, the parameter, the time, the level and the run, those chosen only, in that order', () => {
    const params: Pairs = [['parameter-name', 't'], ['datetime', RUN], ['subset', `reference_time("${RUN}"),vertical(850)`]];
    expect(choicesSaid({ styleId: 'fmi-hires', params })).toEqual(['fmi-hires', 't', RUN, 'level 850', `run ${RUN}`]);
    expect(layerTitle('ECMWF IFS', { styleId: '', params: [['subset', 'reference_time(*)'], ['elevation', '850']] })).toBe('ECMWF IFS · elevation 850 · latest run');
  });

  it('say anything else asked as written: other axes, the format, other parameters', () => {
    expect(choicesSaid({ styleId: '', params: [['subset', 'member(3),time("a":"b")'], ['f', 'image/webp'], ['transparent', 'false']] }))
      .toEqual(['member(3)', 'time("a":"b")', 'image/webp', 'transparent=false']);
    expect(layerTitle('Radar', { styleId: '', params: [] })).toBe('Radar');
    // A range of levels isn't one level
    expect(choicesSaid({ styleId: '', params: [['subset', 'vertical(1000:850)']] })).toEqual(['vertical(1000:850)']);
  });
});

describe('seriesTimes', () => {
  const temporal = (collection: Collection) => collection.extent!.temporal as Temporal;
  const grid = (ifs().extent!.temporal!.grid!.coordinates as string[]).map(time => time.replace('+00:00', 'Z'));

  it('steps through the times the collection lists, where no range is chosen', () => {
    expect(seriesTimes(temporal(ifs()), [['parameter-name', 't']])).toEqual({ times: grid, of: 8, from: 'extent', run: null });
    expect(seriesTimes(temporal(ifs()), [['datetime', grid[3]]])).toMatchObject({ times: grid, from: 'extent' });
  });

  it('through those inside the range chosen, its ends included, an open end the extent’s', () => {
    expect(seriesTimes(temporal(ifs()), [['datetime', `${grid[2]}/${grid[4]}`]])).toEqual({ times: grid.slice(2, 5), of: 3, from: 'range', run: null });
    expect(seriesTimes(temporal(ifs()), [['datetime', `${grid[5]}/..`]])).toMatchObject({ times: grid.slice(5) });
    expect(seriesTimes(temporal(ifs()), [['datetime', `/${grid[1]}`]])).toMatchObject({ times: grid.slice(0, 2) });
  });

  it('through the run’s times only, where a run is asked', () => {
    expect(seriesTimes(temporal(ifs()), [['subset', `reference_time("${RUN}"),vertical(850)`]])).toEqual({ times: grid.slice(2), of: 6, from: 'extent', run: RUN });
    expect(seriesTimes(temporal(ifs()), [['subset', 'reference_time(*)']])).toMatchObject({ times: grid, run: null });
  });

  it(`at most ${MAX_FRAMES}, picked evenly, the first and the last kept`, () => {
    const series = seriesTimes(temporal(radar()), []);
    if ('error' in series) throw new Error(series.error);
    expect(series.times).toHaveLength(MAX_FRAMES);
    expect(series.of).toBe(288);
    expect(series.times[0]).toBe('2026-11-12T05:20:00Z');
    expect(series.times[MAX_FRAMES - 1]).toBe('2026-11-13T05:15:00Z');
    expect(series.times[1]).toBe('2026-11-12T05:50:00Z');
  });

  it('steps over a range where the collection lists no times, as it does over an interval', () => {
    // The extent's own steps, over a month, are 6 h: the range's are hourly
    const series = seriesTimes({ interval: [['2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z']] }, [['datetime', '2026-11-12T00:00:00Z/2026-11-12T03:00:00Z']]);
    expect(series).toMatchObject({ times: ['2026-11-12T00:00:00Z', '2026-11-12T01:00:00Z', '2026-11-12T02:00:00Z', '2026-11-12T03:00:00Z'], from: 'range' });
  });

  it('says why there’s no series', () => {
    expect(seriesTimes(temporal(ifs()), [['datetime', `${grid[2]}/${grid[2]}`]])).toEqual({ error: 'The range chosen holds one time: a series needs two or more' });
    expect(seriesTimes(temporal(ifs()), [['datetime', '2020-01-01T00:00:00Z/2020-01-02T00:00:00Z'], ['subset', `reference_time("${RUN}")`]]))
      .toEqual({ error: 'The range chosen holds none of the times of the run asked: a series needs two or more' });
    expect(seriesTimes(temporal(ifs()), [['subset', `time("${RUN}")`]])).toEqual({ error: 'The request asks its time as time(…) in subset: a series steps through datetime' });
    expect(seriesTimes(undefined, [])).toEqual({ error: 'The collection has no temporal extent to animate' });
    expect(seriesTimes({ values: [RUN] }, [])).toEqual({ error: 'The collection lists fewer than two times to animate' });
  });
});

describe('frameParams', () => {
  it('puts a frame’s time in place of the request’s, or after the parameter, as the form orders them', () => {
    expect(frameParams([['parameter-name', 't'], ['datetime', 'a/b'], ['elevation', '850']], 'x')).toEqual([['parameter-name', 't'], ['datetime', 'x'], ['elevation', '850']]);
    expect(frameParams([['parameter-name', 't'], ['elevation', '850']], 'x')).toEqual([['parameter-name', 't'], ['datetime', 'x'], ['elevation', '850']]);
    expect(frameParams([['elevation', '850']], 'x')).toEqual([['datetime', 'x'], ['elevation', '850']]);
  });
});

describe('layerSourceOf', () => {
  const issue = (severity: QueryIssue['severity'], field: string, message: string): QueryIssue => ({ id: `x:${field}`, severity, source: 'metadata', field, message });
  const url = `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=nope`;

  it('draws the form’s request where the map query is picked, stopped by an error, saying which', () => {
    expect(layerSourceOf({ mapPicked: true, request: { url, issues: [issue('error', 'parameter-name', "nope isn't among the collection's parameter_names")] }, styleId: '', mapHref: null }))
      .toEqual({ from: 'form', choices: { endpoint: `${ROOT}/ecmwf-ifs-pressure/map`, styleId: '', params: [['parameter-name', 'nope']] }, blocked: "nope isn't among the collection's parameter_names" });
  });

  it('isn’t stopped by a warning, nor by an error in what the view decides', () => {
    const issues = [issue('warning', 'style', 'expect a 4xx'), issue('info', 'style', 'a note'), issue('error', 'bbox', 'bad box'), issue('error', 'width', 'not a positive integer')];
    expect(layerSourceOf({ mapPicked: true, request: { url, issues }, styleId: '', mapHref: null })).toMatchObject({ from: 'form', blocked: null });
  });

  it('waits for the form’s request, and without a map query draws the collection’s map, else its tiles', () => {
    expect(layerSourceOf({ mapPicked: true, request: null, styleId: '', mapHref: null })).toEqual({ from: 'waiting' });
    expect(layerSourceOf({ mapPicked: false, request: null, styleId: 'x', mapHref: `${ROOT}/x/map` }))
      .toEqual({ from: 'collection', choices: { endpoint: `${ROOT}/x/map`, styleId: '', params: [] } });
    expect(layerSourceOf({ mapPicked: false, request: { url, issues: [] }, styleId: '', mapHref: null })).toEqual({ from: 'tiles' });
  });
});

describe('sentKey', () => {
  const layer: SentByLayer = { sourceType: 'dynamic', dynamicEndpoint: `${ROOT}/x/map`, params: [['parameter-name', 't']], crs: 'EPSG:3857' };
  it('changes with everything a layer sends, and only with that', () => {
    const key = sentKey(layer);
    expect(sentKey({ ...layer, params: [['parameter-name', 't']] })).toBe(key);
    for (const changed of [
      { params: [['parameter-name', 'gh']] as Pairs }, { params: [] as Pairs }, { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' }, { dynamicEndpoint: `${ROOT}/y/map` },
      { sourceType: 'tiles' as const }, { tileUrl: TILES }, { apiKey: 'k' }, { apiKeyParam: 'key' },
    ]) {
      expect(sentKey({ ...layer, ...changed })).not.toBe(key);
    }
  });
});

describe('paramOf', () => {
  it('reads a parameter, empty where there’s none', () => {
    expect(paramOf([['f', 'image/png']], 'f')).toBe('image/png');
    expect(paramOf([], 'f')).toBe('');
  });
});
