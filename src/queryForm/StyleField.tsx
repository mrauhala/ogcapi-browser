import React from 'react';
import Typography from '@mui/material/Typography';
import type { MapStylesState } from '../hooks/useMapStyles';
import type { Collection } from '../types/api';
import type { Declarer } from '../query/declared';
import type { QueryIssue } from '../query/types';
import { parameterStyles, possibleStyles } from '../query/mapOffer';
import { styleHints } from './styleHints';
import ParamField, { Said } from './ParamField';
import NameToggles from './NameToggles';

const code = (text: string) => `\`${text}\``;
const codes = (texts: string[]) => texts.map(code).join(', ');

// What's sent without a style: the collection's own map, drawn in the style the draft has a chosen parameter name
function leftOutOf(collection: Collection | undefined, chosen: string[]): string {
  const defaults = collection ? chosen.flatMap(parameter => {
    const style = parameterStyles(collection, parameter).defaultStyle;
    return style ? [`${code(style)} for ${code(parameter)}`] : [];
  }) : [];
  return defaults.length
    ? `the collection's own ${code('…/map')}, in the style its parameters' ${code('metocean:defaultStyle')} names: ${defaults.join(', ')}`
    : `the collection's own ${code('…/map')}, in the server's default style`;
}

// Whose word the styles shown are on: the chosen parameters' metocean:styles, the styles' parameters
function sourcesOf(collection: Collection, state: MapStylesState, parameters: string[]): string {
  return [
    ...(parameters.some(parameter => parameterStyles(collection, parameter).styles) ? [`${parameters.length > 1 ? 'their' : 'its'} ${code('metocean:styles')}`] : []),
    ...(state.styles.some(style => style.parameters.length) ? [`the styles' ${code('parameters')}`] : []),
  ].join(' and ');
}

// style, a part of the path for a map query: the collection's own map, or a styled one at …/styles/{styleId}/map. The ids,
// as the path has them, in the order listed: with a parameter chosen, only those possible for it, and the one the
// request has though it isn't, in orange beside its warning. None picked is the collection's own map
const StyleField: React.FC<{
  state: MapStylesState;
  styleId: string;
  byLink?: boolean; // the request is the style's own link, rather than the path a typed URL gave
  onChange: (styleId: string) => void;
  collection?: Collection; // its parameters' metocean:styles, which say which styles are for them
  chosen?: string[]; // the parameters chosen: only the styles possible for them are offered
  held?: Record<string, string>; // what the form holds of what a style's link may add: parameter-name, f
  declaredBy?: Declarer[];
  issues?: QueryIssue[];
  openDocs?: (pointer: string) => void;
}> = ({ state, styleId, byLink = true, onChange, collection, chosen = [], held, declaredBy, issues, openDocs }) => {
  const ids = state.styles.map(style => style.id);
  const picked = state.styles.find(style => style.id === styleId);
  // A collection with no styles to pick has no field, unless the request names one
  if (state.status !== 'loading' && !ids.length && !styleId && state.status !== 'error') return null;
  // With a parameter chosen, the styles possible for it, and the one the request has, as it chose it
  const possible = collection ? possibleStyles(collection, state.styles, chosen) : null;
  const filtered = !!possible && possible.styles.length < ids.length;
  const options = possible ? ids.filter(id => possible.styles.includes(id) || id === styleId) : ids;
  const warned = possible && ids.includes(styleId) && !possible.styles.includes(styleId) ? styleId : undefined;
  const forWhom = possible ? codes(possible.parameters) : '';
  return (
    <ParamField id="style" title="Style" name="style" path="path" requirement="optional" declaredBy={declaredBy}
      figure={state.status === 'loading' ? undefined : `${filtered ? `${possible.styles.length} for ${possible.parameters.join(', ')} · ` : ''}${ids.length} listed`}
      hints={[
        ...styleHints(state, picked, styleId, byLink, held),
        ...(filtered && possible.styles.length ? [`Only those for ${forWhom}, as ${sourcesOf(collection!, state, possible.parameters)} say`] : []),
      ]}
      leftOut={leftOutOf(collection, chosen)} empty={!styleId} issues={issues} openDocs={openDocs}>
      {state.status === 'loading' ? (
        <Typography component="div" sx={{ fontSize: 13, color: 'text.secondary' }}>Loading styles…</Typography>
      ) : !ids.length && !styleId ? (
        <Typography component="div" sx={{ fontSize: 13, color: 'text.secondary' }}>The collection&apos;s styles link couldn&apos;t be read, and it lists none of its own</Typography>
      ) : !options.length && !styleId ? (
        <Typography component="div" sx={{ fontSize: 13, color: 'text.secondary' }}>
          <Said text={`None of the ${ids.length} styles is for ${forWhom}, as ${sourcesOf(collection!, state, possible!.parameters)} say`} />
        </Typography>
      ) : (
        <NameToggles label="style" options={options} value={styleId} onChange={onChange} warned={warned} />
      )}
    </ParamField>
  );
};

export default StyleField;
