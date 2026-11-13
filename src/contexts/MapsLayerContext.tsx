import { createContext, useContext, useState, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';

export interface MapsLayer {
  // One per collection, source and choices: two parameters make two layers
  id: string;
  collectionId: string;
  styleId?: string;
  title: string;
  visible: boolean;
  opacity: number;
  zIndex?: number;
  sourceType: 'tiles' | 'dynamic';
  // For sourceType === 'tiles': tile URL template with {z}/{y}/{x} placeholders.
  tileUrl?: string;
  // For sourceType === 'dynamic': the map's URL without its query, the collection's /map or a style's, asked for each
  // view with the view's bbox, width, height and crs
  dynamicEndpoint?: string;
  // What every request asks besides the view or the tile, as the form had it when the layer was added: the parameter,
  // the time, the subset, elevation, f. A layer keeps these whatever the form chooses afterwards
  params: [string, string][];
  // For sourceType === 'dynamic': the map's CRS, EPSG:3857, as the collection lists it
  crs?: string;
  attribution?: string;
  apiKey?: string;
  apiKeyParam?: string;
  // Animation bundle membership: frames sharing a bundleId differ only by their datetime, frameTime.
  // Exactly one frame is shown at a time (driven by the bundle's currentIndex); per-frame
  // requests are issued separately (OGC API Maps returns one image per request).
  bundleId?: string;
  frameIndex?: number;
  frameTime?: string;
}

// Playback state for one animation bundle. currentIndex selects the visible frame.
export interface MapsBundleState {
  bundleId: string;
  collectionTitle: string;
  frameCount: number;
  currentIndex: number;
  isPlaying: boolean;
  fps: number;
}

interface MapsLayerContextValue {
  mapsLayers: MapsLayer[];
  setMapsLayers: Dispatch<SetStateAction<MapsLayer[]>>;
  mapsBundles: Record<string, MapsBundleState>;
  setMapsBundles: Dispatch<SetStateAction<Record<string, MapsBundleState>>>;
}

const MapsLayerContext = createContext<MapsLayerContextValue | null>(null);

export function MapsLayerProvider({ children }: { children: ReactNode }) {
  const [mapsLayers, setMapsLayers] = useState<MapsLayer[]>([]);
  const [mapsBundles, setMapsBundles] = useState<Record<string, MapsBundleState>>({});

  const value = useMemo(() => ({
    mapsLayers,
    setMapsLayers,
    mapsBundles,
    setMapsBundles,
  }), [mapsLayers, mapsBundles]);

  return (
    <MapsLayerContext.Provider value={value}>
      {children}
    </MapsLayerContext.Provider>
  );
}

export function useMapsLayers() {
  const context = useContext(MapsLayerContext);
  if (!context) {
    throw new Error('useMapsLayers must be used within a MapsLayerProvider');
  }
  return context;
}
