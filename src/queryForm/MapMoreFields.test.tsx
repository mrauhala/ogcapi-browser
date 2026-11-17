import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Collection } from '../types/api';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { withLinkQueries } from '../query/mapQuery';
import { words } from '../coverage/cellsTestData';
import { MAPS1 } from '../standards';
import { AcceptValue, BackgroundValue, CenterValue, ColourSwatch, SubsetCrsValue } from './MapMoreFields';
import more from '../query/__fixtures__/meteocore-maps-more.json';

// What the controls read from around them: the request line
const around = vi.hoisted(() => ({ requestUrl: '' }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: more.conformsTo, apiUrl: 'https://meteocore.app.meteo.fi' }) }));

const RADAR = 'https://meteocore.app.meteo.fi/collections/fmi-radar-composite-dbz/map';
// Storage EPSG:3067; ecmwf-ifs-pressure has none
const radar = () => withLinkQueries(structuredClone(more.collections[0]) as unknown as Collection);
const ifs = () => withLinkQueries(structuredClone(more.collections[1]) as unknown as Collection);
const URI = (code: number) => `http://www.opengis.net/def/crs/EPSG/0/${code}`;

let written: [string, string][] = [];
const state = { setQueryParam: (name: string, value: string) => written.push([name, value]) } as unknown as UseQueryUrlReturn;
const at = (query: string) => {
  around.requestUrl = `${RADAR}${query ? `?${query}` : ''}`;
};

beforeEach(() => {
  written = [];
  at('');
});

// The elements a component gives, depth first: its controls' props, to call as a click would
type Props = Record<string, unknown>;
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (!React.isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap(elements) : [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
const toggles = (node: React.ReactNode, label: string) => elements(node).find(element => element.props.label === label)!;
const pick = (node: React.ReactNode, label: string, value: string) => (toggles(node, label).props.onChange as (value: string) => void)(value);
// A component inside, rendered as React would, for its own controls
const inside = (node: React.ReactNode, name: string) => {
  const element = elements(node).find(each => each.props.name === name && typeof each.type === 'function')!;
  return (element.type as (props: Props) => React.ReactNode)(element.props);
};
const shown = (html: string) => words(html).replace(/\s+/g, ' ').trim();
const eachButton = (html: string) => html.split('<button').slice(1).map(each => `<button${each.slice(0, each.indexOf('</button>'))}</button>`);
const labels = (html: string) => eachButton(html).map(shown);
const pressed = (html: string) => eachButton(html).filter(each => each.includes('aria-pressed="true"')).map(shown);

describe('a colour’s swatch', () => {
  it('paints the colour typed, over a checkerboard that shows through an alpha', () => {
    const html = renderToStaticMarkup(<ColourSwatch text="0x336699" />);
    expect(html).toContain('aria-label="The colour 0x336699"');
    expect(html).toContain('linear-gradient(#336699, #336699)');
    expect(html).toContain('border-style:solid');
    expect(renderToStaticMarkup(<ColourSwatch text=" SteelBlue " />)).toContain('linear-gradient(steelblue, steelblue)');
    expect(renderToStaticMarkup(<ColourSwatch text=" SteelBlue " />)).toContain('aria-label="The colour SteelBlue"');
    expect(renderToStaticMarkup(<ColourSwatch text="0x80FF0000" />)).toContain('linear-gradient(rgba(255, 0, 0, 0.502), rgba(255, 0, 0, 0.502))');
  });

  it('is an empty dashed square while there’s none, or one the form can’t read', () => {
    for (const text of ['', 'nope', 'red;background:url(x)']) {
      const html = renderToStaticMarkup(<ColourSwatch text={text} />);
      expect(html, text).toContain('aria-label="No colour"');
      expect(html, text).toContain('border-style:dashed');
      expect(html, text).not.toContain('gradient');
    }
  });
});

const background = (outside = false) => <BackgroundValue queryState={state} outside={outside} colourText={<i>colour</i>} />;
const callBackground = (outside = false) => BackgroundValue({ queryState: state, outside, colourText: null });

describe('the background', () => {
  it('is true and false, true marked the default, with the colour typed beside, and nothing more said while it’s all left out', () => {
    const html = renderToStaticMarkup(background());
    expect(labels(html)).toEqual(['true default', 'false']);
    expect(pressed(html)).toEqual([]);
    expect(html).toContain('<i>colour</i>');
    expect(html).toContain('id="query-field-bgcolor"');
    expect(shown(html)).toBe('true default false colour');
  });

  it('marks false the default with a bgcolor, and says so, citing D', () => {
    at('bgcolor=0x0000FF');
    const html = renderToStaticMarkup(background());
    expect(shown(eachButton(html)[1])).toBe('false default');
    expect(shown(html)).toContain("transparent left out is false , as there's a bgcolor : the map is drawn on it");
    expect(html).toContain(`href="${MAPS1.transparentWithBgcolor.url}"`);
  });

  it('says a bgcolor doesn’t show with transparent true, citing E, and where bgcolor comes from with false, citing C', () => {
    at('transparent=true&bgcolor=red');
    let html = renderToStaticMarkup(background());
    expect(pressed(html)).toEqual(['true']);
    expect(shown(html)).toContain("With transparent=true , bgcolor has an opacity of 0: it doesn't show");
    expect(html).toContain(`href="${MAPS1.transparentOpacity.url}"`);
    at('transparent=false');
    html = renderToStaticMarkup(background());
    expect(pressed(html)).toEqual(['false']);
    expect(shown(html)).toContain("bgcolor left out: the style's background colour, else a neutral one such as white, 0xFFFFFF by its definition");
    expect(html).toContain(`href="${MAPS1.bgcolorStyle.url}"`);
    expect(html).toContain(`href="${MAPS1.bgcolorNeutral.url}"`);
    expect(html).toContain(`href="${MAPS1.bgcolorDefinition.url}"`);
    // Both given: nothing to say; and transparent true without a bgcolor is the default, with nothing to say either
    at('transparent=false&bgcolor=red');
    expect(shown(renderToStaticMarkup(background()))).toBe('true false default colour');
    at('transparent=true');
    expect(shown(renderToStaticMarkup(background()))).toBe('true default false colour');
  });

  it('writes transparent as picked, and takes it back', () => {
    pick(callBackground(), 'transparent', 'false');
    pick(callBackground(), 'transparent', '');
    expect(written).toEqual([['transparent', 'false'], ['transparent', '']]);
  });

  it('shows a value that isn’t true or false as the request has it, pressed beside them', () => {
    at('transparent=yes');
    const html = renderToStaticMarkup(background());
    expect(labels(html)).toEqual(['true default', 'false', 'yes']);
    expect(pressed(html)).toEqual(['yes']);
  });
});

describe('outside the CRS', () => {
  it('marks transparent’s, given or left out, the default for void-transparent', () => {
    expect(shown(eachButton(renderToStaticMarkup(background(true)))[0])).toBe('true default');
    at('transparent=false');
    expect(shown(eachButton(renderToStaticMarkup(background(true)))[1])).toBe('false default');
    at('bgcolor=red');
    expect(shown(eachButton(renderToStaticMarkup(background(true)))[1])).toBe('false default');
    expect(renderToStaticMarkup(background(true))).toContain('id="query-field-void-color"');
  });

  it('says what the one left out is, once the other is given, citing C', () => {
    expect(shown(renderToStaticMarkup(background(true)))).toBe('true default false colour');
    at('transparent=false&void-color=red');
    let html = renderToStaticMarkup(background(true));
    expect(shown(html)).toContain('void-transparent left out is false , as transparent is');
    expect(html).toContain(`href="${MAPS1.voidTransparentDefault.url}"`);
    expect(shown(html)).not.toContain('void-color left out');
    at('bgcolor=0x0000FF&void-transparent=false');
    html = renderToStaticMarkup(background(true));
    expect(shown(html)).toContain("void-color left out is bgcolor 's, 0x0000FF");
    expect(html).toContain(`href="${MAPS1.voidColorDefault.url}"`);
    at('void-transparent=false');
    html = renderToStaticMarkup(background(true));
    expect(shown(html)).toContain("void-color left out is bgcolor 's, given or left out");
    expect(shown(html)).not.toContain('void-transparent left out');
  });

  it('writes void-transparent as picked', () => {
    pick(callBackground(true), 'void-transparent', 'true');
    expect(written).toEqual([['void-transparent', 'true']]);
  });
});

describe('the centre and the subset’s CRS', () => {
  it('has center and center-crs side by side, and center-crs’s valid values to pick, the crs asked among them', () => {
    let html = renderToStaticMarkup(<CenterValue collection={radar()} queryState={state} centerText={<i>center</i>} centerCrsText={<i>center-crs</i>} />);
    expect(html).toContain('<i>center</i>');
    expect(html).toContain('id="query-field-center-crs"');
    expect(labels(html)).toEqual(['CRS84', 'EPSG:3067']);
    at(`crs=${URI(3857)}&center-crs=${URI(3857)}`);
    html = renderToStaticMarkup(<CenterValue collection={radar()} queryState={state} centerText={null} centerCrsText={null} />);
    expect(labels(html)).toEqual(['CRS84', 'EPSG:3067', 'EPSG:3857']);
    expect(pressed(html)).toEqual(['EPSG:3857']);
    pick(inside(CenterValue({ collection: radar(), queryState: state, centerText: null, centerCrsText: null }), 'center-crs'), 'center-crs', URI(3067));
    expect(written).toEqual([['center-crs', URI(3067)]]);
  });

  it('has subset-crs typed, and its valid values to pick: CRS84 alone without a storage CRS or a crs asked', () => {
    let html = renderToStaticMarkup(<SubsetCrsValue collection={ifs()} queryState={state} text={<i>subset-crs</i>} />);
    expect(html).toContain('<i>subset-crs</i>');
    expect(labels(html)).toEqual(['CRS84']);
    at(`subset-crs=${URI(3067)}`);
    html = renderToStaticMarkup(<SubsetCrsValue collection={radar()} queryState={state} text={null} />);
    expect(pressed(html)).toEqual(['EPSG:3067']);
    pick(inside(SubsetCrsValue({ collection: radar(), queryState: state, text: null }), 'subset-crs'), 'subset-crs', '');
    expect(written).toEqual([['subset-crs', '']]);
  });
});

describe('the Accept header', () => {
  const OPTIONS = ['image/png', 'image/jpeg', 'image/webp'];

  it('is typed, with what the API says it makes to pick, pressed where it’s one of them', () => {
    let html = renderToStaticMarkup(<AcceptValue options={OPTIONS} accept="" setAccept={() => {}} />);
    expect(html).toContain('aria-label="Accept"');
    expect(html).toContain('placeholder="A media type, as image/jpeg"');
    expect(labels(html)).toEqual(OPTIONS);
    expect(pressed(html)).toEqual([]);
    html = renderToStaticMarkup(<AcceptValue options={OPTIONS} accept="image/jpeg" setAccept={() => {}} />);
    expect(html).toContain('value="image/jpeg"');
    expect(pressed(html)).toEqual(['image/jpeg']);
    // A list with weights stays typed, none pressed
    html = renderToStaticMarkup(<AcceptValue options={OPTIONS} accept="image/jpeg;q=1, image/png;q=0.1" setAccept={() => {}} />);
    expect(pressed(html)).toEqual([]);
    // No row of formats where there are none to pick
    expect(renderToStaticMarkup(<AcceptValue options={[]} accept="" setAccept={() => {}} />)).not.toContain('role="group"');
    expect(renderToStaticMarkup(<AcceptValue options={OPTIONS} accept="" setAccept={() => {}} />)).toContain('role="group"');
  });

  it('sets the header as picked, or typed on one line', () => {
    const set: string[] = [];
    const value = AcceptValue({ options: OPTIONS, accept: '', setAccept: accept => set.push(accept) });
    pick(value, 'Accept', 'image/webp');
    const field = elements(value).find(element => typeof element.props.onChange === 'function' && element.props.placeholder)!;
    (field.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'image/png\r\n' } });
    expect(set).toEqual(['image/webp', 'image/png']);
  });
});
