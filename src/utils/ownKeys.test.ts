import { describe, expect, it } from 'vitest';
import { takesItsOwnKeys } from './ownKeys';

// An element as a key event gives it, standing in for the DOM: its tag, and what it sits in, each with a tag, a role
// and classes that closest() matches against
interface Fake { tag: string; role?: string; classes?: string[]; editable?: boolean; parent?: Fake }

function matches(element: Fake, selector: string): boolean {
  const role = /^\[role="(.+)"\]$/.exec(selector);
  if (role) return element.role === role[1];
  if (selector.startsWith('.')) return (element.classes ?? []).includes(selector.slice(1));
  if (selector.startsWith('[contenteditable]')) return element.editable === true;
  return element.tag.toLowerCase() === selector;
}

function target(element: Fake) {
  return {
    tagName: element.tag,
    isContentEditable: !!element.editable,
    closest: (selectors: string) => {
      const each = selectors.split(', ');
      for (let at: Fake | undefined = element; at; at = at.parent) if (each.some(selector => matches(at!, selector))) return at;
      return null;
    },
  } as unknown as EventTarget;
}

const body: Fake = { tag: 'BODY' };
const inBody = (element: Fake): Fake => ({ ...element, parent: body });

describe('takesItsOwnKeys', () => {
  it('leaves the shortcuts the keys from the page itself and from buttons', () => {
    expect(takesItsOwnKeys(target(body))).toBe(false);
    expect(takesItsOwnKeys(target(inBody({ tag: 'BUTTON' })))).toBe(false);
    expect(takesItsOwnKeys(target(inBody({ tag: 'DIV', role: 'group', classes: ['MuiBox-root'] })))).toBe(false);
    expect(takesItsOwnKeys(null)).toBe(false);
  });

  it('keeps the keys typed in a field', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) expect(takesItsOwnKeys(target(inBody({ tag })))).toBe(true);
    expect(takesItsOwnKeys(target(inBody({ tag: 'DIV', editable: true })))).toBe(true);
    // Without closest(), as a bare event target: by its tag alone
    expect(takesItsOwnKeys({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(takesItsOwnKeys({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(takesItsOwnKeys({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(takesItsOwnKeys({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('keeps the keys of a select, and of a list or menu open to pick from', () => {
    for (const role of ['combobox', 'listbox', 'option', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio']) {
      expect(takesItsOwnKeys(target(inBody({ tag: 'DIV', role })))).toBe(true);
    }
    // An option's text, inside the option
    const option: Fake = { tag: 'LI', role: 'option', parent: { tag: 'UL', role: 'listbox', parent: body } };
    expect(takesItsOwnKeys(target({ tag: 'SPAN', parent: option }))).toBe(true);
  });

  it('keeps the keys of anything in an open popover', () => {
    expect(takesItsOwnKeys(target({ tag: 'BUTTON', parent: { tag: 'DIV', classes: ['MuiPopover-root'], parent: body } }))).toBe(true);
    expect(takesItsOwnKeys(target({ tag: 'LI', parent: { tag: 'DIV', classes: ['MuiPopper-root'], parent: body } }))).toBe(true);
  });
});
