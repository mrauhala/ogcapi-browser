import { describe, expect, it } from 'vitest';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ItemText from './ItemText';
import { itemToSet } from './itemEdit';

const render = (props: Partial<React.ComponentProps<typeof ItemText>> = {}) =>
  renderToStaticMarkup(<ItemText value="" onChange={() => {}} {...props} />);

describe('ItemText', () => {
  it('shows the form’s item, in an input of its own', () => {
    const html = render({ value: '01AD001' });
    expect(html).toContain('value="01AD001"');
    expect(html).toContain('id="query-input-item"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain('autoComplete="off"');
  });

  it('says what to type, and is named, by what the collection’s items are', () => {
    const item = render();
    expect(item).toContain('placeholder="An item&#x27;s id, or none for the list"');
    expect(item).toContain('aria-label="item"');
    const record = render({ word: 'record' });
    expect(record).toContain('placeholder="A record&#x27;s id, or none for the list"');
    expect(record).toContain('aria-label="record"');
  });

  it('is empty for the list', () => {
    expect(render()).toContain('value=""');
  });
});

describe('itemToSet', () => {
  it('sets what’s typed on Enter and on leaving the field, without the spaces around it', () => {
    expect(itemToSet('01AD001', '', 'enter')).toBe('01AD001');
    expect(itemToSet(' 01AD001 ', '', 'blur')).toBe('01AD001');
  });

  it('sets none, for the list, when what was there is taken out', () => {
    expect(itemToSet('', '01AD001', 'enter')).toBe('');
    expect(itemToSet('  ', '01AD001', 'blur')).toBe('');
  });

  it('changes nothing for the same id, or when nothing was typed', () => {
    expect(itemToSet('01AD001', '01AD001', 'enter')).toBeNull();
    expect(itemToSet(' 01AD001', '01AD001', 'blur')).toBeNull();
    expect(itemToSet(null, '01AD001', 'enter')).toBeNull();
    expect(itemToSet(null, '', 'blur')).toBeNull();
  });

  it('puts back what was there on Escape', () => {
    expect(itemToSet('typed', '01AD001', 'escape')).toBeNull();
    expect(itemToSet('', '01AD001', 'escape')).toBeNull();
  });
});
