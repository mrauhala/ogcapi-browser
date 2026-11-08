import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import type { CoverageProfile } from './coverage/coverageProfile';
import type { CoverageSeries } from './coverage/coverageSummary';
import type { SectionData } from './coverage/coverageSection';
import { coverageColumns, coverageRows, profileColumns, profileRows, sectionColumns, sectionRows, type CoverageRow } from './coverageTableColumns';

// The most the free grid shows at a time
const MOST_PER_PAGE = 100;

export function ProfileTable({ profile }: { profile: CoverageProfile }) {
  const columns = useMemo(() => profileColumns(profile), [profile]);
  const rows = useMemo(() => profileRows(profile), [profile]);
  return <TableGrid columns={columns} rows={rows} />;
}

export function SectionTable({ section }: { section: SectionData }) {
  const columns = useMemo(() => sectionColumns(section), [section]);
  const rows = useMemo(() => sectionRows(section), [section]);
  return <TableGrid columns={columns} rows={rows} />;
}

export default function CoverageTable({ series }: { series: CoverageSeries }) {
  const columns = useMemo(() => coverageColumns(series), [series]);
  const rows = useMemo(() => coverageRows(series), [series]);
  return <TableGrid columns={columns} rows={rows} />;
}

function TableGrid({ columns, rows }: { columns: GridColDef[]; rows: CoverageRow[] }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid', borderColor: 'divider' }}>
      <DataGrid
        rows={rows}
        columns={columns}
        density="compact"
        disableRowSelectionOnClick
        disableColumnMenu
        hideFooter={rows.length <= MOST_PER_PAGE}
        initialState={{ pagination: { paginationModel: { pageSize: MOST_PER_PAGE } } }}
        pageSizeOptions={[25, 50, MOST_PER_PAGE]}
        sx={{ border: 0, borderRadius: 0, flex: 1, minHeight: 0, fontFamily: 'monospace', fontSize: '0.75rem', '& .MuiDataGrid-columnHeaderTitle': { fontFamily: 'monospace' } }}
      />
    </Box>
  );
}
