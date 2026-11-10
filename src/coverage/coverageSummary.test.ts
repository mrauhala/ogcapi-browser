import { describe, expect, it } from 'vitest';
import type { ValidationError } from '../types/api';
import { countText, describeTimes, formatValue, meanText, rangeText, stepRuns, summarizeCoverage } from './coverageSummary';
import fmiMultipoint from './__fixtures__/profiles/fmi-ecmwf-multipoint.json';
import mcIfs85t from './__fixtures__/profiles/mc-ifs-85t-2p.json';
import mcGfs from './__fixtures__/profiles/mc-gfs-1t-all.json';
import mcIfsZunsorted from './__fixtures__/profiles/mc-ifs-zunsorted.json';
import mcIfs1tAll from './__fixtures__/profiles/mc-ifs-1t-all.json';
import polytopeArea from './__fixtures__/polytope-op-multipoint-area.json';
import fmiEcFrames from './__fixtures__/sections/fmi-ec-frames.json';
import fmiMultilinestring from './__fixtures__/sections/fmi-multilinestring.json';
import mcIfsLsz from './__fixtures__/sections/mc-ifs-lsz.json';
import mcIfsBadlevel from './__fixtures__/sections/mc-ifs-badlevel.json';
import mcMepsClosed from './__fixtures__/sections/mc-meps-closed.json';
import mcRadarFikorZ from './__fixtures__/sections/mc-radar-fikor-z.json';
import mcSingleNoz from './__fixtures__/sections/mc-single-noz.json';
import fmiTrajectoryOnePlace from './__fixtures__/profiles/fmi-trajectory-one-place.json';
import { COVJSON, EDR, METOCEAN_COMMON_DRAFT } from '../standards';
import { counting } from './cellsTestData';

const hours = (from: number, count: number, step = 1) => Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 10, 5, from + i * step)).toISOString().replace('.000', ''));
const axes = (t: string[], x = 10, y = 50) => ({ x: { values: [x] }, y: { values: [y] }, t: { values: t } });
const range = (values: unknown[]) => ({ type: 'NdArray', dataType: 'float', axisNames: ['t'], shape: [values.length], values });
const temperature = { type: 'Parameter', unit: { symbol: { value: 'K' } }, observedProperty: { label: { en: 'Air temperature' } } };
const FITS: ValidationError = { message: "Every parameter's values fit its shape and axes", path: '/ranges', severity: 'pass', rule: COVJSON.rangesFitDomain };
// The notes besides what passed
const noted = (notes: ValidationError[]) => notes.filter(note => note.severity !== 'pass');

const TIME_REFERENCE = [{ coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'Gregorian' } }];

// As MeteoCore sends a position
const point = (values: unknown[], t: string[] = hours(0, values.length)) => ({
  type: 'Coverage',
  domain: { type: 'Domain', domainType: 'PointSeries', axes: axes(t), referencing: TIME_REFERENCE },
  parameters: { t2m: temperature },
  ranges: { t2m: range(values) },
});

// As it sends several: the parameters are the collection's, and each coverage is a place
const several = (t: string[], ...lines: unknown[][]) => ({
  type: 'CoverageCollection',
  domainType: 'PointSeries',
  parameters: { t2m: temperature },
  coverages: lines.map((values, i) => ({ type: 'Coverage', domain: { domainType: 'PointSeries', axes: axes(t, 10 + i, 50 + i), referencing: TIME_REFERENCE }, ranges: { t2m: range(values) } })),
});

describe('summarizeCoverage', () => {
  it('is only for CoverageJSON', () => {
    for (const json of [null, 'x', 1, [], {}, { type: 'FeatureCollection' }, { type: 'CoverageCollection' }]) {
      expect(summarizeCoverage(json)).toBeNull();
    }
  });

  describe('a time series at a point', () => {
    const summary = summarizeCoverage(point([270, 271, 275.5]))!;

    it('says what it is', () => {
      expect(summary.domainType).toBe('PointSeries');
      expect(summary.shape).toBe('1 point, 3 times, 1 parameter');
      expect(summary.timeText).toBe('Hourly, Nov 5 00:00 to Nov 5 02:00.');
    });

    it('gives the figures', () => {
      expect(summary.parameters[0]).toMatchObject({ id: 't2m', label: 'Air temperature', unit: 'K', count: 3, nulls: 0, min: 270, max: 275.5 });
      expect(summary.parameters[0].mean).toBeCloseTo(272.1667, 3);
    });

    it('holds the series', () => {
      expect(summary.series!.times).toEqual([Date.UTC(2026, 10, 5, 0), Date.UTC(2026, 10, 5, 1), Date.UTC(2026, 10, 5, 2)]);
      expect(summary.series!.rawTimes[0]).toBe('2026-11-05T00:00:00Z');
      expect(summary.series!.parameters[0].series).toEqual([[270, 271, 275.5]]);
    });

    it('has nothing to note, and passes its values and times', () => {
      expect(noted(summary.notes)).toEqual([]);
      expect(summary.notes.map(note => note.message)).toEqual([
        FITS.message,
        't has a temporal reference system: TemporalRS, calendar Gregorian',
        'Every time is in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z, like 2026-11-05T00:00:00Z',
      ]);
    });
  });

  it('counts more than one', () => {
    const json = { ...point([1, 2]), parameters: { t2m: temperature, b: temperature }, ranges: { t2m: range([1, 2]), b: range([1, 2]) } };
    expect(summarizeCoverage(json)!.shape).toBe('1 point, 2 times, 2 parameters');
  });

  it("calls a polygon's series what it is, as DWD sends them", () => {
    const summary = summarizeCoverage({
      type: 'Coverage',
      domain: { domainType: 'MultiPolygonSeries', axes: { composite: { values: [[[[0, 0]]]] }, t: { values: hours(0, 2) } } },
      ranges: { a: range([1, 2]) },
    })!;
    expect(summary.shape).toBe('1 polygon, 2 times, 1 parameter');
    expect(summary.series!.locations).toEqual(['Location 1']);
  });

  it('reads a time as pygeoapi writes it', () => {
    const t = ['2026-10-30T04:00:00.000000000', '2026-10-30T05:00:00.000000000'];
    expect(summarizeCoverage(point([1, 2], t))!.series!.times).toEqual([Date.UTC(2026, 9, 30, 4), Date.UTC(2026, 9, 30, 5)]);
  });

  it('reads a time as MeteoCore writes it', () => {
    expect(summarizeCoverage(point([1], ['2026-11-05T12:00:00+00:00']))!.series!.times).toEqual([Date.UTC(2026, 10, 5, 12)]);
  });

  it('reads a label or unit that isn’t text as none, rather than break', () => {
    // As a response can send them, whatever the types say
    const json = { ...point([1, 2]), parameters: { t2m: { ...temperature, unit: { symbol: { value: 1 } }, observedProperty: { label: { en: 123 } } } } };
    expect(summarizeCoverage(json)!.parameters[0]).toMatchObject({ id: 't2m', label: null, unit: '' });
  });

  it('has no second name when it would only repeat the id', () => {
    const json = point([1, 2]);
    json.parameters.t2m = { ...temperature, observedProperty: { label: { en: 't2m' } } };
    expect(summarizeCoverage(json)!.parameters[0].label).toBeNull();
    // As FMI's WindSpeedMS does windspeedms
    json.parameters.t2m = { ...temperature, observedProperty: { label: { en: 'T2M' } } };
    expect(summarizeCoverage(json)!.parameters[0].label).toBeNull();
  });

  it('has no unit where UCUM says there is none', () => {
    const json = point([1, 2]);
    json.parameters.t2m = { ...temperature, unit: { symbol: { value: '1' } } };
    expect(summarizeCoverage(json)!.parameters[0].unit).toBe('');
  });

  it('reads a single time', () => {
    const summary = summarizeCoverage(point([10.5]))!;
    expect(summary.shape).toBe('1 point, 1 time, 1 parameter');
    expect(summary.timeText).toBe('At Nov 5 00:00.');
    expect(summary.series!.times).toHaveLength(1);
  });

  describe('time steps', () => {
    const uneven = [...hours(0, 3), ...hours(5, 2, 3)];

    it('names each and says when it changes', () => {
      const summary = summarizeCoverage(point([1, 2, 3, 4, 5], uneven))!;
      expect(summary.timeText).toBe('Hourly to Nov 5 02:00, then 3-hourly.');
      expect(summary.series!.stepChanges).toEqual([{ at: Date.UTC(2026, 10, 5, 2), label: '3 h' }]);
    });

    it('points inside the first location that has that time', () => {
      const json = several(uneven, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
      expect(noted(summarizeCoverage(json)!.notes)[0].path).toBe('/coverages/0/domain/axes/t/values/2');
    });

    it('notes the change, pointing at the time it happens', () => {
      const { notes } = summarizeCoverage(point([1, 2, 3, 4, 5], uneven))!;
      expect(noted(notes)).toEqual([{ message: 'Time step changes from 1 h to 3 h at Nov 5 02:00', path: '/domain/axes/t/values/2', severity: 'info' }]);
    });

    it('stops naming them when there are too many', () => {
      const t = [0, 1, 3, 4, 7, 8, 12].map(h => new Date(Date.UTC(2026, 10, 5, h)).toISOString());
      const summary = summarizeCoverage(point([1, 2, 3, 4, 5, 6, 7], t))!;
      expect(summary.timeText).toBe('Irregular steps, Nov 5 00:00 to Nov 5 12:00.');
      expect(summary.series!.stepChanges).toEqual([]);
      expect(noted(summary.notes)).toHaveLength(1);
      expect(noted(summary.notes)[0]).toMatchObject({ message: 'Time step changes 5 times, first at Nov 5 01:00', path: '/domain/axes/t/values/1' });
    });
  });

  describe('nulls', () => {
    it('notes one, where it is', () => {
      const { notes, parameters } = summarizeCoverage(point([1, null, 3]))!;
      expect(parameters[0]).toMatchObject({ count: 3, nulls: 1, min: 1, max: 3, mean: 2 });
      expect(noted(notes)).toEqual([{ message: '1 null in t2m, at Nov 5 01:00', path: '/ranges/t2m/values/1', severity: 'info' }]);
    });

    it('notes several by the first', () => {
      expect(noted(summarizeCoverage(point([1, null, null]))!.notes)[0]).toMatchObject({ message: '2 nulls in t2m, first at Nov 5 01:00', path: '/ranges/t2m/values/1' });
    });

    it('notes all of them differently', () => {
      const summary = summarizeCoverage(point([null, null]))!;
      expect(noted(summary.notes)[0]).toMatchObject({ message: 'All 2 values of t2m are null', path: '/ranges/t2m/values/0' });
      expect(summary.parameters[0]).toMatchObject({ min: null, max: null, mean: null });
    });

    it('keeps them as gaps in the series', () => {
      expect(summarizeCoverage(point([1, null, 3]))!.series!.parameters[0].series).toEqual([[1, null, 3]]);
    });

    it('makes a pointer of any id', () => {
      const json = point([null, 1]);
      json.ranges = { 'a/b~c': json.ranges.t2m } as unknown as typeof json.ranges;
      expect(noted(summarizeCoverage(json)!.notes)[0].path).toBe('/ranges/a~1b~0c/values/0');
    });
  });

  describe('values that are not numbers', () => {
    const summary = summarizeCoverage(point(['a', 'b', 3]))!;

    it('counts them apart', () => {
      expect(summary.parameters[0]).toMatchObject({ count: 3, others: 2, numbers: 1, nulls: 0, min: 3, max: 3 });
    });

    it('leaves them out of the line, and keeps them for the table', () => {
      expect(summary.series!.parameters[0].series).toEqual([[null, null, 3]]);
      expect(summary.series!.parameters[0].raw).toEqual([['a', 'b', 3]]);
    });

    it("doesn't take infinity for a number", () => {
      expect(summarizeCoverage(point([Infinity, 1]))!.parameters[0]).toMatchObject({ others: 1, min: 1 });
    });
  });

  describe('several locations', () => {
    const t = hours(0, 3);
    const summary = summarizeCoverage(several(t, [1, 2, 3], [4, null, 6], [7, 8, 9]))!;

    it('counts the points, not the coverages, and takes the parameters from the collection', () => {
      expect(summary.shape).toBe('3 points, 3 times, 1 parameter');
      expect(summary.domainType).toBe('PointSeries');
      expect(summary.parameters[0]).toMatchObject({ label: 'Air temperature', unit: 'K' });
    });

    it('figures over all of them', () => {
      expect(summary.parameters[0]).toMatchObject({ count: 9, nulls: 1, min: 1, max: 9 });
      expect(summary.parameters[0].mean).toBe(5);
    });

    it('holds a line for each', () => {
      expect(summary.series!.locations).toEqual(['10, 50', '11, 51', '12, 52']);
      expect(summary.series!.parameters[0].series).toEqual([[1, 2, 3], [4, null, 6], [7, 8, 9]]);
    });

    it('says which one a note is about, and points inside it', () => {
      expect(noted(summary.notes)[0]).toMatchObject({ message: '1 null in t2m, at Nov 5 01:00 (11, 51)', path: '/coverages/1/ranges/t2m/values/1' });
    });

    it('lines times up when the locations have different ones', () => {
      const json = several(t, [1, 2, 3], [4, 5, 6]);
      json.coverages[1].domain.axes.t.values = hours(2, 3);
      const { series } = summarizeCoverage(json)!;
      expect(series!.times).toHaveLength(5);
      expect(series!.parameters[0].series).toEqual([[1, 2, 3, null, null], [null, null, 4, 5, 6]]);
    });

    it('puts times in order, whichever location has them', () => {
      const json = several(t, [1, 2, 3], [4, 5, 6]);
      json.coverages[0].domain.axes.t.values = hours(2, 3);
      json.coverages[1].domain.axes.t.values = hours(0, 3);
      const { series } = summarizeCoverage(json)!;
      expect(series!.times).toEqual([...series!.times].sort((a, b) => a - b));
      expect(series!.parameters[0].series).toEqual([[null, null, 1, 2, 3], [4, 5, 6, null, null]]);
    });

    it("takes the collection's domain type when the coverages don't say", () => {
      const json = several(t, [1, 2, 3]) as unknown as { coverages: { domain: { domainType?: string } }[] };
      delete json.coverages[0].domain.domainType;
      expect(summarizeCoverage(json)!.domainType).toBe('PointSeries');
    });

    it("prefers a coverage's own parameters", () => {
      const json = several(t, [1, 2, 3]) as { coverages: Record<string, unknown>[] };
      json.coverages[0].parameters = { t2m: { unit: { symbol: 'C' } } };
      expect(summarizeCoverage(json)!.parameters[0].unit).toBe('C');
    });

    it('takes a domain type from the coverages over the collection, and notices a mix', () => {
      const json = several(t, [1, 2, 3], [1, 2, 3]);
      json.coverages[1].domain.domainType = 'Grid';
      expect(summarizeCoverage(json)!.domainType).toBe('Mixed');
    });

    it('has nothing to show of an empty collection', () => {
      const empty = summarizeCoverage({ type: 'CoverageCollection', coverages: [] })!;
      expect(empty.series).toBeNull();
      expect(empty.shape).toBe('0 coverages, 0 parameters');
    });
  });

  describe('a grid', () => {
    const values = (start: number, count: number, step: number) => Array.from({ length: count }, (_, i) => start + i * step);
    // As MeteoCore sends an area: no time at all
    const cells = [1, null, 3, 4, ...new Array(252).fill(2)];
    const grid = {
      type: 'Coverage',
      domain: {
        domainType: 'Grid',
        axes: { x: { values: values(24.03125, 16, 0.0625) }, y: { values: values(60.96875, 16, -0.0625) } },
        referencing: [{ coordinates: ['x', 'y'], system: { type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } }],
      },
      parameters: { t2m: temperature },
      ranges: { t2m: { type: 'NdArray', dataType: 'float', axisNames: ['y', 'x'], shape: [16, 16], values: cells } },
    };
    const summary = summarizeCoverage(grid)!;

    it('says its size and spacing', () => {
      expect(summary.domainType).toBe('Grid');
      expect(summary.shape).toBe('16 × 16 cells, every 0.0625°, 1 parameter');
      expect(summary.timeText).toBeNull();
    });

    it('says where it is, in the order it runs', () => {
      expect(summary.axes).toEqual(['x 24.03125 to 24.96875', 'y 60.96875 to 60.03125']);
    });

    it('has figures but no series', () => {
      expect(summary.series).toBeNull();
      expect(summary.parameters[0]).toMatchObject({ count: 256, nulls: 1, min: 1, max: 4 });
    });

    it('notes nulls without a time', () => {
      expect(summary.notes).toEqual([FITS, { message: '1 null in t2m', path: '/ranges/t2m/values/1', severity: 'info' }]);
    });

    it('gives no degrees without a coordinate system that has them', () => {
      expect(summarizeCoverage({ ...grid, domain: { ...grid.domain, referencing: [] } })!.shape).toContain('every 0.0625,');
      expect(summarizeCoverage({ ...grid, domain: { ...grid.domain, referencing: [{ system: { id: 'http://www.opengis.net/def/crs/EPSG/0/3857' } }] } })!.shape).toContain('every 0.0625,');
      expect(summarizeCoverage({ ...grid, domain: { ...grid.domain, referencing: [{ system: { id: 'EPSG:4326' } }] } })!.shape).toContain('every 0.0625°');
      expect(summarizeCoverage({ ...grid, domain: { ...grid.domain, referencing: [{ system: { type: 'GeographicCRS' } }] } })!.shape).toContain('every 0.0625°');
    });

    it('reads an axis written as start, stop and num', () => {
      const regular = { ...grid, domain: { domainType: 'Grid', axes: { x: { start: 0, stop: 10, num: 11 }, y: { start: 5, stop: 0, num: 21 } } } };
      const { shape, axes: spans } = summarizeCoverage(regular)!;
      expect(shape).toBe('11 × 21 cells, every 1 × 0.25, 1 parameter');
      expect(spans).toEqual(['x 0 to 10', 'y 5 to 0']);
    });

    it('counts no axis whose num can’t be a count, and says it can’t be read', () => {
      const withAxes = (axes: Record<string, unknown>) => summarizeCoverage({ ...grid, domain: { domainType: 'Grid', axes } })!.shape;
      expect(withAxes({ x: { start: 0, stop: 10, num: 2.5 }, y: { start: 5, stop: 0, num: 21 } })).toBe("x can't be read, 1 parameter");
      expect(withAxes({ x: { start: 0, stop: 10, num: 11 }, y: { start: 5, stop: 0, num: 2 ** 32 } })).toBe("y can't be read, 1 parameter");
      expect(withAxes({ x: { start: 0, stop: 10, num: 0 }, y: { start: 5, stop: 0, num: -1 } })).toBe("x and y can't be read, 1 parameter");
      expect(withAxes({ x: { start: 0, stop: 10, num: 11 }, y: { start: 5, stop: 0, num: 21 }, z: { start: 1, stop: 3, num: 2.5 } }))
        .toBe("11 × 21 cells, every 1 × 0.25, z can't be read, 1 parameter");
      expect(withAxes({ x: { start: 0, stop: 10, num: 11 }, y: { start: 5, stop: 0, num: 21 }, t: { start: 0, stop: 1, num: 1.5 } }))
        .toBe("11 × 21 cells, every 1 × 0.25, t can't be read, 1 parameter");
      expect(withAxes({ x: { start: 0, stop: 10, num: 11 }, y: { start: 5, stop: 0, num: 21 }, z: { values: [1, 2, 3] } })).toBe('11 × 21 cells, every 1 × 0.25, 3 levels, 1 parameter');
    });

    it('gives every axis but time a line, x, y and z first, and lists one of names', () => {
      const withAxes = (axes: Record<string, unknown>) => summarizeCoverage({ ...grid, domain: { domainType: 'Grid', axes } })!.axes;
      expect(withAxes({ member: { values: [0, 1] }, x: { values: [1, 2] }, y: { values: [5, 6] }, t: { values: ['2026-11-08T00:00:00Z'] }, z: { values: [850] } }))
        .toEqual(['x 1 to 2', 'y 5 to 6', 'z 850', 'member 0 to 1']);
      expect(withAxes({ x: { values: [1, 2] }, y: { values: [5, 6] }, country: { values: ['de', 'gb'] } })).toEqual(['x 1 to 2', 'y 5 to 6', 'country de, gb']);
      expect(withAxes({ x: { values: [1, 2] }, y: { values: [5, 6] }, country: { values: ['de', 'gb', 'fi', 'se', 'no', 'dk'] } }))
        .toEqual(['x 1 to 2', 'y 5 to 6', 'country de, gb, fi, se and 2 more']);
      expect(withAxes({ x: { values: [1, 2] }, y: { values: [5, 6] }, country: { values: ['de', 'gb', 'fi', 'se'] } })).toEqual(['x 1 to 2', 'y 5 to 6', 'country de, gb, fi, se']);
      expect(withAxes({ x: { values: [1, 2] }, y: { values: [5, 6] }, mixed: { values: ['de', 2] }, composite: { values: [[1, 2]] } })).toEqual(['x 1 to 2', 'y 5 to 6']);
    });

    it('leaves the spacing out when it varies', () => {
      const uneven = { ...grid, domain: { domainType: 'Grid', axes: { x: { values: [0, 1, 3] }, y: { values: [0, 1, 2] } } } };
      expect(summarizeCoverage(uneven)!.shape).toBe('3 × 3 cells, 1 parameter');
    });

    it('adds levels and times, and describes the times', () => {
      const cube = { ...grid, domain: { domainType: 'Grid', axes: { x: { values: [0, 1] }, y: { values: [0, 1] }, z: { values: [850, 500] }, t: { values: hours(0, 2) } } } };
      const result = summarizeCoverage(cube)!;
      expect(result.shape).toBe('2 × 2 cells, every 1, 2 levels, 2 times, 1 parameter');
      expect(result.timeText).toBe('Hourly, Nov 5 00:00 to Nov 5 01:00.');
    });

    it('writes large sizes so they can be read', () => {
      const big = { ...grid, domain: { domainType: 'Grid', axes: { x: { start: 0, stop: 1, num: 1200 }, y: { start: 0, stop: 1, num: 900 } } } };
      expect(summarizeCoverage(big)!.shape).toContain('1,200 × 900 cells');
    });

    it('has one shape to describe only with one coverage', () => {
      const result = summarizeCoverage({ type: 'CoverageCollection', coverages: [grid, grid] })!;
      expect(result.shape).toBe('2 coverages, 1 parameter');
      expect(result.axes).toEqual([]);
      expect(result.parameters[0].count).toBe(512);
      expect(noted(result.notes)[0].path).toBe('/coverages/0/ranges/t2m/values/1');
    });
  });

  describe('other shapes', () => {
    it('describes a point with no time', () => {
      const summary = summarizeCoverage({ type: 'Coverage', domain: { domainType: 'Point', axes: { x: { values: [1] }, y: { values: [2] } } }, ranges: { a: range([1]) } })!;
      expect(summary.series).toBeNull();
      expect(summary.shape).toBe('1 point, 1 parameter');
      expect(summary.axes).toEqual(['x 1', 'y 2']);
    });

    it('describes a trajectory', () => {
      const summary = summarizeCoverage({ type: 'Coverage', domain: { domainType: 'Trajectory', axes: { composite: { values: [[0, 1], [1, 2]] } } }, ranges: { a: range([1, 2]) } })!;
      expect(summary.domainType).toBe('Trajectory');
      expect(summary.shape).toBe('2 positions, 1 parameter');
    });

    it('describes a line along one axis', () => {
      const summary = summarizeCoverage({ type: 'Coverage', domain: { axes: { x: { values: [1, 2, 3] }, y: { values: [2] } } }, ranges: { a: range([1, 2, 3]) } })!;
      expect(summary.domainType).toBe('Coverage');
      expect(summary.shape).toBe('3 positions, 1 parameter');
    });

    it('says when a range is only a link', () => {
      const summary = summarizeCoverage({ type: 'Coverage', domain: { axes: { x: { values: [1, 2] }, y: { values: [1, 2] } } }, ranges: { a: 'https://example.com/a.json', b: { type: 'TiledNdArray' } } })!;
      expect(summary.parameters.map(p => p.notIncluded)).toEqual([true, true]);
      expect(countText(summary.parameters[0])).toBe("Values aren't in this response");
    });

    it('has no series when a time cannot be read', () => {
      expect(summarizeCoverage(point([1, 2], ['soon', 'later']))!.series).toBeNull();
    });
  });

  it.each([
    [{ type: 'Coverage' }],
    [{ type: 'Coverage', domain: 1, ranges: 'x', parameters: [] }],
    [{ type: 'Coverage', domain: { axes: null }, ranges: { a: null, b: 1, c: { values: 'x' } } }],
    [{ type: 'Coverage', domain: { axes: { t: { values: 'x' }, x: 1 } }, ranges: {} }],
    [{ type: 'Coverage', domain: { axes: { x: { values: [] }, y: { values: ['a'] } }, referencing: [null, 1, {}] }, ranges: {} }],
    [{ type: 'CoverageCollection', coverages: [null, 1, 'x', {}] }],
  ])('survives a malformed %j', json => {
    expect(summarizeCoverage(json)).toMatchObject({ series: null });
  });
});

describe('stepRuns', () => {
  it('finds stretches of the same step', () => {
    expect(stepRuns([0, 1, 2, 5, 8, 9])).toEqual([
      { step: 1, from: 0, to: 2 },
      { step: 3, from: 2, to: 8 },
      { step: 1, from: 8, to: 9 },
    ]);
  });

  it('has none with fewer than two', () => {
    expect(stepRuns([])).toEqual([]);
    expect(stepRuns([1])).toEqual([]);
  });
});

describe('describeTimes', () => {
  const MINUTE = 60000;
  const from = Date.UTC(2026, 10, 5);
  const every = (step: number) => [from, from + step];

  it('has nothing to say of no times', () => {
    expect(describeTimes([])).toBeNull();
  });

  it.each([
    [MINUTE, 'Every minute'],
    [MINUTE * 15, 'Every 15 min'],
    [MINUTE * 60, 'Hourly'],
    [MINUTE * 360, '6-hourly'],
    [MINUTE * 1440, 'Daily'],
    [MINUTE * 2880, 'Every 2 days'],
    [30000, 'Every 30 s'],
  ])('names a step of %d ms', (step, name) => {
    expect(describeTimes(every(step))).toMatch(new RegExp(`^${name}, Nov 5 00:00 to `));
  });

  it('names three stretches, and says where each ends but the last', () => {
    const h = 60 * MINUTE;
    expect(describeTimes([from, from + h, from + 4 * h, from + 7 * h, from + 13 * h])).toBe('Hourly to Nov 5 01:00, then 3-hourly to Nov 5 07:00, then 6-hourly.');
  });
});

describe('the words beside a parameter', () => {
  const figures = { id: 'a', label: null, unit: 'K', count: 3, nulls: 0, others: 0, numbers: 3, min: 1.5, max: 3, mean: 2.25, notIncluded: false };

  it('gives the range with its unit', () => {
    expect(rangeText(figures)).toBe('1.5 to 3 K');
    expect(rangeText({ ...figures, unit: '' })).toBe('1.5 to 3');
  });

  it('gives a single value once', () => {
    expect(rangeText({ ...figures, min: 3, max: 3 })).toBe('3 K');
    expect(meanText({ ...figures, min: 3, max: 3, mean: 3 })).toBeNull();
  });

  it('has none without numbers', () => {
    expect(rangeText({ ...figures, min: null, max: null })).toBeNull();
    expect(meanText({ ...figures, min: null, max: null, mean: null })).toBeNull();
  });

  it('gives the mean', () => {
    expect(meanText(figures)).toBe('mean 2.25');
  });

  it('counts, with what is odd', () => {
    expect(countText(figures)).toBe('3 values, 0 null');
    expect(countText({ ...figures, count: 11264, nulls: 1200 })).toBe('11,264 values, 1,200 null');
    expect(countText({ ...figures, others: 2 })).toBe('3 values, 0 null, 2 not a number');
    expect(countText({ ...figures, count: 1 })).toBe('1 value, 0 null');
  });

  it("shortens a value's digits, not its size", () => {
    expect(formatValue(268.7255147799975)).toBe('268.726');
    expect(formatValue(101325.4)).toBe('101325');
    expect(formatValue(1010.56)).toBe('1010.56');
    expect(formatValue(0.000123456789)).toBe('0.000123457');
    expect(formatValue(1234567)).toBe('1234570');
    expect(formatValue(0)).toBe('0');
  });
});

describe('summarizeCoverage: levels at a point or a few', () => {
  it('counts FMI’s one-value coverages as 2 points at 3 levels, not 6 points', () => {
    const summary = summarizeCoverage(fmiMultipoint)!;
    expect(summary.shape).toBe('2 points, 3 levels, 1 time, 2 parameters');
    expect(summary.profile?.locations).toHaveLength(2);
  });

  it('counts 85 coverages as one point over 85 times, and describes the times', () => {
    const summary = summarizeCoverage(mcIfs85t)!;
    expect(summary.shape).toBe('1 point, 14 levels, 85 times, 1 parameter');
    expect(summary.timeText).toBe('3-hourly to Nov 12 12:00, then 6-hourly.');
  });

  it('names the level of the first null, in place of the note without it', () => {
    const { notes } = summarizeCoverage(mcGfs)!;
    expect(notes.map(note => note.message)).toContain('11 nulls in TCDC, first at 1 hPa');
    expect(notes.filter(note => /nulls? in TCDC/.test(note.message))).toHaveLength(1);
  });

  it('passes the request and the collection’s levels on, for the levels that should be there', () => {
    const { notes, profile } = summarizeCoverage(mcIfsZunsorted, { url: 'x?f=CoverageJSON', vertical: { values: [1000, 925, 850, 500] } })!;
    expect(profile?.missing).toEqual([925]);
    expect(notes.map(note => note.message)).toContain("Level 925 hPa is in the collection's extent, and isn't in the response");
  });

  it('keeps one coverage’s own words for its shape, which a grid’s cells say better', () => {
    const grid = {
      type: 'Coverage',
      domain: { type: 'Domain', domainType: 'Grid', axes: { x: { values: [1, 2] }, y: { values: [5, 6] }, z: { values: [1000, 850] } } },
      ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['z', 'y', 'x'], shape: [2, 2, 2], values: [1, 2, 3, 4, 5, 6, 7, null] } },
    };
    const summary = summarizeCoverage(grid)!;
    expect(summary.shape).toBe('2 × 2 cells, every 1, 2 levels, 1 parameter');
    expect(summary.profile?.locations).toHaveLength(4);
    expect(summary.notes.map(note => note.message)).toContain('1 null in a, at 850 (2, 6)');
  });

  it('has no profile, and the notes it had, where there are no levels', () => {
    const summary = summarizeCoverage(point([1, null, 3]))!;
    expect(summary.profile).toBeNull();
    expect(noted(summary.notes).map(note => note.message)).toEqual(['1 null in t2m, at Nov 5 01:00']);
  });
});

describe('summarizeCoverage: the times', () => {
  it('checks them against the datetime asked for and the collection’s extent', () => {
    const json = point([1, 2, 3]);
    const temporal = { interval: [['2026-11-05T01:00:00Z', null]] };
    const notes = summarizeCoverage(json, { url: 'https://x/collections/a/position?datetime=2026-11-05T00:00:00Z/2026-11-05T02:00:00Z', temporal })!.notes;
    expect(notes).toContainEqual({ message: 'Every time is inside the datetime asked for, 2026-11-05T00:00:00Z/2026-11-05T02:00:00Z', path: '/domain/axes/t/values/0', severity: 'pass', rule: EDR.datetimeResponse });
    // The extent SHALL include every temporal geometry in the collection
    expect(notes).toContainEqual({ message: "t 2026-11-05T00:00:00Z is outside the collection's extent, from 2026-11-05T01:00:00Z", path: '/domain/axes/t/values/0', severity: 'error', source: 'collection', rule: EDR.extent });
  });
});

describe('summarizeCoverage: every range against its domain', () => {
  // Of the ranges: the times have checks of their own
  const errors = (json: unknown) => summarizeCoverage(json)!.notes.filter(note => note.severity === 'error' && /\/ranges\b/.test(note.path ?? ''));
  const passes = (json: unknown) => summarizeCoverage(json)!.notes.filter(note => note.message === FITS.message);
  const t = hours(0, 3);

  it('passes once what fits, at the ranges of the first coverage', () => {
    expect(passes(mcIfs1tAll)).toEqual([{ ...FITS, path: '/coverages/0/ranges' }]);
    expect(errors(mcIfs1tAll)).toEqual([]);
  });

  it('makes an error of values that don’t fit, where they are, and passes nothing', () => {
    const json = JSON.parse(JSON.stringify(mcIfs1tAll));
    json.coverages[0].ranges.t.values.pop();
    expect(errors(json)).toEqual([{ message: 't: shape 14 makes 14 values, and values has 13', path: '/coverages/0/ranges/t/values', severity: 'error', rule: COVJSON.shapeProduct }]);
    expect(passes(json)).toEqual([]);
  });

  it('makes an error of Polytope’s axisNames, which name the parameter and not an axis', () => {
    expect(errors(polytopeArea)).toEqual([{ message: `2t: axisNames has "2t", which isn't an axis of the domain`, path: '/coverages/0/ranges/2t/axisNames', severity: 'error', rule: COVJSON.rangesFitDomain }]);
  });

  it('says a fault the coverages share once, where it first is, and how many more have it', () => {
    const json = several(t, [1, 2, 3], [4, 5, 6], [7, 8, 9]);
    for (const coverage of json.coverages.slice(1)) coverage.ranges.t2m.axisNames = ['z'];
    expect(errors(json)).toEqual([{ message: `t2m: axisNames has "z", which isn't an axis of the domain, and likewise in 1 more coverage`, path: '/coverages/1/ranges/t2m/axisNames', severity: 'error', rule: COVJSON.rangesFitDomain }]);
    json.coverages[0].ranges.t2m.axisNames = ['z'];
    expect(errors(json)[0].message).toMatch(/, and likewise in 2 more coverages$/);
    expect(errors(json)[0].path).toBe('/coverages/0/ranges/t2m/axisNames');
  });

  it('says different faults apart, of one parameter or of two', () => {
    const json = several(t, [1, 2, 3], [4, 5, 6]);
    json.coverages[0].ranges.t2m.axisNames = ['z'];
    json.coverages[1].ranges.t2m.shape = [4];
    expect(errors(json).map(note => note.path)).toEqual(['/coverages/0/ranges/t2m/axisNames', '/coverages/1/ranges/t2m/values']);
    const two = point([1, 2, 3]) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    two.ranges = { a: { ...range([1, 2]), shape: [3] }, b: { ...range([1, 2]), shape: [3] } };
    expect(errors(two).map(note => note.path)).toEqual(['/ranges/a/values', '/ranges/b/values']);
  });

  it('makes a pointer of any id', () => {
    const json = point([1, 2, 3]) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    json.ranges = { 'a/b~c': { ...range([1, 2, 3]), axisNames: ['z'] } };
    expect(errors(json)[0].path).toBe('/ranges/a~1b~0c/axisNames');
  });

  it('passes nothing where it couldn’t check every range', () => {
    const axes = { x: { values: [1] }, y: { values: [2] }, z: { values: [1, 2] } };
    const fits = { axisNames: ['z'], shape: [2], values: [1, 2] };
    expect(passes({ type: 'Coverage', domain: { axes } })).toEqual([]);
    expect(passes({ type: 'Coverage', domain: { axes }, ranges: {} })).toEqual([]);
    expect(passes({ type: 'Coverage', domain: { axes }, ranges: { a: fits, b: 'https://example.org/b.json' } })).toEqual([]);
    expect(passes({ type: 'Coverage', domain: { axes }, ranges: { a: fits, b: { type: 'TiledNdArray', axisNames: ['z'], shape: [2], tileSets: [] } } })).toEqual([]);
    expect(passes({ type: 'Coverage', domain: 'https://example.org/domain.json', ranges: { a: fits } })).toEqual([]);
    expect(passes({ type: 'Coverage', domain: { axes }, ranges: { a: fits } })).toEqual([FITS]);
  });

  it('still finds a fault in a range it can check beside one it can’t', () => {
    const axes = { x: { values: [1] }, y: { values: [2] }, z: { values: [1, 2] } };
    const json = { type: 'Coverage', domain: { axes }, ranges: { a: { axisNames: ['t'], shape: [2], values: [1, 2] }, b: 'https://example.org/b.json' } };
    expect(errors(json).map(note => note.path)).toEqual(['/ranges/a/axisNames']);
  });

  it('checks a TiledNdArray’s names and shape, which it has without values', () => {
    const axes = { x: { values: [1, 2] }, y: { values: [2] } };
    const tiled = { type: 'TiledNdArray', axisNames: ['x'], shape: [3], tileSets: [] };
    expect(errors({ type: 'Coverage', domain: { axes }, ranges: { a: tiled } })).toEqual([{ message: 'a: shape says x has 3 values, and the axis has 2', path: '/ranges/a/shape', severity: 'error', rule: COVJSON.rangesFitDomain }]);
  });
});

describe('summarizeCoverage: what it says of the parameters', () => {
  it('adds the parameters’ findings to its notes', () => {
    const notes = summarizeCoverage(mcIfs1tAll)!.notes.filter(note => /unit type/.test(note.message));
    expect(notes).toEqual([expect.objectContaining({ severity: 'info', path: '/parameters/r/unit/symbol/type', rule: [COVJSON.unit, COVJSON.customValue, METOCEAN_COMMON_DRAFT.qudtUnits] })]);
    expect(notes[0].message).toMatch(/^r's unit type is https:\/\/qudt\.org\/vocab\/unit\/PERCENT, and likewise for 2 more parameters\. /);
  });
});

describe('summarizeCoverage: axes in order', () => {
  const gridOf = (axes: Record<string, unknown>) => ({
    type: 'Coverage',
    domain: { domainType: 'Grid', axes, referencing: [{ coordinates: ['x', 'y'], system: { type: 'GeographicCRS' } }] },
    parameters: { a: { type: 'Parameter', unit: { symbol: 'K' } } },
    ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['y', 'x'], shape: [2, 3], values: [1, 2, 3, 4, 5, 6] } },
  });
  const orderOf = (json: unknown) => summarizeCoverage(json)!.notes.filter(note => /isn't in order/.test(note.message));

  it('makes an error of x or y that turns back, at the value where it does, with its rule', () => {
    expect(orderOf(gridOf({ x: { values: [1, 3, 2] }, y: { values: [60, 61] } }))).toEqual([
      { message: "x isn't in order: 2 comes after 3", path: '/domain/axes/x/values/2', severity: 'error', rule: COVJSON.monotonic },
    ]);
    expect(orderOf(gridOf({ x: { values: [1, 2, 3] }, y: { values: [61, 60, 62] } }))[0]).toMatchObject({ message: "y isn't in order: 62 comes after 60", path: '/domain/axes/y/values/2' });
  });

  it('takes an axis that falls all the way, or stays a step, as in order', () => {
    expect(orderOf(gridOf({ x: { values: [3, 2, 1] }, y: { values: [61, 60] } }))).toEqual([]);
    expect(orderOf(gridOf({ x: { values: [1, 1, 2] }, y: { values: [60, 60] } }))).toEqual([]);
    expect(orderOf(gridOf({ x: { values: [1, 2, 2] }, y: { values: [60, 61] } }))).toEqual([]);
    // Names have no order this checks
    expect(orderOf(gridOf({ x: { start: 3, stop: 1, num: 3 }, y: { values: ['a', 'c', 'b'] } }))).toEqual([]);
  });

  it('checks z where no profile says it', () => {
    // Too many places for a profile
    const wide = { ...gridOf({ x: { values: counting(40) }, y: { values: [60, 61] }, z: { values: [500, 1000, 850] } }) };
    wide.ranges.a = { type: 'NdArray', dataType: 'float', axisNames: ['z', 'y', 'x'], shape: [3, 2, 40], values: counting(240) } as typeof wide.ranges.a;
    expect(summarizeCoverage(wide)!.profile).toBeNull();
    expect(orderOf(wide)[0]).toMatchObject({ message: "z isn't in order: 850 comes after 1000", path: '/domain/axes/z/values/2' });
    // A profile says it in its own words: "Levels aren't in order"
    expect(orderOf(mcIfsZunsorted)).toEqual([]);
    expect(summarizeCoverage(mcIfsZunsorted)!.notes.filter(note => /aren't in order/.test(note.message))).toHaveLength(1);
  });

  it('says the same in many coverages once, with how many more', () => {
    const turned = (x: number[]) => ({ type: 'Coverage', domain: { domainType: 'Grid', axes: { x: { values: x }, y: { values: [60, 61] } } }, ranges: {} });
    // Each counted once, however often it turns
    const collection = { type: 'CoverageCollection', coverages: [turned([1, 2, 3]), turned([1, 3, 2]), turned([1, 3, 2, 1]), turned([5, 7, 6])] };
    expect(orderOf(collection)).toEqual([
      { message: "x isn't in order: 2 comes after 3, and likewise in 2 more coverages", path: '/coverages/1/domain/axes/x/values/2', severity: 'error', rule: COVJSON.monotonic },
    ]);
  });
});

describe('summarizeCoverage: a path', () => {
  const urlOf = (json: unknown) => /^GET (\S+),/.exec((json as { _comment: string })._comment)?.[1];
  const of = (json: unknown) => summarizeCoverage(json, { url: urlOf(json) })!;
  const trajectory = (tuples: unknown[][], coordinates = ['t', 'x', 'y']) => ({
    type: 'Coverage',
    domain: { type: 'Domain', domainType: 'Trajectory', axes: { composite: { dataType: 'tuple', coordinates, values: tuples } } },
    ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['composite'], shape: [tuples.length], values: tuples.map((_, i) => i) } },
  });

  it('says how far along it, and the levels and times, where the axes would say "5 coverages"', () => {
    const summary = of(fmiEcFrames);
    expect(summary.domainType).toBe('Trajectory');
    expect(summary.shape).toBe('5 positions along 628.99 km, 9 levels, 3 times, 2 parameters');
    expect(summary.timeText).toBe('6-hourly, Nov 7 00:00 to Nov 7 12:00.');
    expect(summary.axes).toEqual(['x 20 to 28', 'y 58 to 62', 'z 50 to 1000 hPa']);
    expect(summary.section).toMatchObject({ kind: 'section', colCount: 5 });
  });

  it('adds its notes, the path’s and z’s', () => {
    const notes = of(mcMepsClosed).notes.map(note => note.message);
    expect(notes).toContain("The path ends 20.66 km from the line's last vertex");
    expect(notes).toContain("z's direction is in the response: down");
  });

  it('says a radar Section’s shape', () => {
    const summary = of(mcRadarFikorZ);
    expect(summary.shape).toBe('257 positions along 127.77 km, 39 levels, 1 time, 1 parameter');
    expect(summary.axes.at(-1)).toBe('z 0 to 9306.12 m');
  });

  it('says a level each for a track, a time each for time along it, and its lines', () => {
    expect(of(mcIfsLsz).shape).toBe('9 positions along 247.14 km, a level each, 1 time, 1 parameter');
    expect(of(fmiMultilinestring).shape).toBe('4 positions along 246.42 km in 2 lines, 2 levels, 1 time, 1 parameter');
    const along = summarizeCoverage(trajectory([['2026-11-07T00:00:00Z', 24, 60], ['2026-11-07T03:00:00Z', 25, 61], ['2026-11-07T06:00:00Z', 26, 62]]))!;
    expect(along.shape).toBe('3 positions along 247.14 km, a time each, 1 parameter');
    expect(along.timeText).toBe('3-hourly, Nov 7 00:00 to Nov 7 06:00.');
  });

  it('counts only the levels sent, not one asked for and missing', () => {
    expect(of(mcIfsBadlevel).shape).toBe('5 positions along 123.94 km, 1 level, 1 time, 1 parameter');
    expect(of(mcIfsBadlevel).axes.at(-1)).toBe('z 850 hPa');
  });

  it('says no levels where there’s no z, and no time where there’s none', () => {
    expect(of(mcSingleNoz).shape).toBe('9 positions along 247.14 km, 1 time, 1 parameter');
    expect(of(mcSingleNoz).axes).toEqual(['x 24 to 26', 'y 60 to 62']);
    expect(summarizeCoverage(trajectory([[24, 60], [25, 61]], ['x', 'y']))!.shape).toBe('2 positions along 123.94 km, 1 parameter');
  });

  it('says no km where x and y aren’t lon/lat', () => {
    expect(summarizeCoverage(trajectory([[500000, 6650000], [510000, 6660000]], ['x', 'y']))!.shape).toBe('2 positions, 1 parameter');
  });

  it('keeps what a path it can’t read says today, with why', () => {
    const summary = summarizeCoverage(trajectory([[24, 60], ['a', 61]], ['x', 'y']))!;
    expect(summary.section).toMatchObject({ kind: 'cant' });
    expect(summary.shape).toBe('2 positions, 1 parameter');
  });

  it('leaves a path at one place to the profile', () => {
    const summary = summarizeCoverage(fmiTrajectoryOnePlace)!;
    expect(summary.section).toBeNull();
    expect(summary.profile).not.toBeNull();
  });
});
