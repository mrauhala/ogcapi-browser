import type { ValidationError } from '../types/api';
import { COVJSON, EDR, EDR12 } from '../standards';

// What the Content-Type says of a CoverageJSON response, against CoverageJSON 10: "The CoverageJSON media type SHALL be
// application/vnd.cov+json with an optional parameter profile". Its one profile, standalone, says every domain and
// range is in the document, not at a URL. EDR's media type is its /req/covjson/definition A: "200-responses of the
// server SHALL support the following media types: application/prs.coverage+json [1.2: application/vnd.cov+json] for
// resources that include data content". EDR 1.2's /req/covjson/content A still names application/prs.coverage+json

const COVJSON_TYPE = 'application/vnd.cov+json';
// CoverageJSON's before OGC, and what EDR 1.1 asks for
const EDR_1_1_TYPE = 'application/prs.coverage+json';
const STANDALONE = 'https://covjson.org/def/core#standalone';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const pointerPart = (text: string) => text.replace(/~/g, '~0').replace(/\//g, '~1');

// The media type, in lower case, and its profile's URIs. A profile's value is quoted, as its URIs hold special characters
export function readContentType(header: string): { type: string; profiles: string[] } {
  const [type, ...parameters] = header.split(';');
  const profile = parameters.map(each => each.trim()).find(each => /^profile\s*=/i.test(each));
  const value = profile?.replace(/^profile\s*=\s*/i, '').replace(/^"(.*)"$/, '$1') ?? '';
  return { type: type.trim().toLowerCase(), profiles: value.split(/\s+/).filter(Boolean) };
}

// The first domain or range given by URL, and what it is
function firstAtUrl(json: unknown): { path: string; what: string } | null {
  if (!isObject(json)) return null;
  const collection = json.type === 'CoverageCollection' && Array.isArray(json.coverages);
  const coverages: unknown[] = collection ? json.coverages as unknown[] : [json];
  for (const [index, coverage] of coverages.entries()) {
    if (!isObject(coverage)) continue;
    const at = collection ? `/coverages/${index}` : '';
    const of = collection ? ` of coverage ${index + 1}` : '';
    if (typeof coverage.domain === 'string') return { path: `${at}/domain`, what: `the domain${of}` };
    const range = isObject(coverage.ranges) ? Object.entries(coverage.ranges).find(([, each]) => typeof each === 'string') : undefined;
    if (range) return { path: `${at}/ranges/${pointerPart(range[0])}`, what: `${range[0]}'s range${of}` };
  }
  return null;
}

export function mediaTypeFindings(contentType: string, json: unknown): ValidationError[] {
  const { type, profiles } = readContentType(contentType);
  const findings: ValidationError[] = [];
  if (type === COVJSON_TYPE) {
    // EDR 1.1's /definition names the other type, so the pass cites only 1.2's
    findings.push({ severity: 'pass', message: `Content-Type is ${COVJSON_TYPE}`, rule: [COVJSON.mediaType, { edr: { '1.2': EDR12.covjsonDefinition } }] });
  } else if (type === EDR_1_1_TYPE) {
    findings.push({
      // Where the standards differ: CoverageJSON, EDR's /definition, and 1.2's /content A, which still names this type
      severity: 'info', rule: [COVJSON.mediaType, EDR.covjsonDefinition, { edr: { '1.2': EDR12.covjsonContentA } }],
      message: `Content-Type is ${EDR_1_1_TYPE}. That's EDR 1.1's, and CoverageJSON's before OGC. CoverageJSON 1.0 and EDR 1.2 have ${COVJSON_TYPE}, so the standards differ`,
    });
  } else {
    const sent = type ? `Content-Type is ${type}` : 'The response has no Content-Type';
    findings.push({ severity: 'warning', message: `${sent}. CoverageJSON's is ${COVJSON_TYPE}`, rule: [COVJSON.mediaType, EDR.covjsonDefinition] });
  }
  if (profiles.includes(STANDALONE)) {
    const atUrl = firstAtUrl(json);
    findings.push(atUrl
      ? { severity: 'error', message: `The profile says every domain and range is in the response, but ${atUrl.what} is at a URL`, path: atUrl.path, rule: COVJSON.standalone }
      : { severity: 'pass', message: 'Every domain and range is in the response, as its profile says', rule: COVJSON.standalone });
  }
  return findings;
}
