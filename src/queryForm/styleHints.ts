// What a map query's style field says: where its styles were read, and what the style picked is and adds
import type { MapStylesState } from '../hooks/useMapStyles';
import { linkQuery, type MapStyle } from '../query/mapQuery';

const code = (text: string) => `\`${text}\``;

// A link's path from its styles on, with what it asks for: …/styles/contours/map?parameter-name=gh
function shortLink(href: string): string {
  try {
    const url = new URL(href);
    const at = url.pathname.lastIndexOf('/styles/');
    return `…${at < 0 ? url.pathname : url.pathname.slice(at)}${url.search}`;
  } catch {
    return href;
  }
}

// Where the styles were read, and what the one picked is: its title, its own map link and what that adds to the request
// byLink: the request is the style's own link, as when it's picked, rather than the path, as from a typed URL
// held: what the form's fields hold of what a link may add, as parameter-name: a value chosen there is sent instead
export function styleHints(state: MapStylesState, picked: MapStyle | undefined, styleId: string, byLink = true, held: Record<string, string> = {}): string[] {
  const hints: string[] = [];
  if (state.source === 'link') hints.push(`From the collection's ${code('styles')} link`);
  else if (state.source === 'collection') {
    hints.push(state.status === 'error'
      ? `From the collection's own ${code('styles')}: its ${code('styles')} link couldn't be read`
      : `From the collection's own ${code('styles')}`);
  }
  if (styleId && !picked && state.status !== 'loading') {
    hints.push(`${code(styleId)} isn't among the styles listed. Sent by the path Maps gives a style, ${code('…/styles/{styleId}/map')}`);
  }
  if (picked) {
    const added = linkQuery(picked.href);
    const link = picked.href ? `Its map link: ${code(shortLink(picked.href))}` : `It has no map link of its own: sent by the path Maps gives a style, ${code(`…/styles/${picked.id}/map`)}`;
    hints.push(`${picked.title ? `${picked.title}. ` : ''}${link}`);
    // What the request has instead of what the link adds, where a field holds another value
    const instead = added.flatMap(pair => {
      const name = pair.slice(0, pair.indexOf('='));
      if (!(name in held) || held[name] === pair.slice(name.length + 1)) return [];
      return [held[name] ? code(`${name}=${held[name]}`) : `no ${code(name)}`];
    });
    if (added.length && !byLink) {
      hints.push(`The link adds ${added.map(code).join(', ')}. This request has the path, from what was typed, and only what was typed with it`);
    } else if (added.length) {
      hints.push(instead.length
        ? `The link adds ${added.map(code).join(', ')}. The request has ${instead.join(', ')} instead, as chosen`
        : `The link adds ${added.map(code).join(', ')}, which the request now has`);
    }
    if (picked.parameters.length) hints.push(`For ${picked.parameters.map(code).join(', ')}, as its ${code('parameters')} say`);
  }
  return hints;
}
