import { describe, expect, it } from 'vitest';
import type { LineString } from 'ol/geom';
import { toLonLat } from 'ol/proj';
import { differingEdgeLines, edgeLine, ringOf } from './useMapImageLayer';

const lonLat = (points: number[][]) => points.map(point => toLonLat(point).map(value => Number(value.toFixed(6))));

describe('the box asked against Content-Bbox, on the map', () => {
  it("a box's ring, corner by corner and closed, in Web Mercator", () => {
    expect(lonLat(ringOf([19, 59, 32, 70]))).toEqual([[19, 59], [19, 70], [32, 70], [32, 59], [19, 59]]);
  });

  it('each edge as a line along it', () => {
    const box: [number, number, number, number] = [19, 59, 32, 70];
    expect(lonLat(edgeLine(box, 'west'))).toEqual([[19, 59], [19, 70]]);
    expect(lonLat(edgeLine(box, 'east'))).toEqual([[32, 59], [32, 70]]);
    expect(lonLat(edgeLine(box, 'south'))).toEqual([[19, 59], [32, 59]]);
    expect(lonLat(edgeLine(box, 'north'))).toEqual([[19, 70], [32, 70]]);
  });

  it('only the edges that differ, and none for the same box', () => {
    const none = { west: false, south: false, east: false, north: false };
    expect(differingEdgeLines([19, 59, 32, 70], none)).toEqual([]);
    const north = differingEdgeLines([19, 59, 32, 70], { ...none, north: true });
    expect(north.map(feature => lonLat((feature.getGeometry() as LineString).getCoordinates()))).toEqual([[[19, 70], [32, 70]]]);
    expect(differingEdgeLines([19, 59, 32, 70], { west: true, south: true, east: true, north: true })).toHaveLength(4);
  });
});
