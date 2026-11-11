import { describe, expect, it } from 'vitest';
import { askedParameters, dataQueryOf } from './dataQuery';

const API = 'https://api.example.com/edr/collections/a';

describe('dataQueryOf', () => {
  it('names each data query by its path', () => {
    for (const type of ['position', 'radius', 'area', 'cube', 'trajectory', 'corridor']) {
      expect(dataQueryOf(`${API}/${type}?coords=POINT(1 2)`)).toEqual({ type, instance: false });
    }
    expect(dataQueryOf(`${API}/position/`)).toEqual({ type: 'position', instance: false });
  });

  it('takes a location’s data for one, and a list of locations for none', () => {
    expect(dataQueryOf(`${API}/locations/EDDK?parameter-name=t`)).toEqual({ type: 'locations', instance: false });
    expect(dataQueryOf(`${API}/locations`)).toBeNull();
    expect(dataQueryOf(`${API}/locations?f=GeoJSON`)).toBeNull();
  });

  it('says a query is of an instance', () => {
    expect(dataQueryOf(`${API}/instances/2026-11-10T00:00:00Z/position?coords=POINT(1 2)`)).toEqual({ type: 'position', instance: true });
    expect(dataQueryOf(`${API}/instances/run1/locations/EDDK`)).toEqual({ type: 'locations', instance: true });
  });

  it('takes nothing else for one', () => {
    for (const url of [`${API}`, `${API}/items`, `${API}/instances`, `${API}/instances/run1`, `${API}/position/extra`, 'https://api.example.com/edr/position', 'not a url']) {
      expect(dataQueryOf(url)).toBeNull();
    }
  });
});

describe('askedParameters', () => {
  it('reads the comma delimited names, each once, decoded and trimmed', () => {
    expect(askedParameters(`${API}/position?parameter-name=t,msl`)).toEqual(['t', 'msl']);
    expect(askedParameters(`${API}/position?parameter-name=Air%20Temperature, t,t,&f=CoverageJSON`)).toEqual(['Air Temperature', 't']);
  });

  it('is null without parameter-name, and empty for an empty one', () => {
    expect(askedParameters(`${API}/position?coords=POINT(1 2)`)).toBeNull();
    expect(askedParameters(`${API}/position?parameter-name=`)).toEqual([]);
    expect(askedParameters(`${API}/position?parameter-name=,`)).toEqual([]);
  });
});
