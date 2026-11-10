import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RadiusUnits from './RadiusUnits';
import type { Collection } from './types/api';
import { toggledUnit } from './query/units';
import { words } from './coverage/cellsTestData';
import meteocoreObs from './query/__fixtures__/meteocore-fmi-obs.json';

const METEOCORE = meteocoreObs as unknown as Collection;
const render = (queryKey: string | null, value = '', collection = METEOCORE) => renderToStaticMarkup(
  <RadiusUnits target={queryKey ? { collection, queryKey } : null} value={value} onChange={() => {}} />,
);
const pressed = (html: string) => html.split('<button').slice(1).map(button => button.includes('aria-pressed="true"'));

describe('RadiusUnits, the map card’s', () => {
  it('offers the units the radius query lists, none picked to start', () => {
    const html = render('radius');
    expect(words(html)).toBe('km m mi');
    expect(pressed(html)).toEqual([false, false, false]);
    expect(html).toContain('aria-label="within-units"');
  });

  it('shows the unit picked, in the card as in the form', () => {
    expect(pressed(render('radius', 'm'))).toEqual([false, true, false]);
  });

  it('shows nothing for a query that lists no units, or with no radius query', () => {
    expect(render('position')).toBe('');
    expect(render(null)).toBe('');
  });
});

describe('toggledUnit', () => {
  it('picks the unit clicked, and takes it back when it was the one picked', () => {
    expect(toggledUnit('', 'km')).toBe('km');
    expect(toggledUnit('m', 'km')).toBe('km');
    expect(toggledUnit('km', 'km')).toBe('');
  });
});
