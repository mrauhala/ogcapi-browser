import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Collection, Temporal } from '../types/api';
import type { ResolvedParam } from '../validation/openapi/operationIndex';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { apiDocsParams, type ApiDocsParam } from '../query/declared';
import { fieldSpecs, type FieldSpec } from '../query/fieldSpecs';
import { withLinkQueries } from '../query/mapQuery';
import { words } from '../coverage/cellsTestData';
import { ElevationValue, MapTimeValue, SubsetAxisValue, SubsetValue } from './MapDimensionFields';
import dims from '../query/__fixtures__/meteocore-maps-dimensions.json';

// What the controls read from around them: the request line, the API's conformance and its API docs. The time control
// is stood in for by what it's given
const around = vi.hoisted(() => ({ requestUrl: '', conformsTo: null as string[] | null, apiDocs: null as ApiDocsParam[] | null, temporal: null as unknown }));
vi.mock('../contexts/RequestUrlContext', () => ({ useRequestUrl: () => ({ requestUrl: around.requestUrl, editUrl: () => {} }) }));
vi.mock('../contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: around.conformsTo }) }));
vi.mock('../hooks/useQueryValidation', () => ({ useQueryValidation: () => ({ issues: [], active: true, apiOperation: around.apiDocs ? { params: around.apiDocs } : null }) }));
vi.mock('../TimeControl', () => ({
  default: ({ temporal }: { temporal: unknown }) => {
    around.temporal = temporal;
    return <i>time control</i>;
  },
}));

const DOCS = apiDocsParams(dims.apiParams.map(param => ({ ...param, enumValues: null, isArray: param.schema.type === 'array' })) as ResolvedParam[]);
const collectionOf = (id: string) => withLinkQueries(structuredClone(dims.collections.find(each => each.id === id)) as unknown as Collection);
const IFS = 'https://meteocore.app.meteo.fi/collections/ecmwf-ifs-pressure/map';
const RUNS = ['2026-11-12T00:00:00Z', '2026-11-11T18:00:00Z'];
const specOf = (id: string, collection = collectionOf('ecmwf-ifs-pressure')): FieldSpec =>
  fieldSpecs(collection, 'map', { parameters: 0 }, { conformsTo: dims.conformsTo, apiDocs: DOCS }).find(spec => spec.id === id)!;

let written: [string, string][] = [];
const stateWith = (datetime = ''): UseQueryUrlReturn => ({ datetime, setQueryParam: (name: string, value: string) => written.push([name, value]) }) as unknown as UseQueryUrlReturn;
const at = (query: string) => {
  around.requestUrl = `${IFS}${query ? `?${query}` : ''}`;
};

beforeEach(() => {
  written = [];
  around.conformsTo = dims.conformsTo;
  around.apiDocs = DOCS;
  around.temporal = null;
  at('');
});

// The elements a component gives, depth first: its controls' props, to call as a click would
type Props = Record<string, unknown>;
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (!React.isValidElement<Props>(node)) return Array.isArray(node) ? node.flatMap(elements) : [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}
const controls = (node: React.ReactNode, label: string) => elements(node).filter(element => element.props.label === label);
// Each button's markup, and the words it shows
const eachButton = (html: string) => html.split('<button').slice(1).map(button => `<button${button.slice(0, button.indexOf('</button>'))}</button>`);
const pressed = (html: string) => eachButton(html).filter(button => button.includes('aria-pressed="true"')).map(button => words(button).trim());
const buttons = (html: string) => eachButton(html).map(button => words(button).trim());

describe('a level', () => {
  const level = () => <SubsetAxisValue spec={specOf('subset:vertical')} queryState={stateWith()} />;

  it('is one of the levels listed, pressed as subset has it, however it’s written', () => {
    at('subset=Lon(1:2),vertical(850.0)');
    const html = renderToStaticMarkup(level());
    expect(buttons(html)).toEqual(['1000', '925', '850', '700', '600', '500', '400', '300', '250', '200', '150', '100', '50', '10']);
    expect(pressed(html)).toEqual(['850']);
  });

  it('writes vertical(…) into subset, beside the other axes, and takes it out', () => {
    at('subset=Lon(1:2),vertical(850)');
    const [toggles] = controls(SubsetAxisValue({ spec: specOf('subset:vertical'), queryState: stateWith() }), 'vertical');
    (toggles.props.onChange as (value: string) => void)('500');
    (toggles.props.onChange as (value: string) => void)('');
    expect(written).toEqual([['subset', 'Lon(1:2),vertical(500)'], ['subset', 'Lon(1:2)']]);
  });

  it('keeps a level the request has though it isn’t listed, shown and pressed', () => {
    at('subset=vertical(777)');
    const html = renderToStaticMarkup(level());
    expect(pressed(html)).toEqual(['777']);
    expect(buttons(html)).toHaveLength(15);
  });
});

describe('a model run', () => {
  it('is Latest or a run, newest first, and writes reference_time(*) or the run, quoted', () => {
    at('subset=vertical(850)');
    const html = renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith()} />);
    expect(buttons(html)).toEqual(['Latest', ...RUNS]);
    expect(pressed(html)).toEqual([]);
    const [toggles] = controls(SubsetAxisValue({ spec: specOf('subset:reference_time'), queryState: stateWith() }), 'reference_time');
    const pick = toggles.props.onChange as (value: string) => void;
    pick('*');
    pick(RUNS[1]);
    expect(written).toEqual([['subset', 'vertical(850),reference_time(*)'], ['subset', `vertical(850),reference_time("${RUNS[1]}")`]]);
    at(`subset=reference_time("${RUNS[0]}")`);
    expect(pressed(renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith()} />))).toEqual([RUNS[0]]);
    at('subset=reference_time(*)');
    expect(pressed(renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith()} />))).toEqual(['Latest']);
  });

  it('lists only the runs that can have the time asked, and says so, keeping the one the request has', () => {
    const html = renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith('2026-11-11T21:00:00Z')} />);
    expect(buttons(html)).toEqual(['Latest', RUNS[1]]);
    expect(words(html)).toContain('Only the runs at or before the time asked: 1 of 2');
    at(`subset=reference_time("${RUNS[0]}")`);
    const kept = renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith('2026-11-11T21:00:00Z')} />);
    expect(buttons(kept)).toEqual(['Latest', RUNS[1], RUNS[0]]);
    expect(pressed(kept)).toEqual([RUNS[0]]);
    expect(words(renderToStaticMarkup(<SubsetAxisValue spec={specOf('subset:reference_time')} queryState={stateWith('2026-11-12T06:00:00Z')} />))).not.toContain('Only the runs');
  });
});

describe('elevation', () => {
  it('is typed, with the levels to pick, which write elevation', () => {
    at('elevation=850.0');
    const element = ElevationValue({ spec: specOf('elevation'), queryState: stateWith(), text: <input aria-label="elevation" /> });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('aria-label="elevation"');
    expect(pressed(html)).toEqual(['850']);
    (controls(element, 'elevation levels')[0].props.onChange as (value: string) => void)('500');
    expect(written).toEqual([['elevation', '500']]);
    // No levels to pick on the radar
    const radar = renderToStaticMarkup(<ElevationValue spec={specOf('elevation', collectionOf('fmi-radar-composite-dbz'))} queryState={stateWith()} text={<input />} />);
    expect(radar).not.toContain('<button');
  });
});

describe('subset', () => {
  const subset = (collection = collectionOf('ecmwf-ifs-pressure')) => <SubsetValue collection={collection} queryState={stateWith()} text={<input aria-label="subset" />} />;

  it('offers the axes declared, but those with fields of their own, each adding itself over the extent', () => {
    at('subset=vertical(850)');
    const html = renderToStaticMarkup(subset());
    expect(buttons(html)).toEqual(['Lon', 'Lat', 'time']);
    expect(pressed(html)).toEqual([]);
    expect(words(html)).toContain("Each axis adds itself over the collection's whole extent, to narrow in the text");
    const [axes] = controls(SubsetValue({ collection: collectionOf('ecmwf-ifs-pressure'), queryState: stateWith(), text: null }), 'subset axes');
    (axes.props.onToggle as (axis: string) => void)('Lon');
    (axes.props.onToggle as (axis: string) => void)('time');
    expect(written).toEqual([['subset', 'vertical(850),Lon(-180:180)'], ['subset', 'vertical(850),time("2026-11-11T18:00:00Z":"2026-11-12T09:00:00Z")']]);
  });

  it('presses the axes the text has, and takes one out', () => {
    at('subset=Lat(59:70)&subset=vertical(850)');
    const element = SubsetValue({ collection: collectionOf('ecmwf-ifs-pressure'), queryState: stateWith(), text: null });
    expect(pressed(renderToStaticMarkup(element))).toEqual(['Lat']);
    (controls(element, 'subset axes')[0].props.onToggle as (axis: string) => void)('Lat');
    expect(written).toEqual([['subset', 'vertical(850)']]);
  });

  it('doesn’t offer a spatial axis with bbox, saying why, but keeps the one the text has', () => {
    at('subset=Lon(19:32)&bbox=19,59,32,70');
    const html = renderToStaticMarkup(subset());
    expect(buttons(html)).toEqual(['Lon', 'time']);
    expect(pressed(html)).toEqual(['Lon']);
    expect(words(html)).toContain('Lat not offered: the request has bbox , and Maps 1.0 asks a 4xx for a spatial axis with it');
    expect(html).toContain('/req/spatial-subsetting/subset-definition H');
    at('center=25,62&bbox=19,59,32,70');
    expect(words(renderToStaticMarkup(subset()))).toContain('Lon , Lat not offered: the request has bbox , center , and Maps 1.0 asks a 4xx for a spatial axis with either');
  });

  it('doesn’t offer time with datetime where the API docs say not both', () => {
    at('datetime=2026-11-12T00:00:00Z');
    const html = renderToStaticMarkup(subset());
    expect(buttons(html)).toEqual(['Lon', 'Lat']);
    expect(words(html)).toContain('time not offered: the request has datetime , and the API docs say "Not with subset=time(…) (400)."');
    around.apiDocs = null;
    expect(buttons(renderToStaticMarkup(subset()))).toEqual(['Lon', 'Lat', 'time']);
  });

  it('leaves E and N to type in a projected subset CRS whose box isn’t known, and offers another dimension’s values', () => {
    at('subset-crs=EPSG:3857');
    const html = renderToStaticMarkup(subset());
    expect(buttons(html)).toEqual(['time']);
    expect(words(html)).toContain('Also declared, to type: E , N');
    const member = { ...collectionOf('fmi-radar-composite-dbz'), extent: { ...collectionOf('fmi-radar-composite-dbz').extent, member: { values: [1, 2] } } } as unknown as Collection;
    at('subset=member(2)');
    const element = SubsetValue({ collection: member, queryState: stateWith(), text: null });
    const withMember = renderToStaticMarkup(element);
    expect(words(withMember)).toContain('member , one of its values:');
    expect(pressed(withMember)).toEqual(['2']);
    (controls(element, 'member values')[0].props.onChange as (value: string) => void)('');
    expect(written).toEqual([['subset', '']]);
  });
});

describe('a map’s time', () => {
  const time = (datetime = '') => renderToStaticMarkup(<MapTimeValue collection={collectionOf('ecmwf-ifs-pressure')} queryState={stateWith(datetime)} />);

  it('is the time control over the times listed', () => {
    expect(words(time())).toBe('time control');
    expect(around.temporal).toEqual(collectionOf('ecmwf-ifs-pressure').extent!.temporal);
  });

  it('lists only the times of the run asked, and says so', () => {
    at(`subset=reference_time("${RUNS[0]}")`);
    expect(words(time())).toBe('time control Only the times from the run asked on: 4 of 6');
    expect((around.temporal as Temporal).values).toEqual(['2026-11-12T00:00:00Z', '2026-11-12T03:00:00Z', '2026-11-12T06:00:00Z', '2026-11-12T09:00:00Z']);
    at('subset=reference_time(*)');
    expect(words(time())).toBe('time control');
  });

  it('has nothing to pick while subset has a time the API docs say doesn’t go with datetime', () => {
    at('subset=time("2026-11-12T00:00:00Z")');
    expect(words(time())).toBe('The request has a time in subset , and the API docs say "Not with subset=time(…) (400).": take it out there to pick one here');
    expect(around.temporal).toBeNull();
    // The time the request has stays, with its warning; and without the API docs' word, there's no clash
    expect(words(time('2026-11-12T00:00:00Z'))).toBe('time control');
    around.apiDocs = null;
    expect(words(time())).toBe('time control');
  });

  it('is nothing without a time in the extent', () => {
    const timeless = { ...collectionOf('fmi-radar-composite-dbz'), extent: {} } as Collection;
    expect(renderToStaticMarkup(<MapTimeValue collection={timeless} queryState={stateWith()} />)).toBe('');
  });
});
