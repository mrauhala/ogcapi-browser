// Where keys mean something of their own: a field being typed in, or a list, menu or popover open to pick from. A
// select or a combobox takes letters to find an entry, and a menu takes PageUp and PageDown, so the app's shortcuts
// leave keys from these alone. Ctrl/Cmd+Enter, to send, works from anywhere and doesn't ask.
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const TAKES_ITS_OWN_KEYS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '.MuiPopover-root',
  '.MuiPopper-root',
].join(', ');

// What a key event's target is read for: an element, as the browser gives it
interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selectors: string) => unknown;
}

export function takesItsOwnKeys(target: EventTarget | null): boolean {
  const element = target as KeyTarget | null;
  if (!element) return false;
  if (typeof element.tagName === 'string' && FIELD_TAGS.has(element.tagName.toUpperCase())) return true;
  if (element.isContentEditable === true) return true;
  return typeof element.closest === 'function' && element.closest(TAKES_ITS_OWN_KEYS) != null;
}
