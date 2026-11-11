import { describe, expect, it } from 'vitest';
import { styleHints } from './styleHints';
import { mapStylesOf } from '../query/mapQuery';
import type { MapStylesState } from '../hooks/useMapStyles';
import meteocore from '../query/__fixtures__/meteocore-maps.json';

const IFS = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure';
const styles = mapStylesOf(meteocore.styles['ecmwf-ifs-pressure'].styles);
const state = (overrides: Partial<MapStylesState> = {}): MapStylesState => ({ status: 'ready', styles, source: 'link', ...overrides });
const pick = (id: string) => styles.find(style => style.id === id);

describe('styleHints', () => {
  it('says where the styles were read, and nothing more with none picked', () => {
    expect(styleHints(state(), undefined, '')).toEqual(['From the collection\'s `styles` link']);
    expect(styleHints(state({ source: 'collection' }), undefined, '')).toEqual(['From the collection\'s own `styles`']);
    expect(styleHints(state({ status: 'error', source: 'collection' }), undefined, ''))
      .toEqual(['From the collection\'s own `styles`: its `styles` link couldn\'t be read']);
    expect(styleHints(state({ status: 'loading', styles: [], source: null }), undefined, '')).toEqual([]);
  });

  it('says what a style picked is, its own map link, what that adds to the request, and what it’s for', () => {
    expect(styleHints(state(), pick('contours'), 'contours')).toEqual([
      'From the collection\'s `styles` link',
      'contours. Its map link: `…/styles/contours/map?parameter-name=gh`',
      'The link adds `parameter-name=gh`, which the request now has',
      'For `gh`, `z`, `t`, `dpt`, as its `parameters` say',
    ]);
    expect(styleHints(state(), pick('default'), 'default')).toEqual(['From the collection\'s `styles` link', 'Default. Its map link: `…/styles/default/map`']);
  });

  it('doesn’t claim the link’s additions for a request that has the path, as from a typed URL', () => {
    expect(styleHints(state(), pick('contours'), 'contours', false)[2])
      .toBe('The link adds `parameter-name=gh`. This request has the path, from what was typed, and only what was typed with it');
  });

  it('says how a style without a map link of its own is asked for', () => {
    const own = { id: 'night', href: null, parameters: [] };
    expect(styleHints(state({ styles: [own] }), own, 'night')[1]).toBe('It has no map link of its own: sent by the path Maps gives a style, `…/styles/night/map`');
  });

  it('says a style the request names isn’t among those listed, once they’re in', () => {
    expect(styleHints(state(), undefined, 'nope')).toEqual([
      'From the collection\'s `styles` link',
      '`nope` isn\'t among the styles listed. Sent by the path Maps gives a style, `…/styles/{styleId}/map`',
    ]);
    expect(styleHints(state({ status: 'loading', styles: [], source: null }), undefined, 'nope')).toEqual([]);
  });

  it('shows a link elsewhere in full', () => {
    const odd = { id: 'x', title: 'X', href: `${IFS}/render?s=x`, parameters: [] };
    expect(styleHints(state({ styles: [odd] }), odd, 'x')[1]).toBe('X. Its map link: `…/collections/ecmwf-ifs-pressure/render?s=x`');
  });
});
