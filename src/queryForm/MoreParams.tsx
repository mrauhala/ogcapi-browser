import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import type { Collection } from '../types/api';
import { useOpenRequest } from '../contexts/OpenRequestContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { useQueryValidation } from '../hooks/useQueryValidation';
import { useOpenDocs } from './fieldFocus';
import { crsOffered, heldNames, type FieldSpec } from '../query/fieldSpecs';
import { queryTypeOf } from '../query/queryTypes';
import { paramsIn, renameParam, withParam } from '../query/requestUrl';
import ParamField from './ParamField';
import NameToggles from './NameToggles';

const MONO_INPUT = { htmlInput: { spellCheck: false, autoComplete: 'off', sx: { fontFamily: 'monospace' } } } as const;

// One other parameter, as name = value. The name is kept to itself while it's typed, since a name the form has a field
// for moves there on leaving it; the value goes into the line at once
function OtherRow({ name, value, onRename, onValue, onRemove }: {
  name: string;
  value: string;
  onRename: (name: string) => void;
  onValue: (value: string) => void;
  onRemove?: () => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
      <TextField size="small" value={draft} placeholder="name" onChange={event => setDraft(event.target.value.trim())}
        onBlur={() => draft !== name && onRename(draft)} onKeyDown={event => event.key === 'Enter' && (event.target as HTMLElement).blur()}
        sx={{ width: '38%', minWidth: 90 }} slotProps={{ htmlInput: { ...MONO_INPUT.htmlInput, 'aria-label': 'Parameter name' } }} />
      <Box component="span" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>=</Box>
      <TextField size="small" value={value} placeholder="value" onChange={event => onValue(event.target.value)} sx={{ flex: 1, minWidth: 0 }}
        slotProps={{ htmlInput: { ...MONO_INPUT.htmlInput, 'aria-label': `${name || 'New parameter'}'s value` } }} />
      <IconButton size="small" aria-label={`Take out ${name || 'the new parameter'}`} onClick={onRemove} disabled={!onRemove}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

// More: what the form has no main field for. crs, from the query's crs_details, and every other parameter the request
// has, as name = value rows sent as typed, a view of the line as the typed fields are. Closed unless it has something
const MoreParams: React.FC<{
  collection: Collection;
  queryKey: string;
  specs: FieldSpec[];
  crs: string;
  setCrs: (crs: string) => void;
}> = ({ collection, queryKey, specs, crs, setCrs }) => {
  const { requestUrl, editUrl } = useRequestUrl();
  const { issues } = useQueryValidation();
  const openDocs = useOpenDocs();
  const { openRequest } = useOpenRequest();
  const offered = crsOffered(collection, queryKey);
  const held = heldNames(specs, queryTypeOf(collection, queryKey), offered);
  const others = paramsIn(requestUrl).filter(([name]) => !held.has(name));
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [adding, setAdding] = useState<{ name: string; value: string } | null>(null);
  const open = toggled ?? (!!crs || others.length > 0 || !!adding);

  // A name the form has a field for goes to that field: the form reads the line again
  const edit = (url: string, follow: boolean) => {
    editUrl(url);
    if (follow) openRequest(url, { switchApi: false });
  };
  const contents = [...(offered.length ? ['crs'] : []), others.length ? `${others.length} other parameter${others.length === 1 ? '' : 's'}` : 'other parameters'];

  return (
    <Box id="query-field-more" sx={{ mt: 1.25 }}>
      <ButtonBase onClick={() => setToggled(!open)} aria-expanded={open}
        sx={{ width: '100%', justifyContent: 'space-between', px: 1.25, py: 0.75, borderRadius: 1, border: 1, borderColor: 'divider', fontSize: 13 }}>
        <span>
          <Box component="span" sx={{ fontWeight: 600 }}>More: </Box>
          <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{contents.join(', ')}</Box>
        </span>
        {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
      </ButtonBase>
      {open && (
        <>
          {offered.length > 0 && (
            <ParamField id="crs" title="Coordinate system" name="crs" figure={`${offered.length} listed`} requirement="optional"
              hints={["From the query's `crs_details`"]} leftOut="the server's default, usually the first listed" empty={!crs}
              issues={issues.filter(issue => issue.field === 'crs')} openDocs={openDocs}>
              <NameToggles label="crs" options={offered} value={crs} onChange={setCrs} />
            </ParamField>
          )}
          <ParamField id="other" title="Other parameters" name="" figure="sent as typed"
            hints={others.length || adding ? [] : ['Any parameter the request has that no field is for: the form sends it as it is']}>
            {others.map(([name, value], index) => (
              <OtherRow key={`${index}-${name}`} name={name} value={value}
                onRename={next => edit(renameParam(requestUrl, name, next, value, true), held.has(next) || next === '')}
                onValue={text => editUrl(withParam(requestUrl, name, text, true))}
                onRemove={() => edit(withParam(requestUrl, name, ''), false)} />
            ))}
            {adding && (
              <OtherRow name={adding.name} value={adding.value}
                onRename={next => {
                  if (!next) return;
                  setAdding(null);
                  edit(withParam(requestUrl, next, adding.value, true), held.has(next));
                }}
                onValue={text => setAdding({ ...adding, value: text })}
                onRemove={() => setAdding(null)} />
            )}
            {!adding && (
              <Button size="small" onClick={() => setAdding({ name: '', value: '' })} sx={{ mt: 0.75, textTransform: 'none' }}>
                + Add a parameter
              </Button>
            )}
          </ParamField>
        </>
      )}
    </Box>
  );
};

export default MoreParams;
