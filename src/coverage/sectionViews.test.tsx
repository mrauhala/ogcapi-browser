import type { ReactElement, ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { INITIAL_CHOICES, ResponseCellsContext, createHoverStore, pictureOf, type CellHover, type CellsChoices } from '../contexts/responseCells';
import CoverageData from '../CoverageData';
import { canGoOnMap } from '../hooks/useResponseCellsLayer';
import ResponseCellsBar from '../ResponseCellsBar';
import CellReadout from './CellReadout';
import { sectionRowCells } from './cellSelection';
import CellsView from './CellsView';
import type { DrawableCells } from './coverageCells';
import { summarizeCoverage } from './coverageSummary';
import { readResponseCells } from './sectionCells';
import { PATH_URL, pathSection, words } from './cellsTestData';
import ValueLegend from './ValueLegend';
import fmiEc2param from './__fixtures__/sections/fmi-ec-2param.json';
import fmiEcFrames from './__fixtures__/sections/fmi-ec-frames.json';
import fmiMultilinestring from './__fixtures__/sections/fmi-multilinestring.json';
import mcIfsBadlevel from './__fixtures__/sections/mc-ifs-badlevel.json';
import mcIfsDatetimes from './__fixtures__/sections/mc-ifs-datetimes.json';
import mcIfsLsmZlist from './__fixtures__/sections/mc-ifs-lsm-zlist.json';
import mcIfsLsz from './__fixtures__/sections/mc-ifs-lsz.json';
import mcMepsClosed from './__fixtures__/sections/mc-meps-closed.json';
import mcSingleNoz from './__fixtures__/sections/mc-single-noz.json';
import mcRadarFikorZ from './__fixtures__/sections/mc-radar-fikor-z.json';

const panes = vi.hoisted(() => ({ isMobile: false, isOpen: { map: true } as Record<string, boolean>, showPane: () => {} }));
vi.mock('../contexts/OpenRequestContext', () => ({ useOpenRequest: () => ({ openRequest: () => {} }) }));
vi.mock('../contexts/PanesContext', () => ({ usePanes: () => panes }));
// The table draws only in a browser: here it says which columns it was given and how many rows it's told there are, and
// writes the page's rows as each column renders its cells
interface MockColumn { field: string; headerName?: string; renderCell?: (params: { value: unknown }) => ReactNode }
vi.mock('@mui/x-data-grid', () => ({
  DataGrid: ({ columns, rowCount, rows = [] }: { columns: MockColumn[]; rowCount?: number; rows?: Record<string, unknown>[] }) => (
    <div data-columns={columns.map(column => column.headerName).join('|')} data-rows={rowCount}>
      <table><tbody>
        {rows.map((row, i) => <tr key={i}>{columns.map(column => <td key={column.field}>{column.renderCell ? column.renderCell({ value: row[column.field] }) : String(row[column.field] ?? '')}</td>)}</tr>)}
      </tbody></table>
    </div>
  ),
}));
// The mocked table's rows, each as its cells' text, without the styles emotion writes in on the server
const tableRows = (html: string) => [...html.matchAll(/<tr>(.*?)<\/tr>/g)]
  .map(([, row]) => [...row.matchAll(/<td>(.*?)<\/td>/g)].map(([, cell]) => cell.replace(/<style[^>]*>.*?<\/style>/g, '').replace(/<[^>]+>/g, '')));

const urlOf = (json: unknown) => /^GET (\S+),/.exec((json as { _comment: string })._comment)?.[1] ?? '';
// FMI's 3 levels, with 333 hPa asked for too, which isn't sent
const BADLEVEL_URL = 'https://opendata.fmi.fi/edr/collections/ecmwf_painepinta/trajectory?coords=LINESTRING(24%2060,25%2061,26%2062)&z=1000,850,500,333&parameter-name=temperature,windspeedms&datetime=2026-11-07T00:00:00Z&f=CoverageJSON';

interface Situation {
  choices?: Partial<CellsChoices>;
  url?: string;
  hovered?: CellHover;
}

// As the pane has it: the summary and the picture read the same response for the same request
function alongPath(json: unknown, element: ReactElement, { choices, url = urlOf(json), hovered }: Situation = {}) {
  const reading = readResponseCells(json, { url });
  const merged = { ...INITIAL_CHOICES, ...choices };
  const hover = createHoverStore();
  if (hovered) hover.set(hovered);
  return renderToStaticMarkup(
    <ResponseCellsContext.Provider value={{
      reading, picture: pictureOf(reading, merged), choices: merged, choose: () => {}, lit: null, hover, url, openInRaw: () => {}, drawAnyway: () => {},
    }}>
      {element}
    </ResponseCellsContext.Provider>,
  );
}

const data = (json: unknown, view: 'cells' | 'chart' | 'table' | null = null, url = urlOf(json)) =>
  alongPath(json, <CoverageData summary={summarizeCoverage(json, { url })!} view={view} onViewChange={() => {}} />, { url });
const toggle = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)/g)].map(([, pressed, label]) => `${label}${pressed === 'true' ? '*' : ''}`).join(' ');

// Layout effects can't run on the server, and React says so each time
const realError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (!String(args[0]).includes('useLayoutEffect')) realError(...args);
  };
});
afterAll(() => {
  console.error = realError;
});

const SECTIONS: [string, unknown, string][] = [
  ['fmi-ec-2param', fmiEc2param, 'temperature, a section of 3 positions by 3 levels'],
  ['fmi-ec-frames', fmiEcFrames, 'temperature, a section of 5 positions by 9 levels'],
  ['fmi-multilinestring', fmiMultilinestring, 'temperature, a section of 4 positions by 2 levels'],
  ['mc-ifs-datetimes', mcIfsDatetimes, 't, a section of 9 positions by 2 levels'],
  ['mc-ifs-lsm-zlist', mcIfsLsmZlist, 't, a section of 9 positions by 2 levels'],
  ['mc-ifs-lsz', mcIfsLsz, 't, a track of 9 positions by 4 levels'],
  ['mc-radar-fikor-z', mcRadarFikorZ, 'DBZH, a section of 257 positions by 39 levels'],
];

describe('CoverageData, along a path', () => {
  for (const [name, json, said] of SECTIONS) {
    it(`opens ${name} as a Section, beside Figures and Table`, () => {
      const html = data(json);
      expect(toggle(html)).toMatch(/^Section\* Figures Table /);
      expect(html).toContain(`aria-label="${said}. Arrow keys move between cells, and the value shows below"`);
      expect(words(html)).not.toContain("Can't draw");
    });
  }

  it('leaves a line as it was: its figures and its table', () => {
    for (const json of [mcIfsBadlevel, mcMepsClosed, mcSingleNoz]) {
      const html = data(json);
      expect(toggle(html)).toBe('Figures* Table');
      expect(html).not.toContain('role="img"');
      expect(words(html)).not.toContain("Can't draw");
    }
  });

  it('lists a section in the cells’ Table, a row per position and level sent, with the path’s own columns', () => {
    expect(data(fmiEc2param, 'table')).toContain('data-columns="#|km|x|y|z (hPa)|temperature|windspeedms" data-rows="9"');
    expect(toggle(data(fmiEc2param, 'table'))).toBe('Section Figures Table*');
    expect(data(mcRadarFikorZ, 'table')).toContain('data-columns="#|km|x|y|z (m)|DBZH (dBZ)" data-rows="10023"');
  });

  it('has a row per step in the Table, with the step bar to go through the times', () => {
    const html = data(fmiEcFrames, 'table');
    expect(html).toContain('data-rows="45"');
    expect(words(html)).toContain('Nov 7 00:00 (1/3)');
  });

  it('gives each row its time where time runs along the path', () => {
    expect(data(mcIfsLsmZlist, 'table')).toContain('data-columns="Time|#|km|x|y|z (hPa)|t (°C)" data-rows="18"');
  });

  it('has no row for a level not sent, or for a track’s other levels', () => {
    expect(data(fmiEc2param, 'table', BADLEVEL_URL)).toContain('data-rows="9"');
    expect(data(mcIfsLsz, 'table')).toContain('data-rows="9"');
  });

  it('leaves a cell blank where a parameter sent nothing, and writes null where it sent null', () => {
    const json = JSON.parse(JSON.stringify(mcIfsDatetimes));
    // u only at the later two times, so at the first it has nothing anywhere; and t null at 850 hPa at the first position
    json.parameters.u = { type: 'Parameter' };
    json.coverages.forEach((coverage: { ranges: Record<string, unknown> }, c: number) => {
      if (c >= 2) coverage.ranges.u = { ...(coverage.ranges.t as object) };
    });
    json.coverages[0].ranges.t.values[0] = null;
    const html = data(json, 'table');
    expect(html).toContain('data-columns="#|km|x|y|z (hPa)|t (°C)|u" data-rows="18"');
    // The first position: 500 hPa, then 850
    expect(tableRows(html).slice(0, 2).map(row => [row[0], row[4], ...row.slice(-2)])).toEqual([['1', '500', '-23.145681', ''], ['1', '850', 'null', '']]);
  });

  it('keeps the path’s own table for a line, which has no picture', () => {
    const html = data(mcMepsClosed, 'table');
    expect(toggle(html)).toBe('Figures Table*');
    expect(html).not.toContain('data-rows');
  });

  it('lists the parameters with thumbnails in Figures', () => {
    const html = data(fmiEc2param, 'chart');
    expect(html).toContain('<canvas');
    expect(words(html)).toContain('temperature 9 values, 0 null');
  });

  it('counts a track’s values, not the cells nothing was sent for', () => {
    expect(words(data(mcIfsLsz, 'chart'))).toContain('t 9 values, 0 null');
  });
});

describe('CellsView, along a path', () => {
  it('offers nothing about the map, since the plane isn’t on it, and no north or south to flip', () => {
    for (const [, json] of SECTIONS) {
      const shown = words(alongPath(json, <CellsView />));
      for (const word of ['On the map', 'Show the map', "Can't go on the map", 'Try it', 'Flipped N–S', 'Flipped E–W', 'As sent']) expect(shown).not.toContain(word);
    }
  });

  it('says it can’t go on the map where x and y aren’t lon/lat', () => {
    const json = JSON.parse(JSON.stringify(fmiEc2param));
    json.referencing[0].system = { type: 'ProjectedCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/3067' };
    expect(words(alongPath(json, <CellsView />, { url: urlOf(fmiEc2param) }))).toContain("Can't go on the map");
  });

  it('steps through a path’s times', () => {
    const html = alongPath(fmiEcFrames, <CellsView />, { choices: { steps: { t: 1 } } });
    expect(words(html)).toContain('Nov 7 06:00 (2/3)');
    expect(words(html)).toContain('This time');
  });

  describe('its levels', () => {
    const levelButtons = (html: string) => [...html.matchAll(/<button([^>]*)>(Log|Linear|Even|Flip)</g)].map(([, attributes, label]) => `${label}${/aria-pressed="true"/.test(attributes) ? '*' : ''}${/\sdisabled=""/.test(attributes) ? ' (off)' : ''}`).join(' ');

    it('offers the profile’s Log, Linear and Even, and Flip, as pressure has them', () => {
      const html = alongPath(fmiEc2param, <CellsView />);
      expect(words(html)).toContain('Levels Log Linear Even Flip');
      expect(levelButtons(html)).toBe('Log* Linear Even Flip');
    });

    it('offers no log axis for a radar’s levels from 0, and no Even where they’re evenly spaced already', () => {
      const html = alongPath(mcRadarFikorZ, <CellsView />);
      expect(levelButtons(html)).toBe('Log (off) Linear* Flip');
      expect(html).toContain('title="A log axis needs every level above zero"');
    });

    it('shows what’s chosen, and Flip pressed', () => {
      expect(levelButtons(alongPath(fmiEc2param, <CellsView />, { choices: { levelSpacing: 'even', flip: 'ns' } }))).toBe('Log Linear Even* Flip*');
    });

    it('says what z is and which level is at the top, as the profile does', () => {
      expect(words(alongPath(mcRadarFikorZ, <CellsView />))).toContain('Height above antenna, m . 9306.12 at the top (response)');
      expect(words(alongPath(fmiEc2param, <CellsView />))).toContain('Pressure, hPa . 500 at the top (assumed)');
    });

    it('says the axis is turned over, and how the levels are spaced', () => {
      const shown = words(alongPath(fmiEc2param, <CellsView />, { choices: { flip: 'ns', levelSpacing: 'even' } }));
      expect(shown).toContain('1000 at the top (flipped here), each level the same height');
      // It's the axis that's turned over, not the response: nothing to warn about
      expect(shown).not.toContain('Drawn flipped');
    });

    it('says which level was asked for and isn’t in the response', () => {
      const shown = words(alongPath(fmiEc2param, <CellsView />, { url: BADLEVEL_URL }));
      expect(shown).toContain('333 at the top (assumed) 333 isn\'t in the response, though asked for.');
    });

    it('says a track is one level per position', () => {
      expect(words(alongPath(mcIfsLsz, <CellsView />))).toContain('One level per position: a track through the air, not a full section.');
      expect(words(alongPath(fmiEc2param, <CellsView />))).not.toContain('a track');
    });
  });

  describe('its figures', () => {
    it('counts what was sent where some cells have nothing in them', () => {
      expect(words(alongPath(mcIfsLsz, <CellsView />))).toContain('9 of 36 cells sent, 0 null');
      expect(words(alongPath(fmiEc2param, <CellsView />, { url: BADLEVEL_URL }))).toContain('9 of 12 cells sent, 0 null');
    });

    it('counts every cell where every one was sent', () => {
      expect(words(alongPath(mcRadarFikorZ, <CellsView />))).toContain('10,023 cells, 10,000 null');
    });
  });
});

describe('CellReadout, along a path', () => {
  // What's shown, from inside its live region
  const shownPart = (html: string) => html.slice(html.indexOf('>', html.indexOf('aria-live="polite"')) + 1);
  const keptRoom = (html: string) => html.slice(html.indexOf('aria-hidden="true"'), html.indexOf('aria-live="polite"'));
  const readout = (json: unknown, situation?: Situation) => alongPath(json, <CellReadout />, situation);

  it('says how far along the path, at which level, from which waypoint, and where the value is', () => {
    const shown = words(shownPart(readout(mcRadarFikorZ, { hovered: { cell: 5, under: 1 } })));
    expect(shown).toBe('null 2.5 km · 9306.12 m · A+2.5 km #6 at x 20.54477960918291, y 60.10233411649185 · lowest beam 750.306 m /ranges/DBZH/values/233');
    expect(words(shownPart(readout(fmiEc2param, { hovered: { cell: 4, under: 1 } })))).toBe('-0.964444 123.94 km · 850 hPa · at B #2 at x 25, y 61 /coverages/1/ranges/temperature/values/1');
  });

  it('says which line of a MULTILINESTRING', () => {
    expect(words(shownPart(readout(fmiMultilinestring, { hovered: { cell: 2, under: 1 } })))).toContain('123.94 km · 500 hPa · line 2, at C');
  });

  it('gives the position’s time where time runs along the path', () => {
    expect(words(shownPart(readout(mcIfsLsmZlist, { hovered: { cell: 5, under: 1 } })))).toContain('· Nov 7 06:00');
  });

  it('offers to copy the path and open it in Raw, and no position check, which is another request', () => {
    const pinned = words(shownPart(readout(fmiEc2param, { choices: { pin: 0 } })));
    expect(pinned).toBe('-23.1 Pinned 0 km · 500 hPa · at A #1 at x 24, y 60 /coverages/0/ranges/temperature/values/0 Unpin Copy path Open in Raw');
  });

  it('says what wasn’t sent: a track’s other levels, and a level asked for', () => {
    expect(words(shownPart(readout(mcIfsLsz, { choices: { pin: 0 } })))).toBe('Not in the response Pinned 0 km · 500 hPa · at A #1 at x 24, y 60 Unpin');
    expect(words(shownPart(readout(fmiEc2param, { url: BADLEVEL_URL, hovered: { cell: 1, under: 1 } })))).toContain('Not in the response: z=333 was asked for 123.94 km · 333 hPa · at B');
  });

  it('reads a cell turned over by Flip from where its value was sent', () => {
    // The top row drawn is 1000 hPa once flipped
    expect(words(shownPart(readout(fmiEc2param, { choices: { pin: 0, flip: 'ns' } })))).toContain('0 km · 1000 hPa · at A #1 at x 24, y 60 /coverages/2/ranges/temperature/values/0');
  });

  it('keeps the same room whatever it shows, without the position check', () => {
    const states: Situation[] = [{}, { hovered: { cell: 0, under: 1 } }, { hovered: { cell: 5, under: 9 } }, { choices: { pin: 4 } }];
    for (const json of [mcIfsLsz, mcRadarFikorZ]) expect(new Set(states.map(situation => keptRoom(readout(json, situation)))).size).toBe(1);
    const room = words(keptRoom(readout(mcRadarFikorZ)));
    expect(room).toContain('#257 at x 20.517911082093747, y 60.104190519723964 · lowest beam 790.305 m');
    expect(room).toContain('Unpin Copy path Open in Raw');
    expect(room).not.toContain('Check with position');
  });

  it('draws the path in small beside it, with the position pointed at', () => {
    const html = readout(fmiEc2param, { hovered: { cell: 4, under: 1 } });
    expect(html.match(/<polyline/g)).toHaveLength(1);
    expect(html).toContain('data-start=""');
    expect(html).toContain('data-at="1"');
    expect(readout(fmiEc2param)).not.toContain('data-at');
    // A line for each line of a MULTILINESTRING
    expect(readout(fmiMultilinestring).match(/<polyline/g)).toHaveLength(2);
  });

  it('draws no path where x and y aren’t lon/lat', () => {
    const json = JSON.parse(JSON.stringify(fmiEc2param));
    json.referencing[0].system = { type: 'ProjectedCRS', id: 'http://www.opengis.net/def/crs/EPSG/0/3067' };
    const html = readout(json, { url: urlOf(fmiEc2param), hovered: { cell: 4, under: 1 } });
    expect(html).not.toContain('<svg');
    expect(words(shownPart(html))).toContain('position 2 · 850 hPa x 25, y 61');
  });
});

describe('ValueLegend, along a path', () => {
  it('keys the lowest beam as it’s drawn', () => {
    expect(words(alongPath(mcRadarFikorZ, <ValueLegend />))).toContain('lowest beam, as meteocore:beamCoverage.floor gives it');
    expect(words(alongPath(fmiEc2param, <ValueLegend />))).not.toContain('lowest beam');
  });

  it('gives shares of what was sent, not of cells with nothing in them', () => {
    const json = JSON.parse(JSON.stringify(fmiEc2param));
    json.coverages[0].ranges.temperature.values[0] = null;
    // 1 of the 9 sent, where the plane has 12 cells
    expect(words(alongPath(json, <ValueLegend />, { url: BADLEVEL_URL }))).toContain('11% null 1');
  });
});

describe('ResponseCellsBar, along a path', () => {
  it('isn’t there, since nothing goes on the map, with the switch on', () => {
    for (const [, json] of SECTIONS) {
      // As the map's layer has it: shown where it can go on the map and is switched on
      const shows = canGoOnMap(readResponseCells(json, { url: urlOf(json) }) as DrawableCells) && INITIAL_CHOICES.onMap;
      expect(alongPath(json, <ResponseCellsBar shows={shows} outOfView={false} onGoToData={() => {}} />)).toBe('');
    }
  });
});

// The domain probes' paths, which origin/main left to Figures: what the Data tab offers, which it opens on, whether it
// goes on the map, and how many rows its Table has at a step
describe('the domain probes along a path', () => {
  const LEVELS = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500];
  const probes: [string, Parameters<typeof pathSection>[0], string, number | null][] = [
    ['sec-50x10', { n: 50, levels: LEVELS }, 'Section* Figures Table', 500],
    // Four copies of one time: the values sent again are a note, and the first is drawn
    ['sec-times', { n: 50, levels: LEVELS, copies: 4 }, 'Section* Figures Table', 500],
    ['tr-levels', { n: 9, timeAlong: true, coveragePerLevel: [850, 700, 500] }, 'Section* Figures Table', 27],
    ['tr-z-tuples', { n: 9, timeAlong: true, levelInTuples: true }, 'Section* Figures Table', 9],
    ['tr-3', { n: 3, timeAlong: true }, 'Figures* Table', null],
    ['tr-500', { n: 500, timeAlong: true }, 'Figures* Table', null],
  ];

  for (const [name, options, toggles, rows] of probes) {
    it(`shows ${name} as ${toggles.replace('*', '')}, opening on ${toggles.split(' ').find(label => label.endsWith('*'))!.slice(0, -1)}`, () => {
      const json = pathSection(options);
      expect(toggle(data(json, null, PATH_URL))).toMatch(new RegExp(`^${toggles.replace('*', '\\*')}`));
      const reading = readResponseCells(json, { url: PATH_URL });
      if (rows === null) {
        expect(reading).toMatchObject({ drawable: false, why: 'other-view' });
        return;
      }
      const cells = reading as DrawableCells;
      expect(canGoOnMap(cells)).toBe(false);
      expect(sectionRowCells(cells, 0)).toHaveLength(rows);
      expect(data(json, 'table', PATH_URL)).toContain(`data-rows="${rows}"`);
    });
  }
});

describe('the map, along a path', () => {
  it('keeps every section off it, whatever its CRS', () => {
    for (const [, json] of SECTIONS) expect(canGoOnMap(readResponseCells(json, { url: urlOf(json) }) as DrawableCells)).toBe(false);
  });

  it('keeps a section off it for what it is, even with its plane said to be lon/lat', () => {
    const cells = readResponseCells(fmiEc2param, { url: urlOf(fmiEc2param) }) as DrawableCells;
    const onLonLat = { ...cells, crs: { ...cells.crs, geographic: true } };
    expect(canGoOnMap(onLonLat)).toBe(false);
    // The same cells as a grid's would go: it's being a section that keeps them off
    expect(canGoOnMap({ ...onLonLat, source: 'grid' })).toBe(true);
  });
});
