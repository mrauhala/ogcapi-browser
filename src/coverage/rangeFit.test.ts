import { describe, expect, it } from 'vitest';
import { rangeMisfit } from './rangeFit';
import { COVJSON } from '../standards';

// A grid of 3 × 2 at one time and one level, as most servers send one
const LENGTHS = { t: 1, z: 1, y: 2, x: 3 };
const range = (members: Record<string, unknown>) => ({ type: 'NdArray', dataType: 'float', ...members });
const six = [1, 2, 3, 4, 5, 6];

describe('rangeMisfit', () => {
  it('passes a range whose names, shape and values are the axes', () => {
    expect(rangeMisfit('a', range({ axisNames: ['t', 'z', 'y', 'x'], shape: [1, 1, 2, 3], values: six }), LENGTHS)).toBeNull();
    expect(rangeMisfit('a', range({ axisNames: ['x', 'y'], shape: [3, 2], values: six }), LENGTHS)).toBeNull();
  });

  it('lets single-valued axes be left out, as the standard does', () => {
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], shape: [2, 3], values: six }), LENGTHS)).toBeNull();
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], values: six }), LENGTHS)).toBeNull();
  });

  it('makes a fault of as many names as shape has, before anything else', () => {
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], shape: [1, 2, 3], values: [1] }), LENGTHS)).toEqual({ member: 'shape', message: 'a: axisNames has 2 names, shape has 3', rule: COVJSON.axisNames });
  });

  it('makes a fault of a shape that makes more values or fewer than there are, in numbers that read', () => {
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], shape: [2, 3], values: [1, 2, 3, 4, 5] }), LENGTHS)).toEqual({ member: 'values', message: 'a: shape 2 × 3 makes 6 values, and values has 5', rule: COVJSON.shapeProduct });
    const big = { y: 40, x: 50 };
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], shape: [40, 50], values: new Array(1999).fill(0) }), big)?.message).toBe('a: shape 40 × 50 makes 2,000 values, and values has 1,999');
  });

  it('makes a fault of a name that isn’t an axis, which is Polytope’s parameter id', () => {
    expect(rangeMisfit('2t', range({ axisNames: ['2t'], shape: [66], values: new Array(66).fill(0) }), { composite: 66, t: 1 })).toEqual({ member: 'axisNames', message: `2t: axisNames has "2t", which isn't an axis of the domain`, rule: COVJSON.rangesFitDomain });
  });

  it('takes no name for an axis because an object has it', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(rangeMisfit('a', range({ axisNames: [name, 'x'], shape: [1, 3], values: [1, 2, 3] }), { x: 3 })?.member).toBe('axisNames');
    }
  });

  it('names the first axis whose shape is wrong', () => {
    expect(rangeMisfit('a', range({ axisNames: ['x', 'y'], shape: [2, 3], values: six }), LENGTHS)).toEqual({ member: 'shape', message: 'a: shape says x has 2 values, and the axis has 3', rule: COVJSON.rangesFitDomain });
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], shape: [2, 4], values: new Array(8).fill(0) }), LENGTHS)?.message).toBe('a: shape says x has 4 values, and the axis has 3');
  });

  it('counts the values against the named axes when there is no shape', () => {
    expect(rangeMisfit('a', range({ axisNames: ['y', 'x'], values: [1, 2, 3] }), LENGTHS)).toEqual({ member: 'values', message: 'a: axisNames y, x make 6 values, and values has 3', rule: [COVJSON.shape, COVJSON.rangesFitDomain] });
  });

  it('makes a fault of an axis of many values left out of the names', () => {
    expect(rangeMisfit('a', range({ axisNames: ['x'], shape: [3], values: [1, 2, 3] }), LENGTHS)).toEqual({ member: 'axisNames', message: 'a: axisNames has no y, and y has 2 values', rule: COVJSON.rangesFitDomain });
  });

  it('counts the values against every axis without names or shape', () => {
    expect(rangeMisfit('a', range({ values: six }), LENGTHS)).toBeNull();
    expect(rangeMisfit('a', range({ values: [1, 2] }), LENGTHS)).toEqual({ member: 'values', message: "a: the domain's axes make 6 values, and values has 2", rule: [COVJSON.shape, COVJSON.rangesFitDomain] });
  });

  it('can say nothing of names it doesn’t have, beyond the shape', () => {
    expect(rangeMisfit('a', range({ shape: [6], values: six }), LENGTHS)).toBeNull();
    expect(rangeMisfit('a', range({ shape: [6], values: [1] }), LENGTHS)?.member).toBe('values');
  });

  it('checks a TiledNdArray by its names and shape, its values being in tiles', () => {
    const tiled = (members: Record<string, unknown>) => ({ type: 'TiledNdArray', dataType: 'float', tileSets: [], ...members });
    expect(rangeMisfit('a', tiled({ axisNames: ['y', 'x'], shape: [2, 3] }), LENGTHS)).toBeNull();
    expect(rangeMisfit('a', tiled({ axisNames: ['y', 'x'], shape: [2, 2] }), LENGTHS)?.member).toBe('shape');
    expect(rangeMisfit('a', tiled({ axisNames: ['y', 'lon'], shape: [2, 3] }), LENGTHS)?.member).toBe('axisNames');
    expect(rangeMisfit('a', tiled({}), LENGTHS)).toBeNull();
  });
});
