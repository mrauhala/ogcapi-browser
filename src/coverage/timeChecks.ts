import type { Temporal, ValidationError } from '../types/api';
import { parseDuration } from '../utils/extents/temporal';
import { parseTime } from '../utils/utcTime';
import { COVJSON, EDR } from '../standards';

// What a response says of time: by CoverageJSON 1.0 ("The axis and coordinate identifier "t" MUST refer to temporal
// coordinates and be referenced by a temporal reference system", and with the Gregorian calendar a lexical form that
// "MUST be used"), and the TemporalCRS of its 1.0.1 draft, with numbers for times. Then against what was asked, by
// EDR: "If the datetime parameter is provided, only resources that have a temporal geometry that intersects the
// temporal information in the datetime parameter SHALL be part of the result set". And against what the collection
// says it has. No DOM.

type Json = Record<string, unknown>;

export interface TimeContext {
  url?: string;
  // The open collection's temporal extent, if the request is for it
  temporal?: Temporal;
}

// A time as a span: a date-time is an instant, "2016" the whole year
type Span = [number, number];

interface SentTime {
  raw: unknown;
  path: string;
  coverage: number;
  // On a t axis, or a coordinate of a composite axis's tuples
  on: 'axis' | 'composite';
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
const shown = (raw: unknown) => (typeof raw === 'string' ? raw : JSON.stringify(raw));

// The forms CoverageJSON lists for a calendar of years, months and days
const GREGORIAN = /^(?:[+-]\d{5,}|\d{4})(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/;
const NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const UNIX_TIME = /\/UnixTime$/;
const OPEN = (end: unknown) => end === null || end === undefined || end === '..' || end === '';

// The span a time stands for, if it can be read: a shorter one is the whole of its year, month or day
export function timeSpan(text: unknown): Span | null {
  if (typeof text !== 'string') return null;
  const short = /^([+-]\d{5,}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text.trim());
  if (short) {
    const [, year, month, day] = short;
    const y = Number(year);
    const m = month ? Number(month) - 1 : 0;
    const d = day ? Number(day) : 1;
    const from = Date.UTC(y, m, d);
    // Date.UTC rolls a month 00 or a day 31 of a short month over into another month
    if (!Number.isFinite(from) || new Date(from).getUTCMonth() !== m) return null;
    const to = day ? Date.UTC(y, m, d + 1) : month ? Date.UTC(y, m + 1, 1) : Date.UTC(y + 1, 0, 1);
    return [from, to - 1];
  }
  const at = parseTime(text);
  return Number.isFinite(at) ? [at, at] : null;
}

export const meets = (a: Span, b: Span) => a[0] <= b[1] && a[1] >= b[0];

// The datetime asked for: a date-time, or an interval with ".." for an open end
export function askedDatetime(url: string | undefined): { text: string; span: Span } | 'unreadable' | null {
  const match = url ? /[?&]datetime=([^&#]*)/.exec(url) : null;
  if (!match) return null;
  let text: string;
  try {
    text = decodeURIComponent(match[1]).trim();
  } catch {
    return 'unreadable';
  }
  const parts = text.split('/');
  if (parts.length === 1) {
    const span = timeSpan(text);
    return span ? { text, span } : 'unreadable';
  }
  if (parts.length !== 2 || (OPEN(parts[0]) && OPEN(parts[1]))) return 'unreadable';
  const from = OPEN(parts[0]) ? [-Infinity, -Infinity] : timeSpan(parts[0]);
  const to = OPEN(parts[1]) ? [Infinity, Infinity] : timeSpan(parts[1]);
  return from && to ? { text, span: [from[0], to[1]] } : 'unreadable';
}

// The extent's first interval, which is the whole of it, if both ends can be read or are open
export function extentInterval(temporal: Temporal | undefined): { text: string; span: Span } | null {
  const first = temporal?.interval?.[0];
  if (!Array.isArray(first) || first.length < 2 || (OPEN(first[0]) && OPEN(first[1]))) return null;
  const from = OPEN(first[0]) ? [-Infinity, -Infinity] : timeSpan(first[0]);
  const to = OPEN(first[1]) ? [Infinity, Infinity] : timeSpan(first[1]);
  if (!from || !to) return null;
  const text = OPEN(first[0]) ? `to ${first[1]}` : OPEN(first[1]) ? `from ${first[0]}` : `${first[0]} to ${first[1]}`;
  return { text, span: [from[0], to[1]] };
}

// A duration with one length: months and years have none
const exactDuration = (text: string) => (/^P[^T]*[YM]/.test(text) ? null : parseDuration(text));

// Every step of so long from a start, up to the last if there is one
const stepping = (start: number, step: number, last: number) => ([at]: Span) => {
  const k = (at - start) / step;
  return Number.isInteger(k) && k >= 0 && at <= last;
};

// One of the collection's listed values. EDR: "each member of the array can either be a single time, an ISO 8601 time
// interval or an ISO 8601 time duration"
function listedTest(value: string): { test: (span: Span) => boolean; iso: boolean } | null {
  const parts = value.split('/');
  // Rn/start/duration. How many there are by "Rn" isn't read the same way everywhere: n, or n + 1 with the start
  const repeat = /^R(\d*)$/.exec(parts[0]);
  if (repeat && parts.length === 3) {
    const start = timeSpan(parts[1]);
    const step = exactDuration(parts[2]);
    if (!start || !step) return null;
    return { test: stepping(start[0], step, repeat[1] === '' ? Infinity : start[0] + Number(repeat[1]) * step), iso: true };
  }
  // start/end/step, as Polytope lists them: not ISO 8601, but it says what it means
  if (parts.length === 3) {
    const [start, end, step] = [timeSpan(parts[0]), timeSpan(parts[1]), exactDuration(parts[2])];
    return start && end && step ? { test: stepping(start[0], step, end[1]), iso: false } : null;
  }
  if (parts.length > 3) return null;
  if (parts.length === 1) {
    const span = timeSpan(value);
    return span ? { test: time => meets(time, span), iso: true } : null;
  }
  // An interval: start/end, start/duration or duration/end, with ".." for an open end
  const duration = (part: string) => (part.startsWith('P') ? exactDuration(part) : null);
  const [a, b] = parts;
  if (OPEN(a) && OPEN(b)) return null;
  const from = OPEN(a) ? [-Infinity, -Infinity] : duration(a) === null ? timeSpan(a) : null;
  const to = OPEN(b) ? [Infinity, Infinity] : duration(b) === null ? timeSpan(b) : null;
  const span: Span | null = from && to ? [from[0], to[1]]
    : from && duration(b) !== null ? [from[0], from[0] + duration(b)!]
      : to && duration(a) !== null ? [to[1] - duration(a)!, to[1]]
        : null;
  return span ? { test: time => meets(time, span), iso: true } : null;
}

// Whether a time is among the collection's listed values, and what of them isn't ISO 8601. Unreadable names the first
// value that can't be read, by which nothing is said of them
function listedValues(temporal: Temporal | undefined): { test: (span: Span) => boolean; notIso: string[] } | { unreadable: string } | null {
  const values = temporal?.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const tests: ((span: Span) => boolean)[] = [];
  const notIso: string[] = [];
  for (const value of values) {
    const listed = typeof value === 'string' ? listedTest(value.trim()) : null;
    if (!listed) return { unreadable: shown(value) };
    tests.push(listed.test);
    if (!listed.iso) notIso.push(value);
  }
  return { test: span => tests.some(test => test(span)), notIso };
}

function sentTimes(coverages: Json[], prefix: (coverage: number) => string): SentTime[] {
  const times: SentTime[] = [];
  coverages.forEach((coverage, c) => {
    const axes = isObject(coverage.domain) && isObject(coverage.domain.axes) ? coverage.domain.axes : {};
    const t = axes.t;
    if (isObject(t) && Array.isArray(t.values)) {
      t.values.forEach((raw, index) => times.push({ raw, path: `${prefix(c)}/domain/axes/t/values/${index}`, coverage: c, on: 'axis' }));
    } else if (isObject(t) && typeof t.start === 'number' && typeof t.stop === 'number' && typeof t.num === 'number' && t.num >= 1 && t.num <= 100_000) {
      // 1.0.1 lets a TemporalCRS's t be regularly spaced numbers
      const { start, stop, num } = t;
      for (let index = 0; index < num; index++) {
        times.push({ raw: num > 1 ? start + ((stop - start) * index) / (num - 1) : start, path: `${prefix(c)}/domain/axes/t`, coverage: c, on: 'axis' });
      }
    }
    const composite = axes.composite;
    const at = isObject(composite) && Array.isArray(composite.coordinates) ? composite.coordinates.indexOf('t') : -1;
    if (at >= 0 && isObject(composite) && Array.isArray(composite.values)) {
      composite.values.forEach((tuple, index) => {
        if (Array.isArray(tuple)) times.push({ raw: tuple[at], path: `${prefix(c)}/domain/axes/composite/values/${index}/${at}`, coverage: c, on: 'composite' });
      });
    }
  });
  return times;
}

interface TimeReference {
  // The reference system's object, if t has one
  system: Json | null;
  // Where it is, or where it would be
  path: string;
  // What t is referenced by, if not a temporal reference system
  other: string | null;
  // Whether there's a referencing member at all, in the coverage or its collection
  listed: boolean;
}

// A coverage's own referencing first, then the collection's
function referenceOf(json: Json, coverage: Json, c: number, prefix: (coverage: number) => string, fallback: string): TimeReference {
  const lists: [unknown, string][] = [
    [isObject(coverage.domain) ? coverage.domain.referencing : undefined, `${prefix(c)}/domain/referencing`],
    [json.type === 'CoverageCollection' ? json.referencing : undefined, '/referencing'],
  ];
  for (const [list, base] of lists) {
    if (!Array.isArray(list)) continue;
    const index = list.findIndex(entry => isObject(entry) && Array.isArray(entry.coordinates) && entry.coordinates.includes('t'));
    if (index < 0) continue;
    const system = (list[index] as Json).system;
    const type = isObject(system) && typeof system.type === 'string' ? system.type : null;
    if (type === 'TemporalRS' || type === 'TemporalCRS') return { system: system as Json, path: `${base}/${index}/system`, other: null, listed: true };
    return { system: null, path: `${base}/${index}`, other: type ?? 'a system with no type', listed: true };
  }
  const listed = lists.find(([list]) => Array.isArray(list));
  return { system: null, path: listed ? listed[1] : fallback, other: null, listed: Boolean(listed) };
}

export function timeFindings(json: Json, coverages: Json[], prefix: (coverage: number) => string, context: TimeContext = {}): ValidationError[] {
  const times = sentTimes(coverages, prefix);
  if (times.length === 0) {
    const asked = askedDatetime(context.url);
    return asked && asked !== 'unreadable' ? [{ message: `A datetime was asked for, ${asked.text}, and the response has no times`, path: `${prefix(0)}/domain/axes`, severity: 'info' }] : [];
  }
  const notes: ValidationError[] = [];
  const note = (severity: ValidationError['severity'], message: string, path: string, rule?: ValidationError['rule']) => notes.push({ message, path, severity, ...(rule ? { rule } : {}) });
  const against = (severity: 'error' | 'warning' | 'pass', message: string, path: string, rule?: ValidationError['rule']) => notes.push({ message, path, severity, source: 'collection', ...(rule ? { rule } : {}) });

  // ---- How t is referenced, per coverage that has times ----
  const timed = [...new Set(times.map(time => time.coverage))];
  const references = new Map(timed.map(c => [c, referenceOf(json, coverages[c], c, prefix, times.find(time => time.coverage === c)!.path)]));
  const lacking = timed.filter(c => !references.get(c)!.system);
  if (lacking.length) {
    const first = references.get(lacking[0])!;
    const more = lacking.length > 1 ? `, and likewise in ${plural(lacking.length - 1, 'more coverage')}` : '';
    // CoverageJSON 9.10: "t MUST … be referenced by a temporal reference system", and where there's no referencing
    // member at all, 9.6.1: a domain "MUST have a "referencing" member" unless its collection has one
    note('error', first.other ? `t is referenced by ${first.other}, not a temporal reference system${more}` : `t isn't referenced by a temporal reference system${more}`, first.path,
      first.listed ? COVJSON.timeReferenced : [COVJSON.timeReferenced, COVJSON.referencing]);
  }
  const systems = [...references.values()].flatMap(reference => (reference.system ? [reference] : []));
  const temporalCrs = systems.find(reference => reference.system!.type === 'TemporalCRS');
  if (!lacking.length && !temporalCrs) {
    const { system, path } = systems[0];
    note('pass', `t has a temporal reference system: ${system!.type}, calendar ${shown(system!.calendar)}`, path, COVJSON.timeReferenced);
  }
  const utc = systems.find(reference => typeof reference.system!.timeScale === 'string' && /(^|\/)UTC$/i.test(reference.system!.timeScale as string));
  if (utc) note('error', `timeScale is UTC, which is to be left out: UTC is what it is without one`, `${utc.path}/timeScale`, COVJSON.timeScale);

  // ---- Which times can be read, and how ----
  // A calendar other than Gregorian, or numbers by an unknown unit, can't be placed in time
  const unread = new Set<number>();
  const numericAt = new Set<number>();
  for (const [c, { system }] of references) {
    if (system?.type === 'TemporalCRS') {
      if (typeof system.id === 'string' && UNIX_TIME.test(system.id)) numericAt.add(c);
      else unread.add(c);
    } else if (system && system.calendar !== 'Gregorian') unread.add(c);
  }
  const comparing = Boolean(askedDatetime(context.url) || context.temporal);
  if (temporalCrs) {
    const unix = numericAt.has(timed.find(c => references.get(c) === temporalCrs)!);
    const id = typeof temporalCrs.system!.id === 'string' ? temporalCrs.system!.id : 'no id';
    // CoverageJSON 9.5.2: "The only currently defined value of it is "TemporalRS"". In 1.0 any other is a custom type, and
    // 9.7.2: "The custom value of those members SHOULD be either an absolute URI or a compact URI", which TemporalCRS
    // isn't: a SHOULD, an issue. The 1.0.1 draft defines it, but a draft isn't a standard
    note('warning', `t is referenced by a TemporalCRS (${id}), with numbers for times. CoverageJSON 1.0 has no such type, and a type of one's own should be a URI; it's in the 1.0.1 draft. ${unix
      ? 'They are read as seconds since 1970-01-01T00:00:00Z'
      : `This can't place them in time${comparing ? ', so they aren\'t checked against the datetime asked for or the collection\'s extent' : ''}`}`, temporalCrs.path,
    [COVJSON.temporalRsType, COVJSON.customValue]);
  }
  const otherCalendar = systems.find(reference => reference.system!.type === 'TemporalRS' && reference.system!.calendar !== 'Gregorian');
  if (otherCalendar) {
    note('info', `t's calendar is ${shown(otherCalendar.system!.calendar)}, not Gregorian: its times aren't checked for their form${comparing ? ', or against the datetime asked for or the collection\'s extent' : ''}`, `${otherCalendar.path}/calendar`, COVJSON.calendar);
  }

  // ---- Their form, by the Gregorian calendar's rule: a MUST under it, a SHOULD without a reference system ----
  const formed = times.filter(time => !unread.has(time.coverage) && !numericAt.has(time.coverage));
  const misformed = formed.filter(time => typeof time.raw !== 'string' || !GREGORIAN.test(time.raw) || !timeSpan(time.raw));
  if (misformed.length) {
    const [first] = misformed;
    const why = typeof first.raw !== 'string' ? `: it isn't a string` : NO_ZONE.test(first.raw) ? ': it has no Z or offset' : '';
    const what = misformed.length === 1 ? `t ${shown(first.raw)} isn't` : `${plural(misformed.length, 'time')} aren't`;
    const firstOf = misformed.length === 1 ? '' : `, the first ${shown(first.raw)}`;
    const must = Boolean(references.get(first.coverage)!.system);
    note(must ? 'error' : 'warning', `${what} in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z${firstOf}${why}`, first.path, must ? COVJSON.timeFormsMust : COVJSON.timeFormsShould);
  } else if (formed.length) {
    note('pass', `Every time is in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z, like ${shown(formed[0].raw)}`, formed[0].path,
      formed.some(time => references.get(time.coverage)!.system) ? COVJSON.timeFormsMust : COVJSON.timeFormsShould);
  }

  // The times read, each with its span
  const spans = new Map<SentTime, Span>();
  for (const time of times) {
    if (unread.has(time.coverage)) continue;
    if (numericAt.has(time.coverage)) {
      if (typeof time.raw === 'number' && Number.isFinite(time.raw)) spans.set(time, [time.raw * 1000, time.raw * 1000]);
    } else if (typeof time.raw === 'string' && GREGORIAN.test(time.raw)) {
      const span = timeSpan(time.raw);
      if (span) spans.set(time, span);
    }
  }
  const read = [...spans.keys()];
  // A pass only where every time was read
  const all = read.length === times.length;

  // ---- Their order: an axis's values MUST run one way, rising or falling, and a composite's points MUST follow t ----
  const byAxis = new Map<string, SentTime[]>();
  for (const time of read) {
    const key = `${time.coverage}|${time.on}`;
    if (!byAxis.has(key)) byAxis.set(key, []);
    byAxis.get(key)!.push(time);
  }
  let backwards: [SentTime, SentTime, string] | null = null;
  let twice: SentTime | null = null;
  for (const [key, list] of byAxis) {
    const domainType = (isObject(coverages[list[0].coverage].domain) ? (coverages[list[0].coverage].domain as Json).domainType : undefined) ?? json.domainType;
    const seen = new Set<number>();
    const onAxis = key.endsWith('axis');
    // The way an axis runs, from its first step that goes anywhere
    let way = 0;
    for (let i = 1; i < list.length; i++) {
      const [before, now] = [spans.get(list[i - 1])![0], spans.get(list[i])![0]];
      const step = Math.sign(now - before);
      if (onAxis && way === 0) way = step;
      const turned = onAxis ? step !== 0 && step !== way : now < before;
      if (turned && !backwards) backwards = [list[i - 1], list[i], onAxis ? 'axis' : String(domainType ?? 'composite')];
    }
    if (key.endsWith('axis')) {
      for (const time of list) {
        const at = spans.get(time)![0];
        if (seen.has(at) && !twice) twice = time;
        seen.add(at);
      }
    }
  }
  if (backwards) {
    const [before, now, kind] = backwards;
    if (kind === 'axis') note('error', `Times aren't in order: ${shown(now.raw)} comes after ${shown(before.raw)}`, now.path, COVJSON.monotonic);
    else if (kind === 'Trajectory' || kind === 'Section') note('error', `A ${kind}'s points must follow the order of t, and ${shown(now.raw)} comes after ${shown(before.raw)}`, now.path, kind === 'Trajectory' ? COVJSON.trajectoryOrder : COVJSON.sectionOrder);
    else note('info', `The composite axis's points aren't in time order: ${shown(now.raw)} comes after ${shown(before.raw)}`, now.path);
  }
  // A time twice on one axis: whether "monotonically, that is, increasing or decreasing" allows a step of none isn't
  // said, so no MUST is shown broken, but two values for one time are the server's to fix: an issue
  if (twice) note('warning', `t has ${shown(twice.raw)} twice`, twice.path);

  // ---- Against the datetime asked for, or what the server chose without one ----
  const distinct = (list: SentTime[]) => {
    const unique = new Map<number, SentTime>();
    for (const time of list) if (!unique.has(spans.get(time)![0])) unique.set(spans.get(time)![0], time);
    return [...unique.values()];
  };
  const asked = askedDatetime(context.url);
  // Without a URL, nothing is known of what was asked
  if (asked === null && context.url !== undefined && read.length) {
    const sent = distinct(read).sort((a, b) => spans.get(a)![0] - spans.get(b)![0]);
    const span = sent.length === 1 ? shown(sent[0].raw) : `${shown(sent[0].raw)} to ${shown(sent[sent.length - 1].raw)}`;
    note('info', `No datetime was asked for. The server sent ${plural(sent.length, 'time')}: ${span}`, read[0].path);
  } else if (asked && asked !== 'unreadable') {
    const instant = asked.span[0] === asked.span[1];
    const outside = distinct(read.filter(time => !meets(spans.get(time)!, asked.span)));
    if (outside.length) {
      const [first] = outside;
      const what = outside.length === 1 ? `t ${shown(first.raw)} ${instant ? "isn't" : 'is outside'}` : `${plural(outside.length, 'time')} ${instant ? "aren't" : 'are outside'}`;
      note('error', `${what} the datetime asked for, ${asked.text}${outside.length === 1 ? '' : `: the first is ${shown(first.raw)}`}`, first.path, EDR.datetimeResponse);
    } else if (all) {
      note('pass', instant ? `Every time is the datetime asked for, ${asked.text}` : `Every time is inside the datetime asked for, ${asked.text}`, read[0].path, EDR.datetimeResponse);
    }
  }

  // ---- Against the collection's temporal extent ----
  // EDR /req/core/rc-extent A: "the extent property, if provided, SHALL provide … time intervals that include all
  // temporal geometries in this collection". A time outside it breaks that, whichever of the two is wrong: an error
  const interval = extentInterval(context.temporal);
  if (interval) {
    const outside = distinct(read.filter(time => !meets(spans.get(time)!, interval.span)));
    if (outside.length) {
      const what = outside.length === 1 ? `t ${shown(outside[0].raw)} is` : `${plural(outside.length, 'time')} are`;
      against('error', `${what} outside the collection's extent, ${interval.text}${outside.length === 1 ? '' : `: the first is ${shown(outside[0].raw)}`}`, outside[0].path, EDR.extent);
    } else if (all) {
      against('pass', `Every time is inside the collection's extent, ${interval.text}`, read[0].path, EDR.extent);
    }
  }
  const listed = listedValues(context.temporal);
  if (listed && 'unreadable' in listed) {
    notes.push({ message: `The collection lists a time that can't be read, ${listed.unreadable}, so the times aren't checked against its list`, severity: 'info', source: 'collection', rule: EDR.temporalValues });
  } else if (listed?.notIso.length) {
    // Only EDR's informative Annex C describes values: "An array of ISO 8601 datestrings which details the time
    // intervals available in the collection, each member of the array can either be a single time, an ISO 8601 time
    // interval or an ISO 8601 time duration". No requirement says what form they take
    notes.push({ message: `The collection lists its times as ${listed.notIso[0]}${listed.notIso.length > 1 ? ` and ${listed.notIso.length - 1} more like it` : ''}. EDR's informative Annex C describes them as ISO 8601 times, intervals or durations, and start/end/step is none of them: read as that`, severity: 'warning', source: 'collection', rule: EDR.temporalValues });
  }
  if (listed && 'test' in listed) {
    const among = listed.test;
    const unlisted = distinct(read.filter(time => !among(spans.get(time)!)));
    if (unlisted.length) {
      const what = unlisted.length === 1 ? `t ${shown(unlisted[0].raw)} isn't` : `${plural(unlisted.length, 'time')} aren't`;
      against('warning', `${what} among the times the collection lists${unlisted.length === 1 ? '' : `: the first is ${shown(unlisted[0].raw)}`}`, unlisted[0].path);
    } else if (all) {
      against('pass', 'Every time is among the times the collection lists', read[0].path);
    }
  }
  return notes;
}
