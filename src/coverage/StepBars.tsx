import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useResponseCells } from '../contexts/responseCells';
import { longestStepCaption, stepCaption, stepKinds, stepLabel, stepOf } from './cellSelection';
import type { StepAxis } from './coverageCells';

const NARROW = '@container (max-width: 440px)';
const MONO = { fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: '17px' };

export type StepKind = '' | 'some' | 'none';

interface StepBarProps {
  // The axis stepped through, as the response calls it
  name: string;
  count: number;
  step: number;
  // Per step: '' with no nulls, 'some' with some, 'none' with no numbers at all
  kinds: StepKind[];
  // The step in words, for a screen reader, and as the bar shows it
  label: string;
  caption: string;
  // The longest caption, in characters, so that the bar keeps its width from one step to the next
  room: number;
  onStep: (step: number) => void;
}

// A segment per step, marked when that step has nulls and more strongly when it's all null, so a bad step shows before
// you reach it. It's all from the one response: stepping sends nothing. The grid's and the profile's
export function StepBar({ name, count, step, kinds, label, caption, room, onStep }: StepBarProps) {
  const down = useRef(false);
  const last = count - 1;

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped !== step) onStep(clamped);
  };
  const fromPointer = (event: PointerEvent<HTMLElement>) => {
    const at = event.currentTarget.getBoundingClientRect();
    go(Math.floor(((event.clientX - at.left) / at.width) * count));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move = ({ ArrowLeft: -1, ArrowRight: 1, Home: -step, End: last - step } as Record<string, number>)[event.key];
    if (move === undefined) return;
    event.preventDefault();
    go(step + move);
  };

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'auto auto minmax(40px, 1fr) auto minmax(0, auto)',
      alignItems: 'center',
      gap: 0.5,
      px: 1.75,
      py: 0.25,
      [NARROW]: { gridTemplateColumns: 'auto auto minmax(0, 1fr) auto', '& > .bar': { gridColumn: '1 / -1', gridRow: 2 } },
    }}>
      <Box sx={{ ...MONO, color: 'text.secondary', minWidth: 12 }}>{name}</Box>
      <IconButton size="small" aria-label={`Previous ${name}`} disabled={step === 0} onClick={() => go(step - 1)} sx={{ p: 0.25 }}><NavigateBeforeIcon fontSize="small" /></IconButton>
      <Box
        className="bar"
        tabIndex={0}
        role="slider"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={step}
        aria-valuetext={label}
        onKeyDown={onKeyDown}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          down.current = true;
          fromPointer(event);
        }}
        onPointerMove={event => {
          if (down.current) fromPointer(event);
        }}
        onPointerUp={() => {
          down.current = false;
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: count > 100 ? 0 : '1px', height: 28, cursor: 'pointer', touchAction: 'none', minWidth: 0, [NARROW]: { height: 24 } }}
      >
        {Array.from({ length: count }, (_, index) => {
          const kind = index === step ? '' : kinds[index];
          return (
            <Box
              key={index}
              sx={{
                flex: 1,
                minWidth: 0,
                height: index === step ? 18 : 10,
                backgroundColor: index === step ? 'primary.main' : kind ? 'transparent' : 'divider',
                ...(kind && {
                  backgroundImage: theme => `repeating-linear-gradient(135deg, ${kind === 'none' ? theme.palette.warning.main : theme.palette.text.disabled} 0 2px, transparent 2px 4px)`,
                }),
              }}
            />
          );
        })}
      </Box>
      <IconButton size="small" aria-label={`Next ${name}`} disabled={step === last} onClick={() => go(step + 1)} sx={{ p: 0.25 }}><NavigateNextIcon fontSize="small" /></IconButton>
      <Box sx={{ ...MONO, whiteSpace: 'nowrap', minWidth: `${room}ch`, textAlign: 'right', [NARROW]: { minWidth: 0, gridColumn: 3, gridRow: 1, textAlign: 'center' } }}>{caption}</Box>
    </Box>
  );
}

// A grid's axis to step through, with its marks from the parameter shown
function CellsStepBar({ dim }: { dim: StepAxis }) {
  const { picture, choices, choose } = useResponseCells();
  const cells = picture?.cells;
  const parameter = picture?.parameter;
  const kinds = useMemo(() => (cells && parameter ? stepKinds(cells, parameter, dim) : []), [cells, parameter, dim]);
  const room = useMemo(() => (cells ? longestStepCaption(cells, dim) : 0), [cells, dim]);
  if (!cells) return null;
  const { steps } = choices;
  const step = stepOf(dim, steps);
  return (
    <StepBar
      name={dim.name}
      count={dim.values.length}
      step={step}
      kinds={kinds}
      label={stepLabel(cells, dim, step)}
      caption={stepCaption(cells, dim, step)}
      room={room}
      onStep={next => choose({ steps: { ...steps, [dim.name]: next } })}
    />
  );
}

export default function StepBars() {
  const { picture } = useResponseCells();
  if (!picture || picture.cells.dims.length === 0) return null;
  return <Box sx={{ pb: 0.5 }}>{picture.cells.dims.map(dim => <CellsStepBar key={dim.name} dim={dim} />)}</Box>;
}
