import React from 'react';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import { Collection, expandVerticalValues, expandCustomDimensionValues, getEffectiveCustomDimensions } from './DataRetrievalAPI';
import { UseQueryUrlReturn } from './hooks/useQueryUrl';
import TimeControl from './TimeControl';
import InstancePicker from './InstancePicker';
import { queryTypeOf, queryVariables, unitsFor } from './query/queryTypes';
import { mapInputRequired } from './query/edrRules';
import { levelChoice, pickedLevels, startsRepeating, unlistedReason } from './query/levels';
import { intervalEnds } from './query/dimensionText';
import { collectionOffers, fieldSpecs, lacksTimeAndLevels, type FieldSpec } from './query/fieldSpecs';
import { timeIsOnlyAFilter } from './query/queryModel';
import { useCollection } from './contexts/CollectionContext';
import { useRequestUrl } from './contexts/RequestUrlContext';
import { useMapInteraction } from './contexts/MapInteractionContext';
import { useOpenCollection } from './contexts/OpenCollectionContext';
import { usePanes } from './contexts/PanesContext';
import { useQueryValidation } from './hooks/useQueryValidation';
import ParamField from './queryForm/ParamField';
import NameToggles from './queryForm/NameToggles';
import QueryTypeRow from './queryForm/QueryTypeRow';
import QueryStatus from './queryForm/QueryStatus';
import { useOpenDocs } from './queryForm/fieldFocus';
import { BoxPickers } from './queryForm/ValueInputs';
import ParamText from './queryForm/ParamText';
import ItemText from './queryForm/ItemText';
import StyleField from './queryForm/StyleField';
import MoreParams from './queryForm/MoreParams';
import { paramOf, paramsIn } from './query/requestUrl';
import { LocationPicker, ParameterPicker } from './queryForm/SearchPickers';
import { parametersOf } from './queryForm/pickerSearch';

interface CollectionQueryBuilderProps {
  collection: Collection;
  queryState: UseQueryUrlReturn;
}

// What a dimension's picker calls its parts: z's levels, or a custom dimension's values
interface PickerWords {
  pick: (count: number) => string; // the dropdown, with nothing picked
  label: string; // for screen readers
  large: (count: number) => string; // why there's no dropdown: too many values to list
  unlisted: (value: string) => string; // why a value in the text isn't one of those listed
}

const LEVEL_WORDS: PickerWords = {
  pick: count => `Pick from the ${count} levels listed`,
  label: 'z levels',
  large: count => `${count} levels listed, too many to pick from: type them`,
  unlisted: unlistedReason,
};

const dimensionWords = (id: string): PickerWords => ({
  pick: count => `Pick from the ${count} values listed`,
  label: `${id} values`,
  large: count => `${count} values listed, too many to pick from: type them`,
  unlisted: () => "Not one of the dimension's values",
});

const MONO = { primary: { style: { fontSize: '0.85rem', fontFamily: 'monospace' } } };

// z's or a custom dimension's values, to pick into the text: ticked as the text lists them. A pick writes a list, in
// the collection's order, and one not among its own, as from a link, shows first so that it can be taken out. An
// interval or a repeat in the text is replaced by what's picked; one is typed. Past 250 values, or with none listed,
// there's only the text.
const DimensionPicker: React.FC<{
  listed: string[]; // the values the collection lists
  hasValues: boolean; // listed as values, rather than worked out from an interval
  text: string;
  setText: (text: string) => void;
  words: PickerWords;
}> = ({ listed, hasValues, text, setText, words }) => {
  if (!hasValues) return null;
  if (listed.length > 250) return <Typography component="div" sx={{ fontSize: 12, mt: 0.5, color: 'text.secondary' }}>{words.large(listed.length)}</Typography>;
  const { chosen, unlisted } = intervalEnds(text) || startsRepeating(text) ? { chosen: [] as string[], unlisted: [] as string[] } : levelChoice(text, listed);
  return (
    <FormControl fullWidth size="small" sx={{ mt: 0.75 }}>
      <Select
        multiple
        displayEmpty
        value={chosen}
        onChange={(event) => {
          const picked = typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value;
          setText(pickedLevels(picked, listed));
        }}
        renderValue={(selected) => (selected.length
          ? <Box component="span" sx={{ fontSize: 13 }}>{selected.length} picked</Box>
          : <Box component="span" sx={{ color: 'text.disabled' }}>{words.pick(listed.length)}</Box>)}
        inputProps={{ 'aria-label': words.label }}
        MenuProps={{ slotProps: { paper: { style: { maxHeight: 300 } } } }}
      >
        {[...unlisted, ...listed].map((value) => (
          <MenuItem key={value} value={value} dense>
            <Checkbox size="small" checked={chosen.includes(value)} sx={{ py: 0 }} />
            <ListItemText primary={value} secondary={unlisted.includes(value) ? words.unlisted(value) : undefined} slotProps={MONO} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

// The WKT as sent, typed or drawn: the map writes it. On a phone the map is a pane away: Map goes there, since picking
// a query no longer does
function CoordsValue({ error, warning }: { error: boolean; warning: boolean }) {
  const { isMobile, showMap } = usePanes();
  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}><ParamText name="coords" placeholder="Draw on the map, or type WKT" error={error} warning={warning} /></Box>
      {isMobile && <Button variant="outlined" onClick={showMap} sx={{ flexShrink: 0, height: 40, textTransform: 'none' }}>Map</Button>}
    </Box>
  );
}

// A unit, right after its number: toggles of those the query lists, or typed where it lists none
function UnitsValue({ name, offered, value, onChange, error }: { name: string; offered: string[]; value: string; onChange: (unit: string) => void; error: boolean }) {
  if (offered.length) return <NameToggles label={name} options={offered} value={value} onChange={onChange} tall />;
  return <ParamText name={name} placeholder="Unit, as km" error={error} width={150} />;
}

// The query's fields, for a collection's data query or an instance's: a field per query parameter, as fieldSpecs has
// them. Where a value has a grammar it's typed, as it's sent, with its picker under it; a choice of names is toggles.
const QueryFields: React.FC<{ collection: Collection; queryKey: string; queryState: UseQueryUrlReturn; specs: FieldSpec[] }> = ({ collection, queryKey, queryState, specs }) => {
  const {
    selectedFormat, setSelectedFormat,
    selectedParameters, setSelectedParameters,
    vertical, setVertical,
    dimensions, setDimension,
    getEffectiveOutputFormats,
    queryParams, setQueryParam,
    bboxAsCoords, setBboxAsCoords,
    filterByTime, setFilterByTime,
  } = queryState;
  const { radiusUnits, setRadiusUnits } = useMapInteraction();
  const { issues, apiOperation } = useQueryValidation();
  const { selectedFeature } = useCollection();
  const { requestUrl } = useRequestUrl();
  const openDocs = useOpenDocs();
  const queryType = queryTypeOf(collection, queryKey);
  const variables = queryVariables(collection, queryKey);
  const timeIsFilter = timeIsOnlyAFilter(queryType, !!selectedFeature);
  const issuesOf = (id: string) => issues.filter(issue => issue.field === id);
  const hasError = (id: string) => issuesOf(id).some(issue => issue.severity === 'error');
  const hasWarning = (id: string) => issuesOf(id).some(issue => issue.severity === 'warning');
  // Whether the request line has a value for a parameter: a field shows what the server does while it hasn't
  const sent = (name: string) => !!paramOf(requestUrl, name)?.trim();
  const customs = getEffectiveCustomDimensions(collection.extent);
  const typed = (name: string, placeholder: string, width?: number, field = name) => (
    <ParamText name={name} placeholder={placeholder} error={hasError(field)} warning={hasWarning(field)} noted={issuesOf(field).length > 0} width={width} />
  );

  // A field's control, and whether it's empty, for the Left out line
  const valueOf = (spec: FieldSpec): { control: React.ReactNode; empty: boolean } => {
    switch (spec.name) {
      case 'coords':
        return { control: <CoordsValue error={hasError('coords')} warning={hasWarning('coords')} />, empty: !sent('coords') };
      case 'bbox':
        return {
          control: (
            <>
              <ParamText name="bbox" placeholder="west,south,east,north" error={hasError('bbox')} warning={hasWarning('bbox')} />
              <BoxPickers collection={collection} requiredByApiDocs={!!apiOperation?.required.includes('coords')}
                bboxAsCoords={queryType === 'cube' && bboxAsCoords} setBboxAsCoords={setBboxAsCoords} />
            </>
          ),
          empty: !sent('bbox'),
        };
      case 'within':
      case 'corridor-width':
      case 'corridor-height':
        return { control: typed(spec.name, 'A number', 128), empty: !sent(spec.name) };
      case 'limit':
        return { control: typed('limit', 'A number', 160), empty: !sent('limit') };
      case 'within-units':
        return { control: <UnitsValue name="within-units" offered={unitsFor(variables, 'within')} value={radiusUnits} onChange={setRadiusUnits} error={hasError('within-units')} />, empty: !sent('within-units') };
      case 'width-units':
      case 'height-units':
        return {
          control: <UnitsValue name={spec.name} offered={unitsFor(variables, spec.name === 'width-units' ? 'width' : 'height')}
            value={queryParams[spec.name] ?? ''} onChange={unit => setQueryParam(spec.name, unit)} error={hasError(spec.name)} />,
          empty: !sent(spec.name),
        };
      case 'parameter-name':
        return { control: <ParameterSelect collection={collection} chosen={selectedParameters} onChange={setSelectedParameters} error={hasError('parameter-name')} />, empty: selectedParameters.length === 0 };
      case 'datetime':
        return {
          control: (
            <>
              {/* Without a time in the extent there's nothing below to pick from */}
              {typed('datetime', collection.extent?.temporal ? 'Pick a time below, or type one' : 'Type a time, or an interval')}
              {/* A list has everything in it unless filtered by time */}
              {timeIsFilter && collection.extent?.temporal && (
                <FormControlLabel
                  control={<Checkbox size="small" checked={filterByTime} onChange={event => setFilterByTime(event.target.checked)} />}
                  label={<Typography variant="body2">Pick a time to filter {queryType === 'locations' ? 'locations' : collection.itemType === 'record' ? 'records' : 'items'} by</Typography>}
                />
              )}
              {(!timeIsFilter || filterByTime) && collection.extent?.temporal && (
                <Box sx={{ mt: 1 }}><TimeControl temporal={collection.extent.temporal} queryState={queryState} /></Box>
              )}
            </>
          ),
          empty: !sent('datetime'),
        };
      case 'z': {
        const verticalExtent = collection.extent?.vertical;
        const verticalPickable = !!verticalExtent?.values?.length;
        return {
          control: (
            <>
              {typed('z', verticalPickable ? 'Pick levels below, or type them' : 'Type a level, or several')}
              {verticalExtent && (
                <DimensionPicker listed={expandVerticalValues(verticalExtent, 500)} hasValues={!!verticalExtent.values?.length}
                  text={vertical} setText={setVertical} words={LEVEL_WORDS} />
              )}
            </>
          ),
          empty: !sent('z'),
        };
      }
      case 'f':
        return {
          control: <NameToggles label="f" options={getEffectiveOutputFormats(collection, queryKey)} value={selectedFormat} onChange={setSelectedFormat} marked={spec.marked} />,
          empty: !selectedFormat,
        };
      default: {
        const dimension = customs.find(each => each.id === spec.name);
        if (!dimension) return { control: null, empty: true };
        return {
          control: (
            <>
              {typed(dimension.id, dimension.values?.length ? 'Pick values below, or type them' : 'Type a value, or several', undefined, spec.id)}
              <DimensionPicker listed={expandCustomDimensionValues(dimension, 500)} hasValues={!!dimension.values?.length}
                text={dimensions[dimension.id] ?? ''} setText={text => setDimension(dimension.id, text)} words={dimensionWords(dimension.id)} />
            </>
          ),
          empty: !sent(dimension.id),
        };
      }
    }
  };

  return (
    <>
      {specs.map(spec => {
        const { control, empty } = valueOf(spec);
        const unit = spec.unit ? valueOf(spec.unit) : null;
        // A size's issues, then its unit's
        const own = [...issuesOf(spec.id), ...(spec.unit ? issuesOf(spec.unit.id) : [])];
        // How to type it, while there's nothing to read or what's there is wrong
        const grammar = spec.grammar && (empty || own.some(issue => issue.severity === 'error')) ? [spec.grammar] : [];
        return (
          <React.Fragment key={spec.id}>
            <ParamField id={spec.id} title={spec.title} name={spec.unit ? `${spec.name} · ${spec.unit.name}` : spec.name} figure={spec.figure}
              requirement={spec.requirement} missing={own.some(issue => issue.severity === 'missing')} hints={[...spec.hints, ...grammar]} link={spec.link}
              leftOut={spec.leftOut} empty={empty} issues={own} openDocs={openDocs}>
              {spec.unit && unit ? (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                  <Box sx={{ width: 128, flexShrink: 0 }}>{control}</Box>
                  {/* Its own id, for the status line's within-units to jump to */}
                  <Box id={`query-field-${spec.unit.id}`}>{unit.control}</Box>
                </Box>
              ) : control}
            </ParamField>
            {spec.name === 'parameter-name' && lacksTimeAndLevels(collection, specs) && (
              <Typography component="div" sx={{ mt: 1.25, px: 1.25, fontSize: 12, lineHeight: '16px', color: 'text.secondary' }}>
                No <Box component="code" sx={{ fontFamily: 'monospace' }}>datetime</Box> or <Box component="code" sx={{ fontFamily: 'monospace' }}>z</Box>: the
                collection&apos;s extent has no time or levels. To send one anyway, add it under More.
              </Typography>
            )}
          </React.Fragment>
        );
      })}
      <MoreParams collection={collection} queryKey={queryKey} specs={specs} crs={queryParams.crs ?? ''} setCrs={crs => setQueryParam('crs', crs)} />
    </>
  );
};

// parameter-name, until the rows of PR 6: the collection's parameters, searched by typing
function ParameterSelect({ collection, chosen, onChange, error }: { collection: Collection; chosen: string[]; onChange: (parameters: string[]) => void; error: boolean }) {
  return <ParameterPicker parameters={parametersOf(collection)} chosen={chosen} onChange={onChange} error={error} />;
}

// location, a part of the path for a locations query: one of the collection's, from the menu or the map. None lists them
function LocationField() {
  const { locationFeatures, selectedFeature, setSelectedFeature } = useCollection();
  const features = locationFeatures ?? [];
  return (
    <ParamField id="location" title="Location" name="location" path="path" figure={`${features.length} listed`} requirement="optional"
      hints={['From `/locations`, or pick one on the map']} leftOut={`the request lists all ${features.length} locations`} empty={!selectedFeature}>
      <LocationPicker features={features} selected={selectedFeature} onChange={setSelectedFeature} />
    </ParamField>
  );
}

// item, a part of the path for an items query: one item by its id, a record in a Records collection. None lists them
function ItemField({ itemType, itemId, setItemId }: { itemType?: string; itemId: string; setItemId: (item: string) => void }) {
  const word = itemType === 'record' ? 'record' : 'item';
  return (
    <ParamField id="item" title={word === 'record' ? 'Record' : 'Item'} name={word} path="path" requirement="optional"
      hints={[`A${word === 'item' ? 'n' : ''} ${word}'s \`id\`, as in the list's ${word === 'record' ? 'records' : 'features'}`]}
      leftOut={`the request lists the ${word}s`} empty={!itemId}>
      <ItemText word={word} value={itemId} onChange={setItemId} />
    </ParamField>
  );
}

const CollectionQueryBuilder: React.FC<CollectionQueryBuilderProps> = ({ collection, queryState }) => {
  const { selectedDataQuery, selectDataQuery, selectedInstance, instanceQueryKey, selectedParameters, itemId, setItemId, styleId, styleByLink, selectStyle, mapStyles } = queryState;
  const { showMap, isMobile } = usePanes();
  const { leaveQuery } = useOpenCollection();
  const { apiOperation } = useQueryValidation();
  const { selectedFeature } = useCollection();
  const { requestUrl } = useRequestUrl();
  const instanceMode = !!selectedDataQuery && queryTypeOf(collection, selectedDataQuery) === 'instances';
  // What the fields describe: the collection's query, or the picked instance's
  const target = instanceMode
    ? (selectedInstance && instanceQueryKey ? { collection: selectedInstance, queryKey: instanceQueryKey } : null)
    : (selectedDataQuery ? { collection, queryKey: selectedDataQuery } : null);
  const specs = target
    ? fieldSpecs(target.collection, target.queryKey, { parameters: selectedParameters.length }, { apiRequired: apiOperation?.required, hasLocation: !!selectedFeature, hasItem: !!itemId, inRequest: paramsIn(requestUrl).map(([name]) => name) })
    : [];
  const forLocations = !!target && queryTypeOf(target.collection, target.queryKey) === 'locations';
  const forItems = !!target && queryTypeOf(target.collection, target.queryKey) === 'items';
  const forMap = !!target && queryTypeOf(target.collection, target.queryKey) === 'map';
  const shown = new Set(['query', ...(instanceMode ? ['instance', 'instance-query'] : []), ...(forLocations ? ['location'] : []), ...(forItems ? ['item'] : []), ...(forMap ? ['style'] : []), 'crs', ...specs.flatMap(spec => [spec.id, ...(spec.unit ? [spec.unit.id] : [])])]);

  // A query's next step, drawing its geometry, is on the map: beside the form on a desktop. On a phone the coords
  // field's Map button goes there, rather than the pick itself
  const pick = (queryKey: string) => {
    if (!queryKey) {
      leaveQuery();
      return;
    }
    selectDataQuery(collection, queryKey);
    if (!isMobile && mapInputRequired(queryTypeOf(collection, queryKey))) showMap();
  };

  return (
    <>
      {collection.data_queries && (
        <QueryTypeRow queries={Object.keys(collection.data_queries)} value={selectedDataQuery} onChange={pick} offers={collectionOffers(collection)}
          showPath={!(instanceMode && selectedInstance)} />
      )}
      {selectedDataQuery && <QueryStatus shown={shown} />}
      {instanceMode && <InstancePicker queryState={queryState} />}
      {forLocations && <LocationField />}
      {forItems && <ItemField itemType={target.collection.itemType} itemId={itemId} setItemId={setItemId} />}
      {forMap && <StyleField state={mapStyles} styleId={styleId} byLink={styleByLink} onChange={selectStyle} />}
      {target && <QueryFields collection={target.collection} queryKey={target.queryKey} queryState={queryState} specs={specs} />}
    </>
  );
};

export default CollectionQueryBuilder;
