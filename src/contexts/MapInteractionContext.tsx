import { createContext, useCallback, useContext, useState, useMemo, useRef, type ReactNode } from 'react';
import { geometryKindOf } from '../query/queryTypes';
import { convertLength } from '../query/units';
import type { BBox } from '../query/types';
import type { GeoJsonFeature } from '../featureRows';

interface MapInteractionContextValue {
  clickedCoords: [number, number][];
  setClickedCoords: (coords: [number, number][]) => void;
  selectedArea: [number, number][][];
  setSelectedArea: (area: [number, number][][]) => void;
  selectedBbox: BBox | null; // cube box, drawn on the map or typed in the builder
  setSelectedBbox: (bbox: BBox | null) => void;
  // Radius queries: the radius in radiusUnits, null and '' until chosen. Changing the unit converts the radius.
  radius: number | null;
  setRadius: (radius: number | null) => void;
  radiusUnits: string;
  setRadiusUnits: (units: string) => void;
  // The selected data query's EDR type (position, area, ...), '' for none. Switching to a type that
  // takes another kind of geometry clears the drawn geometry, and any other type clears the radius.
  dataQuery: string;
  setDataQuery: (queryType: string) => void;
  // Asks the map to put the query in view once its geometry is in place, as when a link opens one
  queryZoom: number;
  zoomToQueryWhenPlaced: () => void;
  // A location picked in a response's list, which the map goes to and marks. It isn't chosen for the query. Null for none
  responseLocation: GeoJsonFeature | null;
  showResponseLocation: (feature: GeoJsonFeature | null) => void;
  // Current OL view extent (EPSG:3857) and viewport size, updated on map move/resize.
  viewExtent: [number, number, number, number] | null;
  setViewExtent: (extent: [number, number, number, number] | null) => void;
  viewSize: [number, number] | null;
  setViewSize: (size: [number, number] | null) => void;
}

const MapInteractionContext = createContext<MapInteractionContextValue | null>(null);

export function MapInteractionProvider({ children }: { children: ReactNode }) {
  const [clickedCoords, setClickedCoords] = useState<[number, number][]>([]);
  const [selectedArea, setSelectedArea] = useState<[number, number][][]>([]);
  const [selectedBbox, setSelectedBbox] = useState<BBox | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [radiusUnits, setRadiusUnitsState] = useState<string>('');
  const radiusUnitsRef = useRef('');
  const [dataQuery, setDataQueryState] = useState<string>('');
  const dataQueryRef = useRef('');
  const [viewExtent, setViewExtent] = useState<[number, number, number, number] | null>(null);
  const [viewSize, setViewSize] = useState<[number, number] | null>(null);
  const [queryZoom, setQueryZoom] = useState(0);
  const zoomToQueryWhenPlaced = useCallback(() => setQueryZoom(count => count + 1), []);
  const [responseLocation, showResponseLocation] = useState<GeoJsonFeature | null>(null);

  // Points stay when switching position ↔ radius, a line trajectory ↔ corridor
  const setDataQuery = useCallback((queryType: string) => {
    if (geometryKindOf(queryType) !== geometryKindOf(dataQueryRef.current)) {
      setClickedCoords([]);
      setSelectedArea([]);
      setSelectedBbox(null);
    }
    // A radius and its unit are the radius query's, and nothing else's
    if (queryType !== 'radius') {
      setRadius(null);
      radiusUnitsRef.current = '';
      setRadiusUnitsState('');
    }
    dataQueryRef.current = queryType;
    setDataQueryState(queryType);
  }, []);

  const setRadiusUnits = useCallback((units: string) => {
    const from = radiusUnitsRef.current;
    if (units === from) return;
    setRadius(value => (value === null ? null : convertLength(value, from, units)));
    radiusUnitsRef.current = units;
    setRadiusUnitsState(units);
  }, []);

  const value = useMemo(() => ({
    clickedCoords,
    setClickedCoords,
    selectedArea,
    setSelectedArea,
    selectedBbox,
    setSelectedBbox,
    radius,
    setRadius,
    radiusUnits,
    setRadiusUnits,
    dataQuery,
    setDataQuery,
    queryZoom,
    zoomToQueryWhenPlaced,
    responseLocation,
    showResponseLocation,
    viewExtent,
    setViewExtent,
    viewSize,
    setViewSize,
  }), [clickedCoords, selectedArea, selectedBbox, radius, radiusUnits, setRadiusUnits, dataQuery, setDataQuery, viewExtent, viewSize, queryZoom, zoomToQueryWhenPlaced, responseLocation]);

  return (
    <MapInteractionContext.Provider value={value}>
      {children}
    </MapInteractionContext.Provider>
  );
}

export function useMapInteraction() {
  const context = useContext(MapInteractionContext);
  if (!context) {
    throw new Error('useMapInteraction must be used within a MapInteractionProvider');
  }
  return context;
}
