import type { Collection, ValidationError } from '../types/api';
import { EDR } from '../standards';
import { readContentType } from '../coverage/mediaType';
import { matchDataQuery } from '../query/parseQueryUrl';
import { queryVariables } from '../query/queryTypes';
import { paramOf } from '../query/requestUrl';
import { dataQueryOf } from './dataQuery';

// Whether a data query's response is in the format asked for. With f, by EDR's /req/edr/REQ_rc-f-response A: "If the f
// parameter is provided, the returned information SHOULD be transformed to the defined data format"; without, by its C:
// "If f value is not defined the returned data SHOULD be in the default format specified by the default_output_format
// attribute of the collections metadata response". EDR 1.1 writes both in lower case. A SHOULD, so an issue. CoverageJSON
// and GeoJSON are told by their body, as their media types are checked on their own; the rest by each format's media type

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

interface Format { label: string; names: string[]; types: string[]; body?: 'CoverageJSON' | 'GeoJSON' }

// The formats known by name, in any letter case. Another name isn't checked
const FORMATS: Format[] = [
  { label: 'CoverageJSON', names: ['coveragejson', 'covjson'], types: ['application/vnd.cov+json', 'application/prs.coverage+json'], body: 'CoverageJSON' },
  { label: 'GeoJSON', names: ['geojson'], types: ['application/geo+json'], body: 'GeoJSON' },
  { label: 'JSON', names: ['json'], types: ['application/json'] },
  { label: 'CSV', names: ['csv'], types: ['text/csv'] },
  { label: 'HTML', names: ['html'], types: ['text/html'] },
  { label: 'PNG', names: ['png'], types: ['image/png'] },
  { label: 'JPEG', names: ['jpeg', 'jpg'], types: ['image/jpeg'] },
];

const COVERAGE_TYPES = ['Coverage', 'CoverageCollection', 'Domain'];
const FEATURE_TYPES = ['FeatureCollection', 'Feature'];

function bodyFormat(json: unknown): Format['body'] | null {
  const type = isObject(json) ? json.type : undefined;
  if (typeof type !== 'string') return null;
  if (COVERAGE_TYPES.includes(type)) return 'CoverageJSON';
  return FEATURE_TYPES.includes(type) ? 'GeoJSON' : null;
}

// JSON is any JSON, CoverageJSON and GeoJSON too
const isJsonType = (type: string) => type === 'application/json' || type.endsWith('+json');

function isIn(format: Format, json: unknown, type: string): boolean {
  if (format.body) return bodyFormat(json) === format.body;
  if (format.label === 'JSON') return json !== null || isJsonType(type);
  return format.types.includes(type);
}

// What it is instead, where that can be said: by its body, else by its Content-Type
function insteadOf(format: Format, json: unknown, type: string): string | null {
  const body = bodyFormat(json);
  if (body) return body;
  if (json !== null) return 'JSON';
  const byType = FORMATS.find(each => each.types.includes(type));
  if (byType) return byType === format ? null : byType.label;
  return type || null;
}

// The query's default, from the collection's metadata, for a request of one of its own data queries
function defaultFormat(url: string, collection: Collection | null): string | null {
  if (!collection) return null;
  const target = matchDataQuery(url, collection);
  const value = target ? queryVariables(collection, target.queryKey)?.default_output_format : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface FormatContext {
  url: string;
  // The collection the request is for, if it's the open one
  collection: Collection | null;
}

// The response's body read as JSON, if it is JSON, and its Content-Type
export function askedFormatFindings(json: unknown, contentType: string, { url, collection }: FormatContext): ValidationError[] {
  if (!dataQueryOf(url)) return [];
  const asked = paramOf(url, 'f');
  const name = asked ?? defaultFormat(url, collection);
  const format = name ? FORMATS.find(each => each.names.includes(name.trim().toLowerCase())) : undefined;
  if (!name || !format) return [];
  const { type } = readContentType(contentType);
  const instead = insteadOf(format, json, type);
  const said = instead ? `: it's ${instead}` : '';
  if (asked !== null) {
    return [isIn(format, json, type)
      ? { severity: 'pass', message: `f=${asked}, and the response is ${format.label}`, rule: EDR.fResponseA }
      : { severity: 'warning', message: `f=${asked}, and the response isn't ${format.label}${said}`, rule: EDR.fResponseA }];
  }
  return [isIn(format, json, type)
    ? { severity: 'pass', message: `No f was asked for, and the response is ${name}, the query's default_output_format`, rule: EDR.fResponseC }
    : { severity: 'warning', message: `No f was asked for, and the response isn't ${name}, the query's default_output_format${said}`, rule: EDR.fResponseC }];
}
