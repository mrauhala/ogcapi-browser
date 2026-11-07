import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { coverageColumns, coverageRows, profileColumns, profileRows } from './coverageTableColumns';
import { coverageToProfile, type CoverageProfile, type ProfileContext } from './coverage/coverageProfile';
import type { CoverageSeries } from './coverage/coverageSummary';
import extents from './coverage/__fixtures__/profiles/vertical-extents.json';
import mcIfs1tAll from './coverage/__fixtures__/profiles/mc-ifs-1t-all.json';
import mcIfsZunsorted from './coverage/__fixtures__/profiles/mc-ifs-zunsorted.json';
import mcIfsAsked777 from './coverage/__fixtures__/profiles/mc-ifs-asked777.json';
import mcIfs85t from './coverage/__fixtures__/profiles/mc-ifs-85t-2p.json';
import mcIfsCube1pix from './coverage/__fixtures__/profiles/mc-ifs-cube-1pix.json';
import mcRadarDkrom from './coverage/__fixtures__/profiles/mc-radar-dkrom-allnull.json';
import knmiPl from './coverage/__fixtures__/profiles/knmi-pl-position.json';

const figures = { label: null, count: 2, nulls: 0, others: 0, numbers: 2, min: 1, max: 2, mean: 1.5, notIncluded: false };
const SERIES: CoverageSeries = {
  times: [1, 2],
  rawTimes: ['2026-11-05T12:00:00+00:00', '2026-11-05T13:00:00.000000000'],
  locations: ['10, 50'],
  stepChanges: [],
  parameters: [
    { ...figures, id: 'a.b/c', unit: 'K', raw: [[268.7255147799975, null]], series: [[268.7255147799975, null]] },
    { ...figures, id: 'wx', unit: '', raw: [['rain', 0]], series: [[null, 0]] },
  ],
};
const TWO_PLACES: CoverageSeries = {
  ...SERIES,
  locations: ['10, 50', '12, 52'],
  parameters: [{ ...SERIES.parameters[0], raw: [[1, 2], [3, 4]], series: [[1, 2], [3, 4]] }],
};

describe('coverageColumns', () => {
  it('has a time, and a column per parameter with its unit', () => {
    expect(coverageColumns(SERIES).map(column => column.headerName)).toEqual(['Time', 'a.b/c (K)', 'wx']);
  });

  it('gives each a field of its own, whatever its id', () => {
    expect(coverageColumns(SERIES).map(column => column.field)).toEqual(['time', 'p0', 'p1']);
  });

  it('adds the location when there is more than one', () => {
    expect(coverageColumns(TWO_PLACES).map(column => column.headerName)).toEqual(['Time', 'Location', 'a.b/c (K)']);
  });

  it('is wide enough for the longest time and each header', () => {
    const [time, first, second] = coverageColumns(SERIES);
    expect(time.width).toBeGreaterThanOrEqual('2026-11-05T13:00:00.000000000'.length * 7);
    expect(first.minWidth).toBeGreaterThanOrEqual('a.b/c (K)'.length * 7);
    expect(second.minWidth).toBeLessThan(first.minWidth!);
  });

  it('shows a value exactly as sent, and marks a null', () => {
    const { renderCell } = coverageColumns(SERIES)[1];
    const cell = (value: unknown) => renderToStaticMarkup(<>{renderCell!({ value } as never)}</>);
    expect(cell(268.7255147799975)).toBe('268.7255147799975');
    expect(cell(0)).toBe('0');
    expect(cell('rain')).toBe('rain');
    expect(cell(null)).toContain('>null<');
    expect(cell(undefined)).toContain('>null<');
  });
});

describe('coverageRows', () => {
  it('has a row per time with the raw time and values', () => {
    expect(coverageRows(SERIES)).toEqual([
      { id: '0:0', time: '2026-11-05T12:00:00+00:00', location: '10, 50', p0: 268.7255147799975, p1: 'rain' },
      { id: '0:1', time: '2026-11-05T13:00:00.000000000', location: '10, 50', p0: null, p1: 0 },
    ]);
  });

  it('has a row per time for each location, each row with its own values', () => {
    const rows = coverageRows(TWO_PLACES);
    expect(rows.map(row => [row.id, row.location, row.p0])).toEqual([
      ['0:0', '10, 50', 1], ['0:1', '10, 50', 2], ['1:0', '12, 52', 3], ['1:1', '12, 52', 4],
    ]);
  });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MC = extents['ecmwf-ifs-pressure'];
function profileOf(json: unknown, vertical?: ProfileContext['vertical']): CoverageProfile {
  const url = /^GET (\S+),/.exec((json as Json)._comment)?.[1];
  const result = coverageToProfile(JSON.parse(JSON.stringify(json)), { url, vertical });
  if (!result.profile) throw new Error(`no profile: ${result.message}`);
  return result.profile;
}
type RenderCell = ReturnType<typeof profileColumns>[number]['renderCell'];
const cell = (renderCell: RenderCell, value: unknown) => renderToStaticMarkup(<>{renderCell!({ value } as never)}</>);

describe('profileColumns', () => {
  it('has the level with its unit, and a column per parameter with its', () => {
    expect(profileColumns(profileOf(mcIfs1tAll, MC)).map(column => column.headerName)).toEqual(['z (hPa)', 'gh (gpm)', 'r (%)', 't (°C)', 'ws (m/s)']);
    expect(profileColumns(profileOf(knmiPl)).map(column => column.headerName)).toEqual(['z', 'air_temperature_pl (C)', 'relative_humidity_pl (-)']);
  });

  it('adds the time, and the place, where there are several', () => {
    expect(profileColumns(profileOf(mcIfs85t, MC)).map(column => column.headerName)).toEqual(['Time', 'z (hPa)', 't (°C)']);
    expect(profileColumns(profileOf(mcIfsCube1pix, MC)).map(column => column.headerName)).toEqual(['Location', 'z (hPa)', 't (°C)']);
  });

  it('shows a level and a value as sent, a null as one, and nothing where nothing was sent', () => {
    const [z, t] = profileColumns(profileOf(mcIfsZunsorted, MC));
    expect(cell(z.renderCell, 1000)).toBe('1000');
    expect(cell(t.renderCell, -23.299797)).toBe('-23.299797');
    expect(cell(t.renderCell, null)).toContain('>null<');
    expect(cell(t.renderCell, undefined)).toBe('');
  });

  it('is wide enough for the longest time', () => {
    const profile = profileOf(mcIfs85t, MC);
    const [time] = profileColumns(profile);
    expect(time.width).toBeGreaterThanOrEqual(Math.max(...profile.times.map(at => at.raw!.length)) * 7);
  });
});

describe('profileRows', () => {
  it('has a row per level, in the order they were sent (MeteoCore z=500,1000,850)', () => {
    const rows = profileRows(profileOf(mcIfsZunsorted, MC));
    expect(rows.map(row => [row.id, row.z, row.p0])).toEqual([['0:0:0', 500, -23.299797], ['0:0:2', 1000, 5.3022532], ['0:0:1', 850, expect.any(Number)]]);
  });

  it('has no row for a level asked for that never came', () => {
    const rows = profileRows(profileOf(mcIfsAsked777, MC));
    expect(rows.map(row => row.z)).toEqual([1000, 850, 500]);
  });

  it('has a row per time and level, with the time as sent', () => {
    const profile = profileOf(mcIfs85t, MC);
    const rows = profileRows(profile);
    expect(rows).toHaveLength(85 * 14);
    // Sent from 1000 hPa up, at each time
    expect(rows[14]).toMatchObject({ id: '1:0:13', time: profile.times[1].raw, z: 1000 });
    expect(rows[27]).toMatchObject({ id: '1:0:0', z: 10 });
  });

  it('has a row per place, each in the order sent', () => {
    const rows = profileRows(profileOf(mcIfsCube1pix, MC));
    expect(rows.map(row => [row.location, row.z])).toEqual([
      [rows[0].location, 1000], [rows[0].location, 850], [rows[0].location, 500],
      [rows[3].location, 1000], [rows[3].location, 850], [rows[3].location, 500],
    ]);
    expect(rows[0].location).not.toBe(rows[3].location);
  });

  it('has only the levels each time has, as a radar whose scan changes (DK radar)', () => {
    const profile = profileOf(mcRadarDkrom, extents['dk-radar-volume-dkrom']);
    const rows = profileRows(profile);
    expect(rows).toHaveLength(40);
    expect(rows.filter(row => row.time === profile.times[0].raw).map(row => row.z)).toEqual([0.5, 0.6, 1, 1.5, 2.4, 4.5, 8.5, 10, 13, 15]);
    expect(rows.every(row => row.p0 === null)).toBe(true);
  });
});
