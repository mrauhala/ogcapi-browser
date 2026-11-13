import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import SlideshowIcon from '@mui/icons-material/Slideshow';

import type { Collection } from './DataRetrievalAPI';
import { normalizeHref } from './DataRetrievalAPI';
import { getMapsLinks, hasMapsSupport, resolveWebMercatorTileTemplates } from './api/maps';
import { useMapsLayers, type MapsLayer } from './contexts/MapsLayerContext';
import { useService } from './contexts/ServiceContext';
import { useQueryValidationContext } from './contexts/QueryValidationContext';
import { useOpenApi } from './contexts/OpenApiContext';
import { useApi } from './contexts/ApiContext';
import { queryTypeOf } from './query/queryTypes';
import { matchOperation } from './validation/openapi/operationIndex';
import {
  MAX_FRAMES, choicesSaid, frameParams, layerSourceOf, layerTitle, mapCrsOf, seriesTimes, tilesDatetimeDeclared, tilesFor,
  type LayerSource, type Pairs,
} from './query/mapLayer';
import { readableQuery } from './query/requestUrl';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';

interface MapsPanelProps {
  collection: Collection;
  apiUrl: string;
  queryState: UseQueryUrlReturn;
}

// How a layer is drawn: by tiles carrying the choices, or by the map for each view, and why not by tiles
type Drawn = { sourceType: 'tiles'; tileUrl: string; params: Pairs } | { sourceType: 'dynamic'; params: Pairs; because: string | null };

// What the box says it draws
function sourceText(source: LayerSource): string {
  if (source.from === 'tiles') return "Draws the collection's tiles, as served: it has no map to choose what's drawn from.";
  if (source.from === 'waiting') return 'Draws what the form above has chosen, once its request is built.';
  if (source.from === 'collection') return "Draws the collection's own map over the map's view. Pick map in the Query row above to choose what's drawn.";
  const said = choicesSaid(source.choices);
  return said.length
    ? `Draws what the form above has chosen: ${said.join(' · ')}, over the map's view.`
    : "Draws what the form above has chosen: nothing yet, so the collection's own map, over the map's view.";
}

// Layers on the map from the collection's map: what the map query's form has chosen, over the map's own view. Each
// layer keeps what it was added with
export default function MapsPanel({ collection, apiUrl, queryState }: MapsPanelProps) {
  const { setMapsLayers, setMapsBundles } = useMapsLayers();
  const { getAuthCredentials } = useService();
  const { queryValidation } = useQueryValidationContext();
  const { index } = useOpenApi();
  const { conformsTo } = useApi();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const links = useMemo(() => getMapsLinks(collection), [collection]);
  const { queryTarget, styleId, mapStyles } = queryState;
  const mapPicked = !!queryTarget && queryTypeOf(queryTarget.collection, queryTarget.queryKey) === 'map';
  // The form's request, once it's the map query's for this collection
  const formRequest = mapPicked && queryValidation?.declaring?.query === 'map' && queryValidation.declaring.collection.id === collection.id
    ? queryValidation
    : null;
  const source = useMemo(() => layerSourceOf({
    mapPicked,
    request: formRequest ? { url: formRequest.url, issues: formRequest.issues } : null,
    styleId,
    mapHref: normalizeHref(links.mapLink?.href),
  }), [mapPicked, formRequest, styleId, links.mapLink]);
  const choices = 'choices' in source ? source.choices : null;
  // An error in the form's request stops a layer, which would ask the same; so does a request not yet built
  const blocked = source.from === 'form' ? source.blocked : null;
  const waiting = source.from === 'waiting';
  const series = useMemo(() => (collection.extent?.temporal ? seriesTimes(collection.extent.temporal, choices?.params ?? []) : null), [collection, choices]);

  // The tiles: a style's own, or, with no style, the collection's
  const style = choices?.styleId ? mapStyles.styles.find(each => each.id === choices.styleId) : undefined;
  const tilesHref = choices?.styleId ? style?.tilesHref ?? null : normalizeHref(links.tilesetsLink?.href);

  // Tiles where they take every choice, else the map for each view, saying why
  const drawnBy = async (params: Pairs, auth: ReturnType<typeof getAuthCredentials>): Promise<Drawn | null> => {
    let because: string | null = choices?.styleId && !tilesHref ? `the style ${choices.styleId} has no tiles of its own` : null;
    if (tilesHref) {
      const templates = await resolveWebMercatorTileTemplates(tilesHref, auth);
      const operation = templates[0] && index ? matchOperation(index, templates[0].href.replace('{z}', '0').replace('{y}', '0').replace('{x}', '0')) : null;
      const apiDocs = operation ? operation.entry.params.filter(param => param.in === 'query').map(param => param.name) : null;
      const tiles = tilesFor(params, { templates, apiDocs, datetimeClass: tilesDatetimeDeclared(conformsTo) });
      if ('template' in tiles) return { sourceType: 'tiles', tileUrl: tiles.template, params: tiles.params };
      because = tiles.refused;
    }
    return choices ? { sourceType: 'dynamic', params, because } : null;
  };

  // One layer per collection, source and choices, so that two parameters make two layers
  const layerId = (drawn: Drawn, params: Pairs) =>
    `${collection.id}::${drawn.sourceType}::${drawn.sourceType === 'tiles' ? drawn.tileUrl : choices!.endpoint}?${readableQuery(params)}`;
  const layerOf = (drawn: Drawn, title: string, auth: ReturnType<typeof getAuthCredentials>): MapsLayer => ({
    id: layerId(drawn, drawn.params),
    collectionId: collection.id,
    styleId: choices?.styleId || undefined,
    title,
    visible: true,
    opacity: 1,
    zIndex: 50,
    sourceType: drawn.sourceType,
    ...(drawn.sourceType === 'tiles' ? { tileUrl: drawn.tileUrl } : { dynamicEndpoint: choices!.endpoint, crs: mapCrsOf(collection).crs }),
    params: drawn.params,
    apiKey: auth?.apiKey,
    apiKeyParam: auth?.apiKeyParam,
  });

  // How it was added, and in what CRS where the collection doesn't list the map's
  const howDrawn = (drawn: Drawn) => (drawn.sourceType === 'tiles'
    ? 'as tiles'
    : `by ${choices!.styleId ? `the style's map` : 'its map'} for each view${drawn.because ? `, since ${drawn.because}` : ''}`
      + `${mapCrsOf(collection).listed ? '' : ", in EPSG:3857, which the collection's crs doesn't list"}`);

  const handleAdd = async () => {
    setAdding(true);
    setAddError(null);
    setNotice(null);
    try {
      const auth = getAuthCredentials(apiUrl);
      const params = choices?.params ?? [];
      const drawn = await drawnBy(params, auth);
      if (!drawn) {
        setAddError('The collection has no map, and no WebMercatorQuad tiles to draw.');
        return;
      }
      const title = layerTitle(collection.title || collection.id, { styleId: choices?.styleId ?? '', params });
      const layer = layerOf(drawn, title, auth);
      setMapsLayers(prev => {
        const idx = prev.findIndex(l => l.id === layer.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], visible: true };
          return next;
        }
        return [...prev, layer];
      });
      setNotice(`Added ${howDrawn(drawn)}.`);
    } catch (err) {
      console.error('Add map layer failed:', err);
      setAddError(err instanceof Error ? err.message : 'Failed to add map layer.');
    } finally {
      setAdding(false);
    }
  };

  // A series: one layer for each time, shown one at a time by the playback bar. Each asks for its own time, the rest as
  // the form had it
  const handleAddSeries = async () => {
    if (!series || 'error' in series) return;
    setAdding(true);
    setAddError(null);
    setNotice(null);
    try {
      const auth = getAuthCredentials(apiUrl);
      const params = choices?.params ?? [];
      // Tiles only if they take the time as well as the rest
      const drawn = await drawnBy(frameParams(params, series.times[0]), auth);
      if (!drawn) {
        setAddError('The collection has no map, and no WebMercatorQuad tiles to draw.');
        return;
      }
      const rest = params.filter(([name]) => name !== 'datetime');
      const collectionTitle = layerTitle(collection.title || collection.id, { styleId: choices?.styleId ?? '', params: rest });
      const bundleId = `bundle::${layerId(drawn, rest)}::${series.times[0]}_${series.times[series.times.length - 1]}_${series.times.length}`;
      const frames: MapsLayer[] = series.times.map((time, i) => {
        const frame = { ...drawn, params: frameParams(drawn.sourceType === 'tiles' ? drawn.params : params, time) };
        return { ...layerOf(frame, `${collectionTitle} @ ${time}`, auth), id: `${bundleId}#${i}`, bundleId, frameIndex: i, frameTime: time };
      });

      setMapsLayers(prev => [...prev.filter(l => l.bundleId !== bundleId), ...frames]);
      setMapsBundles(prev => ({
        ...prev,
        [bundleId]: { bundleId, collectionTitle, frameCount: frames.length, currentIndex: 0, isPlaying: false, fps: 2 },
      }));
      setNotice(`Added ${frames.length} frames${series.of > frames.length ? ` of ${series.of} (at most ${MAX_FRAMES})` : ''}, ${howDrawn(drawn)}. Use the playback bar on the map.`);
    } catch (err) {
      console.error('Add animated series failed:', err);
      setAddError(err instanceof Error ? err.message : 'Failed to add animated series.');
    } finally {
      setAdding(false);
    }
  };

  if (!hasMapsSupport(collection)) return null;

  const seriesSaid = !series ? null
    : 'error' in series ? series.error
    : `A series steps through ${series.of > series.times.length ? `${series.times.length} of the ${series.of}` : `the ${series.of}`} times ${series.from === 'range' ? 'in the range chosen' : 'the collection lists'}${series.run ? ' from the run asked on' : ''}.`;

  return (
    // Apart from the form above it: these are layers on the map, not the request
    <Box id="map-layers" component="section" aria-labelledby="map-layers-title" sx={{ mt: 2, mb: 2 }}>
      <Typography id="map-layers-title" variant="subtitle2" component="h2" sx={{ mb: 0.5 }}>Map layers</Typography>
      <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary', overflowWrap: 'anywhere' }}>{sourceText(source)}</Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd} disabled={adding || waiting || !!blocked} sx={{ whiteSpace: 'nowrap' }}>
          Add layer
        </Button>
        {series && (
          <Button
            variant="outlined"
            startIcon={<SlideshowIcon />}
            onClick={handleAddSeries}
            disabled={adding || waiting || !!blocked || 'error' in series}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Add animated series
          </Button>
        )}
      </Stack>

      {blocked && <Typography variant="body2" sx={{ mb: 1, color: 'error.main', overflowWrap: 'anywhere' }}>No layer while the form's request has an error: {blocked}</Typography>}
      {!blocked && seriesSaid && <Typography variant="caption" component="p" sx={{ mb: 1, color: 'text.secondary' }}>{seriesSaid}</Typography>}
      {addError && <Alert severity="error" sx={{ mb: 1 }}>{addError}</Alert>}
      {notice && <Alert severity="info" sx={{ mb: 1 }}>{notice}</Alert>}
    </Box>
  );
}
