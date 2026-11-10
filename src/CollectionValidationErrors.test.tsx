import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CollectionValidationErrors from './CollectionValidationErrors';
import { EDR12 } from './standards';

vi.mock('./contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: ['https://www.opengis.net/spec/ogcapi-edr-1/1.2/conf/core'] }) }));

describe('CollectionValidationErrors', () => {
  it('cites the requirement its schema checks in the title of each error that has one', () => {
    const html = renderToStaticMarkup(
      <CollectionValidationErrors collectionId="one" errors={[
        { message: "/collections/0: must have required property 'extent'", path: '/collections/0', keyword: 'required', rule: EDR12.collectionsSuccessB },
        { message: '/collections/0/links: must be array', path: '/collections/0/links', keyword: 'type' },
      ]} />,
    );
    expect(html.split('>EDR 1.2 /req/collections/rc-md-success B, test B.10</a>').length - 1).toBe(1);
    expect(html.indexOf('>EDR 1.2 /req/collections/rc-md-success B')).toBeLessThan(html.indexOf('must have required property'));
    expect(html).toContain('href="https://docs.ogc.org/is/19-086r9/19-086r9.html#_4e79031f-31fa-fb3e-90d0-fc813f1b7631"');
  });
});
