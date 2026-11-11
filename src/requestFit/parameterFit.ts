import type { Collection, Temporal, ValidationError } from '../types/api';
import { EDR } from '../standards';
import { askedDatetime, extentInterval, meets } from '../coverage/timeChecks';
import { parameterIdsOf } from '../query/queryTypes';
import { askedParameters, dataQueryOf } from './dataQuery';

// Which parameters a data query's response holds, against the parameters it asked for, by EDR's
// /req/edr/parameter-name-response A: "If the parameter-name parameter is provided, only those parameters named SHALL be
// returned. If the parameter-name parameter is not specified all parameters in the collection SHALL be returned." Only
// those named, so one asked for and missing breaks nothing: a station may not measure it

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const pointerPart = (text: string) => text.replace(/~/g, '~0').replace(/\//g, '~1');
const plural = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;

// Past this a list of names says how many more
const MOST_NAMED = 3;
const names = (list: string[]) => {
  const said = list.length > MOST_NAMED ? [...list.slice(0, MOST_NAMED), `${list.length - MOST_NAMED} more`] : list;
  return said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}` : said.join('');
};

// A parameter the response holds, and where it first is
export interface Returned { id: string; path: string }

// A CoverageJSON response's: each with a range. Null for what isn't coverage data, or holds none
export function coverageParameters(json: unknown): Returned[] | null {
  if (!isObject(json)) return null;
  const collection = json.type === 'CoverageCollection' && Array.isArray(json.coverages);
  if (json.type !== 'Coverage' && !collection) return null;
  const found = new Map<string, Returned>();
  let ranged = false;
  (collection ? json.coverages as unknown[] : [json]).forEach((coverage, index) => {
    if (!isObject(coverage) || !isObject(coverage.ranges)) return;
    ranged = true;
    for (const id of Object.keys(coverage.ranges)) {
      if (!found.has(id)) found.set(id, { id, path: `${collection ? `/coverages/${index}` : ''}/ranges/${pointerPart(id)}` });
    }
  });
  return ranged ? [...found.values()] : null;
}

// A name and one sent for it: the same in any letter case, or a part named after it, as name.eastward_component
const sameButCase = (sent: string, name: string) => sent.toLowerCase() === name.toLowerCase();
const namedAfter = (sent: string, name: string) =>
  sent.length > name.length && sameButCase(sent.slice(0, name.length), name) && /[^\p{L}\p{N}]/u.test(sent[name.length]);

// A GeoJSON response's. No standard says where a feature's values are, so only properties named as a parameter the
// collection lists or the request asks for, in any letter case or as a part of one, are taken for parameters. Null where
// there's none, as for what isn't GeoJSON
export function featureParameters(json: unknown, known: string[]): Returned[] | null {
  if (!isObject(json) || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) return null;
  const found = new Map<string, Returned>();
  // Each name once, however many features have it
  const seen = new Set<string>();
  json.features.forEach((feature, index) => {
    const properties = isObject(feature) && isObject(feature.properties) ? feature.properties : {};
    for (const key of Object.keys(properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (known.some(name => sameButCase(key, name) || namedAfter(key, name))) {
        found.set(key, { id: key, path: `/features/${index}/properties/${pointerPart(key)}` });
      }
    }
  });
  return found.size > 0 ? [...found.values()] : null;
}

interface Renamed { name: string; sent: Returned[] }
interface Matched {
  exact: string[];
  // Sent under another name: in another letter case, or in parts named after it
  byCase: Renamed[];
  inParts: Renamed[];
  missing: string[];
  // Sent and not wanted
  extra: Returned[];
}

// The names wanted against those sent: each sent under its own name first, then under another, so that what's left in
// another letter case is another name
function matched(wanted: string[], returned: Returned[]): Matched {
  const left = new Map(returned.map(each => [each.id, each]));
  const exact = wanted.filter(name => left.delete(name));
  const result: Matched = { exact, byCase: [], inParts: [], missing: [], extra: [] };
  for (const name of wanted.filter(each => !exact.includes(each))) {
    const take = (test: (sent: string, name: string) => boolean) => {
      const sent = [...left.values()].filter(each => test(each.id, name));
      sent.forEach(each => left.delete(each.id));
      return sent;
    };
    const byCase = take(sameButCase);
    if (byCase.length) {
      result.byCase.push({ name, sent: byCase });
      continue;
    }
    const inParts = take(namedAfter);
    if (inParts.length) result.inParts.push({ name, sent: inParts });
    else result.missing.push(name);
  }
  result.extra = [...left.values()];
  return result;
}

const sentNames = (renamed: Renamed[]) => renamed.flatMap(each => each.sent.map(sent => sent.id));

// With parameter-name: only those asked for, under their names. One asked for in another letter case than the collection
// lists it, and sent as the collection lists it, is the request's slip, which the server forgave
function askedFindings(asked: string[], returned: Returned[], listed: string[]): ValidationError[] {
  const { exact, byCase, inParts, missing, extra } = matched(asked, returned);
  const findings: ValidationError[] = [];
  const forgiven = byCase.filter(({ name, sent }) => !listed.includes(name) && sent.every(each => listed.includes(each.id)));
  const renamedByCase = byCase.filter(each => !forgiven.includes(each));
  if (forgiven.length) {
    const what = forgiven.map(each => each.name);
    findings.push({
      severity: 'info', path: forgiven[0].sent[0].path, rule: EDR.parameterNameResponseB,
      message: `Asked for ${names(what)}, which the collection doesn't list, and the response has ${names(sentNames(forgiven))}, as the collection lists ${what.length === 1 ? 'it' : 'them'}: the server read the name${what.length === 1 ? '' : 's'} in any letter case`,
    });
  }
  if (renamedByCase.length) {
    findings.push({
      severity: 'error', path: renamedByCase[0].sent[0].path, rule: EDR.parameterNameResponseA,
      message: `Asked for ${names(renamedByCase.map(each => each.name))}, and the response has ${names(sentNames(renamedByCase))} instead: the names differ in letter case`,
    });
  }
  for (const { name, sent } of inParts) {
    findings.push({
      severity: 'error', path: sent[0].path, rule: EDR.parameterNameResponseA,
      message: `Asked for ${name}, and the response has ${plural(sent.length, 'parameter')} named after it instead: ${names(sent.map(each => each.id))}`,
    });
  }
  if (extra.length) {
    findings.push({
      severity: 'error', path: extra[0].path, rule: EDR.parameterNameResponseA,
      message: `The response has ${plural(extra.length, 'parameter')} not asked for: ${names(extra.map(each => each.id))}. Only those asked for must come back`,
    });
  }
  if (missing.length) {
    findings.push({ severity: 'info', message: `Asked for ${names(missing)}, and the response hasn't ${missing.length === 1 ? 'it' : 'them'}` });
  }
  if (exact.length === asked.length && extra.length === 0) {
    findings.push({ severity: 'pass', path: returned[0].path, rule: EDR.parameterNameResponseA, message: `The response has the parameters asked for, and only those: ${names(exact)}` });
  }
  return findings;
}

// The collection's parameters that, by their own extent, have no data at the datetime asked: EDR's Annex C gives a
// parameter an extent of its own, "if different from other parameters in the collection"
function outsideOwnExtent(collection: Collection, url: string): Set<string> {
  const asked = askedDatetime(url);
  const parameters = collection.parameter_names;
  if (!asked || asked === 'unreadable' || !isObject(parameters)) return new Set();
  return new Set(Object.entries(parameters).flatMap(([name, parameter]) => {
    const extent = isObject(parameter) && isObject(parameter.extent) ? parameter.extent : null;
    const interval = extent && isObject(extent.temporal) ? extentInterval(extent.temporal as Temporal) : null;
    return interval && !meets(interval.span, asked.span) ? [name] : [];
  }));
}

// Without parameter-name: every parameter the collection lists, but those with no data at the datetime asked
function allFindings(listed: string[], returned: Returned[], collection: Collection, url: string): ValidationError[] {
  const { exact, byCase, inParts, missing, extra } = matched(listed, returned);
  const findings: ValidationError[] = [];
  const against = (finding: ValidationError) => findings.push({ ...finding, source: 'collection' });
  const outside = outsideOwnExtent(collection, url);
  const absent = missing.filter(name => !outside.has(name));
  const excused = missing.filter(name => outside.has(name));
  const asked = askedDatetime(url);
  if (absent.length) {
    against({
      severity: 'error', rule: EDR.parameterNameResponseA,
      message: `No parameter-name was asked for, so every parameter the collection lists must come back, and ${plural(absent.length, 'parameter')} ${absent.length === 1 ? "doesn't" : "don't"}: ${names(absent)}`,
    });
  }
  if (byCase.length) {
    against({
      severity: 'error', path: byCase[0].sent[0].path, rule: EDR.parameterNameResponseA,
      message: `The response has ${names(sentNames(byCase))} where the collection lists ${names(byCase.map(each => each.name))}: the names differ in letter case`,
    });
  }
  for (const { name, sent } of inParts) {
    against({
      severity: 'error', path: sent[0].path, rule: EDR.parameterNameResponseA,
      message: `The response has ${plural(sent.length, 'parameter')} named after ${name} where the collection lists ${name}: ${names(sent.map(each => each.id))}`,
    });
  }
  if (extra.length) {
    // Data the metadata doesn't describe: the server's to fix, though no rule says the list is complete
    against({ severity: 'warning', path: extra[0].path, message: `The response has ${plural(extra.length, 'parameter')} the collection doesn't list: ${names(extra.map(each => each.id))}` });
  }
  if (excused.length && asked && asked !== 'unreadable') {
    const one = excused.length === 1;
    against({
      severity: 'info', rule: EDR.parameterObject,
      message: `${names(excused)} ${one ? "isn't" : "aren't"} in the response, and by ${one ? 'its' : 'their'} own extent ${one ? 'has' : 'have'} no data at the datetime asked, ${asked.text}`,
    });
  }
  if (absent.length === 0 && byCase.length === 0 && inParts.length === 0) {
    const count = exact.length;
    against({
      severity: 'pass', path: returned[0].path, rule: EDR.parameterNameResponseA,
      message: `No parameter-name was asked for, and the response has ${count === 1 ? 'the one parameter' : `all ${count} parameters`} the collection lists${excused.length ? ' with data at the datetime asked' : ''}`,
    });
  }
  return findings;
}

export interface ParameterContext {
  url: string;
  // The collection the request is for, if it's the open one
  collection: Collection | null;
}

export function askedParameterFindings(json: unknown, { url, collection }: ParameterContext): ValidationError[] {
  const query = dataQueryOf(url);
  const asked = askedParameters(url);
  if (!query || asked?.length === 0) return [];
  const listed = collection ? parameterIdsOf(collection) : [];
  const returned = coverageParameters(json) ?? featureParameters(json, [...listed, ...(asked ?? [])]);
  if (!returned) return [];
  if (asked) return askedFindings(asked, returned, listed);
  // An instance's parameters may not be its collection's, and the app doesn't have them
  return collection && !query.instance && listed.length > 0 ? allFindings(listed, returned, collection, url) : [];
}
