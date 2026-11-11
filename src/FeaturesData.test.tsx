import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FeaturesData, { FeatureData, type FeatureNoun } from './FeaturesData';
import { withClass, words } from './coverage/cellsTestData';
import knmi from './locations/__fixtures__/knmi-tg1-oper-locations.json';
import type { FeatureRow, GeoJsonFeature } from './featureRows';

// The location on the map, which a test can set, and what picking a row asked for
const state = vi.hoisted(() => ({
  responseLocation: null as unknown,
  shown: [] as unknown[],
  mapShown: 0,
  grid: null as null | Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  clicks: {} as Record<string, () => void>,
}));
vi.mock('./contexts/MapInteractionContext', () => ({
  useMapInteraction: () => ({ responseLocation: state.responseLocation, showResponseLocation: (feature: unknown) => state.shown.push(feature) }),
}));
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ showMap: () => { state.mapShown++; } }) }));
// As it is, but keeping what a button does when pressed, by its text, which the server renderer leaves out
vi.mock('@mui/material/Button', async importOriginal => {
  const { default: Button } = await importOriginal<typeof import('@mui/material/Button')>();
  return {
    default: (props: { children?: React.ReactNode; onClick?: () => void }) => {
      state.clicks[String(props.children)] = props.onClick!;
      return <Button {...props} />;
    },
  };
});
// The grid draws only in a browser: here it keeps what it was given
vi.mock('@mui/x-data-grid', async importOriginal => ({
  ...await importOriginal<typeof import('@mui/x-data-grid')>(),
  DataGrid: (props: Record<string, unknown>) => {
    state.grid = props;
    return <div data-grid="" />;
  },
}));

const render = (features: readonly unknown[]) => {
  state.grid = null;
  return renderToStaticMarkup(<FeaturesData features={features} />);
};
const grid = () => state.grid!;
const headers = () => grid().columns.map((column: { headerName: string }) => column.headerName);
const rows = (): FeatureRow[] => grid().rows;

// MeteoCore's locations are named by EDR's label
const labelled = (count: number) => Array.from({ length: count }, (_, index) => ({
  type: 'Feature', id: `0-148-0-${index}`, geometry: { type: 'Point', coordinates: [20 + index, 13] },
  properties: { datetime: '2026-10-10T00:00:00+00:00/..', label: `Station ${index}`, 'parameter-name': ['air_temperature'] },
}));

describe('FeaturesData', () => {
  it('counts the locations above them', () => {
    expect(words(render(knmi.features))).toBe('10 locations Pick one to see it on the map');
    expect(words(render(labelled(1)))).toContain('1 location Pick one');
    expect(words(render(labelled(6102)))).toContain('6,102 locations');
    expect(words(render([]))).toBe('0 locations');
  });

  it('has a row per location, numbered, with its id, its name, where it is, and its other properties', () => {
    render(knmi.features);
    expect(headers()).toEqual(['ID', 'name', 'Geometry']);
    expect(rows()).toHaveLength(10);
    expect(rows()[0]).toMatchObject({ id: 0, featureId: 'EDDK', geometry: 'Point 7.1427397728, 50.8658981323', 'property:name': 'Cologne Bonn Airport' });
    render(labelled(3));
    expect(headers()).toEqual(['ID', 'label', 'Geometry', 'datetime', 'parameter-name']);
  });

  it('has no name column where none of them has a name', () => {
    render([{ type: 'Feature', id: 'a', geometry: null, properties: { height: 3 } }]);
    expect(headers()).toEqual(['ID', 'Geometry', 'height']);
  });

  it('pages a long list, with a search over it and no column menus', () => {
    render(labelled(6102));
    expect(rows()).toHaveLength(6102);
    expect(grid().pageSizeOptions).toEqual([100]);
    expect(grid().initialState.pagination.paginationModel.pageSize).toBe(100);
    expect(grid().showToolbar).toBe(true);
    expect(grid().slots.toolbar).toBeTypeOf('function');
    // A menu button shows through the hidden pane on a touch screen
    expect(grid().disableColumnMenu).toBe(true);
  });

  it('shows a picked location on the map, as it came, and leaves the query to the map’s own picks', () => {
    state.shown = [];
    state.mapShown = 0;
    render(knmi.features);
    grid().onRowClick({ row: rows()[2] });
    expect(state.shown).toEqual([knmi.features[2]]);
    expect(state.shown[0]).toBe(knmi.features[2]);
    expect(state.mapShown).toBe(1);
  });

  it('doesn’t go to the map for a location with nothing to show there', () => {
    state.shown = [];
    state.mapShown = 0;
    const nowhere = { type: 'Feature', id: 'x', geometry: null, properties: {} };
    render([nowhere]);
    grid().onRowClick({ row: rows()[0] });
    expect(state.shown).toEqual([nowhere]);
    expect(state.mapShown).toBe(0);
  });

  it('marks the row of the location on the map, and none for another list’s', () => {
    state.responseLocation = knmi.features[3];
    render(knmi.features);
    expect([...grid().rowSelectionModel.ids]).toEqual([3]);
    state.responseLocation = { ...knmi.features[3] };
    render(knmi.features);
    expect([...grid().rowSelectionModel.ids]).toEqual([]);
    state.responseLocation = null;
    render(knmi.features);
    expect([...grid().rowSelectionModel.ids]).toEqual([]);
    expect(grid().hideFooterSelectedRowCount).toBe(true);
  });
});

// A list of items: MSC GeoMet's stations, as many as it sent and the counts it gave
const stations = (count: number) => Array.from({ length: count }, (_, index) => ({
  type: 'Feature', id: `01AD00${index}`, geometry: { type: 'Point', coordinates: [-68 - index, 47] }, properties: { STATION_NAME: `Station ${index}`, RHBN: 0 },
}));
const ORANGE = 'color:#ed6c02';
const items = (features: readonly unknown[], noun: FeatureNoun, numberMatched: number | null = null, numberReturned: number | null = null) => {
  state.grid = null;
  return renderToStaticMarkup(<FeaturesData features={features} noun={noun} numberMatched={numberMatched} numberReturned={numberReturned} />);
};

describe('FeaturesData, for items', () => {
  it('calls them what the collection’s items are, and searches them by that word', () => {
    expect(words(items(stations(2), 'item'))).toBe('2 items Pick one to see it on the map');
    expect(words(items(stations(1), 'record'))).toBe('1 record Pick one to see it on the map');
    const toolbars = new Set<unknown>();
    for (const noun of ['location', 'item', 'record'] as const) {
      items(stations(1), noun);
      toolbars.add(grid().slots.toolbar);
    }
    expect(toolbars.size).toBe(3);
  });

  it('says how many the server says it matched and sent, by their own names, where it says so', () => {
    const html = items(stations(2), 'item', 8057, 2);
    expect(words(html)).toBe('2 items numberMatched 8,057 numberReturned 2 Pick one to see it on the map');
    expect(html).toContain('<code');
    expect(html).not.toContain(ORANGE);
    expect(words(items(stations(2), 'item', null, 2))).toBe('2 items numberReturned 2 Pick one to see it on the map');
    expect(words(items(stations(2), 'item', 109))).toBe('2 items numberMatched 109 Pick one to see it on the map');
  });

  it('says it in orange where numberReturned isn’t the number the answer has', () => {
    const html = items(stations(2), 'record', 608, 3);
    expect(words(html)).toBe('2 records numberMatched 608 numberReturned 3 (the answer has 2 records) Pick one to see it on the map');
    expect(html).toContain(ORANGE);
    expect(html).toContain('title="the answer has 2 records"');
  });

  it('is a table like a locations list’s, picked to the map the same way', () => {
    state.shown = [];
    state.mapShown = 0;
    const list = stations(3);
    items(list, 'item');
    expect(headers()).toEqual(['ID', 'Geometry', 'STATION_NAME', 'RHBN']);
    grid().onRowClick({ row: rows()[1] });
    expect(state.shown).toEqual([list[1]]);
    expect(state.mapShown).toBe(1);
  });
});

describe('FeatureData', () => {
  const record: GeoJsonFeature = {
    type: 'Feature',
    id: 'urn:wmo:md:ca-eccc-msc:5e8247ca',
    geometry: { type: 'MultiPolygon', coordinates: [[[[-172.17, 36.5], [-172.17, 83.6], [-10.42, 83.6], [-10.42, 36.5], [-172.17, 36.5]]]] },
    properties: { title: 'Marine Forecasts and Warnings', keywords: ['marine', 'warnings'], language: { code: 'en' }, rank: 2, updated: null },
  };
  const render1 = (feature: GeoJsonFeature, noun: FeatureNoun = 'record') => {
    state.clicks = {};
    return renderToStaticMarkup(<FeatureData feature={feature} noun={noun} />);
  };

  it('lists one item’s id, where it is, and each property by name', () => {
    const html = render1(record);
    expect(words(html)).toBe(
      '1 record See it on the map id urn:wmo:md:ca-eccc-msc:5e8247ca geometry MultiPolygon bbox -172.17, 36.5, -10.42, 83.6 '
      + 'properties.title Marine Forecasts and Warnings properties.keywords marine warnings properties.language {"code":"en"} '
      + 'properties.rank 2 properties.updated null',
    );
    expect(html.split('<dt').length - 1).toBe(7);
    expect(html.split('<dd').length - 1).toBe(7);
  });

  it('shows keywords as chips', () => {
    const html = render1(record);
    expect(withClass(html, 'MuiChip-root')).toBe(2);
  });

  it('shows it on the map from its button, as a row is', () => {
    state.shown = [];
    state.mapShown = 0;
    render1(record);
    state.clicks['See it on the map']();
    expect(state.shown).toEqual([record]);
    expect(state.mapShown).toBe(1);
  });

  it('has no button, and says so, for an item with nothing to show on a map', () => {
    const html = render1({ type: 'Feature', id: 7, geometry: null, properties: { a: 1 } }, 'item');
    expect(words(html)).toBe('1 item id 7 geometry null properties.a 1');
    expect(state.clicks['See it on the map']).toBeUndefined();
  });

  it('copes with an item without an id or properties, or with an id that isn’t a plain value', () => {
    expect(words(render1({ type: 'Feature', geometry: undefined }, 'item'))).toBe('1 item geometry none');
    expect(words(render1({ type: 'Feature', id: { a: 1 }, properties: [1, 2] }, 'item'))).toBe('1 item id {"a":1} geometry none');
  });
});
