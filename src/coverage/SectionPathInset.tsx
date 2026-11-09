import { useMemo, useSyncExternalStore } from 'react';
import { useTheme } from '@mui/material/styles';
import { useResponseCells } from '../contexts/responseCells';
import type { SectionData } from './coverageSection';

const WIDTH = 64;
const HEIGHT = 40;
const PAD = 4;
const round = (value: number) => Math.round(value * 10) / 10;
// Without spreading them into a call, which a long path would overflow
const lowest = (numbers: number[]) => numbers.reduce((a, b) => Math.min(a, b), Infinity);
const highest = (numbers: number[]) => numbers.reduce((a, b) => Math.max(a, b), -Infinity);

// The path's positions fitted into the inset, east to the right and north up, a degree of longitude as wide as it is at
// the path's middle latitude. Lines of a MULTILINESTRING apart
function shapeOf({ positions, breaks }: Pick<SectionData, 'positions' | 'breaks'>) {
  const lats = positions.map(([, y]) => y);
  const [south, north] = [lowest(lats), highest(lats)];
  const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const xs = positions.map(([x]) => x * squeeze);
  const [west, east] = [lowest(xs), highest(xs)];
  const across = east - west;
  const up = north - south;
  // The same scale both ways, as big as fits. A path straight along one way has no span the other
  const fit = Math.min(across > 0 ? (WIDTH - 2 * PAD) / across : Infinity, up > 0 ? (HEIGHT - 2 * PAD) / up : Infinity);
  const scale = Number.isFinite(fit) ? fit : 0;
  const at = (col: number): [number, number] => [
    round(WIDTH / 2 + (xs[col] - (west + east) / 2) * scale),
    round(HEIGHT / 2 - (lats[col] - (south + north) / 2) * scale),
  ];
  const starts = [0, ...breaks, positions.length];
  const lines = starts.slice(0, -1).map((start, i) => Array.from({ length: starts[i + 1] - start }, (_, n) => at(start + n).join(',')).join(' '));
  return { lines, at };
}

// Where along the path the cell pointed at is, on the path in small: its positions as sent, a hollow dot where it starts,
// and a dot at the position pointed at or pinned. Only for a path on lon/lat, which it draws without a map
export default function SectionPathInset() {
  const { picture, choices, hover } = useResponseCells();
  const hovered = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  const theme = useTheme();
  const cells = picture?.cells;
  const data = cells?.section?.data;
  const shape = useMemo(() => (data ? shapeOf(data) : null), [data]);
  if (!cells || !data || !shape || cells.geometry.kind !== 'grid') return null;
  const { nx } = cells.geometry;
  const chosen = hovered?.cell ?? choices.pin;
  const col = chosen !== null && chosen < cells.cells ? chosen % nx : null;
  const line = theme.palette.text.secondary;
  const [startX, startY] = shape.at(0);

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      {shape.lines.map((points, i) => <polyline key={i} points={points} fill="none" stroke={line} strokeWidth={1.25} strokeLinejoin="round" />)}
      <circle data-start="" cx={startX} cy={startY} r={2.5} fill={theme.palette.background.paper} stroke={line} strokeWidth={1.25} />
      {col !== null && (() => {
        const [x, y] = shape.at(col);
        return <circle data-at={col} cx={x} cy={y} r={3} fill={theme.palette.primary.main} stroke={theme.palette.background.paper} strokeWidth={1} />;
      })()}
    </svg>
  );
}
