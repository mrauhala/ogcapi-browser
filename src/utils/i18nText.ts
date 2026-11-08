// CoverageJSON 9.2: an i18n object holds a text in several languages, each key a BCP 47 language tag, and "und" for a
// language that isn't known. A response can send anything there, so only text is read.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// The text to show: a string as it is. Of an i18n object, English, then any English, then a language not known, then the
// first in another language. EDR 1.2 sends a string where CoverageJSON has an i18n object
export function i18nText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return undefined;
  const texts = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  const tagged = (test: (tag: string) => boolean) => texts.find(([tag]) => test(tag.toLowerCase()));
  return (tagged(tag => tag === 'en') ?? tagged(tag => tag.startsWith('en-')) ?? tagged(tag => tag === 'und') ?? texts[0])?.[1];
}

// BCP 47, as CoverageJSON 1.0's schema has it for an i18n object's keys
const LANGUAGE_TAG = /^(((([A-Za-z]{2,3}(-([A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?)|[A-Za-z]{4}|[A-Za-z]{5,8})(-([A-Za-z]{4}))?(-([A-Za-z]{2}|[0-9]{3}))?(-([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*(-([0-9A-WY-Za-wy-z](-[A-Za-z0-9]{2,8})+))*))$/;

export const isLanguageTag = (tag: string): boolean => LANGUAGE_TAG.test(tag);
