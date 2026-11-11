import { describe, expect, it } from 'vitest';
import type { Collection, Temporal, Vertical } from '../types/api';
import { collectionOffers, crsOffered, dimensionTitle, fieldSpecs, heldNames, lacksTimeAndLevels, levelsSaid, levelUnit, timesSaid, type FieldSpec } from './fieldSpecs';
import { withItemsQuery } from './itemsQuery';
import { EDR, FEATURES1, RECORDS1 } from '../standards';
import fmiEcmwf from './__fixtures__/fmi-ecmwf.json';
import fmiPainepinta from './__fixtures__/fmi-ecmwf-painepinta.json';
import dwdIcon from './__fixtures__/dwd-icon-d2-ruc-single-level.json';
import meteocoreObs from './__fixtures__/meteocore-fmi-obs.json';

const FMI = fmiEcmwf as unknown as Collection;
const FMI_LEVELS = fmiPainepinta as unknown as Collection;
const DWD = dwdIcon as unknown as Collection;
const METEOCORE = meteocoreObs as unknown as Collection;

const specs = (collection: Collection, queryKey: string, parameters = 0, context = {}) => fieldSpecs(collection, queryKey, { parameters }, context);
const ids = (fields: FieldSpec[]) => fields.map(field => field.id);
const one = (fields: FieldSpec[], id: string) => fields.find(field => field.id === id)!;

// A collection made for one case: its own extent and query variables
function made(extent: Record<string, unknown>, variables: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): Collection {
  return {
    id: 'made', links: [], crs: [], output_formats: ['CoverageJSON', 'GeoJSON'], extent,
    data_queries: { position: { link: { href: 'https://a.example/collections/made/position', variables: { query_type: 'position', ...variables } } } },
    ...rest,
  } as unknown as Collection;
}

describe('fieldSpecs', () => {
  it('lists a position query’s fields in order: geometry, parameters, time, levels, dimensions, format', () => {
    const fields = specs(FMI_LEVELS, 'position');
    expect(ids(fields)).toEqual(['coords', 'parameter-name', 'datetime', 'z', 'dim:timestep', 'f']);
    expect(fields.map(field => field.title)).toEqual(['Position', 'Parameters', 'Time', 'Levels', 'Timestep', 'Output format']);
    expect(fields.map(field => field.name)).toEqual(['coords', 'parameter-name', 'datetime', 'z', 'timestep', 'f']);
    expect(fields.map(field => field.requirement)).toEqual(['required', 'optional', 'optional', 'optional', 'optional', 'optional']);
    expect(one(fields, 'coords').hints).toEqual(['Each click on the map adds a point']);
  });

  it('titles the geometry by what the query draws', () => {
    const title = (collection: Collection, queryKey: string) => one(specs(collection, queryKey), 'coords').title;
    expect(title(FMI, 'radius')).toBe('Centre');
    expect(title(FMI, 'trajectory')).toBe('Path');
    expect(title(FMI, 'corridor')).toBe('Centre line');
    expect(title(FMI, 'area')).toBe('Area');
    expect(one(specs(FMI, 'trajectory'), 'coords').hints).toEqual(['Click points along the path on the map, and double-click to finish']);
  });

  it('puts a radius and its unit in one field, required as EDR requires both', () => {
    const fields = specs(FMI, 'radius');
    expect(ids(fields)).toEqual(['coords', 'within', 'parameter-name', 'datetime', 'dim:timestep', 'f']);
    const within = one(fields, 'within');
    expect(within).toMatchObject({ title: 'Radius', name: 'within', requirement: 'required' });
    expect(within.unit).toMatchObject({ title: 'Radius unit', name: 'within-units', id: 'within-units', requirement: 'required' });
    expect(within.hints).toEqual(['The map draws the circle once both are set', "Units from the query's `within_units`"]);
  });

  it('says where a query lists no units for a size, which is typed then', () => {
    const radius = made({}, { query_type: 'radius' }, {
      data_queries: { radius: { link: { href: 'https://a.example/collections/made/radius', variables: { query_type: 'radius' } } } },
    });
    expect(one(specs(radius, 'radius'), 'within').hints).toEqual(['The map draws the circle once both are set', 'The query lists no `within_units`: type a unit']);
  });

  it('gives a corridor its width, and its height only where the collection has levels to measure it from', () => {
    const flat = specs(FMI, 'corridor');
    expect(ids(flat)).toEqual(['coords', 'corridor-width', 'parameter-name', 'datetime', 'dim:timestep', 'f']);
    expect(one(flat, 'corridor-width')).toMatchObject({ title: 'Corridor width', requirement: 'required', hints: ["Units from the query's `width_units`"] });
    expect(one(flat, 'corridor-width').unit?.name).toBe('width-units');

    const levelled = specs(FMI_LEVELS, 'corridor');
    expect(ids(levelled)).toEqual(['coords', 'corridor-width', 'corridor-height', 'parameter-name', 'datetime', 'z', 'dim:timestep', 'f']);
    expect(one(levelled, 'corridor-height')).toMatchObject({
      title: 'Corridor height', requirement: 'required', hints: ['Measured from the level in `z`', "Units from the query's `height_units`"],
    });
    expect(one(levelled, 'corridor-height').unit?.name).toBe('height-units');
  });

  it('asks a cube for a box, and items for an optional box, a limit and a time filter, but no data selection', () => {
    expect(ids(specs(DWD, 'cube'))).toEqual(['bbox', 'parameter-name', 'datetime', 'f']);
    expect(one(specs(DWD, 'cube'), 'bbox')).toMatchObject({ title: 'Box', requirement: 'required', hints: ['Drag a box on the map, or type its edges'] });
    expect(one(specs(DWD, 'cube'), 'bbox').leftOut).toBeUndefined();

    const items = specs(METEOCORE, 'items');
    expect(ids(items)).toEqual(['bbox', 'limit', 'datetime', 'f']);
    expect(one(items, 'bbox')).toMatchObject({ requirement: 'optional', leftOut: 'items anywhere' });
    expect(one(items, 'limit')).toMatchObject({ title: 'Limit', leftOut: 'the server decides how many items (often 10)' });
    expect(one(items, 'datetime').leftOut).toBe('no time filter: all items are listed');
  });

  it('asks for one item only its format', () => {
    expect(ids(specs(METEOCORE, 'items', 0, { hasItem: true }))).toEqual(['f']);
    // Another query has no item
    expect(ids(specs(FMI, 'position', 0, { hasItem: true }))).toEqual(ids(specs(FMI, 'position')));
  });

  it('lists locations with no data selection and no format, until a location is picked', () => {
    const list = specs(FMI, 'locations');
    expect(ids(list)).toEqual(['datetime']);
    expect(one(list, 'datetime').leftOut).toBe('no time filter: all locations are listed');

    const picked = specs(FMI, 'locations', 0, { hasLocation: true });
    expect(ids(picked)).toEqual(['parameter-name', 'datetime', 'dim:timestep', 'f']);
    expect(one(picked, 'datetime').leftOut).toBe('the server decides which times');
  });

  it('counts the parameters chosen of those listed, and says the server sends them all when none are', () => {
    expect(one(specs(FMI, 'position'), 'parameter-name')).toMatchObject({ figure: '6 listed', leftOut: 'the server sends all 6' });
    expect(one(specs(FMI, 'position', 2), 'parameter-name').figure).toBe('2 of 6');
    expect(ids(specs(made({}), 'position'))).toEqual(['coords', 'f']);
  });

  it('marks a parameter the API docs require, though EDR’s own requirement stays EDR’s', () => {
    const fields = specs(FMI, 'position', 0, { apiRequired: ['coords', 'parameter-name', 'timestep'] });
    expect(one(fields, 'coords').requirement).toBe('required');
    expect(one(fields, 'parameter-name').requirement).toBe('required by the API docs');
    expect(one(fields, 'dim:timestep').requirement).toBe('required by the API docs');
    expect(one(fields, 'datetime').requirement).toBe('optional');
  });

  it('marks the format the query names as its default, else the collection’s, without choosing it', () => {
    const f = (collection: Collection, queryKey = 'position') => one(specs(collection, queryKey), 'f');
    expect(f(FMI)).toMatchObject({
      title: 'Output format', marked: 'CoverageJSON', hints: ["Marked default: the query's `default_output_format`"], leftOut: "the server's default",
    });
    expect(f(made({}, {}, { default_output_format: 'GeoJSON' }))).toMatchObject({ marked: 'GeoJSON', hints: ["Marked default: the collection's `default_output_format`"] });
    expect(f(made({}, { default_output_format: 'coveragejson' })).marked).toBe('CoverageJSON');
    expect(f(made({}, { default_output_format: 'NetCDF' }))).toMatchObject({
      marked: undefined, hints: ['The query names `NetCDF` as `default_output_format`, which isn\'t among its formats'],
    });
    expect(f(made({}))).toMatchObject({ marked: undefined, hints: [], leftOut: "the server's default" });
    expect(f(made({}, { default_output_format: '  ' }, { default_output_format: 7 })).marked).toBeUndefined();
  });

  it('gives the levels their unit and what the collection lists', () => {
    const z = one(specs(made({ vertical: { values: ['1000', '850'], vrs: 'pressure in hPa' } }), 'position'), 'z');
    expect(z).toMatchObject({ title: 'Levels', figure: 'hPa', hints: ['2 levels listed, 1000 to 850 hPa'], leftOut: 'the server decides which levels' });
    // No unit in the reference system: the query's height units, but not a corridor's, whose height is its own
    const heights = made({ vertical: { values: ['10', '20'] } }, { height_units: ['m'] });
    expect(one(specs(heights, 'position'), 'z').figure).toBe('m');
    expect(one(specs(FMI_LEVELS, 'position'), 'z')).toMatchObject({ figure: undefined, hints: [levelsSaid(FMI_LEVELS.extent!.vertical!, '')] });
    const corridor = made({ vertical: { values: ['10', '20'] } }, {}, {
      data_queries: { corridor: { link: { href: 'h', variables: { query_type: 'corridor', height_units: ['m'] } } } },
    });
    expect(one(specs(corridor, 'corridor'), 'z').figure).toBeUndefined();
  });

  it('makes one field of levels also declared as a custom dimension z, as both are sent as z', () => {
    const twin = made({ vertical: { values: ['1000', '850', '500'], vrs: 'hPa' }, custom: [{ id: 'z', values: ['1000', '850'] }, { id: 'member', values: ['1', '2'] }] });
    const fields = specs(twin, 'position');
    expect(ids(fields)).toEqual(['coords', 'z', 'dim:member', 'f']);
    expect(one(fields, 'z').hints).toEqual([
      expect.stringContaining('3 levels listed, 1000 to 500'),
      'Also declared as a custom dimension `z` in `extent.custom`, with 2 values. One field, since both are sent as `z`',
    ]);
    const single = made({ vertical: { values: ['1000'] }, custom: [{ id: 'z', values: ['1000'] }] });
    expect(one(specs(single, 'position'), 'z').hints[1]).toContain('with 1 value.');
    // Without levels, a custom z is a dimension like any other
    expect(ids(specs(made({ custom: [{ id: 'z', values: ['1'] }] }), 'position'))).toEqual(['coords', 'dim:z', 'f']);
  });

  it('describes a custom dimension: its count, and its reference as a link or as words', () => {
    const linked = made({ custom: [{ id: 'member', values: ['1', '2', '3'], reference: 'https://example.org/eps.pdf' }] });
    expect(one(specs(linked, 'position'), 'dim:member')).toMatchObject({
      title: 'Member', name: 'member', figure: '3 listed', hints: [], link: { label: 'reference', href: 'https://example.org/eps.pdf' }, leftOut: 'the server decides',
    });
    const worded = made({ custom: [{ id: 'step', interval: [['0', '10']], reference: 'minutes' }] });
    expect(one(specs(worded, 'position'), 'dim:step')).toMatchObject({ hints: ['In minutes'], link: undefined });
  });
});

describe('fieldSpecs, items of Features, Records and EDR', () => {
  // Each with no time in its extent: DMI's observation has no extent at all
  const link = (rest: Record<string, unknown> = {}) => ({
    id: 'observation', links: [{ href: 'https://opendataapi.dmi.dk/v2/metObs/collections/observation/items?f=json', rel: 'items', type: 'application/geo+json' }], ...rest,
  }) as unknown as Collection;
  const time = (collection: Collection) => one(specs(collection, 'items'), 'datetime');

  it('gives every items query a time, which a Features server SHALL take, though the extent gives none', () => {
    const dmi = withItemsQuery(link());
    expect(ids(specs(dmi, 'items'))).toEqual(['bbox', 'limit', 'datetime', 'f']);
    expect(time(dmi).hints).toEqual([{
      text: "Features servers SHALL support `datetime` on items. The collection's extent gives no time, so there's none to pick: type one",
      rule: FEATURES1.timeDefinition,
    }]);
    expect(time(dmi).leftOut).toBe('no time filter: all items are listed');
  });

  it('cites Records for a Records collection’s', () => {
    const gdc = withItemsQuery(link({ itemType: 'record' }));
    expect(time(gdc).hints).toEqual([{
      text: "Records servers SHALL support `datetime` on items. The collection's extent gives no time, so there's none to pick: type one",
      rule: RECORDS1.datetime,
    }]);
    expect(time(gdc).leftOut).toBe('no time filter: all records are listed');
  });

  it('cites EDR, and Features whose parameters EDR’s items take, for EDR’s own items query', () => {
    const edr = made({}, {}, { data_queries: { items: { link: { href: 'https://a.example/collections/made/items', variables: { query_type: 'items' } } } } });
    expect(time(edr).hints).toEqual([{
      text: "EDR's items query takes the parameters of Features, whose servers SHALL support `datetime`. The collection's extent gives no time, so there's none to pick: type one",
      rule: [EDR.itemsParameters, FEATURES1.timeDefinition],
    }]);
  });

  it('says the times there are where the extent gives them', () => {
    expect(time(METEOCORE).hints).toEqual([timesSaid(METEOCORE.extent!.temporal!)]);
    expect(time(withItemsQuery(link({ extent: { temporal: { interval: [['1850-01-01T00:00:00Z', null]] } } }))).hints).toEqual(['From Jan 1 1850 00:00 to open UTC']);
  });

  it('calls a Records collection’s items records', () => {
    const gdc = specs(withItemsQuery(link({ itemType: 'record' })), 'items');
    expect(one(gdc, 'bbox').leftOut).toBe('records anywhere');
    expect(one(gdc, 'limit').leftOut).toBe('the server decides how many records (often 10)');
    const msc = specs(withItemsQuery(link({ itemType: 'feature' })), 'items');
    expect(one(msc, 'bbox').leftOut).toBe('items anywhere');
  });

  it('has no time for one item', () => {
    expect(ids(specs(withItemsQuery(link()), 'items', 0, { hasItem: true }))).toEqual(['f']);
  });
});

describe('fieldSpecs, typed values', () => {
  it('says how each typed value is written', () => {
    const grammar = (collection: Collection, queryKey: string, id: string) => one(specs(collection, queryKey), id).grammar;
    expect(grammar(FMI, 'position', 'coords')).toBe('Typed: `POINT(lon lat)`, or `MULTIPOINT((lon lat),(lon lat))`');
    expect(grammar(FMI, 'radius', 'coords')).toBe('Typed: `POINT(lon lat)`, or `MULTIPOINT((lon lat),(lon lat))`');
    expect(grammar(FMI, 'trajectory', 'coords')).toBe('Typed: `LINESTRING(lon lat, lon lat, …)`');
    expect(grammar(FMI, 'corridor', 'coords')).toBe('Typed: `LINESTRING(lon lat, lon lat, …)`');
    expect(grammar(FMI, 'area', 'coords')).toBe('Typed: `POLYGON((lon lat, …, the first again))`, or `MULTIPOLYGON`');
    expect(grammar(DWD, 'cube', 'bbox')).toBe('Typed: `west,south,east,north`, in degrees');
    expect(grammar(METEOCORE, 'items', 'bbox')).toBe('Typed: `west,south,east,north`, in degrees');
    expect(grammar(METEOCORE, 'items', 'limit')).toBe('A whole number of at least 1');
    expect(grammar(FMI, 'radius', 'within')).toBe('A number');
    expect(grammar(FMI, 'corridor', 'corridor-width')).toBe('A number');
    expect(grammar(FMI, 'position', 'datetime')).toBe('One time, an interval `start/end`, or one open at an end, `start/..` or `../end`');
    expect(grammar(FMI_LEVELS, 'position', 'z')).toBe('One level, a list `1000,850`, an interval `1000/500`, or `R5/100/50` for 5 levels 50 apart from 100');
    expect(grammar(FMI, 'position', 'dim:timestep')).toBe('One value, a list `1,2,3`, or an interval `1/5`');
    expect(grammar(FMI, 'position', 'f')).toBeUndefined();
  });

  it('gives a datetime or z the request has a field, though the collection has no time or levels', () => {
    const bare = made({});
    expect(ids(specs(bare, 'position'))).toEqual(['coords', 'f']);
    const asked = specs(bare, 'position', 0, { inRequest: ['coords', 'datetime', 'z'] });
    expect(ids(asked)).toEqual(['coords', 'datetime', 'z', 'f']);
    expect(one(asked, 'datetime')).toMatchObject({ hints: ["The collection's extent has no time"], leftOut: 'the server decides which times' });
    expect(one(asked, 'z')).toMatchObject({ hints: ["The collection's extent has no levels"], leftOut: 'the server decides which levels' });
    // Not for a list, which takes no z, though it takes a time whatever the extent says
    const list = made({}, {}, { data_queries: { items: { link: { href: 'h', variables: { query_type: 'items' } } } } });
    expect(ids(specs(list, 'items', 0, { inRequest: ['z'] }))).toEqual(['bbox', 'limit', 'datetime', 'f']);
    // Nor a second one where the collection has them
    expect(ids(specs(FMI_LEVELS, 'position', 0, { inRequest: ['datetime', 'z'] })).filter(id => id === 'z' || id === 'datetime')).toEqual(['datetime', 'z']);
  });
});

describe('crsOffered', () => {
  it('lists the CRSs the query names in its crs_details', () => {
    expect(crsOffered(made({}, { crs_details: [{ crs: 'OGC:CRS84', wkt: 'GEOGCS…' }, { crs: 'EPSG:4326' }] }), 'position')).toEqual(['OGC:CRS84', 'EPSG:4326']);
    expect(crsOffered(made({}, { crs_details: [{ wkt: 'no name' }, { crs: '  ' }, { crs: 'CRS84' }] }), 'position')).toEqual(['CRS84']);
    expect(crsOffered(made({}, { crs_details: 'CRS84' }), 'position')).toEqual([]);
    expect(crsOffered(made({}), 'position')).toEqual([]);
  });
});

describe('heldNames', () => {
  it('holds the fields’ names and their units, a cube’s coords, and crs where the query lists any', () => {
    const radius = specs(FMI, 'radius');
    expect([...heldNames(radius, 'radius', [])].sort()).toEqual(['coords', 'datetime', 'f', 'parameter-name', 'timestep', 'within', 'within-units']);
    expect(heldNames(radius, 'radius', ['CRS84']).has('crs')).toBe(true);
    expect(heldNames(specs(DWD, 'cube'), 'cube', []).has('coords')).toBe(true);
    expect(heldNames(specs(FMI, 'position'), 'position', []).has('foo')).toBe(false);
  });
});

describe('lacksTimeAndLevels', () => {
  it('says so for a data query on a collection with neither, unless the request has one', () => {
    const bare = made({}, {}, { parameter_names: [{ id: 't' }] });
    expect(lacksTimeAndLevels(bare, specs(bare, 'position'))).toBe(true);
    expect(lacksTimeAndLevels(bare, specs(bare, 'position', 0, { inRequest: ['datetime'] }))).toBe(false);
    expect(lacksTimeAndLevels(FMI, specs(FMI, 'position'))).toBe(false);
    expect(lacksTimeAndLevels(made({ vertical: { values: ['1'] } }, {}, { parameter_names: [{ id: 't' }] }), specs(bare, 'position'))).toBe(false);
    // A list selects no data
    const list = made({}, {}, { parameter_names: [{ id: 't' }], data_queries: { items: { link: { href: 'h', variables: { query_type: 'items' } } } } });
    expect(lacksTimeAndLevels(list, specs(list, 'items'))).toBe(false);
  });
});

describe('dimensionTitle', () => {
  it('takes the label the metadata gives, else its title, else the id in words', () => {
    expect(dimensionTitle({ id: 'member', label: 'Ensemble member' })).toBe('Ensemble member');
    expect(dimensionTitle({ id: 'member', title: ' Member of the ensemble ' })).toBe('Member of the ensemble');
    expect(dimensionTitle({ id: 'ensemble_member' })).toBe('Ensemble member');
    expect(dimensionTitle({ id: 'time-step', label: '  ' })).toBe('Time step');
    expect(dimensionTitle({ id: 'x', label: { en: 'not words' } })).toBe('X');
    expect(dimensionTitle({ id: '__' })).toBe('__');
  });
});

describe('timesSaid', () => {
  it('says from when to when, in UTC, with the year where the two ends’ years differ', () => {
    expect(timesSaid({ interval: [['2026-10-05T03:00:00Z', '2026-10-15T00:00:00Z']] } as Temporal)).toBe('From Oct 5 03:00 to Oct 15 00:00 UTC');
    expect(timesSaid({ interval: [['2025-12-31T18:00:00Z', '2026-01-02T06:30:00Z']] } as Temporal)).toBe('From Dec 31 2025 18:00 to Jan 2 2026 06:30 UTC');
    // An end left open says nothing of the year, so the other end gives its own
    expect(timesSaid({ interval: [['2026-10-05T00:00:00Z', null]] } as Temporal)).toBe('From Oct 5 2026 00:00 to open UTC');
    expect(timesSaid({ interval: [['1850-01-01T00:00:00Z', null]] } as Temporal)).toBe('From Jan 1 1850 00:00 to open UTC');
    expect(timesSaid({ interval: [[null, '2026-10-15T00:00:00Z']] } as Temporal)).toBe('From open to Oct 15 2026 00:00 UTC');
  });

  it('counts the times a collection lists', () => {
    const listed = { values: ['2026-10-05T00:00:00Z', '2026-10-05T06:00:00Z', '2026-10-05T12:00:00Z'] } as Temporal;
    expect(timesSaid(listed)).toBe('3 times listed, Oct 5 00:00 to Oct 5 12:00 UTC');
    expect(timesSaid({} as Temporal)).toBeNull();
  });
});

describe('levelsSaid and levelUnit', () => {
  it('says how many levels are listed and from which to which, in the order listed', () => {
    expect(levelsSaid({ values: ['1000', '925', '850'] } as Vertical, 'hPa')).toBe('3 levels listed, 1000 to 850 hPa');
    expect(levelsSaid({ values: ['2'] } as Vertical, '')).toBe('1 level listed, 2 to 2');
    expect(levelsSaid({ interval: [['1000', '100']] } as Vertical, 'hPa')).toBe('From 1000 to 100 hPa');
    expect(levelsSaid({ interval: [[null, '100']] } as unknown as Vertical, '')).toBe('From open to 100');
    expect(levelsSaid({} as Vertical, 'hPa')).toBeNull();
  });

  it('takes the unit from the vertical reference system, else the query’s height units', () => {
    expect(levelUnit({ vrs: '' } as Vertical, ['m', 'ft'])).toBe('m, ft');
    expect(levelUnit({} as Vertical, [])).toBe('');
  });
});

describe('collectionOffers', () => {
  it('says what a collection has before a query is picked: parameters, times, levels and formats', () => {
    expect(collectionOffers(FMI_LEVELS)).toEqual([
      '6 parameters in `parameter_names`',
      timesSaid(FMI_LEVELS.extent!.temporal!),
      levelsSaid(FMI_LEVELS.extent!.vertical!, levelUnit(FMI_LEVELS.extent!.vertical!, [])),
      'Formats: `CoverageJSON`, `GeoJSON`',
    ]);
  });

  it('takes formats from the queries where the collection lists none, and leaves out what it hasn’t', () => {
    const bare = made({}, { output_formats: ['CoverageJSON', 'PNG'] }, { output_formats: null, parameter_names: [{ id: 't' }] });
    expect(collectionOffers(bare)).toEqual(['1 parameter in `parameter_names`', 'Formats: `CoverageJSON`, `PNG`']);
    expect(collectionOffers(made({}, {}, { output_formats: [] }))).toEqual([]);
  });
});
