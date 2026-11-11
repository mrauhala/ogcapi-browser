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
// The rows share one grid, so that its columns line up: the mark, the id as wide as the longest one up to 40% of the
// row, so that the label keeps room on a phone, the label with the rest, and the unit. Each row spans it as a subgrid
const ROWS_SX = { display: 'grid', gridTemplateColumns: 'auto fit-content(40%) minmax(0, 1fr) auto', columnGap: 1, mx: -0.5 } as const;
const ROW_SX = {
  gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid', alignItems: 'start', textAlign: 'left',
  // Taller where fingers tap them
  px: 0.5, py: { xs: 0.875, sm: 0.375 }, borderRadius: 1, fontSize: 13, lineHeight: '18px',
  '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.05) },
  '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid' },
} as const;

// An id with a chance to wrap after each _ - . or /, before it wraps anywhere: pressure_reduced_to_mean_sea_level
function breakable(id: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let text = '';
  id.split(/([_./-])/).forEach((part, index) => {
    text += part;
    if (index % 2 === 1) {
      parts.push(text, <wbr key={index} />);
      text = '';
    }
  });
  return text ? [...parts, text] : parts;
}

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

  const row = (id: string, body: React.ReactNode, unit: string, warning = false) => {
    const on = chosen.includes(id);
    const Icon = several ? (on ? CheckBox : CheckBoxOutlineBlank) : (on ? RadioButtonChecked : RadioButtonUnchecked);
    return (
      <ButtonBase key={id} role={several ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => onChange(nextChosen(rows, chosen, id, several))}
        sx={{ ...ROW_SX, color: warning ? 'warning.main' : 'text.primary' }}>
        <Icon sx={{ fontSize: 18, color: on ? (warning ? 'warning.main' : 'primary.main') : 'text.secondary' }} />
        <Box component="span" sx={{ ...MONO, overflowWrap: 'anywhere' }}>{breakable(id)}</Box>
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
      <Box role={several ? 'group' : 'radiogroup'} aria-label="parameter-name" sx={ROWS_SX}>
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
          <Box sx={{ gridColumn: '1 / -1', px: 0.5, py: 0.5, fontSize: 12, color: 'text.secondary' }}>No parameter has that in its id or label</Box>
        )}
      </Box>
    </>
  );
};

export default ParameterRows;
