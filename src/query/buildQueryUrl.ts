import type { QueryModel } from './queryModel';
import { wholeValue } from './dimensionText';

// Parameters a query type takes from the builder's fields (queryParams)
export const TYPE_PARAMS: Readonly<Record<string, string[]>> = {
  corridor: ['corridor-width', 'width-units', 'corridor-height', 'height-units'],
  items: ['limit'],
};

const lonLat = ([lon, lat]: [number, number]) => `${lon.toFixed(3)} ${lat.toFixed(3)}`;
const ring = (polygon: [number, number][]) => polygon.map(([lon, lat]) => `${lon.toFixed(2)} ${lat.toFixed(2)}`).join(',');

function pointsWkt(points: [number, number][]): string {
  return points.length === 1 ? `POINT(${lonLat(points[0])})` : `MULTIPOINT(${points.map(p => `(${lonLat(p)})`).join(',')})`;
}

// A dimension's text as it is
function setDimension(params: URLSearchParams, name: string, text: string) {
  if (text) params.set(name, text);
  else params.delete(name);
}

// The request URL for a data query: the query's href with the chosen parameters and geometry
export function buildQueryUrl(model: QueryModel): string | null {
  if (!model.baseHref) return null;
  try {
    let url = new URL(model.baseHref);
    const { queryType } = model;

    if (queryType === 'locations' && model.locationFeature) {
      if (model.locationFeature.properties?.href) {
        url = new URL(model.locationFeature.properties.href);
      } else if (model.locationFeature.id) {
        const pathParts = url.pathname.split('/').filter(part => part.length > 0);
        const locationId = String(model.locationFeature.id);
        if (pathParts[pathParts.length - 1] !== locationId) {
          pathParts.push(locationId);
          url.pathname = '/' + pathParts.join('/');
        }
      }
    }

    const params = url.searchParams;
    // A locations query without a location lists the locations: EDR gives that list only bbox,
    // datetime and limit, and returns GeoJSON. The query's formats are a location's (MeteoCore
    // answers the list with f=CoverageJSON with 400).
    const listsLocations = queryType === 'locations' && !model.locationFeature;
    if (model.format && !listsLocations) params.set('f', model.format);
    else params.delete('f');
    // A feature list takes no data selection, even if one is left from another query type
    const selectsData = !model.rule?.featureList && !listsLocations;
    if (selectsData && model.parameters.length > 0) params.set('parameter-name', model.parameters.join(','));
    else params.delete('parameter-name');
    setDimension(params, 'datetime', model.datetime);
    // A level range goes in once both ends are picked: EDR 1.1 has only min/max, and 1.2 adds ../level and level/..,
    // so 850/ is neither, and 850/.. would choose the end for the user. The same for a custom dimension's range. The
    // form says what's missing meanwhile.
    setDimension(params, 'z', selectsData ? wholeValue(model.vertical) : '');
    Object.entries(model.customDims).forEach(([id, text]) => setDimension(params, id, selectsData ? wholeValue(text) : ''));

    const { points, polygons } = model;
    if (queryType === 'position' && points.length > 0) {
      params.set('coords', pointsWkt(points));
    } else if ((queryType === 'trajectory' || queryType === 'corridor') && points.length > 1) {
      params.set('coords', `LINESTRING(${points.map(lonLat).join(', ')})`);
    } else if (queryType === 'radius') {
      // Each as it's chosen: a radius typed before any point is clicked goes in
      const { value, units } = model.radius;
      if (points.length > 0) params.set('coords', pointsWkt(points));
      else params.delete('coords');
      if (value !== null) params.set('within', value.toString());
      else params.delete('within');
      if (units) params.set('within-units', units);
      else params.delete('within-units');
    } else if (queryType === 'items' && model.bbox) {
      params.set('bbox', model.bbox.map(edge => edge.toFixed(3)).join(','));
      params.delete('coords');
    } else if (queryType === 'cube' && model.bbox) {
      const [west, south, east, north] = model.bbox;
      params.set('bbox', [west, south, east, north].map(edge => edge.toFixed(3)).join(','));
      if (model.bboxAsCoords) {
        const corners: [number, number][] = [[west, south], [west, north], [east, north], [east, south], [west, south]];
        params.set('coords', `POLYGON((${corners.map(lonLat).join(',')}))`);
      } else {
        params.delete('coords');
      }
    } else if (queryType === 'area' && polygons.length > 0) {
      params.set('coords', polygons.length === 1
        ? `POLYGON((${ring(polygons[0])}))`
        : `MULTIPOLYGON(${polygons.map(polygon => `((${ring(polygon)}))`).join(',')})`);
    } else if (queryType !== 'locations') {
      params.delete('coords');
      params.delete('within');
      params.delete('within-units');
      params.delete('bbox');
    }
    for (const name of TYPE_PARAMS[queryType] ?? []) {
      const value = model.queryParams[name]?.trim();
      if (value) params.set(name, value);
      else params.delete(name);
    }

    return url.toString();
  } catch {
    return model.baseHref;
  }
}
