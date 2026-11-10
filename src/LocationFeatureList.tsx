import React, { useMemo } from 'react';
import Box from '@mui/material/Box';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import CollapsibleSection from './CollapsibleSection';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { featureIdColumn, searchToolbar } from './featureColumns';
import { featureRows, type FeatureRow } from './featureRows';

interface LocationFeatureListProps {
  features: any[] | null;
  onFeatureSelect?: (feature: any) => void;
}

const LocationsToolbar = searchToolbar('Search locations...');

// A point's latitude or longitude
const pointCoordinate = (row: FeatureRow, axis: 0 | 1): number | undefined => {
  const geometry = row.feature.geometry as { type?: string; coordinates?: number[] } | null | undefined;
  return geometry?.type === 'Point' && geometry.coordinates ? geometry.coordinates[axis] : undefined;
};

const columns: GridColDef<FeatureRow>[] = [
  {
    field: 'name',
    headerName: 'Name',
    flex: 1,
    minWidth: 150,
    valueGetter: (_value, row) => {
      const properties = row.feature.properties as { name?: string; title?: string } | null | undefined;
      return properties?.name || properties?.title || `Feature ${row.id + 1}`;
    },
  },
  { ...featureIdColumn, flex: 0.8 },
  {
    field: 'latitude',
    headerName: 'Lat',
    width: 80,
    valueGetter: (_value, row) => pointCoordinate(row, 1),
    valueFormatter: (value: number | undefined) => value ? value.toFixed(4) : '',
  },
  {
    field: 'longitude',
    headerName: 'Lon',
    width: 80,
    valueGetter: (_value, row) => pointCoordinate(row, 0),
    valueFormatter: (value: number | undefined) => value ? value.toFixed(4) : '',
  },
];

const LocationFeatureList: React.FC<LocationFeatureListProps> = ({ features, onFeatureSelect }) => {
  const rows = useMemo(() => featureRows(features ?? [], []), [features]);

  if (!features || features.length === 0) {
    return null;
  }

  const handleRowClick = ({ row }: { row: FeatureRow }) => {
    onFeatureSelect?.(row.feature);
  };

  return (
    <CollapsibleSection
      title="Location Features"
      icon={<LocationOnIcon color="primary" fontSize="small" />}
      chipLabel={features.length}
      subtitle="Click to view and search location features"
      sx={{ mt: 1 }}
    >
      <Box sx={{ backgroundColor: 'background.paper', borderRadius: 1 }}>
        <Box sx={{ height: 520, width: '100%' }}>
            <DataGrid
              rows={rows}
              columns={columns}
              slots={{
                toolbar: LocationsToolbar,
              }}
              showToolbar
              initialState={{
                pagination: {
                  paginationModel: { pageSize: 10 },
                },
                sorting: {
                  sortModel: [{ field: 'name', sort: 'asc' }],
                },
              }}
              pageSizeOptions={[10, 25, 50, 100]}
              disableMultipleRowSelection
              onRowClick={handleRowClick}
              sx={{
                border: 1,
                borderColor: 'divider',
                '& .MuiDataGrid-cell:hover': {
                  cursor: 'pointer',
                },
                '& .MuiDataGrid-row:hover': {
                  backgroundColor: 'action.hover',
                },
                // The last header's hidden menu button and resize handle stick out past the grid's
                // right edge and would add a horizontal scrollbar
                '& .MuiDataGrid-columnHeaders': {
                  overflow: 'hidden',
                },
              }}
              density="compact"
            />
        </Box>
      </Box>
    </CollapsibleSection>
  );
};

export default LocationFeatureList;
