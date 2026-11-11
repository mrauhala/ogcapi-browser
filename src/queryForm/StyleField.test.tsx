import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import StyleField from './StyleField';
import { words } from '../coverage/cellsTestData';
import { mapStylesOf } from '../query/mapQuery';
import type { MapStylesState } from '../hooks/useMapStyles';
import meteocore from '../query/__fixtures__/meteocore-maps.json';

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
