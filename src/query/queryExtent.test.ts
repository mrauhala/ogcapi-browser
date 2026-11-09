import { describe, expect, it } from 'vitest';
import { queryExtent } from './queryExtent';

describe('queryExtent', () => {
  it('has nothing to show where the query has nothing on the map', () => {
    expect(queryExtent({})).toBeNull();
    expect(queryExtent({ points: [], polygons: [], bbox: null })).toBeNull();
    expect(queryExtent({ points: [[NaN, 60]] })).toBeNull();
  });

  it('spans a path’s points, and is a point where there’s one', () => {
    expect(queryExtent({ points: [[24, 60], [26, 62], [25, 61]] })).toEqual([24, 60, 26, 62]);
    expect(queryExtent({ points: [[24.94, 60.17]] })).toEqual([24.94, 60.17, 24.94, 60.17]);
  });

  it('spans every polygon’s rings, and a box', () => {
    expect(queryExtent({ polygons: [[[5, 54], [32, 54], [32, 71], [5, 71], [5, 54]], [[40, 10], [41, 10], [41, 11], [40, 10]]] })).toEqual([5, 10, 41, 71]);
    expect(queryExtent({ bbox: [20, 59, 31, 70] })).toEqual([20, 59, 31, 70]);
  });

  it('puts a radius around each point, wider in longitude away from the equator', () => {
    const [west, south, east, north] = queryExtent({ points: [[25, 60]], radiusMeters: 111320 })!;
    expect(north - 60).toBeCloseTo(1, 6);
    expect(60 - south).toBeCloseTo(1, 6);
    // A degree of longitude at 60° is half one at the equator
    expect(east - 25).toBeCloseTo(2, 6);
    expect(25 - west).toBeCloseTo(2, 6);
    expect(queryExtent({ points: [[0, 0]], radiusMeters: 111320 })).toEqual([-1, -1, 1, 1]);
  });

  it('keeps a radius near a pole on the globe, and ignores one that isn’t above zero', () => {
    const [, south, , north] = queryExtent({ points: [[0, 89.5]], radiusMeters: 222640 })!;
    expect(north).toBe(90);
    expect(south).toBeCloseTo(87.5, 6);
    const [, southPole, , northOfIt] = queryExtent({ points: [[0, -89.5]], radiusMeters: 222640 })!;
    expect(southPole).toBe(-90);
    expect(northOfIt).toBeCloseTo(-87.5, 6);
    expect(queryExtent({ points: [[25, 60]], radiusMeters: -5 })).toEqual([25, 60, 25, 60]);
  });

  it('leaves out a point that isn’t one, and keeps the rest', () => {
    expect(queryExtent({ points: [[24, 60], [Infinity, 61], [26, 62]] })).toEqual([24, 60, 26, 62]);
  });
});
