import { useRef, useState, type PointerEvent } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMapImage } from './contexts/mapImage';
import { notAnImage, pointAt, type ImageBytes, type MapResponseReading, type Tone } from './query/mapResponse';

const MONO = { fontFamily: 'monospace', fontSize: '0.75rem' };
const CHECKERBOARD = {
  backgroundColor: 'background.default',
  backgroundImage:
    'linear-gradient(45deg, rgba(127,127,127,0.15) 25%, transparent 25%),' +
    'linear-gradient(-45deg, rgba(127,127,127,0.15) 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, rgba(127,127,127,0.15) 75%),' +
    'linear-gradient(-45deg, transparent 75%, rgba(127,127,127,0.15) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
};

const TONE_COLOR: Record<Tone, string> = {
  ok: 'success.main', note: 'info.main', differs: 'warning.main', wrong: 'error.main', none: 'text.secondary', missing: 'warning.main',
};

interface Pointer {
  // Where the readout goes in the frame, and which side of the pointer
  left: number;
  top: number;
  flipX: boolean;
  flipY: boolean;
  column: number;
  row: number;
}

// An image response in Data: Fit or 1:1 on the checkerboard. A map's also has On the map and its opacity, the coordinate
// under the pointer, and what its headers say against what was asked
export default function ResponseImage({ imageUrl, image, contentType, reading }: {
  imageUrl: string;
  image: ImageBytes | null;
  contentType: string;
  reading: MapResponseReading | null;
}) {
  const { choices, choose } = useMapImage();
  const frame = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [undecoded, setUndecoded] = useState(false);
  const notImage = notAnImage(contentType, image);
  const placed = !!reading?.place;
  const why = reading?.notPlaced ?? '';

  const point = (event: PointerEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const box = frame.current;
    if (!box || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const frameRect = box.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const x = event.clientX - frameRect.left;
    const y = event.clientY - frameRect.top;
    setPointer({
      left: x + box.scrollLeft,
      top: y + box.scrollTop,
      flipX: x > frameRect.width / 2,
      flipY: y > frameRect.height / 2,
      column: Math.floor(fx * img.naturalWidth),
      row: Math.floor(fy * img.naturalHeight),
    });
  };
  const readout = reading && pointer ? pointAt(reading, pointer.column, pointer.row) : null;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box role="toolbar" aria-label="The image" sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, px: 1, py: 0.5, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={choices.fit ? 'fit' : 'actual'}
          onChange={(_event, value: string | null) => value && choose({ fit: value === 'fit' })}
          aria-label="The image's size"
        >
          <ToggleButton value="fit" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>Fit</ToggleButton>
          <ToggleButton value="actual" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>1:1</ToggleButton>
        </ToggleButtonGroup>
        {reading && (
          <>
            <Tooltip title={why}>
              <span>
                <FormControlLabel
                  sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8125rem' } }}
                  control={<Checkbox size="small" checked={placed && choices.onMap} disabled={!placed} onChange={event => choose({ onMap: event.target.checked })} sx={{ py: 0.25 }} />}
                  label="On the map"
                />
              </span>
            </Tooltip>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>opacity</Typography>
              <Slider
                size="small"
                aria-label="Opacity of the image on the map"
                min={0}
                max={1}
                step={0.05}
                value={choices.opacity}
                disabled={!placed || !choices.onMap}
                onChange={(_event, value) => choose({ opacity: value as number })}
                sx={{ width: 80 }}
              />
            </Box>
          </>
        )}
      </Box>

      {notImage || undecoded ? (
        <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
          {notImage ? `The body isn't the image its Content-Type says: it starts with ${image?.start}. Raw shows it.` : "The browser couldn't decode the image."}
        </Typography>
      ) : (
        <Box
          ref={frame}
          data-testid="response-image-frame"
          sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', position: 'relative', p: 2, ...CHECKERBOARD }}
        >
          <img
            src={imageUrl}
            alt="API response"
            onError={() => setUndecoded(true)}
            onPointerMove={point}
            onPointerDown={point}
            // A finger's readout stays until the next tap
            onPointerLeave={event => event.pointerType !== 'touch' && setPointer(null)}
            style={{
              margin: 'auto',
              maxWidth: choices.fit ? '100%' : 'none',
              maxHeight: choices.fit ? '100%' : 'none',
              objectFit: 'contain',
              flexShrink: 0,
              imageRendering: choices.fit ? 'auto' : 'pixelated',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              touchAction: 'pan-x pan-y',
            }}
          />
          {readout && pointer && (
            <Box
              aria-label="The point under the pointer"
              sx={{
                ...MONO, position: 'absolute', left: pointer.left, top: pointer.top, pointerEvents: 'none', whiteSpace: 'nowrap',
                transform: `translate(${pointer.flipX ? 'calc(-100% - 12px)' : '12px'}, ${pointer.flipY ? 'calc(-100% - 12px)' : '12px'})`,
                bgcolor: 'rgba(0,0,0,.85)', color: '#fff', px: 0.75, py: 0.25, borderRadius: 0.5, lineHeight: 1.5,
              }}
            >
              <div>{readout.inCrs}</div>
              {readout.lonLat && <div>{readout.lonLat}</div>}
            </Box>
          )}
        </Box>
      )}

      {reading && (
        <Box
          role="table"
          aria-label="What the headers say, against what was asked"
          sx={{
            flexShrink: 0, maxHeight: '45%', overflow: 'auto', borderTop: '1px solid', borderColor: 'divider', px: 1.5, py: 1,
            display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.5, backgroundColor: 'background.paper',
          }}
        >
          {reading.rows.map(row => (
            <Box role="row" key={row.name} sx={{ display: 'contents' }}>
              <Box role="rowheader" sx={{ ...MONO, color: 'text.secondary' }}>{row.name}</Box>
              <Box role="cell" sx={{ ...MONO, overflowWrap: 'anywhere' }}>
                <span>{row.value}</span>
                {row.more && <><br /><span>{row.more}</span></>}
                {' '}
                <Box component="span" sx={{ fontFamily: 'inherit', color: TONE_COLOR[row.tone] }}>{row.against}</Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
