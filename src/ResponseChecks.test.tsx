import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResponseChecks, { ChecksTabLabel } from './ResponseChecks';
import { findingMessage, findingPath } from './findingText';
import type { ValidationError } from './types/api';
import { COVJSON, EDR, EDR12 } from './standards';

// The loaded API's conformance, which says which EDR version is cited
const api = vi.hoisted(() => ({ conformsTo: null as string[] | null, apiUrl: 'https://a.example/edr/' }));
vi.mock('./contexts/ApiContext', () => ({ useApi: () => api }));
afterEach(() => { api.conformsTo = null; });
const EDR_1_2 = ['http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core', 'https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core'];
const EDR_1_1 = ['http://www.opengis.net/spec/ogcapi-edr-1/1.1/conf/core'];
const UNDECLARED = 'The API declares no EDR version; cited against EDR 1.1';

const render = (props: Partial<ComponentProps<typeof ResponseChecks>>) => renderToStaticMarkup(
  <ResponseChecks schemaName={null} findings={[]} lines={[]} onGoToLine={() => {}} {...props} />,
);

const FINDING: ValidationError = { path: '/ranges/t', message: '/ranges/t: must be number', severity: 'error' };

describe('ResponseChecks', () => {
  it('says so when there was nothing to check against', () => {
    expect(render({})).toContain('No schema applies');
  });

  it('says the schema found nothing', () => {
    const html = render({ schemaName: 'CoverageJSON 1.0' });
    expect(html).toContain('CoverageJSON 1.0 schema: 0 errors');
    expect(html).toContain('aria-label="Passed"');
    expect(html).not.toContain('No schema applies');
  });

  it('says what the coverages were checked as, when they inherit the collection’s domainType', () => {
    // On the schema's own line, under what it found
    expect(render({ schemaName: 'CoverageJSON 1.0', checkedAs: 'MultiPoint' })).toMatch(/schema: 0 errors<(?:(?!<li).)*>Each coverage checked as a MultiPoint, the collection&#x27;s domainType, which it inherits<\/span><\/div><\/li>/);
    expect(render({ schemaName: 'CoverageJSON 1.0' })).not.toContain('checked as');
    expect(render({ checkedAs: 'MultiPoint', findings: [FINDING] })).not.toContain('checked as');
  });

  it('lists a finding with where it is, without repeating that in the message', () => {
    const html = render({ schemaName: 'CoverageJSON 1.0', findings: [FINDING] });
    expect(html).toContain('>/ranges/t</span>must be number');
    expect(html).toContain('CoverageJSON 1.0 schema: 1 error');
    expect(html).not.toContain('aria-label="Passed"');
  });

  it("leaves just the colon out of a finding at the root, which has no path in its message", () => {
    const html = render({ findings: [{ path: 'root', message: ': must match', severity: 'error' }] });
    expect(html).toContain('>root</span>must match');
  });

  it('keeps a message that does not start with its path whole', () => {
    expect(render({ findings: [{ path: '/a', message: 'odd: really', severity: 'info' }] })).toContain('>/a</span>odd: really');
  });

  // As the locations validator groups them: one per kind, with the first feature's path for its line
  it('shows a finding grouped over an array’s items once, at the path they share', () => {
    const grouped: ValidationError = { path: '/features/0/properties', message: "/features/*/properties: must have required property 'label' (10 of 10 features)", severity: 'error' };
    const html = render({ schemaName: 'EDR 1.0 Locations', findings: [grouped] });
    expect(html).toContain(">/features/*/properties</span>must have required property &#x27;label&#x27; (10 of 10 features)");
    expect(html.split('/features/0/properties').length - 1).toBe(0);
    expect(findingPath(grouped)).toBe('/features/*/properties');
    expect(findingMessage(grouped)).toBe("must have required property 'label' (10 of 10 features)");
  });

  it('keeps its own path for a finding whose message starts with another', () => {
    const elsewhere: ValidationError = { path: '/features/0/properties', message: '/features/*/geometry: must be object', severity: 'error' };
    expect(findingPath(elsewhere)).toBe('/features/0/properties');
    expect(findingMessage(elsewhere)).toBe('/features/*/geometry: must be object');
    // An item's place has to be an index for a * to stand for it
    expect(findingPath({ path: '/features/a/properties', message: '/features/*/properties: x' })).toBe('/features/a/properties');
    expect(findingPath({ path: '/features/0', message: '/features/*/properties: x' })).toBe('/features/0');
    expect(findingPath({ path: '/features/0/properties', message: 'no path here' })).toBe('/features/0/properties');
    expect(findingPath(FINDING)).toBe('/ranges/t');
    expect(findingPath({ message: '/features/*/properties: x' })).toBeUndefined();
  });

  it('links a finding to its line in Raw', () => {
    const html = render({ findings: [FINDING], lines: [{ line: 234, errors: [FINDING] }] });
    expect(html).toMatch(/<button[^>]*>line 234<\/button>/);
  });

  it('names no schema when it was not told one', () => {
    const html = render({ findings: [FINDING] });
    expect(html).not.toContain('schema:');
    expect(html).toContain('must be number');
  });

  it('has no link for a finding not on a line', () => {
    expect(render({ findings: [FINDING] })).not.toContain('line ');
  });

  it.each([['error', 'Error'], ['warning', 'Issue'], ['info', 'Note']] as const)('marks a finding as a %s', (severity, label) => {
    expect(render({ findings: [{ ...FINDING, severity }] })).toContain(`aria-label="${label}"`);
  });

  it('counts a finding without a severity as an error', () => {
    expect(render({ findings: [{ message: 'bad' }] })).toContain('aria-label="Error"');
  });

  it('says what the worst finding was on the schema\'s line', () => {
    const html = render({ schemaName: 'CoverageJSON 1.0', findings: [{ ...FINDING, severity: 'info' }, { ...FINDING, severity: 'info' }] });
    expect(html).toContain('CoverageJSON 1.0 schema: 2 notes');
  });

  describe('the format beyond its schema', () => {
    const PRS = { message: 'Content-Type is application/prs.coverage+json', severity: 'info' as const, rule: [COVJSON.mediaType, EDR.covjsonDefinition, { edr: { '1.2': EDR12.covjsonContentA } }] };
    const STANDALONE = { message: 'The profile says every domain and range is in the response, but t’s range is at a URL', severity: 'error' as const, line: 40, rule: COVJSON.standalone };

    it('says the media type under the format, after the schema line and before the schema’s findings, with its rules', () => {
      const html = render({ schemaName: 'CoverageJSON 1.0', findings: [FINDING], formatNotes: [PRS] });
      const at = (text: string) => html.indexOf(text);
      expect(at('schema: 1 error')).toBeGreaterThan(at('>The format<'));
      expect(at('Content-Type is application/prs.coverage+json')).toBeGreaterThan(at('schema: 1 error'));
      expect(at('>/ranges/t</span>')).toBeGreaterThan(at('Content-Type is'));
      expect(html).toContain('>CoverageJSON 10</a>');
      // The media type is /req/covjson/definition's, in the version the API declares: none here, so 1.1
      expect(html).toContain('href="https://docs.ogc.org/is/19-086r6/19-086r6.html#_da8d1d16-17c3-6009-f1e9-d07ea6096a7e"');
      expect(html).toContain('>EDR 1.1 /req/covjson/definition A, test B.31</a>');
      expect(html).not.toContain('/req/covjson/content');
      // Not under the data, which has nothing here
      expect(html).not.toContain('>The data<');
    });

    it('puts the worst first, and gives each its line', () => {
      const html = render({ schemaName: 'CoverageJSON 1.0', formatNotes: [PRS, STANDALONE] });
      expect(html.indexOf('The profile says')).toBeLessThan(html.indexOf('Content-Type is'));
      expect(html).toMatch(/<button[^>]*>line 40<\/button>/);
      expect(html.split('<button').length - 1).toBe(1);
    });

    it('is the format’s heading alone, and not "No schema applies"', () => {
      const html = render({ formatNotes: [PRS] });
      expect(html).toContain('>The format<');
      expect(html).toContain('Content-Type is application/prs.coverage+json');
      expect(html).not.toContain('No schema applies');
      expect(html).not.toContain('schema:');
    });

    it('puts the data’s heading apart from it', () => {
      const html = render({ formatNotes: [PRS], dataNotes: [{ message: 'a note', line: 2 }] });
      expect(html.indexOf('>The data<')).toBeGreaterThan(html.indexOf('Content-Type is'));
    });
  });

  describe('the data', () => {
    const NOTE = { message: '1 null in t2m, at Nov 5 00:00', line: 234 };

    it('lists what is worth knowing, with its line', () => {
      const html = render({ schemaName: 'CoverageJSON 1.0', dataNotes: [NOTE, { message: 'Time step changes', line: 97 }] });
      expect(html).toContain('>The format<');
      expect(html).toContain('>The data<');
      expect(html).toContain('1 null in t2m, at Nov 5 00:00');
      expect(html).toMatch(/<button[^>]*>line 234<\/button>/);
      expect(html).toMatch(/<button[^>]*>line 97<\/button>/);
      expect(html).toContain('aria-label="Note"');
    });

    it('cites the rule a finding rests on, linked to its section, apart from the words', () => {
      const html = render({ dataNotes: [{ message: 'Levels aren’t in order: 500, 1000, 850', line: 49, severity: 'error', rule: COVJSON.monotonic }, { message: 'a note', line: 2 }] });
      expect(html).toContain('href="https://docs.ogc.org/cs/21-069r2/21-069r2.html#_1284a2fe-77c6-4f27-072d-271dc4ab8263"');
      expect(html).toContain('>CoverageJSON 9.6.1.1</a>');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      // A space between them, so that it's read and copied as two
      expect(html).toMatch(/850 (<style[^>]*>[^<]*<\/style>)*<a /);
      // Only the finding with a rule has a link
      expect(html.split('href="https://docs.ogc.org/').length - 1).toBe(1);
    });

    it('cites two rules where two standards differ, each a link of its own after a space', () => {
      const html = render({ dataNotes: [{ message: 't’s unit type is https://www.opengis.net/def/uom/UCUM/', line: 9, severity: 'info', rule: [COVJSON.unit, EDR12.parameterUnit] }] });
      expect(html).toContain('>CoverageJSON 9.3</a>');
      expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_5047a43b-0afc-3b92-6bab-228999e4d7ae"');
      expect(html).toContain('>EDR 1.2 /req/edr/rc-parameters G, test B.26</a>');
      expect(html.split('href="https://docs.ogc.org/').length - 1).toBe(2);
      expect(html.split('target="_blank"').length - 1).toBe(2);
      // Read and copied as words apart: a space before each
      expect(html).toMatch(/UCUM\/ (<style[^>]*>[^<]*<\/style>)*<a [^>]*>CoverageJSON 9\.3<\/a> (<style[^>]*>[^<]*<\/style>)*<a /);
    });

    it('stands alone with no schema', () => {
      const html = render({ dataNotes: [NOTE] });
      expect(html).toContain('>The data<');
      expect(html).not.toContain('>The format<');
      expect(html).not.toContain('No schema applies');
    });

    it('has no heading with nothing to say', () => {
      expect(render({ schemaName: 'CoverageJSON 1.0' })).not.toContain('>The data<');
    });

    it('puts what rests on the collection under it, with no line where the response has nothing to show', () => {
      const html = render({
        collectionId: 'ecmwf_painepinta',
        dataNotes: [
          { message: "The collection's vrs gives z's unit: hPa", severity: 'pass', source: 'collection' },
          { message: "z 4.8 isn't among the levels in the collection's extent", line: 45, severity: 'warning', source: 'collection' },
          { message: "z's unit, hPa, is only in a description", line: 44, severity: 'warning' },
        ],
      });
      const data = html.indexOf('>The data<');
      const collection = html.indexOf('>Against the collection: ecmwf_painepinta<');
      expect(data).toBeGreaterThan(-1);
      expect(collection).toBeGreaterThan(data);
      // As it's written in HTML
      const at = (text: string) => html.indexOf(text.replace(/'/g, '&#x27;'));
      expect(at("z's unit, hPa, is only in a description")).toBeGreaterThan(data);
      expect(at("z's unit, hPa, is only in a description")).toBeLessThan(collection);
      expect(at("The collection's vrs gives z's unit: hPa")).toBeGreaterThan(collection);
      expect(html.match(/>line \d+</g)).toEqual(['>line 44<', '>line 45<']);
    });

    it('has no heading for the collection with nothing against it, and no name without one', () => {
      expect(render({ dataNotes: [{ message: 'a', line: 1 }] })).not.toContain('Against the collection');
      expect(render({ dataNotes: [{ message: 'a', line: 1, source: 'collection' }] })).toContain('>Against the collection<');
    });

    it('shows each finding as what it is, the worst first and what passed last', () => {
      const html = render({
        dataNotes: [
          { message: 'passed', line: 1, severity: 'pass' },
          { message: 'noted', line: 2, severity: 'info' },
          { message: 'an issue', line: 3, severity: 'warning' },
          { message: 'broken', line: 4, severity: 'error' },
          { message: 'noted too', line: 5 },
        ],
      });
      const order = ['broken', 'an issue', 'noted', 'noted too', 'passed'].map(message => html.indexOf(`>${message}<`));
      expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
      const icons = [...html.matchAll(/aria-label="(Error|Issue|Note|Passed)"/g)].map(match => match[1]);
      expect(icons).toEqual(['Error', 'Issue', 'Note', 'Note', 'Passed']);
    });
  });

  describe('the rules', () => {
    const SCHEMA_RULE = [COVJSON.conformance, EDR.covjsonContentB];

    it('cites the schema’s rule on its line, and not again on each finding that rests on it', () => {
      const html = render({ schemaName: 'CoverageJSON 1.0', schemaRule: SCHEMA_RULE, findings: [{ ...FINDING, rule: SCHEMA_RULE }, { ...FINDING, path: '/a', message: '/a: must be string', rule: SCHEMA_RULE }] });
      expect(html.split('>CoverageJSON 2</a>').length - 1).toBe(1);
      expect(html.split('>EDR 1.1 /req/covjson/content B, test B.32</a>').length - 1).toBe(1);
      expect(html.indexOf('>CoverageJSON 2</a>')).toBeGreaterThan(html.indexOf('schema: 2 errors'));
      expect(html.indexOf('>CoverageJSON 2</a>')).toBeLessThan(html.indexOf('>/ranges/t</span>'));
      // Passing too
      expect(render({ schemaName: 'CoverageJSON 1.0', schemaRule: SCHEMA_RULE })).toContain('>CoverageJSON 2</a>');
    });

    it('cites a schema finding’s own rule beside it', () => {
      const html = render({ schemaName: 'CoverageJSON 1.0', schemaRule: SCHEMA_RULE, findings: [{ path: 'root', message: 'Failed to parse response as JSON', rule: EDR.covjsonContentA }] });
      const words = html.indexOf('Failed to parse response as JSON');
      expect(html.indexOf('>EDR 1.1 /req/covjson/content A, test B.32</a>')).toBeGreaterThan(words);
    });

    it('cites EDR in the version the API declares, and says nothing of it then', () => {
      api.conformsTo = EDR_1_2;
      const html = render({ schemaName: 'CoverageJSON 1.0', schemaRule: SCHEMA_RULE, dataNotes: [{ message: 'outside', line: 3, severity: 'error', rule: EDR.datetimeResponse }] });
      expect(html).toContain('>EDR 1.2 /req/covjson/content B, test B.34</a>');
      expect(html).toContain('>EDR 1.2 /req/core/datetime-response A, test B.53</a>');
      expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_fab3a148-185f-b720-f07c-2b384ea2ba73"');
      expect(html).not.toContain('EDR 1.1');
      expect(html).not.toContain('The API declares');
      api.conformsTo = EDR_1_1;
      const older = render({ dataNotes: [{ message: 'outside', line: 3, severity: 'error', rule: EDR.datetimeResponse }] });
      expect(older).toContain('>EDR 1.1 /req/core/datetime-response A</a>');
      expect(older).not.toContain('The API declares');
    });

    it('says once, above the findings, that an API declaring no EDR version is cited against 1.1', () => {
      const html = render({
        schemaName: 'CoverageJSON 1.0', schemaRule: SCHEMA_RULE,
        dataNotes: [{ message: 'outside', line: 3, severity: 'error', rule: EDR.datetimeResponse }, { message: 'outside the extent', line: 4, severity: 'warning', source: 'collection', rule: EDR.extent }],
      });
      expect(html.split(UNDECLARED).length - 1).toBe(1);
      expect(html.indexOf(UNDECLARED)).toBeLessThan(html.indexOf('>The format<'));
      expect(html).toContain('>EDR 1.1 /req/core/datetime-response A</a>');
    });

    it('cites the loaded API’s version only for a response of that API, and says so of one from elsewhere', () => {
      api.conformsTo = EDR_1_2;
      const notes = [{ message: 'outside', line: 3, severity: 'error' as const, rule: EDR.datetimeResponse }];
      const own = render({ dataNotes: notes, url: 'https://a.example/edr/collections/c/position?coords=POINT(1 2)' });
      expect(own).toContain('>EDR 1.2 /req/core/datetime-response A, test B.53</a>');
      expect(own).not.toContain('The API declares');
      const other = render({ dataNotes: notes, schemaName: 'CoverageJSON 1.0', schemaRule: [COVJSON.conformance, EDR.covjsonContentB], url: 'http://localhost:5193/saved.json' });
      expect(other).toContain('>EDR 1.1 /req/core/datetime-response A</a>');
      expect(other).toContain('>EDR 1.1 /req/covjson/content B, test B.32</a>');
      expect(other).not.toContain('EDR 1.2');
      expect(other.split("This response isn&#x27;t from the API that&#x27;s loaded, so its EDR version isn&#x27;t known; cited against EDR 1.1").length - 1).toBe(1);
    });

    it('says nothing of EDR’s version where nothing cites EDR', () => {
      const html = render({ dataNotes: [{ message: 'Levels aren’t in order', line: 4, severity: 'error', rule: COVJSON.monotonic }] });
      expect(html).not.toContain('The API declares');
      // Nor where EDR's rule has nothing in the version cited
      expect(render({ dataNotes: [{ message: 'a', line: 1, rule: { edr: { '1.2': EDR12.zIgnored } } }] })).not.toContain('The API declares');
    });
  });

  it('keeps a long list short', () => {
    const findings = Array.from({ length: 103 }, (_, i) => ({ message: `finding ${i}` }));
    const html = render({ findings });
    expect(html).toContain('finding 99');
    expect(html).not.toContain('finding 100');
    expect(html).toContain('And 3 more');
  });
});

describe('ChecksTabLabel', () => {
  it('is just the name with no findings', () => {
    expect(renderToStaticMarkup(<ChecksTabLabel findings={[]} />)).toBe('<span>Checks</span>');
  });

  it('adds the count, coloured by how bad it is', () => {
    const colour = (severity: 'error' | 'warning' | 'info') => {
      const html = renderToStaticMarkup(<ChecksTabLabel findings={[{ severity }]} />);
      const name = html.match(/css-[A-Za-z0-9-]+/)?.[0];
      return html.match(new RegExp(`\\.${name}\\{[^}]*[^-]color:([^;}]+)`))?.[1];
    };
    expect(renderToStaticMarkup(<ChecksTabLabel findings={[{ severity: 'error' }, { severity: 'info' }]} />)).toContain('>1 error<');
    expect(new Set([colour('error'), colour('warning'), colour('info')]).size).toBe(3);
  });
});
