import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { stylesWithout, useMapStyles } from './useMapStyles';
import meteocore from '../query/__fixtures__/meteocore-maps.json';

vi.mock('../contexts/ServiceContext', () => ({ useService: () => ({ getAuthCredentials: () => undefined }) }));

const radar = meteocore.collections.find(each => each.id === 'fmi-radar-composite-dbz')!;
const STYLES = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/styles';

// What the hook gives on its first render, before any request has answered
function Probe({ url, embedded, wanted }: { url: string | null; embedded: unknown; wanted: boolean }) {
  const { status, source, styles } = useMapStyles(url, embedded, wanted);
  return <>{JSON.stringify({ status, source, ids: styles.map(style => style.id) })}</>;
}
const first = (url: string | null, embedded: unknown, wanted = true) =>
  JSON.parse(renderToStaticMarkup(<Probe url={url} embedded={embedded} wanted={wanted} />).replace(/&quot;/g, '"'));

describe('useMapStyles', () => {
  it('loads nothing until a map query wants the styles', () => {
    expect(first(STYLES, radar.styles, false)).toEqual({ status: 'idle', source: null, ids: [] });
  });

  it('is loading the styles link’s document, and doesn’t show the collection’s own meanwhile', () => {
    expect(first(STYLES, radar.styles)).toEqual({ status: 'loading', source: null, ids: [] });
  });

  it('reads the collection’s own styles where there’s no styles link', () => {
    expect(first(null, radar.styles)).toEqual({ status: 'ready', source: 'collection', ids: ['default', 'radar_dbz', 'radar_fmi'] });
    expect(first(null, undefined)).toEqual({ status: 'ready', source: null, ids: [] });
  });
});

describe('stylesWithout', () => {
  it('falls back on the collection’s own styles, saying whether the link failed', () => {
    expect(stylesWithout(radar.styles, 'error')).toMatchObject({ status: 'error', source: 'collection' });
    expect(stylesWithout([], 'error')).toEqual({ status: 'error', styles: [], source: null });
  });
});
