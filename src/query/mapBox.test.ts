import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { apiDocsParams } from './declared';
import { fieldSpecs, type FieldSpec } from './fieldSpecs';
import { withLinkQueries } from './mapQuery';
import { mapOffer, mapProfileNames } from './mapOffer';
import {
  CRS84_URI, apiDocsLeftOut, bboxCrsChoices, boxAcross, boxInCrs84, boxLonLat, boxTextIn, crsCode, drawableCrs, drawnBoxSaid, isUnsafeCurie, keptShape, mapBoxIssues, mapLineIssues,
  outputCrs, readBox, sameCrs, shortCrs, viewMatch,
} from './mapBox';
import { buildOperationIndex, type MapLimits } from '../validation/openapi/operationIndex';
import { MAPS1 } from '../standards';
import box from './__fixtures__/meteocore-maps-box.json';

const ROOT = 'https://meteocore.app.meteo.fi';
const collectionOf = (id: string) => withLinkQueries(structuredClone(box.collections.find(each => each.id === id)) as unknown as Collection);
const radar = () => collectionOf('fmi-radar-composite-dbz');
const ifs = () => collectionOf('ecmwf-ifs-pressure');
// No storageCrs
const norway = () => collectionOf('met-norway-radar');
// The radar's map operation, as /api serves it
const index = buildOperationIndex({ url: `${ROOT}/api`, doc: { paths: { [box.mapPath]: { get: { parameters: box.parameters } } } } });
const DOCS = apiDocsParams(index.entries[0].params);
const URI = (code: number) => `http://www.opengis.net/def/crs/EPSG/0/${code}`;
const offer = (classes: string[] | null = box.conformsTo) => mapOffer(mapProfileNames(radar()), classes, DOCS);
const specs = (collection: Collection, more: { inRequest?: string[]; conformsTo?: string[] | null; apiDocs?: typeof DOCS | null; mapLimits?: MapLimits | null } = {}) =>
  fieldSpecs(collection, 'map', { parameters: 0 }, {
    conformsTo: 'conformsTo' in more ? more.conformsTo : box.conformsTo, apiDocs: 'apiDocs' in more ? more.apiDocs : DOCS, inRequest: more.inRequest, mapLimits: more.mapLimits,
  });
const one = (fields: FieldSpec[], id: string) => fields.find(field => field.id === id);
const tags = (field: FieldSpec | undefined) => (field?.declaredBy ?? []).map(each => (each.kind === 'api-docs' ? 'API docs' : each.name));

describe('a CRS, however it’s written', () => {
  it('is CRS84 or EPSG:n from a URI, a safe or unsafe CURIE, a URN or a short identifier', () => {
    for (const crs of [CRS84_URI, 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', '[OGC:CRS84]', 'OGC:CRS84', 'CRS:84', 'crs84', 'urn:ogc:def:crs:OGC:1.3:CRS84']) {
      expect(crsCode(crs), crs).toBe('CRS84');
    }
    for (const crs of [URI(3857), 'https://www.opengis.net/def/crs/EPSG/0/3857', '[EPSG:3857]', 'EPSG:3857', ' epsg:3857 ', 'urn:ogc:def:crs:EPSG::3857']) {
      expect(crsCode(crs), crs).toBe('EPSG:3857');
    }
    for (const crs of ['', 'CRS84h', 'http://example.org/my-crs', 'EPSG:', '3857']) expect(crsCode(crs), crs).toBeNull();
  });

  it('is the same CRS by what it is, else by its text', () => {
    expect(sameCrs(URI(4326), '[EPSG:4326]')).toBe(true);
    expect(sameCrs(URI(4326), CRS84_URI)).toBe(false);
    expect(sameCrs('http://example.org/a', 'http://example.org/a')).toBe(true);
    expect(sameCrs('http://example.org/a', 'http://example.org/b')).toBe(false);
    expect(sameCrs('', '')).toBe(false);
    expect(sameCrs('EPSG:3857', 'http://example.org/a')).toBe(false);
  });

  it('shows short, as its code', () => {
    expect(shortCrs(URI(3067))).toBe('EPSG:3067');
    expect(shortCrs(CRS84_URI)).toBe('CRS84');
    expect(shortCrs(' http://example.org/a ')).toBe('http://example.org/a');
  });

  it('is an unsafe CURIE without its brackets: not a URI, a URN or a safe CURIE', () => {
    expect(['EPSG:3857', 'CRS:84', 'OGC:CRS84'].map(isUnsafeCurie)).toEqual([true, true, true]);
    expect(['[EPSG:3857]', URI(3857), 'urn:ogc:def:crs:EPSG::3857', 'CRS84', ''].map(isUnsafeCurie)).toEqual([false, false, false, false, false]);
  });
});

describe('the CRS a map comes back in', () => {
  it('is the crs asked, else storageCrs, else CRS84', () => {
    expect(outputCrs(radar(), ` ${URI(3857)} `)).toEqual({ crs: URI(3857), from: 'crs' });
    expect(outputCrs(radar(), '')).toEqual({ crs: URI(3067), from: 'storageCrs' });
    expect(outputCrs(norway(), ' ')).toEqual({ crs: CRS84_URI, from: 'CRS84' });
  });
});

describe('bbox-crs’s valid values', () => {
  it('are CRS84, the storage CRS where it’s another, and the crs asked, as the collection lists them', () => {
    expect(bboxCrsChoices(radar(), '')).toEqual([
      { value: CRS84_URI, label: 'CRS84', why: 'CRS84' },
      { value: URI(3067), label: 'EPSG:3067', why: 'storage' },
    ]);
    expect(bboxCrsChoices(radar(), URI(3857)).map(choice => [choice.label, choice.why])).toEqual([['CRS84', 'CRS84'], ['EPSG:3067', 'storage'], ['EPSG:3857', 'crs asked']]);
    // The crs asked, as it's asked
    expect(bboxCrsChoices(radar(), 'EPSG:3857')[2]).toEqual({ value: 'EPSG:3857', label: 'EPSG:3857', why: 'crs asked' });
    // Each once
    expect(bboxCrsChoices(radar(), '[EPSG:3067]')).toHaveLength(2);
    expect(bboxCrsChoices(ifs(), CRS84_URI)).toEqual([{ value: CRS84_URI, label: 'CRS84', why: 'CRS84' }]);
    expect(bboxCrsChoices(norway(), '').map(choice => choice.label)).toEqual(['CRS84']);
    // CRS84 by its URI where the collection lists none, and as it lists it where it does
    expect(bboxCrsChoices({ id: 'x', links: [] } as unknown as Collection, '')[0].value).toBe(CRS84_URI);
    expect(bboxCrsChoices({ ...norway(), crs: ['https://www.opengis.net/def/crs/OGC/1.3/CRS84'] } as Collection, '')[0])
      .toEqual({ value: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', label: 'CRS84', why: 'CRS84' });
  });
});

describe('a box', () => {
  it('is four or six numbers', () => {
    expect(readBox(' ')).toBeNull();
    expect(readBox('19, 59 ,32,70')).toEqual({ numbers: [19, 59, 32, 70] });
    expect(readBox('19,59,850,32,70,500')).toEqual({ numbers: [19, 59, 850, 32, 70, 500] });
    expect(readBox('19,59,32')).toEqual({ error: 'bbox has 3 numbers: Maps 1.0 takes four, or six for a box with heights' });
    expect(readBox('19')).toEqual({ error: 'bbox has 1 number: Maps 1.0 takes four, or six for a box with heights' });
    expect(readBox('19,59,east,70')).toEqual({ error: '"east" in bbox isn\'t a number' });
    expect(readBox('19,,32,70')).toEqual({ error: 'bbox has an empty value between its commas' });
  });

  it('is drawn and drawable in CRS84, EPSG:4326 and EPSG:3857 only', () => {
    expect(drawableCrs('')).toBe('CRS84');
    expect(drawableCrs(CRS84_URI)).toBe('CRS84');
    expect(drawableCrs('[EPSG:4326]')).toBe('EPSG:4326');
    expect(drawableCrs(URI(3857))).toBe('EPSG:3857');
    expect(drawableCrs(URI(3067))).toBeNull();
    expect(drawableCrs('http://example.org/a')).toBeNull();
    expect(drawnBoxSaid('EPSG:4326')).toBe('in EPSG:4326, latitude first, at 3 decimals');
  });

  it('reads as lon/lat to draw: EPSG:4326 latitude first, EPSG:3857 in metres, across the antimeridian east past 180', () => {
    expect(boxLonLat('19,59,32,70', '')).toEqual([19, 59, 32, 70]);
    expect(boxLonLat('59,19,70,32', URI(4326))).toEqual([19, 59, 32, 70]);
    expect(boxLonLat('19,59,0,32,70,500', CRS84_URI)).toEqual([19, 59, 32, 70]);
    // The box MeteoCore drew for the same request in CRS84, EPSG:4326 and EPSG:3857 on 2026-11-15: the same Content-Bbox
    const metres = boxLonLat('2433333,9002109,3133310,9491344', URI(3857))!;
    [21.859, 62.597, 28.147, 64.552].forEach((edge, i) => expect(metres[i]).toBeCloseTo(edge, 5));
    expect(boxLonLat('170,-10,-170,10', '')).toEqual([170, -10, 190, 10]);
    expect(boxLonLat('-196593,6255330,1044177,8084432', URI(3067))).toBeNull();
    expect(boxLonLat('19,59,32', '')).toBeNull();
    expect(boxLonLat('19,-95,32,70', '')).toBeNull();
    expect(boxLonLat('', '')).toBeNull();
  });

  it('is written in the CRS asked: CRS84 at the decimals given, EPSG:4326 latitude first, EPSG:3857 in whole metres', () => {
    const drawn = [21.85949, 62.59712, 28.14651, 64.55188] as [number, number, number, number];
    expect(boxTextIn(drawn, 'CRS84')).toBe('21.859,62.597,28.147,64.552');
    expect(boxTextIn(drawn, 'CRS84', 4)).toBe('21.8595,62.5971,28.1465,64.5519');
    expect(boxTextIn(drawn, 'EPSG:4326')).toBe('62.597,21.859,64.552,28.147');
    expect(boxTextIn([21.859, 62.597, 28.147, 64.552], 'EPSG:3857')).toBe('2433333,9002109,3133310,9491344');
    expect(boxTextIn([19, 59, 32.5, 70], 'CRS84')).toBe('19,59,32.5,70');
  });
});

describe('a box in CRS84, as another query takes it', () => {
  it('is the box read in its CRS, west past east across the antimeridian', () => {
    expect(boxInCrs84('59,19,70,32', 'EPSG:4326')).toEqual([19, 59, 32, 70]);
    expect(boxInCrs84('170,-10,-170,10', '')).toEqual([170, -10, -170, 10]);
    expect(boxInCrs84('1,2,3,4', URI(3067))).toBeNull();
    expect(boxInCrs84('1,95,3,4', '')).toBeNull();
  });

  it('goes across between a map and a query that takes its box from the map, and not to or from another', () => {
    const drawn = [19.0004, 59, 32, 70] as [number, number, number, number];
    expect(boxAcross('items', 'map', { drawn, bbox: '', bboxCrs: '' })).toEqual({ bbox: '19,59,32,70' });
    expect(boxAcross('cube', 'map', { drawn, bbox: '', bboxCrs: '' })).toEqual({ bbox: '19,59,32,70' });
    expect(boxAcross('items', 'map', { drawn: null, bbox: '', bboxCrs: '' })).toEqual({});
    expect(boxAcross('map', 'cube', { drawn: null, bbox: '59,19,70,32', bboxCrs: '[EPSG:4326]' })).toEqual({ drawn: [19, 59, 32, 70] });
    expect(boxAcross('map', 'cube', { drawn: null, bbox: '1,2,3,4', bboxCrs: URI(3035) }))
      .toEqual({ leftBehind: "The map's bbox wasn't kept: it's in EPSG:3035, which the form can't turn into CRS84, the box cube takes" });
    for (const [from, to] of [['position', 'map'], ['map', 'position'], ['map', 'map'], ['items', 'cube'], ['map', 'locations']]) {
      expect(boxAcross(from, to, { drawn, bbox: '1,2,3,4', bboxCrs: '' }), `${from} to ${to}`).toEqual({});
    }
  });
});

describe('Match the map view', () => {
  // The view the Chrome check matched at 1440 on 2026-11-15, as MeteoCore's Content-Bbox gave it back in EPSG:3857
  const VIEW = [-310358.7403316467, 7222220.347849842, 5854403.340309051, 12391910.26030157];

  it('writes the view in CRS84 at a tenth of a pixel, the map’s size, and EPSG:3857 as the collection lists it', () => {
    expect(viewMatch(radar(), VIEW, [954, 800])).toEqual({ bbox: '-2.788,54.274,52.591,73.691', width: 954, height: 800, crs: URI(3857) });
    // Zoomed into a town: 2.5 m a pixel, 0.0000112° of latitude, so 6 decimals for a tenth of one
    const town = [2777000, 8435000, 2779000, 8436000];
    expect(viewMatch(radar(), town, [800, 400])!.bbox).toBe('24.946215,60.158004,24.964182,60.162474');
    expect(viewMatch(radar(), VIEW, [954.4, 799.6])).toMatchObject({ width: 954, height: 800 });
  });

  it('leaves crs out where the collection doesn’t list EPSG:3857, and waits for a view with a size', () => {
    const unlisted = { ...radar(), crs: [CRS84_URI, URI(3067)] } as Collection;
    expect(viewMatch(unlisted, VIEW, [954, 800])!.crs).toBeNull();
    expect(viewMatch(radar(), null, [954, 800])).toBeNull();
    expect(viewMatch(radar(), VIEW, null)).toBeNull();
    expect(viewMatch(radar(), VIEW, [0, 800])).toBeNull();
  });
});

describe('the size that keeps the box’s shape', () => {
  const asked = (q: Partial<{ bbox: string; bboxCrs: string; crs: string; width: string; height: string }>) => ({ bbox: '', bboxCrs: '', crs: '', width: '', height: '', ...q });

  it('is worked out in degrees for CRS84 and EPSG:4326, and in metres for EPSG:3857, as MeteoCore sizes the same', () => {
    // MeteoCore on 2026-11-15, asked bbox=19,59,32,70&width=400: 400 × 338 in CRS84 and EPSG:4326, 400 × 798 in EPSG:3857
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', width: '400' }))).toEqual({ width: 400, height: 338, wrote: 'height', inCrs: 'CRS84' });
    expect(keptShape(radar(), asked({ bbox: '19,59,32,70', width: '400', crs: URI(4326) }))).toEqual({ width: 400, height: 338, wrote: 'height', inCrs: 'EPSG:4326' });
    expect(keptShape(radar(), asked({ bbox: '19,59,32,70', width: '400', crs: URI(3857) }))).toEqual({ width: 400, height: 798, wrote: 'height', inCrs: 'EPSG:3857' });
    // The width from the height where only it's given, and the width kept where both are
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', height: '338' }))).toEqual({ width: 399, height: 338, wrote: 'width', inCrs: 'CRS84' });
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', width: '400', height: '9' }))).toMatchObject({ height: 338, wrote: 'height' });
    // A box read in its bbox-crs, and one across the antimeridian
    expect(keptShape(ifs(), asked({ bbox: '59,19,70,32', bboxCrs: '[EPSG:4326]', width: '400' }))).toMatchObject({ height: 338 });
    expect(keptShape(ifs(), asked({ bbox: '170,-10,-170,10', width: '200' }))).toMatchObject({ height: 200 });
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', width: '0', height: '1' }))).toMatchObject({ width: 1, wrote: 'width' });
    // A pixel at least, however flat the box
    expect(keptShape(ifs(), asked({ bbox: '0,0,100,0.1', width: '100' }))).toMatchObject({ height: 1, wrote: 'height' });
  });

  it('says why it can’t be', () => {
    expect(keptShape(ifs(), asked({ width: '400' }))).toEqual({ reason: 'Needs a `bbox`: its shape is what the size keeps' });
    expect(keptShape(ifs(), asked({ bbox: '19,59,32', width: '400' }))).toEqual({ reason: "The form can't read `bbox`" });
    expect(keptShape(radar(), asked({ bbox: '1,2,3,4', bboxCrs: URI(3067), width: '400', crs: URI(3857) })))
      .toEqual({ reason: 'Only for a box in CRS84, EPSG:4326 or EPSG:3857, and `bbox-crs` is EPSG:3067' });
    expect(keptShape(radar(), asked({ bbox: '19,59,32,70', width: '400' }))).toEqual({ reason: 'Only for a map in CRS84, EPSG:4326 or EPSG:3857, and it comes back in EPSG:3067, the storage CRS' });
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', width: '400', crs: URI(3035) }))).toEqual({ reason: 'Only for a map in CRS84, EPSG:4326 or EPSG:3857, and it comes back in EPSG:3035' });
    expect(keptShape(ifs(), asked({ bbox: '19,59,19,70', width: '400' }))).toEqual({ reason: 'The box has no area' });
    expect(keptShape(ifs(), asked({ bbox: '19,59,32,70', width: '1.5' }))).toEqual({ reason: 'Needs `width` or `height` to keep' });
  });
});

describe('what the API docs say the server does without a parameter', () => {
  it('is the sentence that begins Omitted, or says it', () => {
    expect(apiDocsLeftOut(DOCS.find(param => param.name === 'width'))).toBe("Omitted over an area (`bbox`, a spatial `subset` or the collection's extent): "
      + 'the width that keeps pixels square, 1024 for the longer side when `height` is omitted too, or the width `scale-denominator` gives.');
    expect(apiDocsLeftOut({ name: 'w', isArray: false, enumValues: null, defaultValue: null, pointer: '', description: 'Pixels. When omitted, 256.' })).toBe('When omitted, 256.');
    expect(apiDocsLeftOut(DOCS.find(param => param.name === 'bbox'))).toBeNull();
    expect(apiDocsLeftOut(undefined)).toBeNull();
  });
});

describe('the box, size and CRS fields', () => {
  it('come first, each named as sent, tagged by who declares it, and say what the server does without them', () => {
    const fields = specs(radar());
    expect(fields.slice(0, 3).map(field => [field.title, field.name, field.unit?.name, field.unitJoin, tags(field)])).toEqual([
      ['Box', 'bbox', 'bbox-crs', undefined, ['spatial-subsetting', 'API docs']],
      ['Size', 'width', 'height', '×', ['scaling', 'spatial-subsetting', 'API docs']],
      ['Coordinate system', 'crs', undefined, undefined, ['crs', 'API docs']],
    ]);
    const [bbox, size, crs] = fields;
    expect(bbox.unit).toEqual({ title: '', name: 'bbox-crs', id: 'bbox-crs', requirement: 'optional', hints: [] });
    expect(bbox.hints).toEqual([{ text: "`bbox-crs` takes CRS84, the storage CRS or the `crs` asked; left out, it's CRS84", rule: [MAPS1.bboxCrs, MAPS1.bboxCrsDefault] }]);
    expect(bbox.leftOut).toEqual({ text: "the whole map: the collection's extent", rule: MAPS1.wholeMap });
    expect(bbox.grammar).toContain('EPSG:4326 latitude first');
    expect(size).toMatchObject({ figure: 'pixels', grammar: 'Whole numbers of pixels, at least 1', unit: { name: 'height', id: 'height' } });
    expect(size.hints).toEqual([{ text: 'The API docs allow up to 8000 each', rule: MAPS1.maxSizeApiDocs }]);
    expect(size.leftOut).toEqual({
      text: "the server picks one. The API docs: Omitted over an area (`bbox`, a spatial `subset` or the collection's extent): the width that keeps pixels square, "
        + '1024 for the longer side when `height` is omitted too, or the width `scale-denominator` gives.',
      rule: [MAPS1.widthDefinitionH, MAPS1.heightDefinitionH],
    });
    expect(crs).toMatchObject({ figure: '5 listed', options: [CRS84_URI, URI(4326), URI(3857), URI(3067), URI(3035)], hints: ["From the collection's `crs`, sent as it lists them"] });
    expect(crs.leftOut).toEqual({ text: 'the storage CRS, `storageCrs` EPSG:3067', rule: MAPS1.mapResponseB });
    expect(one(specs(norway()), 'crs')!.leftOut).toEqual({ text: 'CRS84: the collection has no `storageCrs`', rule: MAPS1.mapResponseB });
  });

  it('say the service’s x-OGC-limits, and each maximum where the API docs have one', () => {
    const limits = { maxWidth: 2048, maxHeight: 1024, maxPixels: 4194304, pointer: '/info/x-OGC-limits/maps' };
    expect(one(specs(radar(), { mapLimits: limits }), 'width')!.hints).toEqual([
      { text: 'The API docs allow up to 8000 each', rule: MAPS1.maxSizeApiDocs },
      { text: '`x-OGC-limits.maps` allows up to 2048 wide, 1024 high, 4194304 pixels in all', rule: MAPS1.maxSizeLimits },
    ]);
    expect(one(specs(radar(), { mapLimits: { ...limits, maxHeight: null, maxPixels: null } }), 'width')!.hints[1]).toMatchObject({ text: '`x-OGC-limits.maps` allows up to 2048 wide' });
    expect(one(specs(radar(), { mapLimits: { maxWidth: null, maxHeight: null, maxPixels: null, pointer: '' } }), 'width')!.hints).toHaveLength(1);
    const docs = DOCS.map(param => (param.name === 'height' ? { ...param, maximum: 4000 } : param.name === 'width' ? { ...param, maximum: undefined } : param));
    expect(one(specs(radar(), { apiDocs: docs }), 'width')!.hints).toEqual([{ text: 'The API docs allow up to any wide and 4000 high', rule: MAPS1.maxSizeApiDocs }]);
    expect(one(specs(radar(), { apiDocs: null }), 'width')!.hints).toEqual([]);
    expect(one(specs(radar(), { apiDocs: null }), 'width')!.leftOut).toEqual({ text: 'the server picks one', rule: [MAPS1.widthDefinitionH, MAPS1.heightDefinitionH] });
  });

  it('show where declared, or where the request has them, and say a collection without crs has only CRS84 for sure', () => {
    // Of the main fields: those under More are mapMore.test.ts'
    const main = (fields: FieldSpec[]) => fields.filter(field => !field.more);
    expect(main(specs(radar(), { conformsTo: null, apiDocs: null })).map(field => field.id)).toEqual([]);
    expect(main(specs(radar(), { conformsTo: null, apiDocs: null, inRequest: ['bbox-crs', 'height', 'crs'] })).map(field => [field.id, tags(field)]))
      .toEqual([['bbox', []], ['width', []], ['crs', []]]);
    const bare = { ...radar(), crs: undefined } as unknown as Collection;
    expect(one(specs(bare), 'crs')).toMatchObject({ figure: undefined, options: [], hints: [{ text: 'The collection lists no `crs`: only CRS84 is sure to be supported', rule: MAPS1.crsListed }] });
    expect(one(fieldSpecs(radar(), 'map', { parameters: 0 }, { conformsTo: box.conformsTo, apiDocs: DOCS, apiRequired: ['bbox', 'width', 'crs'] }), 'width')!.requirement).toBe('required by the API docs');
  });
});

describe('what’s wrong with a box, a size and a CRS, from the collection', () => {
  const issues = (collection: Collection, q: Partial<{ bbox: string; bboxCrs: string; width: string; height: string; crs: string }>) =>
    mapBoxIssues(collection, { bbox: '', bboxCrs: '', width: '', height: '', crs: '', ...q });

  it('finds nothing in what Match the map view writes, nor in a box drawn in each CRS', () => {
    expect(issues(radar(), { bbox: '-2.788,54.274,52.591,73.691', width: '954', height: '800', crs: URI(3857) })).toEqual([]);
    expect(issues(radar(), { bbox: '21.859,62.597,28.147,64.552', bboxCrs: CRS84_URI })).toEqual([]);
    expect(issues(radar(), { bbox: '62.597,21.859,64.552,28.147', bboxCrs: URI(4326), crs: URI(4326) })).toEqual([]);
    expect(issues(radar(), { bbox: '2433333,9002109,3133310,9491344', bboxCrs: URI(3857), crs: URI(3857) })).toEqual([]);
    expect(issues(radar(), { bbox: '-196593,6255330,1044177,8084432', bboxCrs: URI(3067) })).toEqual([]);
  });

  it('has bbox four or six numbers, an error, and calls west past east a box across the antimeridian', () => {
    expect(issues(radar(), { bbox: '19,59,32' })).toEqual([{
      id: 'maps:bbox:numbers', severity: 'error', source: 'maps', field: 'bbox', input: 'form',
      message: 'bbox has 3 numbers: Maps 1.0 takes four, or six for a box with heights', rule: MAPS1.bboxNumbers,
    }]);
    const across = {
      id: 'maps:bbox:antimeridian', severity: 'info', source: 'maps', field: 'bbox', input: 'form',
      message: "West 170 is past east -170: the box crosses the antimeridian. Maps 1.0 says this of subset's low and high; of bbox, nothing", rule: MAPS1.subsetAntimeridian,
    };
    expect(issues(ifs(), { bbox: '170,-10,-170,10' })).toEqual([across]);
    expect(issues(ifs(), { bbox: '-10,170,10,-170', bboxCrs: 'EPSG:4326' }).filter(issue => issue.id === across.id)).toEqual([across]);
    expect(issues(ifs(), { bbox: '170,-10,0,-170,10,0' }).map(issue => issue.message.split(':')[0])).toEqual(['West 170 is past east -170']);
    // EPSG:3857's x wraps at the antimeridian too
    expect(issues(radar(), { bbox: '19000000,0,-19000000,100000', bboxCrs: URI(3857), crs: URI(3857) }).map(issue => issue.message.split(':')[0]))
      .toEqual(['West 19000000 is past east -19000000']);
    // Not in a CRS that doesn't wrap, nor where the edges are in order or the same
    expect(issues(radar(), { bbox: '500000,6500000,400000,7000000', bboxCrs: URI(3067) })).toEqual([]);
    expect(issues(ifs(), { bbox: '-170,-10,170,10' })).toEqual([]);
    expect(issues(ifs(), { bbox: '19,59,19,70' })).toEqual([]);
  });

  it('has bbox-crs among its valid values, a warning, says an unsafe CURIE is only permitted, and that it’s ignored without bbox', () => {
    expect(issues(radar(), { bbox: '1,2,3,4', bboxCrs: URI(3035), crs: URI(3857) })).toEqual([{
      id: 'maps:bbox-crs:valid', severity: 'warning', source: 'maps', field: 'bbox-crs', input: 'form',
      message: "EPSG:3035 isn't one of bbox-crs's valid values, CRS84, EPSG:3067 (the storage CRS), EPSG:3857 (the crs asked): a server needn't take it",
      rule: [MAPS1.bboxCrs, MAPS1.crsForBbox],
    }]);
    expect(issues(ifs(), { bbox: '1,2,3,4', bboxCrs: URI(3857) })[0].message).toBe("EPSG:3857 isn't one of bbox-crs's valid values, CRS84: a server needn't take it");
    // The crs asked is one
    expect(issues(radar(), { bbox: '1,2,3,4', bboxCrs: '[EPSG:3035]', crs: URI(3035) })).toEqual([]);
    expect(issues(radar(), { bbox: '62,21,64,28', bboxCrs: 'EPSG:3067' })).toEqual([{
      id: 'maps:bbox-crs:curie', severity: 'info', source: 'maps', field: 'bbox-crs', input: 'form',
      message: 'EPSG:3067 is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [EPSG:3067] SHALL be supported', rule: MAPS1.subsettingCrsCurie,
    }]);
    expect(issues(radar(), { bboxCrs: URI(3067) })).toEqual([{
      id: 'maps:bbox-crs:alone', severity: 'info', source: 'maps', field: 'bbox-crs', input: 'form', message: 'bbox-crs without bbox: the server ignores it', rule: MAPS1.bboxCrsAlone,
    }]);
  });

  it('has width and height positive integers, an error each', () => {
    expect(issues(radar(), { width: '0', height: '1.5' })).toEqual([
      { id: 'maps:width:integer', severity: 'error', source: 'maps', field: 'width', input: 'form', message: "width 0 isn't a positive integer: the server SHALL answer with a 4xx", rule: MAPS1.widthDefinitionC },
      { id: 'maps:height:integer', severity: 'error', source: 'maps', field: 'height', input: 'form', message: "height 1.5 isn't a positive integer: the server SHALL answer with a 4xx", rule: MAPS1.heightDefinitionC },
    ]);
    expect(issues(radar(), { width: '-5', height: 'x' }).map(issue => issue.id)).toEqual(['maps:width:integer', 'maps:height:integer']);
    expect(issues(radar(), { width: ' 954 ', height: '1' })).toEqual([]);
  });

  it('has crs in the collection’s list, a warning, and says an unsafe CURIE is only permitted', () => {
    expect(issues(radar(), { crs: 'EPSG:2393' })).toEqual([
      { id: 'maps:crs:listed', severity: 'warning', source: 'maps', field: 'crs', input: 'form', message: "EPSG:2393 isn't in the collection's crs list: only those listed SHALL be supported", rule: MAPS1.crsListed },
      {
        id: 'maps:crs:curie', severity: 'info', source: 'maps', field: 'crs', input: 'form',
        message: 'EPSG:2393 is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [EPSG:2393] SHALL be supported', rule: [MAPS1.crsCurie, MAPS1.crsDefinition],
      },
    ]);
    // Listed, whichever way it's written
    expect(issues(radar(), { crs: '[EPSG:3857]' })).toEqual([]);
    expect(issues(radar(), { crs: 'EPSG:3857' }).map(issue => issue.id)).toEqual(['maps:crs:curie']);
    const bare = { ...radar(), crs: undefined } as unknown as Collection;
    expect(issues(bare, { crs: URI(3857) })).toEqual([{
      id: 'maps:crs:listed', severity: 'warning', source: 'maps', field: 'crs', input: 'form',
      message: 'The collection lists no crs: only CRS84 SHALL be supported, and EPSG:3857 may not be', rule: MAPS1.crsListed,
    }]);
    expect(issues(bare, { crs: CRS84_URI })).toEqual([]);
  });
});

describe('what’s wrong with a box and a size, with the rest of the line', () => {
  const line = (q: Partial<{ bbox: string; center: string; width: string; height: string; scaleDenominator: string; subset: string }>) =>
    ({ bbox: '', center: '', width: '', height: '', scaleDenominator: '', subset: '', ...q });

  it('has bbox with center an error, where the API declares spatial subsetting', () => {
    expect(mapLineIssues(offer(), line({ bbox: '19,59,32,70', center: '25,62' }), null)).toEqual([{
      id: 'maps:bbox:with-center', severity: 'error', source: 'maps', field: 'bbox', input: 'form',
      message: 'bbox with center: Maps 1.0 asks a 4xx for either with the other', rule: [MAPS1.bboxDefinition, MAPS1.centerDefinition],
    }]);
    expect(mapLineIssues(offer(box.conformsTo.filter(uri => !uri.endsWith('/spatial-subsetting'))), line({ bbox: '19,59,32,70', center: '25,62' }), null)).toEqual([]);
    expect(mapLineIssues(offer(null), line({ bbox: '19,59,32,70', center: '25,62' }), null)).toEqual([]);
  });

  it('has a size with an area and scale-denominator an error, where the API declares scaling', () => {
    expect(mapLineIssues(offer(), line({ bbox: '19,59,32,70', width: '256', scaleDenominator: '5000000' }), null)).toEqual([{
      id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: 'width', input: 'form',
      message: 'width with bbox and scale-denominator: Maps 1.0 asks a 4xx', rule: [MAPS1.widthDefinitionF, MAPS1.scaleDenominatorWithSize],
    }]);
    expect(mapLineIssues(offer(), line({ subset: 'time("x"),Lat(59:70)', width: '256', height: '9', scaleDenominator: '5000000' }), null)).toEqual([{
      id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: 'width', input: 'form',
      message: 'width and height with a spatial subset and scale-denominator: Maps 1.0 asks a 4xx',
      rule: [MAPS1.widthDefinitionF, MAPS1.heightDefinitionF, MAPS1.scaleDenominatorWithSize],
    }]);
    expect(mapLineIssues(offer(), line({ bbox: '1,2,3,4', height: '9', scaleDenominator: '5' }), null)[0]).toMatchObject({ field: 'height', rule: [MAPS1.heightDefinitionF, MAPS1.scaleDenominatorWithSize] });
    // Without an area, or without scale-denominator, or without scaling, nothing
    expect(mapLineIssues(offer(), line({ subset: 'time("x")', width: '256', scaleDenominator: '5000000' }), null)).toEqual([]);
    expect(mapLineIssues(offer(), line({ bbox: '19,59,32,70', width: '256' }), null)).toEqual([]);
    expect(mapLineIssues(offer(box.conformsTo.filter(uri => !uri.endsWith('/scaling'))), line({ bbox: '1,2,3,4', width: '256', scaleDenominator: '5' }), null)).toEqual([]);
  });

  it('has a size with scale-denominator an error at all where the API declares scaling and not spatial subsetting', () => {
    const scalingOnly = offer(box.conformsTo.filter(uri => !uri.endsWith('/spatial-subsetting')));
    expect(mapLineIssues(scalingOnly, line({ height: '256', scaleDenominator: '5000000' }), null)).toEqual([{
      id: 'maps:width:with-scale', severity: 'error', source: 'maps', field: 'height', input: 'form',
      message: "height with scale-denominator, where the API doesn't declare spatial subsetting: Maps 1.0 asks a 4xx", rule: MAPS1.scaleDenominatorDefinitionD,
    }]);
    // With spatial subsetting a size sets the area around a centre, so a scale can go with it; without scaling, a size or
    // a scale, nothing
    expect(mapLineIssues(offer(), line({ height: '256', scaleDenominator: '5000000' }), null)).toEqual([]);
    const neither = offer(box.conformsTo.filter(uri => !uri.endsWith('/scaling') && !uri.endsWith('/spatial-subsetting')));
    expect(mapLineIssues(neither, line({ height: '256', scaleDenominator: '5000000' }), null)).toEqual([]);
    expect(mapLineIssues(scalingOnly, line({ scaleDenominator: '5000000' }), null)).toEqual([]);
    expect(mapLineIssues(scalingOnly, line({ width: '256' }), null)).toEqual([]);
  });

  it('has a size past the API docs’ maximum an error, as MeteoCore answers 400', () => {
    const width = DOCS.find(param => param.name === 'width')!;
    expect(mapLineIssues(offer(), line({ width: '9000', height: '8000' }), null)).toEqual([{
      id: 'openapi:width:maximum', severity: 'error', source: 'openapi', field: 'width', input: 'form', pointer: width.pointer,
      message: "width 9000 is past the API docs' maximum, 8000: expect a 4xx", rule: MAPS1.maxSizeApiDocs,
    }]);
    expect(mapLineIssues(offer(), line({ height: '8001' }), null).map(issue => issue.id)).toEqual(['openapi:height:maximum']);
    expect(mapLineIssues(offer(), line({ width: 'wide' }), null)).toEqual([]);
  });

  it('has a size past x-OGC-limits.maps an error, each limit by its own rule', () => {
    const limits = { maxWidth: 2048, maxHeight: 1024, maxPixels: 2000000, pointer: '/info/x-OGC-limits/maps' };
    const found = mapLineIssues(offer(), line({ width: '2049', height: '1025' }), limits);
    expect(found).toEqual([
      {
        id: 'openapi:width:max-limit', severity: 'error', source: 'openapi', field: 'width', input: 'form', pointer: '/info/x-OGC-limits/maps',
        message: 'width 2049 is past x-OGC-limits.maps.maxWidth, 2048: the server SHALL answer with a 4xx', rule: MAPS1.widthDefinitionD,
      },
      {
        id: 'openapi:height:max-limit', severity: 'error', source: 'openapi', field: 'height', input: 'form', pointer: '/info/x-OGC-limits/maps',
        message: 'height 1025 is past x-OGC-limits.maps.maxHeight, 1024: the server SHALL answer with a 4xx', rule: MAPS1.heightDefinitionD,
      },
      {
        id: 'openapi:width:max-pixels', severity: 'error', source: 'openapi', field: 'width', input: 'form', pointer: '/info/x-OGC-limits/maps',
        message: 'width × height, 2100225 pixels, is past x-OGC-limits.maps.maxPixels, 2000000: the server SHALL answer with a 4xx', rule: [MAPS1.widthDefinitionE, MAPS1.heightDefinitionE],
      },
    ]);
    expect(mapLineIssues(offer(), line({ width: '2048', height: '976' }), limits)).toEqual([]);
    // Up to each limit is within it
    expect(mapLineIssues(offer(), line({ width: '2000', height: '1000' }), limits)).toEqual([]);
    expect(mapLineIssues(offer(), line({ width: '5000' }), { ...limits, maxWidth: null })).toEqual([]);
  });
});
