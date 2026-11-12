import { describe, expect, it } from 'vitest';
import type { Temporal } from '../../types/api';
import { expandTemporalValues, gridStepMs, listedTimesForm, temporalValuesOf } from './temporal';
import dims from '../../query/__fixtures__/meteocore-maps-dimensions.json';

const temporalOf = (id: string) => dims.collections.find(each => each.id === id)!.extent.temporal as unknown as Temporal;
const IFS = temporalOf('ecmwf-ifs-pressure');
const RADAR = temporalOf('fmi-radar-composite-dbz');
const AIFS = temporalOf('ecmwf-aifs-single');

describe('the times a temporal extent lists', () => {
  it('are EDR’s values where it has them, as they are', () => {
    const edr = { values: ['2026-11-11T18:00:00+00:00', '2026-11-11T21:00:00+00:00'], grid: { coordinates: ['2026-01-01T00:00:00Z'] } } as Temporal;
    expect(temporalValuesOf(edr)).toEqual(['2026-11-11T18:00:00+00:00', '2026-11-11T21:00:00+00:00']);
    expect(listedTimesForm(edr)).toBe('values');
    expect(gridStepMs(edr)).toBeNull();
  });

  it('are a grid’s coordinates, in UTC with Z, as Maps 1.0 asks servers to take them', () => {
    expect(temporalValuesOf(IFS)).toEqual([
      '2026-11-11T18:00:00Z', '2026-11-11T21:00:00Z', '2026-11-12T00:00:00Z', '2026-11-12T03:00:00Z', '2026-11-12T06:00:00Z', '2026-11-12T09:00:00Z',
    ]);
    expect(listedTimesForm(IFS)).toBe('coordinates');
    expect(temporalValuesOf({ grid: { coordinates: ['2026-11-12T02:00:00+02:00', 'not a time', 5, ' '] } } as unknown as Temporal)).toEqual(['2026-11-12T00:00:00Z', 'not a time']);
  });

  it('are a regular grid as a repeating interval, from its first coordinate by its resolution', () => {
    expect(temporalValuesOf(AIFS)).toEqual(['R62/2026-11-11T18:00:00Z/PT6H']);
    expect(listedTimesForm(AIFS)).toBe('regular');
    const times = expandTemporalValues(AIFS, 1000);
    expect(times).toHaveLength(62);
    expect(times[1]).toBe('2026-11-12T00:00:00Z');
    expect(times[61]).toBe('2026-11-27T00:00:00Z');
  });

  it('are none for a grid it can’t read, nor for an interval alone', () => {
    for (const grid of [{ firstCoordinate: '2026-11-11T18:00:00Z', resolution: 'six hours', cellsCount: 4 }, { firstCoordinate: '2026-11-11T18:00:00Z', resolution: 'PT6H', cellsCount: 0 }, { resolution: 'PT6H', cellsCount: 4 }]) {
      expect(temporalValuesOf({ grid } as Temporal)).toEqual([]);
      expect(listedTimesForm({ grid } as Temporal)).toBeNull();
    }
    expect(temporalValuesOf({ interval: [['2026-11-11T18:00:00Z', '2026-11-12T18:00:00Z']] })).toEqual([]);
    expect(temporalValuesOf(null)).toEqual([]);
  });

  it('are what the time control and the checks expand, in place of the interval’s steps', () => {
    expect(expandTemporalValues(RADAR, 1000)).toEqual([
      '2026-11-11T08:40:00Z', '2026-11-11T08:45:00Z', '2026-11-11T08:50:00Z', '2026-11-11T08:55:00Z', '2026-11-11T09:00:00Z', '2026-11-11T09:05:00Z',
    ]);
    // Without a grid, the interval's hourly steps, as before
    expect(expandTemporalValues({ interval: RADAR.interval }, 1000)).toEqual(['2026-11-11T08:40:00Z', '2026-11-11T09:05:00Z']);
  });
});

describe('a grid’s step', () => {
  it('is a regular grid’s resolution, or the one gap between evenly spaced coordinates', () => {
    expect(gridStepMs(AIFS)).toBe(6 * 3600000);
    expect(gridStepMs(RADAR)).toBe(5 * 60000);
    expect(gridStepMs(IFS)).toBe(3 * 3600000);
  });

  it('is none where the gaps differ, or there are too few to tell', () => {
    expect(gridStepMs({ grid: { coordinates: ['2026-11-12T00:00:00Z', '2026-11-12T03:00:00Z', '2026-11-12T09:00:00Z'] } } as Temporal)).toBeNull();
    expect(gridStepMs({ grid: { coordinates: ['2026-11-12T00:00:00Z', '2026-11-12T03:00:00Z'] } } as Temporal)).toBeNull();
    expect(gridStepMs({ interval: RADAR.interval })).toBeNull();
  });
});
