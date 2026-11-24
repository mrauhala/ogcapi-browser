// The Accept header a request is sent with, which the request line can't show: the one the form holds for a map
// request, where the line is a map request of the collection the form is on. Anything else goes with the app's own,
// */*. And what an Accept sent takes, read by RFC 9110, 12.5.1. Pure.
import type { Collection } from '../types/api';
import { matchDataQuery } from './parseQueryUrl';
import { queryTypeOf } from './queryTypes';

export function sentAccept(url: string, collection: Collection | null | undefined, accept: string): string | null {
  const value = accept.trim();
  if (!value || !collection) return null;
  const target = matchDataQuery(url, collection);
  return target && queryTypeOf(collection, target.queryKey) === 'map' ? value : null;
}

// A media range: a type and subtype, either of which may be *, and its weight, q, 1 where it's left out or can't be read
export interface MediaRange {
  type: string;
  subtype: string;
  q: number;
}

// An Accept as sent, and its media ranges. Parameters other than q are left unread
export interface AcceptSent {
  sent: string;
  ranges: MediaRange[];
}

function readRanges(accept: string): MediaRange[] {
  return accept.split(',').flatMap(part => {
    const [range, ...params] = part.split(';').map(each => each.trim());
    const [type, subtype, ...rest] = range.toLowerCase().split('/');
    if (!type || !subtype || rest.length) return [];
    const weight = params.find(param => /^q\s*=/i.test(param));
    const q = weight === undefined ? 1 : Number.parseFloat(weight.slice(weight.indexOf('=') + 1));
    return [{ type, subtype, q: q >= 0 && q <= 1 ? q : 1 }];
  });
}

// The Accept a response was sent with, where it asked for a format: null for none, the app's */*, or any that takes every
// format alike. One with no range to read takes none
export function acceptAsked(accept: string | null | undefined): AcceptSent | null {
  const sent = accept?.trim() ?? '';
  const ranges = readRanges(sent);
  if (!sent || (ranges.length && ranges.every(range => range.type === '*' && range.subtype === '*' && range.q > 0))) return null;
  return { sent, ranges };
}

// Whether Accept takes a media type: the most specific range that has it, the type itself before type/* before */*,
// weighs more than 0. Its parameters are left out
export function acceptsType(ranges: readonly MediaRange[], mediaType: string): boolean {
  const [type, subtype, ...rest] = mediaType.split(';')[0].trim().toLowerCase().split('/');
  if (!type || !subtype || rest.length) return false;
  const specificity = (range: MediaRange) => {
    if (range.type === type && range.subtype === subtype) return 2;
    if (range.type === type && range.subtype === '*') return 1;
    return range.type === '*' && range.subtype === '*' ? 0 : -1;
  };
  let best = -1;
  let q = 0;
  for (const range of ranges) {
    const each = specificity(range);
    if (each > best) [best, q] = [each, range.q];
    else if (each === best && each >= 0) q = Math.max(q, range.q);
  }
  return best >= 0 && q > 0;
}
