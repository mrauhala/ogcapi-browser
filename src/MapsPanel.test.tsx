import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import MapsPanel from './MapsPanel';
import type { Collection } from './types/api';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { MapsBundleState, MapsLayer } from './contexts/MapsLayerContext';
import type { QueryValidationState } from './contexts/QueryValidationContext';
import type { QueryIssue } from './query/types';
import { withMapQuery, mapStylesOf } from './query/mapQuery';
import { tileTemplatesOf } from './api/maps';
import { buildOperationIndex, type OperationIndex } from './validation/openapi/operationIndex';
import { words } from './coverage/cellsTestData';
import fixture from './query/__fixtures__/meteocore-map-layers.json';

const state = vi.hoisted(() => ({
  validation: null as unknown,
  index: null as unknown,
  templates: [] as unknown[],
  conformsTo: [] as string[],
  layers: [] as unknown[],
  bundles: {} as Record<string, unknown>,
  clicks: {} as Record<string, () => Promise<void>>,
}));
vi.mock('./contexts/MapsLayerContext', () => ({
  useMapsLayers: () => ({
    setMapsLayers: (next: (layers: unknown[]) => unknown[]) => { state.layers = next(state.layers); },
    setMapsBundles: (next: (bundles: Record<string, unknown>) => Record<string, unknown>) => { state.bundles = next(state.bundles); },
  }),
}));
vi.mock('./contexts/ServiceContext', () => ({ useService: () => ({ getAuthCredentials: () => undefined }) }));
vi.mock('./contexts/QueryValidationContext', () => ({ useQueryValidationContext: () => ({ queryValidation: state.validation }) }));
vi.mock('./contexts/OpenApiContext', () => ({ useOpenApi: () => ({ index: state.index }) }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: state.conformsTo }) }));
vi.mock('./api/maps', async importOriginal => ({
  ...await importOriginal<typeof import('./api/maps')>(),
  resolveWebMercatorTileTemplates: async () => state.templates,
}));
// As it is, but keeping what each button does when pressed, by its text, which the server renderer leaves out
vi.mock('@mui/material/Button', async importOriginal => {
  const { default: Button } = await importOriginal<typeof import('@mui/material/Button')>();
  return {
    default: (props: { children?: ReactNode; onClick?: () => Promise<void> }) => {
      state.clicks[String(props.children).trim()] = props.onClick!;
      return <Button {...props} />;
    },
  };
});

const ROOT = 'https://meteocore.app.meteo.fi/collections';
const URI_3857 = 'http://www.opengis.net/def/crs/EPSG/0/3857';
const RUN = '2026-11-12T18:00:00Z';
const XYZ = `${ROOT}/ecmwf-ifs-pressure/map/tiles/WebMercatorQuad/{z}/{y}/{x}`;
const collectionOf = (id: string) => structuredClone(fixture.collections.find(each => each.id === id)) as unknown as Collection;
const IFS = collectionOf('ecmwf-ifs-pressure');
const STYLES = mapStylesOf(fixture.styles.styles);
// MeteoCore's API docs, with only its tile operation
const INDEX: OperationIndex = buildOperationIndex({
  url: 'https://meteocore.app.meteo.fi/api',
  doc: { paths: { [fixture.tileOperation.path]: { get: { parameters: fixture.tileOperation.parameters.map(param => ({ ...param, required: param.in === 'path', schema: { type: 'string' } })) } } } },
});

// The form with the map query picked, and the request it built, with what it found
const picked = (collection: Collection, styleId = ''): Partial<UseQueryUrlReturn> => ({
  queryTarget: { collection: withMapQuery(collection), queryKey: 'map' },
  styleId,
  mapStyles: { status: 'ready', styles: STYLES, source: 'link' },
});
const built = (collection: Collection, url: string, issues: QueryIssue[] = []): QueryValidationState =>
  ({ url, issues, apiOperation: null, declaring: { query: 'map', collection: withMapQuery(collection) } });
const render = (collection: Collection, queryState: Partial<UseQueryUrlReturn> = { queryTarget: null, styleId: '', mapStyles: { status: 'idle', styles: [], source: null } }) =>
  renderToStaticMarkup(<MapsPanel collection={collection} apiUrl="https://meteocore.app.meteo.fi" queryState={queryState as UseQueryUrlReturn} />);
const layers = () => state.layers as MapsLayer[];
const disabled = (html: string, label: string) => html.split('<button').find(button => button.includes(`${label}</button>`))?.includes(' disabled=""');

beforeEach(() => {
  state.validation = null;
  state.index = INDEX;
  state.templates = tileTemplatesOf(fixture.tilesets.tilesets[0].links);
  state.conformsTo = fixture.conformsTo;
  state.layers = [];
  state.bundles = {};
  state.clicks = {};
});

describe('MapsPanel', () => {
  it('has no Style or Format of its own: with no map query picked, it draws the collection’s own map', () => {
    const html = render(IFS);
    expect(words(html)).toContain("Map layers Draws the collection's own map over the map's view. Pick map in the Query row above to choose what's drawn.");
    expect(words(html)).toContain('Add layer Add animated series A series steps through the 8 times the collection lists.');
    expect(html).not.toContain('combobox');
    expect(words(html)).not.toContain('Style');
    expect(words(html)).not.toContain('Format');
  });

  it('says what the form has chosen, which a layer will draw', () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?parameter-name=t&subset=reference_time("${RUN}")&elevation=850`);
    const html = render(IFS, picked(IFS, 'fmi-hires'));
    expect(words(html)).toContain(`Draws what the form above has chosen: fmi-hires · t · elevation 850 · run ${RUN}, over the map's view.`);
    expect(words(html)).toContain('A series steps through the 6 times the collection lists from the run asked on.');
    expect(disabled(html, 'Add layer')).toBe(false);
  });

  it('says so when the map query has nothing chosen', () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map`);
    expect(words(render(IFS, picked(IFS)))).toContain("Draws what the form above has chosen: nothing yet, so the collection's own map, over the map's view.");
  });

  it('adds no layer while the form’s request has an error, and says why', () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=nope`, [
      { id: 'metadata:parameter-name:offered', severity: 'error', source: 'metadata', field: 'parameter-name', message: "nope isn't among the collection's parameter_names" },
    ]);
    const html = render(IFS, picked(IFS));
    expect(words(html)).toContain("No layer while the form's request has an error: nope isn't among the collection's parameter_names");
    expect(disabled(html, 'Add layer')).toBe(true);
    expect(disabled(html, 'Add animated series')).toBe(true);
    expect(words(html)).not.toContain('A series steps');
  });

  it('waits for the form to build its request, and doesn’t take another collection’s for it', () => {
    state.validation = { ...built(IFS, `${ROOT}/ecmwf-ifs-pressure/map`), declaring: null };
    const html = render(IFS, picked(IFS));
    expect(words(html)).toContain('Draws what the form above has chosen, once its request is built.');
    expect(disabled(html, 'Add layer')).toBe(true);
    const radar = collectionOf('fmi-radar-composite-dbz');
    state.validation = built(radar, `${ROOT}/fmi-radar-composite-dbz/map?parameter-name=x`);
    expect(words(render(IFS, picked(IFS)))).toContain('Draws what the form above has chosen, once its request is built.');
  });

  it('draws the tiles of a collection with tiles and no map, as served', async () => {
    const opera = collectionOf('opera-precipitation');
    state.templates = [{ href: `${ROOT}/opera-precipitation/map/tiles/WebMercatorQuad/{z}/{y}/{x}`, type: 'image/png' }];
    const html = render(opera);
    expect(words(html)).toContain("Draws the collection's tiles, as served: it has no map to choose what's drawn from.");
    expect(words(html)).not.toContain('Add animated series');
    await state.clicks['Add layer']();
    expect(layers()).toMatchObject([{ sourceType: 'tiles', tileUrl: `${ROOT}/opera-precipitation/map/tiles/WebMercatorQuad/{z}/{y}/{x}`, params: [], title: opera.title }]);
  });

  it('adds nothing, and says so, where a collection with no map has no tiles to draw after all', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.templates = [];
    render(collectionOf('opera-precipitation'));
    await state.clicks['Add layer']();
    expect(layers()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('draws nothing for a collection with neither a map nor tiles', () => {
    expect(render({ ...IFS, links: [] })).toBe('');
  });
});

describe('Add layer', () => {
  it('asks the style’s map for each view, where the style has no tiles of its own, with what the form chose and the listed CRS', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?parameter-name=t&subset=reference_time("${RUN}")&elevation=850`);
    render(IFS, picked(IFS, 'fmi-hires'));
    await state.clicks['Add layer']();
    expect(layers()).toHaveLength(1);
    expect(layers()[0]).toMatchObject({
      collectionId: 'ecmwf-ifs-pressure',
      styleId: 'fmi-hires',
      title: `${IFS.title} · fmi-hires · t · elevation 850 · run ${RUN}`,
      sourceType: 'dynamic',
      dynamicEndpoint: `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map`,
      params: [['parameter-name', 't'], ['subset', `reference_time("${RUN}")`], ['elevation', '850']],
      crs: URI_3857,
      visible: true,
    });
    expect(layers()[0].tileUrl).toBeUndefined();
  });

  it('draws tiles where they take every choice, carrying them', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=gh&subset=reference_time("${RUN}")&elevation=850`);
    render(IFS, picked(IFS));
    await state.clicks['Add layer']();
    expect(layers()[0]).toMatchObject({
      sourceType: 'tiles', tileUrl: XYZ, params: [['parameter-name', 'gh'], ['subset', `reference_time("${RUN}")`], ['elevation', '850']], title: `${IFS.title} · gh · elevation 850 · run ${RUN}`,
    });
    expect(layers()[0].dynamicEndpoint).toBeUndefined();
  });

  it('asks the map for each view where the tiles can’t take a choice, or the API docs aren’t there to say they can', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?subset=time("${RUN}")`);
    render(IFS, picked(IFS));
    await state.clicks['Add layer']();
    state.index = null;
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t`);
    render(IFS, picked(IFS));
    await state.clicks['Add layer']();
    expect(layers().map(layer => [layer.sourceType, layer.dynamicEndpoint, layer.params])).toEqual([
      ['dynamic', `${ROOT}/ecmwf-ifs-pressure/map`, [['subset', `time("${RUN}")`]]],
      ['dynamic', `${ROOT}/ecmwf-ifs-pressure/map`, [['parameter-name', 't']]],
    ]);
  });

  it('makes a layer for each choice, and the same choices twice make one', async () => {
    for (const parameter of ['t', 'gh', 't']) {
      state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=${parameter}`);
      render(IFS, picked(IFS));
      await state.clicks['Add layer']();
    }
    expect(layers().map(layer => layer.params)).toEqual([[['parameter-name', 't']], [['parameter-name', 'gh']]]);
    expect(layers()[0].id).not.toBe(layers()[1].id);
  });

  it('shows a layer hidden in the list again when the same choices are added', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t`);
    render(IFS, picked(IFS));
    await state.clicks['Add layer']();
    state.layers = layers().map(layer => ({ ...layer, visible: false }));
    await state.clicks['Add layer']();
    expect(layers().map(layer => layer.visible)).toEqual([true]);
  });

  it('keeps what it was added with: the layer is its own copy of the choices', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t`);
    render(IFS, picked(IFS));
    await state.clicks['Add layer']();
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=gh`);
    render(IFS, picked(IFS));
    expect(layers()).toHaveLength(1);
    expect(layers()[0].params).toEqual([['parameter-name', 't']]);
  });

  it('draws the collection’s own map with nothing chosen when the map query isn’t picked, though the form has a style', async () => {
    render(IFS, { ...picked(IFS, 'fmi-hires'), queryTarget: null });
    await state.clicks['Add layer']();
    expect(layers()[0]).toMatchObject({ sourceType: 'tiles', tileUrl: XYZ, params: [], title: IFS.title });
    expect(layers()[0].styleId).toBeUndefined();
  });
});

describe('Add animated series', () => {
  it('adds a frame for each time in the range chosen, each asking its own time and the rest as chosen', async () => {
    const grid = (IFS.extent!.temporal!.grid!.coordinates as string[]).map(time => time.replace('+00:00', 'Z'));
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t&datetime=${grid[2]}/${grid[4]}&elevation=850`);
    const html = render(IFS, picked(IFS));
    expect(words(html)).toContain('A series steps through the 3 times in the range chosen.');
    await state.clicks['Add animated series']();
    expect(layers().map(layer => [layer.sourceType, layer.frameIndex, layer.frameTime, layer.params])).toEqual(grid.slice(2, 5).map((time, i) =>
      ['tiles', i, time, [['parameter-name', 't'], ['datetime', time], ['elevation', '850']]]));
    expect(new Set(layers().map(layer => layer.id)).size).toBe(3);
    expect(layers()[1].title).toBe(`${IFS.title} · t · elevation 850 @ ${grid[3]}`);
    const bundles = Object.values(state.bundles) as MapsBundleState[];
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ collectionTitle: `${IFS.title} · t · elevation 850`, frameCount: 3, currentIndex: 0, isPlaying: false });
    expect(layers().every(layer => layer.bundleId === bundles[0].bundleId)).toBe(true);
  });

  it('leaves f off frames on tiles of that format, as off a layer', async () => {
    const grid = (IFS.extent!.temporal!.grid!.coordinates as string[]).map(time => time.replace('+00:00', 'Z'));
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?parameter-name=t&datetime=${grid[2]}/${grid[3]}&f=image/png`);
    render(IFS, picked(IFS));
    await state.clicks['Add animated series']();
    expect(layers().map(layer => [layer.sourceType, layer.params])).toEqual(grid.slice(2, 4).map(time => ['tiles', [['parameter-name', 't'], ['datetime', time]]]));
  });

  it('without API docs, puts a series on tiles only where the API declares Tiles’ datetime class', async () => {
    state.index = null;
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map`);
    render(IFS, picked(IFS));
    await state.clicks['Add animated series']();
    expect(new Set(layers().map(layer => layer.sourceType))).toEqual(new Set(['tiles']));
    state.layers = [];
    state.conformsTo = fixture.conformsTo.filter(uri => !uri.endsWith('/datetime'));
    render(IFS, picked(IFS));
    await state.clicks['Add animated series']();
    expect(new Set(layers().map(layer => layer.sourceType))).toEqual(new Set(['dynamic']));
    expect(layers()[0].params).toEqual([['datetime', layers()[0].frameTime]]);
  });

  it('asks the style’s map for each frame, where the style has no tiles', async () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map?parameter-name=t&subset=reference_time("${RUN}")`);
    render(IFS, picked(IFS, 'fmi-hires'));
    await state.clicks['Add animated series']();
    expect(layers()).toHaveLength(6);
    expect(layers()[0]).toMatchObject({
      sourceType: 'dynamic', dynamicEndpoint: `${ROOT}/ecmwf-ifs-pressure/styles/fmi-hires/map`, crs: URI_3857,
      params: [['parameter-name', 't'], ['datetime', RUN], ['subset', `reference_time("${RUN}")`]],
    });
  });

  it('isn’t offered where the request asks its time in subset, and says why', () => {
    state.validation = built(IFS, `${ROOT}/ecmwf-ifs-pressure/map?subset=time("${RUN}")`);
    const html = render(IFS, picked(IFS));
    expect(disabled(html, 'Add animated series')).toBe(true);
    expect(disabled(html, 'Add layer')).toBe(false);
    expect(words(html)).toContain('The request asks its time as time(…) in subset: a series steps through datetime');
  });
});
