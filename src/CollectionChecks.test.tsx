import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionChecks from './CollectionChecks';
import type { Collection, ValidationResult } from './types/api';

// The loaded API's conformance, which says which EDR version is cited
const api = vi.hoisted(() => ({ conformsTo: null as string[] | null }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => api }));
afterEach(() => { api.conformsTo = null; });

vi.mock('./CollectionValidationErrors', () => ({ default: ({ errors }: { errors: unknown[] }) => <i>{errors.length} schema errors</i> }));

const VALID: ValidationResult = { isValid: true, errors: null };
const MAP_LINK = { href: 'https://a.example/collections/one/map', rel: 'http://www.opengis.net/def/rel/ogc/1.0/map', type: 'image/png' };

const render = (collection: object, validation = VALID) => renderToStaticMarkup(
  <CollectionChecks collection={collection as unknown as Collection} validationResult={validation} />
);
const full = {
  id: 'one',
  title: 'First collection',
  description: 'What it holds',
  keywords: ['weather', 'forecast'],
  links: [{ href: 'https://a.example/collections/one', rel: 'self', title: 'This one' }, { href: 'https://a.example/x', rel: 'data' }],
  data_queries: { position: { link: { href: 'https://a.example/position', rel: 'data', title: 'Its position query' } } },
  extent: { spatial: { bbox: [[20, 55, 30, 65]], crs: 'CRS84' } },
  crs: 'CRS84',
  output_formats: ['CoverageJSON', 'GeoJSON'],
  parameter_names: { t: { type: 'Parameter', description: 'Temperature' } },
};
const severityOf = (html: string, title: string) => {
  const upTo = html.slice(0, html.indexOf(title));
  return [...upTo.matchAll(/MuiAlert-color(Success|Warning|Error|Info)/g)].at(-1)?.[1];
};

const EDR_1_1 = ['http://www.opengis.net/spec/ogcapi-edr-1/1.1/conf/core'];
const EDR_1_2 = ['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core'];

// Each check's title, lettered by its statement of /req/edr/rc-collection-info: in EDR 1.1, which an API declaring none
// is cited against, and in 1.2. 1.1 has no statement for data_queries, so it has no letter there, and comes last
const V11 = {
  id: 'A: ID', title: 'B: TITLE', description: 'C: DESCRIPTION', keywords: 'D: KEYWORDS', links: 'E: LINKS', extent: 'F: EXTENT',
  crs: 'G: CRS', outputFormats: 'J: OUTPUT_FORMATS', parameterNames: 'K: PARAMETER_NAMES', dataQueries: 'DATA_QUERIES',
};
const V12 = {
  id: 'A: ID', title: 'B: TITLE', description: 'C: DESCRIPTION', keywords: 'D: KEYWORDS', links: 'E: LINKS', extent: 'F: EXTENT',
  dataQueries: 'G: DATA_QUERIES', crs: 'H: CRS', outputFormats: 'K: OUTPUT_FORMATS', parameterNames: 'L: PARAMETER_NAMES',
};
// The alerts' titles, in the order shown
const titlesOf = (html: string) => [...html.matchAll(/class="[^"]*MuiAlertTitle-root[^"]*">([^<]*)/g)].map(match => match[1].trim());

describe('CollectionChecks', () => {
  it('passes a complete collection on every field, naming what it found', () => {
    const html = render(full);
    for (const title of [...Object.values(V11), 'F.1: Spatial Extent']) {
      expect(html).toContain(title);
      expect(severityOf(html, title), title).toBe('Success');
    }
    expect(html).toContain('weather, forecast');
    expect(html).toContain('This one');
    expect(html).toContain('Its position query');
    expect(html).toContain('CoverageJSON, GeoJSON');
    expect(html).toContain('Temperature');
  });

  it('holds a missing required field against it as an error', () => {
    const html = render({ title: 'x' });
    for (const title of [V11.id, V11.links, V11.dataQueries, V11.extent, V11.crs, V11.outputFormats, V11.parameterNames]) {
      expect(severityOf(html, title), title).toBe('Error');
    }
  });

  it('warns of a missing optional field', () => {
    const html = render({ id: 'one' });
    for (const title of [V11.title, V11.description, V11.keywords]) {
      expect(severityOf(html, title)).toBe('Warning');
    }
  });

  it("doesn't hold fields against a Maps collection that it isn't asked for", () => {
    const html = render({ id: 'one', links: [MAP_LINK] });
    for (const title of [V11.dataQueries, V11.outputFormats, V11.parameterNames]) {
      expect(severityOf(html, title)).toBe('Info');
    }
    expect(html).toContain('Not applicable');
  });

  it('shows the schema errors found for it, and not those of others', () => {
    const errors = { one: [{ message: 'x' }, { message: 'y' }], two: [{ message: 'z' }] };
    expect(render(full, { ...VALID, collectionErrors: errors })).toContain('2 schema errors');
    expect(render(full)).not.toContain('schema errors');
    expect(render({ ...full, id: 'three' }, { ...VALID, collectionErrors: errors })).not.toContain('schema errors');
  });

  it('flags a flat bounding box', () => {
    const html = render({ ...full, extent: { spatial: { bbox: [20, 55, 30, 65], crs: 'CRS84' } } });
    expect(html).toContain('Legacy bbox format');
    expect(html).toContain('[20, 55, 30, 65]');
    expect(render(full)).not.toContain('Legacy bbox format');
  });

  it('lists several bounding boxes', () => {
    const html = render({ ...full, extent: { spatial: { bbox: [[1, 2, 3, 4], [5, 6, 7, 8]], crs: 'CRS84' } } });
    expect(html).toContain('Bounding Boxes');
    expect(html).toContain('Bbox 2: [5, 6, 7, 8]');
  });

  it('calls a spatial extent without a CRS missing', () => {
    expect(severityOf(render({ ...full, extent: { spatial: { bbox: [[1, 2, 3, 4]] } } }), 'F.1: Spatial Extent')).toBe('Error');
  });

  describe('the letters', () => {
    const withLevels = { ...full, extent: { ...full.extent, temporal: { interval: [['2026-11-01T00:00:00Z', null]], trs: 'Gregorian' }, vertical: { interval: [['1000', '10']], vrs: 'pressure' } } };

    it('are EDR 1.1’s statements’ where it is cited, with data_queries unlettered and last', () => {
      api.conformsTo = EDR_1_1;
      const titles = titlesOf(render(withLevels));
      expect(titles.filter(title => !title.includes('.'))).toEqual(Object.values(V11));
      // The extent's parts are numbered under its letter
      expect(titles.filter(title => title.includes('.'))).toEqual(['F.1: Spatial Extent (Mandatory)', 'F.2: Temporal Extent (Optional)', 'F.3: Vertical Extent (Optional)']);
      // As for an API that declares none
      api.conformsTo = null;
      expect(titlesOf(render(withLevels))).toEqual(titles);
    });

    it('are EDR 1.2’s statements’ where it is declared, in their order', () => {
      api.conformsTo = EDR_1_2;
      const titles = titlesOf(render(withLevels));
      expect(titles.filter(title => !title.includes('.'))).toEqual(Object.values(V12));
      expect(titles.filter(title => title.startsWith('F.'))).toHaveLength(3);
    });

    it('agree with the statement each check cites, in either version', () => {
      for (const conformsTo of [EDR_1_1, EDR_1_2]) {
        api.conformsTo = conformsTo;
        const html = render({ title: 'x', links: [] });
        const titles = titlesOf(html).filter(title => !title.includes('.') && title !== 'Legacy bbox format');
        expect(titles.length).toBe(10);
        for (const title of titles) {
          // What the title's alert cites: the links up to the end of the title
          const at = html.indexOf(`>${title}`);
          const cited = html.slice(at, html.indexOf('</div>', at));
          const letter = title.includes(': ') ? title.split(': ')[0] : null;
          if (letter) expect(cited.split(`/req/edr/rc-collection-info ${letter}, test B.14</a>`).length - 1, `${conformsTo[0]} ${title}`).toBe(1);
          else expect(cited.split('/req/edr/rc-collection-info').length - 1, `${conformsTo[0]} ${title}`).toBe(0);
        }
      }
    });
  });

  describe('the rules', () => {
    // What follows a title, up to the alert's message
    const titled = (html: string, title: string) => html.slice(html.indexOf(`>${title}`), html.indexOf('</div>', html.indexOf(`>${title}`)));

    it('cites each field’s statement of /req/edr/rc-collection-info in its title, in the version the API declares', () => {
      api.conformsTo = EDR_1_2;
      const html = render(full);
      for (const title of Object.values(V12)) {
        expect(titled(html, title), title).toContain(`>EDR 1.2 /req/edr/rc-collection-info ${title[0]}, test B.14</a>`);
      }
      expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_1fdd19b3-2587-d511-f40e-f46bab33516b"');
      expect(html).not.toContain('The API declares');
    });

    it('cites 1.1’s statements where they differ, and its schema for data_queries, which its text doesn’t name', () => {
      api.conformsTo = EDR_1_1;
      const html = render({ title: 'x' });
      expect(titled(html, V11.dataQueries)).toContain('>EDR 1.1 /req/collections/rc-md-success B, test B.10</a>');
      expect(titled(html, V11.crs)).toContain('>EDR 1.1 /req/edr/rc-collection-info G, test B.14</a>');
      expect(titled(html, V11.outputFormats)).toContain('>EDR 1.1 /req/edr/rc-collection-info J, test B.14</a>');
      expect(titled(html, V11.parameterNames)).toContain('>EDR 1.1 /req/edr/rc-collection-info K, test B.14</a>');
      expect(html).not.toContain('EDR 1.2');
    });

    it('says once that an API declaring no EDR version is cited against 1.1', () => {
      const html = render(full);
      expect(html.split('The API declares no EDR version; cited against EDR 1.1').length - 1).toBe(1);
      expect(html.indexOf('The API declares')).toBeLessThan(html.indexOf('A: ID'));
      expect(html).toContain('>EDR 1.1 /req/edr/rc-collection-info A, test B.14</a>');
    });

    it('quotes the rule a missing id breaks as it is written', () => {
      const html = render({ title: 'x' });
      expect(html).toContain('Every Collection within a collections array SHALL have a unique (within the array) id parameter.');
      expect(html).not.toContain('"Every Collection');
      expect(html).not.toContain('MUST have');
    });

    it('cites the schema for a flat bounding box', () => {
      const html = render({ ...full, extent: { spatial: { bbox: [20, 55, 30, 65], crs: 'CRS84' } } });
      expect(titled(html, 'Legacy bbox format')).toContain('>EDR 1.1 /req/collections/rc-md-success B, test B.10</a>');
    });

    it('cites nothing for what Maps isn’t asked for', () => {
      const html = render({ id: 'one', links: [MAP_LINK] });
      expect(titled(html, V11.dataQueries)).not.toContain('<a ');
    });
  });

  it('accepts parameter names as a list', () => {
    const html = render({ ...full, parameter_names: [{ id: 't', label: 'Temperature', type: 'Parameter' }, { id: 'p' }] });
    expect(html).toContain('Temperature (Parameter)');
    expect(html).toContain('p (unknown)');
  });
});
