import type { QueryIssue } from '../../query/types';
import { COMMON1, OAS } from '../../standards';
import { matchOperation, type OperationIndex, type OperationMatch, type ResolvedParam } from './operationIndex';

// A request URL checked against the API definition. The issues name the parameter as their field
// and point into the document; they're issues at most: no standard asks a request to fit the docs, and
// Common Part 1 asks no API definition to list "every possible query parameter" or "every possible
// value". What the docs leave out or contradict is something clients of the docs need.
export interface ApiDocsCheck {
  operation: OperationMatch | null;
  issues: QueryIssue[];
}

const MAX_LISTED = 5;

const listed = (values: string[]) =>
  values.slice(0, MAX_LISTED).join(', ') + (values.length > MAX_LISTED ? ` +${values.length - MAX_LISTED} more` : '');

const isNumber = (value: string) => value.trim() !== '' && isFinite(Number(value));

// Allowed as written, allowed in another letter case (which server may reject), or not allowed.
// Numbers compare by value: a level of 850.0 is the enum's 850.
function enumMatch(value: string, allowed: string[]): 'allowed' | 'not-allowed' | { caseOf: string } {
  if (allowed.includes(value)) return 'allowed';
  if (isNumber(value) && allowed.some(option => isNumber(option) && Number(option) === Number(value))) return 'allowed';
  const caseOf = allowed.find(option => option.toLowerCase() === value.toLowerCase());
  return caseOf ? { caseOf } : 'not-allowed';
}

// The values sent for a parameter: every repeat of the key, with comma lists split when the
// parameter is an array, or when only the items are in the enum (parameter-name=a,b typed string)
function sentValues(param: ResolvedParam, raw: string[]): string[] {
  return raw.flatMap(value => {
    const split = value.includes(',') && (param.isArray || enumMatch(value, param.enumValues ?? []) === 'not-allowed');
    return split ? value.split(',').map(part => part.trim()).filter(Boolean) : [value];
  });
}

// An object parameter with exploded properties (style form) accepts keys the document doesn't name
const acceptsAnyKey = (params: ResolvedParam[]) =>
  params.some(param => param.in === 'query' && param.schema?.type === 'object');

// Check a request URL against the GET operation the API definition gives for it
export function checkQueryUrlAgainstOpenApi(url: string, index: OperationIndex): ApiDocsCheck {
  const issues: QueryIssue[] = [];
  const add = (severity: 'warning' | 'info', field: string, key: string, message: string, pointer: string, rule?: QueryIssue['rule']) =>
    issues.push({ id: `openapi:${field}:${key}`, severity, source: 'openapi', field, message, pointer, ...(rule ? { rule } : {}) });

  let search: URLSearchParams;
  try {
    search = new URL(url).searchParams;
  } catch {
    return { operation: null, issues };
  }
  const operation = matchOperation(index, url);
  if (!operation) {
    add('warning', 'query', 'no-operation', "The API docs don't describe this request", '/paths', COMMON1.notEverything);
    return { operation, issues };
  }
  const { entry, pathParams } = operation;

  for (const param of entry.params) {
    if (param.in === 'path') {
      const value = pathParams[param.name];
      if (value !== undefined && param.enumValues && enumMatch(value, param.enumValues) === 'not-allowed') {
        // What they do list shows when the docs write ids another way than the server's own lists do
        add('warning', `path:${param.name}`, 'enum',
          `The API docs don't list "${value}" for ${param.name} (they list ${listed(param.enumValues)})`, param.pointer, COMMON1.notEverything);
      }
      continue;
    }
    if (param.in !== 'query') continue;

    const raw = search.getAll(param.name);
    if (raw.length === 0) {
      // OpenAPI's required: "Determines whether this parameter is mandatory"
      if (param.required) add('warning', param.name, 'required', `The API docs require ${param.name}, which the query doesn't set`, param.pointer, OAS.parameterRequired);
      continue;
    }
    if (!param.enumValues) continue;
    const notAllowed: string[] = [];
    const otherCase: string[] = [];
    for (const value of sentValues(param, raw)) {
      const match = enumMatch(value, param.enumValues);
      if (match === 'not-allowed') notAllowed.push(value);
      else if (match !== 'allowed') otherCase.push(`${value} as ${match.caseOf}`);
    }
    if (notAllowed.length > 0) {
      add('warning', param.name, 'enum',
        `The API docs don't list ${listed(notAllowed)} for ${param.name} (they list ${listed(param.enumValues)})`, param.pointer, COMMON1.notEverything);
    }
    // "Parameter names and values SHALL be case sensitive": in another case, it's another value, as one not listed
    if (otherCase.length > 0) {
      add('warning', param.name, 'enum-case', `The API docs write ${param.name} ${listed(otherCase)}, and values are case sensitive`, param.pointer, COMMON1.caseSensitive);
    }
  }

  // "The server SHALL return a response with the status code 400 IF the request URI includes a query parameter that is
  // not specified in the API definition", unless it "MAY display tolerance" and ignore it
  if (!acceptsAnyKey(entry.params)) {
    const declared = new Set(entry.params.filter(param => param.in === 'query').map(param => param.name));
    const undeclared = [...new Set(search.keys())].filter(name => !declared.has(name));
    if (undeclared.length > 0) {
      add('warning', 'query', 'undeclared',
        `The API docs don't declare ${listed(undeclared)}: a server answers 400 for ${undeclared.length > 1 ? 'those' : 'that'}, unless it ignores unknown parameters`, entry.pointer, COMMON1.unknownParameter);
    }
  }
  return { operation, issues };
}
