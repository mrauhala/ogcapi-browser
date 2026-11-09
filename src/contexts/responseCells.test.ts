import { describe, expect, it, vi } from 'vitest';
import { INITIAL_CHOICES, afterNewResponse, createHoverStore, pictureOf } from './responseCells';
import { readCells, type DrawableCells, type GridGeometry } from '../coverage/coverageCells';
import { grid } from '../coverage/cellsTestData';
import { readResponseCells } from '../coverage/sectionCells';
import fmiEc2param from '../coverage/__fixtures__/sections/fmi-ec-2param.json';

describe('afterNewResponse', () => {
  const before = {
    ...INITIAL_CHOICES,
    parameterId: 'a',
    steps: { t: 2 },
    ramp: 'diverging' as const,
    onMap: false,
    opacity: 0.3,
    range: 'set' as const,
    setLo: 1,
    setHi: 2,
    scope: 'this' as const,
    flip: 'ns' as const,
    levelSpacing: 'even' as const,
    zoom: { x0: 0, x1: 1, y0: 1, y1: 0 },
    pin: 7,
    litPinned: { kind: 'null' as const },
    litHover: { kind: 'above' as const },
  };

  it('keeps what’s being watched, and how it’s shown', () => {
    expect(afterNewResponse(before)).toMatchObject({ parameterId: 'a', steps: { t: 2 }, ramp: 'diverging', onMap: false, opacity: 0.3 });
  });

  it('drops what was about the last one, the flip above all', () => {
    expect(afterNewResponse(before)).toMatchObject({ range: 'auto', setLo: null, setHi: null, scope: null, flip: 'none', levelSpacing: null, zoom: null, pin: null, litPinned: null, litHover: null });
  });
});

describe('pictureOf', () => {
  const two = () => {
    const json = grid({ x: [1, 2], y: [60], t: ['2026-11-07T06:00:00Z', '2026-11-07T07:00:00Z'], values: [0, 10, 20, 30], id: 'a' }) as { ranges: Record<string, unknown> };
    json.ranges.b = { type: 'NdArray', axisNames: ['t', 'y', 'x'], shape: [2, 1, 2], values: [100, 200, 300, 400] };
    return readCells(json);
  };

  it('has nothing to draw without cells', () => {
    expect(pictureOf(null, INITIAL_CHOICES)).toBeNull();
    expect(pictureOf(readCells({}), INITIAL_CHOICES)).toBeNull();
  });

  it('starts on the first parameter and step', () => {
    expect(pictureOf(two(), INITIAL_CHOICES)).toMatchObject({ parameter: { id: 'a' }, slice: 0, scope: 'all', lo: 0, hi: 30 });
  });

  it('follows the parameter chosen, and falls back if this response hasn’t got it', () => {
    expect(pictureOf(two(), { ...INITIAL_CHOICES, parameterId: 'b' })?.parameter.id).toBe('b');
    expect(pictureOf(two(), { ...INITIAL_CHOICES, parameterId: 'gone' })?.parameter.id).toBe('a');
  });

  it('colours the step chosen on the shared scale', () => {
    const picture = pictureOf(two(), { ...INITIAL_CHOICES, steps: { t: 1 } })!;
    expect(picture.slice).toBe(1);
    expect(Array.from(picture.codes)).toEqual([170, 255]);
  });

  it('applies the flip and the range chosen', () => {
    expect(Array.from(pictureOf(two(), { ...INITIAL_CHOICES, flip: 'ew' })!.codes)).toEqual([85, 0]);
    expect(pictureOf(two(), { ...INITIAL_CHOICES, range: 'set', setLo: 5, setHi: 6 })).toMatchObject({ lo: 5, hi: 6 });
    expect(pictureOf(two(), { ...INITIAL_CHOICES, scope: 'this', steps: { t: 1 } })).toMatchObject({ scope: 'this', lo: 20, hi: 30 });
  });
});

describe('pictureOf, along a path', () => {
  const FMI_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf_painepinta/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)&z=1000,850,500&f=CoverageJSON';
  const reading = () => readResponseCells(fmiEc2param, { url: FMI_URL }) as DrawableCells;
  const gridOf = (cells: DrawableCells) => cells.geometry as GridGeometry;

  it('draws the plane as it was read, with its levels as their kind has them', () => {
    const cells = reading();
    expect(pictureOf(cells, INITIAL_CHOICES)!.cells).toBe(cells);
  });

  it('lays the levels out as chosen, and the same way each time', () => {
    const cells = reading();
    const even = pictureOf(cells, { ...INITIAL_CHOICES, levelSpacing: 'even' })!;
    expect(even.cells.section).toMatchObject({ spacing: 'even', flipped: false });
    expect([...gridOf(even.cells).yEdges]).not.toEqual([...gridOf(cells).yEdges]);
    expect(pictureOf(cells, { ...INITIAL_CHOICES, levelSpacing: 'even' })!.cells).toBe(even.cells);
  });

  it('turns the levels over with Flip, labels and all, and reads each value from where it was', () => {
    const cells = reading();
    const plain = pictureOf(cells, INITIAL_CHOICES)!;
    const flipped = pictureOf(cells, { ...INITIAL_CHOICES, flip: 'ns' })!;
    expect(gridOf(flipped.cells).ys).toEqual([1000, 850, 500]);
    expect(gridOf(flipped.cells).yEdges[0]).toBeCloseTo(1 - gridOf(cells).yEdges[3], 12);
    // The top row's codes are the bottom row's, as sent
    expect([...flipped.codes.subarray(0, 3)]).toEqual([...plain.codes.subarray(6, 9)]);
    expect(flipped.cells.section!.flipped).toBe(true);
  });

  it('leaves a grid as it was read, whatever the spacing chosen', () => {
    const cells = readCells(grid());
    expect(pictureOf(cells, { ...INITIAL_CHOICES, levelSpacing: 'even' })!.cells).toBe(cells);
  });
});

describe('createHoverStore', () => {
  it('tells its listeners when the cell changes, and only then', () => {
    const store = createHoverStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ cell: 1, under: 1 });
    expect(store.get()).toEqual({ cell: 1, under: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.set({ cell: 1, under: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.set({ cell: 1, under: 4 });
    expect(listener).toHaveBeenCalledTimes(2);
    store.set(null);
    expect(store.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    store.set(null);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops telling those who’ve gone', () => {
    const store = createHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set({ cell: 1, under: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
