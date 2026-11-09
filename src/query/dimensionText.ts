// datetime, z and custom dimensions as the text that's sent: one string each, whichever control wrote it. The form's
// controls show it in their own terms, one value or a list, or a range's two ends, and write it back whole, so that
// switching between them keeps what's there.

export type DimMode = 'individual' | 'range';

const repeating = (text: string) => /^R\d/.test(text.trim());

// An interval's two ends, start/end; null for anything else: one value, a list, a repeating interval (R5/100/50) or
// more than one slash. An end is empty while it's still to pick, and .. where a time's interval is open.
export function intervalEnds(text: string): { start: string; end: string } | null {
  if (repeating(text)) return null;
  const parts = text.split('/');
  return parts.length === 2 ? { start: parts[0].trim(), end: parts[1].trim() } : null;
}

// The mode a text shows in when it comes whole, from a link or a typed URL: a range for an interval
export const modeOf = (text: string): DimMode => (intervalEnds(text) ? 'range' : 'individual');

// A range's text as its control holds it. An end still to pick is left empty, start/ or /end, which the checks flag
// as missing; a time's is left open, .., as EDR allows for datetime.
export function intervalText(start: string, end: string, open = false): string {
  if (!start && !end) return '';
  const blank = open ? '..' : '';
  return `${start || blank}/${end || blank}`;
}

// The text with one end of its range set and the other kept: a control's two ends each write the whole text. A time's
// open end, .., is one still to pick.
export function withEnd(text: string, which: 'start' | 'end', value: string, open = false): string {
  const ends = intervalEnds(text);
  const kept = (end: string | undefined) => (end && !(open && end === '..') ? end : '');
  return which === 'start' ? intervalText(value, kept(ends?.end), open) : intervalText(kept(ends?.start), value, open);
}

// The text once its control is switched to the other mode, keeping what's there. One value becomes a range's start,
// and a range with one end becomes that value. A time control shows one time, so a time's range becomes its start,
// or its end if it's open at the start. What the other control can't hold, a list, a repeating interval or a level's
// whole range, stays as it is, for the field to show as text.
export function switchMode(text: string, to: DimMode, time = false): string {
  const ends = intervalEnds(text);
  const value = text.trim();
  if (to === 'range') return !ends && value && !value.includes(',') && !repeating(value) ? intervalText(value, '', time) : text;
  if (!ends) return text;
  const start = ends.start === '..' ? '' : ends.start;
  const end = ends.end === '..' ? '' : ends.end;
  if (time) return start || end;
  return start && end ? text : start || end;
}

// The text if it's whole, '' if it's a range still missing an end: what can go into requests other than the form's,
// the map layers'. An open end, .., is whole.
export function wholeValue(text: string): string {
  const ends = intervalEnds(text);
  return ends && (!ends.start || !ends.end) ? '' : text.trim();
}
