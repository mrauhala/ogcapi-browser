import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import QueryTypeRow from './QueryTypeRow';
import { words } from '../coverage/cellsTestData';

const around = vi.hoisted(() => ({ requestUrl: '', apiUrl: '' }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl }) }));
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ apiUrl: around.apiUrl }) }));

beforeEach(() => {
  around.apiUrl = 'https://meteocore.app.meteo.fi/edr/';
  around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/ecmwf-ifs-pressure/position?coords=POINT(24.94%2060.17)';
});

const QUERIES = ['position', 'radius', 'instances'];
const render = (value: string, extra: { showPath?: boolean; offers?: string[]; id?: string; title?: string } = {}) => renderToStaticMarkup(
  <QueryTypeRow queries={QUERIES} value={value} onChange={() => {}} {...extra} />,
);
// The path line, as shown: the text after the toggles
const path = (html: string) => words(html).split(' instances ')[1];

describe('QueryTypeRow', () => {
  it('is the query field: a part of the path, its names as toggles, none picked to start', () => {
    const html = render('');
    expect(html).toContain('id="query-field-query"');
    expect(words(html)).toBe('Query query (path) 3 offered · choose one position radius instances');
    expect(html.split('aria-pressed="true"').length - 1).toBe(0);
  });

  it('says what the collection has while no query is picked, and not once one is', () => {
    const offers = ['13 parameters in `parameter_names`', 'Formats: `CoverageJSON`'];
    expect(words(render('', { offers }))).toContain('Choose a query. Its parameters come from what the collection says it has: 13 parameters in parameter_names Formats: CoverageJSON');
    expect(words(render('position', { offers }))).not.toContain('Choose a query');
  });

  it('shows the path from the API’s root, the root’s own path left off', () => {
    const html = render('position');
    expect(words(html)).toContain('3 offered position');
    expect(path(html)).toBe('/collections/ecmwf-ifs-pressure/position');
    expect(html.split('aria-pressed="true"').length - 1).toBe(1);
  });

  it('shows an instance’s id in the path as it is sent', () => {
    around.requestUrl = 'https://meteocore.app.meteo.fi/edr/collections/ecmwf-ifs-pressure/instances/2026-11-09T06:00:00Z/position';
    expect(path(render('instances'))).toBe('/collections/ecmwf-ifs-pressure/instances/2026-11-09T06:00:00Z/position');
  });

  it('shows the whole path for an API at the host’s root, and from /collections for a request outside the API', () => {
    around.apiUrl = 'https://opendata.fmi.fi/';
    around.requestUrl = 'https://opendata.fmi.fi/collections/ecmwf/position';
    expect(path(render('position'))).toBe('/collections/ecmwf/position');
    around.apiUrl = 'https://opendata.fmi.fi/edr';
    around.requestUrl = 'https://elsewhere.example/v2/collections/ecmwf/position';
    expect(path(render('position'))).toBe('/collections/ecmwf/position');
    around.apiUrl = 'https://opendata.fmi.fi/edr/';
    around.requestUrl = 'https://opendata.fmi.fi/edr/conformance';
    expect(path(render('position'))).toBe('/conformance');
    around.apiUrl = 'not a URL';
    around.requestUrl = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';
    expect(path(render('position'))).toBe('/collections/ecmwf/position');
    around.requestUrl = 'https://opendata.fmi.fi/edr/conformance';
    expect(path(render('position'))).toBe('/edr/conformance');
    around.requestUrl = 'not a URL';
    expect(path(render('position'))).toBeUndefined();
  });

  it('leaves the path to a row below that shows it, as the query on an instance does', () => {
    expect(path(render('instances', { showPath: false }))).toBeUndefined();
    const instance = render('position', { id: 'instance-query', title: 'Query on the instance' });
    expect(instance).toContain('id="query-field-instance-query"');
    expect(words(instance).startsWith('Query on the instance query (path) 3 offered')).toBe(true);
  });
});
