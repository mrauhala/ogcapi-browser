import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Feature } from 'geojson';
import { LocationPicker, ParameterPicker } from './SearchPickers';
import { namedParameter } from './pickerSearch';
import { withClass, words } from '../coverage/cellsTestData';

const PARAMETERS = [namedParameter('t', { label: 'Temperature' }), namedParameter('r', { label: 'Relative humidity' }), namedParameter('ws', { label: 'Wind speed' })];
const parameters = (chosen: string[], error = false) => renderToStaticMarkup(
  <ParameterPicker parameters={PARAMETERS} chosen={chosen} onChange={() => {}} error={error} />,
);

describe('ParameterPicker', () => {
  it('is a field to type in, saying it searches, with nothing chosen', () => {
    const html = parameters([]);
    expect(html).toContain('placeholder="Pick from 3, or type to search"');
    expect(html).toContain('aria-label="parameter-name"');
    expect(html).toContain('role="combobox"');
    expect(withClass(html, 'MuiChip-root')).toBe(0);
  });

  it('shows the chosen as chips, by id, in the order chosen', () => {
    const html = parameters(['ws', 't']);
    expect(withClass(html, 'MuiChip-root')).toBe(2);
    expect(words(html)).toContain('ws t');
    expect(html).toContain('placeholder="Type to add"');
    expect(withClass(html, 'MuiChip-outlined')).toBe(0);
  });

  it('keeps one the collection doesn’t list, as from a link, outlined to be seen and taken out', () => {
    const html = parameters(['t', 'nope']);
    expect(withClass(html, 'MuiChip-root')).toBe(2);
    expect(withClass(html, 'MuiChip-outlined')).toBe(1);
    expect(words(html)).toContain('nope');
  });

  it('shows an error the field has', () => {
    expect(withClass(parameters([], true), 'Mui-error')).toBeGreaterThan(0);
    expect(withClass(parameters([]), 'Mui-error')).toBe(0);
  });
});

const feature = (id: string, name?: string) => ({ type: 'Feature', id, geometry: null, properties: name ? { name } : {} }) as unknown as Feature;
const PLACES = [feature('101786', 'Oulu airport'), feature('100683', 'Kilpilahti'), feature('0-246-0-100907')];
const location = (selected: Feature | null) => renderToStaticMarkup(<LocationPicker features={PLACES} selected={selected} onChange={() => {}} />);

describe('LocationPicker', () => {
  it('is a field to type in, saying none lists them all', () => {
    const html = location(null);
    expect(html).toContain('placeholder="None: list them all, or type to search"');
    expect(html).toContain('aria-label="location"');
    expect(html).toContain('value=""');
  });

  it('shows the location picked by its id and its name, or its id alone', () => {
    expect(location(PLACES[0])).toContain('value="101786 · Oulu airport"');
    expect(location(PLACES[2])).toContain('value="0-246-0-100907"');
    // One picked on the map that the list doesn't have still shows
    expect(location(feature('999', 'Elsewhere'))).toContain('value="999 · Elsewhere"');
  });
});
