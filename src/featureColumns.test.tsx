import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GridColDef } from '@mui/x-data-grid';
import { featureIdColumn, geometryColumn, propertyColumn } from './featureColumns';
import { featureRows, type FeatureRow } from './featureRows';
import LocationFeatureList from './LocationFeatureList';
import { words } from './coverage/cellsTestData';

// The request pane's list opens collapsed: here it shows what's in it. The grid draws only in a browser: here it keeps
// what it was given
const state = vi.hoisted(() => ({ grid: null as null | Record<string, any> })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('./CollapsibleSection', () => ({ default: ({ children, title }: { children: unknown; title: string }) => <section title={title}>{children as never}</section> }));
vi.mock('@mui/x-data-grid', async importOriginal => ({
  ...await importOriginal<typeof import('@mui/x-data-grid')>(),
  DataGrid: (props: Record<string, unknown>) => {
    state.grid = props;
    return <div data-grid="" />;
  },
}));

const cell = (column: GridColDef<FeatureRow>, value: unknown) => renderToStaticMarkup(<>{column.renderCell!({ value } as never)}</>);
// What a column shows for a row, through its valueGetter where it has one
const value = (column: GridColDef<FeatureRow>, row: FeatureRow) => (column.valueGetter ? (column.valueGetter as (value: unknown, row: FeatureRow) => unknown)(undefined, row) : row[column.field]);

describe('the shared columns', () => {
  it('show the feature’s id and where it is under their own names', () => {
    expect(featureIdColumn).toMatchObject({ field: 'featureId', headerName: 'ID' });
    expect(geometryColumn).toMatchObject({ field: 'geometry', headerName: 'Geometry' });
  });

  it('show a property under its own name, keywords as chips', () => {
    expect(propertyColumn('height')).toMatchObject({ field: 'property:height', headerName: 'height' });
    expect(propertyColumn('height').renderCell).toBeUndefined();
    const keywords = propertyColumn('keywords');
    expect(keywords.headerName).toBe('keywords');
    const chips = cell(keywords, ['rain', 'snow']);
    expect(chips.split('class="MuiChip-label ').length - 1).toBe(2);
    expect(words(chips)).toBe('rain snow');
    expect(cell(keywords, 'plain')).toBe('plain');
  });
});

describe('LocationFeatureList', () => {
  const features = [
    { type: 'Feature', id: 'hki', geometry: { type: 'Point', coordinates: [24.94, 60.17] }, properties: { name: 'Helsinki' } },
    { type: 'Feature', id: 'oulu', geometry: { type: 'Point', coordinates: [25.47, 65.01] }, properties: { title: 'Oulu' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[21, 61], [22, 61], [22, 62], [21, 61]]] }, properties: {} },
  ];

  it('lists the locations by name, id and a point’s latitude and longitude, as it did', () => {
    renderToStaticMarkup(<LocationFeatureList features={features} />);
    const columns: GridColDef<FeatureRow>[] = state.grid!.columns;
    expect(columns.map(column => column.headerName)).toEqual(['Name', 'ID', 'Lat', 'Lon']);
    const rows: FeatureRow[] = state.grid!.rows;
    expect(rows.map(row => columns.map(column => value(column, row)))).toEqual([
      ['Helsinki', 'hki', 60.17, 24.94],
      ['Oulu', 'oulu', 65.01, 25.47],
      ['Feature 3', '', undefined, undefined],
    ]);
    expect(state.grid!.initialState.sorting.sortModel).toEqual([{ field: 'name', sort: 'asc' }]);
  });

  it('hands on the location picked as it came', () => {
    const picked: unknown[] = [];
    renderToStaticMarkup(<LocationFeatureList features={features} onFeatureSelect={feature => picked.push(feature)} />);
    state.grid!.onRowClick({ row: featureRows(features, [])[1] });
    expect(picked[0]).toBe(features[1]);
  });

  it('searches with the shared toolbar', () => {
    renderToStaticMarkup(<LocationFeatureList features={features} />);
    const Toolbar: ComponentType = state.grid!.slots.toolbar;
    expect(Toolbar.name).toBe('SearchToolbar');
  });

  it('shows nothing without locations', () => {
    expect(renderToStaticMarkup(<LocationFeatureList features={[]} />)).toBe('');
    expect(renderToStaticMarkup(<LocationFeatureList features={null} />)).toBe('');
  });
});
