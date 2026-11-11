import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MoreParams from './MoreParams';
import { fieldSpecs } from '../query/fieldSpecs';
import type { Collection } from '../types/api';
import type { QueryIssue } from '../query/types';
import { words } from '../coverage/cellsTestData';
import fmiEcmwf from '../query/__fixtures__/fmi-ecmwf.json';
import dwdIcon from '../query/__fixtures__/dwd-icon-d2-ruc-single-level.json';

const around = vi.hoisted(() => ({ requestUrl: '', issues: [] as QueryIssue[] }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('../contexts/OpenRequestContext', () => ({ useOpenRequest: () => ({ openRequest: () => {} }) }));
vi.mock('../hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ issues: around.issues, active: true, apiOperation: null }) }));
vi.mock('../contexts/OpenApiContext', () => ({ useOpenApi: () => ({ status: 'none', description: null }) }));

// FMI's ecmwf and DWD's ICON, whose queries list OGC:CRS84 in their crs_details, and the same with a query's taken out
const WITH_CRS = fmiEcmwf as unknown as Collection;
const DWD = dwdIcon as unknown as Collection;
function withoutCrs(collection: Collection, queryKey: string): Collection {
  const query = collection.data_queries[queryKey];
  const { crs_details: _gone, ...variables } = query.link.variables ?? {};
  return { ...collection, data_queries: { ...collection.data_queries, [queryKey]: { link: { ...query.link, variables } } } } as Collection;
}
const BASE = 'https://opendata.fmi.fi/edr/collections/ecmwf/position';

beforeEach(() => {
  around.requestUrl = `${BASE}?coords=POINT(24.94 60.17)&parameter-name=Temperature`;
  around.issues = [];
});

const render = (collection = WITH_CRS, queryKey = 'position', crs = '') => renderToStaticMarkup(
  <MoreParams collection={collection} queryKey={queryKey} specs={fieldSpecs(collection, queryKey, { parameters: 0 })} crs={crs} setCrs={() => {}} />,
);
const header = (html: string) => words(html.slice(0, html.indexOf('</button>')));
// The other parameters' rows: each name and value, from their inputs
const valueOf = (tag: string) => tag.split('value="')[1]?.split('"')[0] ?? null;
function rows(html: string): (string | null)[][] {
  const found = [];
  for (let at = html.indexOf('aria-label="Parameter name"'); at >= 0; at = html.indexOf('aria-label="Parameter name"', at + 1)) {
    const nameEnd = html.indexOf('>', at);
    const valueAt = html.indexOf('<input', nameEnd);
    found.push([valueOf(html.slice(html.lastIndexOf('<input', at), nameEnd)), valueOf(html.slice(valueAt, html.indexOf('>', valueAt)))]);
  }
  return found;
}

describe('MoreParams', () => {
  it('is closed with nothing in it, saying what it holds', () => {
    const html = render();
    expect(header(html)).toBe('More: crs, other parameters');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="query-field-crs"');
    expect(html).not.toContain('id="query-field-other"');
  });

  it('says nothing of crs where the query lists none', () => {
    expect(header(render(withoutCrs(WITH_CRS, 'position')))).toBe('More: other parameters');
  });

  it('opens with a crs chosen, pressed among those the query lists', () => {
    const html = render(WITH_CRS, 'position', 'OGC:CRS84');
    expect(html).toContain('aria-expanded="true"');
    expect(words(html)).toContain("Coordinate system crs 1 listed · optional OGC:CRS84 From the query's crs_details");
    expect(html.split('aria-pressed="true"').length - 1).toBe(1);
    expect(words(html)).not.toContain('Left out');
  });

  it('shows a crs the query doesn’t list, pressed, with what’s wrong with it', () => {
    around.issues = [{ id: 'metadata:crs:offered', severity: 'error', source: 'metadata', field: 'crs', message: "EPSG:3067 isn't in the query's crs_details (OGC:CRS84)", input: 'form' }];
    const html = render(WITH_CRS, 'position', 'EPSG:3067');
    expect(words(html)).toContain("OGC:CRS84 EPSG:3067 From the query's crs_details EPSG:3067 isn't in the query's crs_details (OGC:CRS84)");
  });

  it('opens with the request’s other parameters, as name = value rows, and none the fields hold', () => {
    around.requestUrl = `${BASE}?coords=POINT(24.94 60.17)&foo=bar&parameter-name=Temperature&debug=&f=CoverageJSON`;
    const html = render();
    expect(header(html)).toBe('More: crs, 2 other parameters');
    expect(html).toContain('aria-expanded="true"');
    expect(rows(html)).toEqual([['foo', 'bar'], ['debug', '']]);
    expect(words(html)).toContain('Other parameters sent as typed');
    expect(words(html)).toContain('+ Add a parameter');
    expect(words(html)).not.toContain('Any parameter the request has');
  });

  it('has no crs field where the query lists none, open or not', () => {
    around.requestUrl = `${BASE}?foo=bar`;
    const html = render(withoutCrs(WITH_CRS, 'position'));
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('id="query-field-crs"');
  });

  it('counts one other parameter as one', () => {
    around.requestUrl = `${BASE}?foo=bar`;
    expect(header(render())).toBe('More: crs, 1 other parameter');
  });

  it('takes a crs the query doesn’t list as another parameter, and a cube’s coords as its own', () => {
    around.requestUrl = 'https://a.example/collections/icon/cube?bbox=1,2,3,4&coords=POLYGON((1 2,1 4,3 4,3 2,1 2))&crs=EPSG:4326';
    expect(rows(render(withoutCrs(DWD, 'cube'), 'cube'))).toEqual([['crs', 'EPSG:4326']]);
    expect(rows(render(DWD, 'cube'))).toEqual([]);
  });

  it('shows what’s wrong with another parameter under its row, as that nothing declares it', () => {
    around.requestUrl = `${BASE}?foo=bar&debug=1&foo=again`;
    around.issues = [{ id: 'openapi:foo:undeclared', severity: 'warning', source: 'openapi', field: 'foo', message: 'Not declared: nobody names foo', pointer: '/paths/x' }];
    const html = render();
    expect(rows(html)).toEqual([['foo', 'bar'], ['debug', '1'], ['foo', 'again']]);
    // Once, under the first foo, which jumps there
    expect(html.split('Not declared: nobody names foo').length - 1).toBe(1);
    expect(html.indexOf('Not declared')).toBeLessThan(html.indexOf('value="debug"'));
    expect(html).toContain('id="query-field-foo"');
  });
});
