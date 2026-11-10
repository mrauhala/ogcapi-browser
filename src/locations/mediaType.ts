import type { ValidationError } from '../types/api';
import { readContentType } from '../coverage/mediaType';
import { EDR } from '../standards';

// What the Content-Type says of a GeoJSON FeatureCollection, a locations list or a data query's features, against EDR's
// /req/geojson/definition A, or /req/edr-geojson/definition A for an API declaring EDR GeoJSON, word for word the same
// in both classes and in 1.1 and 1.2: "200-responses of the server SHALL support the following media types:
// application/geo+json for resources that include feature content, and application/json for all other resources".
// That's what the server supports, which one response sent as another type doesn't show it lacks: the server's to fix,
// an issue rather than an error

const GEOJSON_TYPE = 'application/geo+json';
// CoverageJSON's, now and before OGC, by which a client going by the Content-Type reads the list as CoverageJSON
const COVJSON_TYPES = ['application/vnd.cov+json', 'application/prs.coverage+json'];

export function geojsonMediaTypeFindings(contentType: string, edrGeojson: boolean, list = true): ValidationError[] {
  const { type } = readContentType(contentType);
  const rule = edrGeojson ? EDR.edrGeojsonDefinition : EDR.geojsonDefinition;
  if (type === GEOJSON_TYPE) return [{ severity: 'pass', message: `Content-Type is ${GEOJSON_TYPE}`, rule }];
  const sent = type ? `Content-Type is ${type}` : 'The response has no Content-Type';
  const misread = COVJSON_TYPES.includes(type) ? ', CoverageJSON\'s, so a client going by it reads this GeoJSON as CoverageJSON' : '';
  return [{ severity: 'warning', message: `${sent}${misread}. EDR's for feature content${list ? ', such as a locations list,' : ''} is ${GEOJSON_TYPE}`, rule }];
}
