import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionQueryBuilder from './CollectionQueryBuilder';
import type { Collection } from './DataRetrievalAPI';
import { words } from './coverage/cellsTestData';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { QueryIssue } from './query/types';

// The form's level field, for each form z can take. What it needs from around it is stood in for
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
const collection = (vertical: Record<string, unknown>) => ({
  id: 'ifs', extent: { vertical },
  data_queries: { position: { link: { href: 'https://a.example/collections/ifs/position', rel: 'data', variables: { query_type: 'position' } } } },
}) as unknown as Collection;

function form(selectedVertical: string, vertical: Record<string, unknown> = { values: LEVELS, interval: [['1000', '500']] }, verticalMode: 'individual' | 'range' = 'individual') {
  const nothing = () => {};
  const state = {
    selectedDataQuery: 'position', selectDataQuery: nothing, selectedInstance: null, instanceQueryKey: '',
    selectedFormat: '', setSelectedFormat: nothing, getEffectiveOutputFormats: () => [],
    selectedParameters: [], setSelectedParameters: nothing,
    selectedVertical, setSelectedVertical: nothing, verticalMode, setVerticalMode: nothing,
    startVertical: '', setStartVertical: nothing, endVertical: '', setEndVertical: nothing,
    selectedCustomDimensions: {}, setSelectedCustomDimensions: nothing, customDimensionModes: {}, setCustomDimensionModes: nothing,
    customDimensionStarts: {}, setCustomDimensionStarts: nothing, customDimensionEnds: {}, setCustomDimensionEnds: nothing,
    queryParams: {}, setQueryParam: nothing, bboxAsCoords: false, setBboxAsCoords: nothing, filterByTime: false, setFilterByTime: nothing,
  } as unknown as UseQueryUrlReturn;
  const html = renderToStaticMarkup(<CollectionQueryBuilder collection={collection(vertical)} queryState={state} />);
  return html.slice(html.indexOf('id="query-field-z"'));
}
// Only what shows, read tag by tag
const shown = words;

describe('the level field', () => {
  it('chooses one level or several', () => {
    const html = form('');
    expect(shown(html)).toContain('Individual Levels');
    expect(shown(html)).toContain('Select Levels');
    expect(html).toContain('aria-haspopup="listbox"');
  });

  it('shows a list, as from a link, as the levels it names', () => {
    const html = form('1000,925,850');
    expect(shown(html)).toContain('1000, 925, 850');
    expect(html).toMatch(/<input[^>]*value="1000,925,850"/);
  });

  it('shows a level written otherwise as the collection writes it, and one it doesn’t list as it was', () => {
    expect(form('1000.0,777')).toMatch(/<input[^>]*value="1000,777"/);
  });

  it('keeps a repeating interval as text, which the list can’t show', () => {
    const html = form('R3/500/100');
    expect(html).not.toContain('aria-haspopup="listbox"');
    expect(html).toMatch(/<input[^>]*value="R3\/500\/100"/);
    expect(shown(html)).toContain('A level, several separated by commas, or R3/500/100 for 3 steps of 100 from 500');
  });

  it('takes text where the collection lists no levels, only an interval', () => {
    const html = form('1000,850', { interval: [['1000', '500']] });
    expect(html).not.toContain('aria-haspopup="listbox"');
    expect(html).toMatch(/<input[^>]*value="1000,850"[^>]*placeholder="e.g. 1000, or 1000,850,500"|placeholder="e.g. 1000, or 1000,850,500"[^>]*value="1000,850"/);
  });

  it('says what’s wrong under it', () => {
    issues.list = [{ id: 'metadata:z:offered', severity: 'error', source: 'metadata', field: 'z', message: "Level 777 isn't one of the collection's levels", input: 'form' }];
    expect(shown(form('1000,777'))).toContain("Level 777 isn't one of the collection's levels");
  });

  it('has the range’s two ends in range mode', () => {
    const html = form('', undefined, 'range');
    expect(shown(html)).toContain('Start Level');
    expect(shown(html)).toContain('End Level');
    expect(shown(html)).not.toContain('Select Levels');
  });
});
