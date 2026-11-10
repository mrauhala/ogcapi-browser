import { describe, expect, it } from 'vitest';
import { checkQueryUrlAgainstOpenApi } from './checkQueryUrl';
import { buildOperationIndex } from './operationIndex';
import { parseServiceDescription } from './loadServiceDescription';
import { fixtureCollections, fixtureText, SERVERS, type ServerName } from './__fixtures__/servers';
import { normalizeHref } from '../../utils/href';
import { COMMON1, OAS } from '../../standards';

const DOC = {
  openapi: '3.0.3',
  servers: [{ url: 'https://example.org/edr' }],
  paths: {
    '/collections/{collectionId}/position': {
      parameters: [{ name: 'collectionId', in: 'path', required: true, schema: { type: 'string', enum: ['obs', 'model'] } }],
      get: {
        parameters: [
          { name: 'coords', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'f', in: 'query', schema: { type: 'string', enum: ['CoverageJSON', 'GeoJSON'] } },
          { name: 'parameter-name', in: 'query', schema: { type: 'string', enum: ['t2m', 'ws'] } },
          { name: 'z', in: 'query', schema: { type: 'array', items: { type: 'number', enum: [850, 500] } } },
          { name: 'datetime', in: 'query', schema: { type: 'string' } },
        ],
      },
    },
    '/collections/{collectionId}/items': {
      get: { parameters: [{ name: 'filter', in: 'query', style: 'form', explode: true, schema: { type: 'object' } }] },
    },
  },
};
const INDEX = buildOperationIndex({ url: 'https://example.org/edr/api', doc: DOC });
const POSITION = 'https://example.org/edr/collections/obs/position?coords=POINT(25 60)';

const check = (url: string) => checkQueryUrlAgainstOpenApi(url, INDEX);
const brief = (url: string) => check(url).issues.map(issue => `${issue.severity} ${issue.field}: ${issue.message}`);

describe('checkQueryUrlAgainstOpenApi', () => {
  it('finds nothing to report on a request the document allows', () => {
    const result = check(`${POSITION}&f=CoverageJSON&parameter-name=t2m&z=850&datetime=2026-10-05T12:00:00Z`);
    expect(result.issues).toEqual([]);
    expect(result.operation?.entry).toMatchObject({ template: '/collections/{collectionId}/position', pointer: '/paths/~1collections~1{collectionId}~1position/get' });
  });

  it('warns about required parameters the request leaves out, pointing at their declaration', () => {
    const [issue] = check('https://example.org/edr/collections/obs/position?f=GeoJSON').issues;
    expect(issue).toMatchObject({
      id: 'openapi:coords:required', severity: 'warning', source: 'openapi', field: 'coords',
      message: "The API docs require coords, which the query doesn't set",
      pointer: '/paths/~1collections~1{collectionId}~1position/get/parameters/0',
    });
  });

  // Common Part 1: "Parameter names and values SHALL be case sensitive", so another case is another value, as one not listed
  it('checks values against enums, telling a case difference from a wrong value', () => {
    expect(brief(`${POSITION}&f=CSV`)).toEqual(["warning f: The API docs don't list CSV for f (they list CoverageJSON, GeoJSON)"]);
    expect(brief(`${POSITION}&f=coveragejson`)).toEqual(['warning f: The API docs write f coveragejson as CoverageJSON, and values are case sensitive']);
  });

  it('reads comma lists and repeated keys', () => {
    expect(brief(`${POSITION}&parameter-name=t2m,ws`)).toEqual([]);
    expect(brief(`${POSITION}&parameter-name=t2m,rh`)).toEqual(["warning parameter-name: The API docs don't list rh for parameter-name (they list t2m, ws)"]);
    expect(brief(`${POSITION}&parameter-name=t2m&parameter-name=rh`)).toEqual(["warning parameter-name: The API docs don't list rh for parameter-name (they list t2m, ws)"]);
  });

  it('compares numbers by value and splits array parameters', () => {
    expect(brief(`${POSITION}&z=850.0`)).toEqual([]);
    expect(brief(`${POSITION}&z=850,700`)).toEqual(["warning z: The API docs don't list 700 for z (they list 850, 500)"]);
  });

  it('checks path parameters against their enum, saying what the docs do list', () => {
    expect(brief('https://example.org/edr/collections/radar/position?coords=POINT(25 60)'))
      .toEqual(['warning path:collectionId: The API docs don\'t list "radar" for collectionId (they list obs, model)']);
  });

  // Common Part 1: "The server SHALL return a response with the status code 400 IF the request URI includes a query
  // parameter that is not specified in the API definition", unless it tolerates them
  it('makes one issue of parameters the document does not declare', () => {
    expect(brief(`${POSITION}&foo=1&bar=2&foo=3`)).toEqual(["warning query: The API docs don't declare foo, bar: a server answers 400 for those, unless it ignores unknown parameters"]);
    expect(brief(`${POSITION}&foo=1`)).toEqual(["warning query: The API docs don't declare foo: a server answers 400 for that, unless it ignores unknown parameters"]);
    expect(check(`${POSITION}&foo=1`).issues[0].pointer).toBe('/paths/~1collections~1{collectionId}~1position/get');
    // An exploded object parameter takes any key
    expect(brief('https://example.org/edr/collections/obs/items?foo=1')).toEqual([]);
  });

  it('warns when no operation describes the request', () => {
    const result = check('https://example.org/edr/collections/obs/cube?bbox=1,2,3,4');
    expect(result.operation).toBeNull();
    expect(brief('https://example.org/edr/collections/obs/cube?bbox=1,2,3,4')).toEqual(["warning query: The API docs don't describe this request"]);
  });

  // No standard asks a request to fit the docs, and Common Part 1 asks no API definition to list everything: each is an
  // issue, citing what it rests on
  it('cites the rule each rests on', () => {
    const rules = (url: string) => Object.fromEntries(check(url).issues.map(issue => [issue.id, issue.rule]));
    expect(rules('https://example.org/edr/collections/obs/position?f=GeoJSON')).toEqual({ 'openapi:coords:required': OAS.parameterRequired });
    expect(rules(`${POSITION}&f=CSV`)).toEqual({ 'openapi:f:enum': COMMON1.notEverything });
    expect(rules(`${POSITION}&f=coveragejson`)).toEqual({ 'openapi:f:enum-case': COMMON1.caseSensitive });
    expect(rules(`${POSITION}&foo=1`)).toEqual({ 'openapi:query:undeclared': COMMON1.unknownParameter });
    expect(rules('https://example.org/edr/collections/radar/position?coords=POINT(25 60)')).toEqual({ 'openapi:path:collectionId:enum': COMMON1.notEverything });
    expect(rules('https://example.org/edr/collections/obs/cube?bbox=1,2,3,4')).toEqual({ 'openapi:query:no-operation': COMMON1.notEverything });
  });
});

describe('checkQueryUrlAgainstOpenApi on the real servers', () => {
  async function server(name: ServerName) {
    const { doc } = await parseServiceDescription(fixtureText(SERVERS[name].doc));
    const index = buildOperationIndex({ url: SERVERS[name].docUrl, doc });
    const href = (collectionId: string, query: string) => {
      const collection = fixtureCollections(name).find(c => c.id === collectionId)!;
      return normalizeHref(collection.data_queries[query].link.href)!;
    };
    const brief = (url: string) => checkQueryUrlAgainstOpenApi(url, index).issues.map(issue => `${issue.severity} ${issue.field}`);
    return { href, brief };
  }

  it('FMI: cube requires coords next to bbox; corridor requires its width', async () => {
    const fmi = await server('fmi');
    expect(fmi.brief(`${fmi.href('ecmwf_painepinta', 'cube')}?bbox=20,60,21,61&f=CoverageJSON`)).toEqual(['warning coords']);
    expect(fmi.brief(`${fmi.href('ecmwf', 'corridor')}?coords=LINESTRING(24 60,25 61)&f=CoverageJSON`))
      .toEqual(['warning corridor-width', 'warning width-units']);
    expect(fmi.brief(`${fmi.href('ecmwf', 'position')}?coords=POINT(25 60)&f=CoverageJSON&parameter-name=Temperature`)).toEqual([]);
  });

  it('DWD: f is CoverageJSON only', async () => {
    const dwd = await server('dwd');
    const position = `${dwd.href('ICON-D2-RUC@single_level', 'position')}?coords=POINT(10 50)`;
    expect(dwd.brief(`${position}&f=CoverageJSON&parameter-name=T_2M`)).toEqual([]);
    expect(dwd.brief(`${position}&f=GeoJSON`)).toEqual(['warning f']);
  });

  it('Met Office: parameter-name enum, undeclared datetime, model collections only described per instance', async () => {
    const metoffice = await server('metoffice');
    const position = `${metoffice.href('gpkg-obs', 'position')}?coords=POINT(-2 52)&f=CoverageJSON`;
    expect(metoffice.brief(`${position}&parameter-name=dd,ff`)).toEqual([]);
    expect(metoffice.brief(`${position}&parameter-name=dd,rain`)).toEqual(['warning parameter-name']);
    expect(metoffice.brief(`${position}&datetime=2026-10-05T12:00:00Z`)).toEqual([]);
    expect(metoffice.brief(`${metoffice.href('pop_density', 'position')}?coords=POINT(-2 52)&datetime=2026-10-05T12:00:00Z`))
      .toEqual(['warning query']);
    expect(metoffice.brief(`${metoffice.href('moukv-height-levels', 'position')}?coords=POINT(-2 52)`)).toEqual(['warning query']);
    // ...which the document describes per instance
    const instancePosition = 'https://labs.metoffice.gov.uk/edr/collections/moukv-height-levels/instances/2022070912/position';
    expect(metoffice.brief(`${instancePosition}?coords=POINT(-2 52)&parameter-name=air_temperature`)).not.toContain('warning query');
  });

  it('MET Norway: the collection id is a path enum', async () => {
    const metno = await server('metno');
    const locations = metno.href('taf', 'locations');
    expect(metno.brief(locations)).toEqual([]);
    expect(metno.brief(locations.replace('/taf/', '/metar/'))).toEqual(['warning path:collectionId']);
  });
});
