import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useQueryValidation } from './useQueryValidation';
import type { QueryValidationState } from '../contexts/QueryValidationContext';
import type { QueryIssue } from '../query/types';
import { apiDocsParams } from '../query/declared';
import { buildOperationIndex, matchOperation } from '../validation/openapi/operationIndex';
import params from '../query/__fixtures__/meteocore-maps-params.json';

const MAP = 'https://meteocore.app.meteo.fi/collections/ecmwf-aifs-single/map';
const index = buildOperationIndex({ url: 'https://meteocore.app.meteo.fi/api', doc: params.api as unknown as Record<string, unknown> });
const operation = matchOperation(index, MAP)!.entry;
const around = vi.hoisted(() => ({
  validation: null as QueryValidationState | null,
  requestUrl: '',
  collectionUrl: '',
  conformsTo: null as string[] | null,
  docs: 'ready',
}));
vi.mock('../contexts/QueryValidationContext', () => ({ useQueryValidationContext: () => ({ queryValidation: around.validation }) }));
vi.mock('../contexts/CollectionContext', () => ({ useCollection: () => ({ collectionUrl: around.collectionUrl }) }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl }) }));
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: around.conformsTo }) }));
vi.mock('../contexts/OpenApiContext', () => ({ useOpenApi: () => ({ status: around.docs }) }));

// As if the API docs required parameter-name
const missing: QueryIssue = { id: 'openapi:parameter-name:required', severity: 'missing', source: 'openapi', field: 'parameter-name', message: 'Choose one' };
const apiOperation = { template: '/collections/ecmwf-aifs-single/map', pointer: '/paths/~1collections~1ecmwf-aifs-single~1map/get', required: [], params: apiDocsParams(operation.params) };

beforeEach(() => {
  around.validation = { url: `${MAP}?parameter-name=2t`, issues: [], apiOperation, declaring: { query: 'map', parameterNames: true } };
  around.collectionUrl = `${MAP}?parameter-name=2t`;
  around.requestUrl = `${MAP}?parameter-name=2t&transparent=false&foo=bar&elevation=850`;
  around.conformsTo = params.conformsTo;
  around.docs = 'ready';
});

function Probe() {
  const { active, issues, summary } = useQueryValidation();
  return <pre>{JSON.stringify({ active, fields: issues.map(issue => `${issue.severity} ${issue.field}`), warning: summary.warning })}</pre>;
}
const read = () => JSON.parse(renderToStaticMarkup(<Probe />).slice('<pre>'.length, -'</pre>'.length).replace(/&quot;/g, '"'));

describe('useQueryValidation', () => {
  it('warns of each parameter of a map’s request line nobody declares, typed ones included, and counts it', () => {
    // transparent by the background class, elevation by the API docs, foo by nobody
    expect(read()).toEqual({ active: true, fields: ['warning foo'], warning: 1 });
  });

  it('says nothing of it while the API docs are read, without the conformance, or for another query', () => {
    around.docs = 'loading';
    expect(read().fields).toEqual([]);
    around.docs = 'ready';
    around.conformsTo = null;
    expect(read().fields).toEqual([]);
    around.conformsTo = params.conformsTo;
    around.validation = { ...around.validation!, declaring: null };
    expect(read().fields).toEqual([]);
  });

  it('without API docs, goes by the classes and the draft alone', () => {
    around.validation = { ...around.validation!, apiOperation: null };
    // elevation is MeteoCore's own, which only its API docs name
    expect(read().fields).toEqual(['warning foo', 'warning elevation']);
    around.validation = { ...around.validation!, declaring: { query: 'map', parameterNames: false } };
    expect(read().fields).toEqual(['warning parameter-name', 'warning foo', 'warning elevation']);
  });

  it('keeps the form’s own issues, in order of severity, and drops what the line has', () => {
    around.validation = { ...around.validation!, issues: [missing] };
    around.requestUrl = `${MAP}?foo=bar`;
    expect(read().fields).toEqual(['missing parameter-name', 'warning foo']);
    around.requestUrl = `${MAP}?foo=bar&parameter-name=2t`;
    expect(read().fields).toEqual(['warning foo']);
  });

  it('is nothing for a request the form didn’t build', () => {
    around.collectionUrl = 'https://meteocore.app.meteo.fi/collections/other/map';
    expect(read()).toEqual({ active: false, fields: [], warning: 0 });
  });
});
