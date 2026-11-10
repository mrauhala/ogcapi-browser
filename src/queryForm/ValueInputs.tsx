import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import { toLonLat } from 'ol/proj';
import type { Collection } from '../DataRetrievalAPI';
import { useMapInteraction } from '../contexts/MapInteractionContext';
import { spatialExtentOf } from '../query/validateQuery';
import type { BBox } from '../query/types';

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

// What writes a box into its field besides the map and typing: the map's view, or the collection's whole extent. And
// for a cube, the box sent as coords too, where the server's API docs ask for coords
export function BoxPickers({ collection, requiredByApiDocs, bboxAsCoords, setBboxAsCoords }: {
  collection: Collection;
  requiredByApiDocs: boolean;
  bboxAsCoords: boolean;
  setBboxAsCoords: (value: boolean) => void;
}) {
  const { setSelectedBbox, viewExtent } = useMapInteraction();
  const extent = spatialExtentOf(collection);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, mt: 0.5 }}>
      <Button size="small" disabled={!viewExtent} onClick={() => viewExtent && setSelectedBbox(viewBox(viewExtent, extent))} sx={{ textTransform: 'none' }}>
        Use the map view
      </Button>
      {extent && (
        <Button size="small" onClick={() => setSelectedBbox(extent.map(round) as BBox)} sx={{ textTransform: 'none' }}>
          Use the collection&apos;s extent
        </Button>
      )}
      {(requiredByApiDocs || bboxAsCoords) && (
        <FormControlLabel
          control={<Checkbox size="small" checked={bboxAsCoords} onChange={event => setBboxAsCoords(event.target.checked)} />}
          label={<Typography variant="body2">Also send the box as coords (the server&apos;s API docs require it)</Typography>}
        />
      )}
    </Box>
  );
}
