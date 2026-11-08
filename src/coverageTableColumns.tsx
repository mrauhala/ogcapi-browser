import Box from '@mui/material/Box';
import type { GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import type { CoverageProfile } from './coverage/coverageProfile';
import type { SectionData } from './coverage/coverageSection';
import type { CoverageSeries } from './coverage/coverageSummary';

// The Data tab's tables, as columns and rows for the grid: a time series's, a profile's, and a path's

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

// A time along a path is kept as a number: written as UTC, to the second unless it has more
const isoTime = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

// A path's: the time where there are several, the position's number, km along the path where it's lon/lat, x and y,
// the level with z's unit, and a column per parameter. Places as sent, not rounded to the grid's few digits
export function sectionColumns({ frames, timeAlong, crs, levels, z, parameters, colCount, positions }: SectionData): GridColDef[] {
  const zName = z?.unit ? `z (${z.unit})` : 'z';
  const times = timeAlong ? timeAlong.map(ms => (Number.isFinite(ms) ? isoTime(ms) : '')) : frames.map(frame => frame.raw ?? '');
  return [
    ...(timeAlong || frames.length > 1 ? [{ field: 'time', headerName: 'Time', width: widthOf(longest(['Time', ...times])) }] : []),
    { field: 'position', headerName: '#', type: 'number', width: widthOf(String(colCount), 32) },
    ...(crs.geographic ? [{ field: 'km', headerName: 'km', type: 'number', width: widthOf('0000.00', 32), renderCell: renderValue } as GridColDef] : []),
    { field: 'x', headerName: 'x', type: 'number', width: widthOf(longest(['x', ...positions.map(([x]) => String(x))]), 16), renderCell: renderValue },
    { field: 'y', headerName: 'y', type: 'number', width: widthOf(longest(['y', ...positions.map(([, y]) => String(y))]), 16), renderCell: renderValue },
    ...(levels.some(level => level !== null) ? [{ field: 'z', headerName: zName, type: 'number', width: widthOf(longest([zName, ...levels.map(String)]), 32), renderCell: renderValue } as GridColDef] : []),
    ...parameterColumns(parameters, renderSent),
  ];
}

// A row per time, position and level sent, along the path, each level's values exactly as sent. No row where nothing was
export function sectionRows(section: SectionData): CoverageRow[] {
  const { frames, timeAlong, positions, km, levels, parameters, colCount, crs, cellAt } = section;
  const rows: CoverageRow[] = [];
  frames.forEach((frame, at) => {
    for (let col = 0; col < colCount; col++) {
      levels.forEach((level, row) => {
        const cells = parameters.map(({ id }) => cellAt(id, at, row * colCount + col));
        if (cells.every(cell => cell === null)) return;
        const time = timeAlong ? (Number.isFinite(timeAlong[col]) ? isoTime(timeAlong[col]) : '') : frame.raw ?? '';
        const out: CoverageRow = { id: `${at}:${col}:${row}`, time, location: '', position: col + 1, x: positions[col][0], y: positions[col][1], z: level };
        if (crs.geographic) out.km = Number(km[col].toFixed(2));
        cells.forEach((cell, column) => {
          out[`p${column}`] = cell === null ? undefined : cell.raw;
        });
        rows.push(out);
      });
    }
  });
  return rows;
}
