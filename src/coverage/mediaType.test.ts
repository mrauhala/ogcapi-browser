import { describe, expect, it } from 'vitest';
import { mediaTypeFindings, readContentType } from './mediaType';
import { COVJSON, EDR, EDR12 } from '../standards';

const STANDALONE = 'https://covjson.org/def/core#standalone';
const COVERAGE = { type: 'Coverage', domain: { type: 'Domain', axes: {} }, ranges: { t: { type: 'NdArray', values: [1] } } };
const severities = (contentType: string, json: unknown = COVERAGE) => mediaTypeFindings(contentType, json).map(each => each.severity);

describe('readContentType', () => {
  it('reads the media type in lower case, without its parameters', () => {
    expect(readContentType('application/vnd.cov+json')).toEqual({ type: 'application/vnd.cov+json', profiles: [] });
    expect(readContentType(' Application/VND.cov+JSON ; charset=utf-8')).toEqual({ type: 'application/vnd.cov+json', profiles: [] });
    expect(readContentType('')).toEqual({ type: '', profiles: [] });
  });

  it('reads the profile’s URIs, quoted or not, among other parameters', () => {
    expect(readContentType(`application/vnd.cov+json; profile="${STANDALONE}"`).profiles).toEqual([STANDALONE]);
    expect(readContentType(`application/vnd.cov+json;charset=utf-8; PROFILE = "https://example.org/a  ${STANDALONE}"`).profiles).toEqual(['https://example.org/a', STANDALONE]);
    expect(readContentType(`application/vnd.cov+json; profile=${STANDALONE}`).profiles).toEqual([STANDALONE]);
    expect(readContentType('application/vnd.cov+json; profile=""').profiles).toEqual([]);
  });
});

describe('mediaTypeFindings', () => {
  it('passes CoverageJSON’s own media type, whatever its case or parameters, citing section 10 and only EDR 1.2’s /req/covjson/definition', () => {
    expect(mediaTypeFindings('application/vnd.cov+json', COVERAGE)).toEqual([{
      severity: 'pass', message: 'Content-Type is application/vnd.cov+json', rule: [COVJSON.mediaType, { edr: { '1.2': EDR12.covjsonDefinition } }],
    }]);
    expect(severities('application/VND.COV+JSON; charset=utf-8')).toEqual(['pass']);
  });

  it('notes EDR 1.1’s, where the standards differ, citing CoverageJSON, EDR’s /req/covjson/definition and 1.2’s /req/covjson/content A', () => {
    expect(mediaTypeFindings('application/prs.coverage+json', COVERAGE)).toEqual([{
      severity: 'info',
      message: 'Content-Type is application/prs.coverage+json. That\'s EDR 1.1\'s, and CoverageJSON\'s before OGC. CoverageJSON 1.0 and EDR 1.2 have application/vnd.cov+json, so the standards differ',
      rule: [COVJSON.mediaType, EDR.covjsonDefinition, { edr: { '1.2': EDR12.covjsonContentA } }],
    }]);
  });

  it('makes an issue of any other, or of none', () => {
    expect(mediaTypeFindings('application/json', COVERAGE)).toEqual([{ severity: 'warning', message: 'Content-Type is application/json. CoverageJSON\'s is application/vnd.cov+json', rule: [COVJSON.mediaType, EDR.covjsonDefinition] }]);
    expect(mediaTypeFindings('Text/Plain; charset=utf-8', COVERAGE)[0].message).toBe('Content-Type is text/plain. CoverageJSON\'s is application/vnd.cov+json');
    expect(mediaTypeFindings('', COVERAGE)).toEqual([{ severity: 'warning', message: 'The response has no Content-Type. CoverageJSON\'s is application/vnd.cov+json', rule: [COVJSON.mediaType, EDR.covjsonDefinition] }]);
    expect(severities('application/covjson')).toEqual(['warning']);
  });

  it('passes the standalone profile where every domain and range is in the response', () => {
    expect(mediaTypeFindings(`application/vnd.cov+json; profile="${STANDALONE}"`, COVERAGE)[1]).toEqual({ severity: 'pass', message: 'Every domain and range is in the response, as its profile says', rule: COVJSON.standalone });
    expect(severities(`application/json; profile="${STANDALONE}"`)).toEqual(['warning', 'pass']);
  });

  it('makes an error of a domain or a range at a URL under the standalone profile, at the first', () => {
    const type = `application/vnd.cov+json; profile="${STANDALONE}"`;
    expect(mediaTypeFindings(type, { ...COVERAGE, domain: 'https://example.org/domain' })[1]).toEqual({
      severity: 'error', message: 'The profile says every domain and range is in the response, but the domain is at a URL', path: '/domain', rule: COVJSON.standalone,
    });
    expect(mediaTypeFindings(type, { ...COVERAGE, ranges: { a: { type: 'NdArray' }, 'b/c': 'https://example.org/b' } })[1]).toMatchObject({
      message: 'The profile says every domain and range is in the response, but b/c\'s range is at a URL', path: '/ranges/b~1c',
    });
    const collection = { type: 'CoverageCollection', coverages: [COVERAGE, null, { ...COVERAGE, ranges: { t: 'https://example.org/t' } }, { ...COVERAGE, domain: 'https://example.org/d' }] };
    expect(mediaTypeFindings(type, collection)[1]).toMatchObject({ message: 'The profile says every domain and range is in the response, but t\'s range of coverage 3 is at a URL', path: '/coverages/2/ranges/t' });
    expect(mediaTypeFindings(type, { type: 'CoverageCollection', coverages: [{ ...COVERAGE, domain: 'https://example.org/d' }] })[1]).toMatchObject({ message: 'The profile says every domain and range is in the response, but the domain of coverage 1 is at a URL', path: '/coverages/0/domain' });
  });

  it('says nothing of URLs without that profile', () => {
    expect(severities('application/vnd.cov+json', { ...COVERAGE, domain: 'https://example.org/domain' })).toEqual(['pass']);
    expect(severities('application/vnd.cov+json; profile="https://example.org/other"', { ...COVERAGE, domain: 'https://example.org/domain' })).toEqual(['pass']);
  });

  it('reads what isn’t a coverage as having nothing at a URL', () => {
    const type = `application/vnd.cov+json; profile="${STANDALONE}"`;
    for (const json of [null, [], 'x', { type: 'CoverageCollection', coverages: 'x' }]) expect(severities(type, json)).toEqual(['pass', 'pass']);
  });
});
