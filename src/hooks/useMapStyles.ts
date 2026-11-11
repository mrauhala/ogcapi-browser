import { useEffect, useMemo, useState } from 'react';
import { fetchStyles } from '../api/maps';
import { useService } from '../contexts/ServiceContext';
import { mapStylesOf, type MapStyle } from '../query/mapQuery';

export interface MapStylesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  styles: MapStyle[];
  // Where they were read: the styles link's document, or the collection's own `styles` when that can't be read
  source: 'link' | 'collection' | null;
}

const IDLE: MapStylesState = { status: 'idle', styles: [], source: null };

// What a map's styles are when the styles link can't give them: the collection's own `styles`, if it has any
export function stylesWithout(embedded: unknown, status: 'ready' | 'error'): MapStylesState {
  const styles = mapStylesOf(embedded);
  return { status, styles, source: styles.length ? 'collection' : null };
}

// A map's styles, from the collection's styles link, loaded when a map query wants them (null: none does). Maps 1.0 has
// them there; a collection may also list its own, as MeteoCore's do, and those are read only when the link can't be
export function useMapStyles(stylesUrl: string | null, embedded: unknown, wanted: boolean): MapStylesState {
  const { getAuthCredentials } = useService();
  const [loaded, setLoaded] = useState<{ url: string; state: MapStylesState } | null>(null);

  useEffect(() => {
    if (!wanted || !stylesUrl) return;
    let cancelled = false;
    setLoaded({ url: stylesUrl, state: { status: 'loading', styles: [], source: null } });
    const controller = new AbortController();
    fetchStyles(stylesUrl, getAuthCredentials(stylesUrl), controller.signal).then(doc => {
      if (cancelled) return;
      const styles = mapStylesOf(doc?.styles);
      setLoaded({ url: stylesUrl, state: doc ? { status: 'ready', styles, source: 'link' } : stylesWithout(embedded, 'error') });
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [stylesUrl, wanted, embedded, getAuthCredentials]);

  return useMemo(() => {
    if (!wanted) return IDLE;
    if (!stylesUrl) return stylesWithout(embedded, 'ready');
    return loaded?.url === stylesUrl ? loaded.state : { status: 'loading', styles: [], source: null };
  }, [wanted, stylesUrl, embedded, loaded]);
}
