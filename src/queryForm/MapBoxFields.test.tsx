import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Collection } from '../types/api';
import type { BBox } from '../query/types';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { withLinkQueries } from '../query/mapQuery';
import { CRS84_URI } from '../query/mapBox';
import { words } from '../coverage/cellsTestData';
import { MapBoxValue, MapCrsValue, MapSizeValue } from './MapBoxFields';
import box from '../query/__fixtures__/meteocore-maps-box.json';

// What the controls read from around them: the request line, the map's view and size and the box asked for, and whether
// it's a phone
const around = vi.hoisted(() => ({
  requestUrl: '', viewExtent: null as number[] | null, viewSize: null as number[] | null, viewMoving: false, boxDrawer: null as ((box: BBox) => void) | null,
  drawn: [] as (((box: BBox) => void) | null)[], mobile: false, mapShown: 0,
}));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('../contexts/MapInteractionContext', () => ({
  useMapInteraction: () => ({ viewExtent: around.viewExtent, viewSize: around.viewSize, viewMoving: around.viewMoving, boxDrawer: around.boxDrawer, drawBox: (take: ((box: BBox) => void) | null) => around.drawn.push(take) }),
}));
vi.mock('../contexts/PanesContext', () => ({ usePanes: () => ({ isMobile: around.mobile, showMap: () => { around.mapShown += 1; } }) }));

const RADAR = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
const collectionOf = (id: string) => withLinkQueries(structuredClone(box.collections.find(each => each.id === id)) as unknown as Collection);
const radar = () => collectionOf('fmi-radar-composite-dbz');
const URI = (code: number) => `http://www.opengis.net/def/crs/EPSG/0/${code}`;
// The view the Chrome check matched at 1440 on 2026-11-15, in EPSG:3857
const VIEW = [-310358.7403316467, 7222220.347849842, 5854403.340309051, 12391910.26030157];

let written: [string, string][] = [];
const state = { setQueryParam: (name: string, value: string) => written.push([name, value]) } as unknown as UseQueryUrlReturn;
const at = (query: string) => {
  around.requestUrl = `${RADAR}${query ? `?${query}` : ''}`;
};

beforeEach(() => {
  written = [];
  around.viewExtent = VIEW;
  around.viewSize = [954, 800];
  around.viewMoving = false;
  around.boxDrawer = null;
  around.drawn = [];
  around.mobile = false;
  around.mapShown = 0;
  at('');
});

// The elements a component gives, depth first: its controls' props, to call as a click would
type Props = Record<string, unknown>;
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (!React.isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap(elements) : [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
const textOf = (node: unknown): string => (Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : '');
const button = (node: React.ReactNode, label: string) => elements(node).find(element => typeof element.props.onClick === 'function' && textOf(element.props.children) === label);
const press = (node: React.ReactNode, label: string) => (button(node, label)!.props.onClick as () => void)();
const toggles = (node: React.ReactNode, label: string) => elements(node).find(element => element.props.label === label)!;
const shown = (html: string) => words(html).replace(/\s+/g, ' ').trim();
const eachButton = (html: string) => html.split('<button').slice(1).map(each => `<button${each.slice(0, each.indexOf('</button>'))}</button>`);
const buttons = (html: string) => eachButton(html).map(each => [shown(each), each.includes('disabled=""')]);
const pressed = (html: string) => eachButton(html).filter(each => each.includes('aria-pressed="true"')).map(shown);

const boxValue = (collection = radar()) => <MapBoxValue collection={collection} queryState={state} bboxText={<i>bbox</i>} bboxCrsText={<i>bbox-crs</i>} />;
const callBox = (collection = radar()) => MapBoxValue({ collection, queryState: state, bboxText: null, bboxCrsText: null });

describe('the box', () => {
  it('is bbox and bbox-crs side by side, bbox-crs’s valid values to pick, and what the map writes', () => {
    const html = renderToStaticMarkup(boxValue());
    expect(html).toContain('<i>bbox</i>');
    expect(html).toContain('id="query-field-bbox-crs"');
    expect(buttons(html)).toEqual([['CRS84', false], ['EPSG:3067', false], ['Match the map view', false], ["Use the collection's extent", false], ['Draw on the map', false]]);
    expect(shown(html)).toContain("Match the map view writes bbox , width and height from the map, 954 × 800, and crs EPSG:3857, the map's, so that the image lies on it pixel for pixel. "
      + 'Moving the map afterwards changes nothing here');
    expect(shown(html)).toContain('Draw on the map writes bbox alone, in CRS84, at 3 decimals');
    expect(pressed(html)).toEqual([]);
  });

  it('writes bbox, width, height and crs at once from the map as it is, and nothing else', () => {
    press(callBox(), 'Match the map view');
    expect(written).toEqual([['bbox', '-2.788,54.274,52.591,73.691'], ['width', '954'], ['height', '800'], ['crs', URI(3857)]]);
  });

  it('takes out a bbox-crs that isn’t CRS84, since the view and the extent are written in CRS84, and says so', () => {
    at(`bbox-crs=${URI(3067)}`);
    press(callBox(), 'Match the map view');
    expect(written.slice(-1)).toEqual([['bbox-crs', '']]);
    written = [];
    press(callBox(), "Use the collection's extent");
    expect(written).toEqual([['bbox', '6.683,55.934,43.12,72.856'], ['bbox-crs', '']]);
    expect(shown(renderToStaticMarkup(boxValue()))).toContain("Match the map view and Use the collection's extent write CRS84, and take out bbox-crs EPSG:3067");
    // CRS84 stays, however it's written
    at('bbox-crs=CRS:84');
    written = [];
    press(callBox(), "Use the collection's extent");
    expect(written).toEqual([['bbox', '6.683,55.934,43.12,72.856']]);
    expect(shown(renderToStaticMarkup(boxValue()))).not.toContain('take out');
  });

  it('leaves crs alone where the collection doesn’t list EPSG:3857, and says where the image will lie', () => {
    const unlisted = { ...radar(), crs: [CRS84_URI, URI(3067)] } as Collection;
    press(callBox(unlisted), 'Match the map view');
    expect(written.map(([name]) => name)).toEqual(['bbox', 'width', 'height']);
    expect(shown(renderToStaticMarkup(boxValue(unlisted))))
      .toContain("and leaves crs : the collection doesn't list EPSG:3857, the map's, so the image lies where it should only if it comes back in CRS84 or EPSG:4326");
  });

  it('waits for the map to have a view, and names the map pane on a phone', () => {
    around.viewSize = null;
    let html = renderToStaticMarkup(boxValue());
    expect(buttons(html)[2]).toEqual(['Match the map view', true]);
    expect(shown(html)).toContain('Match the map view waits for the map to show once');
    callBox();
    around.viewSize = [390, 692];
    around.mobile = true;
    html = renderToStaticMarkup(boxValue());
    expect(shown(html)).toContain('from the map pane as it shows, 390 × 692, and crs EPSG:3857');
  });

  it('waits while the map moves, as when it frames the collection: the view it last stopped at isn’t the one it will show', () => {
    around.viewMoving = true;
    const html = renderToStaticMarkup(boxValue());
    expect(buttons(html)[2]).toEqual(['Match the map view', true]);
    expect(shown(html)).toContain('Match the map view waits for the map to stop moving');
    press(callBox(), 'Match the map view');
    expect(written).toEqual([]);
  });

  it('has no extent to use where the collection gives none in lon/lat', () => {
    const none = { ...radar(), extent: {} } as Collection;
    expect(button(callBox(none), "Use the collection's extent")).toBeUndefined();
  });

  it('asks the map for one box, which goes in bbox alone, in bbox-crs as it is', () => {
    const drawn: BBox = [21.85949, 62.59712, 28.14651, 64.55188];
    press(callBox(), 'Draw on the map');
    expect(around.drawn).toHaveLength(1);
    around.drawn[0]!(drawn);
    expect(written).toEqual([['bbox', '21.859,62.597,28.147,64.552']]);
    at('bbox-crs=[EPSG:4326]');
    written = [];
    press(callBox(), 'Draw on the map');
    around.drawn[1]!(drawn);
    expect(written).toEqual([['bbox', '62.597,21.859,64.552,28.147']]);
    expect(shown(renderToStaticMarkup(boxValue()))).toContain('Draw on the map writes bbox alone, in EPSG:4326, latitude first, at 3 decimals');
    at(`bbox-crs=${URI(3857)}`);
    written = [];
    press(callBox(), 'Draw on the map');
    around.drawn[2]!([21.859, 62.597, 28.147, 64.552]);
    expect(written).toEqual([['bbox', '2433333,9002109,3133310,9491344']]);
    // Only the map is drawn on: the form stays where it is on a desktop
    expect(around.mapShown).toBe(0);
  });

  it('goes to the map on a phone, and stops drawing when pressed again', () => {
    around.mobile = true;
    press(callBox(), 'Draw on the map');
    expect(around.mapShown).toBe(1);
    around.boxDrawer = () => {};
    const html = renderToStaticMarkup(boxValue());
    expect(buttons(html)[4]).toEqual(['Stop drawing', false]);
    expect(html).toContain('aria-pressed="true"');
    expect(shown(html)).toContain('Click one corner of the box on the map, then the opposite corner');
    press(callBox(), 'Stop drawing');
    expect(around.drawn.slice(-1)).toEqual([null]);
    expect(around.mapShown).toBe(1);
  });

  it('leaves a typed bbox-crs that isn’t among the valid values in its text, not as a toggle', () => {
    at('bbox-crs=EPSG:2393');
    expect(buttons(renderToStaticMarkup(boxValue())).slice(0, 3).map(([label]) => label)).toEqual(['CRS84', 'EPSG:3067', 'Match the map view']);
  });

  it('is off in a bbox-crs the map can’t write, and says why', () => {
    at(`bbox-crs=${URI(3067)}`);
    const html = renderToStaticMarkup(boxValue());
    expect(buttons(html)[4]).toEqual(['Draw on the map', true]);
    expect(shown(html)).toContain('Drawing is off: the map writes a box in CRS84, EPSG:4326 or EPSG:3857, not EPSG:3067');
    expect(pressed(html)).toEqual(['EPSG:3067']);
  });

  it('picks bbox-crs from its valid values, the crs asked among them, and takes it back', () => {
    at(`crs=${URI(3857)}&bbox-crs=${CRS84_URI}`);
    const html = renderToStaticMarkup(boxValue());
    expect(buttons(html).slice(0, 3).map(([label]) => label)).toEqual(['CRS84', 'EPSG:3067', 'EPSG:3857']);
    expect(pressed(html)).toEqual(['CRS84']);
    const crs = toggles(callBox(), 'bbox-crs');
    (crs.props.onChange as (value: string) => void)(URI(3857));
    (crs.props.onChange as (value: string) => void)('');
    expect(written).toEqual([['bbox-crs', URI(3857)], ['bbox-crs', '']]);
  });
});

const sizeValue = (collection = radar()) => <MapSizeValue collection={collection} queryState={state} widthText={<i>width</i>} heightText={<i>height</i>} />;
const callSize = (collection = radar()) => MapSizeValue({ collection, queryState: state, widthText: null, heightText: null });

describe('the size', () => {
  it('is width × height, the map’s size to use, and the size that keeps the box’s shape', () => {
    at(`bbox=19,59,32,70&width=400&crs=${URI(3857)}`);
    const html = renderToStaticMarkup(sizeValue());
    expect(html).toContain('id="query-field-height"');
    expect(shown(html)).toContain('width × height');
    expect(buttons(html)).toEqual([["Use the map's size, 954 × 800", false], ["Keep the box's shape", false]]);
    expect(shown(html)).toContain("Keep the box's shape works out height from width and the box, in EPSG:3857, which the map comes back in");
    press(callSize(), "Use the map's size, 954 × 800");
    press(callSize(), "Keep the box's shape");
    // As MeteoCore sized the same box in EPSG:3857 on 2026-11-15: 400 × 798
    expect(written).toEqual([['width', '954'], ['height', '800'], ['height', '798']]);
    // A desktop's map is beside the form: nothing to say of where its size is from
    expect(shown(html)).not.toContain("The map's size is");
  });

  it('has no size to use while the map has none', () => {
    around.viewSize = [0, 800];
    expect(buttons(renderToStaticMarkup(sizeValue()))[0]).toEqual(["Use the map's size", true]);
  });

  it('says why the shape can’t be kept, and that a phone’s map is a pane away', () => {
    at('bbox=19,59,32,70&width=400');
    let html = renderToStaticMarkup(sizeValue());
    expect(buttons(html)[1]).toEqual(["Keep the box's shape", true]);
    expect(shown(html)).toContain("Keep the box's shape: Only for a map in CRS84, EPSG:4326 or EPSG:3857, and it comes back in EPSG:3067, the storage CRS");
    press(callSize(), "Keep the box's shape");
    expect(written).toEqual([]);
    around.mobile = true;
    around.viewSize = [390.4, 692];
    html = renderToStaticMarkup(sizeValue());
    expect(shown(html)).toContain("The map's size is the map pane as it shows, 390 × 692");
    around.viewSize = null;
    html = renderToStaticMarkup(sizeValue());
    expect(buttons(html)[0]).toEqual(["Use the map's size", true]);
    press(callSize(), "Use the map's size");
    expect(written).toEqual([]);
  });
});

describe('the CRS', () => {
  const options = box.collections[0].crs;
  it('is typed, with the collection’s list to pick, shown short and written as listed', () => {
    at(`crs=${URI(3857)}`);
    const html = renderToStaticMarkup(<MapCrsValue options={options} queryState={state} crsText={<i>crs</i>} />);
    expect(html).toContain('<i>crs</i>');
    expect(buttons(html).map(([label]) => label)).toEqual(['CRS84', 'EPSG:4326', 'EPSG:3857', 'EPSG:3067', 'EPSG:3035']);
    expect(pressed(html)).toEqual(['EPSG:3857']);
    const crs = toggles(MapCrsValue({ options, queryState: state, crsText: null }), 'crs');
    (crs.props.onChange as (value: string) => void)(URI(3067));
    expect(written).toEqual([['crs', URI(3067)]]);
  });

  it('leaves a CRS not written as listed in the text, unpressed, and lists nothing where the collection lists nothing', () => {
    at('crs=EPSG:3857');
    expect(pressed(renderToStaticMarkup(<MapCrsValue options={options} queryState={state} crsText={null} />))).toEqual([]);
    expect(buttons(renderToStaticMarkup(<MapCrsValue options={[]} queryState={state} crsText={<i>crs</i>} />))).toEqual([]);
  });
});
