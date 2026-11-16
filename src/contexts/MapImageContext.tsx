import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { INITIAL_MAP_IMAGE_CHOICES, MapImageContext, PublishMapImageContext, type MapImage, type MapImageChoices } from './mapImage';

export function MapImageProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<MapImage | null>(null);
  // Kept across responses, as the grid's are
  const [choices, setChoices] = useState<MapImageChoices>(INITIAL_MAP_IMAGE_CHOICES);
  const choose = useCallback((patch: Partial<MapImageChoices>) => setChoices(current => ({ ...current, ...patch })), []);
  const value = useMemo(() => ({ image, choices, choose }), [image, choices, choose]);
  return (
    <PublishMapImageContext.Provider value={setImage}>
      <MapImageContext.Provider value={value}>{children}</MapImageContext.Provider>
    </PublishMapImageContext.Provider>
  );
}
