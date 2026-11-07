import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import CloseIcon from '@mui/icons-material/Close';
import { useTheme } from '@mui/material/styles';
import { useResponseCells } from '../contexts/responseCells';
import { useElementSize } from '../hooks/useElementSize';
import type { CoverageProfile } from './coverageProfile';
import { lineColours } from './lineColours';
import {
  CHARACTER, MIN_PANEL, PLOT_FOOT, PLOT_TOP, canJoin, firstTimeWithNumbers, headLines, linesOf, nearestRow, panelsOf,
  readoutOf, rowAfter, shortValue, timeCaption, timeKinds, timeLabel, valueScale,
} from './profilePlot';
import { LevelPill, PanelCrosshair, ProfilePanel, ProfileZAxis, type PlotFrame } from './ProfilePanel';
import { StepBar } from './StepBars';
import { isEvenlySpaced, levelPosition, pickLevelLabels, type LevelSpacing } from './verticalAxis';

// Several levels at a point, or at a few, as profiles: a panel per parameter beside one vertical axis, which comes from
// the response, one time drawn with the others behind it, and a readout of the level pointed at, with its path in the
// response. The Table has the same values as sent

const ENDS_HEIGHT = 18;
// The plot and its head, at the least: a pane shorter than the rest and this scrolls
const SHORTEST_PLOT = 240;
const MONO = { fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: '17px' };
const TOOL = { height: 24, px: 1, py: 0, textTransform: 'none', fontSize: '0.75rem' } as const;

// A level pointed at or kept, and in which parameter's panel
interface Pick { row: number; parameter: string | null }

const DIRECTION_SOURCE = { response: 'response', usual: 'assumed', none: 'assumed' } as const;

function AxisWords({ profile, spacing, flipped, top }: { profile: CoverageProfile; spacing: LevelSpacing; flipped: boolean; top: number }) {
  const { axis } = profile;
  const nothing = axis.kind === 'unknown' && !axis.unit;
  const name = nothing ? 'z' : axis.unit ? `${axis.name}, ${axis.unit}` : axis.name;
  return (
    <Box sx={{ flex: '1 1 200px', minWidth: 0, fontSize: '0.75rem', lineHeight: '17px' }}>
      <Box component="span" sx={{ fontWeight: 500 }}>{name}</Box>
      {nothing && <Box component="span" sx={{ color: 'warning.main' }}> (no name or unit in the response)</Box>}
      <Box component="span" sx={{ color: axis.directionSource === 'none' && !flipped ? 'warning.main' : 'text.secondary' }}>
        {`. ${top} at the top (${flipped ? 'flipped here' : DIRECTION_SOURCE[axis.directionSource]})${spacing === 'even' ? ', each level the same height' : ''}`}
      </Box>
    </Box>
  );
}

export default function ProfileView({ profile }: { profile: CoverageProfile }) {
  const theme = useTheme();
  const { openInRaw } = useResponseCells();
  const [time, setTime] = useState(() => firstTimeWithNumbers(profile));
  const [spacing, setSpacing] = useState<LevelSpacing>(profile.scale);
  const [flipped, setFlipped] = useState(false);
  const [allTimes, setAllTimes] = useState(true);
  const [join, setJoin] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [hover, setHover] = useState<Pick | null>(null);
  const [pinned, setPinned] = useState<Pick | null>(null);
  const [setScroller, size] = useElementSize();
  const root = useRef<HTMLDivElement>(null);
  const zPlot = useRef<HTMLDivElement>(null);
  const [tooShort, setTooShort] = useState(false);

  const { rows, missing, locations, times, parameters } = profile;
  const joinable = canJoin(profile);
  const panels = useMemo(() => panelsOf(parameters, hidden, join && joinable), [parameters, hidden, join, joinable]);
  const several = locations.length > 1;
  const colours = useMemo(() => lineColours(several || (join && joinable) ? 2 : 1, theme), [several, join, joinable, theme]);
  const locationLabels = useMemo(() => locations.map(location => location.label), [locations]);
  const linesFor = useMemo(() => panels.map(panel => linesOf(panel, locations.length, colours)), [panels, locations.length, colours]);
  const kinds = useMemo(() => timeKinds(profile, hidden), [profile, hidden]);
  const captionRoom = useMemo(() => times.reduce((most, _, at) => Math.max(most, timeCaption(times, at).length), 0), [times]);
  const offersAllTimes = times.length > 1 && !several && parameters.some(parameter => parameter.numbers > 0);

  // Sizes: the axis as wide as its longest label, and the panels sharing what's left, down to their narrowest
  const zWidth = Math.max(40, Math.ceil(Math.max(...rows.map(level => String(level).length)) * CHARACTER) + 14);
  const room = size.width - zWidth - 2;
  const panelWidth = Math.max(MIN_PANEL, Math.floor(room / Math.max(1, panels.length)));
  const fits = Math.max(1, Math.floor(room / MIN_PANEL));
  const headHeight = 5 + headLines(panels, panelWidth) * 15 + 16;
  const plotHeight = Math.max(0, size.height - headHeight - ENDS_HEIGHT);
  const frame = useMemo((): PlotFrame | null => {
    if (plotHeight <= 0) return null;
    const at = levelPosition(rows, { spacing, direction: profile.axis.direction, flipped });
    const yOf = (level: number) => PLOT_TOP + at(level) * Math.max(1, plotHeight - PLOT_TOP - PLOT_FOOT);
    return { height: plotHeight, yOf, labelled: pickLevelLabels(rows, yOf, { must: missing }) };
  }, [plotHeight, rows, spacing, profile.axis.direction, flipped, missing]);
  const top = useMemo(() => {
    const at = levelPosition(rows, { spacing, direction: profile.axis.direction, flipped });
    return rows.reduce((best, level) => (at(level) < at(best) ? level : best), rows[0]);
  }, [rows, spacing, profile.axis.direction, flipped]);

  // A pane too short for it all scrolls as a whole, and then a drag up and down scrolls it
  useEffect(() => {
    const element = root.current;
    if (element) setTooShort(element.scrollHeight > element.clientHeight + 1);
  }, [size.height, panels.length, times.length]);

  const active = hover ?? pinned;
  const shownIds = panels.flatMap(panel => panel.parameters.map(parameter => parameter.id));
  const readoutParameter = (active?.parameter && shownIds.includes(active.parameter) ? active.parameter : null) ?? shownIds[0] ?? null;

  // The level nearest the pointer's height, anywhere across the panels
  const nearest = (clientY: number): number | null => {
    if (!frame || !zPlot.current) return null;
    const y = clientY - zPlot.current.getBoundingClientRect().top;
    return y < 0 || y > frame.height ? null : nearestRow(rows, frame.yOf, y);
  };
  const parameterAt = (event: PointerEvent) => {
    const column = (event.target as Element).closest?.('[data-panel]');
    const index = column ? Number(column.getAttribute('data-panel')) : -1;
    return panels[index]?.parameters[0].id ?? null;
  };
  const onPointerMove = (event: PointerEvent) => {
    const row = nearest(event.clientY);
    if (row === null) return;
    const parameter = parameterAt(event);
    if (row !== hover?.row || parameter !== hover?.parameter) setHover({ row, parameter });
  };
  const onPointerUp = (event: PointerEvent) => {
    const row = nearest(event.clientY);
    if (row === null) return;
    const same = pinned?.row === row && event.pointerType === 'mouse';
    setPinned(same ? null : { row, parameter: parameterAt(event) ?? pinned?.parameter ?? null });
    if (event.pointerType !== 'mouse') setHover(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!frame) return;
      event.preventDefault();
      setPinned({ row: rowAfter(rows, frame.yOf, active?.row ?? null, event.key === 'ArrowDown' ? 1 : -1), parameter: active?.parameter ?? null });
      setHover(null);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (times.length < 2) return;
      event.preventDefault();
      setTime(Math.max(0, Math.min(times.length - 1, time + (event.key === 'ArrowRight' ? 1 : -1))));
    } else if (event.key === 'Escape') {
      setPinned(null);
      setHover(null);
    }
  };

  const readout = active ? readoutOf(profile, active.row, readoutParameter, time) : null;
  // Raw is a tab away, so only for a level kept, and only where a value was sent
  const rawPath = readout?.path && pinned !== null && pinned.row === active?.row ? readout.path : null;

  const toggleHidden = (id: string) => setHidden(old => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Box ref={root} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <Box sx={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', px: 1.75, py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
        <AxisWords profile={profile} spacing={spacing} flipped={flipped} top={top} />
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={spacing}
            onChange={(_event, next: LevelSpacing | null) => { if (next) setSpacing(next); }}
            aria-label="Spacing of the levels"
            sx={{ '& .MuiToggleButton-root': TOOL }}
          >
            <ToggleButton value="log" disabled={!profile.canLog} title={profile.canLog ? 'A log axis' : 'A log axis needs every level above zero'}>Log</ToggleButton>
            <ToggleButton value="linear">Linear</ToggleButton>
            {!isEvenlySpaced(rows) && <ToggleButton value="even" title="Each level the same height: for reading level by level">Even</ToggleButton>}
          </ToggleButtonGroup>
          <ToggleButton size="small" value="flip" selected={flipped} onChange={() => setFlipped(!flipped)} title="Turn the axis over, to compare" sx={TOOL}>Flip</ToggleButton>
          {joinable && (
            <ToggleButton size="small" value="join" selected={join} onChange={() => setJoin(!join)} title="One plot for parameters with the same unit" sx={TOOL}>Same unit</ToggleButton>
          )}
          {offersAllTimes && (
            <ToggleButton size="small" value="all" selected={allTimes} onChange={() => setAllTimes(!allTimes)} title="The other times' values behind, as dots along each level" sx={TOOL}>All times</ToggleButton>
          )}
        </Box>
      </Box>
      {times.length > 1 && (
        <Box sx={{ flexShrink: 0, pb: 0.25 }}>
          <StepBar name="t" count={times.length} step={time} kinds={kinds} label={timeLabel(times, time)} caption={timeCaption(times, time)} room={captionRoom} onStep={setTime} />
        </Box>
      )}
      {several && (
        <Box sx={{ ...MONO, flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 12px', px: 1.75, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
          {locationLabels.map((label, i) => (
            <Box component="span" key={i} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 12, height: 2, backgroundColor: colours[i % colours.length] }} />
              {label}
            </Box>
          ))}
        </Box>
      )}
      {size.width > 0 && parameters.length > fits && (
        <Box role="group" aria-label="Parameters to show" sx={{ flexShrink: 0, display: 'flex', gap: 0.5, px: 1.75, py: 0.625, borderTop: '1px solid', borderColor: 'divider', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {parameters.map(parameter => (
            <Chip
              key={parameter.id}
              size="small"
              label={parameter.id}
              color={hidden.has(parameter.id) ? 'default' : 'primary'}
              variant={hidden.has(parameter.id) ? 'outlined' : 'filled'}
              aria-pressed={!hidden.has(parameter.id)}
              title={parameter.numbers === 0 ? 'All null' : undefined}
              onClick={() => toggleHidden(parameter.id)}
              sx={{ flexShrink: 0, fontFamily: 'monospace', fontStyle: parameter.numbers === 0 ? 'italic' : undefined }}
            />
          ))}
        </Box>
      )}
      {missing.length > 0 && (
        <Box sx={{ flexShrink: 0, px: 1.75, py: 0.5, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.75rem', lineHeight: '17px', color: theme.palette.mode === 'dark' ? 'warning.light' : 'warning.dark' }}>
          {`${[...missing].sort((a, b) => a - b).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} in the response, though ${profile.missingFrom === 'request' ? 'asked for' : "in the collection's extent"}.`}
        </Box>
      )}
      <Box ref={setScroller} sx={{ flex: `1 0 ${SHORTEST_PLOT}px`, minHeight: SHORTEST_PLOT, overflowX: 'auto', overflowY: 'hidden', borderTop: '1px solid', borderColor: 'divider', overscrollBehaviorX: 'contain' }}>
        <Box
          tabIndex={0}
          role="group"
          aria-label="Profile. Up and down read the levels, left and right change the time. The same values are in the Table."
          onPointerMove={onPointerMove}
          onPointerDown={(event: PointerEvent) => { const row = nearest(event.clientY); if (row !== null) setHover({ row, parameter: parameterAt(event) }); }}
          onPointerUp={onPointerUp}
          onPointerLeave={(event: PointerEvent) => { if (event.pointerType === 'mouse') setHover(null); }}
          onPointerCancel={() => setHover(null)}
          onKeyDown={onKeyDown}
          sx={{ display: 'flex', height: '100%', minWidth: 'max-content', touchAction: tooShort ? 'pan-x pan-y' : 'pan-x', outlineOffset: -2, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
        >
          <Box sx={{ position: 'sticky', left: 0, zIndex: 3, flexShrink: 0, width: zWidth, display: 'flex', flexDirection: 'column', backgroundColor: 'background.paper' }}>
            <Box sx={{ ...MONO, fontSize: 11, lineHeight: '14px', height: headHeight, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-end', pr: 0.5, pb: 0.375, color: 'text.secondary' }}>
              {profile.axis.unit || (profile.axis.kind === 'modelLevel' ? 'level' : 'z')}
            </Box>
            <Box ref={zPlot} sx={{ position: 'relative', height: plotHeight, flexShrink: 0 }}>
              {frame && <ProfileZAxis profile={profile} width={zWidth} frame={frame} time={time} />}
              {frame && <LevelPill level={active ? rows[active.row] : null} width={zWidth} frame={frame} />}
            </Box>
          </Box>
          {panels.map((panel, index) => {
            const lines = linesFor[index];
            const nulls = panel.parameters.reduce((sum, parameter) => sum + parameter.nulls, 0);
            const counted = panel.parameters.reduce((sum, parameter) => sum + parameter.count, 0);
            const scale = valueScale(panel.min, panel.max, panelWidth, panel.parameters.some(parameter => parameter.nulls > 0));
            return (
              <Box key={panel.parameters.map(parameter => parameter.id).join('|')} data-panel={index} sx={{ flexShrink: 0, width: panelWidth, display: 'flex', flexDirection: 'column', borderLeft: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ height: headHeight, flexShrink: 0, px: 0.75, pt: 0.625, overflow: 'hidden' }}>
                  {panel.parameters.length > 1
                    ? panel.parameters.map((parameter, i) => (
                      <Box key={parameter.id} title={parameter.label ?? undefined} sx={{ ...MONO, lineHeight: '15px', overflowWrap: 'anywhere' }}>
                        <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 12, height: 2, mr: 0.5, verticalAlign: 'middle', backgroundColor: lines[i].colour }} />
                        {parameter.id}
                      </Box>
                    ))
                    : (
                      <>
                        <Box sx={{ ...MONO, lineHeight: '15px', overflowWrap: 'anywhere' }}>{panel.parameters[0].id}</Box>
                        {panel.parameters[0].label && (
                          <Box title={panel.parameters[0].label} sx={{ fontSize: 11, lineHeight: '15px', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{panel.parameters[0].label}</Box>
                        )}
                      </>
                    )}
                  <Box sx={{ fontSize: 11, lineHeight: '15px', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {panel.unit || <Box component="em">no unit</Box>}
                    {nulls > 0 && <Box component="span" sx={{ color: 'primary.main' }}>{nulls === counted ? ', all null' : `, ${nulls.toLocaleString('en-US')} null`}</Box>}
                  </Box>
                </Box>
                <Box sx={{ position: 'relative', height: plotHeight, flexShrink: 0 }}>
                  {frame && <ProfilePanel profile={profile} panel={panel} lines={lines} width={panelWidth} frame={frame} time={time} allTimes={allTimes} />}
                  {frame && <PanelCrosshair profile={profile} panel={panel} lines={lines} width={panelWidth} frame={frame} time={time} row={active?.row ?? null} />}
                </Box>
                <Box sx={{ ...MONO, fontSize: 11, lineHeight: `${ENDS_HEIGHT}px`, height: ENDS_HEIGHT, flexShrink: 0, position: 'relative', color: 'text.secondary' }}>
                  {scale && (scale.single
                    ? <Box component="span" sx={{ position: 'absolute', left: scale.map(scale.min), transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{shortValue(scale.min)}</Box>
                    : (
                      <>
                        <Box component="span" sx={{ position: 'absolute', left: scale.left - 2, whiteSpace: 'nowrap' }}>{shortValue(scale.min)}</Box>
                        <Box component="span" sx={{ position: 'absolute', right: panelWidth - scale.right - 2, whiteSpace: 'nowrap' }}>{shortValue(scale.max)}</Box>
                      </>
                    ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box aria-live="polite" sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.75, height: 44, pl: 1.75, pr: 1, py: 0.375, borderTop: '1px solid', borderColor: 'divider', fontSize: '0.75rem', lineHeight: '17px' }}>
        <Box sx={{ flex: 1, minWidth: 0, '& > div': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}>
          {readout ? (
            <>
              <Box sx={{ fontFamily: 'monospace' }}>{readout.words}</Box>
              <Box sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary', minHeight: 17 }} title={readout.path}>{readout.path}</Box>
            </>
          ) : (
            <Box sx={{ color: 'text.secondary' }}>
              <Box component="span" sx={{ '@media (pointer: coarse)': { display: 'none' } }}>Point at a level to read it, click to keep it.</Box>
              <Box component="span" sx={{ display: 'none', '@media (pointer: coarse)': { display: 'inline' } }}>Tap or drag up and down to read a level.</Box>
            </Box>
          )}
        </Box>
        {rawPath && openInRaw && (
          <Link component="button" title={`Find ${rawPath} in Raw`} onClick={() => openInRaw(rawPath)} sx={{ flexShrink: 0, fontSize: '0.75rem' }}>Find in Raw</Link>
        )}
        {pinned !== null && (
          <IconButton size="small" aria-label="Let go of this level" onClick={() => { setPinned(null); setHover(null); }} sx={{ p: 0.25 }}><CloseIcon fontSize="small" /></IconButton>
        )}
      </Box>
    </Box>
  );
}
