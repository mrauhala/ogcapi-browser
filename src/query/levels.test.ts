import { describe, expect, it } from 'vitest';
import { REPEATING_LEVELS, levelChoice, pickedLevels, startsRepeating, unlistedReason } from './levels';

// MeteoCore's ecmwf-ifs-pressure, as its extent lists them
const LISTED = ['10', '50', '100', '150', '200', '250', '300', '400', '500', '600', '700', '850', '925', '1000'];

describe('levelChoice', () => {
  it('has nothing chosen for no z', () => {
    expect(levelChoice('', LISTED)).toEqual({ chosen: [], unlisted: [] });
  });

  it('reads one level or a list, in the order given', () => {
    expect(levelChoice('850', LISTED)).toEqual({ chosen: ['850'], unlisted: [] });
    expect(levelChoice('1000,925,850', LISTED)).toEqual({ chosen: ['1000', '925', '850'], unlisted: [] });
  });

  it('takes a level however it’s written, as the collection writes it', () => {
    expect(levelChoice(' 1000.0 , 850,', LISTED)).toEqual({ chosen: ['1000', '850'], unlisted: [] });
    expect(levelChoice('1e3', LISTED).chosen).toEqual(['1000']);
  });

  it('keeps what isn’t one of the collection’s, as it was written', () => {
    expect(levelChoice('1000,777,high', LISTED)).toEqual({ chosen: ['1000', '777', 'high'], unlisted: ['777', 'high'] });
  });

  it('never takes nothing for a level, though Number makes it 0', () => {
    expect(levelChoice('1000,,850', ['0', ...LISTED])).toEqual({ chosen: ['1000', '850'], unlisted: [] });
    expect(levelChoice('0', ['', '0']).chosen).toEqual(['0']);
  });
});

describe('pickedLevels', () => {
  it('sends the levels picked in the collection’s order, whatever order they were picked in', () => {
    expect(pickedLevels(['1000', '500', '850'], LISTED)).toBe('500,850,1000');
  });

  it('keeps any not the collection’s first, as they were', () => {
    expect(pickedLevels(['1000', '777', '500', 'high'], LISTED)).toBe('777,high,500,1000');
  });

  it('sends nothing for nothing picked', () => {
    expect(pickedLevels([], LISTED)).toBe('');
  });
});

describe('unlistedReason', () => {
  it('says whether it’s a number the collection doesn’t list, or not a number', () => {
    expect(unlistedReason('777')).toBe("Not one of the collection's levels");
    expect(unlistedReason('high')).toBe('Not a number');
  });
});

describe('repeating intervals', () => {
  it('reads R, the number of intervals, the lowest level and the step', () => {
    expect(REPEATING_LEVELS.exec('R3/500/100')?.slice(1)).toEqual(['3', '500', '100']);
    expect(REPEATING_LEVELS.test('1000/500')).toBe(false);
    expect(REPEATING_LEVELS.test('R/500/100')).toBe(false);
    expect(REPEATING_LEVELS.test('xR3/500/100')).toBe(false);
    expect(REPEATING_LEVELS.test('R3/500/100/1')).toBe(false);
  });

  it('knows one as soon as it’s being typed, so the text field stays', () => {
    expect(startsRepeating('R3')).toBe(true);
    expect(startsRepeating(' R3/500')).toBe(true);
    expect(startsRepeating('R')).toBe(false);
    expect(startsRepeating('1000')).toBe(false);
    expect(startsRepeating('')).toBe(false);
  });
});
