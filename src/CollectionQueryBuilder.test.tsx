import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionQueryBuilder from './CollectionQueryBuilder';
import type { Collection } from './DataRetrievalAPI';
import { words } from './coverage/cellsTestData';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { DimMode } from './query/dimensionText';
import type { QueryIssue } from './query/types';

// The form's level field and custom dimension fields, for each form their text can take. What they need from around
// them is stood in for
const issues = vi.hoisted(() => ({ list: [] as QueryIssue[] }));
vi.mock('./contexts/CollectionContext', () => ({ useCollection: () => ({ selectedFeature: null, collectionUrl: 'x' }) }));
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ showMap: () => {} }) }));
vi.mock('./contexts/OpenCollectionContext', () => ({ useOpenCollection: () => ({ leaveQuery: () => {} }) }));
vi.mock('./hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ issues: issues.list, active: true, apiOperation: null }) }));
vi.mock('./QueryIssuesPanel', async importOriginal => ({ ...(await importOriginal<object>()), default: () => <i>the issues</i> }));
vi.mock('./QueryTypeInputs', () => ({ default: () => null }));
vi.mock('./TimeControl', () => ({ default: () => null }));
vi.mock('./InstancePicker', () => ({ default: () => null }));

beforeEach(() => {
  issues.list = [];
});

const LEVELS = ['1000', '925', '850', '700', '500'];
const LISTED = { values: LEVELS, interval: [['1000', '500']] };
// KNMI's ensemble member, as uwcw-ha-ens-nl-2km.hagl_member lists it (2026-11-08), five of its thirty
const MEMBER = { id: 'member', values: ['1', '2', '3', '4', '5'], interval: [['1', '5']], reference: 'https://example.org/eps.pdf' };

interface Form {
  z?: string;
  zMode?: DimMode;
  vertical?: Record<string, unknown>;
  member?: string;
  memberMode?: DimMode;
  custom?: Record<string, unknown>[];
}

function render({ z = '', zMode = 'individual', vertical = LISTED, member, memberMode, custom = [] }: Form): string {
  const nothing = () => {};
  const state = {
    selectedDataQuery: 'position', selectDataQuery: nothing, selectedInstance: null, instanceQueryKey: '',
    selectedFormat: '', setSelectedFormat: nothing, getEffectiveOutputFormats: () => [],
    selectedParameters: [], setSelectedParameters: nothing,
    vertical: z, setVertical: nothing, verticalMode: zMode, setVerticalMode: nothing,
    dimensions: member === undefined ? {} : { member }, setDimension: nothing,
    dimensionModes: memberMode ? { member: memberMode } : {}, setDimensionMode: nothing,
    queryParams: {}, setQueryParam: nothing, bboxAsCoords: false, setBboxAsCoords: nothing, filterByTime: false, setFilterByTime: nothing,
  } as unknown as UseQueryUrlReturn;
  const collection = {
    id: 'ifs', extent: { vertical, custom },
    data_queries: { position: { link: { href: 'https://a.example/collections/ifs/position', rel: 'data', variables: { query_type: 'position' } } } },
  } as unknown as Collection;
  return renderToStaticMarkup(<CollectionQueryBuilder collection={collection} queryState={state} />);
}

// One field's markup: from its id to the next field's
function field(html: string, id: string): string {
  const from = html.indexOf(`id="query-field-${id}"`);
  const next = html.indexOf('id="query-field-', from + 1);
  return html.slice(from, next < 0 ? undefined : next);
}
const levels = (options: Form) => field(render(options), 'z');
const member = (options: Form) => field(render({ ...options, custom: [MEMBER] }), 'dim:member');
// Only what shows, read tag by tag
const shown = words;
const count = (html: string, text: string) => html.split(text).length - 1;
const LISTBOX = 'aria-haspopup="listbox"';

describe('the level field', () => {
  it('chooses one level or several', () => {
    const html = levels({});
    expect(shown(html)).toContain('Individual Levels');
    expect(shown(html)).toContain('Select Levels');
    expect(html).toContain(LISTBOX);
  });

  it('shows a list, as from a link, as the levels it names', () => {
    const html = levels({ z: '1000,925,850' });
    expect(shown(html)).toContain('1000, 925, 850');
    expect(html).toContain('value="1000,925,850"');
  });

  it('shows a level written otherwise as the collection writes it, and one it doesn’t list as it was', () => {
    expect(levels({ z: '1000.0,777' })).toContain('value="1000,777"');
  });

  it('keeps a repeating interval as text, which the list can’t show', () => {
    const html = levels({ z: 'R3/500/100' });
    expect(html).not.toContain(LISTBOX);
    expect(html).toContain('value="R3/500/100"');
    expect(shown(html)).toContain('A level, several separated by commas, a range as 1000/500, or R3/500/100 for 3 steps of 100 from 500');
  });

  it('takes text where the collection lists no levels, only an interval', () => {
    const html = levels({ z: '1000,850', vertical: { interval: [['1000', '500']] } });
    expect(html).not.toContain(LISTBOX);
    expect(html).toContain('value="1000,850"');
    expect(html).toContain('placeholder="e.g. 1000, or 1000,850,500"');
  });

  it('says what’s wrong under it', () => {
    issues.list = [{ id: 'metadata:z:offered', severity: 'error', source: 'metadata', field: 'z', message: "Level 777 isn't one of the collection's levels", input: 'form' }];
    expect(shown(levels({ z: '1000,777' }))).toContain("Level 777 isn't one of the collection's levels");
  });

  it('has the range’s two ends in range mode', () => {
    const html = levels({ zMode: 'range' });
    expect(shown(html)).toContain('Start Level');
    expect(shown(html)).toContain('End Level');
    expect(shown(html)).not.toContain('Select Levels');
    expect(count(html, LISTBOX)).toBe(2);
  });

  it('shows the mode it’s given as the radio checked', () => {
    expect(levels({ zMode: 'range' })).toContain('checked="" value="range"');
    expect(levels({})).toContain('checked="" value="individual"');
  });
});

// The text holds what's sent whichever mode shows it, so a mode switched never hides or loses it
describe('the level field, a range', () => {
  it('shows a range’s ends in the range’s dropdowns', () => {
    const html = levels({ z: '1000/500', zMode: 'range' });
    expect(html).toContain('value="1000"');
    expect(html).toContain('value="500"');
    expect(shown(html)).not.toContain('Not a range of two ends, so shown as it is sent');
  });

  it('shows a range with one end picked, and the other still to pick', () => {
    const html = levels({ z: '850/', zMode: 'range' });
    expect(html).toContain('value="850"');
    expect(count(html, 'value=""')).toBeGreaterThan(0);
  });

  it('shows an end the collection doesn’t list, rather than going blank', () => {
    const html = levels({ z: '1000/777', zMode: 'range' });
    expect(html).toContain('value="777"');
    expect(shown(html)).toContain('777');
    expect(shown(html)).toContain("Not one of the collection's levels");
  });

  it('shows a whole range as text in the one-value mode, which its dropdown can’t hold', () => {
    const html = levels({ z: '1000/500' });
    expect(html).not.toContain(LISTBOX);
    expect(html).toContain('value="1000/500"');
  });

  it('shows a list as text in the range mode, saying it isn’t a range', () => {
    const html = levels({ z: '1000,925,850', zMode: 'range' });
    expect(html).not.toContain(LISTBOX);
    expect(html).toContain('value="1000,925,850"');
    expect(shown(html)).toContain('Not a range of two ends, so shown as it is sent');
    expect(shown(html)).not.toContain('Start Level');
  });

  it('takes a range’s ends as text where the collection lists no levels', () => {
    const html = levels({ z: '1000/500', zMode: 'range', vertical: { interval: [['1000', '500']] } });
    expect(html).not.toContain(LISTBOX);
    expect(shown(html)).toContain('Start Level');
    expect(html).toContain('value="1000"');
    expect(html).toContain('value="500"');
  });

  it('says when there are too many levels to list, and takes text', () => {
    const many = Array.from({ length: 300 }, (_, i) => String(i));
    const html = levels({ z: '5', vertical: { values: many } });
    expect(shown(html)).toContain('This collection has a large vertical range (300 values, limit: 250). Using text input for easier selection.');
    expect(html).not.toContain(LISTBOX);
    expect(html).toContain('value="5"');
  });
});

describe('a custom dimension’s field', () => {
  it('chooses one value or several, as the level field does', () => {
    const html = member({ member: '1,2,3' });
    expect(shown(html)).toContain('member Selection (https://example.org/eps.pdf)');
    expect(shown(html)).toContain('Individual Values');
    expect(shown(html)).toContain('Select Values');
    expect(shown(html)).toContain('1, 2, 3');
    expect(html).toContain('value="1,2,3"');
    expect(html).toContain(LISTBOX);
  });

  it('shows a value it doesn’t list, as from a link', () => {
    expect(member({ member: '1,31' })).toContain('value="1,31"');
  });

  it('has a range’s two ends in range mode', () => {
    const html = member({ member: '1/5', memberMode: 'range' });
    expect(shown(html)).toContain('Start Value');
    expect(shown(html)).toContain('End Value');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="5"');
  });

  it('shows a list as text in the range mode', () => {
    const html = member({ member: '1,2,3', memberMode: 'range' });
    expect(html).toContain('value="1,2,3"');
    expect(shown(html)).toContain('Not a range of two ends, so shown as it is sent');
  });

  it('starts empty, in the one-value mode', () => {
    const html = member({});
    expect(html).toContain('checked="" value="individual"');
    expect(html).toContain('value=""');
  });
});
