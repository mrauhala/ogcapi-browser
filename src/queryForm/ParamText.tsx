import React, { useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import { useCollection } from '../contexts/CollectionContext';
import { useOpenRequest } from '../contexts/OpenRequestContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { paramOf, withParam } from '../query/requestUrl';

// As sent, in mono; 16 px on a touch screen, which iOS would otherwise zoom in on
const VALUE_SX = {
  fontFamily: 'monospace', fontSize: 13.5, height: 20, '@media (pointer: coarse)': { fontSize: 16 },
  // What to type, in words: in the UI's font, so that it fits
  '&::placeholder': { fontFamily: (theme: Theme) => theme.typography.fontFamily },
};

// One parameter of the request line, as it's sent, to read and type: a view of the line, not a copy. Typing edits the
// line at once, as typing in the line does; the form and the map catch up on Enter or on leaving the field, and what
// they can't read stays in the line and is sent. Escape puts back what was there.
const ParamText: React.FC<{
  name: string; // as sent: coords, z, member
  inputId?: string;
  placeholder?: string;
  error?: boolean; // its issues: red for an error, orange for a warning
  warning?: boolean;
  noted?: boolean; // the field says what's wrong with its value itself, so there's no "can't read" besides
  width?: number;
}> = ({ name, inputId, placeholder, error = false, warning = false, noted = false, width }) => {
  const { requestUrl, editUrl } = useRequestUrl();
  const { collectionUrl } = useCollection();
  const { openRequest } = useOpenRequest();
  const [focused, setFocused] = useState(false);
  const before = useRef<string | null>(null);
  const undoing = useRef(false);
  const typed = paramOf(requestUrl, name) ?? '';
  // In the line but not in what the form builds: the form couldn't read it, so it's sent as typed
  const unread = !focused && !noted && typed.trim() !== '' && paramOf(collectionUrl, name) === null;

  const commit = () => {
    if (before.current !== null && requestUrl !== before.current) openRequest(requestUrl, { switchApi: false });
    before.current = requestUrl;
  };

  return (
    <>
      <TextField
        id={inputId ?? `query-input-${name}`}
        size="small"
        fullWidth={width === undefined}
        value={typed}
        error={error}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          before.current = requestUrl;
        }}
        onBlur={() => {
          setFocused(false);
          if (!undoing.current) commit();
          undoing.current = false;
          before.current = null;
        }}
        onChange={event => editUrl(withParam(requestUrl, name, event.target.value.replace(/[\r\n]+/g, '')))}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && before.current !== null) {
            undoing.current = true;
            editUrl(before.current);
            (event.target as HTMLElement).blur();
          }
        }}
        sx={{
          ...(width !== undefined ? { width } : {}),
          ...((unread || warning) && !error ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main' } } : {}),
        }}
        slotProps={{ htmlInput: { 'aria-label': name, spellCheck: false, autoComplete: 'off', sx: VALUE_SX } }}
      />
      {unread && (
        <Typography component="div" sx={{ fontSize: 12, lineHeight: '16px', mt: 0.5, color: 'warning.main' }}>
          The form can&apos;t read this. It&apos;s sent as typed
        </Typography>
      )}
    </>
  );
};

export default ParamText;
