import { describe, expect, it } from 'vitest';
import type { Temporal, ValidationError } from '../types/api';
import { askedDatetime, timeFindings, timeSpan, type TimeContext } from './timeChecks';
import polytopeArea from './__fixtures__/polytope-op-multipoint-area.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TRS = { coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'Gregorian' } };
const T = ['2026-11-08T00:00:00Z', '2026-11-08T06:00:00Z', '2026-11-08T12:00:00Z'];
const at = (text: string) => Date.parse(text);

// A time series at a point, as most servers send one
const series = (t: unknown, referencing: unknown[] | null = [TRS]): Json => ({
  type: 'Coverage',
  domain: { type: 'Domain', domainType: 'PointSeries', axes: { x: { values: [1] }, y: { values: [2] }, t: Array.isArray(t) ? { values: t } : t }, ...(referencing ? { referencing } : {}) },
  ranges: {},
});
const collection = (...coverages: Json[]): Json => ({ type: 'CoverageCollection', coverages });
const trajectory = (times: string[], domainType: string | null = 'Trajectory'): Json => ({
  type: 'Coverage',
  domain: { type: 'Domain', ...(domainType ? { domainType } : {}), axes: { composite: { dataType: 'tuple', coordinates: ['t', 'x', 'y'], values: times.map((time, i) => [time, i, i]) } }, referencing: [TRS] },
  ranges: {},
});
const request = (datetime?: string) => `https://api.example.com/collections/a/position?coords=POINT(1%202)${datetime ? `&datetime=${encodeURIComponent(datetime)}` : ''}&f=CoverageJSON`;

const findings = (json: Json, context: TimeContext = {}) => {
  const isCollection = json.type === 'CoverageCollection';
  return timeFindings(json, isCollection ? json.coverages : [json], c => (isCollection ? `/coverages/${c}` : ''), context);
};
const kinds = (notes: ValidationError[]) => Object.fromEntries(notes.map(note => [note.message, note.severity]));
const found = (notes: ValidationError[], start: RegExp) => notes.find(note => start.test(note.message));
const messages = (notes: ValidationError[]) => notes.map(note => note.message);

describe('timeSpan', () => {
  it('reads a date-time as an instant, in its own zone', () => {
    expect(timeSpan(T[2])).toEqual([at(T[2]), at(T[2])]);
    expect(timeSpan('2026-11-08T14:00:00+02:00')).toEqual([at(T[2]), at(T[2])]);
    expect(timeSpan('2026-11-08T12:00:00.5Z')).toEqual([at(T[2]) + 500, at(T[2]) + 500]);
    expect(timeSpan('2026-11-08T12:00:00')).toEqual([at(T[2]), at(T[2])]);
  });

  it('reads a shorter one as the whole of its year, month or day', () => {
    expect(timeSpan('2026')).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1) - 1]);
    expect(timeSpan('2026-12')).toEqual([Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 1) - 1]);
    expect(timeSpan('2026-11-08')).toEqual([Date.UTC(2026, 10, 8), Date.UTC(2026, 10, 9) - 1]);
    expect(timeSpan('+12026')).toEqual([Date.UTC(12026, 0, 1), Date.UTC(12027, 0, 1) - 1]);
  });

  it('reads nothing that isn’t a time', () => {
    for (const text of ['2026-13', '2026-00', '2026-11-00', '2026-11-31', '2026-02-29', 'soon', '', 12, null]) expect(timeSpan(text)).toBeNull();
    expect(timeSpan('2028-02-29')).toEqual([Date.UTC(2028, 1, 29), Date.UTC(2028, 2, 1) - 1]);
  });
});

describe('askedDatetime', () => {
  it('is none where nothing was asked', () => {
    expect(askedDatetime(undefined)).toBeNull();
    expect(askedDatetime(request())).toBeNull();
    expect(askedDatetime('https://api.example.com/x?xdatetime=2026')).toBeNull();
  });

  it('reads a date-time, written plainly or encoded, up to the next parameter', () => {
    expect(askedDatetime(request(T[2]))).toEqual({ text: T[2], span: [at(T[2]), at(T[2])] });
    expect(askedDatetime(`https://api.example.com/x?datetime=2026-11-08T12:00:00Z#top`)).toEqual({ text: T[2], span: [at(T[2]), at(T[2])] });
  });

  it('reads an interval, closed or open at either end', () => {
    expect(askedDatetime(request(`${T[0]}/${T[2]}`))).toEqual({ text: `${T[0]}/${T[2]}`, span: [at(T[0]), at(T[2])] });
    expect(askedDatetime(request(`../${T[2]}`))).toMatchObject({ span: [-Infinity, at(T[2])] });
    expect(askedDatetime(request(`${T[0]}/..`))).toMatchObject({ span: [at(T[0]), Infinity] });
    // A day asked for is all of it
    expect(askedDatetime(request('2026-11-08'))).toMatchObject({ span: [at(T[0]), Date.UTC(2026, 10, 9) - 1] });
    expect(askedDatetime(request(`${T[0]}/2026-11-08`))).toMatchObject({ span: [at(T[0]), Date.UTC(2026, 10, 9) - 1] });
  });

  it('says so of what it can’t read', () => {
    for (const datetime of ['../..', `${T[0]}/${T[1]}/${T[2]}`, 'soon', `${T[0]}/later`]) expect(askedDatetime(request(datetime))).toBe('unreadable');
    expect(askedDatetime('https://api.example.com/x?datetime=%E0%A4%A')).toBe('unreadable');
  });
});

describe('timeFindings: how t is referenced', () => {
  it('passes a temporal reference system, where it is', () => {
    expect(findings(series(T))[0]).toEqual({ message: 't has a temporal reference system: TemporalRS, calendar Gregorian', path: '/domain/referencing/0/system', severity: 'pass' });
  });

  it('makes an error of t without one, where it would be', () => {
    const none = "t isn't referenced by a temporal reference system";
    expect(found(findings(series(T, [{ coordinates: ['x', 'y'], system: { type: 'GeographicCRS' } }])), /^t isn't referenced/)).toEqual({ message: none, path: '/domain/referencing', severity: 'error' });
    expect(found(findings(series(T, null)), /^t isn't referenced/)).toMatchObject({ path: '/domain/axes/t/values/0' });
    expect(found(findings(polytopeArea), /^t isn't referenced/)).toMatchObject({ path: '/referencing', severity: 'error' });
    // A coverage's referencing is its domain's: only a collection has one beside its coverages
    expect(found(findings({ ...series(T, null), referencing: [TRS] }), /^t isn't referenced/)).toMatchObject({ path: '/domain/axes/t/values/0' });
    expect(found(findings(series(T)), /referenced by/)).toBeUndefined();
  });

  it('takes the collection’s, and a coverage’s own first', () => {
    const shared = { ...collection(series(T, null)), referencing: [TRS] };
    expect(found(findings(shared), /^t has/)?.path).toBe('/referencing/0/system');
    const both = { ...collection(series(T)), referencing: [TRS] };
    expect(found(findings(both), /^t has/)?.path).toBe('/coverages/0/domain/referencing/0/system');
  });

  it('names what else t is referenced by', () => {
    expect(found(findings(series(T, [{ coordinates: ['t', 'x'], system: { type: 'GeographicCRS' } }])), /referenced/)).toEqual({ message: 't is referenced by GeographicCRS, not a temporal reference system', path: '/domain/referencing/0', severity: 'error' });
    expect(found(findings(series(T, [{ coordinates: ['t'], system: {} }])), /referenced/)?.message).toBe('t is referenced by a system with no type, not a temporal reference system');
  });

  it('says it once of many coverages, where it first is', () => {
    const notes = findings(collection(series(T), series(T, null), series(T, null)));
    expect(found(notes, /referenced/)).toEqual({ message: "t isn't referenced by a temporal reference system, and likewise in 1 more coverage", path: '/coverages/1/domain/axes/t/values/0', severity: 'error' });
    expect(found(notes, /^t has/)).toBeUndefined();
  });

  it('makes an error of a time scale given as UTC, which is to be left out', () => {
    const scaled = (timeScale: string) => findings(series(T, [{ coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'Gregorian', timeScale } }]));
    expect(found(scaled('http://www.opengis.net/def/trs/BIPM/0/UTC'), /timeScale/)).toEqual({ message: 'timeScale is UTC, which is to be left out: UTC is what it is without one', path: '/domain/referencing/0/system/timeScale', severity: 'error' });
    expect(found(scaled('utc'), /timeScale/)).toBeDefined();
    expect(found(scaled('http://www.opengis.net/def/trs/BIPM/0/TAI'), /timeScale/)).toBeUndefined();
  });
});

describe('timeFindings: numbers for times, and other calendars', () => {
  const crs = (id?: string) => [{ coordinates: ['t'], system: { type: 'TemporalCRS', ...(id ? { id } : {}), calendar: 'Gregorian' } }];
  const UNIX = 'http://www.opengis.net/def/axis/OGC/0/UnixTime';
  const seconds = T.map(time => at(time) / 1000);

  it('reads Unix time as seconds, and says the TemporalCRS is the 1.0.1 draft’s', () => {
    const notes = findings(series(seconds, crs(UNIX)), { url: request(T[0] + '/' + T[2]) });
    expect(found(notes, /TemporalCRS/)).toEqual({
      message: `t is referenced by a TemporalCRS (${UNIX}), with numbers for times: in the CoverageJSON 1.0.1 draft, not in 1.0. They are read as seconds since 1970-01-01T00:00:00Z`,
      path: '/domain/referencing/0/system',
      severity: 'info',
    });
    expect(kinds(notes)[`Every time is inside the datetime asked for, ${T[0]}/${T[2]}`]).toBe('pass');
    expect(found(notes, /^t has|Gregorian form/)).toBeUndefined();
  });

  it('reads no more times spaced by start, stop and num than it could hold', () => {
    expect(findings(series({ start: 0, stop: 1, num: 1e9 }, crs(UNIX)))).toEqual([]);
  });

  it('reads Unix time spaced by start, stop and num', () => {
    const notes = findings(series({ start: seconds[0], stop: seconds[2], num: 3 }, crs(UNIX)), { url: request(T[1]) });
    expect(found(notes, /datetime asked/)).toEqual({ message: `2 times aren't the datetime asked for, ${T[1]}: the first is ${seconds[0]}`, path: '/domain/axes/t', severity: 'error' });
  });

  it('can’t place other numbers in time, and says so', () => {
    const notes = findings(series(seconds, crs('http://www.opengis.net/def/cs/OGC/0/Days')), { url: request(T[0]) });
    expect(found(notes, /TemporalCRS/)?.message).toMatch(/\. This can't place them in time, so they aren't checked against the datetime asked for or the collection's extent$/);
    expect(notes.filter(note => !/TemporalCRS/.test(note.message)).map(note => note.message)).toEqual([]);
    expect(found(findings(series(seconds, crs())), /TemporalCRS/)?.message).toMatch(/^t is referenced by a TemporalCRS \(no id\), .*This can't place them in time$/);
  });

  it('checks no form of another calendar’s times, and doesn’t place them', () => {
    // Its times may look Gregorian, and aren't
    const notes = findings(series(T, [{ coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'https://example.org/360day' } }]), { url: request(T[0]) });
    expect(notes).toEqual([
      { message: 't has a temporal reference system: TemporalRS, calendar https://example.org/360day', path: '/domain/referencing/0/system', severity: 'pass' },
      { message: "t's calendar is https://example.org/360day, not Gregorian: its times aren't checked for their form, or against the datetime asked for or the collection's extent", path: '/domain/referencing/0/system/calendar', severity: 'info' },
    ]);
    expect(found(findings(series(['1-1'], [{ coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'https://example.org/360day' } }])), /calendar is/)?.message).toMatch(/for their form$/);
  });
});

describe('timeFindings: the form of the times', () => {
  it('passes the Gregorian form, shorter ones too', () => {
    expect(found(findings(series(T)), /Gregorian form/)).toEqual({ message: `Every time is in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z, like ${T[0]}`, path: '/domain/axes/t/values/0', severity: 'pass' });
    expect(found(findings(series(['2026-11', '2026-12', '+12026', '2026-11-08T12:00:00.123+02:00'])), /Gregorian form/)?.severity).toBe('pass');
  });

  it('makes an error of a time without a zone, as pygeoapi sends them', () => {
    expect(found(findings(series(['2026-10-30T04:00:00.000000000'])), /Gregorian form/)).toEqual({
      message: "t 2026-10-30T04:00:00.000000000 isn't in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z: it has no Z or offset",
      path: '/domain/axes/t/values/0',
      severity: 'error',
    });
  });

  it('counts them, and names the first', () => {
    expect(found(findings(series([T[0], '2026-11-08T06:00:00', '2026-11-08T12:00'])), /Gregorian form/)).toMatchObject({
      message: "2 times aren't in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z, the first 2026-11-08T06:00:00: it has no Z or offset",
      path: '/domain/axes/t/values/1',
    });
  });

  it('says why where it can', () => {
    expect(found(findings(series([1762560000])), /Gregorian form/)?.message).toBe("t 1762560000 isn't in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z: it isn't a string");
    expect(found(findings(series(['2026-11-08t00:00:00z'])), /Gregorian form/)?.message).toBe("t 2026-11-08t00:00:00z isn't in the Gregorian form YYYY-MM-DDTHH:MM:SS[.F]Z");
    expect(found(findings(series(['2026-13-08T00:00:00Z'])), /Gregorian form/)?.severity).toBe('error');
  });

  it('makes only an issue of it without a reference system, where the form is a SHOULD', () => {
    expect(found(findings(series(['2026-11-08T00:00:00'], null)), /Gregorian form/)?.severity).toBe('warning');
  });

  it('compares only the times it can read, and passes nothing it didn’t compare', () => {
    const notes = findings(series([T[2], 'later']), { url: request(T[2]), temporal: { interval: [[T[0], T[2]]], values: [T[2]] } });
    expect(found(notes, /asked|extent|lists/)).toBeUndefined();
  });
});

describe('timeFindings: their order', () => {
  it('notes times out of order, and makes an issue of one twice', () => {
    expect(found(findings(series([T[1], T[0], T[2]])), /order/)).toEqual({ message: `Times aren't in order: ${T[0]} comes after ${T[1]}`, path: '/domain/axes/t/values/1', severity: 'info' });
    expect(found(findings(series([T[0], T[1], T[0]])), /twice/)).toEqual({ message: `t has ${T[0]} twice`, path: '/domain/axes/t/values/2', severity: 'warning' });
    // The first of each
    expect(found(findings(series([T[1], T[0], T[2], T[1]])), /order/)?.path).toBe('/domain/axes/t/values/1');
    expect(found(findings(series([T[0], T[0], T[1], T[1]])), /twice/)?.path).toBe('/domain/axes/t/values/1');
    expect(found(findings(series(T)), /order|twice/)).toBeUndefined();
  });

  it('doesn’t count a time in two coverages as twice, or their order', () => {
    expect(found(findings(collection(series([T[2]]), series([T[0]]), series([T[0]]))), /order|twice/)).toBeUndefined();
  });

  it('makes an error of a Trajectory or a Section going back in time, as FMI’s do', () => {
    expect(found(findings(trajectory([T[0], T[2], T[1]])), /order/)).toEqual({ message: `A Trajectory's points must follow the order of t, and ${T[1]} comes after ${T[2]}`, path: '/domain/axes/composite/values/2/0', severity: 'error' });
    expect(found(findings(trajectory([T[2], T[0]], 'Section')), /order/)?.message).toBe(`A Section's points must follow the order of t, and ${T[0]} comes after ${T[2]}`);
    expect(found(findings({ ...collection(trajectory([T[2], T[0]], null)), domainType: 'Trajectory' }), /order/)?.severity).toBe('error');
  });

  it('lets a Trajectory stay at a time, and only notes another composite out of order', () => {
    expect(found(findings(trajectory([T[0], T[0], T[1]])), /order|twice/)).toBeUndefined();
    const gap = trajectory([T[0], T[1]]);
    gap.domain.axes.composite.values.splice(1, 0, null);
    expect(found(findings(gap), /Gregorian form/)?.severity).toBe('pass');
    expect(found(findings(trajectory([T[2], T[0]], 'Custom')), /order/)).toEqual({ message: `The composite axis's points aren't in time order: ${T[0]} comes after ${T[2]}`, path: '/domain/axes/composite/values/1/0', severity: 'info' });
  });
});

describe('timeFindings: against the datetime asked for', () => {
  it('passes the time asked for, however it’s written', () => {
    expect(found(findings(series([T[2]]), { url: request(T[2]) }), /asked/)).toEqual({ message: `Every time is the datetime asked for, ${T[2]}`, path: '/domain/axes/t/values/0', severity: 'pass' });
    expect(found(findings(series(['2026-11-08T14:00:00+02:00']), { url: request(T[2]) }), /asked/)?.severity).toBe('pass');
  });

  it('makes an error of a time that isn’t it, as Polytope sends its forecast’s start', () => {
    expect(found(findings(series([T[0]]), { url: request(T[2]) }), /asked/)).toEqual({ message: `t ${T[0]} isn't the datetime asked for, ${T[2]}`, path: '/domain/axes/t/values/0', severity: 'error' });
    expect(found(findings(series(T), { url: request(T[2]) }), /asked/)?.message).toBe(`2 times aren't the datetime asked for, ${T[2]}: the first is ${T[0]}`);
    const url = /^GET (\S+),/.exec(polytopeArea._comment)![1];
    expect(found(findings(polytopeArea, { url }), /asked/)).toEqual({ message: "t 2026-11-06T00:00:00Z isn't the datetime asked for, 2026-11-08T12:00:00Z", path: '/coverages/0/domain/axes/t/values/0', severity: 'error' });
  });

  it('passes times inside an interval, and makes an error of those outside it', () => {
    expect(found(findings(series(T), { url: request(`${T[0]}/${T[2]}`) }), /asked/)).toMatchObject({ message: `Every time is inside the datetime asked for, ${T[0]}/${T[2]}`, severity: 'pass' });
    expect(found(findings(series(T), { url: request(`${T[1]}/..`) }), /asked/)).toEqual({ message: `t ${T[0]} is outside the datetime asked for, ${T[1]}/..`, path: '/domain/axes/t/values/0', severity: 'error' });
    expect(found(findings(series(T), { url: request(`../${T[0]}`) }), /asked/)?.message).toBe(`2 times are outside the datetime asked for, ../${T[0]}: the first is ${T[1]}`);
    expect(found(findings(series(T), { url: request('2026-11-08') }), /asked/)?.severity).toBe('pass');
  });

  it('counts a time the coverages share once', () => {
    expect(found(findings(collection(series([T[0]]), series([T[0]]))), /asked/)).toBeUndefined();
    expect(found(findings(collection(series([T[0]]), series([T[0]])), { url: request(T[2]) }), /asked/)).toMatchObject({ message: `t ${T[0]} isn't the datetime asked for, ${T[2]}`, path: '/coverages/0/domain/axes/t/values/0' });
  });

  it('notes what the server chose when nothing was asked, and nothing without a request', () => {
    expect(found(findings(series([T[2], T[0], T[1]]), { url: request() }), /No datetime/)).toEqual({ message: `No datetime was asked for. The server sent 3 times: ${T[0]} to ${T[2]}`, path: '/domain/axes/t/values/0', severity: 'info' });
    expect(found(findings(collection(series([T[1]]), series([T[1]])), { url: request() }), /No datetime/)?.message).toBe(`No datetime was asked for. The server sent 1 time: ${T[1]}`);
    expect(found(findings(series(T)), /No datetime/)).toBeUndefined();
  });

  it('says nothing of a datetime it can’t read', () => {
    expect(found(findings(series(T), { url: request('soon') }), /datetime/)).toBeUndefined();
  });

  it('notes a response with no times to a datetime asked for, which EDR lets match it', () => {
    const timeless = { type: 'Coverage', domain: { axes: { x: { values: [1] }, y: { values: [2] } } }, ranges: {} };
    expect(findings(timeless, { url: request(T[2]) })).toEqual([{ message: `A datetime was asked for, ${T[2]}, and the response has no times`, path: '/domain/axes', severity: 'info' }]);
    expect(findings(timeless, { url: request() })).toEqual([]);
    expect(findings(timeless, { url: request('soon') })).toEqual([]);
  });
});

describe('timeFindings: against the collection', () => {
  const against = (temporal: Temporal, t: unknown[] = T) => findings(series(t), { temporal }).filter(note => note.source === 'collection');

  it('passes times inside its extent, at the times', () => {
    expect(against({ interval: [[T[0], T[2]]] })).toEqual([{ message: `Every time is inside the collection's extent, ${T[0]} to ${T[2]}`, path: '/domain/axes/t/values/0', severity: 'pass', source: 'collection' }]);
  });

  it('makes an issue of times outside it', () => {
    expect(against({ interval: [[T[1], T[2]]] })).toEqual([{ message: `t ${T[0]} is outside the collection's extent, ${T[1]} to ${T[2]}`, path: '/domain/axes/t/values/0', severity: 'warning', source: 'collection' }]);
    expect(messages(against({ interval: [[T[2], null]] }))).toEqual([`2 times are outside the collection's extent, from ${T[2]}: the first is ${T[0]}`]);
    expect(messages(against({ interval: [['..', T[0]]] }))).toEqual([`2 times are outside the collection's extent, to ${T[0]}: the first is ${T[1]}`]);
  });

  it('says nothing of an extent with no ends, or one it can’t read', () => {
    expect(against({ interval: [[null, null]] })).toEqual([]);
    expect(against({ interval: [['once', T[2]]] })).toEqual([]);
    expect(against({ interval: [] })).toEqual([]);
    expect(against({ interval: [[T[0]]] })).toEqual([]);
  });

  it('passes times among those it lists, and makes an issue of those that aren’t', () => {
    expect(against({ values: T })).toEqual([{ message: 'Every time is among the times the collection lists', path: '/domain/axes/t/values/0', severity: 'pass', source: 'collection' }]);
    expect(against({ values: [T[0], T[2]] })).toEqual([{ message: `t ${T[1]} isn't among the times the collection lists`, path: '/domain/axes/t/values/1', severity: 'warning', source: 'collection' }]);
    expect(messages(against({ values: [T[2]] }))).toEqual([`2 times aren't among the times the collection lists: the first is ${T[0]}`]);
  });

  it('reads the forms EDR lists them in: ISO 8601 times, intervals and repeats', () => {
    const passes = (values: string[]) => messages(against({ values })).includes('Every time is among the times the collection lists');
    expect(passes([`R2/${T[0]}/PT6H`])).toBe(true);
    expect(passes([`R/${T[0]}/PT6H`])).toBe(true);
    expect(passes([`R1/${T[0]}/PT6H`])).toBe(false);
    expect(passes([`R4/${T[1]}/PT6H`])).toBe(false);
    expect(passes([`R4/${T[0]}/PT4H`])).toBe(false);
    expect(passes([`${T[0]}/${T[2]}`])).toBe(true);
    expect(passes([`${T[0]}/PT12H`])).toBe(true);
    expect(passes([`PT12H/${T[2]}`])).toBe(true);
    expect(passes([`PT11H/${T[2]}`])).toBe(false);
    expect(passes([`${T[1]}/..`])).toBe(false);
    expect(passes(['2026-11-08'])).toBe(true);
  });

  it('reads Polytope’s start/end/step, and makes an issue of it not being ISO 8601', () => {
    const notes = against({ values: [`${T[0]}/${T[1]}/PT6H`, `${T[1]}/${T[2]}/PT3H`] });
    expect(notes[0]).toEqual({ message: `The collection lists its times as ${T[0]}/${T[1]}/PT6H and 1 more like it. EDR asks for ISO 8601 times, intervals or durations, and start/end/step is none of them: read as that`, severity: 'warning', source: 'collection' });
    expect(notes[1].message).toBe('Every time is among the times the collection lists');
    expect(messages(against({ values: [`${T[0]}/${T[2]}/PT12H`] }))).toEqual([expect.stringMatching(/^The collection lists its times as .*\/PT12H\. EDR asks/), `t ${T[1]} isn't among the times the collection lists`]);
    // Up to its end and no further
    expect(messages(against({ values: [`${T[0]}/${T[1]}/PT6H`] }))[1]).toBe(`t ${T[2]} isn't among the times the collection lists`);
  });

  it('notes a list it can’t read, and checks nothing against it', () => {
    expect(against({ values: [T[0], `R2/${T[0]}/P1M`] })).toEqual([{ message: `The collection lists a time that can't be read, R2/${T[0]}/P1M, so the times aren't checked against its list`, severity: 'info', source: 'collection' }]);
    expect(messages(against({ values: [5] as unknown as string[] }))).toEqual(["The collection lists a time that can't be read, 5, so the times aren't checked against its list"]);
    expect(messages(against({ values: [2026] as unknown as string[] }))[0]).toMatch(/can't be read, 2026,/);
    expect(messages(against({ values: ['../..'] }))[0]).toMatch(/can't be read, \.\.\/\.\.,/);
    expect(messages(against({ values: [`${T[0]}/${T[1]}/${T[2]}/PT1H`] }))[0]).toMatch(/can't be read/);
    expect(against({ values: [] })).toEqual([]);
  });

  it('says of Polytope’s what its collection’s extent and list say', () => {
    const temporal = { interval: [['2026-11-06T00:00:00Z', '2026-11-21T00:00:00Z']], values: ['2026-11-07T00:00:00Z/2026-11-10T18:00:00Z/PT1H', '2026-11-10T21:00:00Z/2026-11-13T00:00:00Z/PT3H', '2026-11-13T06:00:00Z/2026-11-17T00:00:00Z/PT6H'] };
    expect(kinds(findings(polytopeArea, { temporal }).filter(note => note.source === 'collection'))).toEqual({
      "Every time is inside the collection's extent, 2026-11-06T00:00:00Z to 2026-11-21T00:00:00Z": 'pass',
      'The collection lists its times as 2026-11-07T00:00:00Z/2026-11-10T18:00:00Z/PT1H and 2 more like it. EDR asks for ISO 8601 times, intervals or durations, and start/end/step is none of them: read as that': 'warning',
      "t 2026-11-06T00:00:00Z isn't among the times the collection lists": 'warning',
    });
  });
});
