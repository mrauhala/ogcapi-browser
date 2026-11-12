// A map's subset as the text that's sent: comma-separated parts, each an axis and a value or an interval, as OGC API -
// Maps - Part 1: Core 1.0 (OGC 20-058, an approved standard published 2024-08-09) writes them. Read, checked against
// its grammar, and edited one axis at a time, keeping the rest as typed. Pure.
//
// /req/spatial-subsetting/subset-definition A: "The implementation SHALL support a subset parameter conforming to the
// following Augmented Backus Naur Form (ABNF) fragment: SubsetSpec = "subset" "=" axisName "(" intervalOrSingle ")"
// intervalOrSingle = interval / single interval = low ":" high low = single high = single single = number Where:
// `axisName` is an abbreviation identifying an axis starting by a lowercase or uppercase letter A-Z, optionally followed
// by any number of alphanumeric characters `number` is an integer or floating-point number."
// /req/general-subsetting/subset-definition A has the same fragment with "single = number / text / "*"", where "`text`
// is some general ASCII text (such as a time and date notation in RFC 3339 section 5.6) enclosed in double-quotes", and
// "An asterisk (`*`) can be used for `low` or `high` to indicate the minimum/maximum value. For an additional temporal
// dimension, a single asterisk may be supported to indicate the latest available time." /req/datetime/subset-definition
// A has it for time. Several axes go in one parameter, comma-separated: /req/spatial-subsetting/subset-definition I,
// "Multiple subset parameters SHALL be interpreted, as if all dimension subsetting values were provided in a single
// subset parameter (comma separated)".
import { paramValues } from './requestUrl';

// A request line's subset: all of its subset parameters as one, comma-separated, as I has them
export const subsetIn = (url: string): string => paramValues(url, 'subset').map(value => value.trim()).filter(Boolean).join(',');

// Where a character is outside quotes and parentheses: the parts' commas and an interval's colon
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '(') depth++;
    else if (!quoted && char === ')') depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && char === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// The parts as typed, trimmed: none for an empty text
export function subsetParts(text: string): string[] {
  return text.trim() ? splitTopLevel(text, ',').map(part => part.trim()) : [];
}

// The name and what's in the parentheses, however wrong either is: null where the part isn't name(…)
const SHAPE = /^([^()\s]*)\s*\((.*)\)$/s;
function shapeOf(part: string): { axis: string; body: string } | null {
  const match = SHAPE.exec(part.trim());
  return match ? { axis: match[1], body: match[2].trim() } : null;
}

// The axis a part names: what's before its parenthesis
export const axisOfPart = (part: string): string | null => shapeOf(part)?.axis || null;

// The axes the text names, in its order
export const subsetAxes = (text: string): string[] => subsetParts(text).flatMap(part => {
  const axis = axisOfPart(part);
  return axis ? [axis] : [];
});

// What the text gives an axis, inside its parentheses, as typed: null where it doesn't name the axis
export function axisBody(text: string, axis: string): string | null {
  for (const part of subsetParts(text)) {
    const shape = shapeOf(part);
    if (shape?.axis === axis) return shape.body;
  }
  return null;
}

// The text with an axis given this body, in its part's place or after the others, or taken out with null. The other
// parts stay as typed
export function withAxis(text: string, axis: string, body: string | null): string {
  const parts = subsetParts(text);
  const at = parts.findIndex(part => axisOfPart(part) === axis);
  const written = body === null ? null : `${axis}(${body})`;
  if (at < 0) return written === null ? text : [...parts.filter(Boolean), written].join(',');
  const next = parts.flatMap((part, index) => (index !== at ? [part] : written === null ? [] : [written]));
  return next.filter(Boolean).join(',');
}

// A value: a number, text in double quotes, or *
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const QUOTED = /^"[^"]*"$/;
export const isNumber = (value: string) => NUMBER.test(value);
const isValue = (value: string) => NUMBER.test(value) || QUOTED.test(value) || value === '*';

// A value as written in a part: a number as it is, anything else in double quotes
export const subsetValue = (value: string | number): string => (typeof value === 'number' || NUMBER.test(value) ? String(value) : `"${value}"`);
// A value as the metadata lists it: without its quotes
export const unquoted = (value: string): string => (QUOTED.test(value) ? value.slice(1, -1) : value);

// An axis name: a letter, then letters or digits. The ABNF has no _, but /req/general-subsetting/subset-definition B,
// "Any name of the additional dimensions in the extent of the collection SHALL be supported as an axis name", and the
// standard's own example under F, subset=atm_pressure_hpa(500), take one, as reference_time is
const AXIS = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface ParsedPart {
  axis: string;
  values: string[]; // one, or an interval's low and high, as typed
}

// A part read by the grammar: its axis and its value or ends, or what's wrong with it
export function parsePart(part: string): ParsedPart | { error: string } {
  if (!part) return { error: 'An empty part between commas' };
  const shape = shapeOf(part);
  if (!shape) return { error: `${part} isn't axis(value) or axis(low:high)` };
  if (!AXIS.test(shape.axis)) return { error: `${shape.axis || 'The part'} isn't an axis name: a letter, then letters, digits or _` };
  // A time without its quotes: its own colons would read as an interval's
  if (!shape.body.includes('"') && /\d{4}-\d{2}/.test(shape.body)) {
    return { error: `${shape.body} in ${shape.axis}(…) isn't a number, text in double quotes, or *: a time goes in double quotes` };
  }
  const values = splitTopLevel(shape.body, ':').map(value => value.trim());
  if (values.length > 2) return { error: `${shape.axis}(${shape.body}) has more than a low and a high` };
  if (values.some(value => !value)) return { error: `${shape.axis}(${shape.body}) is missing ${values.length === 2 ? 'an end' : 'its value'}` };
  const wrong = values.find(value => !isValue(value));
  if (wrong !== undefined) return { error: `${wrong} in ${shape.axis}(…) isn't a number, text in double quotes, or *` };
  return { axis: shape.axis, values };
}
