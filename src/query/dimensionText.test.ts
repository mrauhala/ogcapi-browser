import { describe, expect, it } from 'vitest';
import { intervalEnds, intervalText, modeOf, switchMode, wholeValue, withEnd } from './dimensionText';

// z's forms are EDR's (1.1 /req/edr/z-response, and 1.2's open ends); a time's interval may be open at either end
describe('intervalEnds', () => {
  it('reads an interval, whole, open or still missing an end', () => {
    expect(intervalEnds('1000/500')).toEqual({ start: '1000', end: '500' });
    expect(intervalEnds(' 1000 / 500 ')).toEqual({ start: '1000', end: '500' });
    expect(intervalEnds('500/..')).toEqual({ start: '500', end: '..' });
    expect(intervalEnds('850/')).toEqual({ start: '850', end: '' });
    expect(intervalEnds('/300')).toEqual({ start: '', end: '300' });
  });

  it('sees no interval in one value, a list, a repeating interval or more than one slash', () => {
    expect(intervalEnds('')).toBeNull();
    expect(intervalEnds('850')).toBeNull();
    expect(intervalEnds('1000,925,850')).toBeNull();
    expect(intervalEnds('R5/100/50')).toBeNull();
    // Being typed: R5/100 is a repeating interval on its way, not a range from R5
    expect(intervalEnds('R5/100')).toBeNull();
    expect(intervalEnds('a/b/c')).toBeNull();
  });
});

describe('modeOf', () => {
  it('shows an interval as a range, and anything else as values', () => {
    expect(modeOf('1000/500')).toBe('range');
    expect(modeOf('850/')).toBe('range');
    expect(modeOf('2026-11-05T00:00:00Z/..')).toBe('range');
    expect(['', '850', '1000,925', 'R5/100/50'].map(modeOf)).toEqual(['individual', 'individual', 'individual', 'individual']);
  });
});

describe('intervalText', () => {
  it('writes both ends, or leaves the one still to pick empty', () => {
    expect(intervalText('850', '300')).toBe('850/300');
    expect(intervalText('850', '')).toBe('850/');
    expect(intervalText('', '300')).toBe('/300');
    expect(intervalText('', '')).toBe('');
  });

  it("leaves a time's missing end open", () => {
    expect(intervalText('2026-11-05T00:00:00Z', '', true)).toBe('2026-11-05T00:00:00Z/..');
    expect(intervalText('', '2026-11-05T00:00:00Z', true)).toBe('../2026-11-05T00:00:00Z');
    expect(intervalText('', '', true)).toBe('');
  });
});

describe('withEnd', () => {
  it('sets one end and keeps the other', () => {
    expect(withEnd('', 'start', '850')).toBe('850/');
    expect(withEnd('850/', 'end', '300')).toBe('850/300');
    expect(withEnd('850/300', 'start', '1000')).toBe('1000/300');
    expect(withEnd('850/300', 'end', '')).toBe('850/');
    expect(withEnd('850/', 'start', '')).toBe('');
  });

  it('starts a range from what isn’t one', () => {
    expect(withEnd('1000,925', 'end', '300')).toBe('/300');
  });

  it("takes a time's open end for one still to pick", () => {
    expect(withEnd('', 'start', 'a', true)).toBe('a/..');
    expect(withEnd('a/..', 'end', 'b', true)).toBe('a/b');
    expect(withEnd('../b', 'start', 'a', true)).toBe('a/b');
    expect(withEnd('a/b', 'start', '', true)).toBe('../b');
    expect(withEnd('a/..', 'start', '', true)).toBe('');
    // A level's typed open end is kept as it is
    expect(withEnd('500/..', 'start', '850')).toBe('850/..');
  });
});

describe('switchMode', () => {
  it('makes one level a range’s start, and a range with one end that level again', () => {
    expect(switchMode('500', 'range')).toBe('500/');
    expect(switchMode('500/', 'individual')).toBe('500');
    expect(switchMode('/300', 'individual')).toBe('300');
  });

  it('keeps what the other control can’t hold, for the field to show as text', () => {
    expect(switchMode('1000,925,850', 'range')).toBe('1000,925,850');
    expect(switchMode('R5/100/50', 'range')).toBe('R5/100/50');
    expect(switchMode('1000/500', 'individual')).toBe('1000/500');
    expect(switchMode('', 'range')).toBe('');
    expect(switchMode('', 'individual')).toBe('');
  });

  it('leaves a text already in the mode as it is', () => {
    expect(switchMode('1000/500', 'range')).toBe('1000/500');
    expect(switchMode('850/', 'range')).toBe('850/');
    expect(switchMode('500', 'individual')).toBe('500');
  });

  it("makes a time an open range's start, and a range one time: its start, or its end if open at the start", () => {
    expect(switchMode('a', 'range', true)).toBe('a/..');
    expect(switchMode('a/..', 'individual', true)).toBe('a');
    expect(switchMode('a/b', 'individual', true)).toBe('a');
    expect(switchMode('../b', 'individual', true)).toBe('b');
    expect(switchMode('../..', 'individual', true)).toBe('');
  });
});

describe('wholeValue', () => {
  it('is the text, unless it’s a range still missing an end', () => {
    expect(wholeValue('850/')).toBe('');
    expect(wholeValue('/300')).toBe('');
    expect(wholeValue('850/300')).toBe('850/300');
    expect(wholeValue('500/..')).toBe('500/..');
    expect(wholeValue(' 1000,925 ')).toBe('1000,925');
    expect(wholeValue('R5/100/50')).toBe('R5/100/50');
    expect(wholeValue('')).toBe('');
  });
});
