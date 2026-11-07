import { describe, expect, it } from 'vitest';
import { createTheme } from '@mui/material/styles';
import { coverageToProfile, type CoverageProfile, type ProfileContext, type ProfileParameter } from './coverageProfile';
import {
  MIN_PANEL, NULL_LANE, canJoin, cellWords, dotRadius, emptyWords, firstTimeWithNumbers, hasNumbersAt, headLines, labelValue,
  levelName, linesOf, nearestRow, panelsOf, plotColours, profileSegments, readoutOf, rowAfter, shortValue, timeCaption,
  timeKinds, timeLabel, valueScale,
} from './profilePlot';
import type { VerticalAxis } from './verticalAxis';
import extents from './__fixtures__/profiles/vertical-extents.json';
import mcIfs1tAll from './__fixtures__/profiles/mc-ifs-1t-all.json';
import mcGfs1tAll from './__fixtures__/profiles/mc-gfs-1t-all.json';
import mcIfsAsked777 from './__fixtures__/profiles/mc-ifs-asked777.json';
import mcIfs85t from './__fixtures__/profiles/mc-ifs-85t-2p.json';
import mcIfsCube1pix from './__fixtures__/profiles/mc-ifs-cube-1pix.json';
import mcRadarDkrom from './__fixtures__/profiles/mc-radar-dkrom-allnull.json';
import fmiEcmwf1tAll from './__fixtures__/profiles/fmi-ecmwf-1t-all.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const copy = (json: unknown): Json => JSON.parse(JSON.stringify(json));
const urlOf = (json: Json) => /^GET (\S+),/.exec(json._comment)?.[1];
function profileOf(json: unknown, vertical?: ProfileContext['vertical'], url = urlOf(json as Json) ?? 'x'): CoverageProfile {
  const result = coverageToProfile(copy(json), { url, vertical });
  if (!result.profile) throw new Error(`no profile: ${result.message}`);
  return result.profile;
}
const MC = extents['ecmwf-ifs-pressure'];

// A point's levels, at one time or several, each parameter's values in t, then z order
const Z = [1000, 850, 500];
const TIMES = ['2026-11-07T00:00:00Z', '2026-11-07T06:00:00Z', '2026-11-07T12:00:00Z'];
function point(ranges: Record<string, unknown[]>, { z = Z, t, units = {} }: { z?: number[]; t?: string[]; units?: Record<string, string> } = {}) {
  return {
    type: 'Coverage',
    domain: { domainType: 'VerticalProfile', axes: { x: { values: [24] }, y: { values: [60] }, z: { values: z }, ...(t && { t: { values: t } }) } },
    parameters: Object.fromEntries(Object.keys(ranges).map(id => [id, { type: 'Parameter', ...(units[id] && { unit: { symbol: units[id] } }) }])),
    ranges: Object.fromEntries(Object.entries(ranges).map(([id, values]) => [id, {
      type: 'NdArray', axisNames: t ? ['t', 'z'] : ['z'], shape: t ? [t.length, z.length] : [z.length], values,
    }])),
  };
}
const pointProfile = (...args: Parameters<typeof point>) => profileOf(point(...args), undefined, 'x');
const byId = (profile: CoverageProfile, id: string) => profile.parameters.find(parameter => parameter.id === id)!;

describe('panelsOf', () => {
  const profile = pointProfile({ a: [1, 2, 3], b: [4, 5, 6], c: [-1, 0, null], d: [7, 8, 9], e: [10, 11, 12] }, { units: { a: 'K', b: '%', c: 'K', d: '', e: '' } });

  it('has a panel per parameter, in their order', () => {
    expect(panelsOf(profile.parameters, new Set(), false).map(panel => panel.parameters.map(parameter => parameter.id))).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('leaves out those hidden', () => {
    expect(panelsOf(profile.parameters, new Set(['b', 'd']), false).map(panel => panel.unit)).toEqual(['K', 'K', '']);
  });

  it('puts those with the same unit in one, where the first of them is, and never those with none', () => {
    const panels = panelsOf(profile.parameters, new Set(), true);
    expect(panels.map(panel => panel.parameters.map(parameter => parameter.id))).toEqual([['a', 'c'], ['b'], ['d'], ['e']]);
  });

  it("spans what's shared, over every value", () => {
    const [kelvin, percent] = panelsOf(profile.parameters, new Set(), true);
    expect([kelvin.min, kelvin.max]).toEqual([-1, 3]);
    expect([percent.min, percent.max]).toEqual([4, 6]);
  });

  it('has no span with no numbers', () => {
    const [panel] = panelsOf(pointProfile({ a: [null, null, null] }).parameters, new Set(), false);
    expect([panel.min, panel.max]).toEqual([null, null]);
  });
});

describe('canJoin', () => {
  it('offers Same unit where two parameters at a point share one (MeteoCore GFS: RH and TCDC in %)', () => {
    expect(canJoin(profileOf(mcGfs1tAll, MC))).toBe(true);
  });

  it("doesn't where every unit differs, or none is given (MeteoCore IFS, FMI)", () => {
    expect(canJoin(profileOf(mcIfs1tAll, MC))).toBe(false);
    expect(canJoin(profileOf(fmiEcmwf1tAll))).toBe(false);
  });

  it("doesn't at several points, where each panel already has a line per point", () => {
    const two = {
      type: 'CoverageCollection',
      coverages: [24, 25].map(x => {
        const one = point({ a: [1, 2, 3], b: [4, 5, 6] }, { units: { a: 'K', b: 'K' } });
        return { ...one, domain: { ...one.domain, axes: { ...one.domain.axes, x: { values: [x] } } } };
      }),
    };
    const profile = profileOf(two, undefined, 'x');
    expect(profile.locations).toHaveLength(2);
    expect(profile.parameters.map(parameter => parameter.unit)).toEqual(['K', 'K']);
    expect(canJoin(profile)).toBe(false);
  });
});

describe('linesOf', () => {
  const profile = pointProfile({ a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] }, { units: { a: 'K', b: 'K', c: 'K' } });
  const colours = ['red', 'blue'];

  it('has a line per parameter in a panel they share, the colours going round', () => {
    const [panel] = panelsOf(profile.parameters, new Set(), true);
    expect(linesOf(panel, 1, colours).map(line => [line.parameter.id, line.location, line.colour])).toEqual([['a', 0, 'red'], ['b', 0, 'blue'], ['c', 0, 'red']]);
  });

  it('has a line per point', () => {
    const [panel] = panelsOf(profile.parameters, new Set(), false);
    expect(linesOf(panel, 3, colours).map(line => [line.parameter.id, line.location, line.colour])).toEqual([['a', 0, 'red'], ['a', 1, 'blue'], ['a', 2, 'red']]);
  });

  it('has the one line', () => {
    const [panel] = panelsOf(profile.parameters, new Set(), false);
    expect(linesOf(panel, 1, colours)).toEqual([{ parameter: panel.parameters[0], location: 0, colour: 'red' }]);
  });
});

describe('valueScale', () => {
  it('runs from the least to the most across the panel, with room at each side', () => {
    const scale = valueScale(-10, 30, 200, false)!;
    expect(scale).toMatchObject({ left: 8, right: 192, min: -10, max: 30, single: false });
    expect(scale.map(-10)).toBe(8);
    expect(scale.map(30)).toBe(192);
    expect(scale.map(10)).toBe(100);
  });

  it("leaves the lane at the left for nulls' marks", () => {
    const scale = valueScale(0, 1, 200, true)!;
    expect(scale.left).toBe(NULL_LANE);
    expect(scale.map(0)).toBe(NULL_LANE);
  });

  it('puts a single value in the middle', () => {
    expect(valueScale(5, 5, 216, false)).toMatchObject({ single: true });
    expect(valueScale(5, 5, 216, false)!.map(5)).toBe(108);
    expect(valueScale(-40, -40, 216, false)!.map(-40)).toBe(108);
    // 10% of nothing is nothing, so 0 gets a pad of its own
    expect(valueScale(0, 0, 216, false)!.map(0)).toBe(108);
    expect(valueScale(0, 0, 216, false)!.map(1)).toBe(208);
  });

  it('has nothing to scale with no numbers', () => {
    expect(valueScale(null, null, 200, true)).toBeNull();
    expect(valueScale(1, null, 200, true)).toBeNull();
    expect(valueScale(null, 1, 200, true)).toBeNull();
  });
});

describe('profileSegments', () => {
  const rows = [10, 20, 30, 40, 50];

  it('joins the samples in order of level, and a null breaks the line', () => {
    expect(profileSegments(rows, [1, 2, null, 4, 5])).toEqual([[0, 1], [3, 4]]);
    expect(profileSegments(rows, [null, 2, 3, null, null])).toEqual([[1, 2]]);
  });

  it('breaks it at what isn’t a number', () => {
    expect(profileSegments(rows, [1, 'x', 3, 4, 5])).toEqual([[0], [2, 3, 4]]);
  });

  it('steps over a level this profile just doesn’t have', () => {
    expect(profileSegments(rows, [1, undefined, 3, undefined, 5])).toEqual([[0, 2, 4]]);
  });

  it('breaks it at a level that should be there and isn’t', () => {
    expect(profileSegments(rows, [1, undefined, 3, undefined, 5], [20])).toEqual([[0], [2, 4]]);
  });

  it('has nothing to join with no numbers', () => {
    expect(profileSegments(rows, [])).toEqual([]);
    expect(profileSegments(rows, [null, null, null, null, null])).toEqual([]);
  });
});

describe('the words and numbers on a plot', () => {
  it('draws smaller dots where levels crowd', () => {
    expect([24, 25, 60, 61].map(dotRadius)).toEqual([2.5, 2, 2, 1.5]);
  });

  it('labels a value with 6 digits, and a very small one in powers of ten', () => {
    expect(labelValue(-65.36999877)).toBe('-65.37');
    expect(labelValue(30154.672)).toBe('30154.7');
    expect(labelValue(0)).toBe('0');
    expect(labelValue(0.001)).toBe('0.001');
    expect(labelValue(0.000123456)).toBe('1.235e-4');
    expect(labelValue(-0.000123456)).toBe('-1.235e-4');
  });

  it("says a scale's ends in few characters", () => {
    expect(shortValue(0)).toBe('0');
    expect(shortValue(-65.36999)).toBe('-65.4');
    expect(shortValue(0.956619)).toBe('0.957');
    expect(shortValue(5.3)).toBe('5.3');
    expect(shortValue(999.9)).toBe('1000');
    expect(shortValue(30154.672)).toBe('30155');
    expect(shortValue(-1234.5)).toBe('-1234');
    expect(shortValue(0.001)).toBe('0.001');
    expect(shortValue(0.0005)).toBe('5.0e-4');
    expect(shortValue(12345678)).toBe('1.2e7');
    expect(shortValue(9999999)).toBe('9999999');
  });

  it('reads a value at the crosshair, saying what it is when it isn’t a number', () => {
    expect(cellWords(5.30225, '°C')).toBe('5.30225 °C');
    expect(cellWords(5.30225, '')).toBe('5.30225');
    expect(cellWords(null, '°C')).toBe('null');
    expect(cellWords(undefined, '°C')).toBe('not in response');
    expect(cellWords('rain', '')).toBe('rain');
    expect(cellWords({ a: 1 }, '')).toBe('{"a":1}');
  });

  it('names a level by its unit, a model level by its number, and z with nothing to go on', () => {
    const axis = (kind: VerticalAxis['kind'], unit: string) => ({ kind, unit }) as VerticalAxis;
    expect(levelName(axis('pressure', 'hPa'), 500)).toBe('500 hPa');
    expect(levelName(axis('angle', '°'), 0.5)).toBe('0.5°');
    expect(levelName(axis('modelLevel', ''), 12)).toBe('Level 12');
    expect(levelName(axis('unknown', ''), 3)).toBe('z 3');
    expect(levelName(axis('unknown', 'm'), 3)).toBe('3 m');
    expect(levelName(axis('height', ''), 3)).toBe('3');
  });
});

describe('emptyWords', () => {
  const parameter = (figures: Partial<ProfileParameter>) => ({ misfit: null, notIncluded: false, numbers: 3, others: 0, ...figures }) as ProfileParameter;

  it('says nothing where there are numbers at this time', () => {
    expect(emptyWords([parameter({ misfit: { count: 1, expected: 2, path: '' } })], true)).toBeNull();
  });

  it("says why there's nothing to draw", () => {
    expect(emptyWords([parameter({ misfit: { count: 1, expected: 2, path: '' } }), parameter({})], false)).toBe("Doesn't fit its axes");
    expect(emptyWords([parameter({ notIncluded: true }), parameter({ notIncluded: true })], false)).toBe('Not in this response');
    expect(emptyWords([parameter({ numbers: 0, others: 2 }), parameter({ numbers: 0 })], false)).toBe('Not numbers');
    expect(emptyWords([parameter({ numbers: 0 }), parameter({ numbers: 0 })], false)).toBe('All null');
    expect(emptyWords([parameter({ notIncluded: true, numbers: 0 }), parameter({ numbers: 0 })], false)).toBe('All null');
    expect(emptyWords([parameter({ numbers: 0 }), parameter({})], false)).toBe('All null at this time');
  });
});

describe('times', () => {
  const profile = pointProfile({ a: [null, null, null, 1, null, 3, 4, 5, 6], b: [null, null, null, null, null, null, 7, 8, null] }, { t: TIMES });

  it('finds where there are numbers', () => {
    expect([0, 1, 2].map(time => hasNumbersAt(byId(profile, 'a'), time))).toEqual([false, true, true]);
    expect([0, 1, 2].map(time => hasNumbersAt(byId(profile, 'b'), time))).toEqual([false, false, true]);
  });

  it('opens at the first time with a number, or the first of all with none', () => {
    expect(firstTimeWithNumbers(profile)).toBe(1);
    expect(firstTimeWithNumbers(pointProfile({ a: Array(9).fill(null) }, { t: TIMES }))).toBe(0);
    expect(firstTimeWithNumbers(profileOf(mcRadarDkrom, extents['dk-radar-volume-dkrom']))).toBe(0);
  });

  it('marks each as the step bar does, over the parameters shown', () => {
    expect(timeKinds(profile, new Set())).toEqual(['none', 'some', 'some']);
    expect(timeKinds(profile, new Set(['b']))).toEqual(['none', 'some', '']);
    expect(timeKinds(profile, new Set(['a', 'b']))).toEqual(['none', 'none', 'none']);
  });

  it('says a time as the grid does, and which of how many it is', () => {
    const times = [{ raw: '2026-11-07T15:00:00Z', at: Date.UTC(2026, 10, 7, 15) }, { raw: 'soon', at: NaN }, { raw: null, at: NaN }];
    expect(timeLabel(times, 0)).toBe('Nov 7 15:00');
    expect(timeCaption(times, 0)).toBe('Nov 7 15:00 (1/3)');
    expect(timeLabel(times, 1)).toBe('soon');
    expect(timeCaption(times, 2)).toBe('no time (3/3)');
  });
});

describe('finding a level', () => {
  const rows = [10, 500, 1000];
  // Down: 10 at the top
  const yOf = (level: number) => level / 10;

  it('takes the level nearest the height, whichever way the axis runs', () => {
    expect([0, 25, 26, 74, 76, 1000].map(y => nearestRow(rows, yOf, y))).toEqual([0, 0, 1, 1, 2, 2]);
    const up = (level: number) => 100 - level / 10;
    expect([0, 24, 40, 74, 76, 1000].map(y => nearestRow(rows, up, y))).toEqual([2, 2, 1, 1, 0, 0]);
  });

  it('steps down and up the screen from a level, staying on it at the ends', () => {
    expect(rowAfter(rows, yOf, 0, 1)).toBe(1);
    expect(rowAfter(rows, yOf, 1, 1)).toBe(2);
    expect(rowAfter(rows, yOf, 2, 1)).toBe(2);
    expect(rowAfter(rows, yOf, 1, -1)).toBe(0);
    expect(rowAfter(rows, yOf, 0, -1)).toBe(0);
  });

  it('starts at the top, whichever way the axis runs', () => {
    expect(rowAfter(rows, yOf, null, 1)).toBe(0);
    expect(rowAfter(rows, yOf, null, -1)).toBe(0);
    const flipped = (level: number) => 100 - level / 10;
    expect(rowAfter(rows, flipped, null, 1)).toBe(2);
    expect(rowAfter(rows, flipped, 2, 1)).toBe(1);
  });
});

describe('readoutOf', () => {
  it('names the level, where it is on z, and its path (MeteoCore)', () => {
    const profile = profileOf(mcIfs1tAll, MC);
    const row = profile.rows.indexOf(500);
    const cell = profile.cellOf('t', 0, 0, row)!;
    expect(readoutOf(profile, row, 't', 0)).toEqual({ words: `500 hPa, index ${cell.axisIndex} of z`, path: cell.path });
    expect(cell.path).toMatch(/\/ranges\/t\/values\/\d+$/);
  });

  it('says a level asked for and missing isn’t in the response, with no path', () => {
    const profile = profileOf(mcIfsAsked777, MC);
    expect(readoutOf(profile, profile.rows.indexOf(777), 't', 0)).toEqual({ words: "777 hPa isn't in the response", path: '' });
  });

  it('says the time where there are several', () => {
    const profile = profileOf(mcIfs85t, MC);
    const { words } = readoutOf(profile, 0, 't', 3);
    expect(words).toContain(`, ${timeLabel(profile.times, 3)},`);
    // z with no name or unit, at one time: 500 is the last of 1000, 850, 500 sent
    expect(readoutOf(pointProfile({ a: [1, 2, 3] }), 0, 'a', 0).words).toBe('z 500, index 2 of z');
  });

  it('says the point where there are several', () => {
    const profile = profileOf(mcIfsCube1pix, MC);
    expect(readoutOf(profile, 0, 't', 0).words).toContain(`, ${profile.locations[0].label},`);
  });

  it('says a level this time doesn’t have isn’t in it (DK radar, its scan changing)', () => {
    const profile = profileOf(mcRadarDkrom, extents['dk-radar-volume-dkrom']);
    const time = profile.times.findIndex((_, at) => profile.rows.some((_, row) => profile.cellOf('DBZH', 0, at, row) === null));
    const row = profile.rows.findIndex((_, at) => profile.cellOf('DBZH', 0, time, at) === null);
    expect(readoutOf(profile, row, 'DBZH', time)).toMatchObject({ words: expect.stringMatching(/, not in the response$/), path: '' });
    expect(readoutOf(profile, row, null, time).words).toMatch(/, not in the response$/);
  });

  it('has no index where z is in each point, not an axis', () => {
    const json = {
      type: 'Coverage',
      domain: { domainType: 'MultiPoint', axes: { composite: { dataType: 'tuple', coordinates: ['x', 'y', 'z'], values: [[24, 60, 1000], [24, 60, 850]] } } },
      ranges: { a: { type: 'NdArray', axisNames: ['composite'], shape: [2], values: [1, 2] } },
    };
    const profile = profileOf(json, undefined, 'x');
    expect(readoutOf(profile, profile.rows.indexOf(850), 'a', 0)).toEqual({ words: 'z 850', path: '/ranges/a/values/1' });
  });
});

describe('headLines', () => {
  const profile = pointProfile(
    { t: [1, 2, 3], some_long_parameter_name_here: [1, 2, 3], a: [1, 2, 3], b: [1, 2, 3], c: [1, 2, 3], d: [1, 2, 3], e: [1, 2, 3] },
    { units: { a: 'K', b: 'K', c: 'K', d: 'K', e: 'K' } },
  );
  const panel = (ids: string[], label: string | null = null) => ({
    unit: '', min: 0, max: 1, parameters: ids.map(id => ({ ...byId(profile, id), label })),
  });

  it('has a line for a short id, and one more for its label', () => {
    expect(headLines([panel(['t'])], MIN_PANEL)).toBe(1);
    expect(headLines([panel(['t'], 'Temperature')], MIN_PANEL)).toBe(2);
  });

  it('wraps a long id in a narrow panel, to 3 lines at most and its label', () => {
    const longer = { unit: '', min: 0, max: 1, parameters: [{ ...byId(profile, 't'), id: 'a_very_long_parameter_name_that_wraps_a_lot', label: null }] };
    expect(headLines([longer], MIN_PANEL)).toBe(3);
    expect(headLines([panel(['some_long_parameter_name_here'])], 400)).toBe(1);
    expect(headLines([panel(['some_long_parameter_name_here'])], MIN_PANEL)).toBe(3);
    expect(headLines([panel(['some_long_parameter_name_here'], 'Something')], MIN_PANEL)).toBe(4);
  });

  it('lists the ids in a shared panel, up to 4', () => {
    expect(headLines([panel(['a', 'b', 'c'], 'A label')], MIN_PANEL)).toBe(3);
    expect(headLines([panel(['a', 'b', 'c', 'd', 'e'])], MIN_PANEL)).toBe(4);
  });

  it('takes the most any panel needs', () => {
    expect(headLines([panel(['t']), panel(['a', 'b']), panel(['c'])], MIN_PANEL)).toBe(2);
    expect(headLines([], MIN_PANEL)).toBe(1);
  });
});

describe('plotColours', () => {
  it('takes the theme’s, darker warning words on light and lighter on dark', () => {
    const light = createTheme();
    const dark = createTheme({ palette: { mode: 'dark' } });
    expect(plotColours(light)).toMatchObject({ ink: light.palette.text.primary, paper: light.palette.background.paper, warnLine: light.palette.warning.main, warnText: light.palette.warning.dark });
    expect(plotColours(dark).warnText).toBe(dark.palette.warning.light);
    expect(plotColours(dark).grid).not.toBe(plotColours(light).grid);
  });
});
