// The parameter rows' choice, apart from the component that shows them. Pure
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
