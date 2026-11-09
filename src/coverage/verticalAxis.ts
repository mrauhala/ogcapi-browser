import type { ValidationError, Vertical } from '../types/api';
import { i18nText } from '../utils/i18nText';

// What a coverage's z is, in what unit, and which way it runs, read from the response alone. The collection's vrs
// isn't read: on every real response it changed only a word, and unguarded it misread radar sections in metres as
// elevation angles. The extent's levels are read, for what should be there. For the profile and the cross-section.

export type VerticalKind = 'pressure' | 'height' | 'depth' | 'modelLevel' | 'angle' | 'unknown';
// 'down': bigger values lower on the screen, as AXIS[…,down] means. One rule for every kind
export type Direction = 'up' | 'down';

export interface VerticalAxis {
  kind: VerticalKind;
  name: string;
  // '' if there's none
  unit: string;
  // 'description': only in a sentence about z, not in its reference system's axis
  unitSource: 'response' | 'description' | 'none';
  direction: Direction;
  // 'usual': not stated, and taken from its kind
  directionSource: 'response' | 'usual' | 'none';
  // "pressure", for "as usual for pressure"
  usualWords: string | null;
  // It states a direction against what's usual for its kind, such as pressure going up
  againstUsual: boolean;
  // The CRS z is referenced to, if it's one with no vertical axis, as KNMI's CRS84 is
  flatCrs: string | null;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const UNIT_WORDS: Record<string, string> = {
  hectopascal: 'hPa', hectopascals: 'hPa', pascal: 'Pa', millibar: 'hPa', mbar: 'hPa',
  metre: 'm', meter: 'm', metres: 'm', meters: 'm', kilometre: 'km', foot: 'ft', feet: 'ft',
  degree: '°', degrees: '°', deg: '°', unity: '', n: '', 1: '',
};

// Own words only: a unit sent as "constructor" is a unit, not something of every object's
const unitWord = (key: string) => (Object.prototype.hasOwnProperty.call(UNIT_WORDS, key) ? UNIT_WORDS[key] : undefined);

function cleanUnit(unit: unknown): string | undefined {
  if (unit === undefined || unit === null) return undefined;
  const key = String(unit).trim();
  return unitWord(key) ?? unitWord(key.toLowerCase()) ?? key;
}

const cleanDirection = (direction: unknown): Direction | undefined => (direction === 'up' || direction === 'down' ? direction : undefined);

function unitSymbol(unit: unknown): string | undefined {
  if (!isObject(unit)) return undefined;
  const { symbol } = unit;
  if (typeof symbol === 'string') return symbol;
  if (isObject(symbol) && typeof symbol.value === 'string') return symbol.value;
  return i18nText(unit.label);
}

// The referencing entry for z, on the coverage's domain or on the collection
function zSystemOf(coverage: unknown, json: unknown): Json | null {
  const own = isObject(coverage) && isObject(coverage.domain) ? coverage.domain.referencing : undefined;
  const shared = isObject(json) ? (json.referencing ?? (isObject(json.domain) ? json.domain.referencing : undefined)) : undefined;
  const list = Array.isArray(own) ? own : shared;
  if (!Array.isArray(list)) return null;
  const entry = list.find(item => isObject(item) && Array.isArray(item.coordinates) && item.coordinates.includes('z'));
  return isObject(entry) && isObject(entry.system) ? entry.system : null;
}

interface Kind { kind: VerticalKind; name: string; test: (text: string) => boolean; usual: Direction; usualWords: string }

// Longitude and latitude only. CRS84h and EPSG:4979 have a height, and are a vertical axis of their own
const FLAT_CRS = /(?:\/CRS84|\/EPSG\/0\/4326|^EPSG:4326|^CRS84|^urn:ogc:def:crs:OGC:1\.3:CRS84)$/i;

// In this order: FMI's hybrid datum is "Hybrid sigma-pressure model levels", which is no pressure axis
const KINDS: Kind[] = [
  { kind: 'modelLevel', name: 'Model level', test: text => /model level|hybrid|sigma|level number/i.test(text), usual: 'down', usualWords: 'model levels' },
  { kind: 'angle', name: 'Elevation angle', test: text => /\bangle\b|\btilt\b/i.test(text), usual: 'up', usualWords: 'an elevation angle' },
  // Words in any case, and units as they're written: Pa, and not the pa in "spatial"
  { kind: 'pressure', name: 'Pressure', test: text => /pressure|isobar/i.test(text) || /\b(?:hPa|mbar|Pa)\b/.test(text), usual: 'down', usualWords: 'pressure' },
  { kind: 'depth', name: 'Depth', test: text => /depth|below/i.test(text), usual: 'down', usualWords: 'depth' },
  { kind: 'height', name: 'Height', test: text => /height|altitude|above|\bflight level\b/i.test(text), usual: 'up', usualWords: 'height' },
];

export function readVerticalAxis(json: unknown, coverage: unknown): VerticalAxis {
  const system = zSystemOf(coverage, json);
  const csAxes = isObject(system?.cs) ? system.cs.csAxes : undefined;
  const csAxis = Array.isArray(csAxes) && isObject(csAxes[0]) ? csAxes[0] : null;
  const description = i18nText(system?.description) ?? i18nText(system?.label) ?? '';
  const words = [i18nText(csAxis?.name), i18nText(csAxis?.label), description].filter(Boolean).join(' ');
  // From a sentence, only a final "in hPa". A unit is never guessed from the numbers
  const describedUnit = /\bin\s+([^\s.]+)\.?\s*$/.exec(description)?.[1];
  const symbol = cleanUnit(unitSymbol(csAxis?.unit) ?? unitSymbol(system?.unit));
  const stated = symbol ?? cleanUnit(describedUnit);
  const unit = stated ?? '';

  const found = KINDS.find(kind => kind.test(unit ? `${words} ${unit}` : words));
  const angleByUnit = !found && unit === '°';
  const lengthByUnit = !found && /^(m|km|ft)$/.test(unit);
  const kind = found?.kind ?? (angleByUnit ? 'angle' : lengthByUnit ? 'height' : 'unknown');
  const name = i18nText(csAxis?.name) ?? found?.name ?? (angleByUnit ? 'Elevation angle' : lengthByUnit ? 'Height' : 'z');

  const direction = cleanDirection(csAxis?.direction);
  const usual = found?.usual ?? (angleByUnit || lengthByUnit ? 'up' : undefined);
  const usualWords = found?.usualWords ?? (angleByUnit ? 'an elevation angle' : lengthByUnit ? 'height' : null);
  return {
    kind,
    name,
    unit,
    unitSource: symbol !== undefined ? 'response' : stated !== undefined ? 'description' : 'none',
    direction: direction ?? usual ?? 'up',
    directionSource: direction ? 'response' : usual ? 'usual' : 'none',
    usualWords,
    againstUsual: !!direction && !!found && direction !== found.usual,
    flatCrs: typeof system?.id === 'string' && FLAT_CRS.test(system.id) ? system.id : null,
  };
}

// About 4 px of a 240 px plot, which two dots need to be told apart
const FEW_PIXELS = 1 / 60;

export function isEvenlySpaced(levels: number[]): boolean {
  const sorted = [...levels].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((value, i) => value - sorted[i]);
  return gaps.every(gap => Math.abs(gap - gaps[0]) <= Math.abs(gaps[0]) * 1e-6);
}

export type LevelScale = 'log' | 'linear';

// Log for pressure, and where a linear axis would run levels together, unless a level at or below 0 rules it out.
// From the levels alone, so that it doesn't change as a pane is resized
export function defaultScale(kind: VerticalKind, levels: number[]): { scale: LevelScale; canLog: boolean } {
  const canLog = levels.length > 0 && levels.every(level => level > 0);
  if (!canLog) return { scale: 'linear', canLog };
  if (kind === 'pressure') return { scale: 'log', canLog };
  // Two levels, or one, are evenly spaced
  if (kind === 'modelLevel' || isEvenlySpaced(levels)) return { scale: 'linear', canLog };
  const sorted = [...levels].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  const smallest = Math.min(...sorted.slice(1).map((value, i) => value - sorted[i]));
  return { scale: span > 0 && smallest / span < FEW_PIXELS ? 'log' : 'linear', canLog };
}

// How levels are spaced on screen: by their values, linear or log, or each the same height, for reading level by level
export type LevelSpacing = LevelScale | 'even';

// Where a level sits, from 0 at the top of the plot to 1 at the bottom. Down puts bigger values lower, and flipped
// turns that over
export function levelPosition(levels: number[], { spacing, direction, flipped = false }: { spacing: LevelSpacing; direction: Direction; flipped?: boolean }): (level: number) => number {
  const down = (direction === 'down') !== flipped;
  const sorted = [...levels].sort((a, b) => a - b);
  if (spacing === 'even') {
    return level => {
      const at = sorted.length < 2 ? 0.5 : sorted.indexOf(level) / (sorted.length - 1);
      return down ? at : 1 - at;
    };
  }
  const value = spacing === 'log' ? Math.log : (level: number) => level;
  const low = value(sorted[0]);
  const span = value(sorted[sorted.length - 1]) - low;
  return level => {
    const at = span === 0 ? 0.5 : (value(level) - low) / span;
    return down ? at : 1 - at;
  };
}

// Where any value sits on the axis levelPosition draws, between levels too, as a radar's lowest beam does. Linear and
// log place it by its value. Even spacing places each level a step apart, so a value between two goes between them in
// proportion, and one beyond the ends goes on at the end step
export function valuePosition(levels: number[], { spacing, direction, flipped = false }: { spacing: LevelSpacing; direction: Direction; flipped?: boolean }): (value: number) => number {
  if (spacing !== 'even') return levelPosition(levels, { spacing, direction, flipped });
  const down = (direction === 'down') !== flipped;
  const sorted = [...levels].sort((a, b) => a - b);
  const last = sorted.length - 1;
  return value => {
    if (last < 1) return 0.5;
    // The step it's in: the last whose lower level is at or below it, and the first or last step beyond the ends
    let low = 0;
    let high = last - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (sorted[middle] <= value) low = middle;
      else high = middle - 1;
    }
    const at = (low + (value - sorted[low]) / (sorted[low + 1] - sorted[low])) / last;
    return down ? at : 1 - at;
  };
}

const ROUNDNESS = [1000, 500, 100, 50, 10, 5, 1, 0.5, 0.1, 0.05, 0.01];
const roundness = (level: number) => {
  const at = ROUNDNESS.findIndex(step => Math.abs(level / step - Math.round(level / step)) < 1e-9);
  return at === -1 ? ROUNDNESS.length : at;
};

// Which levels get a label. Every level has a tick, and the labels are real levels: those that must have one, the
// ends, then the roundest, as many as fit apart
export function pickLevelLabels(levels: number[], toPixels: (level: number) => number, { minGap = 13, must = [] as number[] } = {}): Set<number> {
  const screen = [...levels].sort((a, b) => toPixels(a) - toPixels(b));
  const ends = screen.length ? [screen[0], screen[screen.length - 1]] : [];
  let rest = screen.filter(level => !ends.includes(level) && !must.includes(level)).sort((a, b) => roundness(a) - roundness(b));
  // Evenly spaced levels read best on an even step, 1, 5, 10, 15, and not whichever happen to fit
  const pixels = screen.map(toPixels);
  const gaps = pixels.slice(1).map((pixel, i) => pixel - pixels[i]);
  if (gaps.length > 1 && gaps.every(gap => Math.abs(gap - gaps[0]) < 0.01)) {
    const sorted = [...levels].sort((a, b) => a - b);
    const step = (sorted[1] - sorted[0]) * ([1, 2, 5, 10, 20, 50, 100, 200, 500].find(times => times * gaps[0] >= minGap) ?? 1000);
    rest = rest.filter(level => Math.abs(level / step - Math.round(level / step)) < 1e-9);
  }
  const chosen: number[] = [];
  for (const level of [...must, ...ends, ...rest]) {
    if (!chosen.includes(level) && chosen.every(other => Math.abs(toPixels(other) - toPixels(level)) >= minGap)) chosen.push(level);
  }
  return new Set(chosen);
}

export type AskedLevels = { kind: 'list'; values: number[] } | { kind: 'range'; lo: number; hi: number } | { kind: 'other' };

// What the request asked of z: a list of numbers, a range, or something else, such as a repeating interval
export function askedLevels(url: string | undefined): AskedLevels | null {
  const match = url ? /[?&]z=([^&#]*)/.exec(url) : null;
  if (!match) return null;
  let text: string;
  try {
    text = decodeURIComponent(match[1]).trim();
  } catch {
    return { kind: 'other' };
  }
  const range = /^(-?[\d.]+)\/(-?[\d.]+)$/.exec(text);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (Number.isFinite(a) && Number.isFinite(b)) return { kind: 'range', lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  const parts = text.split(',').map(part => (part.trim() === '' ? NaN : Number(part)));
  return parts.every(Number.isFinite) ? { kind: 'list', values: parts } : { kind: 'other' };
}

// The levels a collection lists in its extent, as numbers
export const declaredLevels = (vertical: Vertical | undefined): number[] => (vertical?.values ?? []).map(Number).filter(Number.isFinite);

// The extent's interval, lowest first, if it gives both ends
export function declaredInterval(vertical: Vertical | undefined): [number, number] | null {
  const first = vertical?.interval?.[0];
  if (!Array.isArray(first)) return null;
  const ends = first.filter(end => end !== null && end !== '').map(Number).filter(Number.isFinite);
  return ends.length === 2 ? [Math.min(...ends), Math.max(...ends)] : null;
}

// Declared levels count only if at least half of the levels sent are among them: they can be on another axis
export const declaredFits = (declared: number[], sent: number[]) => sent.filter(level => declared.includes(level)).length * 2 >= sent.length;

// The levels that should be there: what was asked for or, with nothing asked, all the collection declares. Those can
// be on another axis altogether, such as angles asked of a section that answers in metres. So asked levels count only
// if at least one came back, and declared ones only if at least half of what came back is declared
export function expectedLevels(asked: AskedLevels | null, declared: number[], sent: number[]): number[] {
  if (asked?.kind === 'list') return asked.values.some(level => sent.includes(level)) ? asked.values : [];
  if (asked?.kind === 'other' || !declaredFits(declared, sent)) return [];
  if (asked?.kind === 'range') return declared.filter(level => level >= asked.lo && level <= asked.hi);
  return declared;
}

export interface StatedVrs { direction?: Direction; unit?: string }

// What a collection's WKT2 vrs says of its axis: AXIS["Pressure (hPa)",down], and a UNIT if the axis has none
export function readVrs(vrs: unknown): StatedVrs | null {
  if (typeof vrs !== 'string' || !vrs.trim()) return null;
  const axis = /AXIS\["([^"]+)"\s*,\s*(\w+)/.exec(vrs);
  const inBrackets = axis ? /\(([^)]+)\)\s*$/.exec(axis[1])?.[1] : undefined;
  const unitName = /(?:PARAMETRICUNIT|LENGTHUNIT|ANGLEUNIT|\bUNIT)\["([^"]+)"/.exec(vrs)?.[1];
  return { direction: cleanDirection(axis?.[2]), unit: cleanUnit(inBrackets ?? unitName) };
}

// The collection's vrs, for checking the response against, only where it's about the levels sent: radars declare
// elevation angles and answer a trajectory in metres. Every level has to be among those declared, or inside the
// interval if none are listed. It's never used to read the response: that's the response's own to say
export function vrsAbout(vertical: Vertical | undefined, levels: number[]): StatedVrs | null {
  if (!vertical?.vrs || levels.length === 0) return null;
  const declared = declaredLevels(vertical);
  const interval = declaredInterval(vertical);
  const fits = declared.length > 0
    ? levels.every(level => declared.includes(level))
    : interval !== null && levels.every(level => level >= interval[0] && level <= interval[1]);
  return fits ? readVrs(vertical.vrs) : null;
}

// Nothing between a number and a degree sign
export const withUnit = (value: number | string, unit: string) => (!unit ? String(value) : unit === '°' ? `${value}°` : `${value} ${unit}`);

// What the response says of z against what a client needs to read it: z's direction and unit in the response itself,
// and a reference system with a vertical axis. An issue where it's left out or said only in words, a pass where it's
// there. The same for a profile and a path
export function zFindings(axis: VerticalAxis, zPath: string, referencingPath: string): ValidationError[] {
  const found: ValidationError[] = [];
  const say = (severity: 'warning' | 'pass', message: string, path = zPath) => found.push({ message, path, severity });
  if (axis.directionSource === 'response') say('pass', `z's direction is in the response: ${axis.direction}`);
  else if (axis.directionSource === 'usual') say('warning', `z's direction isn't in the response: assumed ${axis.direction}, as usual for ${axis.usualWords}`);
  else say('warning', "z's direction isn't in the response, and nothing says what z is: assumed up");
  if (axis.againstUsual) say('warning', `z is ${axis.usualWords} and says it runs ${axis.direction}, against the usual`);
  if (axis.flatCrs) say('warning', `z is referenced to ${axis.flatCrs}, which has no vertical axis`, referencingPath);
  // A level number needs no unit
  if (axis.unitSource === 'response' && axis.unit) say('pass', `z's unit is in the response: ${axis.unit}`);
  else if (axis.unitSource === 'description') say('warning', `z's unit, ${axis.unit}, is only in a description, and not in its reference system's axis`);
  else if (axis.unitSource === 'none' && axis.kind !== 'modelLevel') say('warning', 'z has no unit in the response');
  return found;
}
