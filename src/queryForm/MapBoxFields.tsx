import React, { useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { Collection } from '../types/api';
import type { BBox } from '../query/types';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { useMapInteraction } from '../contexts/MapInteractionContext';
import { usePanes } from '../contexts/PanesContext';
import { paramOf } from '../query/requestUrl';
import { spatialExtentOf } from '../query/validateQuery';
import { rounded } from '../query/mapLayer';
import { bboxCrsChoices, boxTextIn, crsCode, drawableCrs, drawnBoxSaid, keptShape, shortCrs, viewMatch } from '../query/mapBox';
import NameToggles from './NameToggles';
import { Said } from './ParamField';

// A map's box, size and CRS, as the fields' controls: each value typed as it's sent, what the map can write into them,
// and the values to pick. They read the line, so what's typed and not yet left counts. The map only helps: the fields
// never follow it, and change only when a button is pressed or a box drawn

const NOTE_SX = { fontSize: 12, lineHeight: '16px', mt: 0.5, color: 'text.secondary' };
const Note: React.FC<{ text: string }> = ({ text }) => <Typography component="div" sx={NOTE_SX}><Said text={text} /></Typography>;
const BUTTON_SX = { textTransform: 'none', minWidth: 0, px: 0.75 } as const;
const BUTTONS_SX = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 0.5, mt: 0.5, ml: -0.75 } as const;

const useTyped = () => {
  const { requestUrl } = useRequestUrl();
  return (name: string) => paramOf(requestUrl, name)?.trim() ?? '';
};

// Where the map's size comes from, as the hints say it: on a phone the map is a pane away, and OpenLayers keeps the size
// it had when last shown
const sizeSaid = (isMobile: boolean, [width, height]: readonly number[]) =>
  `${isMobile ? 'the map pane as it shows' : 'the map'}, ${Math.round(width)} × ${Math.round(height)}`;

// Drawing stops when bbox-crs changes, since the box was to go in the one it was, and when the field goes
const StopsDrawing: React.FC<{ bboxCrs: string }> = ({ bboxCrs }) => {
  const { drawBox } = useMapInteraction();
  useEffect(() => () => drawBox(null), [drawBox, bboxCrs]);
  return null;
};

// bbox and bbox-crs side by side, bbox-crs's valid values to pick, and what the map writes: its view with its size and
// CRS, the collection's extent, or one box drawn on it
export const MapBoxValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn; bboxText: React.ReactNode; bboxCrsText: React.ReactNode }> = ({
  collection, queryState, bboxText, bboxCrsText,
}) => {
  const typed = useTyped();
  const { viewExtent, viewSize, viewMoving, boxDrawer, drawBox } = useMapInteraction();
  const { isMobile, showMap } = usePanes();
  const { setQueryParam } = queryState;
  const bboxCrs = typed('bbox-crs');
  const drawable = drawableCrs(bboxCrs);
  // Not while the view moves, as when it frames the collection: the extent last published isn't the one it stops at
  const match = viewMoving ? null : viewMatch(collection, viewExtent, viewSize);
  const extent = spatialExtentOf(collection);
  const choices = bboxCrsChoices(collection, typed('crs'));
  // The view and the extent are written in CRS84, so another bbox-crs goes with them
  const otherCrs = bboxCrs && crsCode(bboxCrs) !== 'CRS84' ? bboxCrs : '';
  const drawing = !!boxDrawer;

  // A box drawn goes in bbox, in bbox-crs as it is: drawing stops if that changes
  const takeBox = (box: BBox) => {
    if (drawable) setQueryParam('bbox', boxTextIn(box, drawable));
  };
  const matchView = () => {
    if (!match) return;
    setQueryParam('bbox', match.bbox);
    setQueryParam('width', String(match.width));
    setQueryParam('height', String(match.height));
    if (match.crs) setQueryParam('crs', match.crs);
    if (otherCrs) setQueryParam('bbox-crs', '');
  };
  const useExtent = () => {
    if (!extent) return;
    setQueryParam('bbox', extent.map(edge => rounded(edge, 3)).join(','));
    if (otherCrs) setQueryParam('bbox-crs', '');
  };
  const draw = () => {
    if (drawing) {
      drawBox(null);
      return;
    }
    drawBox(takeBox);
    if (isMobile) showMap();
  };

  const notes: string[] = [];
  if (match) {
    notes.push(`Match the map view writes \`bbox\`, \`width\` and \`height\` from ${sizeSaid(isMobile, [match.width, match.height])}, `
      + (match.crs ? `and \`crs\` ${shortCrs(match.crs)}, the map's, so that the image lies on it pixel for pixel`
        : "and leaves `crs`: the collection doesn't list EPSG:3857, the map's, so the image lies where it should only if it comes back in CRS84 or EPSG:4326")
      + '. Moving the map afterwards changes nothing here');
  } else {
    notes.push(viewMoving ? 'Match the map view waits for the map to stop moving' : 'Match the map view waits for the map to show once');
  }
  if (otherCrs) notes.push(`Match the map view and Use the collection's extent write CRS84, and take out \`bbox-crs\` ${shortCrs(otherCrs)}`);
  if (!drawable) notes.push(`Drawing is off: the map writes a box in CRS84, EPSG:4326 or EPSG:3857, not ${shortCrs(bboxCrs)}`);
  else if (drawing) notes.push('Click one corner of the box on the map, then the opposite corner');
  else notes.push(`Draw on the map writes \`bbox\` alone, ${drawnBoxSaid(drawable)}`);

  return (
    <>
      <StopsDrawing bboxCrs={bboxCrs} />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{bboxText}</Box>
        {/* Its own id, for the status line's bbox-crs to jump to */}
        <Box id="query-field-bbox-crs" sx={{ width: { xs: 118, sm: 150 }, flexShrink: 0 }}>{bboxCrsText}</Box>
      </Box>
      {choices.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <NameToggles label="bbox-crs" options={choices.map(choice => choice.value)} labels={Object.fromEntries(choices.map(choice => [choice.value, choice.label]))}
            value={choices.find(choice => choice.value === bboxCrs)?.value ?? ''} onChange={value => setQueryParam('bbox-crs', value)} />
        </Box>
      )}
      <Box sx={BUTTONS_SX}>
        <Button size="small" disabled={!match} onClick={matchView} sx={BUTTON_SX}>Match the map view</Button>
        {extent && <Button size="small" onClick={useExtent} sx={BUTTON_SX}>Use the collection&apos;s extent</Button>}
        <Button size="small" disabled={!drawable} onClick={draw} aria-pressed={drawing} sx={BUTTON_SX}>{drawing ? 'Stop drawing' : 'Draw on the map'}</Button>
      </Box>
      {notes.map(note => <Note key={note} text={note} />)}
    </>
  );
};

// width × height, the map's size to use, and the size that keeps the box's shape
export const MapSizeValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn; widthText: React.ReactNode; heightText: React.ReactNode }> = ({
  collection, queryState, widthText, heightText,
}) => {
  const typed = useTyped();
  const { viewSize } = useMapInteraction();
  const { isMobile } = usePanes();
  const { setQueryParam } = queryState;
  const size = viewSize && viewSize[0] >= 1 && viewSize[1] >= 1 ? viewSize.map(Math.round) : null;
  const shape = keptShape(collection, { bbox: typed('bbox'), bboxCrs: typed('bbox-crs'), crs: typed('crs'), width: typed('width'), height: typed('height') });
  const useMapSize = () => {
    if (!size) return;
    setQueryParam('width', String(size[0]));
    setQueryParam('height', String(size[1]));
  };
  const keepShape = () => {
    if ('reason' in shape) return;
    setQueryParam(shape.wrote, String(shape[shape.wrote]));
  };
  const kept = 'reason' in shape ? null : shape;
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ width: 128, minWidth: 0 }}>{widthText}</Box>
        <Box component="span" sx={{ lineHeight: '40px', color: 'text.secondary' }}>×</Box>
        <Box id="query-field-height" sx={{ width: 128, minWidth: 0 }}>{heightText}</Box>
      </Box>
      <Box sx={BUTTONS_SX}>
        <Button size="small" disabled={!size} onClick={useMapSize} sx={BUTTON_SX}>
          {size ? `Use the map's size, ${size[0]} × ${size[1]}` : "Use the map's size"}
        </Button>
        <Button size="small" disabled={!kept} onClick={keepShape} sx={BUTTON_SX}>Keep the box&apos;s shape</Button>
      </Box>
      {size && isMobile && <Note text={`The map's size is ${sizeSaid(true, size)}`} />}
      <Note text={kept
        ? `Keep the box's shape works out \`${kept.wrote}\` from \`${kept.wrote === 'height' ? 'width' : 'height'}\` and the box, in ${kept.inCrs}, which the map comes back in`
        : `Keep the box's shape: ${(shape as { reason: string }).reason}`} />
    </>
  );
};

// crs as sent, and the collection's list to pick from, each shown short and written as listed
export const MapCrsValue: React.FC<{ options: string[]; queryState: UseQueryUrlReturn; crsText: React.ReactNode }> = ({ options, queryState, crsText }) => {
  const typed = useTyped();
  const crs = typed('crs');
  return (
    <>
      {crsText}
      {options.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          {/* A value not written as listed stays in the text, and isn't pressed here */}
          <NameToggles label="crs" options={options} labels={Object.fromEntries(options.map(option => [option, shortCrs(option)]))}
            value={options.includes(crs) ? crs : ''} onChange={value => queryState.setQueryParam('crs', value)} />
        </Box>
      )}
    </>
  );
};
