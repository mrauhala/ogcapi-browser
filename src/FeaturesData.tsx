import { Fragment, useMemo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid';
import KeywordChips from './KeywordChips';
import { useMapInteraction } from './contexts/MapInteractionContext';
import { usePanes } from './contexts/PanesContext';
import { featureIdColumn, geometryColumn, propertyColumn, searchToolbar } from './featureColumns';
import { featureRows, geometryText, nameKeyOf, propertyKeysOf, type FeatureRow, type GeoJsonFeature } from './featureRows';

// What a response's features are: a locations list's locations, or a collection's items, records in a Records collection
export type FeatureNoun = 'location' | 'item' | 'record';

// The most a page holds; there are thousands on some servers
const PAGE = 100;
const TOOLBARS: Record<FeatureNoun, ReturnType<typeof searchToolbar>> = {
  location: searchToolbar('Search locations...'),
  item: searchToolbar('Search items...'),
  record: searchToolbar('Search records...'),
};

const counted = (count: number, noun: FeatureNoun) => `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;

const HEAD_SX = { flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 12px', px: 1.75, py: 1, fontSize: '0.8125rem', lineHeight: '18px' };
const CODE_SX = { fontFamily: 'monospace', fontSize: '0.75rem' };

// A count the answer gives about itself, by its own name
function Said({ name, value, warn }: { name: string; value: number; warn?: string }) {
  return (
    <Box component="span" title={warn} sx={{ color: warn ? 'warning.main' : 'text.secondary' }}>
      <Box component="code" sx={CODE_SX}>{name}</Box> {value.toLocaleString('en')}{warn && ` (${warn})`}
    </Box>
  );
}

// Features as data: a row per feature, with its id, its name, where it is, and its other properties. Picking one shows
// it on the map, and leaves the query as it is. A list of items also says how many the server says it matched and sent.
export default function FeaturesData({ features, noun = 'location', numberMatched = null, numberReturned = null }: {
  features: readonly unknown[];
  noun?: FeatureNoun;
  numberMatched?: number | null;
  numberReturned?: number | null;
}) {
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
      <Box sx={HEAD_SX}>
        <Box component="span" sx={{ fontWeight: 500 }}>{counted(features.length, noun)}</Box>
        {numberMatched !== null && <Said name="numberMatched" value={numberMatched} />}
        {numberReturned !== null && (
          <Said name="numberReturned" value={numberReturned}
            warn={numberReturned === features.length ? undefined : `the answer has ${counted(features.length, noun)}`} />
        )}
        {features.length > 0 && <Box component="span" sx={{ color: 'text.secondary' }}>Pick one to see it on the map</Box>}
      </Box>
      <DataGrid
        rows={rows}
        columns={columns}
        density="compact"
        // A column's menu button shows at all times on a touch screen, and would show through the pane where it's
        // hidden over the map. Sorting is on the header, and the search covers filtering
        disableColumnMenu
        slots={{ toolbar: TOOLBARS[noun] }}
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

// A property's value as the list shows it: keywords as chips, anything that isn't a plain value as its JSON
function valueOf(key: string, value: unknown) {
  if (key === 'keywords' && Array.isArray(value)) return <KeywordChips keywords={value as string[]} />;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

// One item, asked for by its path: its id, where it is, and each property by name, as the response's headers are
// listed. A record has dozens, which a one-row table would put out of sight to the right.
export function FeatureData({ feature, noun = 'item' }: { feature: GeoJsonFeature; noun?: FeatureNoun }) {
  const { showResponseLocation } = useMapInteraction();
  const { showMap } = usePanes();
  const properties = typeof feature.properties === 'object' && feature.properties !== null && !Array.isArray(feature.properties)
    ? Object.entries(feature.properties as Record<string, unknown>)
    : [];
  const id = feature.id === undefined ? null : typeof feature.id === 'object' ? JSON.stringify(feature.id) : String(feature.id);
  const entries: [string, ReactNode][] = [
    ...(id !== null ? [['id', id] as [string, ReactNode]] : []),
    ['geometry', geometryText(feature.geometry) || 'none'],
    ...properties.map(([key, value]): [string, ReactNode] => [`properties.${key}`, valueOf(key, value)]),
  ];

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', backgroundColor: 'background.paper', containerType: 'inline-size' }}>
      <Box sx={HEAD_SX}>
        <Box component="span" sx={{ fontWeight: 500 }}>{counted(1, noun)}</Box>
        {!!feature.geometry && (
          <Button size="small" sx={{ textTransform: 'none', py: 0, minWidth: 0 }} onClick={() => {
            showResponseLocation(feature);
            showMap();
          }}>
            See it on the map
          </Button>
        )}
      </Box>
      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          columnGap: 1,
          m: 0,
          px: 1.75,
          pb: 2,
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          lineHeight: '18px',
          '& dt': { overflowWrap: 'anywhere' },
          '& dd': { m: 0, mb: 1, overflowWrap: 'anywhere' },
          // Names as long as they are, up to half the width, where a property name like PROV_TERR_STATE_LOC fits whole
          '@container (min-width: 440px)': {
            gridTemplateColumns: 'fit-content(50%) minmax(0, 1fr)',
            columnGap: 2,
            '& dd': { mb: 0.5 },
          },
        }}
      >
        {entries.map(([name, value]) => (
          <Fragment key={name}>
            <Box component="dt" sx={{ color: 'primary.main' }}>{name}</Box>
            <Box component="dd">{value}</Box>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}
