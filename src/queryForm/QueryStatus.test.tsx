import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import QueryStatus from './QueryStatus';
import { words } from '../coverage/cellsTestData';
import type { QueryIssue } from '../query/types';
import { EDR } from '../standards';

const state = vi.hoisted(() => ({
  active: true,
  issues: [] as QueryIssue[],
  apiOperation: null as { template: string; pointer: string; required: string[] } | null,
  status: 'none' as string,
  description: null as unknown,
}));
vi.mock('../hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ active: state.active, issues: state.issues, apiOperation: state.apiOperation }) }));
vi.mock('../contexts/OpenApiContext', () => ({ useOpenApi: () => ({ status: state.status, description: state.description }) }));
// No EDR version declared, so a rule is cited in 1.1
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: null, apiUrl: 'https://a.example/edr' }) }));

beforeEach(() => {
  state.active = true;
  state.issues = [];
  state.apiOperation = null;
  state.status = 'none';
  state.description = null;
});

const issue = (severity: QueryIssue['severity'], field: string, message = `about ${field}`): QueryIssue => ({ id: `edr:${field}:${severity}:${message}`, severity, source: 'edr', field, message });
const SHOWN = new Set(['query', 'coords', 'within', 'within-units', 'f', 'z', 'dim:member', 'instance-query']);
const render = (shown = SHOWN) => words(renderToStaticMarkup(<QueryStatus shown={shown} />));

describe('QueryStatus', () => {
  it('says nothing while no query is picked', () => {
    state.active = false;
    state.issues = [issue('missing', 'coords')];
    expect(render()).toBe('');
  });

  it('names what’s missing, each name once', () => {
    state.issues = [issue('missing', 'within'), issue('missing', 'within-units'), issue('missing', 'within', 'again')];
    expect(render()).toBe('Missing: within , within-units');
  });

  // The classes by the names Checks gives them: an error, an issue, a note
  it('counts the errors and the issues, by name, and says nothing is missing only when nothing is missing or wrong', () => {
    state.issues = [issue('error', 'f'), issue('error', 'z'), issue('warning', 'coords')];
    expect(render()).toBe('2 errors: f , z 1 issue: coords');
    state.issues = [issue('error', 'f')];
    expect(render()).toBe('1 error: f');
    state.issues = [issue('warning', 'coords'), issue('warning', 'z')];
    expect(render()).toBe('2 issues: coords , z ✓ Nothing missing');
    state.issues = [issue('info', 'coords')];
    expect(render()).toBe('✓ Nothing missing');
  });

  it('names a dimension by its id, and the query on an instance as query', () => {
    state.issues = [issue('missing', 'instance-query'), issue('error', 'dim:member')];
    expect(render()).toBe('Missing: query 1 error: member');
  });

  it('names a map’s level and model run by their axes in subset', () => {
    state.issues = [issue('warning', 'subset:vertical'), issue('warning', 'subset:reference_time'), issue('error', 'subset')];
    expect(render(new Set(['subset', 'subset:vertical', 'subset:reference_time']))).toBe('1 error: subset 2 issues: vertical , reference_time');
  });

  it('says whether the API docs are being read, or were checked against', () => {
    state.status = 'loading';
    expect(render()).toBe('✓ Nothing missing Reading the API docs…');
    state.status = 'ready';
    state.description = { paths: {} };
    state.apiOperation = { template: '/collections/{collectionId}/position', pointer: '/paths/x', required: [] };
    expect(render()).toBe('✓ Nothing missing Checked against the API docs');
    // Without the docs to open, no link to them
    state.description = null;
    expect(render()).toBe('✓ Nothing missing');
  });

  it('says under the line what has no field of its own', () => {
    state.issues = [
      issue('missing', 'coords'),
      { ...issue('info', 'corridor-height'), message: 'EDR asks for a corridor height, but this collection has no vertical levels' },
    ];
    expect(render()).toBe('Missing: coords EDR asks for a corridor height, but this collection has no vertical levels');
    expect(render(new Set([...SHOWN, 'corridor-height']))).toBe('Missing: coords');
  });

  it('cites the rule each one under the line rests on, as Checks does', () => {
    state.issues = [{ ...issue('error', 'corridor-height', 'EDR requires a corridor height'), rule: EDR.corridorHeight }];
    const html = renderToStaticMarkup(<QueryStatus shown={SHOWN} />);
    expect(words(html)).toBe('1 error: corridor-height EDR requires a corridor height EDR 1.1 /req/edr/rc-corridor H');
    expect(html).toContain('href="https://docs.ogc.org/is/19-086r6/19-086r6.html#_fdcd499d-7441-c077-6504-0257462bd7c8"');
  });
});
