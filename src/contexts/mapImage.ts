import { createContext, useContext, useLayoutEffect } from 'react';
import type { MapResponseReading } from '../query/mapResponse';

// The image of the latest map response, above the pane and the map, so that the two show the same thing: the map draws
// what the pane holds, with Data's opacity. This view never sends a request.

export interface MapImage {
  // A blob: URL, released when the next request is sent
  imageUrl: string;
  reading: MapResponseReading;
}

export interface MapImageChoices {
  // Data's image at the pane's size, or at its own
  fit: boolean;
  onMap: boolean;
  opacity: number;
}

export const INITIAL_MAP_IMAGE_CHOICES: MapImageChoices = { fit: true, onMap: true, opacity: 0.85 };

export interface MapImageValue {
  image: MapImage | null;
  choices: MapImageChoices;
  choose: (patch: Partial<MapImageChoices>) => void;
}

export const MapImageContext = createContext<MapImageValue>({ image: null, choices: INITIAL_MAP_IMAGE_CHOICES, choose: () => {} });
export const PublishMapImageContext = createContext<(image: MapImage | null) => void>(() => {});

export function useMapImage() {
  return useContext(MapImageContext);
}

// For the pane that shows the response to the request: what it holds is what the map draws. Null clears it, the moment
// a new request is sent, so the map never shows an old image under a new request
export function usePublishMapImage(image: MapImage | null) {
  const publish = useContext(PublishMapImageContext);
  useLayoutEffect(() => {
    publish(image);
  }, [publish, image]);
}
