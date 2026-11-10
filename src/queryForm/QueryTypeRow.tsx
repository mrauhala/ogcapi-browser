import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useApi } from '../contexts/ApiContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import ParamField, { Said } from './ParamField';
import NameToggles from './NameToggles';

// The request's path from the API's root, as sent: /collections/ecmwf-ifs-pressure/position, with the root's own path
// (https://…/edr) left off
function pathOf(url: string, apiUrl: string): string {
  try {
    const { pathname } = new URL(url);
    let root = '';
    try {
      root = new URL(apiUrl).pathname.replace(/\/+$/, '');
    } catch {
      // No API root: from /collections on
    }
    if (root && pathname.startsWith(`${root}/`)) return pathname.slice(root.length);
    const at = pathname.indexOf('/collections/');
    return at < 0 ? pathname : pathname.slice(at);
  } catch {
    return '';
  }
}

// The query, a part of the path: its names as toggles, nothing picked to start. With none picked, what the collection
// has, which its queries draw on.
const QueryTypeRow: React.FC<{
  id?: string;
  title?: string; // Query, or Query on the instance
  queries: string[];
  value: string;
  onChange: (queryKey: string) => void;
  offers?: string[]; // said while none is picked
  showPath?: boolean; // false where a row below shows the path, as the query on an instance does
}> = ({ id = 'query', title = 'Query', queries, value, onChange, offers, showPath = true }) => {
  const { requestUrl } = useRequestUrl();
  const { apiUrl } = useApi();
  const path = value && showPath ? pathOf(requestUrl, apiUrl) : '';
  return (
    <ParamField id={id} title={title} name="query" path="path" figure={`${queries.length} offered${value ? '' : ' · choose one'}`}>
      <NameToggles label={title} options={queries} value={value} onChange={onChange} />
      {path && <Typography component="div" sx={{ mt: 0.75, fontFamily: 'monospace', fontSize: 12, color: 'text.secondary', overflowWrap: 'anywhere' }}>{path}</Typography>}
      {!value && offers && offers.length > 0 && (
        <Box sx={{ mt: 1.5, px: 1.5, py: 1.25, border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 13, lineHeight: 1.55, color: 'text.secondary' }}>
          Choose a query. Its parameters come from what the collection says it has:
          <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.25 }}>
            {offers.map(offer => <li key={offer}><Said text={offer} /></li>)}
          </Box>
        </Box>
      )}
    </ParamField>
  );
};

export default QueryTypeRow;
