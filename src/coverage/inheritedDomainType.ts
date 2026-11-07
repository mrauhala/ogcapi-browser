// "If a coverage collection object has the member "domainType", then this member is inherited to all included
// coverages", and a coverage in such a collection "SHOULD" leave its own out. The CoverageJSON schema checks a domain
// against its type only by the domain's own domainType, so a response that does as it should has its domains checked
// as nothing in particular: Polytope's MultiPoint, with latitude, longitude and levelist for x, y and z, passes.
// A copy with the type put in is checked as what it is. No DOM.

type Json = Record<string, unknown>;

const isObj = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const inherits = (coverage: unknown) => isObj(coverage) && isObj(coverage.domain) && coverage.domain.domainType === undefined;

// The collection's domainType, if a coverage in it has a domain without one of its own
export function inheritedDomainType(json: unknown): string | null {
  if (!isObj(json) || json.type !== 'CoverageCollection' || typeof json.domainType !== 'string' || !Array.isArray(json.coverages)) return null;
  return json.coverages.some(inherits) ? json.domainType : null;
}

// The response as it's to be read, for checking it: every domain with its type. Only what changes is copied
export function withInheritedDomainType(json: unknown): unknown {
  const type = inheritedDomainType(json);
  if (type === null) return json;
  const collection = json as Json;
  return {
    ...collection,
    coverages: (collection.coverages as unknown[]).map(coverage => (inherits(coverage)
      ? { ...(coverage as Json), domain: { ...((coverage as Json).domain as Json), domainType: type } }
      : coverage)),
  };
}
