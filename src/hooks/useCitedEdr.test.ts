import { describe, expect, it } from 'vitest';
import { belongsToApi } from './useCitedEdr';

describe('belongsToApi', () => {
  it('takes the API’s root and what’s under it, with or without its trailing slash', () => {
    expect(belongsToApi('https://a.example/edr/collections/x/position?coords=POINT(1 2)', 'https://a.example/edr/')).toBe(true);
    expect(belongsToApi('https://a.example/edr/collections/x', 'https://a.example/edr')).toBe(true);
    expect(belongsToApi('https://a.example/edr?f=json', 'https://a.example/edr/')).toBe(true);
    expect(belongsToApi('https://a.example/edr/', 'https://a.example/edr')).toBe(true);
  });

  it('leaves out another API, one whose path only starts the same, and anything with nothing loaded', () => {
    expect(belongsToApi('http://localhost:5193/mc-ifs-zunsorted.json', 'http://localhost:5194/edr')).toBe(false);
    expect(belongsToApi('https://a.example/edr2/collections/x', 'https://a.example/edr')).toBe(false);
    expect(belongsToApi('https://b.example/edr/collections/x', 'https://a.example/edr/')).toBe(false);
    expect(belongsToApi('https://a.example/edr/collections/x', '')).toBe(false);
    expect(belongsToApi('https://a.example/edr/collections/x', null)).toBe(false);
  });
});
