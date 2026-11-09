import { memo } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import type { CoverageProfile } from './coverageProfile';
import {
  CHARACTER, NULL_LANE, cellWords, dotRadius, emptyWords, plotColours, profileSegments, valueScale,
  type ProfileLine, type ProfilePanelGroup,
} from './profilePlot';
import { isNumber, type LevelSpacing, type VerticalAxis } from './verticalAxis';

// A profile's drawing in SVG: a panel per parameter, each given its size, and the vertical axis they share. Each has a
// layer on top for the crosshair, so that pointing doesn't redraw what's under it

const round = (value: number) => Math.round(value * 10) / 10;

const MONO_TEXT = { fontFamily: 'monospace', fontSize: 11 };

const DIRECTION_SOURCE = { response: 'response', usual: 'assumed', none: 'assumed' } as const;

// What z is, which level is at the top and why: the profile's and the section's
export function AxisWords({ axis, spacing, flipped, top }: { axis: VerticalAxis; spacing: LevelSpacing; flipped: boolean; top: number | string }) {
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

// Levels that should be there and aren't, as a sentence
export function MissingLevelsWords({ missing, from }: { missing: number[]; from: 'request' | 'collection' | null }) {
  return <>{`${[...missing].sort((a, b) => a - b).join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} in the response, though ${from === 'request' ? 'asked for' : "in the collection's extent"}.`}</>;
}

export interface PlotFrame {
  height: number;
  yOf: (level: number) => number;
  // Levels with a label, and a grid line across the panels
  labelled: ReadonlySet<number>;
}

interface PanelProps {
  profile: CoverageProfile;
  panel: ProfilePanelGroup;
  lines: ProfileLine[];
  width: number;
  frame: PlotFrame;
  time: number;
  // The other times' samples behind, as dots along each level
  allTimes: boolean;
}

// One panel: grid lines at the labelled levels, a dashed line where a level should be and isn't, a zero line, the
// other times' samples, the line and its dots, and a × in the lane at the left for each null
export const ProfilePanel = memo(function ProfilePanel({ profile, panel, lines, width, frame, time, allTimes }: PanelProps) {
  const colours = plotColours(useTheme());
  const { height, yOf, labelled } = frame;
  const { rows, missing } = profile;
  const hasNulls = panel.parameters.some(parameter => parameter.nulls > 0);
  const scale = valueScale(panel.min, panel.max, width, hasNulls);
  const numbersNow = lines.some(line => line.parameter.values[line.location][time]?.some(isNumber));
  const empty = emptyWords(panel.parameters, numbersNow);

  let faint = '';
  if (scale && allTimes && profile.times.length > 1 && lines.length === 1 && profile.locations.length === 1) {
    const [{ parameter }] = lines;
    profile.times.forEach((_, other) => {
      if (other === time) return;
      rows.forEach((level, row) => {
        const value = parameter.values[0][other][row];
        if (isNumber(value)) faint += `M${round(scale.map(value))} ${round(yOf(level))}h0`;
      });
    });
  }
  let nulls = '';
  if (hasNulls) {
    rows.forEach((level, row) => {
      if (lines.some(line => line.parameter.values[line.location][time]?.[row] === null)) {
        const y = round(yOf(level));
        nulls += `M3 ${y - 2.5}l5 5m0 -5l-5 5`;
      }
    });
  }
  const radius = dotRadius(rows.length);
  const zero = scale && scale.min < 0 && scale.max > 0 ? round(scale.map(0)) : null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={panel.parameters.map(parameter => parameter.id).join(', ')} style={{ display: 'block', overflow: 'hidden' }}>
      {rows.map(level => (labelled.has(level) && !missing.includes(level)
        ? <line key={`g${level}`} x1={0} x2={width} y1={round(yOf(level))} y2={round(yOf(level))} stroke={colours.grid} strokeWidth={1} />
        : null))}
      {missing.map(level => (
        <line key={`m${level}`} data-missing={level} x1={0} x2={width} y1={round(yOf(level))} y2={round(yOf(level))} stroke={colours.warnLine} strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {zero !== null && (
        <>
          <line x1={zero} x2={zero} y1={0} y2={height} stroke={colours.zero} strokeWidth={1} />
          <text x={zero} y={height - 6} textAnchor="middle" fill={colours.secondary} stroke={colours.paper} strokeWidth={3} paintOrder="stroke" style={{ ...MONO_TEXT, fontSize: 10 }}>0</text>
        </>
      )}
      {faint && <path data-strip="" d={faint} fill="none" stroke={colours.faint} strokeWidth={2.6} strokeLinecap="round" />}
      {scale && lines.map(line => {
        const values = line.parameter.values[line.location][time] ?? [];
        const path = profileSegments(rows, values, missing)
          .map(run => run.map((row, i) => `${i ? 'L' : 'M'}${round(scale.map(values[row] as number))} ${round(yOf(rows[row]))}`).join(''))
          .join('');
        return (
          <g key={`${line.parameter.id}|${line.location}`}>
            <path d={path} fill="none" stroke={line.colour} strokeWidth={1} />
            {rows.map((level, row) => (isNumber(values[row])
              ? <circle key={level} cx={round(scale.map(values[row] as number))} cy={round(yOf(level))} r={radius} fill={line.colour} />
              : null))}
          </g>
        );
      })}
      {nulls && <path data-nulls="" d={nulls} fill="none" stroke={colours.nullMark} strokeWidth={1} />}
      {empty && (() => {
        const x = width / 2 + (hasNulls ? NULL_LANE / 4 : 0);
        const [first, second] = empty === 'All null at this time' ? ['All null', 'at this time'] : [empty];
        return (
          <text x={x} y={height / 2 - (second ? 8 : 0)} textAnchor="middle" fill={colours.secondary} style={{ fontSize: 12 }}>
            <tspan x={x}>{first}</tspan>
            {second && <tspan x={x} dy={16}>{second}</tspan>}
          </text>
        );
      })()}
    </svg>
  );
});

interface CrosshairProps {
  profile: CoverageProfile;
  panel: ProfilePanelGroup;
  lines: ProfileLine[];
  width: number;
  frame: PlotFrame;
  time: number;
  // The row pointed at or kept, if any
  row: number | null;
}

// On top of a panel: a line across at the level, a ring on each dot, and what each line has there
export function PanelCrosshair({ profile, panel, lines, width, frame, time, row }: CrosshairProps) {
  const colours = plotColours(useTheme());
  if (row === null) return null;
  const level = profile.rows[row];
  const y = round(frame.yOf(level));
  const hasNulls = panel.parameters.some(parameter => parameter.nulls > 0);
  const scale = valueScale(panel.min, panel.max, width, hasNulls);
  const readings = lines.map(line => {
    const raw = line.parameter.values[line.location][time]?.[row];
    return { words: cellWords(raw, line.parameter.unit), colour: line.colour, keyed: lines.length > 1, x: scale && isNumber(raw) ? scale.map(raw) : null };
  });
  const anchor = readings.find(reading => reading.x !== null)?.x ?? width / 2;
  const longest = Math.max(...readings.map(reading => reading.words.length)) * CHARACTER + (readings[0]?.keyed ? 16 : 0);
  const left = Math.max(3, Math.min(width - longest - 3, anchor < width / 2 ? anchor + 8 : anchor - 8 - longest));
  const above = y > 24 + (readings.length - 1) * 14;

  return (
    <svg width={width} height={frame.height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} aria-hidden>
      <line x1={0} x2={width} y1={y} y2={y} stroke={colours.ink} strokeOpacity={0.55} strokeWidth={1} />
      {readings.map((reading, i) => (reading.x === null ? null : <circle key={`r${i}`} cx={round(reading.x)} cy={y} r={5} fill="none" stroke={reading.colour} strokeWidth={1.5} />))}
      {readings.map((reading, i) => {
        const textY = above ? y - 5 - (readings.length - 1 - i) * 14 : y + 14 + i * 14;
        return (
          <g key={`t${i}`}>
            {reading.keyed && <rect x={left} y={textY - 5} width={12} height={2} fill={reading.colour} />}
            <text x={left + (reading.keyed ? 16 : 0)} y={textY} fill={colours.ink} stroke={colours.paper} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" style={MONO_TEXT}>{reading.words}</text>
          </g>
        );
      })}
    </svg>
  );
}

interface AxisProps {
  profile: CoverageProfile;
  width: number;
  frame: PlotFrame;
  time: number;
}

// The levels, a tick at each: long where this time has it, short where only other times do, orange where it should be
// and isn't. A label at those chosen
export const ProfileZAxis = memo(function ProfileZAxis({ profile, width, frame, time }: AxisProps) {
  const colours = plotColours(useTheme());
  const { rows, missing } = profile;
  const here = new Set(rows.filter((_, row) => profile.parameters.some(parameter => parameter.values.some(byTime => byTime[time]?.[row] !== undefined))));
  return (
    <svg width={width} height={frame.height} role="img" aria-label="The levels" style={{ display: 'block', overflow: 'visible' }}>
      {rows.map(level => {
        const y = round(frame.yOf(level));
        const isMissing = missing.includes(level);
        const tick = isMissing ? 7 : here.has(level) ? 4 : 2;
        return (
          <g key={level} data-level={level}>
            <line x1={width - tick} x2={width} y1={y} y2={y} stroke={isMissing ? colours.warnLine : here.has(level) ? colours.secondary : colours.divider} strokeWidth={1} />
            {frame.labelled.has(level) && (
              <text x={width - (isMissing ? 9 : 6)} y={y + 3.5} textAnchor="end" fill={isMissing ? colours.warnText : colours.secondary} style={MONO_TEXT}>{String(level)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

// The level pointed at, in a pill over the axis
export function LevelPill({ level, width, frame }: { level: number | null; width: number; frame: PlotFrame }) {
  const theme = useTheme();
  if (level === null) return null;
  const label = String(level);
  const pillWidth = Math.max(label.length * CHARACTER + 8, 22);
  const y = Math.max(9, Math.min(frame.height - 9, round(frame.yOf(level))));
  return (
    <svg width={width} height={frame.height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden>
      <rect x={width - pillWidth} y={y - 8} width={pillWidth} height={16} rx={3} fill={theme.palette.text.primary} />
      <text x={width - 4} y={y + 3.5} textAnchor="end" fill={theme.palette.background.paper} style={{ ...MONO_TEXT, fontWeight: 500 }}>{label}</text>
    </svg>
  );
}
