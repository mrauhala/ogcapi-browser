import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TemporalExtent from './TemporalExtent';
import VerticalExtent from './VerticalExtent';
import { words } from './coverage/cellsTestData';

// The colours an alert is shown in, by MUI's class for each
const colours = (html: string) => [...html.matchAll(/MuiAlert-color(Success|Warning|Error|Info)/g)].map(match => match[1]);

// Both parts of an extent are optional, and the data may have no levels or times: none of them is a fault
describe('a collection without a vertical or temporal extent', () => {
  it('notes it has no vertical extent', () => {
    const html = renderToStaticMarkup(<VerticalExtent vertical={undefined} subsection="G.3: Vertical Extent (Optional)" />);
    expect(words(html)).toContain('G.3: Vertical Extent (Optional) No vertical extent information available for this collection.');
    expect(colours(html)).toEqual(['Info']);
  });

  it('notes it has no temporal extent', () => {
    const html = renderToStaticMarkup(<TemporalExtent temporal={undefined} subsection="G.2: Temporal Extent (Optional)" />);
    expect(words(html)).toContain('G.2: Temporal Extent (Optional) No temporal extent information available for this collection.');
    expect(colours(html)).toEqual(['Info']);
  });

  it('passes one that has levels', () => {
    const html = renderToStaticMarkup(<VerticalExtent vertical={{ interval: [['1000', '500']], vrs: 'VERTCRS["p",VDATUM["x"],CS[vertical,1],AXIS["Pressure (hPa)",down]]' }} />);
    expect(colours(html)).toEqual(['Success']);
  });
});
