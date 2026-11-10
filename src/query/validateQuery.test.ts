import { describe, expect, it } from 'vitest';
import type { Collection } from '../types/api';
import { buildQueryModel, type QueryModelInput } from './queryModel';
import { addApiDocsIssues, summarizeIssues, typedIssues, validateQuery } from './validateQuery';
import type { BBox, QueryIssue } from './types';
import { EDR, FEATURES1 } from '../standards';
import fmiEcmwf from './__fixtures__/fmi-ecmwf.json';
import fmiPainepinta from './__fixtures__/fmi-ecmwf-painepinta.json';
import dwdIcon from './__fixtures__/dwd-icon-d2-ruc-single-level.json';
import meteocoreObs from './__fixtures__/meteocore-fmi-obs.json';

const FMI = fmiEcmwf as unknown as Collection;
const FMI_LEVELS = fmiPainepinta as unknown as Collection;
const DWD = dwdIcon as unknown as Collection;
const METEOCORE = meteocoreObs as unknown as Collection;

const HELSINKI: [number, number] = [24.94, 60.17];
const BERLIN: [number, number] = [13.4, 52.5];

function issuesFor(collection: Collection, queryKey: string, overrides: Partial<QueryModelInput> = {}) {
  const model = buildQueryModel({
    collection, queryKey, format: 'CoverageJSON', parameters: [], datetime: '', vertical: '',
    customDims: {}, points: [], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null, ...overrides,
  });
  return validateQuery(model!);
}

// Issues other than notes, as "severity field: message" for readable assertions
const problems = (issues: ReturnType<typeof validateQuery>) =>
  issues.filter(issue => issue.severity !== 'info').map(issue => `${issue.severity} ${issue.field}`);
const ids = (issues: ReturnType<typeof validateQuery>) => issues.map(issue => issue.id);

describe('EDR geometry rules', () => {
  it('position needs a point, picked on the map', () => {
    const issues = issuesFor(FMI, 'position');
    expect(problems(issues)).toEqual(['missing coords']);
    expect(issues[0]).toMatchObject({ input: 'map', source: 'edr', message: 'Click a point on the map' });
    expect(problems(issuesFor(FMI, 'position', { points: [HELSINKI] }))).toEqual([]);
  });

  it('warns about points outside the collection spatial extent', () => {
    expect(problems(issuesFor(DWD, 'position', { points: [BERLIN] }))).toEqual([]);
    expect(problems(issuesFor(DWD, 'position', { points: [BERLIN, HELSINKI] }))).toEqual(['warning coords']);
  });

  it('trajectory needs at least 2 points', () => {
    expect(problems(issuesFor(FMI, 'trajectory', { points: [HELSINKI] }))).toEqual(['missing coords']);
    expect(problems(issuesFor(FMI, 'trajectory', { points: [HELSINKI, [25, 61]] }))).toEqual([]);
  });

  it('area needs a polygon with at least 3 corners', () => {
    expect(problems(issuesFor(FMI, 'area'))).toEqual(['missing coords']);
    expect(problems(issuesFor(FMI, 'area', { polygons: [[[24, 60], [25, 61], [24, 60]]] }))).toEqual(['error coords']);
    expect(problems(issuesFor(FMI, 'area', { polygons: [[[24, 60], [25, 60], [25, 61], [24, 60]]] }))).toEqual([]);
  });

  // within is a string to EDR, with no rule on its sign; a within-units value "SHALL be one of the values defined in the
  // instance metadata"
  it('radius checks the radius and its unit against within_units', () => {
    expect(problems(issuesFor(FMI, 'radius', { points: [HELSINKI] }))).toEqual([]);
    expect(problems(issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: 0, units: 'km' } }))).toEqual(['warning within']);
    // Saying so without a "must", which no rule has
    expect(issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: -2, units: 'km' } }).find(issue => issue.field === 'within')?.message).toBe("A radius of -2 isn't greater than 0");
    const wrongUnit = issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: 5, units: 'm' } });
    expect(problems(wrongUnit)).toEqual(['error within-units']);
    expect(wrongUnit[0].message).toContain('km, mi');
    expect(problems(issuesFor(DWD, 'radius', { points: [BERLIN], radius: { value: 5, units: 'm' } }))).toEqual([]);
  });

  it('radius says what of it is still to choose, as EDR requires within and within-units', () => {
    const radius = (value: number | null, units: string) => issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value, units } });
    expect(problems(radius(null, ''))).toEqual(['missing within', 'missing within-units']);
    expect(radius(null, '')).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'within', input: 'form', message: 'Set the radius' }),
      expect.objectContaining({ field: 'within-units', input: 'form', message: 'Pick the unit of the radius' }),
    ]));
    expect(problems(radius(25, ''))).toEqual(['missing within-units']);
    expect(problems(radius(null, 'km'))).toEqual(['missing within']);
    // A query that lists no units still needs one
    expect(problems(issuesFor(DWD, 'radius', { points: [BERLIN], radius: { value: 5, units: '' } }))).toEqual(['missing within-units']);
  });

  it('cube needs a real lon/lat box over the collection', () => {
    const cube = (bbox: [number, number, number, number] | null) => problems(issuesFor(FMI_LEVELS, 'cube', { bbox }));
    expect(cube([24, 60, 25, 61])).toEqual([]);
    expect(cube(null)).toEqual(['missing bbox']);
    expect(issuesFor(FMI_LEVELS, 'cube').find(issue => issue.field === 'bbox')).toMatchObject({ input: 'map' });
    // Edges outside lon/lat break "The coordinate values SHALL be within the extent specified for the coordinate
    // reference system"; the corners' order has no keyword, so a box upside down only looks wrong
    expect(cube([24, 60, 25, 95])).toEqual(['error bbox']);
    expect(cube([24, 62, 25, 61])).toEqual(['warning bbox']);
    // Features Part 1: west larger than east spans the antimeridian, and a degenerated box matches what touches it
    const noted = (bbox: [number, number, number, number]) => issuesFor(FMI_LEVELS, 'cube', { bbox }).filter(issue => issue.field === 'bbox').map(issue => `${issue.severity} ${issue.id}`);
    expect(noted([25, 60, 24, 61])).toEqual(['info edr:bbox:antimeridian']);
    expect(noted([24, 61, 25, 61])).toEqual(['info edr:bbox:degenerate']);
    expect(noted([24, 60, 24, 61])).toEqual(['info edr:bbox:degenerate']);
    // ecmwf_painepinta is global; DWD's ICON-D2 covers central Europe
    expect(problems(issuesFor(DWD, 'cube', { bbox: [150, -40, 160, -30] }))).toEqual(['warning bbox']);
    expect(problems(issuesFor(DWD, 'cube', { bbox: [10, 50, 11, 51] }))).toEqual([]);
  });

  it('says nothing of an instances list: the instance field says what it lists', () => {
    expect(ids(issuesFor(FMI, 'instances'))).toEqual([]);
  });

  // On a collection with levels, so that the height is asked for too. A width is a string to EDR, with no rule on its
  // sign; a unit not supported gets "a HTTP 400 error SHOULD be generated"
  it('corridor needs a centre line and a width with its unit', () => {
    const line: [number, number][] = [HELSINKI, [25.5, 61.2]];
    const height = { 'corridor-height': '100', 'height-units': 'hPa' };
    const corridor = (queryParams: Record<string, string>, points = line) =>
      problems(issuesFor(FMI_LEVELS, 'corridor', { points, queryParams: { ...height, ...queryParams }, vertical: '850' }));
    const complete = { 'corridor-width': '10', 'width-units': 'km' };
    expect(corridor(complete)).toEqual([]);
    expect(corridor(complete, [HELSINKI])).toEqual(['missing coords']);
    expect(corridor({})).toEqual(['missing corridor-width', 'missing width-units']);
    expect(corridor({ ...complete, 'corridor-width': '0' })).toEqual(['warning corridor-width']);
    expect(corridor({ ...complete, 'width-units': 'm' })).toEqual(['warning width-units']); // FMI lists km and mi
    expect(issuesFor(FMI, 'corridor', { points: line, queryParams: {} }).find(issue => issue.field === 'corridor-width'))
      .toMatchObject({ input: 'form', message: 'Set the corridor width' });
  });

  it('corridor height: only with vertical levels, and then measured from a chosen level', () => {
    const line: [number, number][] = [HELSINKI, [25.5, 61.2]];
    const width = { 'corridor-width': '10', 'width-units': 'km' };
    // ecmwf has no levels: no height is asked for (FMI rejects one without z), and the corridor sent without one breaks
    // "A corridor GET operation SHALL include a corridor-height query parameter", which is said as an error
    const flat = issuesFor(FMI, 'corridor', { points: line, queryParams: width });
    expect(problems(flat)).toEqual(['error corridor-height']);
    expect(flat.find(issue => issue.id === 'edr:corridor-height:no-levels')).toMatchObject({
      severity: 'error', input: undefined, rule: EDR.corridorHeight,
      message: 'EDR requires a corridor height, and this collection has no vertical levels to measure one from, so the corridor is sent without one',
    });

    const corridor = (queryParams: Record<string, string>, vertical = '') =>
      problems(issuesFor(FMI_LEVELS, 'corridor', { points: line, queryParams: { ...width, ...queryParams }, vertical }));
    const at850 = '850';
    expect(corridor({ 'corridor-height': '100', 'height-units': 'hPa' }, at850)).toEqual([]);
    expect(corridor({})).toEqual(['missing corridor-height', 'missing height-units']);
    expect(corridor({ 'corridor-height': '100', 'height-units': 'hPa' })).toEqual(['missing z']);
    // A level range with one end isn't a level for the centre yet
    const half = issuesFor(FMI_LEVELS, 'corridor', { points: line, queryParams: { ...width, 'corridor-height': '100', 'height-units': 'hPa' }, vertical: '850/' });
    expect(ids(half)).toContain('edr:z:corridor-centre');
    expect(corridor({ 'corridor-height': 'tall', 'height-units': 'km' }, at850)).toEqual(['warning corridor-height', 'warning height-units']);
  });

  it('items: an optional box, a positive whole limit, and the time but no data selection', () => {
    const items = (overrides: Partial<QueryModelInput>) => issuesFor(METEOCORE, 'items', { format: 'GeoJSON', ...overrides });
    // Left out, the limit and the time are the server's: their fields say so, and no note does
    expect(ids(items({}))).toEqual([]);
    expect(ids(items({ queryParams: { limit: '50' } }))).toEqual([]);
    expect(problems(items({ queryParams: { limit: '0' } }))).toEqual(['error limit']);
    expect(problems(items({ queryParams: { limit: '2.5' } }))).toEqual(['error limit']);
    expect(problems(items({ bbox: [24, 61, 25, 60] }))).toEqual(['warning bbox']);
    // Leftover selections from another query type aren't checked: they aren't sent
    expect(problems(items({ parameters: ['nope'], vertical: '1/' }))).toEqual([]);
    expect(problems(items({ datetime: '2026-10-06T06:00:00Z/' }))).toEqual(['missing datetime']);
  });

  it('says nothing of a time left out, of a list or of a location: the time field says what the server does', () => {
    const about = (issues: ReturnType<typeof validateQuery>) => issues.filter(issue => issue.field === 'datetime');
    expect(about(issuesFor(FMI, 'locations'))).toEqual([]);
    expect(about(issuesFor(FMI, 'locations', { locationFeature: { id: '658225' } }))).toEqual([]);
    expect(about(issuesFor(METEOCORE, 'items', { format: 'GeoJSON', datetime: '' }))).toEqual([]);
    expect(about(issuesFor(FMI, 'position', { points: [HELSINKI] }))).toEqual([]);
  });

  it('takes an open-ended time interval', () => {
    const range = (start: string, end: string) => problems(issuesFor(FMI, 'position', { points: [HELSINKI], datetime: `${start}/${end}` })).filter(issue => issue.endsWith('datetime'));
    expect(range('..', '2026-11-05T00:00:00Z').filter(issue => issue.startsWith('error'))).toEqual([]);
    expect(range('2026-11-05T00:00:00Z', '..').filter(issue => issue.startsWith('error'))).toEqual([]);
    expect(range('..', 'garbage')).toContain('error datetime');
    // As the time control writes a range with its start only: no end missing
    expect(range('2026-11-05T00:00:00Z', '..')).not.toContain('missing datetime');
    expect(range('2026-11-05T00:00:00Z', '')).toContain('missing datetime');
  });

  it('says nothing of a locations list: the location field says it lists them all', () => {
    expect(ids(issuesFor(FMI, 'locations'))).toEqual([]);
  });
});

describe('collection metadata checks', () => {
  it('checks the output format, and says nothing when none is chosen: the field marks the default', () => {
    expect(problems(issuesFor(FMI, 'position', { points: [HELSINKI], format: 'NetCDF' }))).toEqual(['error f']);
    expect(issuesFor(FMI, 'position', { points: [HELSINKI], format: 'NetCDF' }).find(issue => issue.field === 'f')?.message)
      .toBe('Output format "NetCDF" isn\'t offered for this query');
    expect(issuesFor(FMI, 'position', { points: [HELSINKI], format: '' }).filter(issue => issue.field === 'f')).toEqual([]);
    expect(issuesFor(FMI, 'position', { points: [HELSINKI], format: 'CoverageJSON' }).filter(issue => issue.field === 'f')).toEqual([]);
  });

  it('checks parameter names and notes when none are chosen', () => {
    const issues = issuesFor(FMI, 'position', { points: [HELSINKI], parameters: ['humidity', 'Bogus'] });
    expect(problems(issues)).toEqual(['error parameter-name']);
    expect(issues[0].message).toBe('Unknown parameter: Bogus');
    // None chosen, the server sends them all: the field says so, and no note does
    expect(issuesFor(FMI, 'position', { points: [HELSINKI] }).filter(issue => issue.field === 'parameter-name')).toEqual([]);
  });

  it('checks the datetime: complete ranges, valid values, order and extent', () => {
    const at = (datetime: QueryModelInput['datetime']) => problems(issuesFor(FMI, 'position', { points: [HELSINKI], datetime }));
    expect(at('2026-10-06T12:00:00Z')).toEqual([]);
    expect(at('2026-10-06T00:00:00Z/')).toEqual(['missing datetime']);
    // Not a date-time breaks "The parameter value SHALL conform to the following syntax"; nothing orders an interval's ends
    expect(at('yesterday')).toEqual(['error datetime']);
    expect(at('2026-10-08T00:00:00Z/2026-10-06T00:00:00Z')).toEqual(['warning datetime']);
    expect(at('2025-01-01T00:00:00Z')).toEqual(['warning datetime']);
    // Extent bounds with +00:00 offsets (MeteoCore)
    expect(problems(issuesFor(METEOCORE, 'position', {
      points: [HELSINKI], datetime: '2026-10-01T00:00:00Z',
    }))).toEqual([]);
  });

  // z's forms "can be defined" (1.1) or "MAY be defined" (1.2) under no SHALL, and what meets z is what's returned: a level
  // the collection hasn't, or one that isn't a number, only looks wrong
  it('checks vertical levels against the listed levels and the interval', () => {
    const at = (vertical: QueryModelInput['vertical']) => problems(issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical }));
    expect(at('850')).toEqual([]);
    expect(at('851')).toEqual(['warning z']);
    expect(at('high')).toEqual(['warning z']);
    expect(at('300/')).toEqual(['missing z']);
    expect(at('200/2000')).toEqual(['warning z']);
    expect(at('1000/500')).toEqual([]);
    expect(at('/300')).toEqual(['missing z']);
  });

  it('takes a range typed in the text field as a range, not as a level that isn’t a number', () => {
    const at = (vertical: string) => problems(issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical }));
    expect(at('1000/500')).toEqual([]);
    expect(at('1000/abc')).toEqual(['warning z']);
  });

  it('takes a range open at an end, as EDR 1.2 has them, and still checks its level', () => {
    const at = (vertical: string) => problems(issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical }));
    expect(at('500/..')).toEqual([]);
    expect(at('../500')).toEqual([]);
    expect(at('2000/..')).toEqual(['warning z']);
    expect(at('abc/..')).toEqual(['warning z']);
    // A list isn't a range: an open end in it is no level
    expect(at('500,..')).toEqual(['warning z']);
  });

  describe('z as EDR 1.1 has it: a level, a list, a range or a repeating interval', () => {
    const messages = (value: string) => issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical: value })
      .filter(issue => issue.field === 'z').map(issue => `${issue.severity}: ${issue.message}`);

    it('takes a list of the collection’s levels, however it’s spaced', () => {
      expect(messages('1000,925,850')).toEqual([]);
      expect(messages('1000, 925 ,850')).toEqual([]);
      expect(messages('1000.0,850')).toEqual([]);
    });

    it('names the levels not listed in one issue', () => {
      expect(messages('1000,777,850')).toEqual(["warning: Level 777 isn't one of the collection's levels"]);
      expect(messages('1000,777,333')).toEqual(["warning: Levels 777, 333 aren't among the collection's levels"]);
    });

    it('names those outside the extent in one issue', () => {
      expect(messages('1000,2000,10')).toEqual([
        "warning: Levels 2000, 10 aren't among the collection's levels",
        "warning: 2000, 10 are outside the collection's vertical extent (50 – 1000)",
      ]);
      expect(messages('1000,2000')).toEqual(["warning: Level 2000 isn't one of the collection's levels", "warning: 2000 is outside the collection's vertical extent (50 – 1000)"]);
      expect(messages('2000')).toEqual(["warning: Level 2000 isn't one of the collection's levels", "warning: The selected level is outside the collection's vertical extent (50 – 1000)"]);
    });

    it('says what isn’t a number, and an empty entry', () => {
      expect(messages('1000,high')).toEqual(['warning: Level "high" isn\'t a number']);
      expect(messages('1000,,850')).toEqual(['warning: The list of levels "1000,,850" has an empty entry']);
    });

    it('takes a repeating interval, its first and last levels inside the extent', () => {
      // 500, 600, 700, 800
      expect(messages('R3/500/100')).toEqual([]);
      // To 1100
      expect(messages('R6/500/100')).toEqual(["warning: The selected levels go outside the collection's vertical extent (50 – 1000)"]);
      expect(messages('R3/10/100')).toEqual(["warning: The selected levels go outside the collection's vertical extent (50 – 1000)"]);
    });

    it('says what a repeating interval lacks, or what in it isn’t a number', () => {
      expect(messages('R3/low/100')).toEqual(['warning: Level "low" isn\'t a number']);
      expect(messages('R3/500/')).toEqual(['warning: The repeating interval "R3/500/" needs its lowest level and its step, as R3/500/100']);
    });
  });

  it('asks for both ends of a custom dimension range', () => {
    const issues = issuesFor(FMI, 'position', {
      points: [HELSINKI], customDims: { member: '1/' },
    });
    expect(problems(issues)).toEqual(['missing dim:member']);
  });
});

describe('ordering and summary', () => {
  it('sorts issues missing, error, warning, info and summarizes them', () => {
    const issues = issuesFor(DWD, 'area', {
      format: 'NetCDF', polygons: [[[24, 60], [25, 61], [24, 60]]],
      datetime: '2026-10-05T12:00:00Z/',
    });
    const order = issues.map(issue => issue.severity);
    expect(order).toEqual([...order].sort((a, b) => ['missing', 'error', 'warning', 'info'].indexOf(a) - ['missing', 'error', 'warning', 'info'].indexOf(b)));
    expect(summarizeIssues(issues)).toMatchObject({ missing: 1, needsAttention: true });
    expect(summarizeIssues([])).toEqual({ missing: 0, error: 0, warning: 0, info: 0, needsAttention: false });
  });
});

describe('addApiDocsIssues', () => {
  const model = (overrides: Partial<QueryModelInput> = {}) => buildQueryModel({
    collection: FMI, queryKey: 'position', format: 'CoverageJSON', parameters: [], datetime: '', vertical: '',
    customDims: {}, points: [HELSINKI], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: 10, units: 'km' }, queryParams: {}, locationFeature: null, ...overrides,
  })!;
  const apiIssue = (field: string, severity: QueryIssue['severity'] = 'warning'): QueryIssue => ({
    id: `openapi:${field}:rule`, severity, source: 'openapi', field, message: `about ${field}`, pointer: '/paths',
  });

  it('places API docs issues on the builder fields they concern', () => {
    const issues = addApiDocsIssues(
      model({ customDims: { member: '1' } }),
      [], { operation: null, issues: [apiIssue('member'), apiIssue('f'), apiIssue('coords'), apiIssue('query', 'info')] },
    );
    expect(issues.map(issue => [issue.id, issue.field, issue.input])).toEqual([
      ['openapi:dim:member:rule', 'dim:member', 'form'],
      ['openapi:f:rule', 'f', 'form'],
      ['openapi:coords:rule', 'coords', undefined],
      ['openapi:query:rule', 'query', undefined],
    ]);
  });

  it("leaves a field to EDR and the metadata when they already flag it, but not when they only note it", () => {
    // A corridor on ecmwf, which has no levels: coords missing, f not offered, and the height left out
    const width = { 'corridor-width': '10', 'width-units': 'km' };
    const own = issuesFor(FMI, 'corridor', { format: 'NetCDF4', queryParams: width });
    const merged = addApiDocsIssues(model({ queryKey: 'corridor', format: 'NetCDF4', points: [], queryParams: width }), own,
      { operation: null, issues: [apiIssue('coords'), apiIssue('f'), apiIssue('corridor-height'), apiIssue('z')] });
    expect(merged.filter(issue => issue.source === 'openapi').map(issue => issue.field)).toEqual(['z']);
    // A box across the antimeridian is only noted, so the API docs still have their say on it
    const box: BBox = [25, 60, 24, 61];
    const noted = issuesFor(FMI_LEVELS, 'cube', { bbox: box });
    expect(noted.filter(issue => issue.field === 'bbox').map(issue => issue.severity)).toEqual(['info']);
    const kept = addApiDocsIssues(model({ collection: FMI_LEVELS, queryKey: 'cube', points: [], bbox: box }), noted, { operation: null, issues: [apiIssue('bbox')] });
    expect(kept.filter(issue => issue.source === 'openapi').map(issue => issue.field)).toEqual(['bbox']);
  });

  it("notes a missing parameter the API docs mark optional", () => {
    const corridor = buildQueryModel({
      collection: FMI_LEVELS, queryKey: 'corridor', format: 'CoverageJSON', parameters: [], datetime: '', vertical: '',
      customDims: {}, points: [HELSINKI, [25.5, 61.2]], polygons: [], bbox: null, bboxAsCoords: false, radius: { value: 10, units: 'km' },
      queryParams: { 'corridor-width': '10', 'width-units': 'km' }, locationFeature: null,
    })!;
    const param = (name: string, required: boolean) => ({ name, in: 'query', required, enumValues: null, isArray: false, pointer: '' });
    const operation = {
      entry: { template: '', segments: [], literalCount: 0, pointer: '', params: [param('corridor-height', false), param('height-units', true)] },
      pathParams: {}, via: 'server' as const,
    };
    const merged = addApiDocsIssues(corridor, validateQuery(corridor), { operation, issues: [] });
    expect(merged.filter(issue => issue.severity === 'missing').map(issue => issue.message)).toEqual([
      "Set the corridor height (the server's API docs mark it optional)",
      'Pick the unit of the corridor height',
    ]);
  });

  it('keeps the severity order, with the query\'s own issues first', () => {
    const own = issuesFor(FMI, 'position', { points: [HELSINKI], datetime: '2026-10-05T12:00:00Z/' });
    const merged = addApiDocsIssues(model(), own, { operation: null, issues: [apiIssue('query', 'info'), apiIssue('parameter-name')] });
    expect(merged.map(issue => `${issue.severity} ${issue.source}`)).toEqual([
      'missing metadata', 'warning openapi', ...own.filter(issue => issue.severity === 'info').map(issue => `info ${issue.source}`), 'info openapi',
    ]);
  });
});

describe('crs', () => {
  const withCrs = (crs: string, details?: unknown) => {
    const collection = details === undefined ? FMI : {
      ...FMI, data_queries: { ...FMI.data_queries, position: { link: { ...FMI.data_queries.position.link, variables: { query_type: 'position', crs_details: details } } } },
    } as unknown as Collection;
    return issuesFor(collection, 'position', { points: [HELSINKI], queryParams: { crs } }).filter(issue => issue.field === 'crs');
  };

  // "The crs parameter SHALL consist of an identifier selected from the enumerated list of valid values supplied in the
  // collections metadata"
  it('is an error where the query doesn’t list it in its crs_details, as f is', () => {
    expect(withCrs('EPSG:3067', [{ crs: 'OGC:CRS84' }, { crs: 'EPSG:4326' }])).toEqual([expect.objectContaining({
      severity: 'error', source: 'metadata', input: 'form', message: "EPSG:3067 isn't in the query's crs_details (OGC:CRS84, EPSG:4326)", rule: EDR.crsResponseB,
    })]);
    expect(withCrs('EPSG:4326', [{ crs: 'OGC:CRS84' }, { crs: 'EPSG:4326' }])).toEqual([]);
  });

  it('is anything where the query lists none, and nothing left out', () => {
    expect(withCrs('EPSG:3067', [])).toEqual([]);
    expect(withCrs('EPSG:3067', 'not a list')).toEqual([]);
    expect(withCrs('', [{ crs: 'OGC:CRS84' }])).toEqual([]);
  });

  it('isn’t checked on a list, which doesn’t send it', () => {
    const list = issuesFor(FMI, 'locations', { queryParams: { crs: 'EPSG:3067' } }).filter(issue => issue.field === 'crs');
    expect(list).toEqual([]);
  });
});

// Each finding cites the rule it rests on, as Checks does; one that rests on none cites nothing
describe('the rules the findings rest on', () => {
  const line: [number, number][] = [HELSINKI, [25.5, 61.2]];
  const ruleOf = (issues: QueryIssue[], id: string) => {
    const found = issues.find(issue => issue.id === id);
    expect(found, id).toBeDefined();
    return found!.rule;
  };

  it('cites what EDR requires of each query type', () => {
    expect(ruleOf(issuesFor(FMI, 'position'), 'edr:coords:required')).toBe(EDR.positionCoords);
    expect(ruleOf(issuesFor(FMI, 'radius', { radius: { value: null, units: '' } }), 'edr:coords:required')).toBe(EDR.radiusCoords);
    expect(ruleOf(issuesFor(FMI, 'radius', { radius: { value: null, units: '' } }), 'edr:within:required')).toBe(EDR.radiusWithin);
    expect(ruleOf(issuesFor(FMI, 'radius', { radius: { value: null, units: '' } }), 'edr:within-units:required')).toBe(EDR.radiusWithinUnits);
    expect(ruleOf(issuesFor(FMI, 'area'), 'edr:coords:required')).toBe(EDR.areaCoords);
    expect(ruleOf(issuesFor(FMI, 'trajectory'), 'edr:coords:required')).toBe(EDR.trajectoryCoords);
    expect(ruleOf(issuesFor(FMI_LEVELS, 'cube'), 'edr:bbox:required')).toBe(EDR.cubeBbox);
    const corridor = issuesFor(FMI_LEVELS, 'corridor');
    expect(ruleOf(corridor, 'edr:coords:required')).toBe(EDR.corridorCoords);
    expect(ruleOf(corridor, 'edr:corridor-width:required')).toBe(EDR.corridorWidth);
    expect(ruleOf(corridor, 'edr:width-units:required')).toBe(EDR.corridorWidthUnits);
    expect(ruleOf(corridor, 'edr:corridor-height:required')).toBe(EDR.corridorHeight);
    expect(ruleOf(corridor, 'edr:height-units:required')).toBe(EDR.corridorHeightUnits);
  });

  it('cites the rule a value breaks, or the SHOULD it fails', () => {
    expect(ruleOf(issuesFor(FMI, 'area', { polygons: [[[24, 60], [25, 61], [24, 60]]] }), 'edr:coords:corners-0')).toBe(EDR.polygonCoords);
    expect(ruleOf(issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: 5, units: 'm' } }), 'metadata:within-units:offered')).toBe(EDR.withinUnitsDefinition);
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], format: 'NetCDF' }), 'metadata:f:offered')).toBe(EDR.fResponseB);
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], parameters: ['Bogus'] }), 'metadata:parameter-name:offered')).toBe(EDR.parameterNameResponseB);
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], datetime: 'yesterday' }), 'metadata:datetime:parse-0')).toEqual([EDR.datetimeSyntax, EDR.datetimeRfc3339]);
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], datetime: '2026-10-06T00:00:00Z/' }), 'metadata:datetime:range')).toBe(EDR.datetimeSyntax);
    expect(ruleOf(issuesFor(FMI_LEVELS, 'cube', { bbox: [24, 60, 25, 95] }), 'edr:bbox:range')).toBe(EDR.bboxWithinCrs);
    expect(ruleOf(issuesFor(FMI_LEVELS, 'cube', { bbox: [24, 62, 25, 61] }), 'edr:bbox:order')).toBe(EDR.bboxCorners);
    expect(ruleOf(issuesFor(FMI_LEVELS, 'cube', { bbox: [25, 60, 24, 61] }), 'edr:bbox:antimeridian')).toEqual([EDR.bboxCorners, FEATURES1.bboxResponse]);
    expect(ruleOf(issuesFor(FMI_LEVELS, 'cube', { bbox: [24, 61, 25, 61] }), 'edr:bbox:degenerate')).toBe(FEATURES1.bboxResponse);
    expect(ruleOf(issuesFor(METEOCORE, 'items', { format: 'GeoJSON', queryParams: { limit: '0' } }), 'edr:limit:positive')).toBe(EDR.limitDefinition);
    const corridor = (queryParams: Record<string, string>) => issuesFor(FMI_LEVELS, 'corridor', { points: line, vertical: '850', queryParams: { 'corridor-width': '10', 'width-units': 'km', 'corridor-height': '1', 'height-units': 'hPa', ...queryParams } });
    expect(ruleOf(corridor({ 'width-units': 'm' }), 'metadata:width-units:offered')).toBe(EDR.corridorWidthUnitsUnsupported);
    expect(ruleOf(corridor({ 'height-units': 'm' }), 'metadata:height-units:offered')).toBe(EDR.corridorHeightUnitsUnsupported);
  });

  it('cites the extent and z’s forms where a value only looks wrong', () => {
    expect(ruleOf(issuesFor(DWD, 'position', { points: [HELSINKI] }), 'metadata:coords:outside-0')).toBe(EDR.extent);
    expect(ruleOf(issuesFor(DWD, 'cube', { bbox: [150, -40, 160, -30] }), 'metadata:bbox:outside')).toBe(EDR.extent);
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], datetime: '2025-01-01T00:00:00Z' }), 'metadata:datetime:extent')).toBe(EDR.extent);
    const z = (vertical: string) => issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical });
    expect(ruleOf(z('851'), 'metadata:z:offered')).toBe(EDR.zResponse);
    expect(ruleOf(z('2000/..'), 'metadata:z:extent')).toBe(EDR.zResponse);
    expect(ruleOf(z('300/'), 'metadata:z:range')).toBe(EDR.zRange);
    expect(ruleOf(z('1000,,850'), 'metadata:z:empty')).toBe(EDR.zList);
    expect(ruleOf(z('R3/500/'), 'metadata:z:empty')).toBe(EDR.zRepeating);
  });

  // What a SHALL requires, or breaks, always says which: every missing and every error cites, but the corridor's centre
  // level, which is the form's own reading of where a height is measured from
  it('cites a rule on every missing value and every error', () => {
    const all = [
      issuesFor(FMI, 'position'), issuesFor(FMI, 'radius', { radius: { value: null, units: '' } }), issuesFor(FMI, 'area', { polygons: [[[24, 60], [25, 61], [24, 60]]] }),
      issuesFor(FMI, 'trajectory'), issuesFor(FMI_LEVELS, 'cube'), issuesFor(FMI_LEVELS, 'cube', { bbox: [24, 60, 25, 95] }),
      issuesFor(FMI_LEVELS, 'corridor'), issuesFor(FMI, 'corridor', { points: line, queryParams: { 'corridor-width': '10', 'width-units': 'km' } }),
      issuesFor(FMI_LEVELS, 'corridor', { points: line, queryParams: { 'corridor-width': '10', 'width-units': 'km', 'corridor-height': '1', 'height-units': 'hPa' } }),
      issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: 5, units: 'm' } }),
      issuesFor(FMI, 'position', { points: [HELSINKI], format: 'NetCDF', parameters: ['Bogus'], datetime: 'yesterday' }),
      issuesFor(FMI, 'position', { points: [HELSINKI], datetime: '2026-10-06T00:00:00Z/' }), issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical: '300/' }),
      issuesFor(METEOCORE, 'items', { format: 'GeoJSON', queryParams: { limit: '0' } }),
    ].flat();
    const strong = all.filter(issue => issue.severity === 'missing' || issue.severity === 'error');
    expect(new Set(strong.map(issue => issue.id)).size).toBeGreaterThan(15);
    expect(strong.filter(issue => !issue.rule).map(issue => issue.id)).toEqual(['edr:z:corridor-centre']);
  });

  it('cites nothing where no rule says so', () => {
    expect(ruleOf(issuesFor(FMI_LEVELS, 'corridor', { points: line, queryParams: { 'corridor-width': '10', 'width-units': 'km', 'corridor-height': '1', 'height-units': 'hPa' } }), 'edr:z:corridor-centre')).toBeUndefined();
    expect(ruleOf(issuesFor(FMI, 'radius', { points: [HELSINKI], radius: { value: 0, units: 'km' } }), 'edr:within:positive')).toBeUndefined();
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], datetime: '2026-10-08T00:00:00Z/2026-10-06T00:00:00Z' }), 'metadata:datetime:order')).toBeUndefined();
    expect(ruleOf(issuesFor(FMI_LEVELS, 'position', { points: [HELSINKI], vertical: 'high' }), 'metadata:z:number-0')).toBeUndefined();
    expect(ruleOf(issuesFor(FMI, 'position', { points: [HELSINKI], customDims: { member: '1/' } }), 'metadata:dim:member:range')).toBeUndefined();
  });
});

describe('typedIssues', () => {
  const LINE = 'https://a.example/collections/ifs/radius';
  const missing = (field: string): QueryIssue => ({ id: `edr:${field}:required`, severity: 'missing', source: 'edr', field, message: `Set ${field}` });
  const error = (field: string): QueryIssue => ({ id: `edr:${field}:bad`, severity: 'error', source: 'edr', field, message: `Bad ${field}` });

  it('drops what the line has from what’s missing: it was typed, though the form may not read it', () => {
    const issues = [missing('coords'), missing('within'), missing('within-units')];
    expect(typedIssues(issues, `${LINE}?coords=POINT(abc)&within=25`).map(issue => issue.field)).toEqual(['within-units']);
    expect(typedIssues(issues, `${LINE}?member=1`)).toBe(issues);
  });

  it('keeps errors and warnings on what the line has, and a value that\'s only blank is missing still', () => {
    expect(typedIssues([error('within')], `${LINE}?within=abc`)).toEqual([error('within')]);
    expect(typedIssues([missing('within')], `${LINE}?within=%20`)).toEqual([missing('within')]);
  });

  it('keeps what’s missing of a value the line has, a range’s other end', () => {
    const halfRange: QueryIssue = { id: 'metadata:z:range', severity: 'missing', source: 'metadata', field: 'z', message: 'Pick the upper end of the level range' };
    expect(typedIssues([halfRange], `${LINE}?z=850/`)).toEqual([halfRange]);
  });

  it('finds a custom dimension’s value under its own name', () => {
    expect(typedIssues([missing('dim:member')], `${LINE}?member=1`)).toEqual([]);
  });
});
