import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { toLonLat } from 'ol/proj';
import type { Collection } from '../DataRetrievalAPI';
import { useMapInteraction } from '../contexts/MapInteractionContext';
import { spatialExtentOf } from '../query/validateQuery';
import type { BBox } from '../query/types';

// A number typed as text: the value updates whenever the text is a number, and an outside change
// (e.g. the map's slider) replaces the text only if it means another number, so "2." survives typing
export function NumberField({ id, label, value, onChange, error = false, placeholder }: {
  id: string;
  label?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  error?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText(current => {
      const typed = current.trim() === '' ? null : Number(current);
      return typed === value ? current : value === null ? '' : String(value);
    });
  }, [value]);
  return (
    <TextField
      id={id}
      label={label}
      size="small"
      fullWidth
      value={text}
      error={error}
      placeholder={placeholder}
      onChange={event => {
        setText(event.target.value);
        const parsed = event.target.value.trim() === '' ? null : Number(event.target.value);
        if (parsed === null || isFinite(parsed)) onChange(parsed);
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal', sx: { fontFamily: 'monospace' } } }}
    />
  );
}

const NO_EDGES: (number | null)[] = [null, null, null, null];
const EDGES = [{ label: 'West', index: 0 }, { label: 'East', index: 2 }, { label: 'South', index: 1 }, { label: 'North', index: 3 }];
const round = (value: number) => Math.round(value * 1000) / 1000;

// The map view as a lon/lat box, cut to the collection's extent when they overlap
function viewBox(viewExtent: [number, number, number, number], collectionBox: BBox | null): BBox {
  const [west, south] = toLonLat([viewExtent[0], viewExtent[1]]);
  const [east, north] = toLonLat([viewExtent[2], viewExtent[3]]);
  let box: BBox = [Math.max(west, -180), Math.max(south, -90), Math.min(east, 180), Math.min(north, 90)];
  if (collectionBox) {
    const cut: BBox = [Math.max(box[0], collectionBox[0]), Math.max(box[1], collectionBox[1]), Math.min(box[2], collectionBox[2]), Math.min(box[3], collectionBox[3])];
    if (cut[0] < cut[2] && cut[1] < cut[3]) box = cut;
  }
  return box.map(round) as BBox;
}

// A box as four edge fields, in step with the box drawn on the map. Edges being typed live here until all four are
// numbers; only then does the box (and the request) change.
export function BoxFields({ collection, error = false, requiredByApiDocs, bboxAsCoords, setBboxAsCoords }: {
  collection: Collection;
  error?: boolean;
  requiredByApiDocs: boolean;
  bboxAsCoords: boolean;
  setBboxAsCoords: (value: boolean) => void;
}) {
  const { selectedBbox, setSelectedBbox, viewExtent } = useMapInteraction();
  const [edges, setEdges] = useState<(number | null)[]>(selectedBbox ?? NO_EDGES);
  const sent = useRef<BBox | null>(selectedBbox);
  useEffect(() => {
    if (selectedBbox === sent.current) return; // our own update
    sent.current = selectedBbox;
    setEdges(selectedBbox ?? NO_EDGES);
  }, [selectedBbox]);

  const setEdge = (index: number, value: number | null) => {
    const next = edges.map((edge, i) => (i === index ? value : edge));
    setEdges(next);
    const box = next.every(edge => edge !== null) ? next as BBox : null;
    sent.current = box;
    setSelectedBbox(box);
  };

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {EDGES.map(({ label, index }) => (
          <NumberField key={label} id={`query-field-bbox-${label.toLowerCase()}`} label={label} value={edges[index]}
            onChange={value => setEdge(index, value)} error={error} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
        <Button size="small" disabled={!viewExtent} onClick={() => viewExtent && setSelectedBbox(viewBox(viewExtent, spatialExtentOf(collection)))}>
          Use map view
        </Button>
        {(requiredByApiDocs || bboxAsCoords) && (
          <FormControlLabel
            control={<Checkbox size="small" checked={bboxAsCoords} onChange={event => setBboxAsCoords(event.target.checked)} />}
            label={<Typography variant="body2">Also send the box as coords (the server's API docs require it)</Typography>}
          />
        )}
      </Box>
    </Box>
  );
}
