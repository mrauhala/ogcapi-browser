import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ResponseImage from './ResponseImage';
import { INITIAL_MAP_IMAGE_CHOICES, MapImageContext, type MapImageChoices } from './contexts/mapImage';
import { readImageBytes, readMapResponse, type ImageBytes } from './query/mapResponse';
import { words } from './coverage/cellsTestData';
import fixture from './query/__fixtures__/meteocore-map-responses.json';
import type { Collection } from './types/api';

type Name = keyof typeof fixture.responses;
const imageOf = (name: Name): ImageBytes => readImageBytes(Uint8Array.from(atob(fixture.responses[name].start), char => char.charCodeAt(0)));
const readingOf = (name: Name, contentType = 'image/png') => readMapResponse({
  url: fixture.responses[name].url, headers: fixture.responses[name].headers, contentType, image: imageOf(name), collection: fixture.collection as unknown as Collection,
});

const render = (props: Partial<Parameters<typeof ResponseImage>[0]>, choices: Partial<MapImageChoices> = {}) => renderToStaticMarkup(
  <MapImageContext.Provider value={{ image: null, choices: { ...INITIAL_MAP_IMAGE_CHOICES, ...choices }, choose: () => {} }}>
    <ResponseImage imageUrl="blob:abc" image={imageOf('matchView')} contentType="image/png" reading={null} {...props} />
  </MapImageContext.Provider>,
);
const count = (html: string, text: string) => html.split(text).length - 1;
// The opacity slider's classes, as rendered
const sliderClass = (html: string) => {
  const at = html.indexOf('class="MuiSlider-root') + 'class="'.length;
  return html.slice(at, html.indexOf('"', at));
};
// The checkbox's input, as rendered
const checkbox = (html: string) => html.slice(html.lastIndexOf('<input', html.indexOf('On the map')), html.indexOf('>', html.lastIndexOf('<input', html.indexOf('On the map'))) + 1);

describe('ResponseImage', () => {
  it('an image that isn’t a map: Fit and 1:1, and the image on the checkerboard, nothing else', () => {
    const html = render({});
    expect(html).toContain('src="blob:abc"');
    expect(html).toContain('>Fit</button>');
    expect(html).toContain('>1:1</button>');
    expect(html).not.toContain('On the map');
    expect(html).not.toContain('What the headers say');
    expect(html).toContain('linear-gradient(45deg');
  });

  it('Fit keeps the image within the pane; 1:1 is its own size, its pixels square-edged', () => {
    const fit = render({});
    expect(fit).toContain('max-width:100%;max-height:100%');
    expect(fit).toContain('image-rendering:auto');
    expect(count(fit, 'aria-pressed="true"')).toBe(1);
    expect(fit.indexOf('aria-pressed="true"')).toBeLessThan(fit.indexOf('>Fit<'));
    const actual = render({}, { fit: false });
    expect(actual).toContain('max-width:none;max-height:none');
    expect(actual).toContain('image-rendering:pixelated');
    expect(actual.indexOf('aria-pressed="true"')).toBeGreaterThan(actual.indexOf('>Fit<'));
  });

  it("a map the map can place: On the map on, its opacity, and the rows with what each is against", () => {
    const html = render({ reading: readingOf('matchView') });
    expect(checkbox(html)).toContain('checked=""');
    expect(checkbox(html)).not.toContain('disabled');
    expect(html).toContain('aria-label="Opacity of the image on the map"');
    expect(html).toContain('aria-label="What the headers say, against what was asked"');
    const text = words(html);
    expect(text).toContain('image 478 × 721 px, PNG = width × height asked');
    expect(text).toContain('Content-Crs EPSG:3857 = crs asked');
    expect(text).toContain('Content-Bbox 1725452.11, 8073093.61, 3951841.92, 11402272.16 = 15.500, 58.500, 35.500, 71.000 lon/lat = bbox asked');
    expect(text).toContain('Content-Datetime 2026-11-16T15:25:00Z none asked: the server chose');
    expect(text).toContain("a pixel 4,658 × 4,617 m (Web Mercator) not square: 715 px tall keeps the box's shape");
    expect(count(html, 'role="row"')).toBe(5);
  });

  it('colours each verdict by its tone', () => {
    const html = render({ reading: readingOf('matchView') });
    const verdict = (text: string) => html.slice(html.lastIndexOf('<span', html.indexOf(text)), html.indexOf(text));
    // Emotion's classes differ by colour: the same tone, the same class
    expect(verdict('= crs asked')).toBe(verdict('= bbox asked').replace('= bbox asked', '= crs asked'));
    expect(verdict('= crs asked')).not.toBe(verdict('none asked: the server chose'));
    expect(verdict('= crs asked')).not.toBe(verdict('not square'));
  });

  it("a map it can't place: On the map off and disabled, the reason as its tooltip, and the opacity off", () => {
    const reading = readingOf('bare');
    const html = render({ reading, image: imageOf('bare') });
    expect(checkbox(html)).toContain('disabled');
    expect(checkbox(html)).not.toContain('checked');
    expect(html).toContain(`aria-label="The response isn&#x27;t drawn here: it&#x27;s in EPSG:3067 (Content-Crs), and the map can place only CRS84, EPSG:4326 and EPSG:3857. Data shows it"`);
    expect(sliderClass(html)).toContain('Mui-disabled');
    expect(words(html)).toContain('Content-Crs EPSG:3067 = storageCrs, as none was asked');
  });

  it('On the map turned off in Data: unchecked, and the opacity with it', () => {
    const html = render({ reading: readingOf('matchView') }, { onMap: false });
    expect(checkbox(html)).not.toContain('checked');
    expect(checkbox(html)).not.toContain('disabled');
    expect(sliderClass(html)).toContain('Mui-disabled');
    // And on while it's on
    expect(sliderClass(render({ reading: readingOf('matchView') }))).not.toContain('Mui-disabled');
  });

  it("bytes that aren't the image the Content-Type says: what they start with, and no image", () => {
    const html = render({ image: imageOf('widthZero'), reading: readingOf('widthZero') });
    expect(words(html)).toContain('The body isn\'t the image its Content-Type says: it starts with {"code":"BadRequest","de. Raw shows it.');
    expect(html).not.toContain('<img');
    expect(words(html)).toContain('image The body isn\'t a PNG: it starts with {"code":"BadRequest","de Content-Type image/png');
  });
});
