import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionQueryBuilder from './CollectionQueryBuilder';
import type { Collection } from './DataRetrievalAPI';
import { words } from './coverage/cellsTestData';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { DimMode } from './query/dimensionText';
import type { QueryIssue } from './query/types';
import fmiEcmwf from './query/__fixtures__/fmi-ecmwf.json';
import meteocoreObs from './query/__fixtures__/meteocore-fmi-obs.json';

// The form: its fields as blocks, each a title and the name as sent, and the level and custom dimension fields for
// each form their text can take. What they need from around them is stood in for
const issues = vi.hoisted(() => ({ list: [] as QueryIssue[] }));
const around = vi.hoisted(() => ({ requestUrl: 'https://a.example/edr/collections/ifs/position', radius: null as number | null, radiusUnits: '', mobile: false }));
vi.mock('./contexts/CollectionContext', () => ({ useCollection: () => ({ selectedFeature: null, collectionUrl: around.requestUrl, locationFeatures: [] }) }));
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ showMap: () => {}, isMobile: around.mobile }) }));
vi.mock('./contexts/OpenCollectionContext', () => ({ useOpenCollection: () => ({ leaveQuery: () => {} }) }));
vi.mock('./contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl }) }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => ({ apiUrl: 'https://a.example/edr/' }) }));
vi.mock('./contexts/OpenApiContext', () => ({ useOpenApi: () => ({ status: 'none', description: null }) }));
vi.mock('./contexts/MapInteractionContext', () => ({
  useMapInteraction: () => ({
    radius: around.radius, setRadius: () => {}, radiusUnits: around.radiusUnits, setRadiusUnits: () => {},
    selectedBbox: null, setSelectedBbox: () => {}, viewExtent: null,
  }),
}));
vi.mock('./hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ issues: issues.list, active: true, apiOperation: null }) }));
vi.mock('./TimeControl', () => ({ default: () => null }));
vi.mock('./InstancePicker', () => ({ default: () => null }));

beforeEach(() => {
  issues.list = [];
  around.requestUrl = 'https://a.example/edr/collections/ifs/position';
  around.radius = null;
  around.radiusUnits = '';
  around.mobile = false;
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

// One field's markup: from the tag with its id to the next field's
function field(html: string, id: string): string {
  const at = html.indexOf(`id="query-field-${id}"`);
  const from = html.lastIndexOf('<', at);
  const next = html.indexOf('id="query-field-', at + 1);
  return html.slice(from, next < 0 ? undefined : html.lastIndexOf('<', next));
}
const levels = (options: Form) => field(render(options), 'z');
const member = (options: Form) => field(render({ ...options, custom: [MEMBER] }), 'dim:member');
// Only what shows, read tag by tag, without the zero-width space an outlined field's empty legend holds
const shown = (html: string) => words(html).replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
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
    expect(shown(html)).toContain('Member member 5 listed · optional');
    expect(html).toContain('href="https://example.org/eps.pdf"');
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

// The whole form for a query on a collection as served
const FMI = fmiEcmwf as unknown as Collection;
const METEOCORE = meteocoreObs as unknown as Collection;
function form(collection: Collection, queryKey: string, overrides: Partial<Record<string, unknown>> = {}): string {
  const nothing = () => {};
  const state = {
    selectedDataQuery: queryKey, selectDataQuery: nothing, selectedInstance: null, instanceQueryKey: '',
    selectedFormat: '', setSelectedFormat: nothing, getEffectiveOutputFormats: (c: Collection, key: string) => {
      const formats = c.data_queries[key]?.link.variables?.output_formats;
      return Array.isArray(formats) ? formats : [];
    },
    selectedParameters: [], setSelectedParameters: nothing, datetime: '',
    vertical: '', setVertical: nothing, verticalMode: 'individual', setVerticalMode: nothing,
    dimensions: {}, setDimension: nothing, dimensionModes: {}, setDimensionMode: nothing,
    queryParams: {}, setQueryParam: nothing, bboxAsCoords: false, setBboxAsCoords: nothing, filterByTime: false, setFilterByTime: nothing,
    ...overrides,
  } as unknown as UseQueryUrlReturn;
  return renderToStaticMarkup(<CollectionQueryBuilder collection={collection} queryState={state} />);
}
// The blocks' headers, in order: what each starts with
const blockIds = (html: string) => html.split('id="query-field-').slice(1).map(rest => rest.slice(0, rest.indexOf('"')));

describe('the form’s blocks', () => {
  it('has a block per parameter, titled in words with the name as sent, in the design’s order', () => {
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';
    const html = form(FMI, 'position');
    expect(blockIds(html)).toEqual(['query', 'coords', 'parameter-name', 'datetime', 'dim:timestep', 'f']);
    const text = shown(html);
    const order = ['Query query (path)', 'Position coords required', 'Parameters parameter-name 6 listed · optional', 'Time datetime optional', 'Timestep timestep', 'Output format f optional'];
    const at = order.map(part => text.indexOf(part));
    expect(at.every(index => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain('/collections/ecmwf/position');
  });

  it('puts a radius and its unit in one block, the number then the unit toggles, the unit jumped to by its own id', () => {
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/radius';
    around.radius = 25;
    around.radiusUnits = 'km';
    const html = form(METEOCORE, 'radius');
    expect(blockIds(html)).toEqual(['query', 'coords', 'within', 'within-units', 'parameter-name', 'datetime', 'f']);
    const within = field(html, 'within');
    expect(shown(within)).toBe('Radius within · within-units required');
    expect(html).toContain('id="query-input-within"');
    expect(html).toContain('value="25"');
    const unit = field(html, 'within-units');
    expect(shown(unit).startsWith('km m mi')).toBe(true);
    expect(unit.split('aria-pressed="true"').length - 1).toBe(1);
    expect(shown(unit)).toContain("The map draws the circle once both are set Units from the query's within_units");
  });

  it('says under the pair what each of the two is missing, once, and turns the requirement orange', () => {
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/radius?coords=POINT(24.94%2060.17)';
    issues.list = [
      { id: 'edr:within:required', severity: 'missing', source: 'edr', field: 'within', message: 'Set the radius', input: 'form' },
      { id: 'edr:within-units:required', severity: 'missing', source: 'edr', field: 'within-units', message: 'Pick the unit of the radius', input: 'form' },
    ];
    const html = form(METEOCORE, 'radius');
    expect(shown(html).split('Set the radius').length - 1).toBe(1);
    expect(shown(html).split('Pick the unit of the radius').length - 1).toBe(1);
    expect(shown(field(html, 'within-units'))).toContain('Set the radius Pick the unit of the radius');
    // The status line names them, and says nothing of them under it: they're in their field
    expect(shown(html)).toContain('Missing: within , within-units');
    const header = field(html, 'within');
    expect(header.slice(header.lastIndexOf('<style', header.indexOf('>required<')), header.indexOf('>required<'))).toContain('#ed6c02');
  });

  it('types a unit the query lists none of', () => {
    const corridor = { ...FMI, data_queries: { corridor: { link: { href: 'h', variables: { query_type: 'corridor' } } } } } as unknown as Collection;
    const html = form(corridor, 'corridor');
    expect(html).toContain('id="query-input-width-units"');
    expect(html).toContain('placeholder="Unit, as km"');
    expect(shown(field(html, 'corridor-width'))).toBe('Corridor width corridor-width · width-units required');
  });

  it('marks the format the query names as its default, without pressing it, and says the server decides', () => {
    const f = field(form(FMI, 'position'), 'f');
    expect(shown(f)).toBe("Output format f optional CoverageJSON default GeoJSON Marked default: the query's default_output_format Left out: the server's default");
    expect(f.split('aria-pressed="true"').length - 1).toBe(0);
    const chosen = field(form(FMI, 'position', { selectedFormat: 'GeoJSON' }), 'f');
    expect(chosen.split('aria-pressed="true"').length - 1).toBe(1);
    expect(shown(chosen)).not.toContain('Left out');
  });

  it('shows coords as sent, with a Map button on a phone, where the map is a pane away', () => {
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position?coords=POINT(24.94%2060.17)';
    const desktop = field(form(FMI, 'position'), 'coords');
    expect(shown(desktop)).toBe('Position coords required POINT(24.94 60.17) Each click on the map adds a point');
    around.mobile = true;
    expect(shown(field(form(FMI, 'position'), 'coords'))).toContain('POINT(24.94 60.17) Map');
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';
    expect(shown(field(form(FMI, 'position'), 'coords'))).toContain('Draw on the map Map');
  });

  it('offers what the collection has while no query is picked, and no fields', () => {
    const html = form(FMI, '');
    expect(blockIds(html)).toEqual(['query']);
    expect(shown(html)).toContain('Choose a query. Its parameters come from what the collection says it has: 6 parameters in parameter_names');
  });

  it('gives a locations query its location, searched by typing', () => {
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/locations';
    const html = form(FMI, 'locations');
    expect(blockIds(html)).toEqual(['query', 'location', 'datetime']);
    expect(shown(field(html, 'location'))).toContain('Location location (path) 0 listed · optional');
    expect(html).toContain('placeholder="None: list them all, or type to search"');
  });
});
