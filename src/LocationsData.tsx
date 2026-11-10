import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import { useMapInteraction } from './contexts/MapInteractionContext';
import { usePanes } from './contexts/PanesContext';
import { featureIdColumn, geometryColumn, propertyColumn, searchToolbar } from './featureColumns';
import { featureRows, nameKeyOf, propertyKeysOf, type FeatureRow } from './featureRows';

// The most a page holds; there are thousands on some servers
const PAGE = 100;
const LocationsToolbar = searchToolbar('Search locations...');

const locationsCount = (count: number) => `${count.toLocaleString('en')} location${count === 1 ? '' : 's'}`;

// A locations list as data: a row per location, with its id, its name, where it is, and its other properties. Picking
// one shows it on the map, and leaves the query as it is
export default function LocationsData({ features }: { features: readonly unknown[] }) {
  const { responseLocation, showResponseLocation } = useMapInteraction();
  const { showMap } = usePanes();

  const keys = useMemo(() => propertyKeysOf(features), [features]);
  const rows = useMemo(() => featureRows(features, keys), [features, keys]);
  // The name next to the id, under the property's own name
  const columns = useMemo((): GridColDef<FeatureRow>[] => {
    const nameKey = nameKeyOf(keys);
    return [
      featureIdColumn,
      ...(nameKey ? [propertyColumn(nameKey)] : []),
      geometryColumn,
      ...keys.filter(key => key !== nameKey).map(propertyColumn),
    ];
  }, [keys]);

  const shown = responseLocation ? rows.findIndex(row => row.feature === responseLocation) : -1;
  const selection = useMemo(() => ({ type: 'include' as const, ids: new Set(shown >= 0 ? [shown] : []) }), [shown]);

  const show = ({ row }: GridRowParams<FeatureRow>) => {
    showResponseLocation(row.feature);
    // Only where there's something to see
    if (row.feature.geometry) showMap();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'background.paper' }}>
      <Box sx={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px', px: 1.75, py: 1, fontSize: '0.8125rem', lineHeight: '18px' }}>
        <Box component="span" sx={{ fontWeight: 500 }}>{locationsCount(features.length)}</Box>
        {features.length > 0 && <Box component="span" sx={{ color: 'text.secondary' }}>Pick one to see it on the map</Box>}
      </Box>
      <DataGrid
        rows={rows}
        columns={columns}
        density="compact"
        // A column's menu button shows at all times on a touch screen, and would show through the pane where it's
        // hidden over the map. Sorting is on the header, and the search covers filtering
        disableColumnMenu
        slots={{ toolbar: LocationsToolbar }}
        showToolbar
        pageSizeOptions={[PAGE]}
        initialState={{ pagination: { paginationModel: { pageSize: PAGE } } }}
        // The row picked is the one on the map, not a selection to act on
        rowSelectionModel={selection}
        disableMultipleRowSelection
        hideFooterSelectedRowCount
        onRowClick={show}
        sx={{
          flex: 1,
          minHeight: 0,
          border: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
          borderRadius: 0,
          '& .MuiDataGrid-row': { cursor: 'pointer' },
          // The last header's hidden menu button and resize handle stick out past the grid's right edge and would add a
          // horizontal scrollbar
          '& .MuiDataGrid-columnHeaders': { overflow: 'hidden' },
        }}
      />
    </Box>
  );
}
