import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import type { Collection } from '../types/api';
import { filterParameters, moreCount, namedParameter, NONE, parametersOf, placeOf, placesShown, SHOWN, type NamedParameter } from './pickerSearch';

// MeteoCore ecmwf-ifs-pressure's parameters, as it lists them (2026-11-10), four of thirteen
const PARAMETERS: NamedParameter[] = [
  namedParameter('dpt', { label: 'Dew point temperature', observedProperty: { label: { en: 'Dew point temperature' } } }),
  namedParameter('t', { label: 'Temperature', observedProperty: { label: { en: 'Temperature' } } }),
  namedParameter('ws', { label: 'Wind speed', observedProperty: { label: { en: 'Wind speed' } } }),
  namedParameter('wdir', { observedProperty: { label: 'Wind direction' } }),
];
const found = (typed: string) => filterParameters(PARAMETERS, { inputValue: typed, getOptionLabel: parameter => parameter.id }).map(parameter => parameter.id);

describe('namedParameter', () => {
  it('shows the parameter’s own label, else its observed property’s, and finds it by both', () => {
    expect(PARAMETERS[1]).toEqual({ id: 't', label: 'Temperature', words: 'Temperature Temperature' });
    expect(PARAMETERS[3]).toEqual({ id: 'wdir', label: 'Wind direction', words: 'Wind direction' });
    expect(namedParameter('q', { label: 'Specific humidity', observedProperty: { label: 'Humidity, specific' } }).words).toBe('Specific humidity Humidity, specific');
    expect(namedParameter('x', undefined)).toEqual({ id: 'x', label: 'x', words: '' });
    expect(namedParameter('x', { label: '  ' }).words).toBe('');
  });
});

describe('parametersOf', () => {
  it('reads parameter_names as a list or as a map, with each one’s labels', () => {
    const listed = { parameter_names: [{ id: 't', label: 'Temperature', observedProperty: { label: 'Air temperature' } }] } as unknown as Collection;
    expect(parametersOf(listed)).toEqual([{ id: 't', label: 'Temperature', words: 'Temperature Air temperature' }]);
    const mapped = { parameter_names: { ws: { observedProperty: { label: { en: 'Wind speed' } } } } } as unknown as Collection;
    expect(parametersOf(mapped)).toEqual([{ id: 'ws', label: 'Wind speed', words: 'Wind speed' }]);
    expect(parametersOf({} as Collection)).toEqual([]);
  });
});

describe('filterParameters', () => {
  it('finds a parameter by any part of its id or a label, ignoring case', () => {
    expect(found('temp')).toEqual(['dpt', 't']);
    expect(found('WIND')).toEqual(['ws', 'wdir']);
    expect(found('dir')).toEqual(['wdir']);
    expect(found('ws')).toEqual(['ws']);
    expect(found('')).toEqual(['dpt', 't', 'ws', 'wdir']);
    expect(found('pressure')).toEqual([]);
  });
});

const feature = (id: string | number, properties: Record<string, unknown> = {}) => ({ type: 'Feature', id, geometry: null, properties }) as unknown as Feature;

describe('placeOf', () => {
  it('names a location by its name, else its label, else its title, where that says more than its id', () => {
    expect(placeOf(feature(101786, { name: 'Oulu airport' }))).toMatchObject({ key: '101786', name: 'Oulu airport' });
    expect(placeOf(feature('0-148-0-CHD64901', { label: ' Abéché ' })).name).toBe('Abéché');
    expect(placeOf(feature('a', { title: 'Station A', name: '' })).name).toBe('Station A');
    expect(placeOf(feature('0-246-0-100683', { label: '0-246-0-100683' })).name).toBe('');
    expect(placeOf(feature('b', { name: 7 })).name).toBe('');
    expect(placeOf(feature('c')).feature?.id).toBe('c');
  });
});

describe('placesShown', () => {
  const places = [feature(101482, { name: 'Koulukatu' }), feature(101786, { name: 'Oulu airport' }), feature(100683, { name: 'Kilpilahti' })].map(placeOf);
  const keys = (rows: ReturnType<typeof placesShown>) => rows.map(row => row.key);

  it('starts with None, then every location, while nothing is typed', () => {
    expect(placesShown(places, '')).toEqual([NONE, ...places]);
    expect(placesShown(places, '   ')[0]).toBe(NONE);
  });

  it('finds a location by any part of its id or name, ignoring case, and drops None', () => {
    expect(keys(placesShown(places, 'oulu'))).toEqual(['101482', '101786']);
    expect(keys(placesShown(places, ' 1017 '))).toEqual(['101786']);
    expect(keys(placesShown(places, 'KILPI'))).toEqual(['100683']);
    expect(placesShown(places, 'helsinki')).toEqual([]);
  });

  it('shows at most 200, and then how many more typing would narrow down', () => {
    const many = Array.from({ length: SHOWN + 33 }, (_, i) => placeOf(feature(`0-246-0-${100000 + i}`)));
    const all = placesShown(many, '');
    expect(all.length).toBe(1 + SHOWN + 1);
    expect(moreCount(all[all.length - 1])).toBe(33);
    expect(all.slice(0, -1).every(row => moreCount(row) === null)).toBe(true);
    expect(moreCount(placesShown(many, '0-246')[SHOWN])).toBe(33);
    expect(placesShown(many.slice(0, SHOWN), 'x').length).toBe(0);
    expect(placesShown(many.slice(0, SHOWN), '').length).toBe(SHOWN + 1);
  });
});
