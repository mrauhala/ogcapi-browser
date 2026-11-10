import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOT_A_NUMBER, NOT_SENT, toSection, type SectionData, type SectionResult } from './coverageSection';
import { coverageToProfile } from './coverageProfile';
import { parseTime } from '../utils/utcTime';
import { COVJSON, EDR } from '../standards';
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
import mcIfs1tAll from './__fixtures__/profiles/mc-ifs-1t-all.json';
import polytopeMultipoint from './__fixtures__/polytope-op-multipoint-area.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Each saved response, as the request that got it: its URL is in its comment
const copy = (json: unknown): Json => JSON.parse(JSON.stringify(json));
const urlOf = (json: Json) => /^GET (\S+),/.exec(json._comment)?.[1];
const read = (json: unknown, url = urlOf(json as Json)) => toSection(copy(json), url);
function sectionOf(json: unknown, url?: string): SectionData {
  const result = toSection(json as Json, url ?? urlOf(json as Json));
  if (result === null || result.kind === 'cant') throw new Error(`no section: ${result === null ? 'null' : result.reason}`);
  return result;
}
const reasonOf = (result: SectionResult) => (result?.kind === 'cant' ? result.reason : `not a cant: ${result === null ? 'null' : result.kind}`);
// The path's own notes. The z findings, a profile's issues and passes, are tested apart
const pathNotes = (section: SectionData) => section.notes.filter(note => note.severity === 'info');
const messages = (section: SectionData) => pathNotes(section).map(note => note.message);
const cell = (section: SectionData, level: number | null, col: number) => section.levels.indexOf(level) * section.colCount + col;
const valueOf = (section: SectionData, id: string, frame: number, level: number | null, col: number) =>
  section.parameters.find(parameter => parameter.id === id)!.data[frame][cell(section, level, col)];

// RFC 6901, read here apart from the module, to follow a pointer back into the response
function at(json: unknown, pointer: string): unknown {
  return pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((node, key) => (node as Json)?.[key], json);
}

// Every cell's pointer leads to its value in the response, and a cell with no pointer was sent nothing
function walk(json: unknown, section: SectionData): { cells: number; wrong: number } {
  let cells = 0;
  let wrong = 0;
  for (const parameter of section.parameters) {
    parameter.data.forEach((data, frame) => data.forEach((value, index) => {
      const found = section.cellAt(parameter.id, frame, index);
      if (!found) {
        if (value !== NOT_SENT) wrong++;
        return;
      }
      cells++;
      const raw = at(json, found.path);
      const same = raw === null ? Number.isNaN(value) : typeof raw === 'number' ? value === raw : value === NOT_A_NUMBER;
      if (!same || raw !== found.raw) wrong++;
    }));
  }
  return { cells, wrong };
}

describe('toSection: the shapes servers send', () => {
  it('reads FMI’s coverage per level, z in the tuples, levels ascending', () => {
    const section = sectionOf(fmiEc2param);
    expect(section).toMatchObject({ kind: 'section', domainType: 'Trajectory', coverageCount: 3, levels: [500, 850, 1000], colCount: 3, notBack: [], breaks: [], timeAlong: null });
    expect(section.frames).toEqual([{ key: 't 2026-11-07T00:00:00Z', raw: '2026-11-07T00:00:00Z', ms: parseTime('2026-11-07T00:00:00Z') }]);
    expect(section.z).toMatchObject({ kind: 'pressure', unit: 'hPa', unitSource: 'description', direction: 'down', directionSource: 'usual' });
    expect(section.positions).toEqual([[24, 60], [25, 61], [26, 62]]);
    expect(section.parameters.map(({ id, count, nulls, numbers, unit, label }) => ({ id, count, nulls, numbers, unit, label })))
      .toEqual([{ id: 'temperature', count: 9, nulls: 0, numbers: 9, unit: '', label: null }, { id: 'windspeedms', count: 9, nulls: 0, numbers: 9, unit: '', label: null }]);
    // 1000 hPa is the third coverage, and the second position its second tuple
    expect(valueOf(section, 'temperature', 0, 1000, 1)).toBe(0.814452);
    expect(section.cellAt('temperature', 0, cell(section, 1000, 1))).toEqual({ raw: 0.814452, path: '/coverages/2/ranges/temperature/values/1' });
    expect(section.cellAt('windspeedms', 0, cell(section, 500, 2))).toEqual({ raw: 24.0672, path: '/coverages/0/ranges/windspeedms/values/2' });
    expect(pathNotes(section)).toEqual([]);
  });

  it('measures km along the path from the response’s own positions, great-circle', () => {
    const section = sectionOf(fmiEc2param);
    expect(section.crs.geographic).toBe(true);
    expect(section.km[0]).toBe(0);
    expect(section.km[1]).toBeCloseTo(123.942, 3);
    expect(section.km[2]).toBeCloseTo(123.942 + 123.202, 2);
    expect(section.spacing.total).toBe(section.km[2]);
    expect(section.waypoints.map(({ label, col, line }) => [label, col, line])).toEqual([['A', 0, 0], ['B', 1, 0], ['C', 2, 0]]);
    expect(section.waypoints[1].km).toBe(section.km[1]);
  });

  it('counts positions where x and y aren’t lon/lat, and finds no waypoints there', () => {
    const json = copy(fmiEc2param);
    json.referencing[0].system = { type: 'ProjectedCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/3067' };
    const section = sectionOf(json);
    expect(section.crs.geographic).toBe(false);
    expect([...section.km]).toEqual([0, 1, 2]);
    expect(section.waypoints.every(waypoint => waypoint.col === null)).toBe(true);
    expect(pathNotes(section)).toEqual([]);
  });

  it('reads a radar Section’s z axis in metres, through axisNames, whichever their order', () => {
    const section = sectionOf(mcRadarFikorZ);
    expect(section).toMatchObject({ kind: 'section', domainType: 'Section', colCount: 257, notBack: [] });
    expect(section.levels).toHaveLength(39);
    expect(section.levels[0]).toBe(0);
    expect(section.levels.every((level, i) => i === 0 || level! > section.levels[i - 1]!)).toBe(true);
    expect(section.z).toMatchObject({ kind: 'height', unit: 'm', direction: 'up', directionSource: 'response', name: 'Height above antenna' });
    expect(section.spacing.median).toBeCloseTo(0.499, 3);
    expect(section.parameters[0]).toMatchObject({ id: 'DBZH', count: 10023, nulls: 10000, numbers: 23 });
    // values/3086 is position 79 (3086 = 79 × 39 + 5) at the sixth height, 1224.49 m
    const where = cell(section, section.levels[5], 79);
    expect(section.levels[5]).toBeCloseTo(1224.489, 3);
    expect(section.parameters[0].data[0][where]).toBe(-16.87);
    expect(section.cellAt('DBZH', 0, where)).toEqual({ raw: -16.87, path: '/ranges/DBZH/values/3086' });

    // The same response sent with z first gives the same cells, from other places in values
    const transposed = copy(mcRadarFikorZ);
    const range = transposed.ranges.DBZH;
    const [n, levels] = range.shape;
    range.axisNames = ['z', 'composite'];
    range.shape = [levels, n];
    range.values = Array.from({ length: n * levels }, (_, i) => mcRadarFikorZ.ranges.DBZH.values[(i % n) * levels + Math.floor(i / n)]);
    const other = sectionOf(transposed);
    expect([...other.parameters[0].data[0]]).toEqual([...section.parameters[0].data[0]]);
    expect(other.cellAt('DBZH', 0, where)?.path).toBe(`/ranges/DBZH/values/${5 * 257 + 79}`);
  });

  it('reads z in the tuples as a track: one level per position', () => {
    const section = sectionOf(mcIfsLsz);
    expect(section).toMatchObject({ kind: 'track', levels: [500, 600, 700, 850], colCount: 9 });
    expect(valueOf(section, 't', 0, 700, 3)).toBe(-6.047459);
    expect(section.cellAt('t', 0, cell(section, 700, 3))?.path).toBe('/ranges/t/values/3');
    // Only its own level is sent at each position
    expect(valueOf(section, 't', 0, 850, 3)).toBe(NOT_SENT);
    expect(section.cellAt('t', 0, cell(section, 850, 3))).toBeNull();
  });

  it('reads time in the tuples as time along the path, in one frame', () => {
    const section = sectionOf(mcIfsLsmZlist);
    expect(section).toMatchObject({ kind: 'section', levels: [500, 850], colCount: 9 });
    expect(section.frames).toEqual([{ key: 'along', raw: null, ms: NaN }]);
    expect(section.timeAlong![0]).toBe(parseTime('2026-11-07T00:00:00Z'));
    expect(section.timeAlong![2]).toBe(parseTime('2026-11-07T03:00:00Z'));
    expect(section.cellAt('t', 0, cell(section, 500, 2))).toEqual({ raw: -22.567913, path: '/coverages/1/ranges/t/values/2' });
  });

  it('reads FMI’s times inside the tuples, t fastest, as frames', () => {
    const section = sectionOf(fmiEcFrames);
    expect(section).toMatchObject({ kind: 'section', colCount: 5, coverageCount: 9, timeAlong: null });
    expect(section.levels).toEqual([50, 200, 250, 300, 500, 700, 850, 925, 1000]);
    expect(section.frames.map(frame => frame.raw)).toEqual(['2026-11-07T00:00:00Z', '2026-11-07T06:00:00Z', '2026-11-07T12:00:00Z']);
    // Tuple 3 is the second position at 00:00, and tuple 1 the first at 06:00
    expect(section.cellAt('temperature', 0, cell(section, 50, 1))).toEqual({ raw: -63.4097, path: '/coverages/0/ranges/temperature/values/3' });
    expect(section.cellAt('temperature', 1, cell(section, 50, 0))).toEqual({ raw: -63.0565, path: '/coverages/0/ranges/temperature/values/1' });
    expect(section.parameters.find(parameter => parameter.id === 'windspeedms')).toMatchObject({ count: 135, nulls: 30 });
  });

  it('reads MeteoCore’s coverage per level and time as frames, in time order', () => {
    const section = sectionOf(mcIfsDatetimes);
    expect(section).toMatchObject({ kind: 'section', levels: [500, 850], colCount: 9, coverageCount: 6 });
    expect(section.frames.map(frame => frame.raw)).toEqual(['2026-11-07T00:00:00+00:00', '2026-11-07T03:00:00+00:00', '2026-11-07T06:00:00+00:00']);
    expect(section.cellAt('t', 1, cell(section, 850, 2))).toEqual({ raw: -0.06795919, path: '/coverages/2/ranges/t/values/2' });
    expect(section.z).toMatchObject({ unitSource: 'response', directionSource: 'response' });
  });

  it('breaks a MULTILINESTRING between its lines, and letters its vertices on through both', () => {
    const section = sectionOf(fmiMultilinestring);
    expect(section).toMatchObject({ kind: 'section', colCount: 4, breaks: [2], levels: [500, 850] });
    expect(section.positions).toEqual([[24, 60], [25, 61], [26, 62], [27, 63]]);
    // A new line starts where the last ended, and isn't a step along the path
    expect(section.km[2]).toBe(section.km[1]);
    expect(section.spacing.total).toBeCloseTo(123.942 + 122.473, 2);
    expect(section.waypoints.map(({ label, col, line }) => [label, col, line])).toEqual([['A', 0, 0], ['B', 1, 0], ['C', 2, 1], ['D', 3, 1]]);
    expect(section.cellAt('temperature', 0, cell(section, 850, 3))).toEqual({ raw: -2.06612, path: '/coverages/3/ranges/temperature/values/1' });
    expect(pathNotes(section)).toEqual([]);
  });

  it('reads one level as a line, and no z at all as a line with no level', () => {
    expect(sectionOf(mcIfsBadlevel)).toMatchObject({ kind: 'line', levels: [333, 850], notBack: [333] });
    const noZ = sectionOf(mcSingleNoz);
    expect(noZ).toMatchObject({ kind: 'line', levels: [null], z: null, colCount: 9 });
    expect(noZ.cellAt('2t', 0, 4)).toEqual({ raw: mcSingleNoz.ranges['2t'].values[4], path: '/ranges/2t/values/4' });
  });

  it('gives one frame with no time to a path with none', () => {
    const json = copy(mcSingleNoz);
    json.domain.axes.composite.coordinates = ['x', 'y'];
    json.domain.axes.composite.values = json.domain.axes.composite.values.map(([, x, y]: unknown[]) => [x, y]);
    expect(sectionOf(json).frames).toEqual([{ key: 'none', raw: null, ms: NaN }]);
  });

  it('leads every cell of every fixture back to its value in the response', () => {
    for (const json of [fmiEc2param, fmiEcFrames, fmiMultilinestring, mcIfsBadlevel, mcIfsDatetimes, mcIfsLsmZlist, mcIfsLsz, mcMepsClosed, mcSingleNoz, mcRadarFikorZ]) {
      const { cells, wrong } = walk(json, sectionOf(json));
      expect(cells).toBeGreaterThan(0);
      expect(wrong).toBe(0);
    }
  });
});

describe('toSection: what isn’t a path', () => {
  it('leaves a path at one place to the profile, so that it opens as before', () => {
    expect(read(fmiTrajectoryOnePlace)).toBeNull();
    expect(coverageToProfile(copy(fmiTrajectoryOnePlace), { url: urlOf(fmiTrajectoryOnePlace) }).profile).not.toBeNull();
  });

  it('returns null for a position, a MultiPoint and what isn’t a coverage', () => {
    expect(read(mcIfs1tAll)).toBeNull();
    expect(read(polytopeMultipoint)).toBeNull();
    expect(toSection({ type: 'FeatureCollection', features: [] })).toBeNull();
    expect(toSection(null)).toBeNull();
    expect(toSection({ type: 'CoverageCollection', coverages: [] })).toBeNull();
    // Places with x and y, and no t: points, not a path
    const points = { type: 'Coverage', domain: { type: 'Domain', domainType: 'MultiPoint', axes: { composite: { dataType: 'tuple', coordinates: ['x', 'y'], values: [[24, 60], [25, 61], [26, 62]] } } }, ranges: { a: { type: 'NdArray', axisNames: ['composite'], shape: [3], values: [1, 2, 3] } } };
    expect(toSection(points)).toBeNull();
  });
});

describe('toSection: notes on the path', () => {
  it('says where MeteoCore’s path back to its start ends short, and its uneven steps', () => {
    const section = sectionOf(mcMepsClosed);
    expect(section).toMatchObject({ kind: 'line', colCount: 48 });
    expect(section.waypoints.map(({ label, col }) => [label, col])).toEqual([['A', 0], ['B', 42], ['C', null]]);
    expect(pathNotes(section)).toEqual([
      { message: "The path ends 20.66 km from the line's last vertex", path: '/domain/axes/composite/values/47', severity: 'info' },
      { message: 'Positions 43 to 48 are 14.75, 53.12, 2.95, 8.85 and 23.61 km apart, where the rest are 2.95', path: '/domain/axes/composite/values/42', severity: 'info' },
    ]);
  });

  it('says where the path starts away from the first vertex, and which vertex isn’t among the positions', () => {
    const section = sectionOf(mcMepsClosed, 'https://x/trajectory?coords=LINESTRING(23.8%2060,25.2%2061,24%2060)&z=850');
    expect(messages(section)).toEqual([
      "The path starts 11.12 km from the line's first vertex",
      // 0.2° of longitude at 61° N from the far end, 25 61
      "Vertex B isn't among the positions: the nearest is 10.78 km from it",
      "The path ends 20.66 km from the line's last vertex",
      'Positions 43 to 48 are 14.75, 53.12, 2.95, 8.85 and 23.61 km apart, where the rest are 2.95',
    ]);
    expect(pathNotes(section)[0].path).toBe('/domain/axes/composite/values/0');
    expect(pathNotes(section)[1].path).toBe('/domain/axes/composite/values/42');
    expect(section.waypoints.map(waypoint => waypoint.col)).toEqual([null, null, null]);
  });

  it('says which line of a MULTILINESTRING ends away from its last vertex', () => {
    const url = 'https://x/trajectory?coords=MULTILINESTRING((24%2060,25%2061),(26%2062,29%2063))';
    // 2° of longitude at 63° N
    expect(messages(sectionOf(fmiMultilinestring, url))).toEqual(['Line 2 of the path ends 100.96 km from its last vertex']);
  });

  it('reads waypoints from any WKT line: Z, M and ZM', () => {
    for (const coords of ['LINESTRINGZ(24 60 850,25 61 700,26 62 500)', 'LINESTRING Z (24 60 850,25 61 700,26 62 500)', 'LINESTRINGM(24 60 1,25 61 2,26 62 3)', 'LINESTRINGZM(24 60 850 1,25 61 700 2,26 62 500 3)']) {
      const section = sectionOf(fmiEc2param, `https://x/trajectory?coords=${encodeURIComponent(coords)}`);
      expect(section.waypoints.map(waypoint => [waypoint.lon, waypoint.lat, waypoint.col])).toEqual([[24, 60, 0], [25, 61, 1], [26, 62, 2]]);
    }
    expect(sectionOf(fmiEc2param, 'https://x/trajectory?coords=POINT(24%2060)').waypoints).toEqual([]);
    expect(sectionOf(fmiEc2param, 'https://x/trajectory?coords=LINESTRING(24%2060,garbage)').waypoints).toEqual([]);
    expect(sectionOf(fmiEc2param, 'not a url').waypoints).toEqual([]);
  });

  it('says which position repeats the one before it', () => {
    const json = copy(mcMepsClosed);
    const tuples = json.domain.axes.composite.values;
    tuples[12] = [...tuples[11]];
    expect(messages(sectionOf(json))).toContain('Position 13 repeats position 12');
    expect(pathNotes(sectionOf(json)).find(note => /repeats/.test(note.message))!.path).toBe('/domain/axes/composite/values/12');
    tuples[20] = [...tuples[19]];
    // A response read once is read again only as a new object
    expect(messages(sectionOf(copy(json)))).toContain('Position 13 repeats position 12, and 1 more position repeats the one before it');
  });

  it('doesn’t call a path sent as its vertices alone uneven, since that spacing is the request’s', () => {
    // A fourth position 14° on from the third: a step over 2.5 times the usual
    const json = copy(fmiEc2param);
    for (const coverage of json.coverages) {
      const tuples = coverage.domain.axes.composite.values;
      tuples.push(tuples[2].map((value: unknown, i: number) => (i === 1 ? 40 : value)));
      for (const range of Object.values(coverage.ranges) as Json[]) {
        range.values.push(1);
        range.shape = [4];
      }
    }
    const uneven = (url: string) => messages(sectionOf(json, url)).filter(message => /apart/.test(message));
    expect(uneven('https://x/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)')).toEqual(['Positions 3 and 4 are 729.42 km apart, where the rest are 123.2 to 123.94']);
    expect(uneven('https://x/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062,40%2062)')).toEqual([]);
  });
});

describe('toSection: what it says of z, as a profile does', () => {
  const zOf = (section: SectionData) => section.notes.filter(note => note.severity !== 'info');

  it('passes a radar’s z, whose direction and unit are on its z axis', () => {
    expect(zOf(sectionOf(mcRadarFikorZ))).toEqual([
      { message: "z's direction is in the response: up", path: '/domain/axes/z', severity: 'pass' },
      { message: "z's unit is in the response: m", path: '/domain/axes/z', severity: 'pass' },
    ]);
  });

  it('makes issues of FMI’s z, said only in words, at its tuples', () => {
    expect(zOf(sectionOf(fmiEc2param))).toEqual([
      { message: "z's direction isn't in the response: assumed down, as usual for pressure", path: '/coverages/0/domain/axes/composite', severity: 'warning' },
      { message: "z's unit, hPa, is only in a description, and not in its reference system's axis", path: '/coverages/0/domain/axes/composite', severity: 'warning' },
    ]);
  });

  it('says where z is referenced to a CRS with no vertical axis', () => {
    const json = copy(mcRadarFikorZ);
    const referencing = (json.domain as { referencing: { coordinates: string[]; system: unknown }[] }).referencing;
    referencing.find(entry => entry.coordinates.includes('z'))!.system = { type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' };
    expect(zOf(sectionOf(json))).toContainEqual({ message: 'z is referenced to http://www.opengis.net/def/crs/OGC/1.3/CRS84, which has no vertical axis', path: '/domain/referencing', severity: 'warning', rule: COVJSON.spatialReferenced });
  });

  it('says nothing of z where there’s none', () => {
    expect(zOf(sectionOf(mcSingleNoz))).toEqual([]);
  });
});

describe('toSection: coverages that don’t share their positions', () => {
  type Composite = { domain: { axes: { composite: { coordinates: string[]; values: number[][] } } } };

  it('says so, where the request was one line, at the first position of the second part', () => {
    const json = copy(fmiEc2param);
    const [, second] = json.coverages as Composite[];
    const { coordinates, values } = second.domain.axes.composite;
    values[0][coordinates.indexOf('x')] += 0.5;
    const section = sectionOf(json);
    expect(pathNotes(section).filter(note => /share their positions/.test(note.message))).toEqual([{
      message: "The coverages don't share their positions: coverage 2's differ from coverage 1's, so the path is read in 2 parts", path: '/coverages/1/domain/axes/composite/values/0', severity: 'info',
    }]);
    expect(section.breaks.length).toBe(1);
  });

  it('says nothing of a MULTILINESTRING’s lines, each its own part', () => {
    const section = sectionOf(fmiMultilinestring);
    expect(section.breaks.length).toBe(1);
    expect(messages(section).filter(message => /share their positions/.test(message))).toEqual([]);
  });
});

describe('toSection: notes on the levels and values', () => {
  it('says a level asked for isn’t in the response, and gives it a row with nothing in it', () => {
    const section = sectionOf(mcIfsBadlevel);
    expect(pathNotes(section)).toEqual([{ message: "z=333 was asked for, and isn't in the response", path: '/domain/axes/z/values', severity: 'info' }]);
    expect(valueOf(section, 't', 0, 333, 0)).toBe(NOT_SENT);
    const fmi = copy(fmiEc2param);
    fmi.coverages.splice(1, 1);
    expect(pathNotes(sectionOf(fmi, 'https://x/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)&z=1000,850,500')))
      .toEqual([{ message: "z=850 was asked for, and isn't in the response", path: '/coverages', severity: 'info' }]);
  });

  it('says when none of the levels asked for came back, and adds no rows for them', () => {
    const section = sectionOf(mcRadarFikorZ);
    expect(pathNotes(section)).toEqual([{
      message: "z=0.5, 1.5, 3, 8 were asked for, and none of them is among the response's levels, 0 to 9306.12 m", path: '/domain/axes/z/values', severity: 'info', rule: [EDR.zResponse, EDR.zIgnored],
    }]);
    expect(section.levels).toHaveLength(39);
    expect(messages(sectionOf(mcSingleNoz, `${urlOf(mcSingleNoz)}&z=850`))).toEqual(["z=850 was asked for, and isn't among what the response sent, which has no z"]);
  });

  it('says a parameter is null at every position on a few levels', () => {
    const section = sectionOf(fmiEcFrames);
    expect(pathNotes(section)).toEqual([{ message: 'windspeedms is null at every position on 2 levels: 50, 200 hPa', path: '/coverages/0/ranges/windspeedms/values/0', severity: 'info' }]);
  });

  it('keeps the first of a value sent twice, and says how many were', () => {
    const json = copy(fmiEc2param);
    const again = copy(json.coverages[0]);
    again.ranges.temperature.values = [1, 2, 3];
    json.coverages.push(again);
    const section = sectionOf(json);
    expect(messages(section)).toEqual(['6 values are sent again for a position, level and time already sent. The first is used']);
    expect(pathNotes(section)[0].path).toBe('/coverages/3/ranges/temperature/values/0');
    expect(valueOf(section, 'temperature', 0, 500, 0)).toBe(-23.1);
    expect(section.parameters[0].count).toBe(9);
  });

  it('keeps null, a number and what’s neither apart, and counts them', () => {
    const json = copy(mcSingleNoz);
    json.ranges['2t'].values[0] = null;
    json.ranges['2t'].values[1] = '12';
    const section = sectionOf(json);
    expect(Number.isNaN(section.parameters[0].data[0][0])).toBe(true);
    expect(section.parameters[0].data[0][1]).toBe(NOT_A_NUMBER);
    expect(section.parameters[0]).toMatchObject({ count: 9, nulls: 1, others: 1, numbers: 7 });
    expect(section.cellAt('2t', 0, 1)).toEqual({ raw: '12', path: '/ranges/2t/values/1' });
  });

  it('says nothing the summary says already: nulls, units, time order', () => {
    // fmi-ec-frames has 30 nulls and no units, and its t runs back at each position
    expect(messages(sectionOf(fmiEcFrames)).some(message => /no unit|nulls in|order/.test(message))).toBe(false);
  });
});

describe('toSection: why a path can’t be read', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says which range has too few values, in numbers', () => {
    const json = copy(fmiEc2param);
    json.coverages[1].ranges.temperature.values.length = 2;
    json.coverages[1].ranges.temperature.shape = [2];
    expect(reasonOf(toSection(json))).toBe('/coverages/1/ranges/temperature/values has 2 values, and composite has 3 positions');
    const radar = copy(mcRadarFikorZ);
    radar.ranges.DBZH.values.pop();
    expect(reasonOf(toSection(radar))).toBe('/ranges/DBZH/values has 10,022 values, and its axes make 257 × 39 = 10,023');
  });

  it('says what of a range doesn’t fit the domain', () => {
    const radar = copy(mcRadarFikorZ);
    radar.ranges.DBZH.axisNames = ['composite'];
    expect(reasonOf(toSection(radar))).toBe('/ranges/DBZH/axisNames has no z, and z has 39 values');
    // A response read once is read again only as a new object
    radar.ranges.DBZH.axisNames = ['composite', 'height'];
    expect(reasonOf(toSection(copy(radar)))).toBe(`/ranges/DBZH/axisNames has "height", which isn't an axis of the domain`);
    radar.ranges.DBZH.axisNames = ['composite', 'z'];
    radar.ranges.DBZH.shape = [39, 257];
    expect(reasonOf(toSection(copy(radar)))).toBe('/ranges/DBZH/shape is [39,257], and its axes, composite, z, have 257, 39');
  });

  it('says which tuple or z isn’t a number', () => {
    const json = copy(fmiEc2param);
    json.coverages[2].domain.axes.composite.values[1][3] = '1000';
    expect(reasonOf(toSection(json))).toBe('/coverages/2/domain/axes/composite/values/1 has z "1000", which isn\'t a number');
    const lon = copy(mcIfsLsz);
    lon.domain.axes.composite.values[4][1] = null;
    expect(reasonOf(toSection(lon))).toBe("/domain/axes/composite/values/4 has x null, which isn't a number");
    const radar = copy(mcRadarFikorZ);
    radar.domain.axes.z.values[3] = 'high';
    expect(reasonOf(toSection(radar))).toBe(`/domain/axes/z/values/3 is "high", which isn't a number`);
  });

  it('says what of the domain it can’t read', () => {
    const linked = copy(fmiEc2param);
    linked.coverages[1].domain = 'https://x/domain';
    expect(reasonOf(toSection(linked))).toBe('/coverages/1/domain is a link, and not in this response');
    const member = copy(fmiEc2param);
    member.coverages[0].domain.axes.member = { values: [1, 2] };
    expect(reasonOf(toSection(member))).toBe('/coverages/0 runs along member as well, with 2 values. A path is read along composite and z');
    const noZ = copy(fmiEc2param);
    noZ.coverages[1].domain.axes.composite.coordinates = ['t', 'x', 'y'];
    expect(reasonOf(toSection(noZ))).toBe('/coverages/1 has no z, where the rest of the response has one');
    const empty = copy(mcSingleNoz);
    empty.domain.axes.composite.values = [];
    empty.domain.axes.composite.values.push(['2026-11-07T00:00:00Z', 1, 2], ['2026-11-07T00:00:00Z', 3, 4]);
    delete empty.ranges;
    expect(reasonOf(toSection(empty))).toBe('The coverage has no ranges');
  });

  it('says when some coverages have a time per position and others one time', () => {
    const json = copy(mcIfsLsmZlist);
    for (const tuple of json.coverages[1].domain.axes.composite.values) tuple[0] = '2026-11-07T00:00:00+00:00';
    expect(reasonOf(toSection(json))).toBe('/coverages/0 has a time per position, and /coverages/1 one time for all its positions');
  });

  it('says when the values are elsewhere', () => {
    const json = copy(mcSingleNoz);
    json.ranges['2t'] = 'https://x/2t.covjson';
    expect(reasonOf(toSection(json))).toBe("The values aren't in this response");
  });

  it('says so, and doesn’t throw, when it fails on a response', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const json = copy(fmiEc2param);
    Object.defineProperty(json.coverages[0].domain.axes.composite, 'values', { get: () => { throw new Error('boom'); } });
    expect(reasonOf(toSection(json))).toBe("This response couldn't be read: boom");
  });
});

describe('toSection: where a rule draws its line', () => {
  const line = (xs: number[]) => ({
    type: 'Coverage',
    domain: { type: 'Domain', domainType: 'Trajectory', axes: { composite: { dataType: 'tuple', coordinates: ['x', 'y'], values: xs.map(x => [x, 0]) } } },
    ranges: { a: { type: 'NdArray', axisNames: ['composite'], shape: [xs.length], values: xs.map((_, i) => i) } },
  });

  it('calls a step uneven over 2.5 times the usual, and not at twice', () => {
    expect(messages(sectionOf(line([0, 0.01, 0.02, 0.03, 0.06])))).toEqual(['Positions 4 and 5 are 3.34 km apart, where the rest are 1.11']);
    expect(messages(sectionOf(line([0, 0.01, 0.02, 0.03, 0.05])))).toEqual([]);
  });

  it('calls a level null all along only where what was sent there is null, not where nothing was', () => {
    const T = ['2026-11-07T00:00:00Z', '2026-11-07T06:00:00Z'];
    const coverage = (level: number, t: string, a: unknown[] | null) => ({
      type: 'Coverage',
      domain: { type: 'Domain', domainType: 'Trajectory', axes: { composite: { dataType: 'tuple', coordinates: ['t', 'x', 'y'], values: [[t, 24, 60], [t, 25, 61], [t, 26, 62]] }, z: { values: [level] } } },
      ranges: {
        ...(a ? { a: { type: 'NdArray', axisNames: ['composite'], shape: [3], values: a } } : {}),
        b: { type: 'NdArray', axisNames: ['composite'], shape: [3], values: [1, 2, 3] },
      },
    });
    const coverages = [1000, 850, 700, 500].flatMap(level => T.map((t, i) => coverage(level, t, level !== 500 ? [1, 2, 3] : i === 0 ? [null, null, null] : null)));
    const notes = messages(sectionOf({ type: 'CoverageCollection', coverages }));
    expect(notes).toEqual(['a is null at every position on 1 level: 500']);
  });
});

describe('toSection: the lowest beam, from MeteoCore’s meteocore:beamCoverage.floor', () => {
  const BEAM = 'meteocore:beamCoverage';
  // fikor-z as a collection of two times, each with its own floor, as a radar sends every time asked
  const twoTimes = () => {
    const [a, b] = [copy(mcRadarFikorZ), copy(mcRadarFikorZ)];
    for (const tuple of b.domain.axes.composite.values) tuple[0] = '2026-11-06T23:10:00+00:00';
    b.domain[BEAM].floor = b.domain[BEAM].floor.map((height: number) => height + 10);
    const coverage = (json: Json) => ({ type: 'Coverage', domain: json.domain, ranges: json.ranges });
    return { type: 'CoverageCollection', domainType: 'Section', parameters: a.parameters, coverages: [coverage(b), coverage(a)] } as Json;
  };

  it('reads a height per position, with where each is in the response', () => {
    const { beamFloor, beamFloorFault } = sectionOf(mcRadarFikorZ);
    expect(beamFloorFault).toBeNull();
    expect(beamFloor!.values).toHaveLength(1);
    expect(beamFloor!.values[0]).toHaveLength(257);
    expect(beamFloor!.values[0][0]).toBe(790.3053048271686);
    expect(beamFloor!.values[0].every(Number.isFinite)).toBe(true);
    expect(beamFloor!.pathAt(0, 0)).toBe(`/domain/${BEAM}/floor/0`);
    expect(beamFloor!.pathAt(0, 256)).toBe(`/domain/${BEAM}/floor/256`);
    expect(beamFloor!.pathAt(0, 257)).toBeNull();
    expect(beamFloor!.pathAt(1, 0)).toBeNull();
  });

  it('has none, and says nothing, where the response has none', () => {
    for (const json of [fmiEc2param, mcIfsLsz, mcSingleNoz]) expect(sectionOf(json)).toMatchObject({ beamFloor: null, beamFloorFault: null });
  });

  it('keeps each time’s own floor, since it changes with time', () => {
    const section = sectionOf(twoTimes(), urlOf(mcRadarFikorZ as Json));
    expect(section.frames.map(frame => frame.raw)).toEqual(['2026-11-06T23:05:00+00:00', '2026-11-06T23:10:00+00:00']);
    const { values, pathAt } = section.beamFloor!;
    expect(values[0][0]).toBe(790.3053048271686);
    expect(values[1][0]).toBe(790.3053048271686 + 10);
    // The later time is the first coverage
    expect(pathAt(0, 12)).toBe(`/coverages/1/domain/${BEAM}/floor/12`);
    expect(pathAt(1, 12)).toBe(`/coverages/0/domain/${BEAM}/floor/12`);
  });

  it('leaves a gap where a height isn’t a number', () => {
    const json = copy(mcRadarFikorZ);
    json.domain[BEAM].floor[3] = null;
    const { values, pathAt } = sectionOf(json).beamFloor!;
    expect(values[0][3]).toBeNaN();
    expect(pathAt(0, 3)).toBeNull();
    expect(values[0][4]).toBe((mcRadarFikorZ as Json).domain[BEAM].floor[4]);
  });

  it('says why one that’s there isn’t drawn', () => {
    const fault = (change: (json: Json) => void, from: () => Json = () => copy(mcRadarFikorZ)) => {
      const json = from();
      change(json);
      const section = sectionOf(json, urlOf(mcRadarFikorZ as Json));
      expect(section.beamFloor).toBeNull();
      return section.beamFloorFault;
    };
    expect(fault(json => json.domain[BEAM].floor.pop())).toBe(`/domain/${BEAM}/floor has 256 values, and composite has 257 positions, so the lowest beam isn't drawn`);
    expect(fault(json => { json.domain[BEAM] = {}; })).toBe(`/domain/${BEAM}/floor isn't a list of heights, so the lowest beam isn't drawn`);
    expect(fault(json => { delete json.coverages[1].domain[BEAM]; }, twoTimes)).toBe(`/coverages/1 has no ${BEAM}, where the rest of the response has one, so the lowest beam isn't drawn`);
    expect(fault(json => { json.domain.referencing[2].system.cs.csAxes[0] = { name: { en: 'Elevation angle' }, direction: 'up', unit: { symbol: '°' } }; }))
      .toBe(`${BEAM}.floor is read as a height, and z here is an elevation angle, so the lowest beam isn't drawn`);
  });

  it('isn’t a note on the response: it’s a vendor’s member, and only the picture uses it', () => {
    const json = copy(mcRadarFikorZ);
    json.domain[BEAM].floor.pop();
    expect(sectionOf(json).notes.some(note => note.message.includes(BEAM))).toBe(false);
  });

  it('finds a later time’s height in the list where its tuple is, with the times in one coverage’s tuples', () => {
    const json = copy(mcRadarFikorZ);
    const { composite } = json.domain.axes;
    const floor: number[] = json.domain[BEAM].floor;
    composite.values = [...composite.values, ...composite.values.map(([, x, y]: unknown[]) => ['2026-11-06T23:10:00+00:00', x, y])];
    json.domain[BEAM].floor = [...floor, ...floor.map(height => height + 10)];
    json.ranges.DBZH.shape = [514, 39];
    json.ranges.DBZH.values = [...json.ranges.DBZH.values, ...json.ranges.DBZH.values];
    const { frames, beamFloor } = sectionOf(json, urlOf(mcRadarFikorZ as Json));
    expect(frames).toHaveLength(2);
    expect(beamFloor!.values[1][12]).toBe(floor[12] + 10);
    // Position 13 at the later time is tuple 270, not 13
    expect(beamFloor!.pathAt(1, 12)).toBe(`/domain/${BEAM}/floor/${257 + 12}`);
    expect(at(json, beamFloor!.pathAt(1, 12)!)).toBe(beamFloor!.values[1][12]);
  });

  it('keeps the first height a position is given at a time, as with the values', () => {
    const [a, b] = [copy(mcRadarFikorZ), copy(mcRadarFikorZ)];
    b.domain[BEAM].floor = b.domain[BEAM].floor.map((height: number) => height + 10);
    const coverage = (json: Json) => ({ type: 'Coverage', domain: json.domain, ranges: json.ranges });
    const json = { type: 'CoverageCollection', domainType: 'Section', parameters: a.parameters, coverages: [coverage(a), coverage(b)] };
    const { frames, beamFloor } = sectionOf(json, urlOf(mcRadarFikorZ as Json));
    expect(frames).toHaveLength(1);
    expect(beamFloor!.values[0][0]).toBe(790.3053048271686);
    expect(beamFloor!.pathAt(0, 0)).toBe(`/coverages/0/domain/${BEAM}/floor/0`);
  });
});

describe('toSection: one reading per response and request', () => {
  it('gives the same reading for the same response and URL, and reads again for another of either', () => {
    const json = copy(mcRadarFikorZ);
    const url = urlOf(json);
    const first = toSection(json, url);
    expect(toSection(json, url)).toBe(first);
    expect(toSection(copy(json), url)).not.toBe(first);
    const other = toSection(json, 'https://x/trajectory?coords=LINESTRING(20.5%2060.1,22.8%2060.2)&z=0,244.8978320025398');
    expect(other).not.toBe(first);
    expect(other).toMatchObject({ kind: 'section', colCount: 257 });
  });
});
