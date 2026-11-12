// What the parameter rows choose, and how wide their columns are, apart from the component that shows them. Pure
import type { ParameterRow } from '../query/mapOffer';

// What's chosen after a tap on a row. One at a time: that one, or none where it was the one chosen. Several: that one
// added or taken out, in the rows' order, with any not listed, as a link may name them, first
export function nextChosen(rows: readonly ParameterRow[], chosen: readonly string[], id: string, several: boolean): string[] {
  const on = chosen.includes(id);
  if (!several) return on && chosen.length === 1 ? [] : [id];
  const next = new Set(chosen);
  if (on) next.delete(id);
  else next.add(id);
  const listed = rows.map(row => row.id);
  return [...chosen.filter(each => !listed.includes(each) && next.has(each)), ...listed.filter(each => next.has(each))];
}

// The rows' columns: as many characters as the longest id and the longest unit, and a pixel for rounding
export function rowColumns(ids: readonly string[], units: readonly string[]): string {
  const longest = (texts: readonly string[]) => Math.max(0, ...texts.map(text => text.length));
  return `18px min(calc(${longest(ids)}ch + 1px), 40%) minmax(0, 1fr) calc(${longest(units)}ch + 1px)`;
}
