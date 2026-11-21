import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionQueryBuilder from './CollectionQueryBuilder';
import type { Collection } from './DataRetrievalAPI';
import { withClass, words } from './coverage/cellsTestData';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { QueryIssue } from './query/types';
import { withItemsQuery } from './query/itemsQuery';
import fmiEcmwf from './query/__fixtures__/fmi-ecmwf.json';
import meteocoreObs from './query/__fixtures__/meteocore-fmi-obs.json';
import mapsParams from './query/__fixtures__/meteocore-maps-params.json';
import mapsDims from './query/__fixtures__/meteocore-maps-dimensions.json';
import mapsBox from './query/__fixtures__/meteocore-maps-box.json';
import mapsMore from './query/__fixtures__/meteocore-maps-more.json';
import { MAPS1 } from './standards';
import { mapStylesOf, withLinkQueries } from './query/mapQuery';
import { apiDocsParams } from './query/declared';
import { buildOperationIndex, matchOperation } from './validation/openapi/operationIndex';

// The form: its fields as blocks, each a title and the name as sent, and the level and custom dimension fields for
// each form their text can take. What they need from around them is stood in for
const issues = vi.hoisted(() => ({ list: [] as QueryIssue[], apiOperation: null as unknown }));
// The request line, and what the form built: the same unless a test types something the form can't hold
const around = vi.hoisted(() => ({
  requestUrl: 'https://a.example/edr/collections/ifs/position', collectionUrl: null as string | null, radius: null as number | null, radiusUnits: '', mobile: false,
  conformsTo: undefined as string[] | undefined, viewExtent: null as number[] | null, viewSize: null as number[] | null, docsIndex: null as unknown,
}));
vi.mock('./contexts/CollectionContext', () => ({ useCollection: () => ({ selectedFeature: null, collectionUrl: around.collectionUrl ?? around.requestUrl, locationFeatures: [] }) }));
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ showMap: () => {}, isMobile: around.mobile }) }));
vi.mock('./contexts/OpenCollectionContext', () => ({ useOpenCollection: () => ({ leaveQuery: () => {} }) }));
vi.mock('./contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('./contexts/OpenRequestContext', () => ({ useOpenRequest: () => ({ openRequest: () => {} }) }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => ({ apiUrl: 'https://a.example/edr/', conformsTo: around.conformsTo }) }));
vi.mock('./contexts/OpenApiContext', () => ({ useOpenApi: () => ({ status: 'none', description: null, index: around.docsIndex }) }));
vi.mock('./contexts/MapInteractionContext', () => ({
  useMapInteraction: () => ({
    radius: around.radius, setRadius: () => {}, radiusUnits: around.radiusUnits, setRadiusUnits: () => {},
    selectedBbox: null, setSelectedBbox: () => {}, viewExtent: around.viewExtent, viewSize: around.viewSize, boxDrawer: null, drawBox: () => {},
  }),
}));
vi.mock('./hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ issues: issues.list, active: true, apiOperation: issues.apiOperation }) }));
vi.mock('./TimeControl', () => ({ default: () => null }));
vi.mock('./InstancePicker', () => ({ default: () => null }));

beforeEach(() => {
  issues.list = [];
  issues.apiOperation = null;
  around.conformsTo = undefined;
  around.requestUrl = 'https://a.example/edr/collections/ifs/position';
  around.collectionUrl = null;
  around.radius = null;
  around.radiusUnits = '';
  around.mobile = false;
  around.viewExtent = null;
  around.viewSize = null;
  around.docsIndex = null;
});

const LEVELS = ['1000', '925', '850', '700', '500'];
const LISTED = { values: LEVELS, interval: [['1000', '500']] };
// KNMI's ensemble member, as uwcw-ha-ens-nl-2km.hagl_member lists it (2026-11-08), five of its thirty
const MEMBER = { id: 'member', values: ['1', '2', '3', '4', '5'], interval: [['1', '5']], reference: 'https://example.org/eps.pdf' };
const BASE = 'https://a.example/edr/collections/ifs/position';

interface Form {
  z?: string;
  vertical?: Record<string, unknown>;
  member?: string;
  custom?: Record<string, unknown>[];
}

// The form with z and member as the request line has them: the typed field reads the line, the picker the form's text
function render({ z = '', vertical = LISTED, member, custom = [] }: Form): string {
  const nothing = () => {};
  const line = [z && `z=${z}`, member && `member=${member}`].filter(Boolean).join('&');
  around.requestUrl = `${BASE}${line ? `?${line}` : ''}`;
  const state = {
    selectedDataQuery: 'position', selectDataQuery: nothing, selectedInstance: null, instanceQueryKey: '',
    selectedFormat: '', setSelectedFormat: nothing, getEffectiveOutputFormats: () => [],
    selectedParameters: [], setSelectedParameters: nothing,
    vertical: z, setVertical: nothing,
    dimensions: member === undefined ? {} : { member }, setDimension: nothing,
    queryParams: {}, setQueryParam: nothing, bboxAsCoords: false, setBboxAsCoords: nothing, filterByTime: false, setFilterByTime: nothing,
    accept: '', setAccept: nothing,
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
// The typed field's value, from its input: the one with the parameter's name as its label
const typedValue = (html: string, name: string) => {
  const at = html.indexOf(`aria-label="${name}"`);
  const tag = html.slice(html.lastIndexOf('<input', at), html.indexOf('>', at));
  const value = tag.split('value="')[1];
  return value === undefined ? null : value.slice(0, value.indexOf('"'));
};
const LISTBOX = 'aria-haspopup="listbox"';
// As words reads it: a space either side of each code span
const LEVEL_GRAMMAR = 'One level, a list 1000,850 , an interval 1000/500 , or R5/100/50 for 5 levels 50 apart from 100';

describe('the level field', () => {
  it('is the levels as sent, typed, with the listed ones to pick from, and how to type them while empty', () => {
    const html = levels({});
    expect(typedValue(html, 'z')).toBe('');
    expect(html).toContain('id="query-input-z"');
    expect(html).toContain('placeholder="Pick levels below, or type them"');
    expect(html).toContain(LISTBOX);
    expect(shown(html)).toContain('Pick from the 5 levels listed');
    expect(shown(html)).toContain(LEVEL_GRAMMAR);
    expect(shown(html)).toContain('Left out: the server decides which levels');
  });

  it('shows a list, as from a link, as typed, and ticks the levels it names', () => {
    const html = levels({ z: '1000,925,850' });
    expect(typedValue(html, 'z')).toBe('1000,925,850');
    expect(shown(html)).toContain('3 picked');
    expect(shown(html)).not.toContain(LEVEL_GRAMMAR);
    expect(shown(html)).not.toContain('Left out');
  });

  it('ticks a level written otherwise as the collection writes it, and one it doesn’t list as it was', () => {
    const html = levels({ z: '1000.0,777' });
    expect(typedValue(html, 'z')).toBe('1000.0,777');
    expect(html).toContain('value="1000,777"');
    expect(shown(html)).toContain('2 picked');
  });

  it('leaves an interval or a repeat to the text, with nothing ticked', () => {
    for (const z of ['1000/500', 'R3/500/100', '850/']) {
      const html = levels({ z });
      expect(typedValue(html, 'z')).toBe(z);
      expect(shown(html)).toContain('Pick from the 5 levels listed');
      expect(shown(html)).not.toContain('picked');
    }
  });

  it('is typed only where the collection lists no levels, only an interval', () => {
    const html = levels({ z: '1000,850', vertical: { interval: [['1000', '500']] } });
    expect(html).not.toContain(LISTBOX);
    expect(typedValue(html, 'z')).toBe('1000,850');
    expect(levels({ vertical: { interval: [['1000', '500']] } })).toContain('placeholder="Type a level, or several"');
  });

  it('says when there are too many levels to pick from, and takes them typed', () => {
    const many = Array.from({ length: 300 }, (_, i) => String(i));
    const html = levels({ z: '5', vertical: { values: many } });
    expect(shown(html)).toContain('300 levels listed, too many to pick from: type them');
    expect(html).not.toContain(LISTBOX);
    expect(typedValue(html, 'z')).toBe('5');
  });

  it('says what’s wrong under it, outlines it red, and how to type it', () => {
    issues.list = [{ id: 'metadata:z:offered', severity: 'error', source: 'metadata', field: 'z', message: "Level 777 isn't one of the collection's levels", input: 'form' }];
    const html = levels({ z: '1000,777' });
    expect(shown(html)).toContain("Level 777 isn't one of the collection's levels");
    expect(shown(html)).toContain(LEVEL_GRAMMAR);
    expect(withClass(html, 'Mui-error')).toBeGreaterThan(0);
    issues.list = [];
    expect(withClass(levels({ z: '1000' }), 'Mui-error')).toBe(0);
  });

  it('says what the server does while the line has no level, or only a blank one', () => {
    expect(shown(levels({ z: '%20' }))).toContain('Left out: the server decides which levels');
    expect(shown(levels({ z: '1000' }))).not.toContain('Left out');
  });

  it('says what’s still to pick of a range typed with one end, which the form holds back, and not that it can’t read it', () => {
    issues.list = [{ id: 'metadata:z:range', severity: 'missing', source: 'metadata', field: 'z', message: 'Pick the upper end of the level range', input: 'form' }];
    around.collectionUrl = BASE;
    const html = levels({ z: '850/' });
    expect(shown(html)).toContain('Pick the upper end of the level range');
    expect(shown(html)).not.toContain("can't read");
    issues.list = [];
    expect(shown(levels({ z: '850/' }))).toContain("The form can't read this. It's sent as typed");
  });

  it('outlines a warning orange', () => {
    issues.list = [{ id: 'metadata:z:extent', severity: 'warning', source: 'metadata', field: 'z', message: 'Outside', input: 'form' }];
    const outline = 'MuiOutlinedInput-notchedOutline{border-color:#ed6c02';
    expect(count(levels({ z: '1000' }), outline)).toBeGreaterThan(0);
    issues.list = [];
    expect(count(levels({ z: '1000' }), outline)).toBe(0);
  });
});

describe('a custom dimension’s field', () => {
  it('is the values as sent, typed, with the listed ones to pick from, as the level field', () => {
    const html = member({ member: '1,2,3' });
    expect(shown(html)).toContain('Member member 5 listed · optional');
    expect(html).toContain('href="https://example.org/eps.pdf"');
    expect(typedValue(html, 'member')).toBe('1,2,3');
    expect(html).toContain('id="query-input-member"');
    expect(shown(html)).toContain('3 picked');
    expect(html).toContain(LISTBOX);
  });

  it('shows a value it doesn’t list, as from a link', () => {
    const html = member({ member: '1,31' });
    expect(typedValue(html, 'member')).toBe('1,31');
    expect(shown(html)).toContain('2 picked');
  });

  it('leaves a range to the text', () => {
    const html = member({ member: '1/5' });
    expect(typedValue(html, 'member')).toBe('1/5');
    expect(shown(html)).toContain('Pick from the 5 values listed');
  });

  it('starts empty, saying how to type it', () => {
    const html = member({});
    expect(typedValue(html, 'member')).toBe('');
    expect(html).toContain('placeholder="Pick values below, or type them"');
    expect(shown(html)).toContain('One value, a list 1,2,3 , or an interval 1/5');
    expect(count(shown(html), 'Left out: the server decides')).toBe(1);
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
    vertical: '', setVertical: nothing,
    dimensions: {}, setDimension: nothing,
    queryParams: {}, setQueryParam: nothing, bboxAsCoords: false, setBboxAsCoords: nothing, filterByTime: false, setFilterByTime: nothing,
    accept: '', setAccept: nothing,
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
    expect(blockIds(html)).toEqual(['query', 'coords', 'parameter-name', 'datetime', 'dim:timestep', 'f', 'more']);
    const text = shown(html);
    const order = ['Query query (path)', 'Position coords required', 'Parameters parameter-name 6 listed · optional', 'Time datetime optional', 'Timestep timestep', 'Output format f optional'];
    const at = order.map(part => text.indexOf(part));
    expect(at.every(index => index >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain('/collections/ecmwf/position');
  });

  it('puts a radius and its unit in one block, the number then the unit toggles, the unit jumped to by its own id', () => {
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/radius?within=25';
    around.radius = 25;
    around.radiusUnits = 'km';
    const html = form(METEOCORE, 'radius');
    expect(blockIds(html)).toEqual(['query', 'coords', 'within', 'within-units', 'parameter-name', 'datetime', 'f', 'more']);
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
    expect(typedValue(desktop, 'coords')).toBe('POINT(24.94 60.17)');
    expect(shown(desktop)).toBe('Position coords required Each click on the map adds a point');
    around.mobile = true;
    const phone = field(form(FMI, 'position'), 'coords');
    expect(typedValue(phone, 'coords')).toBe('POINT(24.94 60.17)');
    expect(shown(phone)).toBe('Position coords required Map Each click on the map adds a point');
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';
    const empty = field(form(FMI, 'position'), 'coords');
    expect(empty).toContain('placeholder="Draw on the map, or type WKT"');
    expect(shown(empty)).toContain('Typed: POINT(lon lat) , or MULTIPOINT((lon lat),(lon lat))');
  });

  it('says where a time and levels would be when the collection has neither, and gives one the request has its field', () => {
    const bare = {
      id: 'bare', extent: { spatial: { bbox: [[0, 0, 1, 1]] } }, parameter_names: [{ id: 't' }],
      data_queries: { position: { link: { href: 'https://a.example/collections/bare/position', variables: { query_type: 'position' } } } },
    } as unknown as Collection;
    around.requestUrl = 'https://a.example/collections/bare/position?coords=POINT(0.5 0.5)';
    const html = form(bare, 'position');
    expect(blockIds(html)).toEqual(['query', 'coords', 'parameter-name', 'more']);
    expect(shown(html)).toContain("No datetime or z : the collection's extent has no time or levels. To send one anyway, add it under More.");
    expect(count(shown(html), 'No datetime or z')).toBe(1);
    around.requestUrl = 'https://a.example/collections/bare/position?coords=POINT(0.5 0.5)&datetime=2026-11-10T00:00:00Z';
    const asked = form(bare, 'position');
    expect(blockIds(asked)).toEqual(['query', 'coords', 'parameter-name', 'datetime', 'more']);
    expect(shown(field(asked, 'datetime'))).toContain("The collection's extent has no time");
    expect(typedValue(field(asked, 'datetime'), 'datetime')).toBe('2026-11-10T00:00:00Z');
    expect(shown(asked)).not.toContain('No datetime or z');
  });

  it('offers what the collection has while no query is picked, and no fields', () => {
    const html = form(FMI, '');
    expect(blockIds(html)).toEqual(['query']);
    expect(shown(html)).toContain('Choose a query. Its parameters come from what the collection says it has: 6 parameters in parameter_names');
  });

  it('gives an items query its item, by its path, and asks one item only its format', () => {
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items';
    const list = form(METEOCORE, 'items', { itemId: '', setItemId: () => {} });
    expect(blockIds(list)).toEqual(['query', 'item', 'bbox', 'limit', 'datetime', 'f', 'more']);
    expect(shown(field(list, 'item'))).toBe("Item item (path) optional An item's id , as in the list's features Left out: the request lists the items");
    expect(list).toContain('id="query-input-item"');
    expect(list).toContain('placeholder="An item&#x27;s id, or none for the list"');
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items/0-148-0-CHD64901';
    const one = form(METEOCORE, 'items', { itemId: '0-148-0-CHD64901', setItemId: () => {} });
    expect(blockIds(one)).toEqual(['query', 'item', 'f', 'more']);
    expect(typedValue(one, 'item')).toBe('0-148-0-CHD64901');
    expect(shown(field(one, 'item'))).not.toContain('Left out');
    // No other query has one
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';
    expect(blockIds(form(FMI, 'position', { itemId: 'x' }))).not.toContain('item');
  });

  // The GDC's wis2-discovery-metadata: a Records collection, with no time in its extent
  const GDC = {
    id: 'wis2-discovery-metadata', itemType: 'record', extent: { spatial: { bbox: [[-180, -90, 180, 90]] } },
    links: [{ href: 'https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items?f=json', rel: 'items', type: 'application/geo+json' }],
  } as unknown as Collection;

  it('calls a Records collection’s items records, and has the time Records servers SHALL take, typed', () => {
    around.requestUrl = 'https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items';
    const html = form(withItemsQuery(GDC), 'items', { itemId: '', setItemId: () => {} });
    expect(blockIds(html)).toEqual(['query', 'item', 'bbox', 'limit', 'datetime', 'f', 'more']);
    expect(shown(field(html, 'item'))).toBe("Record record (path) optional A record's id , as in the list's records Left out: the request lists the records");
    expect(html).toContain('placeholder="A record&#x27;s id, or none for the list"');
    expect(shown(field(html, 'bbox'))).toContain('Left out: records anywhere');
    const time = field(html, 'datetime');
    expect(time).toContain('placeholder="Type a time, or an interval"');
    expect(shown(time)).toContain("Records servers SHALL support datetime on items. The collection's extent gives no time, so there's none to pick: type one Records 1 /req/record-core-query-parameters/datetime A");
    expect(time).toContain('href="https://docs.ogc.org/is/20-004r1/20-004r1.html#_6b8fcab1-1090-e860-2ade-4cd7856bcfd4"');
    // Nothing to pick from, so no box to tick for it
    expect(shown(time)).not.toContain('Pick a time to filter');
  });

  it('says, while the box is empty, that a map’s box a switch couldn’t take across was left behind', () => {
    const note = "The map's bbox wasn't kept: it's in EPSG:3067, which the form can't turn into CRS84, the box items takes";
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items';
    expect(shown(field(form(METEOCORE, 'items', { itemId: '', setItemId: () => {}, leftBehind: note }), 'bbox'))).toContain(note);
    expect(shown(field(form(METEOCORE, 'items', { itemId: '', setItemId: () => {}, leftBehind: '' }), 'bbox'))).not.toContain("wasn't kept");
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items?bbox=19,59,32,70';
    expect(shown(field(form(METEOCORE, 'items', { itemId: '', setItemId: () => {}, leftBehind: note }), 'bbox'))).not.toContain("wasn't kept");
  });

  it('asks to filter records by a time where a Records collection has times', () => {
    const timed = withItemsQuery({ ...GDC, extent: { temporal: { interval: [['2025-01-01T00:00:00Z', null]] } } } as unknown as Collection);
    around.requestUrl = 'https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items';
    const time = field(form(timed, 'items', { itemId: '', setItemId: () => {} }), 'datetime');
    expect(shown(time)).toContain('Pick a time to filter records by');
    expect(time).toContain('placeholder="Pick a time below, or type one"');
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/fmi-obs/items';
    expect(shown(field(form(METEOCORE, 'items', { itemId: '', setItemId: () => {} }), 'datetime'))).toContain('Pick a time to filter items by');
  });

  it('gives a locations query its location, searched by typing', () => {
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/locations';
    const html = form(FMI, 'locations');
    expect(blockIds(html)).toEqual(['query', 'location', 'datetime', 'more']);
    expect(shown(field(html, 'location'))).toContain('Location location (path) 0 listed · optional');
    expect(html).toContain('placeholder="None: list them all, or type to search"');
  });
});

// A map on MeteoCore: its style, its parameter as rows, its format, each tagged by who declared it
describe('a map’s form', () => {
  const ROOT = 'https://meteocore.app.meteo.fi';
  const collectionOf = (id: string) => withLinkQueries(structuredClone(mapsParams.collections.find(each => each.id === id)) as unknown as Collection);
  const index = buildOperationIndex({ url: `${ROOT}/api`, doc: mapsParams.api as unknown as Record<string, unknown> });
  const operationFor = (path: string) => {
    const entry = matchOperation(index, `${ROOT}${path}`)!.entry;
    return { template: entry.template, pointer: entry.pointer, required: [], params: apiDocsParams(entry.params) };
  };
  const mapState = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
    styleId: '', styleByLink: false, selectStyle: () => {},
    mapStyles: { status: 'ready', styles: mapStylesOf(mapsParams.styles[id as 'ecmwf-aifs-single']?.styles ?? []), source: 'link' },
    ...overrides,
  });
  const tagsOf = (html: string) => html.split('class="MuiChip-label').slice(1).map(rest => rest.slice(rest.indexOf('>') + 1, rest.indexOf('<')));

  it('is the style, the parameter as rows and the format from the API docs, each tagged, and More', () => {
    around.requestUrl = `${ROOT}/collections/ecmwf-aifs-single/map?parameter-name=2t`;
    around.conformsTo = mapsParams.conformsTo;
    issues.apiOperation = operationFor('/collections/ecmwf-aifs-single/map');
    const html = form(collectionOf('ecmwf-aifs-single'), 'map', { ...mapState('ecmwf-aifs-single'), selectedParameters: ['2t'] });
    // Its box, size and CRS first, and its time, level and subset between: see 'a map’s box, size and CRS' and 'a map’s time,
    // levels, run and subset'
    expect(blockIds(html)).toEqual(['query', 'style', 'bbox', 'bbox-crs', 'width', 'height', 'crs', 'parameter-name', 'datetime', 'elevation', 'subset', 'f', 'more']);
    expect(tagsOf(field(html, 'style'))).toEqual(['styled-map']);
    expect(tagsOf(field(html, 'parameter-name'))).toEqual(['MetOcean Maps (draft)', 'API docs']);
    expect(tagsOf(field(html, 'f'))).toEqual(['API docs']);
    const parameter = field(html, 'parameter-name');
    expect(count(parameter, 'role="radio"')).toBe(18);
    expect(count(parameter, 'aria-checked="true"')).toBe(1);
    expect(shown(parameter)).toContain('Parameter parameter-name 1 of 18 · optional');
    expect(shown(parameter)).not.toContain('Left out');
    // Every style is for 2t: all offered, in the order listed
    expect(shown(field(html, 'style'))).toContain('Style style (path) 3 listed · optional styled-map default contours fmi-hires');
    const format = field(html, 'f');
    expect(shown(format)).toContain('image/png default image/jpeg image/webp');
    expect(shown(format)).toContain("Left out: by Accept , which the app sends as */* : the server's default, image/png by the API docs");
    // A map has no time or levels said for it here
    expect(shown(html)).not.toContain('No datetime or z');
  });

  it('types the API docs’ parameter-name where the collection has no parameter_names, and leaves out what nobody declares', () => {
    around.requestUrl = `${ROOT}/collections/fmi-radar-composite-dbz/map`;
    issues.apiOperation = operationFor('/collections/fmi-radar-composite-dbz/map');
    const html = form(collectionOf('fmi-radar-composite-dbz'), 'map', mapState('fmi-radar-composite-dbz', { mapStyles: { status: 'ready', styles: [], source: null } }));
    expect(blockIds(html)).toEqual(['query', 'bbox', 'bbox-crs', 'width', 'height', 'crs', 'parameter-name', 'datetime', 'elevation', 'subset', 'f', 'more']);
    expect(html).toContain('placeholder="Type a parameter"');
    expect(typedValue(html, 'parameter-name')).toBe('');
    // Without the API's conformance, no class is named
    expect(tagsOf(field(html, 'parameter-name'))).toEqual(['API docs']);
    issues.apiOperation = null;
    expect(blockIds(form(collectionOf('fmi-radar-composite-dbz'), 'map', mapState('fmi-radar-composite-dbz', { mapStyles: { status: 'ready', styles: [], source: null } }))))
      .toEqual(['query', 'more']);
  });

  it('types an f the request has where the API docs list no values, and shows a style’s issue in its field', () => {
    around.requestUrl = `${ROOT}/collections/ecmwf-aifs-single/styles/fmi-hires/map?parameter-name=tp&f=image/gif`;
    issues.list = [{ id: 'metadata:style:unlisted-tp', severity: 'warning', source: 'metadata', field: 'style', message: "fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx" }];
    const html = form(collectionOf('ecmwf-aifs-single'), 'map', { ...mapState('ecmwf-aifs-single', { styleId: 'fmi-hires', styleByLink: true }), selectedParameters: ['tp'], selectedFormat: 'image/gif' });
    expect(blockIds(html)).toEqual(['query', 'style', 'parameter-name', 'f', 'more']);
    expect(typedValue(html, 'f')).toBe('image/gif');
    expect(shown(field(html, 'style'))).toContain("fmi-hires isn't listed for tp (its parameters: 2t, 2d): expect a 4xx");
    expect(shown(field(html, 'style'))).toContain('The request has parameter-name=tp instead, as chosen');
  });
});

// A model's map on MeteoCore: its time, its level as subset=vertical(…) and as the API docs' elevation, its model run
// and its subset, each a field of its own and tagged by who declared it
describe('a map’s time, levels, run and subset', () => {
  const ROOT = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map';
  const ifs = () => withLinkQueries(structuredClone(mapsDims.collections.find(each => each.id === 'ecmwf-ifs-pressure')) as unknown as Collection);
  const docs = apiDocsParams(mapsDims.apiParams.map(param => ({ ...param, enumValues: null, isArray: param.schema.type === 'array' })) as unknown as Parameters<typeof apiDocsParams>[0]);
  const state = { styleId: '', styleByLink: false, selectStyle: () => {}, mapStyles: { status: 'ready', styles: [], source: null } };

  it('names each by what’s sent, and says what the server does while each is left out', () => {
    around.requestUrl = ROOT;
    around.conformsTo = mapsDims.conformsTo;
    issues.apiOperation = { template: '/collections/ecmwf-ifs-pressure/map', pointer: '/paths/x', required: [], params: docs };
    const html = form(ifs(), 'map', state);
    expect(blockIds(html)).toEqual(['query', 'bbox', 'bbox-crs', 'width', 'height', 'crs', 'datetime', 'subset:vertical', 'elevation', 'subset:reference_time', 'subset', 'more']);
    expect(shown(field(html, 'subset:vertical'))).toContain('Level subset=vertical(…) hPa · optional MetOcean Maps (draft) 1000 925 850');
    expect(shown(field(html, 'subset:reference_time'))).toContain('Model run subset=reference_time(…) 2 listed · optional MetOcean Maps (draft) API docs Latest 2026-11-12T00:00:00Z 2026-11-11T18:00:00Z');
    expect(shown(field(html, 'elevation'))).toContain('Level elevation hPa · optional API docs');
    expect(typedValue(html, 'subset')).toBe('');
    expect(html).toContain('placeholder="axis(low:high), axis(value)"');
    for (const id of ['subset:vertical', 'elevation', 'subset:reference_time', 'subset']) expect(shown(field(html, id)), id).toContain('Left out:');
    // How to type subset, while it's empty
    expect(shown(field(html, 'subset'))).toContain('Typed: axis(low:high) or axis(value) , comma-separated');
  });

  it('shows what the request has in each, and its issue in its field', () => {
    around.requestUrl = `${ROOT}?subset=vertical(777),reference_time(*)&elevation=850`;
    around.conformsTo = mapsDims.conformsTo;
    issues.apiOperation = { template: '/collections/ecmwf-ifs-pressure/map', pointer: '/paths/x', required: [], params: docs };
    issues.list = [{ id: 'metadata:subset:vertical:offered', severity: 'warning', source: 'metadata', field: 'subset:vertical', message: "Level 777 isn't one of the collection's levels" }];
    const html = form(ifs(), 'map', state);
    expect(typedValue(html, 'subset')).toBe('vertical(777),reference_time(*)');
    expect(typedValue(html, 'elevation')).toBe('850');
    for (const id of ['subset:vertical', 'elevation', 'subset:reference_time', 'subset']) expect(shown(field(html, id)), id).not.toContain('Left out:');
    expect(shown(field(html, 'subset:vertical'))).toContain("Level 777 isn't one of the collection's levels");
    expect(count(field(html, 'subset:reference_time'), 'aria-pressed="true"')).toBe(1);
  });
});

// A radar's map on MeteoCore: its box, size and CRS, each a block holding both its names, typed as sent, with what the
// map writes into them
describe('a map’s box, size and CRS', () => {
  const ROOT = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
  const radar = () => withLinkQueries(structuredClone(mapsBox.collections[0]) as unknown as Collection);
  const index = buildOperationIndex({ url: 'https://meteocore.app.meteo.fi/api', doc: { paths: { [mapsBox.mapPath]: { get: { parameters: mapsBox.parameters } } } } });
  const operation = { template: mapsBox.mapPath, pointer: '/paths/x', required: [], params: apiDocsParams(index.entries[0].params) };
  const state = { styleId: '', styleByLink: false, selectStyle: () => {}, mapStyles: { status: 'ready', styles: [], source: null } };
  // A block from its id to the next block's head, its second name's id inside it
  const block = (html: string, id: string, next: string) => html.slice(html.lastIndexOf('<', html.indexOf(`id="query-field-${id}"`)), html.lastIndexOf('<', html.indexOf(`id="query-field-${next}"`)));
  const URI = 'http://www.opengis.net/def/crs/EPSG/0/3857';

  beforeEach(() => {
    around.conformsTo = mapsBox.conformsTo;
    issues.apiOperation = operation;
    around.viewExtent = [-310358.74, 7222220.35, 5854403.34, 12391910.26];
    around.viewSize = [954, 800];
  });

  it('names each by what’s sent, tags who declares it, and says, citing it, what the server does while it’s left out', () => {
    around.requestUrl = ROOT;
    const html = form(radar(), 'map', state);
    expect(blockIds(html).slice(0, 6)).toEqual(['query', 'bbox', 'bbox-crs', 'width', 'height', 'crs']);
    const box = shown(block(html, 'bbox', 'width'));
    expect(box.startsWith('Box bbox · bbox-crs optional spatial-subsetting API docs')).toBe(true);
    expect(box).toContain(`Left out: the whole map: the collection's extent ${MAPS1.wholeMap.label}`);
    expect(box).toContain('Typed: west,south,east,north in CRS84');
    expect(block(html, 'bbox', 'width')).toContain('placeholder="west,south,east,north"');
    expect(block(html, 'bbox', 'width')).toContain('placeholder="CRS84"');
    const size = shown(block(html, 'width', 'crs'));
    expect(size.startsWith('Size width × height pixels · optional scaling spatial-subsetting API docs')).toBe(true);
    expect(size).toContain("Use the map's size, 954 × 800");
    expect(size).toContain('Left out: the server picks one. The API docs: Omitted over an area');
    expect(block(html, 'width', 'crs')).toContain(`href="${MAPS1.widthDefinitionH.url}"`);
    const crs = shown(block(html, 'crs', 'datetime'));
    expect(crs.startsWith('Coordinate system crs 5 listed · optional crs API docs')).toBe(true);
    expect(crs).toContain('CRS84 EPSG:4326 EPSG:3857 EPSG:3067 EPSG:3035');
    expect(crs).toContain(`Left out: the storage CRS, storageCrs EPSG:3067 ${MAPS1.mapResponseB.label}`);
    // Not under More, which has the background, the centre, the scale and the subset's CRS, closed with none of them asked
    expect(shown(field(html, 'more'))).toBe('More: transparent, bgcolor, void-transparent, void-color, center, center-crs, scale-denominator, subset-crs, Accept, other parameters');
    expect(field(html, 'more')).toContain('aria-expanded="false"');
    // The service's x-OGC-limits.maps, where its API docs' info has them
    expect(size).not.toContain('x-OGC-limits');
    around.docsIndex = { mapLimits: { maxWidth: 2048, maxHeight: null, maxPixels: null, pointer: '/info/x-OGC-limits/maps' } };
    expect(shown(block(form(radar(), 'map', state), 'width', 'crs'))).toContain('x-OGC-limits.maps allows up to 2048 wide');
  });

  it('holds what the request has, typed, and shows each one’s issue in its block, a spatial subset’s clash in the box’s too', () => {
    around.requestUrl = `${ROOT}?bbox=19,59,32&bbox-crs=EPSG:3035&width=0&height=9000&crs=${URI}&subset=Lon(19:32)`;
    issues.list = [
      { id: 'maps:subset:with-bbox', severity: 'error', source: 'maps', field: 'subset', message: 'Lon in subset with bbox: Maps 1.0 asks a 4xx for a spatial axis with either' },
      { id: 'maps:bbox:numbers', severity: 'error', source: 'maps', field: 'bbox', message: 'bbox has 3 numbers' },
      { id: 'maps:bbox-crs:valid', severity: 'warning', source: 'maps', field: 'bbox-crs', message: "EPSG:3035 isn't one of bbox-crs's valid values" },
      { id: 'maps:width:integer', severity: 'error', source: 'maps', field: 'width', message: "width 0 isn't a positive integer" },
      { id: 'openapi:height:maximum', severity: 'error', source: 'openapi', field: 'height', message: "height 9000 is past the API docs' maximum, 8000" },
      { id: 'maps:crs:listed', severity: 'warning', source: 'maps', field: 'crs', message: 'not listed' },
    ];
    const html = form(radar(), 'map', state);
    expect(['bbox', 'bbox-crs', 'width', 'height', 'crs'].map(name => typedValue(html, name))).toEqual(['19,59,32', 'EPSG:3035', '0', '9000', URI]);
    const box = shown(block(html, 'bbox', 'width'));
    expect(box).toContain('bbox has 3 numbers');
    expect(box).toContain("EPSG:3035 isn't one of bbox-crs's valid values");
    expect(box).toContain('Lon in subset with bbox');
    expect(count(html, 'Lon in subset with bbox')).toBe(2);
    expect(box).not.toContain('Left out');
    // The grammar again while it's wrong
    expect(box).toContain('Typed: west,south,east,north');
    const size = shown(block(html, 'width', 'crs'));
    expect(size).toContain("width 0 isn't a positive integer");
    expect(size).toContain("height 9000 is past the API docs' maximum, 8000");
    expect(shown(block(html, 'crs', 'datetime'))).toContain('not listed');
    // The crs asked is pressed, and doesn't open More
    expect(count(block(html, 'crs', 'datetime'), 'aria-pressed="true"')).toBe(1);
    expect(field(html, 'more')).toContain('aria-expanded="false"');
  });
});

// What's under More for the radar's map on MeteoCore: its background, outside the CRS, centre, scale, subset CRS,
// quality and Accept, each a block as the main fields are
describe('a map’s More', () => {
  const ROOT = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
  const radar = () => withLinkQueries(structuredClone(mapsMore.collections[0]) as unknown as Collection);
  const index = buildOperationIndex({ url: 'https://meteocore.app.meteo.fi/api', doc: { paths: { [mapsMore.mapPath]: { get: { parameters: mapsMore.parameters } } } } });
  const operation = { template: mapsMore.mapPath, pointer: '/paths/x', required: [], params: apiDocsParams(index.entries[0].params) };
  const state = (accept = '') => ({ styleId: '', styleByLink: false, selectStyle: () => {}, mapStyles: { status: 'ready', styles: [], source: null }, accept, setAccept: () => {} });
  // The blocks inside More, in order, and a block from its id to the next block's head
  const moreIds = (html: string) => blockIds(html.slice(html.indexOf('id="query-field-more"'))).filter(id => id !== 'more');
  const block = (html: string, id: string, next: string) => html.slice(html.lastIndexOf('<', html.indexOf(`id="query-field-${id}"`)), html.lastIndexOf('<', html.indexOf(`id="query-field-${next}"`)));
  const IN_MORE = ['transparent', 'bgcolor', 'void-transparent', 'void-color', 'center', 'center-crs', 'scale-denominator', 'subset-crs', 'quality', 'accept', 'other'];

  beforeEach(() => {
    around.conformsTo = mapsMore.conformsTo;
    issues.apiOperation = operation;
  });

  it('is closed with none of them asked, and opens with any, the Accept header included', () => {
    around.requestUrl = ROOT;
    let html = form(radar(), 'map', state());
    expect(shown(field(html, 'more'))).toBe('More: transparent, bgcolor, void-transparent, void-color, center, center-crs, scale-denominator, subset-crs, quality, Accept, other parameters');
    expect(field(html, 'more')).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="query-field-transparent"');
    for (const asked of ['void-color=red', 'center-crs=CRS:84', 'quality=80', 'subset-crs=CRS:84']) {
      around.requestUrl = `${ROOT}?${asked}`;
      expect(field(form(radar(), 'map', state()), 'more'), asked).toContain('aria-expanded="true"');
    }
    around.requestUrl = ROOT;
    html = form(radar(), 'map', state('image/jpeg'));
    expect(field(html, 'more')).toContain('aria-expanded="true"');
    expect(moreIds(html)).toEqual(IN_MORE);
    // None of them is among the main fields
    expect(blockIds(html.slice(0, html.indexOf('id="query-field-more"'))).filter(id => IN_MORE.includes(id))).toEqual([]);
  });

  it('names each block by what’s sent, tags who declares it, and says what the server does while it’s left out', () => {
    around.requestUrl = `${ROOT}?quality=80`;
    const html = form(radar(), 'map', state());
    const heads = ['transparent', 'void-transparent', 'center', 'scale-denominator', 'subset-crs', 'quality', 'accept'];
    const next = (id: string) => [...heads, 'other'][heads.indexOf(id) + 1];
    const said = (id: string) => shown(block(html, id, next(id)));
    expect(said('transparent').startsWith('Background transparent · bgcolor optional background API docs true default false')).toBe(true);
    expect(said('transparent')).toContain("Left out: transparent where there's no data: transparent is true without a bgcolor");
    expect(block(html, 'transparent', 'void-transparent')).toContain('placeholder="0xRRGGBB, or a colour name"');
    expect(block(html, 'transparent', 'void-transparent')).toContain('aria-label="No colour"');
    expect(said('void-transparent').startsWith('Outside the CRS void-transparent · void-color optional background API docs')).toBe(true);
    expect(said('center').startsWith('Centre center · center-crs optional spatial-subsetting API docs CRS84 EPSG:3067')).toBe(true);
    expect(block(html, 'center', 'scale-denominator')).toContain('placeholder="lon,lat"');
    expect(said('scale-denominator').startsWith('Scale scale-denominator optional scaling API docs')).toBe(true);
    expect(said('subset-crs').startsWith('Subset CRS subset-crs optional spatial-subsetting API docs CRS84 EPSG:3067')).toBe(true);
    expect(said('quality').startsWith('Quality quality optional API docs The API docs: Encoder quality')).toBe(true);
    expect(typedValue(html, 'quality')).toBe('80');
    expect(said('quality')).not.toContain('Left out');
    expect(said('accept').startsWith('Format by Accept Accept (header) optional core image/png image/jpeg image/webp')).toBe(true);
    expect(said('accept')).toContain("Left out: */* , as the app sends it: the server's default format");
  });

  it('says nothing left out of a block with either of its names asked', () => {
    around.requestUrl = `${ROOT}?bgcolor=red&center-crs=CRS:84`;
    const html = form(radar(), 'map', state());
    expect(shown(block(html, 'transparent', 'void-transparent'))).not.toContain('Left out');
    expect(shown(block(html, 'center', 'scale-denominator'))).not.toContain('Left out');
    // The block beside them is still left out
    expect(shown(block(html, 'void-transparent', 'center'))).toContain('Left out: as the background');
  });

  it('holds what the request has, and shows each one’s issue in its block, and the clashes of center and scale with the box and size', () => {
    around.requestUrl = `${ROOT}?transparent=yes&bgcolor=nope&center=25,62&bbox=19,59,32,70&width=256&scale-denominator=0`;
    issues.list = [
      { id: 'maps:bbox:with-center', severity: 'error', source: 'maps', field: 'bbox', message: 'bbox with center: Maps 1.0 asks a 4xx for either with the other' },
      { id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: 'width', message: 'width with bbox and scale-denominator: Maps 1.0 asks a 4xx' },
      { id: 'maps:transparent:boolean', severity: 'error', source: 'maps', field: 'transparent', message: "transparent yes isn't true or false" },
      { id: 'maps:bgcolor:colour', severity: 'error', source: 'maps', field: 'bgcolor', message: 'bgcolor nope is neither' },
      { id: 'maps:scale-denominator:number', severity: 'error', source: 'maps', field: 'scale-denominator', message: "scale-denominator 0 isn't positive" },
    ];
    const html = form(radar(), 'map', state('image/jpeg'));
    expect(['bgcolor', 'center', 'scale-denominator'].map(name => typedValue(html, name))).toEqual(['nope', '25,62', '0']);
    const background = shown(block(html, 'transparent', 'void-transparent'));
    expect(background).toContain("transparent yes isn't true or false");
    expect(background).toContain('bgcolor nope is neither');
    // yes, pressed beside true and false, and the colour's grammar again while it's wrong
    expect(background.startsWith('Background transparent · bgcolor optional background API docs true false default yes')).toBe(true);
    expect(shown(block(html, 'center', 'scale-denominator'))).toContain('bbox with center');
    expect(shown(block(html, 'scale-denominator', 'subset-crs'))).toContain("scale-denominator 0 isn't positive");
    expect(shown(block(html, 'scale-denominator', 'subset-crs'))).toContain('width with bbox and scale-denominator');
    // Each also in its own: the box's and the size's
    expect(count(html, 'bbox with center')).toBe(2);
    expect(count(html, 'width with bbox and scale-denominator')).toBe(2);
    expect(block(html, 'accept', 'other')).toContain('value="image/jpeg"');
    expect(shown(block(html, 'accept', 'other'))).not.toContain('Left out');
    // A colour in error is typed in red, as the box's numbers are
    const colour = block(html, 'transparent', 'void-transparent');
    expect(colour.slice(colour.lastIndexOf('<input', colour.indexOf('aria-label="bgcolor"')), colour.indexOf('aria-label="bgcolor"'))).toContain('aria-invalid="true"');
    // A centre's clash with a spatial subset is shown there only while it has a centre
    around.requestUrl = `${ROOT}?subset=Lon(19:32)`;
    issues.list = [{ id: 'maps:subset:with-bbox', severity: 'error', source: 'maps', field: 'subset', message: 'Lon in subset with bbox' }];
    const centre = shown(block(form(radar(), 'map', state('image/jpeg')), 'center', 'scale-denominator'));
    expect(centre.startsWith('Centre center · center-crs')).toBe(true);
    expect(centre).not.toContain('Lon in subset');
    around.requestUrl = `${ROOT}?subset=Lon(19:32)&center=25,62`;
    issues.list = [{ id: 'maps:subset:with-bbox', severity: 'error', source: 'maps', field: 'subset', message: 'Lon in subset with center' }];
    expect(shown(block(form(radar(), 'map', state()), 'center', 'scale-denominator'))).toContain('Lon in subset with center');
  });
});
