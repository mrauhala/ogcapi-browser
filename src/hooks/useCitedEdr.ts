import { useMemo } from 'react';
import { useApi } from '../contexts/ApiContext';
import { citedEdrOf, type CitedEdr } from '../standards';

// Whether a URL is the API's own: its root, or under it
export function belongsToApi(url: string, apiUrl: string | null | undefined): boolean {
  if (!apiUrl) return false;
  const root = apiUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const path = url.replace(/[?#].*$/, '');
  return path === root || path.startsWith(`${root}/`);
}

// The EDR version findings are cited against: the one the loaded API declares in its conformance. A response from
// another API, which the app hasn't loaded, is cited against 1.1, as nothing is known of what it declares
export function useCitedEdr(forUrl?: string | null): CitedEdr {
  const { conformsTo, apiUrl } = useApi();
  const elsewhere = Boolean(forUrl) && !belongsToApi(forUrl!, apiUrl);
  return useMemo(() => (elsewhere ? { version: '1.1', declared: null, elsewhere: true } : citedEdrOf(conformsTo)), [elsewhere, conformsTo]);
}
