import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { coverageColumns, coverageRows, profileColumns, profileRows, sectionColumns, sectionRows } from './coverageTableColumns';
import { toSection, type SectionData } from './coverage/coverageSection';
import fmiEcFrames from './coverage/__fixtures__/sections/fmi-ec-frames.json';
import mcRadarFikorZ from './coverage/__fixtures__/sections/mc-radar-fikor-z.json';
import mcSingleNoz from './coverage/__fixtures__/sections/mc-single-noz.json';
import mcIfsBadlevel from './coverage/__fixtures__/sections/mc-ifs-badlevel.json';
import mcMepsClosed from './coverage/__fixtures__/sections/mc-meps-closed.json';
import fmiEc2param from './coverage/__fixtures__/sections/fmi-ec-2param.json';
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

describe('a path’s table', () => {
  const headers = (columns: { headerName?: string }[]) => columns.map(column => column.headerName);
  const sectionOf = (json: unknown, url?: string): SectionData => {
    const result = toSection(json, url ?? (/^GET (\S+),/.exec((json as { _comment: string })._comment)?.[1]));
    if (result === null || result.kind === 'cant') throw new Error('not a path');
    return result;
  };
  const trajectory = (tuples: unknown[][], values: unknown[], coordinates = ['t', 'x', 'y']) => ({
    type: 'Coverage',
    domain: { type: 'Domain', domainType: 'Trajectory', axes: { composite: { dataType: 'tuple', coordinates, values: tuples } } },
    ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['composite'], shape: [values.length], values } },
  });

  it('has a column for time where there are several, then the position, km, x, y and z, and a column per parameter', () => {
    const section = sectionOf(fmiEcFrames);
    expect(headers(sectionColumns(section))).toEqual(['Time', '#', 'km', 'x', 'y', 'z (hPa)', 'temperature', 'windspeedms']);
    expect(headers(sectionColumns(sectionOf(mcRadarFikorZ)))).toEqual(['#', 'km', 'x', 'y', 'z (m)', 'DBZH (dBZ)']);
    expect(headers(sectionColumns(sectionOf(mcSingleNoz)))).toEqual(['#', 'km', 'x', 'y', '2t (°C)']);
  });

  it('has a row per time, position and level, along the path, each value as sent', () => {
    const rows = sectionRows(sectionOf(fmiEcFrames));
    expect(rows).toHaveLength(135);
    expect(rows[0]).toMatchObject({ time: '2026-11-07T00:00:00Z', position: 1, km: 0, x: 20, y: 58, z: 50, p0: -62.5257, p1: null });
    expect(rows[1]).toMatchObject({ position: 1, z: 200 });
    expect(rows[9]).toMatchObject({ position: 2, z: 50, km: 160.82 });
    expect(rows[45]).toMatchObject({ time: '2026-11-07T06:00:00Z', position: 1, z: 50 });
  });

  it('has no row for a level asked for and not sent', () => {
    const section = sectionOf(mcIfsBadlevel);
    expect(section.levels).toEqual([333, 850]);
    expect(sectionRows(section).map(row => row.z)).toEqual([850, 850, 850, 850, 850]);
  });

  it('marks what wasn’t sent apart from a null', () => {
    const rows = sectionRows(sectionOf(trajectory([['2026-11-07T00:00:00Z', 24, 60], ['2026-11-07T00:00:00Z', 25, 61]], [null, 'x'])));
    expect(rows.map(row => row.p0)).toEqual([null, 'x']);
  });

  it('leaves a value not sent blank, apart from a null, where another parameter has one', () => {
    const json = JSON.parse(JSON.stringify(fmiEc2param)) as { coverages: { ranges: Record<string, unknown> }[] };
    delete json.coverages[0].ranges.windspeedms;
    const section = sectionOf(json, /^GET (\S+),/.exec((fmiEc2param as { _comment: string })._comment)?.[1]);
    const rows = sectionRows(section);
    expect(section.levels.length).toBeGreaterThan(1);
    const blank = rows.filter(row => row.p1 === undefined);
    expect(blank.length).toBe(3);
    expect(blank.every(row => typeof row.p0 === 'number')).toBe(true);
    expect(rows.filter(row => row.p1 !== undefined).length).toBe(rows.length - 3);
  });

  it('gives each position its own time, where time runs along the path, to the second', () => {
    const section = sectionOf(trajectory([['2026-11-07T00:00:00Z', 24, 60], ['2026-11-07T03:00:00.5Z', 25, 61]], [1, 2]));
    expect(headers(sectionColumns(section))[0]).toBe('Time');
    expect(sectionRows(section).map(row => row.time)).toEqual(['2026-11-07T00:00:00Z', '2026-11-07T03:00:00.500Z']);
  });

  it('has no km where x and y aren’t lon/lat, and no z without one', () => {
    const projected = sectionOf(trajectory([['2026-11-07T00:00:00Z', 500000, 6650000], ['2026-11-07T00:00:00Z', 510000, 6660000]], [1, 2]));
    expect(headers(sectionColumns(projected))).toEqual(['#', 'x', 'y', 'a']);
    expect(sectionRows(projected)[1]).not.toHaveProperty('km');
  });

  it('sizes x and y for the longest place sent, as a place isn’t rounded', () => {
    const [, , x] = sectionColumns(sectionOf(mcMepsClosed));
    expect(x.headerName).toBe('x');
    expect(x.width).toBeGreaterThan(17 * 7.5);
  });
});
