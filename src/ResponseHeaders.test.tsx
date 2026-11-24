import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResponseHeaders from './ResponseHeaders';
import { words } from './coverage/cellsTestData';

describe('ResponseHeaders', () => {
  it('lists each header with its value, in the given order', () => {
    const html = renderToStaticMarkup(
      <ResponseHeaders headers={[{ name: 'cache-control', value: 'max-age=60' }, { name: 'content-type', value: 'application/json' }]} />,
    );
    const cells = (tag: string) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map(([, cell]) => cell);
    expect(cells('dt')).toEqual(['cache-control', 'content-type']);
    expect(cells('dd')).toEqual(['max-age=60', 'application/json']);
  });

  it('sets the names apart in the colour of the URL\'s parameter names', () => {
    const html = renderToStaticMarkup(<ResponseHeaders headers={[{ name: 'etag', value: 'x' }]} />);
    const name = html.match(/<dt[^>]*>/)?.[0].match(/css-[A-Za-z0-9-]+/)?.[0];
    expect(html).toMatch(new RegExp(`\\.${name}\\{[^}]*color:#1976d2`));
  });

  it('says the browser may hide some headers', () => {
    const html = renderToStaticMarkup(<ResponseHeaders headers={[]} />);
    expect(html).toContain('Access-Control-Expose-Headers');
  });

  it('shows the Accept the request was sent with, which the request line can’t, apart from the response’s', () => {
    const html = renderToStaticMarkup(<ResponseHeaders headers={[{ name: 'content-type', value: 'image/png' }]} accept="image/jpeg" />);
    expect(words(html)).toContain('Request accept image/jpeg Response content-type image/png');
    expect(words(html)).toContain("Request shows the Accept the app sent, which the request line can't");
    // The app's own, for any format
    expect(words(renderToStaticMarkup(<ResponseHeaders headers={[]} accept="*/*" />))).toContain('Request accept */* Response');
  });

  it('has no request part for a response the app fetched by itself, whose Accept it didn’t set', () => {
    const html = renderToStaticMarkup(<ResponseHeaders headers={[{ name: 'content-type', value: 'application/json' }]} />);
    expect(html).not.toContain('>Request<');
    expect(html).not.toContain('>Response<');
    expect(html).not.toContain('accept');
    expect(words(html)).not.toContain('Request shows');
  });
});
