import type { ValidationError } from '../types/api';
import { EDR, RFC } from '../standards';

// Whether a locations list names its locations. A client takes a location's id for /locations/{locationId}, and EDR asks
// for a list of them: 8.2.8, "If a location id is not defined, the API implementation SHALL return a GeoJSON features
// array of valid location identifiers"; /req/edr/rc-locations B (1.1's D), "If a locationId is not specified a list of
// valid locationId's SHALL be returned". EDR never says which member holds the id; GeoJSON's is the feature's id, RFC 7946
// 3.2: "If a Feature has a commonly used identifier, that identifier SHOULD be included as a member of the Feature object
// with the name "id", and the value of this member is either a JSON string or number". Found over the features, once a
// kind, as the schema's findings are

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// An id a client can put in the URL: a string with something in it, or a number
const hasId = (feature: Json) => (typeof feature.id === 'string' && feature.id !== '') || typeof feature.id === 'number';
const hasEndpoint = (feature: Json) => {
  const endpoint = isObject(feature.properties) ? feature.properties.edrqueryendpoint : undefined;
  return typeof endpoint === 'string' && endpoint !== '';
};

const ofAll = (count: number, total: number) => `${count.toLocaleString('en')} of ${total.toLocaleString('en')}`;
const have = (count: number) => (count === 1 ? 'has' : 'have');

export function locationIdFindings(features: readonly unknown[]): ValidationError[] {
  if (features.length === 0) return [];
  const items = features.map(each => (isObject(each) ? each : {}));
  const unnamed = items.flatMap((feature, index) => (hasId(feature) ? [] : [index]));
  if (unnamed.length === 0) {
    return [{ severity: 'pass', message: `Every location has an id: ${ofAll(features.length, features.length)}`, rule: [EDR.locationsList, RFC.featureId] }];
  }
  const findings: ValidationError[] = [{
    severity: 'warning',
    path: `/features/${unnamed[0]}`,
    message: `${ofAll(unnamed.length, features.length)} locations ${have(unnamed.length)} no id, so a client can't tell what to put in /locations/{locationId}`,
    rule: [EDR.locationsQuery, EDR.locationsList, RFC.featureId],
  }];
  const unreachable = unnamed.filter(index => !hasEndpoint(items[index]));
  if (unreachable.length > 0) {
    findings.push({
      severity: 'info',
      path: `/features/${unreachable[0]}`,
      message: `${ofAll(unreachable.length, features.length)} locations ${have(unreachable.length)} neither an id nor an edrqueryendpoint, so a client can't name or reach them`,
      rule: EDR.locationsQuery,
    });
  }
  return findings;
}
