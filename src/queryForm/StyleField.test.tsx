import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme } from '@mui/material/styles';
import StyleField from './StyleField';
import { words } from '../coverage/cellsTestData';
import { mapStylesOf } from '../query/mapQuery';
import type { MapStylesState } from '../hooks/useMapStyles';
import meteocore from '../query/__fixtures__/meteocore-maps.json';
import params from '../query/__fixtures__/meteocore-maps-params.json';
import draft from '../query/__fixtures__/metocean-maps-draft.json';
import type { Collection } from '../types/api';
import type { QueryIssue } from '../query/types';

vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: [], apiUrl: 'https://meteocore.app.meteo.fi' }) }));

const styles = mapStylesOf(meteocore.styles['fmi-radar-composite-dbz'].styles);
const render = (state: Partial<MapStylesState>, styleId = '') => renderToStaticMarkup(
  <StyleField state={{ status: 'ready', styles, source: 'link', ...state }} styleId={styleId} onChange={() => {}} />,
);
const count = (html: string, text: string) => html.split(text).length - 1;
// words() reads code as its own word, so a comma after it stands apart

describe('StyleField', () => {
  it('is the style, a part of the path: the ids in the order listed, none picked, and what that leaves out', () => {
    const html = render({});
    expect(html).toContain('id="query-field-style"');
    expect(words(html)).toBe('Style style (path) 3 listed · optional default radar_dbz radar_fmi From the collection\'s styles link '
      + 'Left out: the collection\'s own …/map , in the server\'s default style');
    expect(count(html, 'aria-pressed="true"')).toBe(0);
  });

  it('presses the style picked, and says what it is in place of what’s left out', () => {
    const html = render({}, 'radar_fmi');
    expect(count(html, 'aria-pressed="true"')).toBe(1);
    expect(html).toContain('value="radar_fmi" aria-pressed="true"');
    expect(words(html)).toContain('FMI Radar. Its map link: …/styles/radar_fmi/map');
    expect(words(html)).not.toContain('Left out');
  });

  it('shows a style the request names that isn’t listed, in orange, and says so', () => {
    const html = render({}, 'nope');
    expect(html).toContain('value="nope"');
    expect(words(html)).toContain('nope isn\'t among the styles listed');
  });

  it('says the styles are loading', () => {
    expect(words(render({ status: 'loading', styles: [], source: null }))).toBe('Style style (path) optional Loading styles… '
      + 'Left out: the collection\'s own …/map , in the server\'s default style');
  });

  it('says when the styles link fails and the collection lists none', () => {
    expect(words(render({ status: 'error', styles: [], source: null })))
      .toContain('The collection\'s styles link couldn\'t be read, and it lists none of its own');
  });

  it('isn’t there for a map with no styles, unless the request names one', () => {
    expect(render({ styles: [], source: null })).toBe('');
    expect(render({ status: 'idle', styles: [], source: null })).toBe('');
    expect(words(render({ styles: [], source: null }, 'night'))).toContain('night isn\'t among the styles listed');
  });
});

const AIFS = params.collections.find(each => each.id === 'ecmwf-aifs-single') as unknown as Collection;
const aifsStyles = mapStylesOf(params.styles['ecmwf-aifs-single'].styles);
const DRAFT = draft.collection as unknown as Collection;
const WARNING = createTheme().palette.warning.main;
// The CSS written for the element a text is in: the last style block before it
const cssBefore = (html: string, text: string) => {
  const at = html.indexOf(text);
  const from = html.lastIndexOf('<style', at);
  return html.slice(from, html.indexOf('</style>', from));
};
const draftStyles = mapStylesOf(draft.styles);
// The toggles' text, in order: each value, and its tag after it
const toggles = (html: string) => html.split('<button').slice(1).map(button => words(`<button${button.slice(0, button.indexOf('</button>'))}`));
const renderFor = (collection: Collection, styles: typeof aifsStyles, chosen: string[], more: Partial<Parameters<typeof StyleField>[0]> = {}) => renderToStaticMarkup(
  <StyleField state={{ status: 'ready', styles, source: 'link' }} styleId="" onChange={() => {}} collection={collection} chosen={chosen} {...more} />,
);

describe('StyleField, for the parameters chosen', () => {
  it('offers only the styles possible for them, in the order listed, and says how many of how many', () => {
    const all = renderFor(AIFS, aifsStyles, []);
    expect(toggles(all)).toEqual(['default', 'contours', 'fmi-hires']);
    expect(words(all)).toContain('Style style (path) 3 listed · optional');
    // Every one is for 2t: nothing left out, nothing said
    const twoT = renderFor(AIFS, aifsStyles, ['2t']);
    expect(toggles(twoT)).toEqual(['default', 'contours', 'fmi-hires']);
    expect(words(twoT)).toContain('Style style (path) 3 listed · optional');
    expect(words(twoT)).not.toContain('Only those');
    const msl = renderFor(AIFS, aifsStyles, ['msl']);
    expect(toggles(msl)).toEqual(['default', 'contours']);
    expect(words(msl)).toContain('Style style (path) 2 for msl · 3 listed · optional');
    expect(words(msl)).toContain("Only those for msl , as the styles' parameters say");
    expect(toggles(renderFor(AIFS, aifsStyles, ['msl', 'tp']))).toEqual(['default']);
    expect(words(renderFor(AIFS, aifsStyles, ['msl', 'tp']))).toContain('1 for msl, tp · 3 listed');
  });

  it('keeps the style the request has though it isn’t possible, in its place, in orange', () => {
    const html = renderFor(AIFS, aifsStyles, ['tp'], { styleId: 'fmi-hires' });
    expect(toggles(html)).toEqual(['default', 'fmi-hires']);
    expect(html).toContain('value="fmi-hires" aria-pressed="true"');
    // The orange is in the CSS written for it, before it
    expect(cssBefore(html, 'value="fmi-hires"')).toContain(WARNING);
    expect(cssBefore(html, 'value="default"')).not.toContain(WARNING);
    // A possible one isn't
    expect(cssBefore(renderFor(AIFS, aifsStyles, ['2t'], { styleId: 'fmi-hires' }), 'value="fmi-hires"')).not.toContain(WARNING);
    // In its place, not after those possible: default, first, isn't for msl in the draft's metocean:styles
    expect(toggles(renderFor(DRAFT, draftStyles, ['msl'], { styleId: 'default' }))).toEqual(['default', 'contours', 'isobars']);
  });

  it('says so where none is possible', () => {
    const none = mapStylesOf(params.styles['ecmwf-aifs-single'].styles.filter(style => style.id !== 'default'));
    const html = renderFor(AIFS, none, ['tp']);
    expect(toggles(html)).toEqual([]);
    expect(words(html)).toContain("None of the 2 styles is for tp , as the styles' parameters say");
    expect(words(html)).toContain('0 for tp · 2 listed');
  });

  it('reads the draft’s metocean:styles too, and names its metocean:defaultStyle as what’s drawn without a style', () => {
    const html = renderFor(DRAFT, draftStyles, ['msl']);
    expect(toggles(html)).toEqual(['contours', 'isobars']);
    expect(words(html)).toContain("Only those for msl , as its metocean:styles and the styles' parameters say");
    expect(words(html)).toContain("Left out: the collection's own …/map , in the style its parameters' metocean:defaultStyle names: isobars for msl");
    expect(words(renderFor(DRAFT, draftStyles, ['tp']))).toContain("Left out: the collection's own …/map , in the server's default style");
  });

  it('shows its issues, and who declared it', () => {
    const issues: QueryIssue[] = [{ id: 'metadata:style:unlisted-tp', severity: 'warning', source: 'metadata', field: 'style', message: "fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx" }];
    const html = renderFor(AIFS, aifsStyles, ['tp'], { issues, declaredBy: [{ kind: 'class', name: 'styled-map', uri: 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/styled-map' }] });
    expect(words(html)).toContain("fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx");
    expect(words(html)).toContain('Style style (path) 1 for tp · 3 listed · optional styled-map');
  });

  it('says when the request has another value than the style’s link adds', () => {
    const html = renderToStaticMarkup(
      <StyleField state={{ status: 'ready', styles: aifsStyles, source: 'link' }} styleId="fmi-hires" onChange={() => {}} collection={AIFS} chosen={['tp']} held={{ 'parameter-name': 'tp', f: '' }} />,
    );
    expect(words(html)).toContain('The link adds parameter-name=2t . The request has parameter-name=tp instead, as chosen');
  });
});
