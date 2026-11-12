// What a map query offers, and on whose word: each parameter's Maps class, quoted from OGC API - Maps - Part 1: Core 1.0
// (OGC 20-058, an approved standard published 2024-08-09), what the MetOcean Maps profile being drafted adds, and what
// the API docs' operation lists. The parameter-name field's rows, and which styles are for which parameter, read from the
// parameters' `metocean:styles` (the draft's) and from the styles' `parameters` (MeteoCore's). Pure.
import type { Collection } from '../types/api';
import type { QueryIssue } from './types';
import type { FieldContext, FieldSpec, Hint } from './fieldSpecs';
import type { MapStyle } from './mapQuery';
import { declaredClasses, declarersOf, type ApiDocsParam, type Declarer, type Offer } from './declared';
import { parameterIdsOf } from './queryTypes';
import { distinctLabel, parameterLabel, parameterUnit } from '../utils/coverageTimeSeries';
import { MAPS1 } from '../standards';
import { extentDimensions, mapDimensionSpecs } from './mapDimensions';

// Where a Maps conformance class's URI names it: …/spec/ogcapi-maps-1/1.0/conf/{class}
export const MAPS_CONF = '/spec/ogcapi-maps-1/1.0/conf/';

// The classes that give each query parameter of a map, by the statements that define them
export const MAPS_PARAMETER_CLASSES: Readonly<Record<string, readonly string[]>> = {
  // Requirements 6 to 9: "The map operation SHALL support a parameter bgcolor", "an optional parameter transparent",
  // "a parameter void-color", "an optional parameter void-transparent"
  bgcolor: ['background'],
  transparent: ['background'],
  'void-color': ['background'],
  'void-transparent': ['background'],
  // 11 B: "The parameter collections SHALL be supported by maps originating from resources consisting of multiple
  // geospatial data sub-resources"
  collections: ['collections-selection'],
  // 13 to 15: "The map operation SHALL support a parameter width", height, scale-denominator. And 25 A, in spatial
  // subsetting: "When the center parameter and/or the scale-denominator parameter is used, or if the scaling conformance
  // class is not supported, a width and height parameter … SHALL be supported"
  width: ['scaling', 'spatial-subsetting'],
  height: ['scaling', 'spatial-subsetting'],
  'scale-denominator': ['scaling'],
  // 16: "The map operation SHALL support a parameter mm-per-pixel"
  'mm-per-pixel': ['display-resolution'],
  // 18 to 24: "a query parameter bbox-crs", "a parameter subset-crs", "a parameter center-crs", "a parameter bbox", "a
  // subset parameter", "A center parameter SHALL be supported"
  bbox: ['spatial-subsetting'],
  'bbox-crs': ['spatial-subsetting'],
  'subset-crs': ['spatial-subsetting'],
  center: ['spatial-subsetting'],
  'center-crs': ['spatial-subsetting'],
  // 22 (spatial axes), 29 ("A subset parameter … for the time dimension") and 34 (any additional dimension)
  subset: ['spatial-subsetting', 'datetime', 'general-subsetting'],
  // 27: "The datetime parameter SHALL have the following characteristics"
  datetime: ['datetime'],
  // 35: "The map operation SHALL support a parameter crs"
  crs: ['crs'],
  // 37: "an orientation parameter SHALL be supported"
  orientation: ['orientation'],
  // 39 to 42: "A crs-proj-method parameter …", crs-proj-params, crs-proj-center, "A crs-datum parameter"
  'crs-proj-method': ['projection'],
  'crs-proj-params': ['projection'],
  'crs-proj-center': ['projection'],
  'crs-datum': ['projection'],
};

// The style, a part of the path: 54 A, "Every resource for which a styled map is available SHALL support an HTTP GET
// operation to a …/styles/{styleId}/map URL"
const STYLE_CLASS = 'styled-map';

// The profile being drafted for weather and ocean maps. Its discussion agreed parameter-name from parameter_names, as
// EDR has them; it has no requirements text yet, so nothing is checked against it
export const METOCEAN_MAPS_DRAFT: Extract<Declarer, { kind: 'profile' }> = {
  kind: 'profile',
  name: 'MetOcean Maps (draft)',
  href: 'https://github.com/opengeospatial/metocean-ogcapi-maps-profile/issues/5',
  note: 'A draft profile in progress (opengeospatial/metocean-ogcapi-maps-profile#5): parameter-name from the collection\'s '
    + 'parameter_names, a level as subset=vertical(…) and a model run as subset=reference_time(…), where the collection has '
    + 'them. Nothing is checked against it yet',
};

export const hasParameterNames = (collection: Collection): boolean => parameterIdsOf(collection).length > 0;

// What the draft profile uses of a map request, by what the collection has: parameter-name where it has
// parameter_names, and subset where its extent has levels (vertical) or model runs (reference_time), which it picks as
// subset=vertical(…) and subset=reference_time(…)
export function mapProfileNames(collection: Collection): string[] {
  const dimensions = extentDimensions(collection).map(dimension => dimension.id);
  return [
    ...(hasParameterNames(collection) ? ['parameter-name'] : []),
    ...(dimensions.includes('vertical') || dimensions.includes('reference_time') ? ['subset'] : []),
  ];
}

// Who declares what for a map request: the Maps classes the API declares (none known while its conformance isn't), the
// draft profile's parameters (mapProfileNames), and the API docs' operation
export function mapOffer(profileNames: readonly string[], conformsTo: readonly string[] | null | undefined, apiDocs: ApiDocsParam[] | null): Offer {
  return {
    standard: 'Maps',
    classesOf: MAPS_PARAMETER_CLASSES,
    classes: conformsTo ? declaredClasses(conformsTo, MAPS_CONF) : null,
    profile: { declarer: METOCEAN_MAPS_DRAFT, names: profileNames },
    apiDocs,
  };
}

// Who declares the style in the path: the styled-map class, where the API declares it
export function styleDeclarers(offer: Offer): Declarer[] {
  const uri = offer.classes?.get(STYLE_CLASS);
  return uri ? [{ kind: 'class', name: STYLE_CLASS, uri }] : [];
}

// ---- Styles for a parameter, read both ways ----

type Json = Record<string, unknown>;
const strings = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : null);

// A parameter's own entry in parameter_names, in either form it takes
function parameterEntry(collection: Collection, id: string): Json | null {
  const parameters = collection.parameter_names;
  const entry = Array.isArray(parameters) ? parameters.find(each => String(each?.id) === id) : parameters?.[id];
  return entry && typeof entry === 'object' ? entry as unknown as Json : null;
}

// What the draft has a parameter say: the styles for it, and the one drawn when no style is asked
export function parameterStyles(collection: Collection, id: string): { styles: string[] | null; defaultStyle: string | null } {
  const entry = parameterEntry(collection, id);
  const defaultStyle = entry?.['metocean:defaultStyle'];
  return { styles: strings(entry?.['metocean:styles']), defaultStyle: typeof defaultStyle === 'string' && defaultStyle.trim() ? defaultStyle : null };
}

// Whose word a style is for a parameter on, or not: the parameter's metocean:styles, the style's parameters. A side that
// lists nothing says nothing: MeteoCore's default style has no parameters and draws them all
export interface PairSays {
  yes: ('parameter' | 'style')[];
  no: ('parameter' | 'style')[];
}

export function pairSays(collection: Collection, styles: readonly MapStyle[], parameter: string, styleId: string): PairSays {
  const says: PairSays = { yes: [], no: [] };
  const listed = parameterStyles(collection, parameter).styles;
  if (listed) (listed.includes(styleId) ? says.yes : says.no).push('parameter');
  const style = styles.find(each => each.id === styleId);
  if (style?.parameters.length) (style.parameters.includes(parameter) ? says.yes : says.no).push('style');
  return says;
}

// Whether a style can draw a parameter: a side says it can, or neither says anything of the pair. A yes from either side
// outweighs a no from the other
export function stylePossible(collection: Collection, styles: readonly MapStyle[], parameter: string, styleId: string): boolean {
  const says = pairSays(collection, styles, parameter, styleId);
  return says.yes.length > 0 || says.no.length === 0;
}

// The styles possible for each parameter chosen that parameter_names lists, in the order the styles are listed, and those
// parameters. Null with none chosen: then every style is offered
export function possibleStyles(collection: Collection, styles: readonly MapStyle[], chosen: readonly string[]): { styles: string[]; parameters: string[] } | null {
  const ids = parameterIdsOf(collection);
  const parameters = chosen.filter(parameter => ids.includes(parameter));
  if (!parameters.length) return null;
  return {
    styles: styles.filter(style => parameters.every(parameter => stylePossible(collection, styles, parameter, style.id))).map(style => style.id),
    parameters,
  };
}

// ---- The parameter-name field ----

export interface ParameterRow {
  id: string;
  label: string | null; // where it says more than the id
  unit: string;
  styles: string[]; // the styles listed for it, on either side
}

// The rows of parameter_names, in their order: the id as sent, its label (its own, else its observed property's), its
// unit, and the styles for it
export function parameterRows(collection: Collection, styles: readonly MapStyle[]): ParameterRow[] {
  return parameterIdsOf(collection).map(raw => {
    const id = String(raw);
    const entry = parameterEntry(collection, id) as { label?: unknown; observedProperty?: { label?: unknown }; unit?: { symbol?: unknown; label?: unknown } } | null;
    return {
      id,
      label: distinctLabel(id, parameterLabel(id, entry ?? undefined)),
      unit: parameterUnit(entry ?? undefined),
      styles: styles.filter(style => pairSays(collection, styles, id, style.id).yes.length > 0).map(style => style.id),
    };
  });
}

const DEFAULT_FIELDS = 'defaultFields';

// The fields of a map query that this form has, in order: the parameter, its time, level, model run and subset, then
// the output format. Each shows where it's declared or the request has it, and says who declared it
export function mapFieldSpecs(collection: Collection, chosen: { parameters: number }, context: FieldContext): FieldSpec[] {
  const offer = mapOffer(mapProfileNames(collection), context.conformsTo, context.apiDocs ?? null);
  const inRequest = new Set(context.inRequest ?? []);
  const requirementOf = (name: string) => (context.apiRequired?.includes(name) ? 'required by the API docs' as const : 'optional' as const);
  const docs = (name: string) => context.apiDocs?.find(param => param.name === name);
  const fields: FieldSpec[] = [];

  const parameterBy = declarersOf('parameter-name', offer);
  if (parameterBy.length || inRequest.has('parameter-name')) {
    const ids = parameterIdsOf(collection);
    const listed = docs('parameter-name');
    const several = !!listed?.isArray;
    const hints: Hint[] = [];
    if (ids.length) {
      hints.push(`From the collection's \`parameter_names\`. ${several ? "Several at once: the API docs' schema is an array"
        : listed ? "One at a time: the API docs' schema is a string" : 'One at a time: nothing says it takes several'}`);
    } else {
      hints.push(listed ? "The API docs list `parameter-name`, but the collection has no `parameter_names` to pick from: type one"
        : 'The collection has no `parameter_names` to pick from');
    }
    const defaults = strings((collection as unknown as Json)[DEFAULT_FIELDS]) ?? [];
    fields.push({
      title: several ? 'Parameters' : 'Parameter',
      name: 'parameter-name',
      id: 'parameter-name',
      requirement: requirementOf('parameter-name'),
      figure: ids.length ? (chosen.parameters ? `${chosen.parameters} of ${ids.length}` : `${ids.length} listed`) : undefined,
      hints,
      leftOut: defaults.length ? `the server draws its default, which \`${DEFAULT_FIELDS}\` names: ${defaults.map(id => `\`${id}\``).join(', ')}`
        : "the server draws its default, which the collection doesn't name",
      declaredBy: parameterBy,
      choice: several ? 'several' : 'one',
    });
  }

  fields.push(...mapDimensionSpecs(collection, offer, inRequest, requirementOf));

  const formatBy = declarersOf('f', offer);
  if (formatBy.length || inRequest.has('f')) {
    const listed = docs('f');
    const options = listed?.enumValues ?? [];
    const marked = listed?.defaultValue && options.includes(listed.defaultValue) ? listed.defaultValue : undefined;
    fields.push({
      title: 'Output format',
      name: 'f',
      id: 'f',
      requirement: requirementOf('f'),
      hints: [
        { text: 'Maps 1.0 negotiates the format by `Accept`, and has no `f`', rule: MAPS1.formatNegotiation },
        ...(options.length ? [`From the API docs' \`enum\`${marked ? ', the default marked' : ''}`] : []),
      ],
      leftOut: `by \`Accept\`, which the app sends as \`*/*\`: the server's default${listed?.defaultValue ? `, \`${listed.defaultValue}\` by the API docs` : ''}`,
      options,
      marked,
      declaredBy: formatBy,
    });
  }
  return fields;
}

// ---- What's wrong with a map request ----

// What a side lists, said after a style not listed for a parameter: its parameters, or the parameter's metocean:styles
function sideSays(collection: Collection, styles: readonly MapStyle[], side: 'parameter' | 'style', parameter: string, styleId: string): string {
  if (side === 'style') return `its parameters: ${styles.find(style => style.id === styleId)?.parameters.join(', ')}`;
  return `${parameter}'s metocean:styles: ${parameterStyles(collection, parameter).styles?.join(', ') || 'none'}`;
}

// A map's parameters against parameter_names, and its style against them. A parameter not listed is an error, as for EDR,
// which MeteoCore answers with 400. A style not listed for a parameter is sent anyway, as a test: a warning, since the
// server can be expected to refuse it. Where the two lists disagree, a note
export function mapQueryIssues(collection: Collection, parameters: readonly string[], styleId: string, styles: readonly MapStyle[]): QueryIssue[] {
  const issues: QueryIssue[] = [];
  const ids = parameterIdsOf(collection);
  const unknown = parameters.filter(parameter => !ids.includes(parameter));
  if (ids.length && unknown.length) {
    issues.push({
      id: 'metadata:parameter-name:offered', severity: 'error', source: 'metadata', field: 'parameter-name', input: 'form',
      message: `${unknown.join(', ')} ${unknown.length > 1 ? "aren't" : "isn't"} among the collection's parameter_names`,
    });
  }
  if (styleId) {
    for (const parameter of parameters.filter(each => ids.includes(each))) {
      if (!stylePossible(collection, styles, parameter, styleId)) {
        const says = pairSays(collection, styles, parameter, styleId);
        issues.push({
          id: `metadata:style:unlisted-${parameter}`, severity: 'warning', source: 'metadata', field: 'style', input: 'form',
          message: `${styleId} isn't listed for ${parameter} (${says.no.map(side => sideSays(collection, styles, side, parameter, styleId)).join('; ')}): expect a 4xx`,
        });
      }
    }
  }
  const disagree = ids.flatMap(parameter => styles.flatMap(style => {
    const says = pairSays(collection, styles, parameter, style.id);
    if (!says.yes.length || !says.no.length) return [];
    return [says.yes[0] === 'parameter'
      ? `${parameter}'s metocean:styles name ${style.id}, whose parameters don't list ${parameter}`
      : `${style.id} lists ${parameter} in its parameters, and ${parameter}'s metocean:styles don't name ${style.id}`];
  }));
  if (disagree.length) {
    const more = disagree.length > 3 ? `, and ${disagree.length - 3} more` : '';
    issues.push({
      id: 'metadata:style:disagree', severity: 'info', source: 'metadata', field: 'style',
      message: `The styles' parameters and the parameters' metocean:styles disagree: ${disagree.slice(0, 3).join('; ')}${more}`,
    });
  }
  return issues;
}

// What the API docs say of a map's parameters that the form can't show otherwise: several parameters where their schema
// takes one, which only a typed URL can send
export function mapApiDocsIssues(parameters: readonly string[], apiDocs: readonly ApiDocsParam[]): QueryIssue[] {
  const listed = apiDocs.find(param => param.name === 'parameter-name');
  if (!listed || listed.isArray || parameters.length < 2) return [];
  return [{
    id: 'openapi:parameter-name:one', severity: 'warning', source: 'openapi', field: 'parameter-name', input: 'form', pointer: listed.pointer,
    message: `The API docs' parameter-name is a string, one parameter, and the request has ${parameters.length}`,
  }];
}
