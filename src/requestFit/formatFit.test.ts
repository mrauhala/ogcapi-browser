import { describe, expect, it } from 'vitest';
import { askedFormatFindings } from './formatFit';
import { EDR, EDR11, EDR12 } from '../standards';
import type { Collection } from '../types/api';
import fmi from './__fixtures__/fmi-ecmwf-collection.json';
import fmiUpper from './__fixtures__/fmi-ecmwf-temperature-upper.json';
import fmiGeojson from './__fixtures__/fmi-ecmwf-geojson.json';

// FMI's, whose queries each have CoverageJSON for their default_output_format
const FMI = fmi as unknown as Collection;
const URL_ = 'https://opendata.fmi.fi/edr/collections/ecmwf/position?coords=POINT(24.94 60.17)';
const withF = (f: string) => `${URL_}&f=${f}`;
const COVJSON = 'application/vnd.cov+json';
const messages = (found: { message: string }[]) => found.map(each => each.message);

describe('askedFormatFindings, with f', () => {
  it('passes a response in the format f names, in any letter case', () => {
    expect(askedFormatFindings(fmiUpper, COVJSON, { url: withF('CoverageJSON'), collection: null })).toEqual([
      { severity: 'pass', message: 'f=CoverageJSON, and the response is CoverageJSON', rule: EDR.fResponseA },
    ]);
    expect(messages(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: withF('geojson'), collection: null }))).toEqual(['f=geojson, and the response is GeoJSON']);
  });

  it('makes an issue of a response in another format, by its body: f’s rule is a SHOULD', () => {
    expect(askedFormatFindings(fmiUpper, COVJSON, { url: withF('GeoJSON'), collection: FMI })).toEqual([
      { severity: 'warning', message: "f=GeoJSON, and the response isn't GeoJSON: it's CoverageJSON", rule: EDR.fResponseA },
    ]);
    expect(messages(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: withF('CoverageJSON'), collection: null }))).toEqual(["f=CoverageJSON, and the response isn't CoverageJSON: it's GeoJSON"]);
    // Whatever its Content-Type says, which its media type's own check looks at
    expect(messages(askedFormatFindings(fmiGeojson, COVJSON, { url: withF('CoverageJSON'), collection: null }))).toEqual(["f=CoverageJSON, and the response isn't CoverageJSON: it's GeoJSON"]);
    expect(messages(askedFormatFindings({ code: 'x' }, COVJSON, { url: withF('CoverageJSON'), collection: null }))).toEqual(["f=CoverageJSON, and the response isn't CoverageJSON: it's JSON"]);
    // A body that isn't JSON at all, though its Content-Type says CoverageJSON: nothing to say of what it is
    expect(messages(askedFormatFindings(null, COVJSON, { url: withF('CoverageJSON'), collection: null }))).toEqual(["f=CoverageJSON, and the response isn't CoverageJSON"]);
  });

  it('knows each format by its other names, and its body by any CoverageJSON or GeoJSON type', () => {
    expect(messages(askedFormatFindings({ type: 'CoverageCollection', coverages: [] }, COVJSON, { url: withF('covjson'), collection: null }))).toEqual(['f=covjson, and the response is CoverageJSON']);
    expect(messages(askedFormatFindings({ type: 'Domain' }, COVJSON, { url: withF('CoverageJSON'), collection: null }))).toEqual(['f=CoverageJSON, and the response is CoverageJSON']);
    expect(messages(askedFormatFindings({ type: 'Feature' }, 'application/geo+json', { url: withF('GeoJSON'), collection: null }))).toEqual(['f=GeoJSON, and the response is GeoJSON']);
    expect(messages(askedFormatFindings(null, 'Image/JPEG', { url: withF('jpg'), collection: null }))).toEqual(['f=jpg, and the response is JPEG']);
    expect(messages(askedFormatFindings(null, 'image/png', { url: withF('JPEG'), collection: null }))).toEqual(["f=JPEG, and the response isn't JPEG: it's PNG"]);
  });

  it('tells the other formats by their media type', () => {
    expect(messages(askedFormatFindings(null, 'text/csv; charset=utf-8; header=present', { url: withF('CSV'), collection: null }))).toEqual(['f=CSV, and the response is CSV']);
    expect(messages(askedFormatFindings(null, 'text/html', { url: withF('HTML'), collection: null }))).toEqual(['f=HTML, and the response is HTML']);
    expect(messages(askedFormatFindings(null, 'image/png', { url: withF('PNG'), collection: null }))).toEqual(['f=PNG, and the response is PNG']);
    expect(messages(askedFormatFindings(null, 'text/html', { url: withF('CSV'), collection: null }))).toEqual(["f=CSV, and the response isn't CSV: it's HTML"]);
    expect(messages(askedFormatFindings(null, 'text/plain', { url: withF('CSV'), collection: null }))).toEqual(["f=CSV, and the response isn't CSV: it's text/plain"]);
    expect(messages(askedFormatFindings(fmiUpper, COVJSON, { url: withF('CSV'), collection: null }))).toEqual(["f=CSV, and the response isn't CSV: it's CoverageJSON"]);
    expect(messages(askedFormatFindings(null, '', { url: withF('CSV'), collection: null }))).toEqual(["f=CSV, and the response isn't CSV"]);
  });

  it('takes any JSON for JSON', () => {
    expect(messages(askedFormatFindings(fmiUpper, COVJSON, { url: withF('JSON'), collection: null }))).toEqual(['f=JSON, and the response is JSON']);
    expect(messages(askedFormatFindings(null, 'application/json', { url: withF('json'), collection: null }))).toEqual(['f=json, and the response is JSON']);
    // By its media type where the body wasn't read as JSON, as for one with a +json suffix
    expect(messages(askedFormatFindings(null, 'application/vnd.cov+json', { url: withF('JSON'), collection: null }))).toEqual(['f=JSON, and the response is JSON']);
    expect(messages(askedFormatFindings({ a: 1 }, 'text/plain', { url: withF('JSON'), collection: null }))).toEqual(['f=JSON, and the response is JSON']);
    expect(messages(askedFormatFindings(null, 'text/csv', { url: withF('JSON'), collection: null }))).toEqual(["f=JSON, and the response isn't JSON: it's CSV"]);
  });

  it('says nothing of a format it doesn’t know, or an empty f', () => {
    expect(askedFormatFindings(null, 'application/x-netcdf', { url: withF('NetCDF'), collection: FMI })).toEqual([]);
    expect(askedFormatFindings(fmiUpper, COVJSON, { url: withF(''), collection: FMI })).toEqual([]);
  });
});

describe('askedFormatFindings, without f', () => {
  it('passes the query’s default_output_format, as the collection gives it', () => {
    expect(askedFormatFindings(fmiUpper, COVJSON, { url: URL_, collection: FMI })).toEqual([
      { severity: 'pass', message: "No f was asked for, and the response is CoverageJSON, the query's default_output_format", rule: EDR.fResponseC },
    ]);
  });

  it('makes an issue of another format: C is a SHOULD', () => {
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: URL_, collection: FMI })).toEqual([
      { severity: 'warning', message: "No f was asked for, and the response isn't CoverageJSON, the query's default_output_format: it's GeoJSON", rule: EDR.fResponseC },
    ]);
  });

  it('says nothing without the collection’s query to give a default', () => {
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: URL_, collection: null })).toEqual([]);
    // An instance's query isn't one of the collection's, whose defaults the app has
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: URL_.replace('/position', '/instances/x/position'), collection: FMI })).toEqual([]);
    const noDefault = { ...FMI, data_queries: { position: { link: { href: 'https://opendata.fmi.fi/edr/collections/ecmwf/position' } } } } as unknown as Collection;
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: URL_, collection: noDefault })).toEqual([]);
  });
});

describe('askedFormatFindings says nothing', () => {
  it('of what isn’t a data query’s answer', () => {
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: 'https://opendata.fmi.fi/edr/collections/ecmwf/locations?f=CoverageJSON', collection: FMI })).toEqual([]);
    expect(askedFormatFindings(fmiGeojson, 'application/geo+json', { url: 'https://opendata.fmi.fi/edr/collections/ecmwf?f=CoverageJSON', collection: FMI })).toEqual([]);
  });
});

describe('the rules for f', () => {
  it('cite A for f, and C for the default, in both versions', () => {
    expect(EDR.fResponseA.edr).toEqual({ '1.1': EDR11.fResponseA, '1.2': EDR12.fResponseA });
    expect(EDR.fResponseC.edr).toEqual({ '1.1': EDR11.fResponseC, '1.2': EDR12.fResponseC });
    expect(EDR.parameterNameResponseA.edr).toEqual({ '1.1': EDR11.parameterNameResponseA, '1.2': EDR12.parameterNameResponseA });
    expect(EDR.parameterObject.edr).toEqual({ '1.1': EDR11.parameterObject, '1.2': EDR12.parameterObject });
    expect(EDR12.parameterObject.label).toBe('EDR 1.2 Annex C.14 (informative)');
    expect(EDR11.fResponseA.label).toBe('EDR 1.1 /req/edr/REQ_rc-f-response A');
    expect(EDR12.fResponseC.label).toBe('EDR 1.2 /req/edr/REQ_rc-f-response C, test B.59');
    expect(EDR12.parameterNameResponseA.label).toBe('EDR 1.2 /req/edr/parameter-name-response A, test B.51');
    expect(EDR11.parameterObject.label).toBe('EDR 1.1 Annex C.12 (informative)');
  });
});
