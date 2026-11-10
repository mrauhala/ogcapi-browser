import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import CollapsibleSection from './CollapsibleSection';
import ListIcon from '@mui/icons-material/List';
import axios from 'axios';
import { useService } from './contexts/ServiceContext';
import { getAxiosConfig, addApiKeyToUrl } from './api/auth';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { featureIdColumn, propertyColumn, searchToolbar } from './featureColumns';
import { featureRows, propertyKeysOf, type FeatureRow } from './featureRows';

const ItemsToolbar = searchToolbar('Search items...');

interface ItemsTableProps {
  url: string;
  title?: string;
  onFeatureClick?: (feature: FeatureItem) => void;
}

interface FeatureItem {
  id?: string | number;
  type: string;
  properties?: Record<string, any>;
  geometry?: any;
}

interface FeatureCollection {
  type: string;
  features: FeatureItem[];
  numberMatched?: number;
  numberReturned?: number;
}

const ItemsTable: React.FC<ItemsTableProps> = ({ url, title, onFeatureClick }) => {
  const { getAuthCredentials } = useService();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FeatureCollection | null>(null);

  const handleOpen = () => {
    if (!data && !loading) {
      fetchItems();
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const auth = getAuthCredentials(url);

      // Build URL with limit and API key
      const urlObj = new URL(url);
      urlObj.searchParams.set('limit', '2000');
      const fetchUrl = addApiKeyToUrl(urlObj.toString(), auth);

      const response = await axios.get(fetchUrl, getAxiosConfig(auth));
      
      if (response.data && (response.data.type === 'FeatureCollection' || response.data.type === 'Feature')) {
        setData(response.data.type === 'Feature' ? { type: 'FeatureCollection', features: [response.data] } : response.data);
      } else {
        setError('Invalid GeoJSON response');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch items');
    } finally {
      setLoading(false);
    }
  };

  const propertyKeys = useMemo(() => propertyKeysOf(data?.features ?? []), [data]);
  const rows = useMemo(() => featureRows(data?.features ?? [], propertyKeys), [data, propertyKeys]);

  const columns = useMemo((): GridColDef<FeatureRow>[] => [
    featureIdColumn,
    {
      field: 'geometryType',
      headerName: 'Geometry',
      width: 120,
      valueGetter: (_value, row) => (row.feature.geometry as FeatureItem['geometry'])?.type || 'Unknown',
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          variant="outlined"
          color="primary"
        />
      ),
    },
    ...propertyKeys.map(propertyColumn),
  ], [propertyKeys]);

  const handleRowClick = ({ row }: { row: FeatureRow }) => {
    onFeatureClick?.(row.feature as FeatureItem);
  };

  return (
    <CollapsibleSection
      title={title || 'Items'}
      icon={<ListIcon fontSize="small" color="primary" />}
      chipLabel={data ? `${data.features.length} items` : undefined}
      variant="button"
      onOpen={handleOpen}
      sx={{ mt: 1, mb: 1 }}
    >
      <Box sx={{ mt: 1 }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          
          {data && data.features && (
            <Box>
              {data.numberMatched !== undefined && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  Showing {data.numberReturned || data.features.length} of {data.numberMatched} items
                </Typography>
              )}
              
              <Box sx={{ backgroundColor: 'background.paper', borderRadius: 1 }}>
                <Box sx={{ height: 520, width: '100%' }}>
                  <DataGrid
                    rows={rows}
                    columns={columns}
                    slots={{
                      toolbar: ItemsToolbar,
                    }}
                    showToolbar
                    initialState={{
                      pagination: {
                        paginationModel: { pageSize: 10 },
                      },
                      sorting: {
                        sortModel: [{ field: 'featureId', sort: 'asc' }],
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
            </Box>
          )}
          
          {data && data.features && data.features.length === 0 && (
            <Alert severity="info" sx={{ mt: 1 }}>
              No items found
            </Alert>
          )}
        </Box>
    </CollapsibleSection>
  );
};

export default ItemsTable;
