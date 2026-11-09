import { describe, expect, it } from 'vitest';
import {
  askedLevels, declaredFits, declaredInterval, declaredLevels, defaultScale, expectedLevels, isEvenlySpaced, levelPosition, pickLevelLabels, readVerticalAxis,
  readVrs, valuePosition, vrsAbout, withUnit,
} from './verticalAxis';

// A coverage whose z has this reference system
const withSystem = (system: unknown) => ({ domain: { axes: { z: { values: [1, 2] } }, referencing: [{ coordinates: ['z'], system }] } });
const axisOf = (system: unknown) => readVerticalAxis({}, withSystem(system));
const described = (en: string) => axisOf({ type: 'VerticalCRS', description: { en } });
const csAxis = (axis: Record<string, unknown>) => axisOf({ type: 'VerticalCRS', cs: { csAxes: [axis] } });

describe('readVerticalAxis', () => {
  it('reads name, unit and direction from the response’s csAxes', () => {
    expect(csAxis({ name: { en: 'Pressure' }, direction: 'down', unit: { symbol: 'hPa' } })).toEqual({
      kind: 'pressure', name: 'Pressure', unit: 'hPa', unitSource: 'response', direction: 'down', directionSource: 'response', usualWords: 'pressure', againstUsual: false, flatCrs: null,
    });
  });

  it('finds z’s system on the collection when the coverage has none', () => {
    const json = { referencing: [{ coordinates: ['z'], system: { type: 'VerticalCRS', cs: { csAxes: [{ name: { en: 'Depth' }, direction: 'down', unit: { symbol: 'm' } }] } } }] };
    expect(readVerticalAxis(json, { domain: { axes: {} } })).toMatchObject({ kind: 'depth', unit: 'm', directionSource: 'response' });
    expect(readVerticalAxis({ domain: json }, { domain: { axes: {} } })).toMatchObject({ kind: 'depth' });
  });

  it('takes a unit from a sentence only as a final “in hPa”', () => {
    expect(described('Pressure level in hPa').unit).toBe('hPa');
    expect(described('Pressure level in hPa.').unit).toBe('hPa');
    expect(described('Height 2 m above something')).toMatchObject({ unit: '', unitSource: 'none' });
  });

  it('writes a unit the usual way, and keeps one it doesn’t know as sent', () => {
    expect(csAxis({ unit: { symbol: 'hectopascal' } }).unit).toBe('hPa');
    expect(csAxis({ unit: { symbol: 'Degrees' } }).unit).toBe('°');
    expect(csAxis({ unit: { symbol: { value: 'm', type: 'http://www.opengis.net/def/uom/UCUM/' } } }).unit).toBe('m');
    expect(csAxis({ unit: { label: { en: 'metre' } } }).unit).toBe('m');
    expect(csAxis({ unit: { symbol: 'constructor' } }).unit).toBe('constructor');
    expect(csAxis({ unit: { symbol: '1' } })).toMatchObject({ unit: '', unitSource: 'response' });
  });

  it('tells model levels before pressure, since FMI’s hybrid datum has “pressure” in its name', () => {
    expect(described('Hybrid sigma-pressure model levels')).toMatchObject({ kind: 'modelLevel', name: 'Model level', direction: 'down', directionSource: 'usual' });
    expect(described('Hybrid model level number').kind).toBe('modelLevel');
  });

  it('knows each kind, and its usual direction when none is stated', () => {
    expect(described('Elevation angle in deg')).toMatchObject({ kind: 'angle', unit: '°', direction: 'up', usualWords: 'an elevation angle' });
    expect(described('Isobaric surface')).toMatchObject({ kind: 'pressure', direction: 'down' });
    expect(described('Depth below sea surface in m')).toMatchObject({ kind: 'depth', direction: 'down', unit: 'm' });
    expect(described('Altitude in ft')).toMatchObject({ kind: 'height', direction: 'up', unit: 'ft' });
  });

  it('knows each kind by any of its words, whatever their case', () => {
    expect(described('Hybrid sigma-pressure').kind).toBe('modelLevel');
    expect(described('Level number').kind).toBe('modelLevel');
    expect(described('Terrain-following sigma').kind).toBe('modelLevel');
    expect(csAxis({ name: { en: 'Elevation angle' }, direction: 'up' })).toMatchObject({ kind: 'angle', direction: 'up', usualWords: 'an elevation angle' });
    expect(described('Antenna tilt').kind).toBe('angle');
    expect(described('Altitude').kind).toBe('height');
    expect(described('PRESSURE').kind).toBe('pressure');
  });

  it('knows a kind by a unit in the reference system’s axis, though nothing else names it', () => {
    expect(csAxis({ unit: { symbol: 'hPa' } })).toMatchObject({ kind: 'pressure', name: 'Pressure', unit: 'hPa', unitSource: 'response', direction: 'down' });
  });

  it('takes a unit from a sentence only at its end, and says it was a sentence', () => {
    expect(described('Pressure in hPa of the model')).toMatchObject({ unit: '', unitSource: 'none' });
    expect(described('Pressure level in hPa')).toMatchObject({ unit: 'hPa', unitSource: 'description' });
    expect(axisOf({ type: 'VerticalCRS', description: { en: 'Pressure level in hPa' }, cs: { csAxes: [{ unit: { symbol: 'Pa' } }] } })).toMatchObject({ unit: 'Pa', unitSource: 'response' });
  });

  it('knows an angle or a height by its unit alone', () => {
    expect(csAxis({ unit: { symbol: 'deg' } })).toMatchObject({ kind: 'angle', name: 'Elevation angle', direction: 'up', directionSource: 'usual' });
    expect(csAxis({ unit: { symbol: 'km' } })).toMatchObject({ kind: 'height', name: 'Height', direction: 'up', usualWords: 'height' });
  });

  it('assumes up for what nothing names, and says nothing is known', () => {
    expect(readVerticalAxis({}, { domain: { axes: {} } })).toEqual({
      kind: 'unknown', name: 'z', unit: '', unitSource: 'none', direction: 'up', directionSource: 'none', usualWords: null, againstUsual: false, flatCrs: null,
    });
  });

  it('obeys a stated direction against the usual, and marks it', () => {
    expect(csAxis({ name: { en: 'Pressure' }, direction: 'up' })).toMatchObject({ direction: 'up', directionSource: 'response', againstUsual: true });
    expect(csAxis({ name: { en: 'Pressure' }, direction: 'sideways' })).toMatchObject({ direction: 'down', directionSource: 'usual', againstUsual: false });
    expect(csAxis({ direction: 'down' })).toMatchObject({ kind: 'unknown', direction: 'down', directionSource: 'response', againstUsual: false });
  });

  it('names a CRS with no vertical axis that z is referenced to, as KNMI references z to CRS84', () => {
    expect(axisOf({ type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' })).toMatchObject({ kind: 'unknown', flatCrs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' });
    expect(axisOf({ type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/4326' }).flatCrs).toBe('http://www.opengis.net/def/crs/EPSG/0/4326');
    expect(axisOf({ type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/0/CRS84h' }).flatCrs).toBeNull();
    expect(axisOf({ type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/4979' }).flatCrs).toBeNull();
    expect(axisOf({ type: 'VerticalCRS' }).flatCrs).toBeNull();
  });

  it('reads Pa only as a word, and only as it’s written', () => {
    expect(described('Spatial reference').kind).toBe('unknown');
    expect(described('Level in Pa').kind).toBe('pressure');
    expect(described('Station code pa').kind).toBe('unknown');
  });
});

describe('defaultScale', () => {
  it('is log for pressure, unless a level at or below 0 rules it out', () => {
    expect(defaultScale('pressure', [10, 500, 1000])).toEqual({ scale: 'log', canLog: true });
    expect(defaultScale('pressure', [0, 10, 100])).toEqual({ scale: 'linear', canLog: false });
    expect(defaultScale('height', [-5, 10, 100])).toEqual({ scale: 'linear', canLog: false });
    expect(defaultScale('height', [])).toEqual({ scale: 'linear', canLog: false });
  });

  it('is linear for model levels, for evenly spaced levels and for two', () => {
    expect(defaultScale('modelLevel', [1, 2, 3, 30, 65]).scale).toBe('linear');
    expect(defaultScale('height', Array.from({ length: 100 }, (_, i) => (i + 1) * 250)).scale).toBe('linear');
    expect(defaultScale('height', [1, 1000]).scale).toBe('linear');
  });

  it('is log where a linear axis would run two levels together, by 1/60 of the span', () => {
    expect(defaultScale('angle', [0.3, 0.8, 1.2, 2, 2.8, 4.5, 6, 8, 10, 12, 15, 20, 25, 90]).scale).toBe('log');
    expect(defaultScale('height', [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]).scale).toBe('log');
    // A gap of exactly 1/60 is enough to tell two apart
    expect(defaultScale('height', [0.6, 1.6, 30, 60.6]).scale).toBe('linear');
    expect(defaultScale('height', [0.6, 1.5, 30, 60.6]).scale).toBe('log');
  });
});

describe('isEvenlySpaced', () => {
  it('allows for rounding, in any order', () => {
    expect(isEvenlySpaced([0.3, 0.1, 0.2])).toBe(true);
    expect(isEvenlySpaced([1, 2, 4])).toBe(false);
  });
});

describe('askedLevels', () => {
  it('reads a list, a range either way round, and anything else', () => {
    expect(askedLevels('https://x/position?coords=POINT(1 2)&z=1000,850,500')).toEqual({ kind: 'list', values: [1000, 850, 500] });
    expect(askedLevels('x?z=1000/500')).toEqual({ kind: 'range', lo: 500, hi: 1000 });
    expect(askedLevels('x?z=-10/-200')).toEqual({ kind: 'range', lo: -200, hi: -10 });
    expect(askedLevels('x?z=R5/100/50')).toEqual({ kind: 'other' });
    expect(askedLevels('x?z=1000,,500')).toEqual({ kind: 'other' });
    expect(askedLevels('x?z=1.2.3/5')).toEqual({ kind: 'other' });
  });

  it('decodes the query, and doesn’t trip on a bad escape', () => {
    expect(askedLevels('x?a=1&z=1000%2C850#top')).toEqual({ kind: 'list', values: [1000, 850] });
    expect(askedLevels('x?z=10%2F20')).toEqual({ kind: 'range', lo: 10, hi: 20 });
    expect(askedLevels('x?z=%E0%A4%A')).toEqual({ kind: 'other' });
  });

  it('finds nothing asked without z, or with only something like it', () => {
    expect(askedLevels(undefined)).toBeNull();
    expect(askedLevels('x?coords=POINT(1 2)')).toBeNull();
    expect(askedLevels('x?zone=5')).toBeNull();
    expect(askedLevels('x?quiz=5')).toBeNull();
  });
});

describe('levels that should be there', () => {
  const declared = [1000, 925, 850, 700, 500];

  it('reads what a collection’s vrs says of its axis', () => {
    expect(readVrs('VERTCRS["P",VDATUM["A"],CS[vertical,1],AXIS["Pressure (hPa)",down],UNIT["hPa",100]]')).toEqual({ direction: 'down', unit: 'hPa' });
    expect(readVrs('VERTCRS["H",VDATUM["A"],CS[vertical,1],AXIS["gravity-related height",up],LENGTHUNIT["metre",1]]')).toEqual({ direction: 'up', unit: 'm' });
    expect(readVrs('PARAMETRICCRS["L",PDATUM["Hybrid"],CS[parametric,1],AXIS["model level number (n)",down]]')).toEqual({ direction: 'down', unit: '' });
    expect(readVrs('VERTCRS["P",AXIS["Pressure",sideways]]')).toEqual({ direction: undefined, unit: undefined });
    expect(readVrs('')).toBeNull();
    expect(readVrs(undefined)).toBeNull();
  });

  it('checks against the vrs only where the levels sent are its own', () => {
    const vrs = 'VERTCRS["P",CS[vertical,1],AXIS["Pressure (hPa)",down]]';
    expect(vrsAbout({ vrs, values: ['1000', '850'] }, [1000, 850])).toEqual({ direction: 'down', unit: 'hPa' });
    expect(vrsAbout({ vrs, values: ['1000', '850'] }, [1000, 4.8])).toBeNull();
    expect(vrsAbout({ vrs, interval: [['50', '1000']] }, [500, 1000])).not.toBeNull();
    expect(vrsAbout({ vrs, interval: [['50', '1000']] }, [5, 1000])).toBeNull();
    expect(vrsAbout({ vrs }, [500])).toBeNull();
    expect(vrsAbout({ values: ['500'] }, [500])).toBeNull();
    expect(vrsAbout({ vrs, values: ['500'] }, [])).toBeNull();
  });

  it('takes the declared levels as numbers, and the interval lowest first', () => {
    expect(declaredLevels({ values: ['1000', 925, 'all', '850'] })).toEqual([1000, 925, 850]);
    expect(declaredLevels(undefined)).toEqual([]);
    expect(declaredInterval({ interval: [['1000', '10']] })).toEqual([10, 1000]);
    expect(declaredInterval({ interval: [[null, '10']] })).toBeNull();
    expect(declaredInterval({ interval: [] })).toBeNull();
    expect(declaredInterval(undefined)).toBeNull();
  });

  it('counts asked levels only if at least one came back', () => {
    expect(expectedLevels({ kind: 'list', values: [1000, 777] }, declared, [1000])).toEqual([1000, 777]);
    expect(expectedLevels({ kind: 'list', values: [0.5, 1.5] }, declared, [0, 217])).toEqual([]);
  });

  it('counts the declared levels inside a range, or all of them with nothing asked, if they fit what came back', () => {
    expect(expectedLevels({ kind: 'range', lo: 800, hi: 1000 }, declared, [1000, 850])).toEqual([1000, 925, 850]);
    expect(expectedLevels({ kind: 'range', lo: 850, hi: 925 }, declared, [925, 850])).toEqual([925, 850]);
    expect(expectedLevels(null, declared, [1000, 850])).toEqual(declared);
    expect(expectedLevels(null, declared, [0, 217, 434])).toEqual([]);
    expect(expectedLevels({ kind: 'other' }, declared, [1000, 850])).toEqual([]);
  });

  it('takes declared levels as fitting when at least half of what came back is among them', () => {
    expect(declaredFits(declared, [1000, 4.8])).toBe(true);
    expect(declaredFits(declared, [1000, 4.8, 8.4])).toBe(false);
    expect(declaredFits([], [1000])).toBe(false);
    expect(declaredFits([1000], [])).toBe(true);
  });
});

describe('words', () => {
  it('writes a unit after a value, with nothing before a degree sign', () => {
    expect(withUnit(500, 'hPa')).toBe('500 hPa');
    expect(withUnit(0.5, '°')).toBe('0.5°');
    expect(withUnit(3, '')).toBe('3');
  });

});

describe('levelPosition', () => {
  // Sent in any order
  const levels = [1000, 10, 500, 100];

  it('puts a bigger value lower on an axis down, and higher on one up', () => {
    const down = levelPosition(levels, { spacing: 'linear', direction: 'down' });
    expect([10, 500, 1000].map(down)).toEqual([0, 490 / 990, 1]);
    const up = levelPosition(levels, { spacing: 'linear', direction: 'up' });
    expect([10, 500, 1000].map(up)).toEqual([1, 1 - 490 / 990, 0]);
  });

  it('turns it over when flipped', () => {
    expect([10, 1000].map(levelPosition(levels, { spacing: 'linear', direction: 'down', flipped: true }))).toEqual([1, 0]);
    expect([10, 1000].map(levelPosition(levels, { spacing: 'linear', direction: 'up', flipped: true }))).toEqual([0, 1]);
  });

  it('spaces by the log of the levels', () => {
    const at = levelPosition(levels, { spacing: 'log', direction: 'down' });
    expect(at(10)).toBe(0);
    expect(at(100)).toBeCloseTo(0.5, 12);
    expect(at(1000)).toBe(1);
  });

  it('spaces each level the same, in their order', () => {
    const down = levelPosition(levels, { spacing: 'even', direction: 'down' });
    const up = levelPosition(levels, { spacing: 'even', direction: 'up' });
    [0, 1 / 3, 2 / 3, 1].forEach((at, i) => {
      expect(down([10, 100, 500, 1000][i])).toBeCloseTo(at, 12);
      expect(up([10, 100, 500, 1000][i])).toBeCloseTo(1 - at, 12);
    });
  });

  it('puts a single level in the middle', () => {
    for (const spacing of ['linear', 'log', 'even'] as const) {
      expect(levelPosition([850], { spacing, direction: 'down' })(850)).toBe(0.5);
      expect(levelPosition([850], { spacing, direction: 'up', flipped: true })(850)).toBe(0.5);
    }
  });
});

describe('valuePosition', () => {
  const levels = [1000, 10, 500, 100];

  it('puts a level where levelPosition does, every way', () => {
    for (const spacing of ['linear', 'log', 'even'] as const) {
      for (const direction of ['up', 'down'] as const) {
        for (const flipped of [false, true]) {
          const value = valuePosition(levels, { spacing, direction, flipped });
          const level = levelPosition(levels, { spacing, direction, flipped });
          for (const each of levels) expect(value(each)).toBeCloseTo(level(each), 12);
        }
      }
    }
  });

  it('puts a value between levels by its value, linear or log', () => {
    expect(valuePosition(levels, { spacing: 'linear', direction: 'down' })(505)).toBeCloseTo(495 / 990, 12);
    expect(valuePosition(levels, { spacing: 'log', direction: 'down' })(Math.sqrt(10 * 100))).toBeCloseTo(0.25, 12);
  });

  it('puts a value between two levels in proportion when they’re evenly spaced, and on at the end steps beyond them', () => {
    const down = valuePosition(levels, { spacing: 'even', direction: 'down' });
    expect(down(55)).toBeCloseTo(0.5 / 3, 12);
    expect(down(750)).toBeCloseTo(2.5 / 3, 12);
    expect(down(1500)).toBeCloseTo(1 + 1 / 3, 12);
    expect(down(5.5)).toBeCloseTo(-4.5 / 90 / 3, 12);
    expect(valuePosition(levels, { spacing: 'even', direction: 'up' })(55)).toBeCloseTo(1 - 0.5 / 3, 12);
    expect(valuePosition(levels, { spacing: 'even', direction: 'down', flipped: true })(55)).toBeCloseTo(1 - 0.5 / 3, 12);
  });

  it('puts anything in the middle of one level, and nowhere for what isn’t a number', () => {
    expect(valuePosition([850], { spacing: 'even', direction: 'down' })(900)).toBe(0.5);
    expect(valuePosition(levels, { spacing: 'even', direction: 'down' })(NaN)).toBeNaN();
  });
});

describe('pickLevelLabels', () => {
  const apart = (labels: Set<number>, toPixels: (level: number) => number) => {
    const pixels = [...labels].map(toPixels).sort((a, b) => a - b);
    return Math.min(...pixels.slice(1).map((pixel, i) => pixel - pixels[i]));
  };

  it('labels the ends, then as many others as fit apart (MeteoCore over 300 px)', () => {
    const levels = [10, 50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000];
    const toPixels = (level: number) => ((level - 10) / 990) * 300;
    const labels = pickLevelLabels(levels, toPixels);
    // 50 is 12 px from 10
    expect([...labels].sort((a, b) => a - b)).toEqual(levels.filter(level => level !== 50));
    expect(apart(labels, toPixels)).toBeGreaterThanOrEqual(13);
  });

  it('takes the roundest first', () => {
    const toPixels = (level: number) => level * 2;
    expect(pickLevelLabels([0, 7, 10, 13, 20], toPixels)).toEqual(new Set([0, 20, 10]));
    expect(pickLevelLabels([0, 7, 10, 13, 20], toPixels, { minGap: 5 })).toEqual(new Set([0, 20, 10, 7, 13]));
  });

  it('labels both ends, round or not, before a rounder level beside one', () => {
    expect(pickLevelLabels([3, 10, 20, 25], level => level * 2)).toEqual(new Set([3, 25, 10]));
  });

  it('labels those that must have one before the ends, as a missing level', () => {
    expect(pickLevelLabels([10, 500, 990, 1000], level => level / 10, { must: [990] })).toEqual(new Set([990, 10, 500]));
  });

  it('labels evenly spaced levels on an even step', () => {
    const levels = Array.from({ length: 20 }, (_, i) => 3 * (i + 1));
    expect(pickLevelLabels(levels, level => (level * 7) / 3)).toEqual(new Set([3, 60, 30, 12, 18, 24, 36, 42, 48, 54]));
    // 65 model levels 6 px apart: every fifth, and the ends
    const model = Array.from({ length: 65 }, (_, i) => i + 1);
    expect([...pickLevelLabels(model, level => level * 6)].sort((a, b) => a - b)).toEqual([1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65]);
  });

  it('labels the one level there is, and none of none', () => {
    expect(pickLevelLabels([500], () => 0)).toEqual(new Set([500]));
    expect(pickLevelLabels([], () => 0)).toEqual(new Set());
  });
});
