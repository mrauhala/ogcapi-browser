import { afterEach, describe, expect, it, vi } from 'vitest';
import { codesFor } from './cellSelection';
import { ABSENT_CODE } from './colourScale';
import { MOST_VALUES_DRAWN, cellFindings, type DrawableCells } from './coverageCells';
import { toSection, type SectionData, type Waypoint } from './coverageSection';
import { fromWaypoint, kmWords, levelRows, pathEdges, planeFor, readResponseCells } from './sectionCells';
import fmiEc2param from './__fixtures__/sections/fmi-ec-2param.json';
import fmiEcFrames from './__fixtures__/sections/fmi-ec-frames.json';
import fmiMultilinestring from './__fixtures__/sections/fmi-multilinestring.json';
import mcIfsBadlevel from './__fixtures__/sections/mc-ifs-badlevel.json';
import mcIfsDatetimes from './__fixtures__/sections/mc-ifs-datetimes.json';
import mcIfsLsmZlist from './__fixtures__/sections/mc-ifs-lsm-zlist.json';
import mcIfsLsz from './__fixtures__/sections/mc-ifs-lsz.json';
import mcMepsClosed from './__fixtures__/sections/mc-meps-closed.json';
import mcSingleNoz from './__fixtures__/sections/mc-single-noz.json';
import mcRadarFikorZ from './__fixtures__/sections/mc-radar-fikor-z.json';
import fmiTrajectoryOnePlace from './__fixtures__/profiles/fmi-trajectory-one-place.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Each saved response, as the request that got it: its URL is in its comment
const copy = (json: unknown): Json => JSON.parse(JSON.stringify(json));
const urlOf = (json: unknown) => /^GET (\S+),/.exec((json as Json)._comment)?.[1];
const read = (json: unknown, url = urlOf(json)) => readResponseCells(json, { url });
function drawn(json: unknown, url = urlOf(json)): DrawableCells {
  const reading = read(json, url);
  if (!reading.drawable) throw new Error(`not drawn: ${reading.reason}`);
  return reading;
}
const sectionOf = (cells: DrawableCells): SectionData => cells.section!.data;
const absentIn = (cells: DrawableCells) => cells.parameters.map(parameter => parameter.absentAt?.reduce((sum, mark) => sum + mark, 0) ?? 0);

// FMI's 3 levels, with 333 hPa asked for too, which isn't sent
const BADLEVEL_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf_painepinta/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)&z=1000,850,500,333&parameter-name=temperature,windspeedms&datetime=2026-11-07T00:00:00Z&f=CoverageJSON';
// FMI's 9 levels and 10 hPa, which isn't sent: the top row
const FRAMES_TOP_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf_painepinta/trajectory?coords=LINESTRING(20%2058,22%2059,24%2060,26%2061,28%2062)&z=1000,925,850,700,500,300,250,200,50,10&parameter-name=temperature,windspeedms&datetime=2026-11-07T00:00:00Z/2026-11-07T12:00:00Z&f=CoverageJSON';

// RFC 6901, read here apart from the module, to follow a pointer back into the response
const at = (json: unknown, pointer: string): unknown =>
  pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((node, key) => (node as Json)?.[key], json);

// Every drawn cell at every step leads by its pointer to its value in the response, or has none and nothing was sent.
// Every value of every range is reached once
function walk(json: Json, cells: DrawableCells) {
  const tally = { cells: 0, wrong: 0, twice: 0, unreached: 0 };
  const reached = new Set<string>();
  for (const parameter of cells.parameters) {
    for (let slice = 0; slice < cells.slices; slice++) {
      for (let cell = 0; cell < cells.cells; cell++) {
        const i = slice * cells.cells + cell;
        const value = parameter.data[i];
        const { value: raw, pointer, absent } = parameter.rawAt(cell, slice);
        if (!pointer) {
          if (!absent || raw !== undefined || !Number.isNaN(value) || parameter.absentAt?.[i] !== 1) tally.wrong++;
          continue;
        }
        tally.cells++;
        if (reached.has(pointer)) tally.twice++;
        reached.add(pointer);
        const sent = at(json, pointer);
        const same = typeof sent === 'number' ? value === Math.fround(sent) : Number.isNaN(value) && (parameter.notNumberAt?.[i] === 1) === (sent !== null);
        if (!same || sent !== raw || parameter.absentAt?.[i]) tally.wrong++;
      }
    }
  }
  const coverages: Json[] = json.type === 'CoverageCollection' ? json.coverages : [json];
  coverages.forEach((coverage, c) => {
    for (const [id, range] of Object.entries(coverage.ranges ?? {}) as [string, Json][]) {
      const prefix = json.type === 'CoverageCollection' ? `/coverages/${c}` : '';
      (range.values as unknown[]).forEach((_, index) => {
        if (!reached.has(`${prefix}/ranges/${id}/values/${index}`)) tally.unreached++;
      });
    }
  });
  return tally;
}

describe('pathEdges', () => {
  it('puts edges half way between positions, and half a step beyond the ends', () => {
    expect([...pathEdges([0, 1, 2, 3], 1)]).toEqual([-0.5, 0.5, 1.5, 2.5, 3.5]);
    expect([...pathEdges([0, 1, 10], 1)]).toEqual([-0.5, 0.5, 5.5, 14.5]);
  });

  it('makes two cells meet at a position sent twice, or at a break, with no overlap', () => {
    expect([...pathEdges([0, 5, 5, 10], 1)]).toEqual([-2.5, 2.5, 5, 7.5, 12.5]);
    const edges = [...pathEdges([0, 157, 157, 314], 1)];
    expect(edges).toEqual([-78.5, 78.5, 157, 235.5, 392.5]);
    expect(edges.every((edge, i) => i === 0 || edge >= edges[i - 1])).toBe(true);
  });

  it('takes the step it’s given where an end has none', () => {
    expect([...pathEdges([0, 0, 5], 2)]).toEqual([-1, 0, 2.5, 7.5]);
    expect([...pathEdges([0, 5, 5], 2)]).toEqual([-2.5, 2.5, 5, 6]);
    expect([...pathEdges([7], 2)]).toEqual([6, 8]);
  });
});

describe('levelRows', () => {
  const plain = (rows: ReturnType<typeof levelRows>) => ({ rowLevel: [...rows.rowLevel], rowY: [...rows.rowY], yEdges: [...rows.yEdges] });

  it('puts pressure on a log axis down, lowest pressure at the top', () => {
    const rows = levelRows([500, 850, 1000], 'down', 'log', false);
    expect([...rows.rowLevel]).toEqual([0, 1, 2]);
    const p850 = Math.log(850 / 500) / Math.log(2);
    expect(rows.rowY[0]).toBe(1);
    expect(rows.rowY[1]).toBeCloseTo(1 - p850, 12);
    expect(rows.rowY[2]).toBe(0);
    // Half way between in the log scale, and half a step beyond each end
    expect(rows.yEdges[1]).toBeCloseTo(1 - p850 / 2, 12);
    expect(rows.yEdges[2]).toBeCloseTo(1 - (p850 + 1) / 2, 12);
    expect(rows.yEdges[0]).toBeCloseTo(1 + p850 / 2, 12);
    expect(rows.yEdges[3]).toBeCloseTo(-(1 - p850) / 2, 12);
  });

  it('puts the highest of heights at the top, whatever order the levels come in', () => {
    expect([...levelRows([1000, 0, 2000], 'up', 'linear', false).rowLevel]).toEqual([2, 0, 1]);
  });

  it('turns the rows over when flipped, edges and all', () => {
    const rows = plain(levelRows([500, 850, 1000], 'down', 'log', false));
    const flipped = plain(levelRows([500, 850, 1000], 'down', 'log', true));
    expect(flipped.rowLevel).toEqual([...rows.rowLevel].reverse());
    flipped.rowY.forEach((y, row) => expect(y).toBeCloseTo(1 - rows.rowY[2 - row], 12));
    flipped.yEdges.forEach((edge, i) => expect(edge).toBeCloseTo(1 - rows.yEdges[3 - i], 12));
  });

  it('gives each row the same height when even', () => {
    const { yEdges } = levelRows([0, 100, 1000, 9000], 'up', 'even', false);
    const heights = [...yEdges].slice(1).map((edge, i) => yEdges[i] - edge);
    expect(heights.every(height => Math.abs(height - heights[0]) < 1e-12)).toBe(true);
  });

  it('runs its edges down, each row with height, for every saved path', () => {
    for (const json of [fmiEc2param, fmiEcFrames, fmiMultilinestring, mcIfsDatetimes, mcIfsLsmZlist, mcIfsLsz, mcRadarFikorZ]) {
      const g = drawn(json).geometry;
      if (g.kind !== 'grid') throw new Error('not a grid');
      expect([...g.yEdges].every((edge, i) => i === 0 || edge < g.yEdges[i - 1])).toBe(true);
      expect([...g.xEdges].every((edge, i) => i === 0 || edge >= g.xEdges[i - 1])).toBe(true);
    }
  });
});

describe('readResponseCells: what each saved path becomes', () => {
  const cases: [string, unknown, { kind: string; nx: number; ny: number; slices: number; dims: string[]; absent: number[]; totals: number[] }][] = [
    ['fmi-ec-2param', fmiEc2param, { kind: 'section', nx: 3, ny: 3, slices: 1, dims: [], absent: [0, 0], totals: [9, 9] }],
    ['fmi-ec-frames', fmiEcFrames, { kind: 'section', nx: 5, ny: 9, slices: 3, dims: ['t'], absent: [0, 0], totals: [135, 135] }],
    ['fmi-multilinestring', fmiMultilinestring, { kind: 'section', nx: 4, ny: 2, slices: 1, dims: [], absent: [0], totals: [8] }],
    ['mc-ifs-datetimes', mcIfsDatetimes, { kind: 'section', nx: 9, ny: 2, slices: 3, dims: ['t'], absent: [0], totals: [54] }],
    ['mc-ifs-lsm-zlist', mcIfsLsmZlist, { kind: 'section', nx: 9, ny: 2, slices: 1, dims: [], absent: [0], totals: [18] }],
    ['mc-ifs-lsz', mcIfsLsz, { kind: 'track', nx: 9, ny: 4, slices: 1, dims: [], absent: [27], totals: [9] }],
    ['mc-radar-fikor-z', mcRadarFikorZ, { kind: 'section', nx: 257, ny: 39, slices: 1, dims: [], absent: [0], totals: [10023] }],
  ];

  for (const [name, json, expected] of cases) {
    it(`draws ${name} as a ${expected.kind} of ${expected.nx} positions by ${expected.ny} levels`, () => {
      const cells = drawn(json);
      expect(cells).toMatchObject({ source: 'section', viewLabel: 'Section', slices: expected.slices, cells: expected.nx * expected.ny, order: null, coverageCount: null, broken: [] });
      expect(cells.geometry).toMatchObject({ kind: 'grid', nx: expected.nx, ny: expected.ny, assumedSize: false });
      expect(sectionOf(cells).kind).toBe(expected.kind);
      expect(cells.dims.map(dim => dim.name)).toEqual(expected.dims);
      expect(absentIn(cells)).toEqual(expected.absent);
      expect(cells.parameters.map(parameter => parameter.figures.total)).toEqual(expected.totals);
      // The plane isn't the map's, whatever the path's CRS is
      expect(cells.crs.geographic).toBe(false);
      expect(sectionOf(cells).crs.geographic).toBe(true);
    });
  }

  it('leaves a line along the path to the other views: one level, or none', () => {
    for (const json of [mcIfsBadlevel, mcMepsClosed, mcSingleNoz]) expect(read(json)).toEqual({ drawable: false, reason: 'A path at one level is a line along it', why: 'other-view' });
  });

  it('leaves what can’t be read as a path to the pane, which says why from the same reading', () => {
    const json = copy(fmiEc2param);
    json.coverages[1].ranges.temperature.values.length = 2;
    json.coverages[1].ranges.temperature.shape = [2];
    expect(read(json)).toEqual({ drawable: false, reason: '/coverages/1/ranges/temperature/values has 2 values, and composite has 3 positions', why: 'other-view' });
  });

  it('reads what isn’t a path as before: a path at one place is a profile’s', () => {
    expect(read(fmiTrajectoryOnePlace)).toMatchObject({ drawable: false, why: 'other-view' });
  });

  it('asks before drawing more cells than the limit, and draws them when asked', () => {
    // A track of 2,300 positions, each at a level of its own: few values, and a plane of millions of cells
    const n = 2300;
    const json = {
      type: 'Coverage',
      domain: {
        type: 'Domain', domainType: 'Trajectory',
        axes: { composite: { dataType: 'tuple', coordinates: ['x', 'y', 'z'], values: Array.from({ length: n }, (_, i) => [20 + i * 0.001, 60, 100 + i]) } },
        referencing: [{ coordinates: ['x', 'y'], system: { type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } }],
      },
      ranges: { a: { type: 'NdArray', axisNames: ['composite'], shape: [n], values: Array.from({ length: n }, (_, i) => i) } },
    };
    expect(n * n).toBeGreaterThan(MOST_VALUES_DRAWN);
    expect(readResponseCells(json)).toEqual({ drawable: false, reason: '5,290,000 cells is more than this draws by itself', why: 'too-large' });
    const cells = readResponseCells(json, { drawAnyway: true });
    expect(cells).toMatchObject({ drawable: true, source: 'section', cells: n * n });
  });

  it('lays out the levels as the profile does: pressure down on a log axis, with Even to choose', () => {
    const cells = drawn(fmiEc2param);
    const g = cells.geometry;
    if (g.kind !== 'grid') throw new Error('not a grid');
    expect(g.ys).toEqual([500, 850, 1000]);
    expect(cells.section).toMatchObject({ spacing: 'log', defaultSpacing: 'log', canLog: true, flipped: false, mostValues: 3 });
    expect([...cells.section!.rowLevel]).toEqual([0, 1, 2]);
    expect(cells.zUnit).toBe('hPa');
    expect(cells.fixed).toEqual({ t: '2026-11-07T00:00:00Z' });
  });

  it('puts a radar’s highest height at the top, linear since one level is 0, with the floor in the plane’s y', () => {
    const cells = drawn(mcRadarFikorZ);
    const g = cells.geometry;
    if (g.kind !== 'grid') throw new Error('not a grid');
    const { levels } = sectionOf(cells);
    expect(g.ys[0]).toBe(levels[levels.length - 1]);
    expect(g.ys[g.ny - 1]).toBe(0);
    expect(cells.section).toMatchObject({ spacing: 'linear', canLog: false, mostValues: 10023 });
    const { rowY, yOf } = cells.section!;
    expect(yOf(0)).toBe(0);
    expect(yOf(g.ys[0])).toBe(1);
    expect(yOf(g.ys[5])).toBeCloseTo(rowY[5], 12);
    const floor = sectionOf(cells).beamFloor!.values[0][0];
    expect(yOf(floor)).toBeCloseTo(floor / (levels[levels.length - 1] as number), 12);
  });

  it('measures x in km along the path, and meets two cells at a MULTILINESTRING’s break', () => {
    const cells = drawn(fmiMultilinestring);
    const g = cells.geometry;
    if (g.kind !== 'grid') throw new Error('not a grid');
    const { km, breaks } = sectionOf(cells);
    expect(g.xs).toEqual([...km]);
    expect(breaks).toEqual([2]);
    expect(g.xEdges[2]).toBe(km[2]);
  });

  it('counts positions where x and y aren’t lon/lat, and says so of its CRS', () => {
    const json = copy(fmiEc2param);
    json.referencing[0].system = { type: 'ProjectedCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/3067' };
    const cells = drawn(json, urlOf(fmiEc2param));
    const g = cells.geometry;
    if (g.kind !== 'grid') throw new Error('not a grid');
    expect(g.xs).toEqual([0, 1, 2]);
    expect([...g.xEdges]).toEqual([-0.5, 0.5, 1.5, 2.5]);
    expect(cells.crs).toMatchObject({ declared: true, geographic: false });
    expect(sectionOf(cells).crs.geographic).toBe(false);
  });

  it('gives a level asked for and not sent its row, at its place, with nothing in it', () => {
    const cells = drawn(copy(fmiEc2param), BADLEVEL_URL);
    const g = cells.geometry;
    if (g.kind !== 'grid') throw new Error('not a grid');
    expect(g.ys).toEqual([333, 500, 850, 1000]);
    expect(sectionOf(cells).notBack).toEqual([333]);
    expect(absentIn(cells)).toEqual([3, 3]);
    expect(cells.parameters[0].figures).toMatchObject({ total: 9, nulls: 0, numbers: 9 });
    expect(cells.parameters[0].rawAt(0, 0)).toEqual({ value: undefined, index: null, pointer: null, coverage: null, absent: true });
    expect([...codesFor(cells.parameters[0], cells, 0, 0, 1, 'none').subarray(0, 3)]).toEqual([ABSENT_CODE, ABSENT_CODE, ABSENT_CODE]);
  });

  it('draws a track as a staircase: one cell sent per position, the rest absent, not null', () => {
    const cells = drawn(mcIfsLsz);
    const [t] = cells.parameters;
    expect(t.figures).toMatchObject({ total: 9, nulls: 0, numbers: 9 });
    const codes = codesFor(t, cells, 0, t.figures.lo, t.figures.hi, 'none');
    const sentPerColumn = Array.from({ length: 9 }, (_, col) => [0, 1, 2, 3].filter(row => codes[row * 9 + col] !== ABSENT_CODE).length);
    expect(sentPerColumn).toEqual(new Array(9).fill(1));
  });

  it('makes each time a step, and a time along the path no step at all', () => {
    expect(drawn(fmiEcFrames).dims).toEqual([{ name: 't', values: ['2026-11-07T00:00:00Z', '2026-11-07T06:00:00Z', '2026-11-07T12:00:00Z'] }]);
    const along = drawn(mcIfsLsmZlist);
    expect(along).toMatchObject({ dims: [], fixed: {}, slices: 1 });
    expect(sectionOf(along).timeAlong).toHaveLength(9);
  });

  it('puts a parameter with no values among those it can’t draw', () => {
    const json = copy(mcIfsDatetimes);
    for (const coverage of json.coverages) coverage.ranges.u = 'https://x/u.covjson';
    const cells = drawn(json, urlOf(mcIfsDatetimes));
    expect(cells.parameters.map(parameter => parameter.id)).toEqual(['t']);
    expect(cells.broken).toEqual([{ id: 'u', label: null, unit: '', definedAt: '/parameters/u', problem: "u: its values aren't in this response" }]);
    expect(cells.notes[0]).toEqual({ level: 'error', text: "u: its values aren't in this response" });
  });
});

describe('readResponseCells: the cell walk', () => {
  const all: [string, unknown, string?][] = [
    ['fmi-ec-2param', fmiEc2param], ['fmi-ec-frames', fmiEcFrames], ['fmi-multilinestring', fmiMultilinestring], ['mc-ifs-datetimes', mcIfsDatetimes],
    ['mc-ifs-lsm-zlist', mcIfsLsmZlist], ['mc-ifs-lsz', mcIfsLsz], ['mc-radar-fikor-z', mcRadarFikorZ],
    ['fmi-ec-2param with a level not sent', fmiEc2param, BADLEVEL_URL], ['fmi-ec-frames with a level not sent at the top', fmiEcFrames, FRAMES_TOP_URL],
  ];
  for (const [name, json, url] of all) {
    it(`leads every cell of ${name} back to its value, absent only where nothing was sent, and reaches every value once`, () => {
      const source = copy(json);
      const cells = drawn(source, url ?? urlOf(json));
      const tally = walk(source, cells);
      expect(tally.cells).toBeGreaterThan(0);
      expect({ ...tally, cells: 0 }).toEqual({ cells: 0, wrong: 0, twice: 0, unreached: 0 });
    });
  }

  it('reads a value that isn’t a number as one, and text as text', () => {
    const json = copy(fmiEc2param);
    json.coverages[1].ranges.temperature.values[2] = 'warm';
    const cells = drawn(json, urlOf(fmiEc2param));
    const [temperature] = cells.parameters;
    expect(temperature.figures).toMatchObject({ total: 9, notNumbers: 1, nulls: 0 });
    expect(temperature.notNumbersAreText).toBe(true);
    expect(temperature.rawAt(1 * 3 + 2, 0)).toEqual({ value: 'warm', index: null, pointer: '/coverages/1/ranges/temperature/values/2', coverage: null });
    expect(walk(json, cells)).toMatchObject({ wrong: 0, unreached: 0 });
  });
});

describe('readResponseCells: notes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says why the lowest beam isn’t drawn, in the picture only', () => {
    const json = copy(mcRadarFikorZ);
    json.domain['meteocore:beamCoverage'].floor.pop();
    const cells = drawn(json, urlOf(mcRadarFikorZ));
    expect(cells.notes).toContainEqual({ level: 'warn', text: "/domain/meteocore:beamCoverage/floor has 256 values, and composite has 257 positions, so the lowest beam isn't drawn" });
    expect(cellFindings(cells).some(finding => finding.message.includes('beamCoverage'))).toBe(false);
  });

  it('calls a step all null only where something was sent, and points at the first value sent in it', () => {
    const json = copy(fmiEcFrames);
    for (const coverage of json.coverages) {
      coverage.domain.axes.composite.values.forEach((tuple: unknown[], k: number) => {
        if (tuple[0] === '2026-11-07T06:00:00Z') coverage.ranges.temperature.values[k] = null;
      });
    }
    const cells = drawn(json, FRAMES_TOP_URL);
    const note = cells.notes.find(each => each.text === '1 step of temperature is all null');
    expect(note).toMatchObject({ parameter: 'temperature', checks: 'info' });
    // Under the top row, 10 hPa, which isn't sent: 50 hPa at the first position at 06:00
    expect(cellFindings(cells).find(finding => finding.message === note!.text)?.path).toBe('/coverages/0/ranges/temperature/values/1');
  });

  it('doesn’t call a step all null where a parameter wasn’t sent at all', () => {
    const json = copy(mcIfsDatetimes);
    json.parameters.u = { type: 'Parameter' };
    for (const coverage of json.coverages) {
      if (coverage.domain.axes.composite.values[0][0] === '2026-11-07T00:00:00+00:00') coverage.ranges.u = { ...coverage.ranges.t };
    }
    const cells = drawn(json, urlOf(mcIfsDatetimes));
    const u = cells.parameters.find(parameter => parameter.id === 'u')!;
    expect(u.figures).toMatchObject({ total: 18, numbers: 18, nulls: 0 });
    expect(absentIn(cells)).toEqual([0, 36]);
    expect(cells.notes.filter(note => note.parameter === 'u' && /all null/.test(note.text))).toEqual([]);
  });

  it('says what it can’t read, and doesn’t throw, when it fails on a response', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = copy(fmiEc2param);
    const section = toSection(json, urlOf(fmiEc2param)) as SectionData;
    // The reading is kept for the response, so one that misbehaves is what the picture gets
    Object.defineProperty(section, 'km', { get: () => { throw new Error('boom'); } });
    expect(readResponseCells(json, { url: urlOf(fmiEc2param) })).toEqual({ drawable: false, reason: "This response couldn't be read: boom", why: 'cant' });
  });
});

describe('fromWaypoint', () => {
  const waypoint = (label: string, col: number | null, km: number | null): Waypoint => ({ label, line: 0, lon: 0, lat: 0, col, km });
  const path = { km: Float64Array.from([0, 3.2, 10, 13.2, 19.6, 20]), breaks: [], waypoints: [waypoint('A', 0, 0), waypoint('B', 2, 10), waypoint('C', 5, 20)] };

  it('says how far a position is from the nearest waypoint, and which way', () => {
    expect(fromWaypoint(path, 1)).toBe('A+3.2 km');
    expect(fromWaypoint(path, 3)).toBe('B+3.2 km');
    expect(fromWaypoint(path, 4)).toBe('C−0.4 km');
    expect(fromWaypoint({ ...path, km: Float64Array.from([0, 0.4]), waypoints: [waypoint('A', 1, 0.4)] }, 0)).toBe('A−0.4 km');
  });

  it('says a position is at a waypoint, or at one sent again', () => {
    expect(fromWaypoint(path, 2)).toBe('at B');
    expect(fromWaypoint({ ...path, km: Float64Array.from([0, 10, 10]), waypoints: [waypoint('A', 0, 0), waypoint('B', 1, 10)] }, 2)).toBe('at B');
  });

  it('takes the one behind where two are as near', () => {
    expect(fromWaypoint({ ...path, km: Float64Array.from([0, 5, 10]), waypoints: [waypoint('A', 0, 0), waypoint('B', 2, 10)] }, 1)).toBe('A+5 km');
  });

  it('names the line of a MULTILINESTRING, and keeps to that line’s waypoints', () => {
    const data = drawn(fmiMultilinestring).section!.data;
    expect([0, 1, 2, 3].map(col => fromWaypoint(data, col))).toEqual(['line 1, at A', 'line 1, at B', 'line 2, at C', 'line 2, at D']);
  });

  it('says nothing where no waypoint is among the positions', () => {
    expect(fromWaypoint({ ...path, waypoints: [] }, 1)).toBeNull();
    expect(fromWaypoint({ ...path, waypoints: [waypoint('A', null, null)] }, 1)).toBeNull();
  });

  it('writes km to the metre, without a thousands comma', () => {
    expect([0, 112.5, 157.23456, 1234.5].map(kmWords)).toEqual(['0', '112.5', '157.23', '1234.5']);
  });
});

describe('planeFor', () => {
  const gridOf = (cells: DrawableCells) => {
    if (cells.geometry.kind !== 'grid') throw new Error('not a grid');
    return cells.geometry;
  };

  it('is the reading itself as it was read, and for a log axis it can’t have', () => {
    const fmi = drawn(fmiEc2param);
    expect(planeFor(fmi, 'log', false)).toBe(fmi);
    const radar = drawn(mcRadarFikorZ);
    expect(planeFor(radar, 'log', false)).toBe(radar);
  });

  it('lays the levels out again for another spacing, with the same values and rows', () => {
    const fmi = drawn(fmiEc2param);
    const linear = planeFor(fmi, 'linear', false);
    expect(gridOf(linear).ys).toEqual(gridOf(fmi).ys);
    expect([...gridOf(linear).yEdges]).not.toEqual([...gridOf(fmi).yEdges]);
    expect(linear.section).toMatchObject({ spacing: 'linear', defaultSpacing: 'log', flipped: false });
    expect(linear.section!.rowLevel).toBe(fmi.section!.rowLevel);
    expect(linear.parameters).toBe(fmi.parameters);
    // 850 hPa sits by its value on a linear axis
    expect(linear.section!.rowY[1]).toBeCloseTo(1 - (850 - 500) / 500, 12);
    expect(linear.section!.yOf(750)).toBeCloseTo(0.5, 12);
    const even = planeFor(fmi, 'even', false);
    expect([...even.section!.rowY]).toEqual([1, 0.5, 0]);
  });

  it('turns the levels over, edges and labels too, and leaves the values where they are', () => {
    const fmi = drawn(fmiEc2param);
    const flipped = planeFor(fmi, 'log', true);
    const [g, f] = [gridOf(fmi), gridOf(flipped)];
    expect(f.ys).toEqual([...g.ys].reverse());
    f.yEdges.forEach((edge, i) => expect(edge).toBeCloseTo(1 - g.yEdges[g.ny - i], 12));
    flipped.section!.rowY.forEach((y, row) => expect(y).toBeCloseTo(1 - fmi.section!.rowY[g.ny - 1 - row], 12));
    expect(flipped.section!.yOf(500)).toBeCloseTo(0, 12);
    expect(flipped.section).toMatchObject({ spacing: 'log', flipped: true });
    expect(flipped.section!.rowLevel).toBe(fmi.section!.rowLevel);
    expect(flipped.parameters[0].data).toBe(fmi.parameters[0].data);
  });

  it('makes each layout once', () => {
    const fmi = drawn(fmiEc2param);
    expect(planeFor(fmi, 'even', true)).toBe(planeFor(fmi, 'even', true));
    expect(planeFor(fmi, 'even', true)).not.toBe(planeFor(fmi, 'even', false));
  });

  it('leaves a grid as it is', () => {
    const fmi = drawn(fmiEc2param);
    const { section, ...grid } = fmi;
    expect(section).toBeDefined();
    expect(planeFor(grid as DrawableCells, 'even', true)).toBe(grid);
  });
});
