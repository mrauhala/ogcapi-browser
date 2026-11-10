import { useEffect, useRef } from 'react';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import GeoJSON from 'ol/format/GeoJSON';
import { getCenter } from 'ol/extent';
import { Point } from 'ol/geom';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle, Stroke, Style } from 'ol/style';
import { useMapInteraction } from '../contexts/MapInteractionContext';
import { featureLabel } from '../featureRows';
import { zoomToLocations, zoomToPoint } from '../mapView';

// Above every data layer, as a picked cell's mark is
const MARK_Z = 9000;
const FORMAT = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

// A ring around the location, or its outline, dark and light so that it shows on any layer. Wider than a location's
// marker, which the response's own layer draws orange, as the selected location is
const MARK_STYLE = [
  new Style({ image: new Circle({ radius: 11, stroke: new Stroke({ color: 'rgba(0,0,0,.9)', width: 4 }) }), stroke: new Stroke({ color: 'rgba(0,0,0,.9)', width: 5 }) }),
  new Style({ image: new Circle({ radius: 11, stroke: new Stroke({ color: '#fff', width: 2 }) }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
];

// The location picked in a response's list: the map goes to it as it does to one selected for a query, and marks it
// with its name. The query is left as it is
export function useResponseLocation(map: OLMap | null) {
  const { responseLocation } = useMapInteraction();
  const layers = useRef<{ marks: VectorSource; overlay: Overlay; label: HTMLDivElement } | null>(null);

  useEffect(() => {
    if (!map) return undefined;
    const marks = new VectorSource();
    const layer = new VectorLayer({ source: marks, zIndex: MARK_Z, style: MARK_STYLE, updateWhileInteracting: true, updateWhileAnimating: true });
    layer.set('layer', 'response-location-mark');
    const label = document.createElement('div');
    Object.assign(label.style, {
      background: 'rgba(0,0,0,.85)', color: '#fff', padding: '3px 7px', borderRadius: '4px', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'none',
    });
    const overlay = new Overlay({ element: label, positioning: 'bottom-left', offset: [12, -12], stopEvent: false });
    map.addLayer(layer);
    map.addOverlay(overlay);
    layers.current = { marks, overlay, label };
    return () => {
      map.removeLayer(layer);
      map.removeOverlay(overlay);
      layers.current = null;
    };
  }, [map]);

  useEffect(() => {
    const now = layers.current;
    if (!map || !now) return;
    now.marks.clear();
    now.overlay.setPosition(undefined);
    if (!responseLocation) return;

    // An API under test can send a geometry OpenLayers can't read: there's nothing to show then
    let read;
    try {
      read = FORMAT.readFeature(responseLocation);
    } catch {
      return;
    }
    const feature = Array.isArray(read) ? read[0] : read;
    const geometry = feature?.getGeometry();
    if (!geometry) return;
    now.marks.addFeature(feature);
    const name = featureLabel(responseLocation);
    now.label.textContent = name;
    if (name) now.overlay.setPosition(geometry instanceof Point ? geometry.getCoordinates() : getCenter(geometry.getExtent()));

    const view = map.getView();
    const coordinates = (responseLocation.geometry as { coordinates?: unknown }).coordinates;
    if (geometry instanceof Point && Array.isArray(coordinates)) zoomToPoint(view, coordinates);
    else zoomToLocations(view, geometry.getExtent());
  }, [map, responseLocation]);
}
