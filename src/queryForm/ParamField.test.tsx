import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ParamField, { type ParamFieldProps } from './ParamField';
import { withClass, words } from '../coverage/cellsTestData';
import type { QueryIssue } from '../query/types';

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
});
