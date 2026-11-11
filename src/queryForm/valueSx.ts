import type { Theme } from '@mui/material/styles';

// A value as sent, in mono; 16 px on a touch screen, which iOS would otherwise zoom in on
export const VALUE_SX = {
  fontFamily: 'monospace', fontSize: 13.5, height: 20, '@media (pointer: coarse)': { fontSize: 16 },
  // What to type, in words: in the UI's font, so that it fits
  '&::placeholder': { fontFamily: (theme: Theme) => theme.typography.fontFamily },
};
