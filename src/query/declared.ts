// Who declares a request's parameters, so that a developer can tell whether to blame the form or the server: a
// conformance class the API declares, a profile being drafted that the collection's metadata follows, or the API docs'
// operation for the request's path. Pure. A map query's parameters use it, and an items query's can.
import type { QueryIssue } from './types';
import type { ResolvedParam } from '../validation/openapi/operationIndex';
import { COMMON1 } from '../standards';

export type Declarer =
  | { kind: 'class'; name: string; uri: string } // a conformance class the API declares: its name, as the URI ends, and the URI
  | { kind: 'profile'; name: string; href: string; note: string } // a draft: where it's being written, and that nothing rests on it
  | { kind: 'api-docs'; pointer: string }; // the API docs' operation lists it: the parameter in the document

// A query parameter of the API docs' operation, as the form uses it
export interface ApiDocsParam {
  name: string;
  isArray: boolean; // its schema takes several values
  enumValues: string[] | null;
  defaultValue: string | null; // the schema's default, what the server does unasked
  pointer: string;
}

// The operation's query parameters, as the API docs give them
export function apiDocsParams(params: readonly ResolvedParam[]): ApiDocsParam[] {
  return params.filter(param => param.in === 'query').map(param => {
    const given = param.schema?.default;
    return {
      name: param.name,
      isArray: param.isArray,
      enumValues: param.enumValues,
      defaultValue: typeof given === 'string' || typeof given === 'number' || typeof given === 'boolean' ? String(given) : null,
      pointer: param.pointer,
    };
  });
}

// The classes of a standard an API declares, by name, with the URI as declared. A class is matched by its path, so the
// http URIs OGC-NA names and the https ones the standards print are the same
export function declaredClasses(conformsTo: readonly string[] | null | undefined, confPath: string): Map<string, string> {
  const classes = new Map<string, string>();
  for (const uri of conformsTo ?? []) {
    const at = uri.indexOf(confPath);
    if (at < 0) continue;
    const name = uri.slice(at + confPath.length).replace(/\/+$/, '');
    if (name && !name.includes('/')) classes.set(name, uri);
  }
  return classes;
}

// What a request's parameters are checked against
export interface Offer {
  standard: string; // the standard whose classes are read, as said: Maps
  classesOf: Readonly<Record<string, readonly string[]>>; // each parameter's classes in that standard
  classes: Map<string, string> | null; // those the API declares; null where its conformance isn't known
  profile: { declarer: Extract<Declarer, { kind: 'profile' }>; names: readonly string[] } | null;
  apiDocs: ApiDocsParam[] | null; // the API docs' operation for the request; null where there's none to read
}

// Who declares a parameter, in the order the field's head shows them: the classes, the profile, the API docs
export function declarersOf(name: string, offer: Offer): Declarer[] {
  const classes = (offer.classesOf[name] ?? [])
    .filter(each => offer.classes?.has(each))
    .map((each): Declarer => ({ kind: 'class', name: each, uri: offer.classes!.get(each)! }));
  const profile = offer.profile?.names.includes(name) ? [offer.profile.declarer] : [];
  const docs = offer.apiDocs?.find(param => param.name === name);
  return [...classes, ...profile, ...(docs ? [{ kind: 'api-docs' as const, pointer: docs.pointer }] : [])];
}

// The request's parameters nobody declares, each a warning on its own field: a misspelt name or one the server doesn't
// take. Common: "The server SHALL return a response with the status code 400 IF the request URI includes a query
// parameter that is not specified in the API definition", unless it "MAY display tolerance", so that's cited where the
// API docs were read. Where the API's conformance isn't known, nothing can be said
export function undeclaredIssues(names: readonly string[], offer: Offer, docsPointer?: string): QueryIssue[] {
  if (!offer.classes) return [];
  const docs = offer.apiDocs !== null;
  return [...new Set(names)].filter(name => name && declarersOf(name, offer).length === 0).map(name => ({
    id: `${docs ? 'openapi' : 'metadata'}:${name}:undeclared`,
    severity: 'warning' as const,
    source: docs ? 'openapi' as const : 'metadata' as const,
    field: name,
    message: `Not declared: no ${offer.standard} class the API declares${docs ? ", and not the API docs' operation," : ''} names ${name}`
      + (docs ? ". Expect a 400, unless the server ignores parameters it doesn't know" : ''),
    ...(docs ? { rule: COMMON1.unknownParameter, ...(docsPointer ? { pointer: docsPointer } : {}) } : {}),
  }));
}
