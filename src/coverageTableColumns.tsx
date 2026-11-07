import Box from '@mui/material/Box';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import type { CoverageProfile } from './coverage/coverageProfile';
import type { CoverageSeries } from './coverage/coverageSummary';

// The Data tab's tables, as columns and rows for the grid: a time series's, and a profile's

export type CoverageRow = { id: string; time: string; location: string } & Record<string, unknown>;

// A null marked as one, so that it can't be taken for zero or a blank
const NULL_MARK = <Box component="span" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>null</Box>;

// Exactly what the API sent: the grid would otherwise round a number to its locale's few digits
const renderValue = ({ value }: GridRenderCellParams) => (value === null || value === undefined ? NULL_MARK : String(value));
// In a profile, a parameter can lack a level others have: nothing was sent, which isn't a null
const renderSent = ({ value }: GridRenderCellParams) => (value === undefined ? '' : value === null ? NULL_MARK : String(value));

// Enough for text in the grid's monospace, and for a header's sort icon. These are what one looks a
// value up by, and a time's end is often what differs
const CHARACTER = 7.5;
const widthOf = (text: string, room = 24) => Math.ceil(text.length * CHARACTER) + room;
const longest = (texts: string[]) => texts.reduce((a, b) => (b.length > a.length ? b : a), '');

// A column per parameter, by its place and not its id, which may have characters a field can't
const parameterColumns = (parameters: { id: string; unit: string }[], renderCell: GridColDef['renderCell']) => parameters.map(({ id, unit }, index): GridColDef => {
  const headerName = unit ? `${id} (${unit})` : id;
  return { field: `p${index}`, headerName, type: 'number', minWidth: widthOf(headerName, 48), flex: 1, renderCell };
});

export function coverageColumns({ locations, parameters, rawTimes }: CoverageSeries): GridColDef[] {
  return [
    { field: 'time', headerName: 'Time', width: widthOf(longest(rawTimes)) },
    ...(locations.length > 1 ? [{ field: 'location', headerName: 'Location', width: widthOf(longest(['Location', ...locations])) }] : []),
    ...parameterColumns(parameters, renderValue),
  ];
}

// One row per time, per location, in the order they came
export function coverageRows({ locations, parameters, rawTimes }: CoverageSeries): CoverageRow[] {
  return locations.flatMap((location, place) => rawTimes.map((time, index) => {
    const row: CoverageRow = { id: `${place}:${index}`, time, location };
    parameters.forEach(({ raw }, column) => {
      row[`p${column}`] = raw[place][index];
    });
    return row;
  }));
}

// A profile's: the time and the place where there are several, the level with z's unit, and a column per parameter
export function profileColumns({ times, locations, parameters, axis, rows }: CoverageProfile): GridColDef[] {
  const zName = axis.unit ? `z (${axis.unit})` : 'z';
  return [
    ...(times.length > 1 ? [{ field: 'time', headerName: 'Time', width: widthOf(longest(times.map(time => time.raw ?? ''))) }] : []),
    ...(locations.length > 1 ? [{ field: 'location', headerName: 'Location', width: widthOf(longest(['Location', ...locations.map(location => location.label)])) }] : []),
    { field: 'z', headerName: zName, type: 'number', width: widthOf(longest([zName, ...rows.map(String)]), 32), renderCell: renderSent },
    ...parameterColumns(parameters, renderSent),
  ];
}

// A row per time, place and level sent, in the order they came. No row for a level that wasn't
export function profileRows(profile: CoverageProfile): CoverageRow[] {
  const { times, locations, parameters, rows: levels } = profile;
  return times.flatMap((time, at) => locations.flatMap((location, place) => {
    const sent = levels.flatMap((level, row) => {
      const orders = parameters.flatMap(({ id }) => profile.cellOf(id, place, at, row)?.order ?? []);
      return orders.length ? [{ level, row, order: Math.min(...orders) }] : [];
    });
    return sent.sort((a, b) => a.order - b.order).map(({ level, row }) => {
      const out: CoverageRow = { id: `${at}:${place}:${row}`, time: time.raw ?? '', location: location.label, z: level };
      parameters.forEach(({ values }, column) => {
        out[`p${column}`] = values[place][at][row];
      });
      return out;
    });
  }));
}
