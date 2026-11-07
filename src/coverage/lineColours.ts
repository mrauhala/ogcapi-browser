import type { Theme } from '@mui/material/styles';

// Told apart by people with colour blindness too, on each theme's surface
const LOCATION_COLOURS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

// A line's colour, for each place or parameter on a plot: the theme's own for just one
export function lineColours(lines: number, theme: Theme): string[] {
  return lines === 1 ? [theme.palette.primary.main] : LOCATION_COLOURS[theme.palette.mode];
}
