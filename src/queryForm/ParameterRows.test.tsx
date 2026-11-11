import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ParameterRows, { FILTER_FROM } from './ParameterRows';
import { nextChosen } from './rowChoice';
import { words } from '../coverage/cellsTestData';
import { mapStylesOf, withLinkQueries } from '../query/mapQuery';
import { parameterRows, type ParameterRow } from '../query/mapOffer';
import type { Collection } from '../types/api';
import meteocore from '../query/__fixtures__/meteocore-maps-params.json';

const collectionOf = (id: string) => withLinkQueries(structuredClone(meteocore.collections.find(each => each.id === id)) as unknown as Collection);
const AIFS = parameterRows(collectionOf('ecmwf-aifs-single'), mapStylesOf(meteocore.styles['ecmwf-aifs-single'].styles));
const IFS = parameterRows(collectionOf('ecmwf-ifs-pressure'), mapStylesOf(meteocore.styles['ecmwf-ifs-pressure'].styles));

const render = (rows: ParameterRow[], chosen: string[] = [], several = false) => renderToStaticMarkup(
  <ParameterRows rows={rows} chosen={chosen} several={several} onChange={() => {}} />,
);
const count = (html: string, text: string) => html.split(text).length - 1;
// Each row's role and whether it's checked, in order
const states = (html: string) => html.split('<button').slice(1).map(button => [
  button.includes('role="radio"') ? 'radio' : button.includes('role="checkbox"') ? 'checkbox' : '?',
  button.includes('aria-checked="true"'),
]);

describe('ParameterRows', () => {
  it('are a row per parameter: the id, its label, the styles for it and its unit, as radios with none chosen', () => {
    const html = render(IFS);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="parameter-name"');
    expect(states(html)).toEqual(IFS.map(() => ['radio', false]));
    expect(words(html)).toContain('q Specific humidity kg/kg');
    expect(words(html)).toContain('gh Geopotential height styles: contours gpm');
    expect(words(html)).toContain('t Temperature styles: contours, fmi-hires °C');
    // Twelve, too few to filter
    expect(IFS).toHaveLength(FILTER_FROM);
    expect(html).not.toContain('Filter the parameters');
  });

  it('check the one chosen', () => {
    expect(states(render(IFS, ['t'])).map(([, on]) => on).indexOf(true)).toBe(IFS.findIndex(row => row.id === 't'));
    expect(count(render(IFS, ['t']), 'aria-checked="true"')).toBe(1);
  });

  it('are checkboxes where several can be chosen, each chosen one checked', () => {
    const html = render(IFS, ['t', 'gh'], true);
    expect(html).toContain('role="group"');
    expect(new Set(states(html).map(([role]) => role))).toEqual(new Set(['checkbox']));
    expect(count(html, 'aria-checked="true"')).toBe(2);
  });

  it('show one not among parameter_names first, chosen, in orange, to be taken out', () => {
    const html = render(IFS, ['nope', 't']);
    expect(words(html.slice(0, html.indexOf('</button>')))).toBe('nope Not among parameter_names');
    expect(states(html)[0]).toEqual(['radio', true]);
    expect(states(html)).toHaveLength(IFS.length + 1);
  });

  it('offer a filter past twelve', () => {
    const html = render(AIFS);
    expect(html).toContain('aria-label="Filter the parameters"');
    expect(html).toContain('placeholder="Filter the 18 by id or label"');
    expect(states(html)).toHaveLength(18);
  });

  it('show no label that only repeats the id, and no unit where there’s none', () => {
    expect(words(render([{ id: 'x', label: null, unit: '', styles: [] }]))).toBe('x');
  });
});

describe('nextChosen', () => {
  it('one at a time: the row tapped, or none where it was the one chosen', () => {
    expect(nextChosen(IFS, [], 't', false)).toEqual(['t']);
    expect(nextChosen(IFS, ['gh'], 't', false)).toEqual(['t']);
    expect(nextChosen(IFS, ['t'], 't', false)).toEqual([]);
    // Of several from a link, the one tapped
    expect(nextChosen(IFS, ['t', 'gh'], 't', false)).toEqual(['t']);
  });

  it('several: added or taken out, in the rows’ order, with those not listed first', () => {
    expect(nextChosen(IFS, ['t'], 'gh', true)).toEqual(['gh', 't']);
    expect(nextChosen(IFS, ['gh', 't'], 'gh', true)).toEqual(['t']);
    expect(nextChosen(IFS, ['t', 'nope'], 'd', true)).toEqual(['nope', 'd', 't']);
    expect(nextChosen(IFS, ['t', 'nope'], 'nope', true)).toEqual(['t']);
  });
});
