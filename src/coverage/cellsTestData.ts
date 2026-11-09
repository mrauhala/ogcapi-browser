// CoverageJSON as real APIs send it, built small for tests. The shapes come from the responses saved while designing this
// view: MeteoCore's t × z × y × x grid, DMI's start/stop/num, FMI's Point collections, DWD's triangles.

type Json = Record<string, unknown>;

export const CRS84 = [{ coordinates: ['x', 'y'], system: { type: 'GeographicCRS', id: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } }];

export const counting = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

interface GridOptions {
  x?: unknown;
  y?: unknown;
  t?: string[];
  z?: number[];
  values?: unknown[];
  id?: string;
  unit?: string;
  domainType?: string;
  referencing?: unknown;
}

const axisOf = (axis: unknown) => (Array.isArray(axis) ? { values: axis } : axis);
const lengthOf = (axis: unknown) => (Array.isArray(axis) ? axis.length : (axis as { num?: number; values?: unknown[] })?.num ?? (axis as { values?: unknown[] })?.values?.length ?? 0);

// A Grid with its axes in the order [t, z, y, x], whose values are 0, 1, 2... unless it's given others. y runs north first
export function grid({
  x = [24, 25, 26, 27], y = [61, 60, 59], t, z, values, id = 'temperature', unit = 'K', domainType = 'Grid', referencing = CRS84,
}: GridOptions = {}): Json {
  const names = [...(t ? ['t'] : []), ...(z ? ['z'] : []), 'y', 'x'];
  const shape = [...(t ? [t.length] : []), ...(z ? [z.length] : []), lengthOf(y), lengthOf(x)];
  return {
    type: 'Coverage',
    domain: {
      type: 'Domain',
      domainType,
      axes: { x: axisOf(x), y: axisOf(y), ...(t ? { t: { values: t } } : {}), ...(z ? { z: { values: z } } : {}) },
      referencing,
    },
    parameters: { [id]: { type: 'Parameter', unit: { symbol: unit } } },
    ranges: { [id]: { type: 'NdArray', dataType: 'float', axisNames: names, shape, values: values ?? counting(shape.reduce((a, b) => a * b, 1)) } },
  };
}

interface PointOptions {
  t?: string[];
  z?: number[];
  values: Record<string, unknown[]>;
  // On the coverage, not the collection
  ownDomainType?: boolean;
}

export const pointCoverage = (x: number, y: number, { t, z, values, ownDomainType }: PointOptions): Json => ({
  type: 'Coverage',
  domain: {
    type: 'Domain',
    ...(ownDomainType ? { domainType: t && t.length > 1 ? 'PointSeries' : 'Point' } : {}),
    axes: { x: { values: [x] }, y: { values: [y] }, ...(t ? { t: { values: t } } : {}), ...(z ? { z: { values: z } } : {}) },
  },
  ranges: Object.fromEntries(Object.entries(values).map(([id, list]) => [id, { type: 'NdArray', values: list, shape: [list.length], axisNames: ['t'] }])),
});

export const pointCollection = (coverages: Json[], parameters: Json = { temperature: { type: 'Parameter', unit: { symbol: 'K' } } }): Json => ({
  type: 'CoverageCollection',
  domainType: 'Point',
  referencing: CRS84,
  parameters,
  coverages,
});

// A complete lattice sent the long way round, south first as FMI's are, and its values are its place: 100 × y + x
export const pointLattice = (xs: number[], ys: number[]) => pointCollection(
  ys.flatMap(y => xs.map(x => pointCoverage(x, y, { values: { temperature: [100 * y + x] } }))),
);

export const triangles = (values: unknown[], t?: string[]): Json => ({
  type: 'CoverageCollection',
  coverages: [{
    type: 'Coverage',
    domain: {
      type: 'Domain',
      domainType: 'MultiPolygonSeries',
      axes: {
        composite: {
          dataType: 'polygon',
          coordinates: ['x', 'y'],
          values: [
            [[[10, 50], [11, 50], [10.5, 51], [10, 50]]],
            [[[11, 50], [12, 50], [11.5, 51], [11, 50]]],
          ],
        },
        ...(t ? { t: { values: t } } : {}),
      },
      referencing: CRS84,
    },
    parameters: { CAPE: { type: 'Parameter', unit: { symbol: 'J/kg' } } },
    ranges: { CAPE: { type: 'NdArray', axisNames: [...(t ? ['t'] : []), 'composite'], shape: [...(t ? [t.length] : []), 2], values } },
  }],
});

const TIME = { coordinates: ['t'], system: { type: 'TemporalRS', calendar: 'Gregorian' } };
const PRESSURE = { coordinates: ['z'], system: { type: 'VerticalCRS', cs: { csAxes: [{ name: { en: 'Pressure' }, direction: 'down', unit: { symbol: 'hPa' } }] } } };
const HEIGHT = { coordinates: ['z'], system: { type: 'VerticalCRS', cs: { csAxes: [{ name: { en: 'Height' }, direction: 'up', unit: { symbol: 'm' } }] } } };

interface PathSectionOptions {
  // Positions along the path, evenly from 20 E 60 N to 30 E 65 N
  n: number;
  // A z axis on each coverage, in metres up, with a value at each position and level
  levels?: number[];
  // Each position at a level of its own, in hPa in the tuples: 1000, 950, 900...
  levelInTuples?: boolean;
  // A time per position in the tuples, 2 minutes apart, rather than one for all
  timeAlong?: boolean;
  // A collection with a coverage per level, each with a z axis of that one level in hPa, as MeteoCore sends a trajectory
  coveragePerLevel?: number[];
  // A collection of this many of the same coverage
  copies?: number;
}

// A path's answer in the shapes the domain probes made: a Section with a z axis, a Trajectory with z in its tuples or a
// coverage per level, or none. Each value is its place and level, 270 + x/10 + y/100 + z/1000, so a misplaced one shows
export function pathSection({ n, levels, levelInTuples = false, timeAlong = false, coveragePerLevel, copies = 1 }: PathSectionOptions): Json {
  const value = (x: number, y: number, z = 0) => Math.round((270 + x / 10 + y / 100 + z / 1000) * 1000) / 1000;
  const positions = counting(n).map(i => [Number((20 + (i * 10) / Math.max(n - 1, 1)).toFixed(4)), Number((60 + (i * 5) / Math.max(n - 1, 1)).toFixed(4))]);
  const timeOf = (i: number) => (timeAlong ? `2026-11-07T${String(Math.floor((i * 2) / 60)).padStart(2, '0')}:${String((i * 2) % 60).padStart(2, '0')}:00Z` : '2026-11-07T00:00:00Z');
  const tuples = positions.map(([x, y], i) => [timeOf(i), x, y, ...(levelInTuples ? [1000 - i * 50] : [])]);
  const coverage = (z: number[] | null): Json => ({
    type: 'Coverage',
    domain: {
      type: 'Domain',
      domainType: levels ? 'Section' : 'Trajectory',
      axes: {
        composite: { dataType: 'tuple', coordinates: ['t', 'x', 'y', ...(levelInTuples ? ['z'] : [])], values: tuples },
        ...(z ? { z: { values: z } } : {}),
      },
    },
    ranges: {
      temperature: levels
        ? { type: 'NdArray', dataType: 'float', axisNames: ['composite', 'z'], shape: [n, levels.length], values: positions.flatMap(([x, y]) => levels.map(level => value(x, y, level))) }
        : { type: 'NdArray', dataType: 'float', axisNames: ['composite'], shape: [n], values: positions.map(([x, y], i) => value(x, y, levelInTuples ? 1000 - i * 50 : z?.[0])) },
    },
  });
  const referencing = [CRS84[0], TIME, levels ? HEIGHT : PRESSURE];
  const parameters = { temperature: { type: 'Parameter', observedProperty: { label: { en: 'Air temperature' } }, unit: { symbol: 'K' } } };
  const coverages = coveragePerLevel ? coveragePerLevel.map(level => coverage([level])) : counting(copies).map(() => coverage(levels ?? null));
  if (coverages.length === 1) {
    const [only] = coverages;
    return { ...only, domain: { ...(only.domain as Json), referencing }, parameters };
  }
  return { type: 'CoverageCollection', domainType: levels ? 'Section' : 'Trajectory', parameters, referencing, coverages };
}

export const PATH_URL = 'https://example.org/edr/collections/c/trajectory?coords=LINESTRING(20%2060,30%2065)&parameter-name=temperature&f=CoverageJSON';

// Only what shows: the text between tags, without emotion's styles. Read tag by tag, rather than cut out by a pattern
export const words = (html: string) => {
  let inStyle = false;
  const shown: string[] = [];
  for (const piece of html.split(/(<[^>]*>)/)) {
    if (piece.startsWith('<')) {
      if (/^<style[\s>]/.test(piece)) inStyle = true;
      else if (piece === '</style>') inStyle = false;
      shown.push(' ');
    } else if (!inStyle) {
      shown.push(piece);
    }
  }
  return shown.join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
};
