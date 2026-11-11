// What Enter, leaving the field or Escape does with what's typed in an item's field: the item to set, or null to leave
// the form's as it is. Either way the field shows the form's again. Escape puts back what was there, and nothing typed,
// or the same id again, changes nothing
export type ItemAction = 'enter' | 'blur' | 'escape';

export function itemToSet(draft: string | null, value: string, action: ItemAction): string | null {
  if (action === 'escape' || draft === null) return null;
  const item = draft.trim();
  return item === value ? null : item;
}
