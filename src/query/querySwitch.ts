// What a newly picked query keeps of the last one: nothing that wasn't chosen, and of what was, only what the new query
// takes. The format, where the new query offers it, and the box and the time: between a map and a query that takes its
// box from the map (items, cube), the box in CRS84, and on items, a time the last request sent, as a filter. A map's
// parameter and format are its own, from its parameter_names and its API docs, and don't cross to or from another
// query; nor do its size and CRS, or another query's sizes and limit. Pure.
import type { Collection } from '../types/api';
import type { BBox } from './types';
import { keptFormat, queryTypeOf } from './queryTypes';
import { filtersByTimeSent } from './queryModel';
import { boxAcross } from './mapBox';

export interface QueryNow {
  format: string;
  parameters: string[];
  queryParams: Record<string, string>; // the fields' texts: a map's box, size and CRS among them
  drawn: BBox | null; // the box taken from the map, as items and cube have it
  datetime: string;
  filterByTime: boolean;
  hasLocation: boolean;
}

export interface QuerySwitched {
  queryType: string;
  format: string;
  parameters: string[];
  queryParams: Record<string, string>;
  carried: BBox | null; // a map's box carried across for the map to draw: null for none, and the map keeps its own box
  // where the kind of geometry is the same
  leftBehind: string; // what couldn't go across, said: '' for nothing
  filterByTime: boolean;
}

export function querySwitch(collection: Collection, queryKey: string, from: string, now: QueryNow): QuerySwitched {
  const queryType = queryKey ? queryTypeOf(collection, queryKey) : '';
  const switched = queryType !== from;
  const mapOwn = switched && (queryType === 'map' || from === 'map');
  const across = boxAcross(from, queryType, { drawn: now.drawn, bbox: now.queryParams.bbox ?? '', bboxCrs: now.queryParams['bbox-crs'] ?? '' });
  return {
    queryType,
    format: mapOwn ? '' : keptFormat(collection, queryKey, now.format),
    parameters: mapOwn ? [] : now.parameters,
    queryParams: !switched ? now.queryParams : across.bbox ? { bbox: across.bbox } : {},
    carried: across.drawn ?? null,
    leftBehind: across.leftBehind ?? '',
    filterByTime: now.filterByTime || filtersByTimeSent(from, queryType, now),
  };
}
