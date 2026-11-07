import { alpha, type Theme } from '@mui/material/styles';
import { formatValue } from './coverageSummary';
import { utcMoment } from '../utils/utcTime';
import type { CoverageProfile, ProfileParameter, ProfileTime } from './coverageProfile';
import type { StepKind } from './StepBars';
import { isNumber, withUnit, type VerticalAxis } from './verticalAxis';

// How a profile is laid out in panels, a panel per parameter on a shared vertical axis, and what's written on it. No
// DOM, so that it can be tested apart from the drawing

// The narrowest a panel gets before they scroll sideways, and room around a panel's plot
export const MIN_PANEL = 108;
export const PLOT_TOP = 9;
// Room below the lowest level for the zero line's label
export const PLOT_FOOT = 20;
// The lane at a panel's left where nulls are marked
export const NULL_LANE = 15;
const SIDE = 8;
// A monospace character at 11 px, for room
export const CHARACTER = 6.7;

export interface ProfilePanelGroup {
  unit: string;
  parameters: ProfileParameter[];
  // Over every time and place, so that stepping through times moves the line and not the scale
  min: number | null;
  max: number | null;
}

// A panel per parameter shown, or with Same unit, one for parameters that share a unit
export function panelsOf(parameters: ProfileParameter[], hidden: ReadonlySet<string>, join: boolean): ProfilePanelGroup[] {
  const groups: { unit: string; parameters: ProfileParameter[] }[] = [];
  for (const parameter of parameters) {
    if (hidden.has(parameter.id)) continue;
    const group = join && parameter.unit ? groups.find(each => each.unit === parameter.unit) : undefined;
    if (group) group.parameters.push(parameter);
    else groups.push({ unit: parameter.unit, parameters: [parameter] });
  }
  return groups.map(group => {
    const ends = group.parameters.flatMap(parameter => (parameter.min === null || parameter.max === null ? [] : [parameter.min, parameter.max]));
    return { ...group, min: ends.length ? Math.min(...ends) : null, max: ends.length ? Math.max(...ends) : null };
  });
}

// Same unit is for one point, where at least two parameters share a unit
export function canJoin(profile: CoverageProfile): boolean {
  if (profile.locations.length !== 1) return false;
  const units = profile.parameters.map(parameter => parameter.unit).filter(Boolean);
  return new Set(units).size < units.length;
}

export interface ProfileLine {
  parameter: ProfileParameter;
  location: number;
  colour: string;
}

// A line per parameter where they share a panel, or per point where there are several, or the one
export function linesOf(panel: ProfilePanelGroup, places: number, colours: string[]): ProfileLine[] {
  if (panel.parameters.length > 1) return panel.parameters.map((parameter, i) => ({ parameter, location: 0, colour: colours[i % colours.length] }));
  const [parameter] = panel.parameters;
  return Array.from({ length: places }, (_, i) => ({ parameter, location: i, colour: colours[i % colours.length] }));
}

export interface ValueScale {
  map: (value: number) => number;
  left: number;
  right: number;
  min: number;
  max: number;
  // One value only, padded around so that it sits in the middle
  single: boolean;
}

// A panel's values across its width, from its real least to its real most. Null with no numbers
export function valueScale(min: number | null, max: number | null, width: number, hasNulls: boolean): ValueScale | null {
  if (min === null || max === null) return null;
  const left = hasNulls ? NULL_LANE : SIDE;
  const right = width - SIDE;
  const single = min === max;
  const pad = single ? Math.abs(min) * 0.1 || 1 : 0;
  const [low, high] = [min - pad, max + pad];
  return { map: value => left + ((value - low) / (high - low)) * (right - left), left, right, min, max, single };
}

// The runs of samples a line joins, each a list of row indexes, in order of level whatever order they came in. A null
// breaks the line, and so does a level that should be there and isn't. A level this profile just doesn't have, as when
// a radar's scan changes, is stepped over: nothing is missing from this one
export function profileSegments(rows: number[], values: unknown[], missing: number[] = []): number[][] {
  const segments: number[][] = [];
  let run: number[] | null = null;
  rows.forEach((level, row) => {
    const value = values[row];
    if (value === undefined && !missing.includes(level)) return;
    if (!isNumber(value)) {
      run = null;
      return;
    }
    if (!run) {
      run = [];
      segments.push(run);
    }
    run.push(row);
  });
  return segments;
}

// Smaller dots where levels crowd
export const dotRadius = (rows: number) => (rows > 60 ? 1.5 : rows > 24 ? 2 : 2.5);

// Beside a dot: the app's 6 digits, and no wider than a panel for a very small value
export const labelValue = (value: number) => (value !== 0 && Math.abs(value) < 0.001 ? value.toExponential(3).replace('e+', 'e') : formatValue(value));

// At the ends of a panel's scale, where 108 px has room for little
export function shortValue(value: number): string {
  const size = Math.abs(value);
  if (value === 0) return '0';
  if (size < 0.001 || size >= 1e7) return value.toExponential(1).replace('e+', 'e');
  if (size >= 1000) return String(Math.round(value));
  return String(Number(value.toPrecision(3)));
}

// What a value at the crosshair reads
export function cellWords(raw: unknown, unit: string): string {
  if (raw === undefined) return 'not in response';
  if (raw === null) return 'null';
  if (isNumber(raw)) return unit ? `${labelValue(raw)} ${unit}` : labelValue(raw);
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

// What a level is called in words: "500 hPa", "Level 12", or "z 3" with nothing to go on
export function levelName(axis: VerticalAxis, level: number): string {
  if (axis.kind === 'modelLevel') return `Level ${level}`;
  if (axis.kind === 'unknown' && !axis.unit) return `z ${level}`;
  return withUnit(level, axis.unit);
}

// A panel with nothing to draw at this time says why
export function emptyWords(parameters: ProfileParameter[], numbersNow: boolean): string | null {
  if (numbersNow) return null;
  if (parameters.some(parameter => parameter.misfit)) return "Doesn't fit its axes";
  if (parameters.every(parameter => parameter.notIncluded)) return 'Not in this response';
  if (parameters.every(parameter => parameter.numbers === 0)) return parameters.some(parameter => parameter.others > 0) ? 'Not numbers' : 'All null';
  return 'All null at this time';
}

// Whether a parameter has a number at a time, at any of its places
export const hasNumbersAt = (parameter: ProfileParameter, time: number) => parameter.values.some(byTime => byTime[time]?.some(isNumber));

// The first time with a number in it, which is where a profile opens
export function firstTimeWithNumbers(profile: CoverageProfile): number {
  const at = profile.times.findIndex((_, time) => profile.parameters.some(parameter => hasNumbersAt(parameter, time)));
  return Math.max(0, at);
}

// Per time, over the parameters shown, as the grid's step bar marks its steps: with nulls, or with no numbers at all
export function timeKinds(profile: CoverageProfile, hidden: ReadonlySet<string>): StepKind[] {
  return profile.times.map((_, at) => {
    let numbers = false;
    let nulls = false;
    for (const parameter of profile.parameters) {
      if (hidden.has(parameter.id)) continue;
      for (const byTime of parameter.values) {
        for (const value of byTime[at] ?? []) {
          if (value === null) nulls = true;
          else if (isNumber(value)) numbers = true;
        }
      }
    }
    return !numbers ? 'none' : nulls ? 'some' : '';
  });
}

// The level nearest a height on the plot
export function nearestRow(rows: number[], yOf: (level: number) => number, y: number): number {
  let best = 0;
  rows.forEach((level, row) => {
    if (Math.abs(yOf(level) - y) < Math.abs(yOf(rows[best]) - y)) best = row;
  });
  return best;
}

// The next level down the screen, or up, from a row: from none, the top one
export function rowAfter(rows: number[], yOf: (level: number) => number, row: number | null, step: 1 | -1): number {
  const order = rows.map((_, at) => at).sort((a, b) => yOf(rows[a]) - yOf(rows[b]));
  const at = row === null ? -1 : order.indexOf(row);
  return order[at === -1 ? 0 : Math.max(0, Math.min(order.length - 1, at + step))];
}

export interface Readout {
  words: string;
  // Its value's place in the response, empty where nothing was sent
  path: string;
}

// What the readout says of a level in a parameter's panel: the level, the time where there are several, the point
// where there are several, and where it is on z, with its value's path in the response
export function readoutOf(profile: CoverageProfile, row: number, parameter: string | null, time: number): Readout {
  const { axis, times, locations } = profile;
  const level = profile.rows[row];
  const name = levelName(axis, level);
  if (profile.missing.includes(level)) return { words: `${name} isn't in the response`, path: '' };
  const when = times.length > 1 && Number.isFinite(times[time].at) ? `, ${utcMoment(times[time].at)}` : '';
  const where = locations.length > 1 ? `, ${locations[0].label}` : '';
  const cell = parameter ? profile.cellOf(parameter, 0, time, row) : null;
  const index = !cell ? ', not in the response' : cell.axisIndex === null ? '' : `, index ${cell.axisIndex} of z`;
  return { words: `${name}${when}${where}${index}`, path: cell?.path ?? '' };
}

// A time as the step bar says it, and with which of how many it is, as the grid's says its steps
export const timeLabel = (times: ProfileTime[], at: number) => (Number.isFinite(times[at].at) ? utcMoment(times[at].at) : (times[at].raw ?? 'no time'));
export const timeCaption = (times: ProfileTime[], at: number) => `${timeLabel(times, at)} (${at + 1}/${times.length})`;

// How many lines a panel's head needs for its id at its width, and a line for its label under it, if it has one.
// Panels that share a unit list their ids, with no labels
export function headLines(panels: ProfilePanelGroup[], panelWidth: number): number {
  const lines = panels.map(panel => {
    if (panel.parameters.length > 1) return panel.parameters.length;
    const [{ id, label }] = panel.parameters;
    return Math.min(Math.ceil((id.length * 7.3) / (panelWidth - 12)), 3) + (label ? 1 : 0);
  });
  return Math.min(Math.max(1, ...lines), 4);
}

// The plot's colours on the theme's surface
export function plotColours(theme: Theme) {
  const dark = theme.palette.mode === 'dark';
  const ink = theme.palette.text.primary;
  return {
    ink,
    secondary: theme.palette.text.secondary,
    divider: theme.palette.divider,
    paper: theme.palette.background.paper,
    grid: alpha(ink, dark ? 0.08 : 0.07),
    zero: alpha(ink, dark ? 0.32 : 0.28),
    faint: alpha(ink, dark ? 0.24 : 0.22),
    nullMark: alpha(ink, dark ? 0.6 : 0.55),
    warnLine: theme.palette.warning.main,
    warnText: dark ? theme.palette.warning.light : theme.palette.warning.dark,
  };
}
