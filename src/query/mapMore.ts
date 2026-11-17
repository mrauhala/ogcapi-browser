// What a map request has under More: its background (transparent, bgcolor) and what's outside its CRS's area
// (void-transparent, void-color), its centre (center · center-crs), its scale (scale-denominator), the CRS of its subset
// (subset-crs), the API docs' quality, and the Accept header its format is negotiated by. By OGC API - Maps - Part 1:
// Core 1.0 (OGC 20-058, an approved standard published 2024-08-09). Nothing is filled in: what the server does without
// each is said, by the rule that says it. Pure.
import type { Collection } from '../types/api';
import type { QueryIssue } from './types';
import type { FieldSpec, Requirement } from './fieldSpecs';
import { declarersOf, type Declarer, type Offer } from './declared';
import { bboxCrsChoices, isUnsafeCurie, sameCrs, shortCrs } from './mapBox';
import { axisOfPart, subsetParts } from './subsetText';
import { SPATIAL_AXES } from './mapDimensions';
import { WEB_COLOURS } from './webColours';
import { COMMON1, MAPS1 } from '../standards';

// ---- Colours ----

// A colour as bgcolor and void-color take it, and how it's written: 0xRRGGBB, as Maps 1.0 writes its default 0xFFFFFF;
// #RRGGBB or RRGGBB, hexadecimal written otherwise; 0xAARRGGBB, with alpha, which /per/background/bgcolor-alpha permits;
// 0xRGB, three digits; or a W3C colour name. css is what the swatch is painted with
export type ColourReading =
  | { form: 'hex' | 'other-hex' | 'alpha' | 'short' | 'name'; css: string }
  | { form: 'unread' };

export function readColour(text: string): ColourReading | null {
  const value = text.trim();
  if (!value) return null;
  const hex = /^(0x|#)?([0-9a-f]+)$/i.exec(value);
  if (hex) {
    const [, prefix, digits] = hex;
    if (digits.length === 6) return { form: prefix === '0x' || prefix === '0X' ? 'hex' : 'other-hex', css: `#${digits.toLowerCase()}` };
    if (digits.length === 8 && prefix?.toLowerCase() === '0x') {
      const [a, r, g, b] = [0, 2, 4, 6].map(at => parseInt(digits.slice(at, at + 2), 16));
      return { form: 'alpha', css: `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})` };
    }
    if (digits.length === 3 && prefix) return { form: 'short', css: `#${digits.toLowerCase()}` };
  }
  return WEB_COLOURS.has(value.toLowerCase()) ? { form: 'name', css: value.toLowerCase() } : { form: 'unread' };
}

// ---- Booleans ----

// true or false, as transparent's schema has them; another letter case is another value, which a server may not read
export function readBoolean(text: string): 'true' | 'false' | 'case' | 'unread' | null {
  const value = text.trim();
  if (!value) return null;
  if (value === 'true' || value === 'false') return value;
  return /^(true|false)$/i.test(value) ? 'case' : 'unread';
}

// What transparent is, given or left out: true without bgcolor, false with one (/req/background/transparent-definition
// C, D). void-transparent left out is that (/req/background/void-transparent-definition C)
export function transparentIs(transparent: string, bgcolor: string): { value: 'true' | 'false'; given: boolean } {
  const read = readBoolean(transparent);
  if (read === 'true' || read === 'false') return { value: read, given: true };
  return { value: bgcolor.trim() ? 'false' : 'true', given: false };
}

// ---- The Accept header ----

// The media type each Maps encoding class gives a map in: /req/png/content and the others
const ENCODINGS: readonly [string, string][] = [
  ['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpegxl', 'image/jxl'], ['tiff', 'image/tiff'], ['svg', 'image/svg+xml'], ['html', 'text/html'],
];

// The formats to ask for by Accept: those of the encoding classes the API declares, then those the API docs' f lists
// besides, which the server says it makes too
export function acceptOptions(offer: Offer): { options: string[]; classes: string[]; fromDocs: string[] } {
  const classes = ENCODINGS.filter(([name]) => offer.classes?.has(name));
  const declared = classes.map(([, type]) => type);
  const fromDocs = (offer.apiDocs?.find(param => param.name === 'f')?.enumValues ?? []).filter(type => !declared.includes(type));
  return { options: [...declared, ...fromDocs], classes: classes.map(([name]) => name), fromDocs };
}

// ---- The fields ----

// The first sentence the API docs say of a parameter
const firstSentence = (text: string | undefined): string | null => text?.split(/(?<=[.!?])\s+|\n+/)[0]?.trim() || null;

// The fields under More, each where it's declared or the request has it, in order: Background, Outside the CRS, Centre,
// Scale, Subset CRS, Quality, and the Accept header, which every map request can be sent with
export function mapMoreSpecs(offer: Offer, inRequest: ReadonlySet<string>, requirementOf: (name: string) => Requirement): FieldSpec[] {
  const fields: FieldSpec[] = [];
  const docs = (name: string) => offer.apiDocs?.find(param => param.name === name);
  const unit = (name: string): FieldSpec => ({ title: '', name, id: name, requirement: requirementOf(name), hints: [] });
  // A block of two names shows where either is declared or in the request, tagged once by each who declares either: the
  // API docs open where they list the first
  const by = (...names: string[]): Declarer[] => {
    const seen = new Set<string>();
    return names.flatMap(name => declarersOf(name, offer)).filter(declarer => {
      const key = declarer.kind === 'api-docs' ? declarer.kind : `${declarer.kind}:${declarer.name}`;
      return !seen.has(key) && !!seen.add(key);
    });
  };
  const shows = (...names: string[]) => by(...names).length > 0 || names.some(name => inRequest.has(name));

  if (shows('transparent', 'bgcolor')) {
    fields.push({
      title: 'Background', name: 'transparent', id: 'transparent', requirement: requirementOf('transparent'), more: true,
      unit: unit('bgcolor'),
      hints: [{ text: '`bgcolor`: `0xRRGGBB`, as `0x336699`, or a W3C colour name, as `white` or `SteelBlue`', rule: MAPS1.bgcolorDefinition }],
      leftOut: { text: 'transparent where there\'s no data: `transparent` is `true` without a `bgcolor`', rule: MAPS1.transparentDefault },
      declaredBy: by('transparent', 'bgcolor'),
    });
  }

  if (shows('void-transparent', 'void-color')) {
    fields.push({
      title: 'Outside the CRS', name: 'void-transparent', id: 'void-transparent', requirement: requirementOf('void-transparent'), more: true,
      unit: unit('void-color'),
      hints: [{ text: 'For the parts of the map outside the valid area of its CRS. `void-color` as `bgcolor`: `0xRRGGBB` or a W3C colour name', rule: MAPS1.voidColorDefinition }],
      leftOut: { text: 'as the background: `transparent` and `bgcolor`, given or left out', rule: [MAPS1.voidTransparentDefault, MAPS1.voidColorDefault] },
      declaredBy: by('void-transparent', 'void-color'),
    });
  }

  if (shows('center', 'center-crs')) {
    fields.push({
      title: 'Centre', name: 'center', id: 'center', requirement: requirementOf('center'), more: true,
      unit: unit('center-crs'),
      hints: [
        { text: "`center-crs` takes CRS84, the storage CRS or the `crs` asked; left out, it's CRS84", rule: [MAPS1.centerCrs, MAPS1.centerCrsDefault] },
        { text: 'Not with `bbox`, nor with a spatial axis in `subset`', rule: MAPS1.centerDefinition },
      ],
      leftOut: { text: 'no centre: the map covers the box, a spatial subset, or the whole map', rule: MAPS1.wholeMap },
      grammar: 'Typed: `lon,lat` in CRS84, else in the order of the CRS `center-crs` names (EPSG:4326 latitude first)',
      declaredBy: by('center', 'center-crs'),
    });
  }

  if (shows('scale-denominator')) {
    fields.push({
      title: 'Scale', name: 'scale-denominator', id: 'scale-denominator', requirement: requirementOf('scale-denominator'), more: true,
      hints: [
        { text: 'Real-world units to one on the display, at 0.28 mm a pixel: `5000000` is 1:5,000,000', rule: MAPS1.scaleDenominatorMeaning },
        { text: 'Not with `width` or `height` together with `bbox` or a spatial subset', rule: MAPS1.scaleDenominatorWithBbox },
      ],
      leftOut: { text: 'the server works it out from the size and the area', rule: MAPS1.scaleDenominatorLeftOut },
      grammar: 'A positive number',
      declaredBy: by('scale-denominator'),
    });
  }

  if (shows('subset-crs')) {
    fields.push({
      title: 'Subset CRS', name: 'subset-crs', id: 'subset-crs', requirement: requirementOf('subset-crs'), more: true,
      hints: [{ text: "For `subset`'s spatial axes: `Lon` and `Lat` in a geographic CRS, `E` and `N` in a projected one. It takes CRS84, the storage CRS or the `crs` asked", rule: [MAPS1.subsetCrs, MAPS1.subsetDefinition] }],
      leftOut: { text: 'CRS84', rule: MAPS1.subsetCrsDefault },
      grammar: 'A URI, or its safe CURIE: `[EPSG:3067]`',
      declaredBy: by('subset-crs'),
    });
  }

  if (shows('quality')) {
    const listed = docs('quality');
    const said = firstSentence(listed?.description);
    const range = listed?.minimum !== undefined && listed?.maximum !== undefined ? `From ${listed.minimum} to ${listed.maximum}, by the API docs' schema` : null;
    fields.push({
      title: 'Quality', name: 'quality', id: 'quality', requirement: requirementOf('quality'), more: true,
      hints: [...(said ? [`The API docs: ${said}`] : []), ...(range ? [range] : [])],
      leftOut: "the server's default",
      declaredBy: by('quality'),
    });
  }

  // Not a query parameter: Maps 1.0 asks for a format by Accept, which the line can't show
  const core = offer.classes?.get('core');
  const accept = acceptOptions(offer);
  const from = [
    accept.classes.length ? `the encoding${accept.classes.length > 1 ? 's' : ''} the API declares, ${accept.classes.join(' and ')}` : '',
    accept.fromDocs.length ? `the API docs' \`f\`: ${accept.fromDocs.map(type => `\`${type}\``).join(', ')}` : '',
  ].filter(Boolean);
  fields.push({
    title: 'Format by Accept', name: 'Accept', id: 'accept', requirement: 'optional', more: true, header: true,
    options: accept.options,
    hints: [
      { text: "Maps 1.0 negotiates a map's format by `Accept`. Sent as a header, which the line can't show; Copy as curl has it", rule: [MAPS1.mapResponseI, MAPS1.formatNegotiation] },
      ...(from.length ? [`From ${from.join(', and ')}`] : []),
    ],
    leftOut: "`*/*`, as the app sends it: the server's default format",
    declaredBy: core ? [{ kind: 'class', name: 'core', uri: core }] : [],
  });
  return fields;
}

// ---- What's wrong with them ----

type Add = (issue: Omit<QueryIssue, 'id' | 'input'> & { key: string }) => void;

// transparent and void-transparent: a Boolean, true or false
function checkBoolean(name: 'transparent' | 'void-transparent', text: string, add: Add) {
  const read = readBoolean(text);
  const rule = name === 'transparent' ? [MAPS1.transparentDefinition, MAPS1.transparentBoolean] : [MAPS1.voidTransparentBoolean];
  if (read === 'unread') {
    add({ key: 'boolean', severity: 'error', source: 'maps', field: name, message: `${name} ${text.trim()} isn't true or false: Maps 1.0 makes it a Boolean`, rule });
  } else if (read === 'case') {
    add({ key: 'boolean', severity: 'warning', source: 'maps', field: name,
      message: `${name} ${text.trim()} is ${text.trim().toLowerCase()} in another case: values are case sensitive, and a server may not read it`, rule: [...rule, COMMON1.caseSensitive] });
  }
}

// bgcolor and void-color: a hexadecimal colour or a W3C colour name
function checkColour(name: 'bgcolor' | 'void-color', text: string, add: Add) {
  const read = readColour(text);
  if (!read) return;
  const value = text.trim();
  const rule = name === 'bgcolor' ? MAPS1.bgcolorDefinition : MAPS1.voidColorDefinition;
  if (read.form === 'unread') {
    add({ key: 'colour', severity: 'error', source: 'maps', field: name, message: `${name} ${value} is neither a hexadecimal colour, as 0x336699, nor a W3C colour name`, rule });
  } else if (read.form === 'short') {
    add({ key: 'colour', severity: 'warning', source: 'maps', field: name, message: `${name} ${value} has three hexadecimal digits: Maps 1.0 describes six, two each for red, green and blue`, rule });
  } else if (read.form === 'other-hex') {
    add({ key: 'colour', severity: 'info', source: 'maps', field: name,
      message: `${name} ${value}: Maps 1.0 writes a hexadecimal colour only as its default is, 0xFFFFFF, and a server may read only that`, rule });
  } else if (read.form === 'alpha') {
    add(name === 'bgcolor'
      ? { key: 'colour', severity: 'info', source: 'maps', field: name, message: `bgcolor ${value} has eight digits, the first two its alpha, which Maps 1.0 only permits`, rule: MAPS1.bgcolorAlpha }
      : { key: 'colour', severity: 'warning', source: 'maps', field: name, message: `void-color ${value} has eight digits: Maps 1.0 permits an alpha for bgcolor, not void-color`, rule: [rule, MAPS1.bgcolorAlpha] });
  }
}

// center-crs and subset-crs: among the valid values, a URI or a safe CURIE, and used
function checkCrs(collection: Collection, name: 'center-crs' | 'subset-crs', text: string, crs: string, used: boolean, add: Add) {
  const value = text.trim();
  if (!value) return;
  if (!used) {
    add({ key: 'alone', severity: 'info', source: 'maps', field: name,
      message: name === 'center-crs' ? 'center-crs without center: the server ignores it' : 'subset-crs without a spatial axis in subset: the server ignores it',
      rule: name === 'center-crs' ? MAPS1.centerCrsAlone : MAPS1.subsetCrsAlone });
  }
  const choices = bboxCrsChoices(collection, crs);
  if (!choices.some(choice => sameCrs(choice.value, value))) {
    const said = choices.map(choice => (choice.why === 'CRS84' ? 'CRS84' : `${choice.label} (${choice.why === 'storage' ? 'the storage CRS' : 'the crs asked'})`));
    add({ key: 'valid', severity: 'warning', source: 'maps', field: name,
      message: `${shortCrs(value)} isn't one of ${name}'s valid values, ${said.join(', ')}: a server needn't take it`,
      rule: name === 'center-crs' ? MAPS1.centerCrs : [MAPS1.subsetCrs, MAPS1.crsForBbox] });
  }
  if (isUnsafeCurie(value)) {
    add({ key: 'curie', severity: 'info', source: 'maps', field: name,
      message: `${value} is an unsafe CURIE, which Maps 1.0 only permits: the URI or the safe CURIE [${value}] SHALL be supported`, rule: MAPS1.subsettingCrsCurie });
  }
}

// What the form can say of what's under More from the collection and the request alone: transparent and void-transparent
// not a Boolean, bgcolor and void-color not a colour, center's coordinates, center-crs and subset-crs as bbox-crs is
// checked, and scale-denominator not a positive number. What needs the API's conformance, as center with bbox, is
// mapLineIssues'
export function mapMoreIssues(collection: Collection, q: Record<string, string>): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const add: Add = issue => {
    const { key, ...rest } = issue;
    issues.push({ ...rest, id: `${rest.source}:${rest.field}:${key}`, input: 'form' });
  };
  const text = (name: string) => q[name] ?? '';
  checkBoolean('transparent', text('transparent'), add);
  checkBoolean('void-transparent', text('void-transparent'), add);
  checkColour('bgcolor', text('bgcolor'), add);
  checkColour('void-color', text('void-color'), add);

  const center = text('center').trim();
  if (center) {
    const parts = center.split(',').map(part => part.trim());
    const wrong = parts.find(part => part === '' || !Number.isFinite(Number(part)));
    if (wrong !== undefined) {
      add({ key: 'numbers', severity: 'error', source: 'maps', field: 'center',
        message: wrong ? `"${wrong}" in center isn't a number` : 'center has an empty value between its commas', rule: MAPS1.centerSubset });
    } else if (parts.length < 2) {
      add({ key: 'numbers', severity: 'error', source: 'maps', field: 'center', message: 'center has one number: it takes a coordinate on each axis of its CRS', rule: MAPS1.centerSubset });
    }
  }
  checkCrs(collection, 'center-crs', text('center-crs'), text('crs'), !!center, add);
  const spatial = subsetParts(text('subset')).some(part => SPATIAL_AXES.has(axisOfPart(part) ?? ''));
  checkCrs(collection, 'subset-crs', text('subset-crs'), text('crs'), spatial, add);

  const scale = text('scale-denominator').trim();
  if (scale) {
    const number = Number(scale);
    if (!Number.isFinite(number)) {
      add({ key: 'number', severity: 'error', source: 'maps', field: 'scale-denominator', message: `scale-denominator ${scale} isn't a number`, rule: MAPS1.scaleDenominatorDefinition });
    } else if (number <= 0) {
      add({ key: 'number', severity: 'error', source: 'maps', field: 'scale-denominator',
        message: `scale-denominator ${scale} isn't positive: it's how many real-world units one on the display stands for`, rule: MAPS1.scaleDenominatorMeaning });
    }
  }
  return issues;
}
