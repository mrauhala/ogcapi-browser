import React from 'react';
import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { alpha, type Theme } from '@mui/material/styles';

// Each button bordered on its own and wrapping, rather than MUI's joined row: the names are what's sent, in mono
const GROUP_SX = {
  flexWrap: 'wrap',
  gap: 0.5,
  '& .MuiToggleButtonGroup-grouped': {
    m: 0,
    border: 1,
    borderColor: 'divider',
    borderRadius: 1,
    '&:not(:first-of-type)': { borderLeft: 1, borderColor: 'divider', borderRadius: 1, ml: 0 },
    '&:not(:last-of-type)': { borderRadius: 1 },
  },
} as const;

const BUTTON_SX = {
  height: { xs: 36, sm: 30 },
  px: 1.25,
  py: 0,
  textTransform: 'none',
  fontFamily: 'monospace',
  fontSize: 13,
  color: 'text.primary',
  '&.Mui-selected, &.Mui-selected:hover': { color: 'primary.main', borderColor: 'primary.main', bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.16) },
} as const;

// The default the metadata names, in the UI font after the name: what the server does unasked, not a pick
const DEFAULT_TAG_SX = { ml: 0.75, fontFamily: (theme: Theme) => theme.typography.fontFamily, fontSize: 10.5, lineHeight: 1, color: 'text.secondary', textTransform: 'none' } as const;

// A value not among those listed, as from a link: shown and sent, in orange
const EXTRA_SX = {
  ...BUTTON_SX,
  color: 'warning.main',
  borderColor: 'warning.main',
  '&.Mui-selected, &.Mui-selected:hover': { color: 'warning.main', borderColor: 'warning.main', bgcolor: (theme: Theme) => alpha(theme.palette.warning.main, 0.12) },
} as const;

// A choice of names, as for the query, f and units: nothing picked to start, and a pick taken back by tapping it again
const NameToggles: React.FC<{
  label: string; // for screen readers: the parameter's name
  options: string[];
  value: string;
  onChange: (value: string) => void;
  tall?: boolean; // as tall as the number field beside it, as a unit is
  marked?: string; // the option the metadata names as the default: tagged, not pressed
}> = ({ label, options, value, onChange, tall = false, marked }) => {
  const extra = value && !options.includes(value) ? value : null;
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value || null}
      onChange={(_, picked: string | null) => onChange(picked ?? '')}
      aria-label={label}
      sx={GROUP_SX}
    >
      {options.map(option => (
        <ToggleButton key={option} value={option} sx={tall ? { ...BUTTON_SX, height: 40 } : BUTTON_SX}>
          {option}
          {option === marked && <Box component="span" sx={DEFAULT_TAG_SX}>default</Box>}
        </ToggleButton>
      ))}
      {extra && <ToggleButton value={extra} sx={tall ? { ...EXTRA_SX, height: 40 } : EXTRA_SX}>{extra}</ToggleButton>}
    </ToggleButtonGroup>
  );
};

export default NameToggles;
