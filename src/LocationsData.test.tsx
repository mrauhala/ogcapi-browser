import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocationsData from './LocationsData';
import { words } from './coverage/cellsTestData';
import knmi from './locations/__fixtures__/knmi-tg1-oper-locations.json';
import type { FeatureRow } from './featureRows';

// The location on the map, which a test can set, and what picking a row asked for
const state = vi.hoisted(() => ({
  responseLocation: null as unknown,
  shown: [] as unknown[],
  mapShown: 0,
  grid: null as null | Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
}));
vi.mock('./contexts/MapInteractionContext', () => ({
  useMapInteraction: () => ({ responseLocation: state.responseLocation, showResponseLocation: (feature: unknown) => state.shown.push(feature) }),
}));
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ showMap: () => { state.mapShown++; } }) }));
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
  return renderToStaticMarkup(<LocationsData features={features} />);
};
const grid = () => state.grid!;
const headers = () => grid().columns.map((column: { headerName: string }) => column.headerName);
const rows = (): FeatureRow[] => grid().rows;

// MeteoCore's locations are named by EDR's label
const labelled = (count: number) => Array.from({ length: count }, (_, index) => ({
  type: 'Feature', id: `0-148-0-${index}`, geometry: { type: 'Point', coordinates: [20 + index, 13] },
  properties: { datetime: '2026-10-10T00:00:00+00:00/..', label: `Station ${index}`, 'parameter-name': ['air_temperature'] },
}));

describe('LocationsData', () => {
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
