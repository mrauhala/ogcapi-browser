import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ParamField, { type ParamFieldProps } from './ParamField';
import { withClass, words } from '../coverage/cellsTestData';
import type { QueryIssue } from '../query/types';
import { EDR, FEATURES1 } from '../standards';

// An API declaring EDR 1.2, whose rules the fields cite
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: ['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core'], apiUrl: 'https://a.example/edr' }) }));

const render = (props: Partial<ParamFieldProps> = {}) => renderToStaticMarkup(
  <ParamField id="f" title="Output format" name="f" {...props}><input id="the-control" /></ParamField>,
);
const issue = (severity: QueryIssue['severity'], message: string, source: QueryIssue['source'] = 'edr'): QueryIssue => ({
  id: `${source}:f:${severity}`, severity, source, field: 'f', message, pointer: '/paths/x',
});
const count = (html: string, text: string) => html.split(text).length - 1;
// The CSS written for the element a text is in: the last style block before it
const styleBefore = (html: string, text: string) => {
  const at = html.indexOf(text);
  const from = html.lastIndexOf('<style', at);
  return html.slice(from, html.indexOf('</style>', from));
};

describe('ParamField', () => {
  it('is a block with its id, a plain title, the name as sent, and its control', () => {
    const html = render();
    expect(html).toContain('id="query-field-f"');
    expect(words(html)).toBe('Output format f');
    expect(html).toContain('id="the-control"');
  });

  it('says a path’s part is one, and what the metadata says and whether it’s required, at the right', () => {
    expect(words(render({ title: 'Location', name: 'location', path: 'path', figure: '308 listed', requirement: 'optional' })))
      .toBe('Location location (path) 308 listed · optional');
    expect(words(render({ requirement: 'required by the API docs' }))).toBe('Output format f required by the API docs');
    expect(words(render({ figure: 'hPa' }))).toBe('Output format f hPa');
  });

  it('turns the requirement orange while a required value is missing', () => {
    const orange = '#ed6c02';
    expect(styleBefore(render({ requirement: 'required', missing: true }), '>required<')).toContain(orange);
    expect(styleBefore(render({ requirement: 'required' }), '>required<')).not.toContain(orange);
  });

  it('shows hints with code, a reference link, and what the server does while it’s left out', () => {
    const html = render({ hints: ['Marked default: the query\'s `default_output_format`'], link: { label: 'reference', href: 'https://example.org/eps.pdf' }, leftOut: "the server's default", empty: true });
    expect(words(html)).toBe("Output format f Marked default: the query's default_output_format reference ↗ Left out: the server's default");
    expect(html).toContain('<code');
    expect(html).toContain('href="https://example.org/eps.pdf"');
    expect(html).toContain('target="_blank"');
    expect(words(render({ leftOut: "the server's default", empty: false }))).toBe('Output format f');
  });

  it('lists its issues, with a way into the API docs on theirs', () => {
    const html = render({ issues: [issue('missing', 'Pick a format'), issue('error', 'Not offered', 'openapi')], openDocs: () => {} });
    expect(words(html)).toBe('Output format f Pick a format Not offered API docs');
    expect(withClass(html, 'MuiChip-root')).toBe(1);
    expect(count(words(render({ issues: [issue('info', 'A note')] })), 'API docs')).toBe(0);
  });

  // As Checks cites them: in the version the API declares, 1.2 here
  it('cites the rule an issue rests on after it, and nothing for one that rests on none', () => {
    const html = render({ issues: [{ ...issue('error', 'Output format "NetCDF" isn\'t offered for this query'), rule: EDR.fResponseB }, issue('warning', 'Looks wrong')] });
    expect(words(html)).toBe('Output format f Output format "NetCDF" isn\'t offered for this query EDR 1.2 /req/edr/REQ_rc-f-response B, test B.59 Looks wrong');
    expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_8458c6b5-9cd2-a890-a6e0-a8646eeddb04"');
    expect(count(html, 'target="_blank"')).toBe(1);
  });

  // Why a field is there, as a Time on items is, with the rules it rests on: EDR's in the version the API declares
  it('cites the rules a hint rests on after it', () => {
    const html = render({ hints: [
      { text: "EDR's items query takes the parameters of Features, whose servers SHALL support `datetime`", rule: [EDR.itemsParameters, FEATURES1.timeDefinition] },
      'From Jan 1 1850 00:00 to open UTC',
    ] });
    expect(words(html)).toBe("Output format f EDR's items query takes the parameters of Features, whose servers SHALL support datetime "
      + 'EDR 1.2 8.2.7 Features 1 /req/core/fc-time-definition A From Jan 1 1850 00:00 to open UTC');
    expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_3c2581c9-194c-a22c-1898-4f2e87035833"');
    expect(html).toContain('href="https://docs.ogc.org/is/17-069r4/17-069r4.html#req_core_fc-time-definition"');
    expect(count(html, 'target="_blank"')).toBe(2);
  });

  it('tags who declared it at the right: a class in blue, a draft linking where it’s written, the API docs in orange', () => {
    const html = render({
      requirement: 'optional',
      declaredBy: [
        { kind: 'class', name: 'styled-map', uri: 'http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/styled-map' },
        { kind: 'profile', name: 'A draft', href: 'https://example.org/draft', note: 'Being written' },
        { kind: 'api-docs', pointer: '/paths/x' },
      ],
    });
    expect(words(html)).toBe('Output format f optional styled-map A draft API docs');
    expect(html).toContain('MuiChip-colorPrimary');
    expect(html).toContain('MuiChip-colorWarning');
    expect(html).toContain('href="https://example.org/draft"');
    expect(html).toContain('target="_blank"');
    // Its tooltips name the class's URI and the draft's note
    expect(html).toContain('aria-label="The API declares the conformance class http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/styled-map"');
    expect(html).toContain('aria-label="Being written"');
    expect(html).toContain('aria-label="The API docs&#x27; operation for this request lists it"');
    expect(words(render({ declaredBy: [{ kind: 'api-docs', pointer: '/paths/x' }] }))).toBe('Output format f API docs');
  });
});
