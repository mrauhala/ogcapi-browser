import { useEffect, useRef } from 'react';
import { Feature } from 'ol';
import type OLMap from 'ol/Map';
import { LineString, Point, Polygon } from 'ol/geom';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { useMapImage } from '../contexts/mapImage';
import type { BBox } from '../query/types';
import type { Edge, Edges } from '../query/mapResponse';

// Above the base map's bottom layer, and under what the layer manager numbers from 1, such as the box asked for and the
// markers, as the grid response's layer is
const LAYER_Z = 0;

const OUTLINE_STYLE = [
  new Style({ stroke: new Stroke({ color: 'rgba(0,0,0,.7)', width: 3 }) }),
  new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,.9)', width: 1.25, lineDash: [6, 4] }) }),
];
const LABEL_STYLE = new Style({
  text: new Text({
    text: 'Content-Bbox',
    font: '11px sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    offsetX: 4,
    offsetY: 4,
    fill: new Fill({ color: '#fff' }),
    backgroundFill: new Fill({ color: 'rgba(0,0,0,.75)' }),
    padding: [2, 4, 2, 4],
  }),
});

// A lon/lat box as a ring in the map's Web Mercator: meridians and parallels are straight there
export const ringOf = ([west, south, east, north]: BBox) => [[west, south], [west, north], [east, north], [east, south], [west, south]].map(corner => fromLonLat(corner));

// An edge of a lon/lat box, as a line in Web Mercator
export function edgeLine([west, south, east, north]: BBox, edge: Edge): number[][] {
  const ends: Record<Edge, number[][]> = {
    west: [[west, south], [west, north]],
    east: [[east, south], [east, north]],
    south: [[west, south], [east, south]],
    north: [[west, north], [east, north]],
  };
  return ends[edge].map(end => fromLonLat(end));
}

// The edges a box asked for has that the response's Content-Bbox hasn't, as lines to draw dotted: none where they're the
// same box
export function differingEdgeLines(box: BBox, edges: Edges): Feature[] {
  return (Object.keys(edges) as Edge[]).filter(edge => edges[edge]).map(edge => new Feature(new LineString(edgeLine(box, edge))));
}

// The latest map response's image on the map, at its Content-Bbox, in its Content-Crs, with Data's opacity: one slot, not
// a stack, which empties the moment a new request is sent. It never moves the map
export function useMapImageLayer(map: OLMap | null) {
  const { image, choices } = useMapImage();
  const place = image?.reading.place ?? null;
  const shows = !!place && choices.onMap;
  const imageLayer = useRef<ImageLayer<ImageStatic> | null>(null);
  const outline = useRef<VectorSource | null>(null);

  useEffect(() => {
    if (!map) return undefined;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, zIndex: LAYER_Z, style: feature => (feature.getGeometry() instanceof Point ? LABEL_STYLE : OUTLINE_STYLE) });
    layer.set('layer', 'response-image-outline');
    map.addLayer(layer);
    outline.current = source;
    return () => {
      map.removeLayer(layer);
      outline.current = null;
    };
  }, [map]);

  // A static image's source is its URL: a new response is a new layer
  useEffect(() => {
    if (!map || !image || !place) return undefined;
    const layer = new ImageLayer({
      source: new ImageStatic({ url: image.imageUrl, imageExtent: place.extent, projection: place.projection, interpolate: false }),
      zIndex: LAYER_Z,
      visible: false,
    });
    layer.set('layer', 'response-image');
    map.addLayer(layer);
    imageLayer.current = layer;
    return () => {
      map.removeLayer(layer);
      imageLayer.current = null;
    };
  }, [map, image, place]);

  useEffect(() => {
    imageLayer.current?.setVisible(shows);
    imageLayer.current?.setOpacity(choices.opacity);
    const source = outline.current;
    if (!source) return;
    source.clear();
    if (shows && place) {
      const [west, , , north] = place.lonLat;
      source.addFeatures([new Feature(new Polygon([ringOf(place.lonLat)])), new Feature(new Point(fromLonLat([west, north])))]);
    }
  }, [map, image, place, shows, choices.opacity]);

  return {
    shows,
    place: shows ? place : null,
    // Why there's no image on the map, for the line that says so
    notPlaced: image && !place ? image.reading.notPlaced : null,
  };
}
