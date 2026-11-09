import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { keptFormat, takesMapGeometry } from './queryTypes';

describe('keptFormat', () => {
  // As MeteoCore's ecmwf-ifs-pressure lists them, 2026-11-08, with a query that lists none of its own
  const link = (variables: Record<string, unknown>) => ({ link: { href: 'https://api.test/c/q', rel: 'data', variables } });
  const IFS = {
    id: 'ifs',
    output_formats: ['CoverageJSON', 'GeoJSON'],
    data_queries: {
      position: link({ query_type: 'position', output_formats: ['CoverageJSON', 'PNG', 'HTML'], default_output_format: 'CoverageJSON' }),
      area: link({ query_type: 'area', output_formats: ['CoverageJSON', 'HTML'], default_output_format: 'CoverageJSON' }),
      cube: link({ query_type: 'cube', default_output_format: 'CoverageJSON' }),
    },
  } as unknown as Collection;

  it("never starts from the format a query names as its default", () => {
    expect(keptFormat(IFS, 'position', '')).toBe('');
    expect(keptFormat(IFS, 'cube', '')).toBe('');
  });

  it('keeps the format chosen if the next query offers it', () => {
    expect(keptFormat(IFS, 'area', 'CoverageJSON')).toBe('CoverageJSON');
    expect(keptFormat(IFS, 'position', 'PNG')).toBe('PNG');
  });

  it("lets one go that the next query doesn't offer", () => {
    expect(keptFormat(IFS, 'area', 'PNG')).toBe('');
    // A query listing none of its own offers the collection's
    expect(keptFormat(IFS, 'cube', 'GeoJSON')).toBe('GeoJSON');
    expect(keptFormat(IFS, 'cube', 'PNG')).toBe('');
  });
});

describe('takesMapGeometry', () => {
  it.each(['position', 'radius', 'trajectory', 'corridor', 'area', 'cube', 'items'])('is true for %s', queryType => {
    expect(takesMapGeometry(queryType)).toBe(true);
  });

  it.each(['locations', 'instances', 'metadata', ''])('is false for "%s"', queryType => {
    expect(takesMapGeometry(queryType)).toBe(false);
  });
});
