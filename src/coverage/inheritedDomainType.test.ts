import { describe, expect, it } from 'vitest';
import { inheritedDomainType, withInheritedDomainType } from './inheritedDomainType';
import polytopeArea from './__fixtures__/polytope-op-multipoint-area.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const coverage = (domainType?: string) => ({ type: 'Coverage', domain: { type: 'Domain', ...(domainType ? { domainType } : {}), axes: {} }, ranges: {} });
const collection = (...coverages: unknown[]): Json => ({ type: 'CoverageCollection', domainType: 'MultiPoint', coverages });

describe('inheritedDomainType', () => {
  it('is the collection’s, when a coverage leaves its own out as it should', () => {
    expect(inheritedDomainType(polytopeArea)).toBe('MultiPoint');
    expect(inheritedDomainType(collection(coverage('MultiPoint'), coverage()))).toBe('MultiPoint');
  });

  it('is none when every coverage says its own', () => {
    expect(inheritedDomainType(collection(coverage('MultiPoint'), coverage('Grid')))).toBeNull();
  });

  it('is none without a collection that has one to give', () => {
    expect(inheritedDomainType({ ...coverage(), domainType: 'Grid' })).toBeNull();
    expect(inheritedDomainType({ ...coverage(), domainType: 'Grid', coverages: [coverage()] })).toBeNull();
    expect(inheritedDomainType({ ...collection(coverage()), domainType: undefined })).toBeNull();
    expect(inheritedDomainType({ ...collection(coverage()), domainType: 7 })).toBeNull();
    expect(inheritedDomainType({ ...collection(), coverages: 'none' })).toBeNull();
    for (const json of [null, 'x', 1, [], {}]) expect(inheritedDomainType(json)).toBeNull();
  });

  it('gives none to a domain that is a link, or a coverage that isn’t an object', () => {
    expect(inheritedDomainType(collection({ type: 'Coverage', domain: 'https://example.org/domain.json' }, { type: 'Coverage', domain: [] }, null, 'x', ['a']))).toBeNull();
  });
});

describe('withInheritedDomainType', () => {
  it('puts the type on each domain without one, and leaves the rest as they are', () => {
    const own = coverage('Grid');
    const json = collection(own, coverage());
    const read = withInheritedDomainType(json) as Json;
    expect(read.coverages[1].domain).toEqual({ type: 'Domain', domainType: 'MultiPoint', axes: {} });
    expect(read.coverages[0]).toBe(own);
    expect(read.domainType).toBe('MultiPoint');
  });

  it('changes nothing it was given', () => {
    const json = collection(coverage());
    const before = JSON.stringify(json);
    withInheritedDomainType(json);
    expect(JSON.stringify(json)).toBe(before);
  });

  it('gives back the response itself when there is nothing to inherit', () => {
    const json = collection(coverage('MultiPoint'));
    expect(withInheritedDomainType(json)).toBe(json);
    expect(withInheritedDomainType(null)).toBeNull();
  });

  it('keeps the rest of a coverage, ranges and all', () => {
    const read = withInheritedDomainType(polytopeArea) as Json;
    expect(read.coverages[0].ranges).toBe(polytopeArea.coverages[0].ranges);
    expect(read.coverages[0].domain.axes).toBe(polytopeArea.coverages[0].domain.axes);
    expect(read.coverages[0]['mars:metadata']).toEqual(polytopeArea.coverages[0]['mars:metadata']);
  });
});
