import { describe, expect, it } from 'vitest';
import { waypointLetter } from './waypointLetter';

describe('waypointLetter', () => {
  it('letters vertices A to Z, then AA on, as a spreadsheet names columns', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(waypointLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});
