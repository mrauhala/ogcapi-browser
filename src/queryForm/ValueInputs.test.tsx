import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoxPickers } from './ValueInputs';
import type { Collection } from '../DataRetrievalAPI';
import { words } from '../coverage/cellsTestData';

const around = vi.hoisted(() => ({ viewExtent: null as [number, number, number, number] | null }));
vi.mock('../contexts/MapInteractionContext', () => ({ useMapInteraction: () => ({ setSelectedBbox: () => {}, viewExtent: around.viewExtent }) }));

const WITH_EXTENT = { id: 'c', extent: { spatial: { bbox: [[19, 59, 32, 71]] } } } as unknown as Collection;
const WITHOUT = { id: 'c' } as unknown as Collection;
const render = (collection: Collection, requiredByApiDocs = false, bboxAsCoords = false) => renderToStaticMarkup(
  <BoxPickers collection={collection} requiredByApiDocs={requiredByApiDocs} bboxAsCoords={bboxAsCoords} setBboxAsCoords={() => {}} />,
);
const buttons = (html: string) => html.split('<button').slice(1).map(button => ({ text: words(`<b${button}`), disabled: button.split('>')[0].includes('disabled') }));

describe('BoxPickers', () => {
  it('offers the map’s view, once there’s a map, and the collection’s extent where it has one', () => {
    around.viewExtent = null;
    expect(buttons(render(WITH_EXTENT))).toEqual([
      { text: 'Use the map view', disabled: true },
      { text: "Use the collection's extent", disabled: false },
    ]);
    around.viewExtent = [0, 0, 1, 1];
    expect(buttons(render(WITHOUT))).toEqual([{ text: 'Use the map view', disabled: false }]);
  });

  it('offers to send the box as coords too only where the API docs ask for coords, or it’s already on', () => {
    const label = "Also send the box as coords (the server's API docs require it)";
    expect(words(render(WITH_EXTENT))).not.toContain(label);
    expect(words(render(WITH_EXTENT, true))).toContain(label);
    expect(render(WITH_EXTENT, false, true)).toContain('checked=""');
  });
});
