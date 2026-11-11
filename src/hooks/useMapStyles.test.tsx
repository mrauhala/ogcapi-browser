import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { stylesFrom, stylesNow, stylesWithout, useMapStyles, type MapStylesState } from './useMapStyles';
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

describe('stylesFrom', () => {
  it('takes the styles link’s document where it was read, and the collection’s own only where it wasn’t', () => {
    const doc = meteocore.styles['fmi-radar-composite-dbz'];
    const read = stylesFrom(doc, radar.styles);
    expect(read).toMatchObject({ status: 'ready', source: 'link' });
    expect(read.styles.map(style => style.id)).toEqual(doc.styles.map(style => style.id));
    expect(stylesFrom({ styles: [] }, radar.styles)).toEqual({ status: 'ready', styles: [], source: 'link' });
    const failed = stylesFrom(null, radar.styles);
    expect(failed).toMatchObject({ status: 'error', source: 'collection' });
    expect(failed.styles.map(style => style.id)).toEqual(['default', 'radar_dbz', 'radar_fmi']);
  });
});

describe('stylesNow', () => {
  const ready: MapStylesState = { status: 'ready', styles: [{ id: 'a', href: null, parameters: [] }], source: 'link' };

  it('is what was loaded for this very link, and loading while another link’s is all there is', () => {
    expect(stylesNow(true, STYLES, radar.styles, { url: STYLES, state: ready })).toBe(ready);
    expect(stylesNow(true, STYLES, radar.styles, { url: `${STYLES}-other`, state: ready })).toEqual({ status: 'loading', styles: [], source: null });
    expect(stylesNow(true, STYLES, radar.styles, null)).toEqual({ status: 'loading', styles: [], source: null });
  });

  it('is nothing until a map query wants them, and the collection’s own without a styles link', () => {
    expect(stylesNow(false, STYLES, radar.styles, { url: STYLES, state: ready })).toEqual({ status: 'idle', styles: [], source: null });
    expect(stylesNow(true, null, radar.styles, { url: STYLES, state: ready })).toMatchObject({ status: 'ready', source: 'collection' });
  });
});
