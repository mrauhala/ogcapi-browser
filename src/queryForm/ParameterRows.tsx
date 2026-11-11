import React, { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import TextField from '@mui/material/TextField';
import RadioButtonChecked from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import CheckBox from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlank from '@mui/icons-material/CheckBoxOutlineBlank';
import { alpha, type Theme } from '@mui/material/styles';
import type { ParameterRow } from '../query/mapOffer';
import { nextChosen } from './rowChoice';

// Past this many, a filter by id or label
export const FILTER_FROM = 12;

const MONO = { fontFamily: 'monospace', fontSize: 13, lineHeight: '18px' };
const ROW_SX = {
  display: 'grid', columnGap: 1, alignItems: 'start', width: '100%', textAlign: 'left',
  // Taller where fingers tap them
  px: 0.5, py: { xs: 0.875, sm: 0.375 }, borderRadius: 1, fontSize: 13, lineHeight: '18px',
  '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.05) },
  '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
} as const;

// parameter-name as rows of the collection's parameter_names: the id as sent, its label, the styles for it and its unit.
// One at a time, as radios, or several, as checkboxes; a pick taken back by tapping it again, since none is a request
// too. One the collection doesn't list, as from a link, shows first in orange, to be seen and taken out
const ParameterRows: React.FC<{
  rows: ParameterRow[];
  chosen: string[];
  several: boolean;
  onChange: (ids: string[]) => void;
}> = ({ rows, chosen, several, onChange }) => {
  const [filter, setFilter] = useState('');
  const listed = new Set(rows.map(row => row.id));
  const unlisted = chosen.filter(id => !listed.has(id));
  const typed = filter.trim().toLowerCase();
  const shown = typed
    ? rows.filter(row => chosen.includes(row.id) || row.id.toLowerCase().includes(typed) || !!row.label?.toLowerCase().includes(typed))
    : rows;
  const idWidth = `${Math.min(12, Math.max(2, ...rows.map(row => row.id.length), ...unlisted.map(id => id.length))) + 1}ch`;

  const row = (id: string, body: React.ReactNode, unit: string, warning = false) => {
    const on = chosen.includes(id);
    const Icon = several ? (on ? CheckBox : CheckBoxOutlineBlank) : (on ? RadioButtonChecked : RadioButtonUnchecked);
    return (
      <ButtonBase key={id} role={several ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => onChange(nextChosen(rows, chosen, id, several))}
        sx={{ ...ROW_SX, gridTemplateColumns: `18px ${idWidth} minmax(0, 1fr) auto`, color: warning ? 'warning.main' : 'text.primary' }}>
        <Icon sx={{ fontSize: 18, color: on ? (warning ? 'warning.main' : 'primary.main') : 'text.secondary' }} />
        <Box component="span" sx={{ ...MONO, overflowWrap: 'anywhere' }}>{id}</Box>
        <Box component="span" sx={{ minWidth: 0 }}>{body}</Box>
        <Box component="span" sx={{ ...MONO, fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>{unit}</Box>
      </ButtonBase>
    );
  };

  return (
    <>
      {rows.length > FILTER_FROM && (
        <TextField size="small" fullWidth value={filter} onChange={event => setFilter(event.target.value)}
          placeholder={`Filter the ${rows.length} by id or label`} sx={{ mb: 0.5 }}
          slotProps={{ htmlInput: { 'aria-label': 'Filter the parameters', spellCheck: false, autoComplete: 'off' } }} />
      )}
      <Box role={several ? 'group' : 'radiogroup'} aria-label="parameter-name" sx={{ mx: -0.5 }}>
        {unlisted.map(id => row(id, <Box component="span" sx={{ fontSize: 12 }}>Not among <code>parameter_names</code></Box>, '', true))}
        {shown.map(each => row(each.id, (
          <>
            {each.label ?? ''}
            {each.styles.length > 0 && (
              <Box component="span" sx={{ display: 'block', fontSize: 11.5, lineHeight: '15px', color: 'text.secondary' }}>
                styles: <Box component="span" sx={{ fontFamily: 'monospace' }}>{each.styles.join(', ')}</Box>
              </Box>
            )}
          </>
        ), each.unit))}
        {typed && shown.length === 0 && (
          <Box sx={{ px: 0.5, py: 0.5, fontSize: 12, color: 'text.secondary' }}>No parameter has that in its id or label</Box>
        )}
      </Box>
    </>
  );
};

export default ParameterRows;
