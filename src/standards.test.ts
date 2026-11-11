import { describe, expect, it } from 'vitest';
import * as standards from './standards';
import { citedEdrOf, citedRules, citesEdr, collectionInfoLetter, COVJSON, detectEdrVersion, EDR, EDR11, EDR12, edrVersionNote } from './standards';
import type { Rule } from './types/api';
import anchors from './__fixtures__/standardAnchors.json';
import statements from './__fixtures__/standardStatements.json';

// The ids each standard's saved text has, of those standards.ts links to, written by
// tasks/browser-checks/extract-standard-anchors.py from the HTML (and the draft profile's lines)
const ANCHORS: Record<string, string[]> = anchors;
// What EDR's text says each cited statement is, by its link: the id of its requirement and the letter before it
const STATEMENTS: Record<string, string> = statements;

// The documents whose HTML has ids only on whole requirements, not on their statements: the Features parts
const BY_REQUIREMENT = ['https://docs.ogc.org/is/17-069r4/17-069r4.html', 'https://docs.ogc.org/is/18-058r1/18-058r1.html', 'https://docs.ogc.org/is/19-079r2/19-079r2.html'];

const isRule = (value: unknown): value is Rule => typeof value === 'object' && value !== null && 'url' in value && 'label' in value;

// Every rule standards.ts exports, by where it is
const everyRule: [string, Rule][] = Object.entries(standards).flatMap(([group, value]) =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, rule]): [string, Rule][] => {
      if (isRule(rule)) return [[`${group}.${key}`, rule]];
      const sides = typeof rule === 'object' && rule !== null && 'edr' in rule ? Object.entries((rule as { edr: Record<string, Rule> }).edr) : [];
      return sides.filter(([, side]) => side).map(([version, side]) => [`${group}.${key} (${version})`, side]);
    })
    : []);

const core = (version: string) => `http://www.opengis.net/spec/ogcapi-edr-1/${version}/conf/core`;

describe('the rules cited', () => {
  it('are all looked at', () => {
    // 26 CoverageJSON, 51 EDR 1.1, 53 EDR 1.2, 6 Common, 3 Features, OpenAPI, BCP 47 and 2 of the draft profile, and
    // EDR's pairs on top
    expect(everyRule.length).toBeGreaterThan(143);
  });

  it('each link to a statement its standard has', () => {
    const lost = everyRule.filter(([, rule]) => {
      const [document, anchor] = rule.url.split('#');
      return !anchor || !(ANCHORS[document] ?? []).includes(anchor);
    }).map(([where, rule]) => `${where}: ${rule.url}`);
    expect(lost).toEqual([]);
  });

  // Each rule is its own statement: two linking to one paragraph means one of them points at another rule's words. EDR's
  // pairs reuse their versions' rules, which are the same objects. The Features parts give ids only to whole
  // requirements, so their statements share a link and are told apart by the letter in their labels
  it('each link to a statement of their own', () => {
    const byUrl = new Map<string, Set<string>>();
    const seen = new Set<Rule>();
    for (const [where, rule] of everyRule) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      const statement = BY_REQUIREMENT.some(document => rule.url.startsWith(`${document}#`)) ? `${rule.url} ${rule.label}` : rule.url;
      byUrl.set(statement, (byUrl.get(statement) ?? new Set()).add(where));
    }
    expect([...byUrl].filter(([, wheres]) => wheres.size > 1).map(([url, wheres]) => `${url}: ${[...wheres].join(', ')}`)).toEqual([]);
  });

  it('name the requirement and the statement the text has at their link', () => {
    const edr = everyRule.filter(([, rule]) => rule.requirement);
    // Every EDR requirement cited, 1.1's and 1.2's, less the recommendation and the annex, and Records', Maps' and
    // Common Part 2's, whose statements have ids of their own too
    expect(edr.length).toBeGreaterThanOrEqual(100);
    for (const document of ['https://docs.ogc.org/is/20-004r1/', 'https://docs.ogc.org/is/20-058/', 'https://docs.ogc.org/DRAFTS/20-024']) {
      expect(edr.some(([, rule]) => rule.url.startsWith(document)), document).toBe(true);
    }
    const wrong = edr.filter(([, rule]) => STATEMENTS[rule.url] !== `${rule.requirement}${rule.statement ? ` ${rule.statement}` : ''}`)
      .map(([where, rule]) => `${where}: ${rule.requirement} ${rule.statement} is ${STATEMENTS[rule.url]} in the text`);
    expect(wrong).toEqual([]);
    // And the label says the same
    for (const [where, rule] of edr) expect(rule.label.includes(`${rule.requirement} ${rule.statement}`), where).toBe(true);
  });

  it('name the EDR version they link into', () => {
    for (const [where, rule] of everyRule) {
      if (rule.url.startsWith('https://docs.ogc.org/is/19-086r6/')) expect(rule.label.startsWith('EDR 1.1 '), where).toBe(true);
      if (rule.url.startsWith('https://docs.ogc.org/is/19-086r9/')) expect(rule.label.startsWith('EDR 1.2 '), where).toBe(true);
    }
  });

  // Features, Records and Maps by their part, and a draft as one, as Checks shows each beside the finding
  it('name the standard and part they link into, and a draft as a draft', () => {
    const NAMES: [string, string][] = [
      ['https://docs.ogc.org/is/17-069r4/', 'Features 1 '],
      ['https://docs.ogc.org/is/18-058r1/', 'Features 2 '],
      ['https://docs.ogc.org/is/19-079r2/', 'Features 3 '],
      ['https://docs.ogc.org/is/20-004r1/', 'Records 1 '],
      ['https://docs.ogc.org/is/20-058/', 'Maps 1 '],
      ['https://docs.ogc.org/DRAFTS/20-024', 'Common 2 (draft) '],
    ];
    for (const [document, name] of NAMES) {
      const rules = everyRule.filter(([, rule]) => rule.url.startsWith(document));
      expect(rules.length, document).toBeGreaterThan(0);
      for (const [where, rule] of rules) expect(rule.label.startsWith(name), where).toBe(true);
    }
    // A Features rule names its statement's letter where the requirement has more than one, as its link can't
    for (const [where, rule] of everyRule.filter(([, each]) => each.url.startsWith('https://docs.ogc.org/is/17-069r4/'))) {
      expect(rule.label, where).toMatch(/^Features 1 \/(req|rec)\/[\w/-]+(?: [A-Z]|, its notes)$/);
    }
  });

  it('pair each EDR rule with 1.1 and 1.2 sides from the right versions', () => {
    for (const [key, pair] of Object.entries(EDR)) {
      if (pair.edr['1.1']) expect(Object.values(EDR11), key).toContain(pair.edr['1.1']);
      if (pair.edr['1.2']) expect(Object.values(EDR12), key).toContain(pair.edr['1.2']);
      expect(pair.edr['1.1'] ?? pair.edr['1.2'], key).toBeDefined();
    }
  });

  it('cite the media type by /req/covjson/definition, not /content', () => {
    expect(EDR11.covjsonDefinition.label).toBe('EDR 1.1 /req/covjson/definition A, test B.31');
    expect(EDR12.covjsonDefinition.label).toBe('EDR 1.2 /req/covjson/definition A, test B.33');
    expect(EDR.covjsonDefinition.edr).toEqual({ '1.1': EDR11.covjsonDefinition, '1.2': EDR12.covjsonDefinition });
  });
});

describe('detectEdrVersion', () => {
  it('picks the newest EDR version declared', () => {
    expect(detectEdrVersion([core('1.0'), core('1.1')])).toBe('1.1');
    expect(detectEdrVersion([core('1.2')])).toBe('1.2');
    // 1.2's classes are https
    expect(detectEdrVersion(['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core', core('1.1')])).toBe('1.2');
  });

  it('finds none for a service that is not EDR, or that declares no core', () => {
    expect(detectEdrVersion(['http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core'])).toBeNull();
    expect(detectEdrVersion(['http://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/position'])).toBeNull();
    expect(detectEdrVersion(null)).toBeNull();
    expect(detectEdrVersion(undefined)).toBeNull();
  });
});

describe('citedEdrOf', () => {
  it('cites EDR 1.2 for an API declaring it, and 1.1 for any other', () => {
    expect(citedEdrOf([core('1.1'), core('1.2')])).toEqual({ version: '1.2', declared: '1.2' });
    expect(citedEdrOf([core('1.1')])).toEqual({ version: '1.1', declared: '1.1' });
    expect(citedEdrOf([core('1.0')])).toEqual({ version: '1.1', declared: '1.0' });
    expect(citedEdrOf([])).toEqual({ version: '1.1', declared: null });
    expect(citedEdrOf(null)).toEqual({ version: '1.1', declared: null });
  });
});

describe('edrVersionNote', () => {
  it('says nothing where the version cited is the one declared', () => {
    expect(edrVersionNote({ version: '1.2', declared: '1.2' })).toBeNull();
    expect(edrVersionNote({ version: '1.1', declared: '1.1' })).toBeNull();
  });

  it('says which version is cited where the API declares none, or one whose text isn’t cited', () => {
    expect(edrVersionNote({ version: '1.1', declared: null })).toBe('The API declares no EDR version; cited against EDR 1.1');
    expect(edrVersionNote({ version: '1.1', declared: '1.0' })).toBe('The API declares EDR 1.0; cited against EDR 1.1');
  });

  it('says so of a response from an API other than the one loaded', () => {
    expect(edrVersionNote({ version: '1.1', declared: null, elsewhere: true })).toBe("This response isn't from the API that's loaded, so its EDR version isn't known; cited against EDR 1.1");
  });
});

describe('collectionInfoLetter', () => {
  it('is the letter of the rc-collection-info statement cited, in the version asked for', () => {
    expect(collectionInfoLetter(EDR.collectionCrs, '1.1')).toBe('G');
    expect(collectionInfoLetter(EDR.collectionCrs, '1.2')).toBe('H');
    expect(collectionInfoLetter(EDR.collectionParameterNames, '1.2')).toBe('L');
  });

  it('is none where the version cites no statement of it', () => {
    // 1.1 names no data_queries there: its rule is the schema's
    expect(collectionInfoLetter(EDR.collectionDataQueries, '1.1')).toBeNull();
    expect(collectionInfoLetter(EDR.collectionDataQueries, '1.2')).toBe('G');
    expect(collectionInfoLetter(EDR.extent, '1.2')).toBeNull();
    expect(collectionInfoLetter(undefined, '1.2')).toBeNull();
  });
});

describe('citedRules', () => {
  it('cites a rule, or each of a list, as it is', () => {
    expect(citedRules(COVJSON.mediaType, '1.1')).toEqual([COVJSON.mediaType]);
    expect(citedRules([COVJSON.mediaType, COVJSON.standalone], '1.2')).toEqual([COVJSON.mediaType, COVJSON.standalone]);
    expect(citedRules(undefined, '1.2')).toEqual([]);
  });

  it('cites an EDR rule in the version asked for, and nothing where that version has none', () => {
    expect(citedRules(EDR.covjsonDefinition, '1.1')).toEqual([EDR11.covjsonDefinition]);
    expect(citedRules(EDR.covjsonDefinition, '1.2')).toEqual([EDR12.covjsonDefinition]);
    expect(citedRules([COVJSON.mediaType, EDR.covjsonDefinition, { edr: { '1.2': EDR12.covjsonContentA } }], '1.1')).toEqual([COVJSON.mediaType, EDR11.covjsonDefinition]);
    expect(citedRules([COVJSON.mediaType, EDR.covjsonDefinition, { edr: { '1.2': EDR12.covjsonContentA } }], '1.2')).toEqual([COVJSON.mediaType, EDR12.covjsonDefinition, EDR12.covjsonContentA]);
    expect(citedRules(EDR.cubeZ, '1.2')).toEqual([]);
  });

  it('tells EDR’s rules from the others', () => {
    expect(citesEdr([COVJSON.mediaType])).toBe(false);
    expect(citesEdr([COVJSON.mediaType, EDR11.extent])).toBe(true);
    expect(citesEdr([EDR12.extent])).toBe(true);
    expect(citesEdr([])).toBe(false);
  });
});
