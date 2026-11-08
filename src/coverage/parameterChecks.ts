import type { Rule, ValidationError } from '../types/api';
import { COVJSON, EDR12 } from '../standards';
import { i18nText, isLanguageTag } from '../utils/i18nText';

// What a coverage response says of its parameters: their units, labels and languages, each against CoverageJSON 9.3.
// The schema checks only that a unit's type and value are text, and has no rule for a parameter's label

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const pointerPart = (text: string) => text.replace(/~/g, '~0').replace(/\//g, '~1');
const plural = (count: number, noun: string) => `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;

// What a parameter is, from its name. Only what's named plainly, so that a unit is questioned only where the name agrees
export const NAMED = {
  temperature: /temperature|(^|[^a-z])t2m|tmp/,
  pressure: /pressure|mslp|prmsl/,
  humidity: /humidity/,
  wind: /wind|gust/,
};

const UCUM = 'http://www.opengis.net/def/uom/UCUM/';
// EDR 1.2's, for a collection's parameter_names
const UCUM_HTTPS = 'https://www.opengis.net/def/uom/UCUM/';
const LOOKS_LIKE_UCUM = /^https?:\/\/www\.opengis\.net\/def\/uom\/ucum\/?$/i;
// A URI of one unit, not of a scheme
const NAMES_A_UNIT = /^https?:\/\/qudt\.org\/vocab\/unit\//i;

// UCUM codes sent for something else, a short list and not a parser. Each only where the name agrees, but "-", which
// UCUM never has
const UCUM_MIXUPS: { code: string; named?: RegExp; says: string }[] = [
  { code: 'C', named: NAMED.temperature, says: `That's the coulomb. Degrees Celsius is "Cel"` },
  { code: 'degC', named: NAMED.temperature, says: `That isn't a UCUM code. Degrees Celsius is "Cel"` },
  { code: 'mb', named: NAMED.pressure, says: `That's the millibarn. A millibar is "mbar"` },
  { code: 'kt', named: NAMED.wind, says: `That's the kilotonne. A knot is "[kn_i]"` },
  { code: 'kts', named: NAMED.wind, says: `That isn't a UCUM code. A knot is "[kn_i]"` },
  { code: '-', says: `That isn't a UCUM code. UCUM writes no unit as "1"` },
];

interface Definition { id: string; parameter: Json; path: string }

// Each parameter once, where it's first defined: the collection's, then each coverage's own
function definitions(json: Json, coverages: Json[], prefix: (coverage: number) => string): Definition[] {
  const found = new Map<string, Definition>();
  const add = (parameters: unknown, at: string) => {
    if (!isObject(parameters)) return;
    for (const [id, parameter] of Object.entries(parameters)) {
      if (!found.has(id) && isObject(parameter)) found.set(id, { id, parameter, path: `${at}/parameters/${pointerPart(id)}` });
    }
  };
  add(json.parameters, '');
  coverages.forEach((coverage, index) => add(coverage.parameters, prefix(index)));
  return [...found.values()];
}

const sameText = (a: Json, b: Json) => {
  const keys = Object.keys(a);
  return keys.length > 0 && keys.length === Object.keys(b).length && keys.every(key => typeof a[key] === 'string' && a[key] === b[key]);
};

// What's found, of one parameter, and why it matters, which follows how many more parameters have it
interface Fault { kind: string; severity: NonNullable<ValidationError['severity']>; message: string; why?: string; path: string; rule?: Rule | readonly Rule[] }

function labelFaults({ id, parameter, path }: Definition, faults: Fault[]) {
  const { label } = parameter;
  if (label === undefined) return;
  const at = `${path}/label`;
  const rule = [COVJSON.parameter, COVJSON.i18n];
  if (!isObject(label)) {
    const why = typeof label === 'string' ? `CoverageJSON has an i18n object: {"en": "${label}"}` : undefined;
    faults.push({ kind: 'label-form', severity: 'error', message: `${id}'s label ${typeof label === 'string' ? 'is text' : `isn't an i18n object`}`, why, path: at, rule });
    return;
  }
  const badTag = Object.keys(label).find(tag => !isLanguageTag(tag));
  if (badTag !== undefined) faults.push({ kind: 'label-tag', severity: 'error', message: `${id}'s label has the language "${badTag}"`, why: `That isn't a language tag, such as "en"`, path: at, rule });
  const notText = Object.entries(label).find(([, text]) => typeof text !== 'string');
  if (notText) faults.push({ kind: 'label-text', severity: 'error', message: `${id}'s label in "${notText[0]}" isn't text`, path: `${at}/${pointerPart(notText[0])}`, rule });
  const observed = isObject(parameter.observedProperty) ? parameter.observedProperty.label : undefined;
  if (isObject(observed) && sameText(label, observed)) {
    faults.push({ kind: 'label-repeats', severity: 'info', message: `${id}'s label repeats its observed property's`, why: 'CoverageJSON says to leave it out then', path: at, rule: COVJSON.parameter });
  }
}

function unitFaults({ id, parameter, path }: Definition, faults: Fault[]) {
  const unit = isObject(parameter.unit) ? parameter.unit : undefined;
  const symbol = unit && isObject(unit.symbol) ? unit.symbol : undefined;
  const { type, value } = symbol ?? {};
  if (typeof type !== 'string') return;
  const at = `${path}/unit/symbol`;
  if (type === UCUM_HTTPS) {
    faults.push({
      kind: 'ucum-https', severity: 'info', path: `${at}/type`, rule: [COVJSON.parameter, EDR12.parameters],
      message: `${id}'s unit type is ${UCUM_HTTPS}`,
      why: `That's EDR 1.2's, for a collection's parameters. CoverageJSON's is ${UCUM}, so the two standards differ`,
    });
  } else if (type !== UCUM && LOOKS_LIKE_UCUM.test(type)) {
    faults.push({ kind: 'ucum-spelling', severity: 'warning', message: `${id}'s unit type is ${type}`, why: `For UCUM it must be ${UCUM}`, path: `${at}/type`, rule: COVJSON.parameter });
  } else if (NAMES_A_UNIT.test(type)) {
    faults.push({
      kind: 'unit-as-type', severity: 'info', path: `${at}/type`, rule: [COVJSON.parameter, COVJSON.customTypes],
      message: `${id}'s unit type is ${type}`,
      why: `That names a unit, where CoverageJSON's type names the scheme the symbol is written in, such as UCUM. A custom one is allowed, but a unit's URI fits unit.id`,
    });
  }
  if (!LOOKS_LIKE_UCUM.test(type) || typeof value !== 'string') return;
  const name = `${id} ${i18nText(parameter.label) ?? ''} ${isObject(parameter.observedProperty) ? i18nText(parameter.observedProperty.label) ?? '' : ''}`.toLowerCase();
  const mixup = UCUM_MIXUPS.find(each => each.code === value && (!each.named || each.named.test(name)));
  if (mixup) faults.push({ kind: `ucum-${mixup.code}`, severity: 'warning', message: `${id}'s unit is "${value}" in UCUM`, why: mixup.says, path: `${at}/value`, rule: COVJSON.parameter });
}

// A unit is a MAY, so its absence is a note. One with categories MUST NOT have one, so it isn't counted
function unitlessFaults(all: Definition[], faults: Fault[]) {
  const counted = all.filter(({ parameter }) => !(isObject(parameter.observedProperty) && Array.isArray(parameter.observedProperty.categories)));
  const unitless = counted.filter(({ parameter }) => parameter.unit === undefined);
  if (unitless.length === 0) return;
  const [first] = unitless;
  if (unitless.length === counted.length && counted.length > 1) {
    const named = unitless.slice(0, 2).map(each => each.id).join(', ');
    const rest = unitless.length - 2;
    faults.push({ kind: 'unitless-all', severity: 'info', message: `No parameter has a unit: ${named}${rest > 0 ? ` and ${rest} more` : ''}`, path: first.path });
    return;
  }
  for (const { id, path } of unitless) faults.push({ kind: 'unitless', severity: 'info', message: `${id} has no unit`, path });
}

// The same fault in many parameters is said once, of the first, with how many more
export function parameterFindings(json: Json, coverages: Json[], prefix: (coverage: number) => string): ValidationError[] {
  const all = definitions(json, coverages, prefix);
  const faults: Fault[] = [];
  for (const definition of all) {
    labelFaults(definition, faults);
    unitFaults(definition, faults);
  }
  unitlessFaults(all, faults);
  const said = new Map<string, { fault: Fault; more: number }>();
  for (const fault of faults) {
    const earlier = said.get(fault.kind);
    if (earlier) earlier.more++;
    else said.set(fault.kind, { fault, more: 0 });
  }
  return [...said.values()].map(({ fault: { message, why, severity, path, rule }, more }) => ({
    message: `${message}${more ? `, and likewise for ${plural(more, 'more parameter')}` : ''}${why ? `. ${why}` : ''}`, severity, path, ...(rule ? { rule } : {}),
  }));
}
