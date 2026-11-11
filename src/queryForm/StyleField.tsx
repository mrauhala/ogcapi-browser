import React from 'react';
import Typography from '@mui/material/Typography';
import type { MapStylesState } from '../hooks/useMapStyles';
import { styleHints } from './styleHints';
import ParamField from './ParamField';
import NameToggles from './NameToggles';

const code = (text: string) => `\`${text}\``;

// style, a part of the path for a map query: the collection's own map, or a styled one at …/styles/{styleId}/map. The ids,
// as the path has them, in the order listed; none picked is the collection's own map
const StyleField: React.FC<{
  state: MapStylesState;
  styleId: string;
  byLink?: boolean; // the request is the style's own link, rather than the path a typed URL gave
  onChange: (styleId: string) => void;
}> = ({ state, styleId, byLink = true, onChange }) => {
  const ids = state.styles.map(style => style.id);
  const picked = state.styles.find(style => style.id === styleId);
  // A collection with no styles to pick has no field, unless the request names one
  if (state.status !== 'loading' && !ids.length && !styleId && state.status !== 'error') return null;
  return (
    <ParamField id="style" title="Style" name="style" path="path" requirement="optional"
      figure={state.status === 'loading' ? undefined : `${ids.length} listed`}
      hints={styleHints(state, picked, styleId, byLink)} leftOut={`the collection's own ${code('…/map')}, in the server's default style`} empty={!styleId}>
      {state.status === 'loading' ? (
        <Typography component="div" sx={{ fontSize: 13, color: 'text.secondary' }}>Loading styles…</Typography>
      ) : !ids.length && !styleId ? (
        <Typography component="div" sx={{ fontSize: 13, color: 'text.secondary' }}>The collection&apos;s styles link couldn&apos;t be read, and it lists none of its own</Typography>
      ) : (
        <NameToggles label="style" options={ids} value={styleId} onChange={onChange} />
      )}
    </ParamField>
  );
};

export default StyleField;
