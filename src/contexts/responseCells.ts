import { createContext, useContext, useLayoutEffect } from 'react';
import type { CellFigures } from '../coverage/cellFigures';
import { codesFor, colourRange, figuresInScope, scopeOf, sliceIndex, type Flip, type RangeMode, type RangeScope } from '../coverage/cellSelection';
import type { Highlight, RampKind } from '../coverage/colourScale';
import type { CellParameter, CellsReading, DrawableCells } from '../coverage/coverageCells';
import type { PlotView } from '../coverage/paintCells';
import { planeFor } from '../coverage/sectionCells';
import type { LevelSpacing } from '../coverage/verticalAxis';

// The cells of the latest response, above the pane and the map, so that the two show the same thing: the same
// parameter, step and colours. This view never sends a request.

export interface CellsChoices {
  parameterId: string | null;
  steps: Record<string, number>;
  range: RangeMode;
  setLo: number | null;
  setHi: number | null;
  ramp: RampKind;
  scope: RangeScope | null;
  // On a section, 'ns' turns the level axis over, labels and all, as the profile's Flip does
  flip: Flip;
  // How a section's levels are spaced. Null for its default
  levelSpacing: LevelSpacing | null;
  onMap: boolean;
  opacity: number;
  zoom: PlotView | null;
  pin: number | null;
  // Lit by clicking a bar in the legend, and by pointing at one
  litPinned: Highlight | null;
  litHover: Highlight | null;
}

export const INITIAL_CHOICES: CellsChoices = {
  parameterId: null,
  steps: {},
  range: 'auto',
  setLo: null,
  setHi: null,
  ramp: 'sequential',
  scope: null,
  flip: 'none',
  levelSpacing: null,
  onMap: true,
  opacity: 0.85,
  zoom: null,
  pin: null,
  litPinned: null,
  litHover: null,
};

// A new response keeps which parameter and step are being watched, and how it's shown. What was about the last one goes
export const afterNewResponse = (choices: CellsChoices): CellsChoices => ({
  ...choices,
  range: 'auto',
  setLo: null,
  setHi: null,
  scope: null,
  flip: 'none',
  levelSpacing: null,
  zoom: null,
  pin: null,
  litPinned: null,
  litHover: null,
});

// What the choices come to
export interface CellsPicture {
  cells: DrawableCells;
  parameter: CellParameter;
  slice: number;
  scope: RangeScope;
  figures: CellFigures;
  lo: number | null;
  hi: number | null;
  codes: Uint16Array;
}

export function pictureOf(reading: CellsReading | null, { parameterId, steps, range, setLo, setHi, ramp, scope, flip, levelSpacing }: CellsChoices): CellsPicture | null {
  if (!reading?.drawable) return null;
  // A section's plane is laid out as its levels are chosen to be. A grid is as it was read
  const cells = reading.section ? planeFor(reading, levelSpacing ?? reading.section.defaultSpacing, flip === 'ns') : reading;
  const parameter = cells.parameters.find(candidate => candidate.id === parameterId) ?? cells.parameters[0];
  const theScope = scopeOf(cells, scope);
  const figures = figuresInScope(parameter, cells, theScope, steps);
  const [lo, hi] = colourRange(figures, range, setLo, setHi, ramp);
  const slice = sliceIndex(cells.dims, steps);
  return { cells, parameter, slice, scope: theScope, figures, lo, hi, codes: codesFor(parameter, cells, slice, lo, hi, flip) };
}

export interface CellHover {
  cell: number;
  // How many cells share the pixel it was pointed at through
  under: number;
}

// Pointing changes nothing in React's tree but the readout, so that moving the pointer doesn't re-render the pane
export interface HoverStore {
  get: () => CellHover | null;
  set: (hover: CellHover | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let current: CellHover | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(hover) {
      if (hover?.cell === current?.cell && hover?.under === current?.under) return;
      current = hover;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface ResponseCellsValue {
  reading: CellsReading | null;
  picture: CellsPicture | null;
  choices: CellsChoices;
  choose: (patch: Partial<CellsChoices>) => void;
  // What the legend has lit
  lit: Highlight | null;
  hover: HoverStore;
  // The request this response answered
  url: string;
  openInRaw: ((pointer: string) => void) | null;
  drawAnyway: () => void;
}

export interface CellsSource {
  json: unknown;
  url: string;
  openInRaw: ((pointer: string) => void) | null;
}

export const NO_SOURCE: CellsSource = { json: null, url: '', openInRaw: null };

export const ResponseCellsContext = createContext<ResponseCellsValue>({
  reading: null,
  picture: null,
  choices: INITIAL_CHOICES,
  choose: () => {},
  lit: null,
  hover: createHoverStore(),
  url: '',
  openInRaw: null,
  drawAnyway: () => {},
});
export const PublishContext = createContext<(source: CellsSource) => void>(() => {});

export function useResponseCells() {
  return useContext(ResponseCellsContext);
}

// For the pane that shows the response to the request: what it holds is what the map draws. Null clears it, the moment
// a new request is sent, so the map never shows old data under a new request
export function usePublishResponseCells(json: unknown, url: string, openInRaw: (pointer: string) => void) {
  const publish = useContext(PublishContext);
  useLayoutEffect(() => {
    publish({ json, url, openInRaw });
  }, [publish, json, url, openInRaw]);
}
