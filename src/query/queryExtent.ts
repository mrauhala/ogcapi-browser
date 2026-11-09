// The part of the world a query covers, in lon/lat, from what's chosen on the map or typed: its points or path, its
// polygons, its box, and a radius around its points. Null if it has nothing on the map
export type LonLatExtent = [west: number, south: number, east: number, north: number];

// About a metre's share of a degree of latitude; a degree of longitude shrinks with the cosine of the latitude
const METERS_PER_DEGREE = 111320;

export function queryExtent({ points = [], polygons = [], bbox = null, radiusMeters = 0 }: {
  points?: [number, number][];
  polygons?: [number, number][][];
  bbox?: LonLatExtent | null;
  radiusMeters?: number;
}): LonLatExtent | null {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = (lon: number, lat: number) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  const around = radiusMeters > 0 ? radiusMeters : 0;
  for (const [lon, lat] of points) {
    const dLat = around / METERS_PER_DEGREE;
    const dLon = around / (METERS_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    take(lon - dLon, Math.max(-90, lat - dLat));
    take(lon + dLon, Math.min(90, lat + dLat));
  }
  for (const ring of polygons) for (const [lon, lat] of ring) take(lon, lat);
  if (bbox) {
    take(bbox[0], bbox[1]);
    take(bbox[2], bbox[3]);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}
