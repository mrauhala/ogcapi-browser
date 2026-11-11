import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PointerText from './PointerText';

const render = (path: string, after?: string) => renderToStaticMarkup(<PointerText path={path} after={after ? <i>{after}</i> : undefined} />);
// Where it may break: a <wbr> at each, as | here
const breaks = (html: string) => html.replace(/<style[^>]*>.*?<\/style>/g, '').replace(/<wbr\/>/g, '|').replace(/<[^>]+>/g, '');

describe('PointerText', () => {
  it('may break after each /, and after each ~1, a / in a name', () => {
    expect(breaks(render('/paths/~1processes~1pywcmp-wis2-wcmp2-kpi~1execution/post/responses/200')))
      .toBe('/|paths/|~1|processes~1|pywcmp-wis2-wcmp2-kpi~1|execution/|post/|responses/|200');
    expect(breaks(render('/collections/0/extent'))).toBe('/|collections/|0/|extent');
  });

  it('shows the pointer as it is', () => {
    const path = '/paths/~1items/get/parameters/0';
    expect(render(path).replace(/<[^>]+>/g, '')).toBe(path);
    expect(render('root')).toBe('root');
    expect(render('')).toBe('');
  });

  it('keeps what comes after it on the line of its last character', () => {
    const html = render('/links/0/href', 'icon');
    expect(breaks(html)).toBe('/|links/|0/|hreficon');
    expect(html).toMatch(/hre(?:<style[^>]*>[^<]*<\/style>)?<span[^>]*>f<i>icon<\/i><\/span>$/);
    expect(html).toContain('white-space:nowrap');
  });
});
