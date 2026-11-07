import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme } from '@mui/material/styles';
import { coverageToProfile, type CoverageProfile, type ProfileContext } from './coverageProfile';
import { words } from './cellsTestData';
import { LevelPill, PanelCrosshair, ProfilePanel, ProfileZAxis, type PlotFrame } from './ProfilePanel';
import { linesOf, panelsOf, plotColours, timeCaption } from './profilePlot';
import ProfileView from './ProfileView';
import { StepBar, type StepKind } from './StepBars';
import { levelPosition, pickLevelLabels, type LevelSpacing } from './verticalAxis';
import extents from './__fixtures__/profiles/vertical-extents.json';
import mcIfs1tAll from './__fixtures__/profiles/mc-ifs-1t-all.json';
import mcGfs1tAll from './__fixtures__/profiles/mc-gfs-1t-all.json';
import mcIfsAsked777 from './__fixtures__/profiles/mc-ifs-asked777.json';
import mcIfsZunsorted from './__fixtures__/profiles/mc-ifs-zunsorted.json';
import mcIfs85t from './__fixtures__/profiles/mc-ifs-85t-2p.json';
import mcIfsCube1pix from './__fixtures__/profiles/mc-ifs-cube-1pix.json';
import mcRadarDkrom from './__fixtures__/profiles/mc-radar-dkrom-allnull.json';
import mcRadarNldhl from './__fixtures__/profiles/mc-radar-nldhl-point2.json';
import fmiEcmwf1tAll from './__fixtures__/profiles/fmi-ecmwf-1t-all.json';
import fmiHybrid1tAll from './__fixtures__/profiles/fmi-hybrid-1t-all.json';
import knmiPl from './__fixtures__/profiles/knmi-pl-position.json';

// The view's size, as if measured: the server can't measure anything
const size = vi.hoisted(() => ({ width: 900, height: 600 }));
vi.mock('../hooks/useElementSize', () => ({ useElementSize: () => [() => {}, size] }));
beforeEach(() => {
  size.width = 900;
  size.height = 600;
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const urlOf = (json: Json) => /^GET (\S+),/.exec(json._comment)?.[1];
function profileOf(json: unknown, vertical?: ProfileContext['vertical'], url = urlOf(json as Json) ?? 'x'): CoverageProfile {
  const result = coverageToProfile(JSON.parse(JSON.stringify(json)), { url, vertical });
  if (!result.profile) throw new Error(`no profile: ${result.message}`);
  return result.profile;
}
const MC = extents['ecmwf-ifs-pressure'];
const DK = extents['dk-radar-volume-dkrom'];
const theme = createTheme();
const colours = plotColours(theme);

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const view = (profile: CoverageProfile) => renderToStaticMarkup(<ProfileView profile={profile} />);
// The buttons that say whether they're on, as "Log* Linear Even Flip"
const tools = (html: string) => [...html.matchAll(/<button[^>]*?aria-pressed="(true|false)"[^>]*>([^<]*)/g)]
  .map(([whole, pressed, label]) => `${label}${pressed === 'true' ? '*' : ''}${/\sdisabled=""/.test(whole) ? '(off)' : ''}`).join(' ');

// A frame as the view makes one, at a given height
function frameOf(profile: CoverageProfile, { height = 400, spacing = profile.scale as LevelSpacing } = {}): PlotFrame {
  const at = levelPosition(profile.rows, { spacing, direction: profile.axis.direction });
  const yOf = (level: number) => 9 + at(level) * (height - 29);
  return { height, yOf, labelled: pickLevelLabels(profile.rows, yOf, { must: profile.missing }) };
}
const panelOf = (profile: CoverageProfile, ids: string[], join = false) => panelsOf(profile.parameters, new Set(profile.parameters.map(p => p.id).filter(id => !ids.includes(id))), join)[0];
const LINES = ['#111111', '#222222'];
function panelOn(profile: CoverageProfile, ids: string[], { time = 0, allTimes = false, join = false, row = null as number | null } = {}) {
  const panel = panelOf(profile, ids, join);
  const props = { profile, panel, lines: linesOf(panel, profile.locations.length, LINES), width: 200, frame: frameOf(profile), time };
  return {
    drawing: renderToStaticMarkup(<ProfilePanel {...props} allTimes={allTimes} />),
    crosshair: renderToStaticMarkup(<PanelCrosshair {...props} row={row} />),
  };
}

describe('ProfilePanel', () => {
  it('draws a dot at each level and a line through them (MeteoCore t)', () => {
    const { drawing } = panelOn(profileOf(mcIfs1tAll, MC), ['t']);
    expect(count(drawing, /<circle/g)).toBe(14);
    expect(drawing.match(/<path d="([^"]*)"/)![1].match(/[ML]/g)).toEqual(['M', ...Array(13).fill('L')]);
    expect(drawing).toContain('aria-label="t"');
  });

  it('draws grid lines at the levels labelled, but where one is missing, its dashed line', () => {
    const profile = profileOf(mcIfsAsked777, MC);
    const frame = frameOf(profile);
    expect(frame.labelled.has(777)).toBe(true);
    expect(panelOn(profile, ['t']).drawing.split(`stroke="${colours.grid}"`).length - 1).toBe(frame.labelled.size - 1);
  });

  it('draws a zero line where the values cross zero, and none where they don’t', () => {
    expect(panelOn(profileOf(mcIfs1tAll, MC), ['t']).drawing).toContain('>0</text>');
    expect(panelOn(profileOf(mcIfs1tAll, MC), ['gh']).drawing).not.toContain('>0</text>');
  });

  it('breaks the line at a null, and marks each in the lane at the left (MeteoCore GFS TCDC)', () => {
    const { drawing } = panelOn(profileOf(mcGfs1tAll, MC), ['TCDC']);
    expect(count(drawing, /<circle/g)).toBe(22);
    const nulls = drawing.match(/data-nulls="" d="([^"]*)"/)![1];
    expect(count(nulls, /M3 /g)).toBe(11);
    expect(panelOn(profileOf(mcGfs1tAll, MC), ['RH']).drawing).not.toContain('data-nulls');
  });

  it('draws a dashed line where a level asked for is missing, and breaks the line there', () => {
    const profile = profileOf(mcIfsAsked777, MC);
    const { drawing } = panelOn(profile, ['t']);
    expect(drawing).toMatch(/data-missing="777"[^>]*stroke-dasharray="3 4"/);
    // A dot for each level sent, and none where nothing was
    expect(count(drawing, /<circle/g)).toBe(3);
    // 500, then 850 and 1000
    expect(drawing.match(/<path d="([^"]*)"/)![1].match(/[ML]/g)).toEqual(['M', 'M', 'L']);
  });

  it('draws the other times behind it, with All times (MeteoCore, 85 times)', () => {
    const profile = profileOf(mcIfs85t, MC);
    const behind = panelOn(profile, ['t'], { allTimes: true }).drawing.match(/data-strip="" d="([^"]*)"/)![1];
    expect(count(behind, /h0/g)).toBe(84 * 14);
    expect(panelOn(profile, ['t']).drawing).not.toContain('data-strip');
  });

  it('draws a line per point, in its colour', () => {
    const { drawing } = panelOn(profileOf(mcIfsCube1pix, MC), ['t']);
    expect(drawing).toContain('stroke="#111111"');
    expect(drawing).toContain('stroke="#222222"');
    expect(count(drawing, /<circle/g)).toBe(6);
  });

  it('says why there’s nothing to draw', () => {
    expect(words(panelOn(profileOf(mcRadarDkrom, DK), ['DBZH']).drawing)).toBe('All null');
    const radar = profileOf(mcRadarNldhl);
    const empty = radar.times.findIndex((_, time) => !radar.parameters[0].values[0][time].some(value => typeof value === 'number'));
    expect(words(panelOn(radar, ['DBZH'], { time: empty }).drawing)).toBe('All null at this time');
    expect(words(panelOn(radar, ['DBZH'], { time: 1 - empty }).drawing)).toBe('');
  });
});

describe('PanelCrosshair', () => {
  const profile = profileOf(mcIfs1tAll, MC);
  const row = profile.rows.indexOf(500);

  it('reads the value at the level pointed at, with a ring on its dot', () => {
    const { crosshair } = panelOn(profile, ['t'], { row });
    expect(words(crosshair)).toBe(`${Number((profile.parameters[2].values[0][0][row] as number).toPrecision(6))} °C`);
    expect(crosshair).toMatch(/<circle[^>]*r="5"/);
  });

  it('keys each line’s value where a panel has several', () => {
    const gfs = profileOf(mcGfs1tAll, MC);
    const { crosshair } = panelOn(gfs, ['RH', 'TCDC'], { join: true, row: gfs.rows.indexOf(500) });
    expect(count(crosshair, /<rect/g)).toBe(2);
    expect(words(crosshair)).toMatch(/^[\d.]+ % [\d.]+ %$/);
  });

  it('says null, with no ring, and nothing at all with no level', () => {
    const gfs = profileOf(mcGfs1tAll, MC);
    const nullRow = gfs.parameters[1].values[0][0].indexOf(null);
    const { crosshair } = panelOn(gfs, ['TCDC'], { row: nullRow });
    expect(words(crosshair)).toBe('null');
    expect(crosshair).not.toContain('<circle');
    expect(panelOn(gfs, ['TCDC']).crosshair).toBe('');
  });
});

describe('ProfileZAxis', () => {
  const axis = (profile: CoverageProfile, time = 0) => renderToStaticMarkup(<ProfileZAxis profile={profile} width={48} frame={frameOf(profile)} time={time} />);

  it('has a tick at every level and a label at those chosen', () => {
    const profile = profileOf(mcIfs1tAll, MC);
    const html = axis(profile);
    expect(count(html, /data-level=/g)).toBe(14);
    expect(count(html, /<text/g)).toBe(frameOf(profile).labelled.size);
    expect(html).toContain('>1000</text>');
    expect(html).toContain('>10</text>');
  });

  it('marks a missing level long and orange, and labels it', () => {
    const html = axis(profileOf(mcIfsAsked777, MC));
    const missing = html.match(/<g data-level="777">.*?<\/g>/)![0];
    expect(missing).toContain(`x1="41"`);
    expect(missing).toContain(`stroke="${colours.warnLine}"`);
    expect(missing).toMatch(new RegExp(`fill="${colours.warnText}"[^>]*>777</text>`));
  });

  it('marks short the levels only other times have (DK radar)', () => {
    const profile = profileOf(mcRadarDkrom, DK);
    const short = (time: number) => [...axis(profile, time).matchAll(/<g data-level="([\d.]+)"><line x1="46"/g)].map(([, level]) => level);
    expect(short(0)).toEqual(['4.8', '8.4']);
    expect(short(1)).toEqual(['4.5', '8.5']);
    expect(count(axis(profile, 0), /x1="44"/g)).toBe(10);
  });
});

describe('LevelPill', () => {
  it('shows the level pointed at over the axis, and nothing with none', () => {
    const profile = profileOf(mcIfs1tAll, MC);
    expect(words(renderToStaticMarkup(<LevelPill level={500} width={48} frame={frameOf(profile)} />))).toBe('500');
    expect(renderToStaticMarkup(<LevelPill level={null} width={48} frame={frameOf(profile)} />)).toBe('');
  });
});

describe('StepBar', () => {
  const bar = (kinds: StepKind[], step: number) => renderToStaticMarkup(
    <StepBar name="t" count={kinds.length} step={step} kinds={kinds} label="Nov 7 15:00" caption="Nov 7 15:00 (2/3)" room={20} onStep={() => {}} />,
  );
  const styles = (html: string) => html.match(/<style[^>]*>.*?<\/style>/g)?.join('') ?? '';

  it('says where it is, as it was given', () => {
    const html = bar(['', '', ''], 1);
    expect(words(html)).toContain('Nov 7 15:00 (2/3)');
    expect(html).toContain('aria-valuetext="Nov 7 15:00"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-label="Previous t"');
    expect(styles(html)).toContain('min-width:20ch');
  });

  it('hatches a step with nulls grey, and one with no numbers orange', () => {
    expect(styles(bar(['', 'some', ''], 0))).toContain(`repeating-linear-gradient(135deg, ${theme.palette.text.disabled} 0 2px`);
    expect(styles(bar(['', 'none', ''], 0))).toContain(`repeating-linear-gradient(135deg, ${theme.palette.warning.main} 0 2px`);
    expect(styles(bar(['', '', ''], 0))).not.toContain('repeating-linear-gradient');
  });

  it('doesn’t hatch the step it’s on', () => {
    expect(styles(bar(['none', '', ''], 0))).not.toContain('repeating-linear-gradient');
  });
});

describe('ProfileView', () => {
  describe('the axis and its tools', () => {
    it('says what z is, what’s at the top and where that came from (MeteoCore)', () => {
      const html = view(profileOf(mcIfs1tAll, MC));
      expect(words(html)).toContain('Pressure, hPa . 10 at the top (response)');
      expect(tools(html)).toBe('Log* Linear Even Flip');
    });

    it('says when the direction is assumed (FMI), and when z has nothing to go on (KNMI)', () => {
      expect(words(view(profileOf(fmiEcmwf1tAll)))).toContain('Pressure, hPa . 50 at the top (assumed)');
      expect(words(view(profileOf(knmiPl)))).toContain('z (no name or unit in the response) . 925 at the top (assumed)');
    });

    it('opens model levels linear, with no Even for levels already even (FMI hybrid)', () => {
      const html = view(profileOf(fmiHybrid1tAll));
      expect(tools(html)).toBe('Log Linear* Flip');
      expect(words(html)).toContain('Model level . 1 at the top (assumed)');
    });

    it('offers no log for a level at zero', () => {
      const json = { type: 'Coverage', domain: { axes: { x: { values: [1] }, y: { values: [2] }, z: { values: [0, 10, 25] } } }, ranges: { a: { axisNames: ['z'], shape: [3], values: [1, 2, 3] } } };
      expect(tools(view(profileOf(json)))).toBe('Log(off) Linear* Even Flip');
    });

    it('offers Same unit where parameters share one (MeteoCore GFS)', () => {
      expect(tools(view(profileOf(mcGfs1tAll, MC)))).toContain('Flip Same unit');
      expect(tools(view(profileOf(mcIfs1tAll, MC)))).not.toContain('Same unit');
    });

    it('offers All times, on, at one point with several times and numbers', () => {
      expect(tools(view(profileOf(mcIfs85t, MC)))).toContain('All times*');
      expect(tools(view(profileOf(mcIfs1tAll, MC)))).not.toContain('All times');
      expect(tools(view(profileOf(mcIfsCube1pix, MC)))).not.toContain('All times');
      expect(tools(view(profileOf(mcRadarDkrom, DK)))).not.toContain('All times');
      // Several points at several times: each panel has a line per point already
      const t = ['2026-11-07T00:00:00Z', '2026-11-07T06:00:00Z'];
      const at = (x: number) => ({
        type: 'Coverage',
        domain: { axes: { x: { values: [x] }, y: { values: [60] }, z: { values: [1000, 850, 500] }, t: { values: t } } },
        ranges: { a: { type: 'NdArray', axisNames: ['t', 'z'], shape: [2, 3], values: [1, 2, 3, 4, 5, 6] } },
      });
      const two = profileOf({ type: 'CoverageCollection', coverages: [at(24), at(25)] });
      expect(two.locations).toHaveLength(2);
      expect(view(two)).toContain('role="slider"');
      expect(tools(view(two))).not.toContain('All times');
    });
  });

  describe('times', () => {
    it('has the step bar for several, at the first, as wide as its longest caption', () => {
      const profile = profileOf(mcIfs85t, MC);
      const html = view(profile);
      expect(html).toContain('role="slider"');
      expect(html).toContain('aria-valuemax="84"');
      expect(words(html)).toMatch(/\(1\/85\)/);
      const longest = Math.max(...profile.times.map((_, at) => timeCaption(profile.times, at).length));
      expect(html).toContain(`min-width:${longest}ch`);
    });

    it('opens at the first time with numbers (NL radar)', () => {
      const radar = profileOf(mcRadarNldhl);
      const first = radar.times.findIndex((_, time) => radar.parameters[0].values[0][time].some(value => typeof value === 'number'));
      expect(view(radar)).toContain(`aria-valuenow="${first}"`);
    });

    it('has none for one time', () => {
      expect(view(profileOf(mcIfs1tAll, MC))).not.toContain('role="slider"');
    });
  });

  describe('panels', () => {
    it('heads each with its id, its label and its unit (MeteoCore)', () => {
      const shown = words(view(profileOf(mcIfs1tAll, MC)));
      expect(shown).toContain('gh Geopotential height gpm');
      expect(shown).toContain('t Temperature °C');
    });

    it('says when there’s no unit (FMI), and how many are null (GFS), or all (DK radar)', () => {
      expect(words(view(profileOf(fmiEcmwf1tAll)))).toContain('windspeedms no unit , 2 null');
      expect(words(view(profileOf(mcGfs1tAll, MC)))).toContain('TCDC Total cloud cover % , 11 null');
      expect(words(view(profileOf(mcRadarDkrom, DK)))).toContain('dBZ , all null');
    });

    it('has the ends of each scale below it', () => {
      // The zero line's 0 is between them
      expect(words(view(profileOf(mcIfs1tAll, MC)))).toContain('t Temperature °C 0 -65.4 5.3');
      expect(words(view(profileOf(mcIfs1tAll, MC)))).toContain('ws Wind speed m/s 4.92 45.3');
    });

    it('sizes the axis for its longest label, and the plot for the pane, below the heads', () => {
      const html = view(profileOf(mcIfs1tAll, MC));
      // 1000 in 4 characters, and room for the ticks
      expect(html).toContain('<svg width="41" height="531" role="img" aria-label="The levels"');
      // 600 less the heads, 2 lines of 15 and their room, and the ends below
      expect(count(html, /<svg width="214" height="531"/g)).toBe(4);
      // 10 hPa at the top, below the room for a dot; 1000 at the foot, above the room for the zero line's 0
      expect(html).toContain('cy="9"');
      expect(html).toContain(`cy="${531 - 20}"`);
      expect(html).not.toMatch(/cy="(?:[0-8](?:\.\d)?|5[2-9]\d)"/);
    });

    it('shares the width, down to the narrowest, with chips to choose from when they don’t fit', () => {
      const profile = profileOf(mcIfs1tAll, MC);
      const wide = view(profile);
      expect(wide).not.toContain('Parameters to show');
      expect(count(wide, /<svg width="214"/g)).toBe(4);
      // 4 at 108 beside the axis's 41 and 2 for borders
      size.width = 4 * 108 + 43;
      expect(view(profile)).not.toContain('Parameters to show');
      size.width -= 1;
      expect(view(profile)).toContain('Parameters to show');
      size.width = 390;
      const narrow = view(profile);
      expect(narrow).toContain('aria-label="Parameters to show"');
      expect(count(narrow, /<svg width="108"/g)).toBe(4);
      expect(count(narrow, /MuiChip-root[^>]*aria-pressed="true"/g)).toBe(4);
    });

    it('has a key for several points', () => {
      const profile = profileOf(mcIfsCube1pix, MC);
      const shown = words(view(profile));
      for (const { label } of profile.locations) expect(shown).toContain(label);
    });

    it('draws nothing where the pane has no room yet, and offers no chips before it’s measured', () => {
      size.height = 0;
      const html = view(profileOf(mcIfs1tAll, MC));
      expect(html).not.toContain('<circle');
      expect(words(html)).toContain('gh Geopotential height');
      size.width = 0;
      expect(view(profileOf(mcIfs1tAll, MC))).not.toContain('Parameters to show');
    });
  });

  describe('levels missing', () => {
    it('says which, and that they were asked for', () => {
      expect(words(view(profileOf(mcIfsAsked777, MC)))).toContain("777 isn't in the response, though asked for.");
    });

    it("says which, in order, and that they're in the collection's extent", () => {
      const html = view(profileOf(mcIfsZunsorted, { values: ['1000', '925', '850', '700', '500'] }, 'x?f=CoverageJSON'));
      expect(words(html)).toContain("700, 925 aren't in the response, though in the collection's extent.");
    });

    it('says nothing when none are', () => {
      expect(words(view(profileOf(mcIfs1tAll, MC)))).not.toContain('in the response, though');
    });
  });

  it('says how to read a level until one is pointed at', () => {
    const html = view(profileOf(mcIfs1tAll, MC));
    expect(words(html)).toContain('Point at a level to read it, click to keep it.');
    expect(html).not.toContain('Find in Raw');
    expect(html).not.toContain('Let go of this level');
  });
});
