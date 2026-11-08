import { describe, expect, it } from 'vitest';
import { i18nText, isLanguageTag } from './i18nText';

describe('i18nText', () => {
  it('reads a string as it is, as EDR 1.2 sends a label', () => {
    expect(i18nText('Air temperature')).toBe('Air temperature');
    expect(i18nText('')).toBe('');
  });

  it('reads English first, then any English, then a language not known, then the first', () => {
    expect(i18nText({ fi: 'paine', en: 'pressure' })).toBe('pressure');
    expect(i18nText({ fi: 'Lämpötila', 'en-GB': 'Air temperature' })).toBe('Air temperature');
    expect(i18nText({ 'EN-us': 'Air temperature', fi: 'Lämpötila' })).toBe('Air temperature');
    expect(i18nText({ EN: 'Air temperature', 'en-GB': 'Air temperature (GB)' })).toBe('Air temperature');
    expect(i18nText({ de: 'Lufttemperatur', und: 'T2m' })).toBe('T2m');
    expect(i18nText({ de: 'Lufttemperatur', fi: 'Lämpötila' })).toBe('Lufttemperatur');
  });

  it('passes over what isn’t text', () => {
    expect(i18nText({ en: 3, fi: 'paine' })).toBe('paine');
    expect(i18nText({ en: { text: 'x' } })).toBeUndefined();
    expect(i18nText({})).toBeUndefined();
    expect(i18nText(null)).toBeUndefined();
    expect(i18nText(['pressure'])).toBeUndefined();
    expect(i18nText(5)).toBeUndefined();
  });

  it('takes "en" for English, not a tag that only starts with it', () => {
    expect(i18nText({ enx: 'x', 'en:': 'y', 'en-GB': 'z' })).toBe('z');
    expect(i18nText({ 'en:': 'y', fi: 'paine' })).toBe('y');
  });
});

describe('isLanguageTag', () => {
  it('knows BCP 47 tags as the schema has them', () => {
    for (const tag of ['en', 'fi', 'und', 'en-GB', 'de-CH', 'zh-Hant-TW', 'es-419', 'sr-Latn']) expect(isLanguageTag(tag), tag).toBe(true);
    for (const tag of ['en:', '', 'e', 'en_GB', 'english language', '-en', 'en-']) expect(isLanguageTag(tag), tag).toBe(false);
  });
});
