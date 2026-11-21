import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { apiDocsParams, type ApiDocsParam } from './declared';
import { fieldSpecs, heldNames, type FieldSpec } from './fieldSpecs';
import { withLinkQueries } from './mapQuery';
import { mapOffer } from './mapOffer';
import { acceptOptions, mapMoreIssues, readBoolean, readColour, transparentIs } from './mapMore';
import { WEB_COLOURS } from './webColours';
import { buildOperationIndex } from '../validation/openapi/operationIndex';
import { COMMON1, MAPS1 } from '../standards';
import more from './__fixtures__/meteocore-maps-more.json';

const ROOT = 'https://meteocore.app.meteo.fi';
const collectionOf = (id: string) => withLinkQueries(structuredClone(more.collections.find(each => each.id === id)) as unknown as Collection);
// Storage EPSG:3067, and CRS84 with none
const radar = () => collectionOf('fmi-radar-composite-dbz');
const ifs = () => collectionOf('ecmwf-ifs-pressure');
// The radar's map operation, as /api serves it
const index = buildOperationIndex({ url: `${ROOT}/api`, doc: { paths: { [more.mapPath]: { get: { parameters: more.parameters } } } } });
const DOCS = apiDocsParams(index.entries[0].params);
const URI = (code: number) => `http://www.opengis.net/def/crs/EPSG/0/${code}`;
const without = (names: string[]) => more.conformsTo.filter(uri => !names.some(name => uri.endsWith(`/conf/${name}`)));

const specs = (collection: Collection, given: { inRequest?: string[]; conformsTo?: string[] | null; apiDocs?: ApiDocsParam[] | null } = {}) =>
  fieldSpecs(collection, 'map', { parameters: 0 }, {
    conformsTo: 'conformsTo' in given ? given.conformsTo : more.conformsTo, apiDocs: 'apiDocs' in given ? given.apiDocs : DOCS, inRequest: given.inRequest,
  }).filter(field => field.more);
const one = (fields: FieldSpec[], id: string) => fields.find(field => field.id === id)!;
const tags = (field: FieldSpec | undefined) => (field?.declaredBy ?? []).map(each => (each.kind === 'api-docs' ? 'API docs' : each.name));
const issuesOf = (q: Record<string, string>, collection = radar()) => mapMoreIssues(collection, q);

describe('a colour, as bgcolor and void-color take it', () => {
  // MeteoCore, 2026-11-17: 0x0000FF, red, RED and %23FF0000 drew; FF0000, 0xF00, 0x80FF0000 and notacolour were 400s
  it('is 0xRRGGBB, as Maps 1.0 writes its default, painted as CSS has it', () => {
    expect(readColour('0x336699')).toEqual({ form: 'hex', css: '#336699' });
    expect(readColour(' 0XABCDEF ')).toEqual({ form: 'hex', css: '#abcdef' });
  });

  it('is hexadecimal written another way, with #, or bare', () => {
    expect(readColour('#FF0000')).toEqual({ form: 'other-hex', css: '#ff0000' });
    expect(readColour('ff0000')).toEqual({ form: 'other-hex', css: '#ff0000' });
  });

  it('has an alpha first in eight digits, three digits short, and a W3C name in any case', () => {
    expect(readColour('0x80FF0000')).toEqual({ form: 'alpha', css: 'rgba(255, 0, 0, 0.502)' });
    expect(readColour('0x00336699')).toEqual({ form: 'alpha', css: 'rgba(51, 102, 153, 0)' });
    expect(readColour('0xF00')).toEqual({ form: 'short', css: '#f00' });
    expect(readColour('#F00')).toEqual({ form: 'short', css: '#f00' });
    expect(readColour('SteelBlue')).toEqual({ form: 'name', css: 'steelblue' });
    expect(readColour('RED')).toEqual({ form: 'name', css: 'red' });
  });

  it('is unread otherwise, and nothing while empty', () => {
    for (const text of ['notacolour', 'F00', '#80FF0000', '0x12345', 'transparent', '0x', '#', 'red;x', 'rgb(1,2,3)']) expect(readColour(text), text).toEqual({ form: 'unread' });
    expect(readColour('')).toBeNull();
    expect(readColour('  ')).toBeNull();
  });

  it('takes the 148 names of CSS Color 4, gray and grey both', () => {
    expect(WEB_COLOURS.size).toBe(148);
    for (const name of ['aliceblue', 'rebeccapurple', 'gray', 'grey', 'darkslategrey', 'yellowgreen']) expect(readColour(name), name).toMatchObject({ form: 'name' });
  });
});

describe('a Boolean, as transparent and void-transparent take it', () => {
  // MeteoCore, 2026-11-17: TRUE drew; yes and 1 were 400s, "must be true or false"
  it('is true or false, another case of either, or unread', () => {
    expect(['true', 'false', ' false '].map(readBoolean)).toEqual(['true', 'false', 'false']);
    expect(['TRUE', 'False'].map(readBoolean)).toEqual(['case', 'case']);
    expect(['yes', '1', 'truth', '0'].map(readBoolean)).toEqual(['unread', 'unread', 'unread', 'unread']);
    expect(readBoolean('')).toBeNull();
  });

  it('is transparent’s, given, else true without bgcolor and false with one', () => {
    expect(transparentIs('false', '')).toEqual({ value: 'false', given: true });
    expect(transparentIs('true', '0x0000FF')).toEqual({ value: 'true', given: true });
    expect(transparentIs('', '')).toEqual({ value: 'true', given: false });
    expect(transparentIs('', '0x0000FF')).toEqual({ value: 'false', given: false });
    // One that isn't a Boolean is no value: the default is said
    expect(transparentIs('yes', '')).toEqual({ value: 'true', given: false });
  });
});

describe('the formats to ask for by Accept', () => {
  const offer = (classes: string[] | null, docs: ApiDocsParam[] | null = DOCS) => mapOffer([], classes, docs);

  it('are the encoding classes the API declares, then the API docs’ f besides', () => {
    expect(acceptOptions(offer(more.conformsTo))).toEqual({ options: ['image/png', 'image/jpeg', 'image/webp'], classes: ['png', 'jpeg'], fromDocs: ['image/webp'] });
    const all = ['png', 'jpeg', 'jpegxl', 'tiff', 'svg', 'html'].map(name => `http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/${name}`);
    expect(acceptOptions(offer(all, null)).options).toEqual(['image/png', 'image/jpeg', 'image/jxl', 'image/tiff', 'image/svg+xml', 'text/html']);
  });

  it('are the API docs’ alone where no encoding is declared or the conformance isn’t known, and none without either', () => {
    expect(acceptOptions(offer(without(['png', 'jpeg']))).options).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(acceptOptions(offer(null))).toEqual({ options: ['image/png', 'image/jpeg', 'image/webp'], classes: [], fromDocs: ['image/png', 'image/jpeg', 'image/webp'] });
    expect(acceptOptions(offer(null, null))).toEqual({ options: [], classes: [], fromDocs: [] });
  });
});

describe('what’s under More for a map', () => {
  it('is the background, outside the CRS, the centre, the scale, the subset CRS, quality and Accept, each tagged by who declared it', () => {
    const fields = specs(radar());
    expect(fields.map(field => [field.id, field.unit?.name ?? null])).toEqual([
      ['transparent', 'bgcolor'], ['void-transparent', 'void-color'], ['center', 'center-crs'], ['scale-denominator', null], ['subset-crs', null], ['quality', null], ['accept', null],
    ]);
    expect(fields.map(field => field.title)).toEqual(['Background', 'Outside the CRS', 'Centre', 'Scale', 'Subset CRS', 'Quality', 'Format by Accept']);
    // A block's two names are tagged once each, the API docs where they list the first
    expect(fields.map(tags)).toEqual([
      ['background', 'API docs'], ['background', 'API docs'], ['spatial-subsetting', 'API docs'], ['scaling', 'API docs'], ['spatial-subsetting', 'API docs'], ['API docs'], ['core'],
    ]);
    const transparent = DOCS.find(param => param.name === 'transparent')!;
    expect(one(fields, 'transparent').declaredBy?.[1]).toEqual({ kind: 'api-docs', pointer: transparent.pointer });
    expect(fields.every(field => field.requirement === 'optional')).toBe(true);
  });

  it('says, citing it, what the server does while each is left out: nothing is filled in', () => {
    expect(specs(radar()).map(field => field.leftOut)).toEqual([
      { text: "transparent where there's no data: `transparent` is `true` without a `bgcolor`", rule: MAPS1.transparentDefault },
      { text: 'as the background: `transparent` and `bgcolor`, given or left out', rule: [MAPS1.voidTransparentDefault, MAPS1.voidColorDefault] },
      { text: 'no centre: the map covers the box, a spatial subset, or the whole map', rule: MAPS1.wholeMap },
      { text: 'the server works it out from the size and the area', rule: MAPS1.scaleDenominatorLeftOut },
      { text: 'CRS84', rule: MAPS1.subsetCrsDefault },
      "the server's default",
      "`*/*`, as the app sends it: the server's default format",
    ]);
  });

  it('says what each takes, citing the rule', () => {
    const fields = specs(radar());
    expect(one(fields, 'transparent').hints).toEqual([{ text: '`bgcolor`: `0xRRGGBB`, as `0x336699`, or a W3C colour name, as `white` or `SteelBlue`', rule: MAPS1.bgcolorDefinitionB }]);
    expect(one(fields, 'void-transparent').hints[0]).toMatchObject({ rule: MAPS1.voidColorDefinitionB });
    expect(one(fields, 'center').hints).toEqual([
      { text: "`center-crs` takes CRS84, the storage CRS or the `crs` asked; left out, it's CRS84", rule: [MAPS1.centerCrsDefinition, MAPS1.centerCrsDefault] },
      { text: 'Not with `bbox`, nor with a spatial axis in `subset`', rule: MAPS1.centerDefinition },
    ]);
    expect(one(fields, 'center').grammar).toBe('Typed: `lon,lat` in CRS84, else in the order of the CRS `center-crs` names (EPSG:4326 latitude first)');
    expect(one(fields, 'scale-denominator').hints.map(hint => (typeof hint === 'string' ? hint : hint.rule))).toEqual([MAPS1.scaleDenominatorMeaning, MAPS1.scaleDenominatorWithSize]);
    expect(one(fields, 'scale-denominator').grammar).toBe('A positive number');
    expect(one(fields, 'subset-crs').hints[0]).toMatchObject({ rule: [MAPS1.subsetCrsDefinition, MAPS1.subsetDefinition] });
  });

  it('gives quality what the API docs say of it, its first sentence and its schema’s range', () => {
    expect(one(specs(radar()), 'quality').hints).toEqual([
      'The API docs: Encoder quality for `image/webp` and `image/jpeg`, an integer from 1 to 100 (MeteoCore extension).',
      "From 1 to 100, by the API docs' schema",
    ]);
    const bare = DOCS.map(param => (param.name === 'quality' ? { ...param, description: undefined, minimum: undefined } : param));
    expect(one(specs(radar(), { apiDocs: bare }), 'quality').hints).toEqual([]);
  });

  it('asks for a format by Accept, a header and no parameter, from what the API says it makes', () => {
    const accept = one(specs(radar()), 'accept');
    expect(accept).toMatchObject({ name: 'Accept', header: true, options: ['image/png', 'image/jpeg', 'image/webp'] });
    expect(accept.hints).toEqual([
      { text: "Maps 1.0 negotiates a map's format by `Accept`. Sent as a header, which the line can't show; Copy as curl has it", rule: [MAPS1.mapResponseI, MAPS1.formatNegotiation] },
      "From the encodings the API declares, png and jpeg, and the API docs' `f`: `image/webp`",
    ]);
    expect(one(specs(radar(), { apiDocs: null }), 'accept').hints[1]).toBe('From the encodings the API declares, png and jpeg');
    expect(one(specs(radar(), { conformsTo: without(['jpeg']), apiDocs: null }), 'accept').hints[1]).toBe('From the encoding the API declares, png');
    expect(one(specs(radar(), { conformsTo: null, apiDocs: null }), 'accept')).toMatchObject({ options: [], hints: [expect.anything()], declaredBy: [] });
    // Not a name the form holds: a parameter called Accept is another parameter
    expect(heldNames(specs(radar()), 'map', []).has('Accept')).toBe(false);
    expect(heldNames(specs(radar()), 'map', []).has('bgcolor')).toBe(true);
  });

  it('shows each where a class or the API docs declare it, or the request has it, and quality only by the API docs', () => {
    expect(specs(radar(), { apiDocs: null }).map(field => [field.id, tags(field)])).toEqual([
      ['transparent', ['background']], ['void-transparent', ['background']], ['center', ['spatial-subsetting']], ['scale-denominator', ['scaling']],
      ['subset-crs', ['spatial-subsetting']], ['accept', ['core']],
    ]);
    expect(specs(radar(), { conformsTo: without(['background', 'scaling', 'spatial-subsetting']), apiDocs: null }).map(field => field.id)).toEqual(['accept']);
    expect(specs(radar(), { conformsTo: null, apiDocs: null }).map(field => field.id)).toEqual(['accept']);
    // A block for either of its names in the request, untagged where nobody declares it
    const asked = specs(radar(), { conformsTo: null, apiDocs: null, inRequest: ['bgcolor', 'void-transparent', 'center-crs', 'scale-denominator', 'subset-crs', 'quality'] });
    expect(asked.map(field => [field.id, tags(field)])).toEqual([
      ['transparent', []], ['void-transparent', []], ['center', []], ['scale-denominator', []], ['subset-crs', []], ['quality', []], ['accept', []],
    ]);
    expect(one(asked, 'quality').hints).toEqual([]);
  });
});

describe('what’s wrong under More', () => {
  it('has transparent and void-transparent not a Boolean an error, and in another case a warning, as values are case sensitive', () => {
    // MeteoCore: 400 "transparent 'yes' must be true or false"
    expect(issuesOf({ transparent: 'yes', 'void-transparent': 'maybe' })).toEqual([
      { id: 'maps:transparent:boolean', severity: 'error', source: 'maps', field: 'transparent', input: 'form',
        message: "transparent yes isn't true or false: Maps 1.0 makes it a Boolean", rule: [MAPS1.transparentDefinition, MAPS1.transparentBoolean] },
      { id: 'maps:void-transparent:boolean', severity: 'error', source: 'maps', field: 'void-transparent', input: 'form',
        message: "void-transparent maybe isn't true or false: Maps 1.0 makes it a Boolean", rule: [MAPS1.voidTransparentBoolean] },
    ]);
    expect(issuesOf({ transparent: 'TRUE' })).toEqual([{
      id: 'maps:transparent:boolean', severity: 'warning', source: 'maps', field: 'transparent', input: 'form',
      message: 'transparent TRUE is true in another case: values are case sensitive, and a server may not read it',
      rule: [MAPS1.transparentDefinition, MAPS1.transparentBoolean, COMMON1.caseSensitive],
    }]);
    expect(issuesOf({ transparent: 'true', 'void-transparent': 'false' })).toEqual([]);
  });

  it('has bgcolor and void-color neither hex nor a W3C name an error', () => {
    // MeteoCore: 400 "bgcolor 'notacolour' must be a hexadecimal colour 0xRRGGBB (or #RRGGBB) or a W3C web colour name"
    expect(issuesOf({ bgcolor: 'notacolour', 'void-color': 'nope' })).toEqual([
      { id: 'maps:bgcolor:colour', severity: 'error', source: 'maps', field: 'bgcolor', input: 'form',
        message: 'bgcolor notacolour is neither a hexadecimal colour, as 0x336699, nor a W3C colour name', rule: MAPS1.bgcolorDefinitionB },
      { id: 'maps:void-color:colour', severity: 'error', source: 'maps', field: 'void-color', input: 'form',
        message: 'void-color nope is neither a hexadecimal colour, as 0x336699, nor a W3C colour name', rule: MAPS1.voidColorDefinitionB },
    ]);
    expect(issuesOf({ bgcolor: '0x336699', 'void-color': 'SteelBlue' })).toEqual([]);
  });

  it('notes hexadecimal written otherwise than 0x, warns of three digits, and says eight are only permitted, for bgcolor alone', () => {
    const said = (q: Record<string, string>) => issuesOf(q).map(issue => [issue.field, issue.severity, issue.message, issue.rule]);
    expect(said({ bgcolor: '#FF0000' })).toEqual([['bgcolor', 'info', 'bgcolor #FF0000: Maps 1.0 writes a hexadecimal colour only as its default is, 0xFFFFFF, and a server may read only that', MAPS1.bgcolorDefinitionB]]);
    expect(said({ bgcolor: '0xF00' })).toEqual([['bgcolor', 'warning', 'bgcolor 0xF00 has three hexadecimal digits: Maps 1.0 describes six, two each for red, green and blue', MAPS1.bgcolorDefinitionB]]);
    expect(said({ bgcolor: '0x80FF0000' })).toEqual([['bgcolor', 'info', 'bgcolor 0x80FF0000 has eight digits, the first two its alpha, which Maps 1.0 only permits', MAPS1.bgcolorAlpha]]);
    expect(said({ 'void-color': '0x80FF0000' })).toEqual([
      ['void-color', 'warning', 'void-color 0x80FF0000 has eight digits: Maps 1.0 permits an alpha for bgcolor, not void-color', [MAPS1.voidColorDefinitionB, MAPS1.bgcolorAlpha]],
    ]);
  });

  it('has center not two numbers an error', () => {
    // MeteoCore: 400 "Invalid center value: 'a'", and "center must be two comma-separated coordinates in center-crs"
    const said = (center: string) => issuesOf({ center }).map(issue => [issue.id, issue.severity, issue.message, issue.rule]);
    expect(said('a,b')).toEqual([['maps:center:numbers', 'error', '"a" in center isn\'t a number', MAPS1.centerDefinitionA]]);
    expect(said('25')).toEqual([['maps:center:numbers', 'error', 'center has one number: it takes a coordinate on each axis of its CRS', MAPS1.centerDefinitionA]]);
    expect(said('25,')).toEqual([['maps:center:numbers', 'error', 'center has an empty value between its commas', MAPS1.centerDefinitionA]]);
    expect(said(' 25 , 62 ')).toEqual([]);
  });

  it('has center-crs and subset-crs checked as bbox-crs is: unused, not a valid value, an unsafe CURIE', () => {
    const said = (q: Record<string, string>, collection = radar()) => issuesOf(q, collection).map(issue => [issue.id, issue.severity, issue.message, issue.rule]);
    expect(said({ 'center-crs': URI(3067) })).toEqual([['maps:center-crs:alone', 'info', 'center-crs without center: the server ignores it', MAPS1.centerCrsAlone]]);
    expect(said({ center: '25,62', 'center-crs': URI(4326) })).toEqual([[
      'maps:center-crs:valid', 'warning', "EPSG:4326 isn't one of center-crs's valid values, CRS84, EPSG:3067 (the storage CRS): a server needn't take it", MAPS1.centerCrsDefinition,
    ]]);
    // The crs asked is one of them; the storage CRS only where the collection has one
    expect(said({ center: '25,62', 'center-crs': URI(4326), crs: URI(4326) })).toEqual([]);
    expect(said({ center: '25,62', 'center-crs': URI(3067) }, ifs())[0]).toMatchObject({ 2: "EPSG:3067 isn't one of center-crs's valid values, CRS84: a server needn't take it" });
    expect(said({ center: '25,62', 'center-crs': 'EPSG:3067' })).toEqual([[
      'maps:center-crs:curie', 'info', 'EPSG:3067 is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [EPSG:3067] SHALL be supported', MAPS1.subsettingCrsCurie,
    ]]);
    expect(said({ center: '25,62', 'center-crs': '[EPSG:3067]' })).toEqual([]);
    // subset-crs is used by a spatial axis of subset alone
    expect(said({ 'subset-crs': URI(3067), subset: 'time("2026-11-17T12:00:00Z")' })).toEqual([['maps:subset-crs:alone', 'info', 'subset-crs without a spatial axis in subset: the server ignores it', MAPS1.subsetCrsAlone]]);
    expect(said({ 'subset-crs': URI(3067), subset: 'E(41085:787090),N(6540069:7785896)' })).toEqual([]);
    expect(said({ 'subset-crs': URI(2393), subset: 'E(1:2)' })).toEqual([[
      'maps:subset-crs:valid', 'warning', "EPSG:2393 isn't one of subset-crs's valid values, CRS84, EPSG:3067 (the storage CRS): a server needn't take it", [MAPS1.subsetCrsDefinition, MAPS1.crsForBbox],
    ]]);
  });

  it('has scale-denominator not a positive number an error', () => {
    // MeteoCore: 400 "scale-denominator 'abc' must be a positive number", the same for 0 and -5; 1.5e6 drew
    const said = (scale: string) => issuesOf({ 'scale-denominator': scale }).map(issue => [issue.severity, issue.message, issue.rule]);
    expect(said('abc')).toEqual([['error', "scale-denominator abc isn't a number", MAPS1.scaleDenominatorDefinition]]);
    expect(said('0')).toEqual([['error', "scale-denominator 0 isn't positive: it's how many real-world units one on the display stands for", MAPS1.scaleDenominatorMeaning]]);
    expect(said('-5')[0][0]).toBe('error');
    expect(said('1.5e6')).toEqual([]);
    expect(said('5000000')).toEqual([]);
  });

  it('finds nothing in an empty request', () => {
    expect(issuesOf({})).toEqual([]);
  });
});
