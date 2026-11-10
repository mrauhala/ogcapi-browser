import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ParamText from './ParamText';
import { withClass, words as allWords } from '../coverage/cellsTestData';

// The request line as typed, and the URL the form builds from what it could read of it
const around = vi.hoisted(() => ({ requestUrl: '', collectionUrl: '' }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('../contexts/CollectionContext', () => ({ useCollection: () => ({ collectionUrl: around.collectionUrl }) }));
vi.mock('../contexts/OpenRequestContext', () => ({ useOpenRequest: () => ({ openRequest: () => {} }) }));

const BASE = 'https://meteocore.app.meteo.fi/edr/collections/ecmwf-ifs-pressure/position';
beforeEach(() => {
  around.requestUrl = `${BASE}?coords=POINT(24.94 60.17)&z=1000,925`;
  around.collectionUrl = `${BASE}?coords=POINT(24.940 60.170)&z=1000,925`;
});

const render = (props: Partial<React.ComponentProps<typeof ParamText>> = {}) => renderToStaticMarkup(<ParamText name="coords" {...props} />);
const count = (html: string, text: string) => html.split(text).length - 1;
// What shows, without the zero-width space an outlined field's empty legend holds
const words = (html: string) => allWords(html).replace(/\u200b/g, '').trim();
const ORANGE_OUTLINE = 'MuiOutlinedInput-notchedOutline{border-color:#ed6c02';

describe('ParamText', () => {
  it('shows the parameter as the line has it, as typed, not as the form writes it', () => {
    const html = render();
    expect(html).toContain('value="POINT(24.94 60.17)"');
    expect(html).toContain('id="query-input-coords"');
    expect(html).toContain('aria-label="coords"');
    expect(html).toContain('spellcheck="false"');
  });

  it('is empty, with what to type, where the line hasn’t the parameter', () => {
    const html = render({ name: 'datetime', placeholder: 'Pick a time below, or type one' });
    expect(html).toContain('value=""');
    expect(html).toContain('placeholder="Pick a time below, or type one"');
    expect(words(html)).toBe('');
  });

  it('says when the form can’t read what was typed, which is sent as it is', () => {
    around.requestUrl = `${BASE}?coords=POINT(abc)`;
    around.collectionUrl = BASE;
    const html = render();
    expect(html).toContain('value="POINT(abc)"');
    expect(words(html)).toBe("The form can't read this. It's sent as typed");
    expect(count(html, ORANGE_OUTLINE)).toBeGreaterThan(0);
  });

  it('leaves it to the field’s own issues where it has some', () => {
    around.requestUrl = `${BASE}?z=850/`;
    around.collectionUrl = BASE;
    expect(words(render({ name: 'z', noted: true }))).toBe('');
    expect(words(render({ name: 'z' }))).toBe("The form can't read this. It's sent as typed");
  });

  it('says nothing of a value the form read, or a blank one', () => {
    expect(words(render())).toBe('');
    expect(count(render(), ORANGE_OUTLINE)).toBe(0);
    around.requestUrl = `${BASE}?coords=%20`;
    around.collectionUrl = BASE;
    expect(words(render())).toBe('');
  });

  it('outlines an error red, and a warning orange', () => {
    expect(withClass(render({ error: true }), 'Mui-error')).toBeGreaterThan(0);
    expect(withClass(render(), 'Mui-error')).toBe(0);
    expect(count(render({ warning: true }), ORANGE_OUTLINE)).toBeGreaterThan(0);
    // An error's red wins
    expect(count(render({ error: true, warning: true }), ORANGE_OUTLINE)).toBe(0);
  });

  it('takes the width given, else the whole row, and an id of its own if given one', () => {
    expect(withClass(render(), 'MuiFormControl-fullWidth')).toBe(1);
    const narrow = render({ name: 'within', width: 128 });
    expect(withClass(narrow, 'MuiFormControl-fullWidth')).toBe(0);
    expect(narrow).toContain('width:128px');
    expect(render({ inputId: 'my-coords' })).toContain('id="my-coords"');
  });
});
