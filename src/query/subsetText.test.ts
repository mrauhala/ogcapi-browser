import { describe, expect, it } from 'vitest';
import { axisBody, axisOfPart, parsePart, subsetAxes, subsetIn, subsetParts, subsetValue, unquoted, withAxis } from './subsetText';

const RUN = 'reference_time("2026-11-12T00:00:00Z")';

describe('a subset’s parts', () => {
  it('split at the commas outside quotes and parentheses, trimmed', () => {
    expect(subsetParts('Lon(19:32), Lat(59:70)')).toEqual(['Lon(19:32)', 'Lat(59:70)']);
    expect(subsetParts(`${RUN},vertical(850)`)).toEqual([RUN, 'vertical(850)']);
    expect(subsetParts('name("a,b"),x(1)')).toEqual(['name("a,b")', 'x(1)']);
    expect(subsetParts('a(f(1,2)),b(3)')).toEqual(['a(f(1,2))', 'b(3)']);
    expect(subsetParts('  ')).toEqual([]);
    expect(subsetParts('Lon(1:2),,Lat(3)')).toEqual(['Lon(1:2)', '', 'Lat(3)']);
  });

  it('name their axes, in order, and give each axis its body as typed', () => {
    expect(subsetAxes(`Lon(19:32),${RUN},broken`)).toEqual(['Lon', 'reference_time']);
    expect(axisOfPart('vertical (850)')).toBe('vertical');
    expect(axisOfPart('(850)')).toBeNull();
    expect(axisBody(`Lon(19:32),${RUN}`, 'reference_time')).toBe('"2026-11-12T00:00:00Z"');
    expect(axisBody('Lon( 19:32 )', 'Lon')).toBe('19:32');
    expect(axisBody('Lon(19:32)', 'Lat')).toBeNull();
  });

  it('are read from every subset parameter of a line, as one', () => {
    expect(subsetIn('https://a.example/map?subset=Lon(1:2)&f=x&subset=%20&subset=vertical(850)')).toBe('Lon(1:2),vertical(850)');
    expect(subsetIn('https://a.example/map')).toBe('');
  });
});

describe('withAxis', () => {
  it('puts an axis in its part’s place, or after the others, keeping the rest as typed', () => {
    expect(withAxis('', 'vertical', '850')).toBe('vertical(850)');
    expect(withAxis('Lon(19:32), Lat(59:70)', 'vertical', '850')).toBe('Lon(19:32),Lat(59:70),vertical(850)');
    expect(withAxis('vertical(850),Lon(19:32)', 'vertical', '500')).toBe('vertical(500),Lon(19:32)');
    expect(withAxis(`${RUN},vertical(850)`, 'reference_time', '*')).toBe('reference_time(*),vertical(850)');
  });

  it('takes an axis out with null, and leaves a text without it alone', () => {
    expect(withAxis('vertical(850),Lon(19:32)', 'vertical', null)).toBe('Lon(19:32)');
    expect(withAxis('vertical(850)', 'vertical', null)).toBe('');
    expect(withAxis('Lon(1:2) ,,', 'vertical', null)).toBe('Lon(1:2) ,,');
    // An empty part goes when another axis is written in
    expect(withAxis('Lon(1:2),,', 'vertical', '850')).toBe('Lon(1:2),vertical(850)');
  });
});

describe('the grammar of a part', () => {
  it('takes a number, quoted text or *, one or an interval', () => {
    expect(parsePart('Lon(19:32)')).toEqual({ axis: 'Lon', values: ['19', '32'] });
    expect(parsePart('Lat(-9.5e1)')).toEqual({ axis: 'Lat', values: ['-9.5e1'] });
    expect(parsePart('time("2026-11-12T00:00:00Z":"2026-11-12T06:00:00Z")')).toEqual({ axis: 'time', values: ['"2026-11-12T00:00:00Z"', '"2026-11-12T06:00:00Z"'] });
    expect(parsePart('time(*)')).toEqual({ axis: 'time', values: ['*'] });
    expect(parsePart('E(*:500000)')).toEqual({ axis: 'E', values: ['*', '500000'] });
    // An additional dimension's name, with _, as General Subsetting's own example has one
    expect(parsePart('atm_pressure_hpa(500)')).toEqual({ axis: 'atm_pressure_hpa', values: ['500'] });
  });

  it('says what’s wrong with anything else', () => {
    expect(parsePart('')).toEqual({ error: 'An empty part between commas' });
    expect(parsePart('Lon')).toEqual({ error: "Lon isn't axis(value) or axis(low:high)" });
    expect(parsePart('Lon(1)x')).toEqual({ error: "Lon(1)x isn't axis(value) or axis(low:high)" });
    expect(parsePart('1x(5)')).toEqual({ error: '1x isn\'t an axis name: a letter, then letters, digits or _' });
    expect(parsePart('(5)')).toEqual({ error: "The part isn't an axis name: a letter, then letters, digits or _" });
    expect(parsePart('Lon(1:2:3)')).toEqual({ error: 'Lon(1:2:3) has more than a low and a high' });
    expect(parsePart('Lon(:32)')).toEqual({ error: 'Lon(:32) is missing an end' });
    expect(parsePart('vertical()')).toEqual({ error: 'vertical() is missing its value' });
    expect(parsePart('vertical(abc)')).toEqual({ error: "abc in vertical(…) isn't a number, text in double quotes, or *" });
    expect(parsePart('time(2026-11-12T00:00:00Z)')).toEqual({ error: "2026-11-12T00:00:00Z in time(…) isn't a number, text in double quotes, or *: a time goes in double quotes" });
    expect(parsePart('time("2026-11-12)')).toEqual({ error: "\"2026-11-12 in time(…) isn't a number, text in double quotes, or *" });
  });
});

describe('a value as written', () => {
  it('is a number as it is, anything else quoted, and read back without its quotes', () => {
    expect(subsetValue(850)).toBe('850');
    expect(subsetValue('850')).toBe('850');
    expect(subsetValue('2026-11-12T00:00:00Z')).toBe('"2026-11-12T00:00:00Z"');
    expect(unquoted('"2026-11-12T00:00:00Z"')).toBe('2026-11-12T00:00:00Z');
    expect(unquoted('*')).toBe('*');
  });
});
