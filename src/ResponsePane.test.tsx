import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResponsePane from './ResponsePane';
import type { ResponseDetails } from './api/sendRequest';
import { RequestUrlContext } from './contexts/RequestUrlContext';
import type { Collection } from './types/api';
import { INITIAL_CHOICES, ResponseCellsContext, createHoverStore, pictureOf } from './contexts/responseCells';
import { readCells } from './coverage/coverageCells';
import { grid, words } from './coverage/cellsTestData';
import knmi from './locations/__fixtures__/knmi-tg1-oper-locations.json';
import maps from './query/__fixtures__/meteocore-map-responses.json';
import checks from './query/__fixtures__/meteocore-map-checks.json';
import { readImageBytes } from './query/mapResponse';
import { buildOperationIndex } from './validation/openapi/operationIndex';

// The open collection, which each test can set
const open = vi.hoisted(() => ({ collection: null as Partial<Collection> | null }));
vi.mock('./contexts/CollectionContext', () => ({ useCollection: () => ({ selectedCollection: open.collection }) }));
// The picture, where a test gives the pane one, asks which panes are open, and can open a request
vi.mock('./contexts/PanesContext', () => ({ usePanes: () => ({ isMobile: false, isOpen: { map: true }, showPane: () => {}, showMap: () => {} }) }));
// A locations list's table shows a location on the map
vi.mock('./contexts/MapInteractionContext', () => ({ useMapInteraction: () => ({ responseLocation: null, showResponseLocation: () => {} }) }));
// The grid draws only in a browser: here it says how many rows it was given
vi.mock('@mui/x-data-grid', async importOriginal => ({
  ...await importOriginal<typeof import('@mui/x-data-grid')>(),
  DataGrid: ({ rows }: { rows: unknown[] }) => <div data-rows={rows.length} />,
}));
vi.mock('./contexts/OpenRequestContext', () => ({ useOpenRequest: () => ({ openRequest: () => {} }) }));
// The loaded API, which declares EDR 1.2 and its EDR GeoJSON class, unless a test loads another
const EDR_API = { apiUrl: 'https://api.example.com', conformsTo: ['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core', 'https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/edr-geojson'] };
const api = vi.hoisted(() => ({ loaded: null as { apiUrl: string; conformsTo: string[] } | null }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => api.loaded ?? EDR_API }));
// The loaded API's docs, indexed, where a test gives them
const docs = vi.hoisted(() => ({ index: null as unknown }));
vi.mock('./contexts/OpenApiContext', async importOriginal => ({
  ...await importOriginal<typeof import('./contexts/OpenApiContext')>(),
  useOpenApi: () => ({ status: docs.index ? 'ready' : 'none', url: null, description: null, index: docs.index, error: null, captured: null }),
}));
// A summary that fails on a response marked for it, as a reader with a bug would
vi.mock('./coverage/coverageSummary', async importOriginal => {
  const actual = await importOriginal<typeof import('./coverage/coverageSummary')>();
  return {
    ...actual,
    summarizeCoverage: (json: unknown, context?: Parameters<typeof actual.summarizeCoverage>[1]) => {
      if ((json as { fails?: boolean } | null)?.fails) throw new Error('Invalid array length');
      return actual.summarizeCoverage(json, context);
    },
  };
});

const URL_ = 'https://api.example.com/collections/a/position?coords=POINT(1%202)';
const OK: ResponseDetails = {
  status: 200,
  statusText: 'OK',
  timeMs: 2230,
  sizeBytes: 11,
  headers: [{ name: 'content-type', value: 'text/plain' }, { name: 'x-a', value: '1' }],
  contentType: 'text/plain',
  requestUrlBytes: 50,
  timing: null,
};
const BAD_REQUEST: ResponseDetails = { ...OK, status: 400, statusText: 'Bad Request' };
const COVERAGE = JSON.stringify({
  type: 'Coverage',
  domain: {
    type: 'Domain', domainType: 'PointSeries',
    axes: { x: { values: [1] }, y: { values: [2] }, t: { values: ['2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z'] } },
    referencing: [{ coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'Gregorian' } }],
  },
  parameters: { a: { type: 'Parameter', observedProperty: { label: { en: 'A' } } } },
  ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['t'], shape: [2], values: [1, 2] } },
});

const render = (props: Partial<ComponentProps<typeof ResponsePane>>, requestUrl = URL_) => renderToStaticMarkup(
  <RequestUrlContext.Provider value={{ requestUrl, isEdited: false, editUrl: () => {}, discardEdits: () => {}, pinUrl: () => {}, unpinUrl: () => {} }}>
    <ResponsePane open onClose={() => {}} url={URL_} data={null} contentType={null} isLoading={false} error={null} {...props} />
  </RequestUrlContext.Provider>,
);

// The Checks tab's label, as its words read
const checksLabel = (html: string) => [...html.matchAll(/<button[^>]*role="tab"[^>]*>(.*?)<\/button>/g)].map(([, tab]) => words(tab).replace(/\s+/g, ' ').trim()).find(tab => tab.startsWith('Checks'));

// The tabs, by name, and the one that's selected
const TAB_NAMES = ['Data', 'Raw', 'Headers', 'Sizes', 'Checks'];
const tabsOf = (html: string) => [...html.matchAll(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g)].map(([tab]) => ({
  name: TAB_NAMES.find(name => tab.includes(`>${name}<`)),
  selected: tab.includes('aria-selected="true"'),
}));
const tabNames = (html: string) => tabsOf(html).map(tab => tab.name);
const selectedTab = (html: string) => tabsOf(html).find(tab => tab.selected)?.name;

describe('ResponsePane', () => {
  it('says what to do before anything has been sent', () => {
    const html = render({ url: '' }, '');
    expect(html).toContain('Nothing sent yet');
    expect(html).not.toContain('Copy URL');
    expect(html).toContain('aria-label="Close the response pane"');
  });

  describe('the URL', () => {
    it('has nothing to say before anything was sent, whatever the request line holds', () => {
      const html = render({ url: '' });
      expect(html).toContain('>Response<');
      expect(html).not.toContain('Sent:');
      expect(html).not.toContain('Copy URL');
    });

    it("doesn't repeat the request line", () => {
      const html = render({ data: 'hello world', contentType: 'text/plain', response: OK });
      expect(html).not.toContain('/position');
      expect(html).not.toContain('Copy URL');
      expect(html).not.toContain('Nothing sent yet');
    });

    it('says what was sent once the request line has moved on', () => {
      const html = render({ data: 'hello world', contentType: 'text/plain', response: OK }, 'https://api.example.com/collections/a/area');
      expect(html).toContain(`title="${URL_}"`);
      expect(html).toContain('Sent: …/a/position?coords=POINT(1 2)');
      expect(html).toContain('aria-label="Copy URL"');
    });

    it('says what a stored response is, which the request line never holds', () => {
      const html = render({ data: '{}', contentType: 'application/json' }, 'https://api.example.com/collections/a/area');
      expect(html).toContain('…/a/position?coords=POINT(1 2)');
      expect(html).not.toContain('Sent:');
    });

    it('has a heading instead while there is nothing else to say', () => {
      expect(render({ isLoading: true })).toContain('>Response<');
      expect(render({ data: 'hello world', contentType: 'text/plain', response: OK })).not.toContain('>Response<');
    });
  });

  it('shows a response with its status line and the ways to read it', () => {
    const html = render({ data: 'hello world', contentType: 'text/plain', response: OK });
    expect(html).toContain('200 OK');
    expect(html).toContain('2.23 s');
    expect(tabNames(html)).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
    expect(selectedTab(html)).toBe('Raw');
    expect(html).toContain('hello world');
    expect(html).not.toContain('Content-Type:');
    expect(html).not.toContain('Transforming');
  });

  it('shows the text only on Raw', () => {
    const json = { contentType: 'application/json', response: OK };
    expect(render({ data: '{}', ...json })).toContain('role="list"');
    expect(render({ data: COVERAGE, ...json })).not.toContain('role="list"');
  });

  it('opens on the view of the data when there is one', () => {
    const html = render({ data: COVERAGE, contentType: 'application/prs.coverage+json', response: OK });
    expect(tabNames(html)).toEqual(['Data', 'Raw', 'Headers', 'Sizes', 'Checks']);
    expect(selectedTab(html)).toBe('Data');
    expect(html).not.toContain('NdArray');
    expect(html).not.toContain('Transforming');
    expect(html).toContain('1 point, 2 times, 1 parameter');
  });

  it('has a Data tab for an IWXXM preview', () => {
    const iwxxm = '<iwxxm:METAR xmlns:iwxxm="http://icao.int/iwxxm/3.0"/>';
    const html = render({ data: iwxxm, contentType: 'text/xml', response: OK });
    expect(tabNames(html)).toEqual(['Data', 'Raw', 'Headers', 'Sizes', 'Checks']);
    expect(selectedTab(html)).toBe('Data');
  });

  it('counts what the data is worth noting on the Checks tab', () => {
    const nulls = JSON.parse(COVERAGE);
    nulls.ranges.a.values = [1, null];
    const html = render({ data: JSON.stringify(nulls), contentType: 'application/prs.coverage+json', response: OK });
    // The null, the times the server chose with no datetime asked, and a having no unit
    expect(html).toContain('>3 notes<');
  });

  // CoverageJSON 10: application/vnd.cov+json
  it('counts the media type of a CoverageJSON response sent just now', () => {
    const sent = { data: COVERAGE, response: OK, validationSchemaName: 'CoverageJSON 1.0' };
    expect(render({ ...sent, contentType: 'application/json' })).toContain('>1 issue<');
    // A pass counts for nothing
    expect(render({ ...sent, contentType: 'application/vnd.cov+json' })).toContain('>2 notes<');
    expect(render({ ...sent, contentType: 'application/prs.coverage+json' })).toContain('>3 notes<');
  });

  it('leaves the media type be where the response isn’t checked as CoverageJSON', () => {
    expect(render({ data: COVERAGE, response: OK, contentType: 'application/json' })).toContain('>2 notes<');
    expect(render({ data: COVERAGE, response: OK, contentType: 'application/json', validationSchemaName: 'EDR Locations FeatureCollection' })).toContain('>2 notes<');
  });

  it('takes the levels that should be there from the open collection, only if the request is for it', () => {
    // 1000 and 850 hPa came back, and the collection also has 925
    const profile = JSON.stringify({
      type: 'Coverage',
      domain: {
        type: 'Domain', domainType: 'VerticalProfile',
        axes: { x: { values: [1] }, y: { values: [2] }, z: { values: [1000, 850] } },
        referencing: [{ coordinates: ['z'], system: { type: 'VerticalCRS', cs: { csAxes: [{ name: { en: 'Pressure' }, direction: 'down', unit: { symbol: 'hPa' } }] } } }],
      },
      ranges: { a: { type: 'NdArray', dataType: 'float', axisNames: ['z'], shape: [2], values: [1, 2] } },
    });
    const withOpen = (id: string) => {
      open.collection = { id, extent: { vertical: { values: ['1000', '925', '850'] } } };
      try {
        return render({ data: profile, contentType: 'application/prs.coverage+json', response: OK });
      } finally {
        open.collection = null;
      }
    };
    // A level the collection has and the response hasn't is the server's to fix
    expect(withOpen('a')).toContain('>1 issue<');
    expect(withOpen('b')).not.toMatch(/(note|issue)</);
    expect(withOpen('a')).toContain('1 point, 2 levels, 1 parameter');
    // And the request's own levels: 777 was asked for, and didn't come, which no rule asks for, so a note
    open.collection = { id: 'b' };
    try {
      const asked = render({ data: profile, contentType: 'application/prs.coverage+json', response: OK, url: 'https://api.example.com/collections/a/position?coords=POINT(1%202)&z=1000,850,777' });
      expect(asked).toContain('>1 note<');
    } finally {
      open.collection = null;
    }
  });

  it('takes the times that should be there from the open collection, only if the request is for it', () => {
    const withOpen = (id: string) => {
      open.collection = { id, extent: { temporal: { interval: [['2026-02-01T00:00:00Z', null]] } } };
      try {
        return render({ data: COVERAGE, contentType: 'application/prs.coverage+json', response: OK });
      } finally {
        open.collection = null;
      }
    };
    // Both times are before the collection's extent, which SHALL include them
    expect(withOpen('a')).toContain('>1 error<');
    expect(withOpen('b')).not.toContain('error<');
  });

  it('adds what the data is worth noting to what the schema found', () => {
    const nulls = JSON.parse(COVERAGE);
    nulls.ranges.a.values = [1, null];
    const html = render({
      data: JSON.stringify(nulls),
      contentType: 'application/prs.coverage+json',
      response: OK,
      validationSchemaName: 'CoverageJSON 1.0',
      validationErrors: [{ path: '/a', message: 'bad', severity: 'error' }],
    });
    expect(html).toContain('>1 error<');
  });

  it("doesn't flag a note's line in Raw, since it isn't a fault", () => {
    const nulls = JSON.parse(COVERAGE);
    nulls.ranges.a.values = [1, null];
    // With no tabs it opens on the text, where a flagged line would show
    const html = render({ data: JSON.stringify(nulls), contentType: 'application/prs.coverage+json' });
    expect(html).toContain('role="list"');
    expect(html).not.toContain('flagged');
  });

  it('says so when it fails to read a response, and shows the response as it came, rather than crash', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = render({ data: JSON.stringify({ ...JSON.parse(COVERAGE), fails: true }), contentType: 'application/prs.coverage+json', response: OK });
    expect(selectedTab(html)).toBe('Data');
    expect(html).toContain('The app failed to read this response as coverage data (Invalid array length). That&#x27;s a fault in the app, not a finding about the response. Raw has it as it came.');
    expect(html).toContain('>Show Raw<');
    expect(html).not.toContain('Transforming');
    expect(error).toHaveBeenCalledWith('summarizeCoverage failed on this response:', expect.any(Error));
    error.mockRestore();
    expect(render({ data: COVERAGE, contentType: 'application/prs.coverage+json', response: OK })).not.toContain('The app failed to read');
  });

  it('opens on the figures of what is not a time series', () => {
    const grid = { type: 'Coverage', domain: { domainType: 'Grid', axes: { x: { values: [1, 2] }, y: { values: [3, 4] } } }, ranges: { a: { type: 'NdArray', values: [1, 2, 3, 4] } } };
    const html = render({ data: JSON.stringify(grid), contentType: 'application/prs.coverage+json', response: OK });
    expect(selectedTab(html)).toBe('Data');
    expect(html).toContain('2 × 2 cells');
  });

  describe('a data query’s answer, against what it asked for', () => {
    // COVERAGE has a, and its times the server chose. The open collection lists a and b, and its position query's
    // default_output_format is CoverageJSON
    const collection: Partial<Collection> = {
      id: 'a',
      parameter_names: { a: { id: 'a' }, b: { id: 'b' } },
      data_queries: { position: { link: { href: 'https://api.example.com/collections/a/position', variables: { default_output_format: 'CoverageJSON' } } } },
    };
    const sent = (url: string, props: Partial<ComponentProps<typeof ResponsePane>> = {}) => {
      open.collection = collection;
      try {
        return render({ url, data: COVERAGE, contentType: 'application/vnd.cov+json', response: OK, validationSchemaName: 'CoverageJSON 1.0', ...props }, url);
      } finally {
        open.collection = null;
      }
    };

    it('counts a parameter left out of every one the collection lists, and one not asked for', () => {
      // b, with no parameter-name: against the collection
      expect(sent(URL_)).toContain('>1 error<');
      // a, which wasn't asked for, and b, which was and isn't there
      expect(sent(`${URL_}&parameter-name=b`)).toContain('>1 error<');
      // The times and the unit's notes, and the passes, which count for nothing
      expect(sent(`${URL_}&parameter-name=a`)).toContain('>2 notes<');
    });

    it('counts a response in another format than f names, or than the query’s default', () => {
      expect(sent(`${URL_}&parameter-name=a&f=GeoJSON`)).toContain('>1 issue<');
      expect(sent(`${URL_}&parameter-name=a&f=CoverageJSON`)).toContain('>2 notes<');
      // GeoJSON features, sent where CoverageJSON is the default, and as plain JSON
      const features = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { a: [1] } }] });
      expect(sent(`${URL_}&parameter-name=a`, { data: features, contentType: 'application/json', validationSchemaName: null })).toContain('>2 issues<');
      expect(sent(`${URL_}&parameter-name=a&f=GeoJSON`, { data: features, contentType: 'application/geo+json', validationSchemaName: null })).not.toMatch(/(error|issue|note)s?</);
    });

    it('reads the body whatever its Content-Type, as the format asked for is judged by it', () => {
      // CoverageJSON as text: f's pass, and the parameter's, where the media type is its own check's
      expect(sent(`${URL_}&parameter-name=b`, { contentType: 'text/plain' })).toContain('>1 error<');
    });

    it('checks nothing of a failure’s body, nor of an answer with no body', () => {
      // Coverage data with a 400 is read as data still, but isn't taken for the answer: no error for a, not asked for
      expect(sent(`${URL_}&parameter-name=b`, { response: BAD_REQUEST, validationSchemaName: null })).toContain('>2 notes<');
      expect(sent(`${URL_}&parameter-name=b`, { data: '', response: { ...OK, status: 204, statusText: 'No Content' }, validationSchemaName: null })).not.toMatch(/(error|issue|note)s?</);
    });
  });

  describe('a locations list', () => {
    const LOCATIONS = 'https://geoservices.knmi.nl/edr/collections/Tg_1_oper/locations';
    const KNMI = JSON.stringify(knmi);
    // KNMI's, as it sends it
    const list = (props: Partial<ComponentProps<typeof ResponsePane>> = {}) => render({ url: LOCATIONS, data: KNMI, contentType: 'application/prs.coverage+json', response: OK, ...props }, LOCATIONS);

    it('opens on its Data tab, a table of the locations with their count', () => {
      const html = list();
      expect(tabNames(html)).toEqual(['Data', 'Raw', 'Headers', 'Sizes', 'Checks']);
      expect(selectedTab(html)).toBe('Data');
      expect(words(html)).toContain('10 locations Pick one to see it on the map');
      expect(html).toContain('data-rows="10"');
      // Not the text, nor a coverage's view, nor IWXXM's
      expect(html).not.toContain('role="list"');
      expect(html).not.toContain('Transforming');
      expect(html).not.toContain('The app failed to read');
    });

    it('is one whatever its Content-Type says, JSON or not', () => {
      for (const contentType of ['application/geo+json', 'application/json', 'text/plain', null]) {
        expect(words(list({ contentType }))).toContain('10 locations');
      }
    });

    it('counts its media type in Checks: an issue for CoverageJSON’s, nothing for GeoJSON’s', () => {
      // As KNMI's is checked: its API declares EDR's GeoJSON class, not EDR GeoJSON
      const checked = { validationSchemaName: 'GeoJSON FeatureCollection (the API declares GeoJSON, not EDR GeoJSON)' };
      expect(list(checked)).toContain('>1 issue<');
      expect(list({ ...checked, contentType: 'application/geo+json' })).not.toContain('issue<');
      // With what the schema found, the errors come first
      const errors = [{ path: '/features/0/properties', message: "/features/*/properties: must have required property 'label' (10 of 10 features)", severity: 'error' as const }];
      expect(list({ ...checked, validationErrors: errors })).toContain('>1 error<');
    });

    it('counts locations a client can’t name in Checks', () => {
      const unnamed = JSON.stringify({ ...knmi, features: knmi.features.map(({ id: _id, ...feature }) => feature) });
      // The id's issue, and the note that nothing else reaches them, which doesn't outrank it
      expect(list({ data: unnamed, contentType: 'application/geo+json' })).toContain('>1 issue<');
      expect(list({ data: unnamed })).toContain('>2 issues<');
    });

    it('isn’t one from anywhere but /locations, nor anything but a FeatureCollection', () => {
      // From /items it's the collection's items, with no locations' checks
      const items = list({ url: 'https://geoservices.knmi.nl/edr/collections/Tg_1_oper/items', data: JSON.stringify({ ...knmi, features: knmi.features.map(({ id: _id, ...feature }) => feature) }) });
      expect(words(items)).toContain('10 items');
      expect(words(items)).not.toContain('locations');
      expect(items).not.toContain('issue<');
      expect(tabNames(list({ url: `${LOCATIONS}/EDDK` }))).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
      expect(tabNames(list({ data: '{"type":"Feature"}' }))).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
      // A location's data, which may be features too: its media type is checked as theirs, not as a list's ids are
      expect(list({ url: `${LOCATIONS}/EDDK`, validationSchemaName: null, contentType: 'application/geo+json' })).not.toContain('issue<');
      expect(list({ url: `${LOCATIONS}/EDDK`, validationSchemaName: null })).toContain('>1 issue<');
    });
  });

  describe('a collection’s items', () => {
    const ITEMS = 'https://api.weather.gc.ca/collections/hydrometric-stations/items';
    const station = (id: string) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-68.6, 47.5] }, properties: { STATION_NAME: id } });
    const LIST = JSON.stringify({ type: 'FeatureCollection', features: [station('01AA002'), station('01AD001')], numberMatched: 8057, numberReturned: 2 });
    const items = (url: string, data: string, props: Partial<ComponentProps<typeof ResponsePane>> = {}) =>
      render({ url, data, contentType: 'application/geo+json', response: OK, ...props }, url);

    it('opens a list on its Data tab, a table of the items with the counts the answer gives', () => {
      open.collection = null;
      const html = items(`${ITEMS}?f=json&limit=2`, LIST);
      expect(tabNames(html)).toEqual(['Data', 'Raw', 'Headers', 'Sizes', 'Checks']);
      expect(selectedTab(html)).toBe('Data');
      expect(words(html)).toContain('2 items numberMatched 8,057 numberReturned 2 Pick one to see it on the map');
      expect(html).toContain('data-rows="2"');
      expect(html).not.toContain('Transforming');
    });

    it('calls a Records collection’s items records', () => {
      const GDC = 'https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items';
      open.collection = { id: 'wis2-discovery-metadata', itemType: 'record' };
      expect(words(items(GDC, LIST))).toContain('2 records numberMatched');
      expect(words(items(`${GDC}/01AD001`, JSON.stringify(station('01AD001'))))).toContain('1 record See it on the map');
      // Not another collection's
      open.collection = { id: 'other', itemType: 'record' };
      expect(words(items(GDC, LIST))).toContain('2 items');
      open.collection = null;
    });

    it('lists one item’s properties', () => {
      const html = items(`${ITEMS}/01AD001`, JSON.stringify(station('01AD001')), { contentType: 'application/json' });
      expect(selectedTab(html)).toBe('Data');
      expect(words(html)).toContain('1 item See it on the map id 01AD001 geometry Point -68.6, 47.5 properties.STATION_NAME 01AD001');
      expect(html).not.toContain('data-rows');
    });

    it('has no Data tab for an HTML page, an error, or a query’s GeoJSON', () => {
      expect(tabNames(items(`${ITEMS}?f=html`, '<html><body>Stations</body></html>', { contentType: 'text/html' }))).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
      expect(tabNames(items(ITEMS, '{"code":"InvalidParameterValue"}', { response: BAD_REQUEST }))).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
      expect(tabNames(items('https://meteocore.app.meteo.fi/edr/collections/fmi-obs/position?coords=POINT(24 60)&f=GeoJSON', LIST)))
        .toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
    });
  });

  it('opens on the image, with no Raw for it', () => {
    const html = render({ imageUrl: 'blob:abc', contentType: 'image/png', response: { ...OK, contentType: 'image/png' } });
    expect(tabNames(html)).toEqual(['Data', 'Headers', 'Sizes', 'Checks']);
    expect(selectedTab(html)).toBe('Data');
    expect(html).toContain('blob:abc');
  });

  describe('a map response', () => {
    const MATCH = maps.responses.matchView;
    const bytes = (base64: string) => readImageBytes(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
    const map = (props: Partial<ComponentProps<typeof ResponsePane>> = {}, url = MATCH.url) => renderToStaticMarkup(
      <RequestUrlContext.Provider value={{ requestUrl: url, isEdited: false, editUrl: () => {}, discardEdits: () => {}, pinUrl: () => {}, unpinUrl: () => {} }}>
        <ResponsePane open onClose={() => {}} url={url} data={null} imageUrl="blob:map" image={bytes(MATCH.start)} contentType="image/png" isLoading={false} error={null}
          response={{ ...OK, contentType: 'image/png', headers: MATCH.headers }} {...props} />
      </RequestUrlContext.Provider>,
    );

    it('shows the image with what its headers say against what was asked, against the open collection', () => {
      open.collection = maps.collection as unknown as Collection;
      const html = map();
      expect(tabNames(html)).toEqual(['Data', 'Headers', 'Sizes', 'Checks']);
      expect(html).toContain('src="blob:map"');
      expect(words(html)).toContain('Content-Crs EPSG:3857 = crs asked');
      expect(words(html)).toContain('Content-Datetime 2026-11-16T15:25:00Z none asked: the server chose');
      expect(html).toContain('On the map');
      // The storage CRS is the open collection's: a bare map is compared with it
      const bare = maps.responses.bare;
      const bareHtml = map({ image: bytes(bare.start), response: { ...OK, contentType: 'image/png', headers: bare.headers } }, bare.url);
      expect(words(bareHtml)).toContain('Content-Crs EPSG:3067 = storageCrs, as none was asked');
      open.collection = null;
      expect(words(map({ image: bytes(bare.start), response: { ...OK, contentType: 'image/png', headers: bare.headers } }, bare.url))).toContain('Content-Crs EPSG:3067 none asked');
    });

    it("reads no rows for an image that isn't a map's, or a failure's, or while loading", () => {
      expect(map({}, 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/styles/radar_fmi/legend')).not.toContain('What the headers say');
      const failed = map({ response: { ...BAD_REQUEST, contentType: 'image/png', headers: MATCH.headers } });
      expect(failed).toContain('src="blob:map"');
      expect(failed).not.toContain('What the headers say');
      expect(failed).not.toContain('On the map');
      expect(map({ isLoading: true })).not.toContain('What the headers say');
    });

    it('counts its checks on the Checks tab, but not what it says of the request', () => {
      open.collection = maps.collection as unknown as Collection;
      // Every check passes; its pixels aren't square, which is the request's doing
      expect(checksLabel(map())).toBe('Checks');
      // Content-Crs isn't the crs asked (made up)
      const other = MATCH.headers.map(header => (header.name === 'content-crs' ? { ...header, value: 'http://www.opengis.net/def/crs/EPSG/0/3067' } : header));
      expect(checksLabel(map({ response: { ...OK, contentType: 'image/png', headers: other } }))).toBe('Checks 1 error');
      open.collection = null;
    });

    it("counts a refusal's checks, against the loaded API's Maps classes, and not what the form expected", () => {
      api.loaded = { apiUrl: 'https://meteocore.app.meteo.fi', conformsTo: checks.conformsTo };
      open.collection = checks.collections.ifs as unknown as Collection;
      const refused = (name: 'vertical' | 'parameterUnknown' | 'contours') => {
        const { url, headers, body } = checks.responses[name];
        return map({ imageUrl: null, image: null, data: body, contentType: 'application/json', response: { ...BAD_REQUEST, contentType: 'application/json', headers } }, url);
      };
      expect(tabNames(refused('vertical'))).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
      expect(checksLabel(refused('vertical'))).toBe('Checks 1 note');
      expect(checksLabel(refused('contours'))).toBe('Checks 1 issue');
      expect(checksLabel(refused('parameterUnknown'))).toBe('Checks');
      // A model run by subset: an axis the draft names, which no Maps class the API declares has, so a note
      const run = checks.responses.run;
      const ran = () => map({ image: bytes(run.start), response: { ...OK, contentType: 'image/png', headers: run.headers } }, run.url.replace(/%22/g, '"'));
      expect(checksLabel(ran())).toBe('Checks 1 note');
      // Of another API than the one loaded, nothing is known of its classes: nothing to say of it
      api.loaded = null;
      expect(checksLabel(ran())).toBe('Checks');
      open.collection = null;
    });

    describe('against the loaded API', () => {
      const MAP = '/collections/ecmwf-ifs-pressure/map';
      const RUN = checks.responses.run;
      // MeteoCore's API docs for the map, its parameters as served, and limits where a test adds them (made up)
      const index = (change: { limits?: Record<string, number>; elevation?: unknown } = {}) => buildOperationIndex({
        url: 'https://meteocore.app.meteo.fi/api',
        doc: {
          openapi: '3.0.3', servers: [{ url: 'https://meteocore.app.meteo.fi' }],
          info: { title: 'MeteoCore', version: '1', ...(change.limits ? { 'x-OGC-limits': { maps: change.limits } } : {}) },
          paths: { [MAP]: { get: { parameters: checks.apiParams.map(({ pointer: _pointer, ...param }) => (param.name === 'elevation' && change.elevation ? { ...param, schema: change.elevation } : param)) } } },
        },
      });
      const ran = (url: string, props: Partial<ComponentProps<typeof ResponsePane>> = {}) =>
        map({ image: bytes(RUN.start), response: { ...OK, contentType: 'image/png', headers: RUN.headers }, ...props }, url);
      const runUrl = RUN.url.replace(/%22/g, '"');
      const loaded = () => {
        api.loaded = { apiUrl: 'https://meteocore.app.meteo.fi', conformsTo: checks.conformsTo };
        open.collection = checks.collections.ifs as unknown as Collection;
      };
      const unload = () => {
        api.loaded = null;
        open.collection = null;
        docs.index = null;
      };

      it('reads its API docs: a parameter they leave out is one a server may ignore, a note', () => {
        loaded();
        expect(checksLabel(ran(`${runUrl}&foo=1`))).toBe('Checks 1 note');
        docs.index = index();
        expect(checksLabel(ran(`${runUrl}&foo=1`))).toBe('Checks 2 notes');
        unload();
      });

      it('reads its limits: a 200 past them is an error', () => {
        loaded();
        docs.index = index({ limits: { maxWidth: 200 } });
        expect(checksLabel(ran(runUrl))).toBe('Checks 1 error');
        unload();
      });

      it("reads what its API docs say of the URL: a refusal they foretold is the request's", () => {
        loaded();
        const elevation = `https://meteocore.app.meteo.fi${MAP}?elevation=850`;
        const refused = () => map({ imageUrl: null, image: null, data: '{"description":"elevation 850 is wrong"}', contentType: 'application/json', response: { ...BAD_REQUEST, contentType: 'application/json', headers: RUN.headers } }, elevation);
        docs.index = index();
        expect(checksLabel(refused())).toBe('Checks 1 issue');
        // Made up: API docs whose elevation takes only 500
        docs.index = index({ elevation: { type: 'number', enum: [500] } });
        expect(checksLabel(refused())).toBe('Checks');
        unload();
      });

      it("reads the error's message for what it names", () => {
        loaded();
        const refused = (data: string | null) => map({ imageUrl: null, image: null, data, contentType: 'application/json', response: { ...BAD_REQUEST, contentType: 'application/json', headers: RUN.headers } },
          `https://meteocore.app.meteo.fi${MAP}?width=256`);
        expect(checksLabel(refused('{"description":"width 256 is too wide"}'))).toBe('Checks 1 error');
        expect(checksLabel(refused('{"description":"Something failed"}'))).toBe('Checks 1 issue');
        unload();
      });
    });

    it("reads no image that isn't this response's: one left from the last isn't checked against a JSON 200 (made up)", () => {
      open.collection = maps.collection as unknown as Collection;
      // Its headers are the matched view's, so that only its Content-Type is wrong
      const url = MATCH.url.replace('width=478&height=721', 'width=100&height=100');
      expect(checksLabel(map({ imageUrl: null, data: '{"type":"FeatureCollection"}', contentType: 'application/json', response: { ...OK, contentType: 'application/json', headers: MATCH.headers } }, url))).toBe('Checks 1 error');
      open.collection = null;
    });

    it("counts what the browser couldn't read (made up)", () => {
      open.collection = maps.collection as unknown as Collection;
      const hidden = MATCH.headers.filter(header => !/^(access-control-expose-headers|content-datetime)$/.test(header.name));
      expect(checksLabel(map({ response: { ...OK, contentType: 'image/png', headers: hidden } }))).toBe('Checks 1 note');
      open.collection = null;
    });

    it('reads a 200 against Maps 1.0 where the API is another than the one loaded (made up)', () => {
      open.collection = maps.collection as unknown as Collection;
      // width=0 drawn: an error by Maps 1.0, whichever classes the API declares, which aren't known
      expect(checksLabel(map({}, MATCH.url.replace('width=478&height=721', 'width=0')))).toBe('Checks 1 error');
      open.collection = null;
    });

    it("bytes that aren't the image their Content-Type says: Data says so, and Raw is there for them", () => {
      const json = maps.responses.widthZero.body;
      const html = map({ image: bytes(maps.responses.widthZero.start), data: json });
      expect(tabNames(html)).toEqual(['Data', 'Raw', 'Headers', 'Sizes', 'Checks']);
      expect(selectedTab(html)).toBe('Data');
      expect(words(html)).toContain('The body isn\'t the image its Content-Type says: it starts with {"code":"BadRequest","de. Raw shows it.');
      expect(html).not.toContain('<img');
      // Not as a page of its own, as text would be
      expect(html).not.toContain('Transforming XSLT');
    });
  });

  it("offers the text's copy button beside the tabs, in no row of its own", () => {
    const html = render({ data: 'hello world', contentType: 'text/plain', response: OK });
    expect(html).toContain('aria-label="Copy the response"');
    expect(html).not.toContain('role="toolbar"');
  });

  it('counts what the picture found on the Checks tab, with what the summary found', () => {
    // x and y with no coordinate system: an error only the picture finds
    const json = grid({ referencing: [] });
    const props = { data: JSON.stringify(json), contentType: 'application/prs.coverage+json', response: OK };
    const reading = readCells(json);
    const withPicture = renderToStaticMarkup(
      <ResponseCellsContext.Provider value={{
        reading, picture: pictureOf(reading, INITIAL_CHOICES), choices: INITIAL_CHOICES, choose: () => {}, lit: null, hover: createHoverStore(), url: URL_, openInRaw: () => {}, drawAnyway: () => {},
      }}>
        <RequestUrlContext.Provider value={{ requestUrl: URL_, isEdited: false, editUrl: () => {}, discardEdits: () => {}, pinUrl: () => {}, unpinUrl: () => {} }}>
          <ResponsePane open onClose={() => {}} url={URL_} isLoading={false} error={null} {...props} />
        </RequestUrlContext.Provider>
      </ResponseCellsContext.Provider>,
    );
    expect(withPicture).toContain('>1 error<');
    expect(render(props)).not.toContain('>1 error<');
  });

  it('counts the findings on the Checks tab', () => {
    const html = render({
      data: '{\n  "a": 1\n}',
      contentType: 'application/json',
      response: OK,
      validationSchemaName: 'Thing',
      validationErrors: [{ path: '/a', message: 'bad', severity: 'warning' }, { path: '/a', message: 'odd', severity: 'info' }],
    });
    expect(tabNames(html)).toContain('Checks');
    expect(html).toContain('>1 issue<');
  });

  it('flags the lines in Raw, however bad they are, in words that fit them all', () => {
    const html = render({
      data: '{\n  "a": 1,\n  "b": 2\n}',
      contentType: 'application/json',
      response: OK,
      validationSchemaName: 'Thing',
      validationErrors: [{ path: '/a', message: '/a: bad', severity: 'error' }, { path: '/b', message: '/b: odd', severity: 'info' }],
    });
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('2 lines flagged');
    expect(html).toContain('aria-label="Next flagged line"');
    expect(html).toContain('L2');
    expect(html).toContain('>bad<');
  });

  it("shows a failure's message and the body the server sent", () => {
    const html = render({ data: 'unknown parameter', contentType: 'text/plain', response: BAD_REQUEST, error: 'The server rejected the request (400).' });
    expect(html).toContain('400 Bad Request');
    expect(html).toContain('The server rejected the request (400).');
    expect(html).toContain('unknown parameter');
    expect(tabNames(html)).toEqual(['Raw', 'Headers', 'Sizes', 'Checks']);
  });

  it('says so when a response has no body', () => {
    const html = render({ data: '', contentType: 'text/plain', response: { ...OK, sizeBytes: 0 } });
    expect(html).toContain('The response has no body.');
    expect(html).not.toContain('aria-label="Copy the response"');
  });

  it("doesn't call an image a missing body", () => {
    const html = render({ imageUrl: 'blob:abc', contentType: 'image/png', response: { ...OK, contentType: 'image/png' } });
    expect(html).not.toContain('The response has no body.');
  });

  it('shows an image the server sent with a failure', () => {
    const html = render({ imageUrl: 'blob:abc', contentType: 'image/png', response: BAD_REQUEST, error: 'The server rejected the request (400).' });
    expect(html).toContain('The server rejected the request (400).');
    expect(html).toContain('blob:abc');
  });

  it('shows only the message when no response came', () => {
    const html = render({ error: 'Network error.' });
    expect(html).toContain('Network error.');
    expect(tabNames(html)).toEqual([]);
    expect(html).not.toContain('The response has no body.');
  });

  it('shows a stored response without a status line or tabs, but with its copy button', () => {
    const html = render({ data: 'stored', contentType: 'text/plain' });
    expect(html).toContain('Content-Type: text/plain');
    expect(html).toContain('stored');
    expect(tabNames(html)).toEqual([]);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Copy the response"');
  });

  it('shows neither tabs nor a body while loading', () => {
    const html = render({ isLoading: true, response: OK, data: 'hello world', contentType: 'text/plain' });
    expect(tabNames(html)).toEqual([]);
    expect(html).not.toContain('hello world');
  });
});
