import React from 'react';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
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
import { intervalEnds, withEnd, type DimMode } from './query/dimensionText';
import { collectionOffers, fieldSpecs, type FieldSpec } from './query/fieldSpecs';
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
import { BoxFields, NumberField } from './queryForm/ValueInputs';
import { LocationPicker, ParameterPicker } from './queryForm/SearchPickers';
import { parametersOf } from './queryForm/pickerSearch';

interface CollectionQueryBuilderProps {
  collection: Collection;
  queryState: UseQueryUrlReturn;
}

// What a dimension field calls its parts: z's levels, or a custom dimension's values
interface DimensionWords {
  large: (count: number) => string; // why it's a text field: too many values to list
  individual: string;
  range: string;
  select: string; // the dropdown of the values listed
  selectId: string;
  start: string;
  startId: string;
  end: string;
  endId: string;
  text: string; // the text field, for what the dropdowns can't hold
  placeholder: string;
  helper: string;
  endHelper: string; // under a range's ends typed
  unlisted: (value: string) => string; // why a value shown isn't one of those listed
}

const LEVEL_WORDS: DimensionWords = {
  large: count => `This collection has a large vertical range (${count} values, limit: 250). Using text input for easier selection.`,
  individual: 'Individual Levels',
  range: 'Level Range',
  select: 'Select Levels',
  selectId: 'vertical-select-label',
  start: 'Start Level',
  startId: 'start-vertical-label',
  end: 'End Level',
  endId: 'end-vertical-label',
  text: 'Vertical Levels',
  placeholder: 'e.g. 1000, or 1000,850,500',
  helper: 'A level, several separated by commas, a range as 1000/500, or R3/500/100 for 3 steps of 100 from 500',
  endHelper: 'Enter a numeric value',
  unlisted: unlistedReason,
};

const dimensionWords = (id: string, reference?: string): DimensionWords => ({
  large: count => `This dimension has a large range (${count} values, limit: 250). Using text input for easier selection.`,
  individual: 'Individual Values',
  range: 'Range',
  select: 'Select Values',
  selectId: `${id}-select-label`,
  start: 'Start Value',
  startId: `start-${id}-label`,
  end: 'End Value',
  endId: `end-${id}-label`,
  text: 'Values',
  placeholder: 'Enter value',
  helper: reference ? `Unit: ${reference}` : 'A value, or several separated by commas',
  endHelper: reference ? `Unit: ${reference}` : '',
  unlisted: () => "Not one of the dimension's values",
});

const MONO = { primary: { style: { fontSize: '0.85rem', fontFamily: 'monospace' } } };

// z or a custom dimension: its text as sent, shown by the mode's control. One value or several from a dropdown, or a
// range's two ends. What a dropdown can't hold, a repeating interval, a range in the one-value mode or a list in the
// range mode, is shown as it's sent, in a text field. Switching the mode keeps the text (switchMode).
const DimensionField: React.FC<{
  listed: string[]; // the values the collection lists
  hasValues: boolean; // listed as values, rather than worked out from an interval
  text: string;
  setText: (text: string) => void;
  mode: DimMode;
  setMode: (mode: DimMode) => void;
  words: DimensionWords;
}> = ({ listed, hasValues, text, setText, mode, setMode, words }) => {
  const tooMany = listed.length > 250;
  const listable = hasValues && !tooMany;
  const ends = intervalEnds(text);
  const asText = (helper: string) => (
    <TextField label={words.text} value={text} onChange={event => setText(event.target.value)} fullWidth size="small"
      placeholder={words.placeholder} helperText={helper} />
  );

  // One value or several, sent as a list in the collection's order. Any not among its own, as from a link, show
  // first, so that they can be taken out
  const valuesSelect = () => {
    const { chosen, unlisted } = levelChoice(text, listed);
    return (
      <FormControl fullWidth>
        <InputLabel id={words.selectId}>{words.select}</InputLabel>
        <Select
          labelId={words.selectId}
          multiple
          value={chosen}
          label={words.select}
          onChange={(event) => {
            const picked = typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value;
            setText(pickedLevels(picked, listed));
          }}
          renderValue={(selected) => selected.join(', ')}
          size="small"
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

  // A range's end: the other end stays as it is, and one still to pick is left empty
  const setEnd = (which: 'start' | 'end', value: string) => setText(withEnd(text, which, value));
  const endSelect = (which: 'start' | 'end') => {
    const { chosen, unlisted } = levelChoice(ends?.[which] ?? '', listed);
    const label = which === 'start' ? words.start : words.end;
    const id = which === 'start' ? words.startId : words.endId;
    return (
      <FormControl fullWidth size="small">
        <InputLabel id={id}>{label}</InputLabel>
        <Select
          labelId={id}
          value={chosen[0] ?? ''}
          label={label}
          onChange={(event) => setEnd(which, event.target.value)}
          MenuProps={{ slotProps: { paper: { style: { maxHeight: 300 } } } }}
        >
          <MenuItem value="">
            <em>Select {label.toLowerCase()}</em>
          </MenuItem>
          {[...unlisted, ...listed].map((value) => (
            <MenuItem key={value} value={value}>
              <ListItemText primary={value} secondary={unlisted.includes(value) ? words.unlisted(value) : undefined} slotProps={MONO} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  };
  const endField = (which: 'start' | 'end') => (
    <TextField
      label={which === 'start' ? words.start : words.end}
      value={ends?.[which] ?? ''}
      onChange={(event) => setEnd(which, event.target.value)}
      fullWidth
      size="small"
      placeholder={`Enter ${(which === 'start' ? words.start : words.end).toLowerCase()}`}
      helperText={words.endHelper}
    />
  );

  return (
    <Box>
      {tooMany && (
        <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
          <Typography variant="caption">{words.large(listed.length)}</Typography>
        </Alert>
      )}

      <FormControl component="fieldset" sx={{ mb: 0.5 }}>
        <RadioGroup row value={mode} onChange={(event) => setMode(event.target.value as DimMode)} sx={{ gap: 2 }}>
          <FormControlLabel value="individual" control={<Radio size="small" />} label={<Typography variant="body2">{words.individual}</Typography>} />
          <FormControlLabel value="range" control={<Radio size="small" />} label={<Typography variant="body2">{words.range}</Typography>} />
        </RadioGroup>
      </FormControl>

      {mode === 'individual' && (listable && !ends && !startsRepeating(text) ? valuesSelect() : asText(words.helper))}

      {mode === 'range' && (ends || !text.trim() ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {listable ? <>{endSelect('start')}{endSelect('end')}</> : <>{endField('start')}{endField('end')}</>}
        </Box>
      ) : asText('Not a range of two ends, so shown as it is sent'))}
    </Box>
  );
};

// The WKT as sent, read-only until PR 5 makes it typed; the map writes it. On a phone the map is a pane away: Map
// goes there, since picking a query no longer does
function CoordsValue({ text, missing }: { text: string; missing: boolean }) {
  const { isMobile, showMap } = usePanes();
  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'stretch' }}>
      <Box
        sx={{
          flex: 1, minWidth: 0, minHeight: { xs: 40, sm: 36 }, px: 1.25, py: 0.75, display: 'flex', alignItems: 'center',
          border: 1, borderStyle: missing ? 'dashed' : 'solid', borderColor: missing ? 'warning.main' : 'divider', borderRadius: 1,
          fontFamily: text ? 'monospace' : undefined, fontSize: 13, overflowWrap: 'anywhere', color: text ? 'text.primary' : 'text.disabled',
        }}
      >
        {text || 'Draw on the map'}
      </Box>
      {isMobile && <Button variant="outlined" onClick={showMap} sx={{ flexShrink: 0, textTransform: 'none' }}>Map</Button>}
    </Box>
  );
}

// A unit, right after its number: toggles of those the query lists, or text where it lists none
function UnitsValue({ name, offered, value, onChange, error }: { name: string; offered: string[]; value: string; onChange: (unit: string) => void; error: boolean }) {
  if (offered.length) return <NameToggles label={name} options={offered} value={value} onChange={onChange} tall />;
  return (
    <TextField id={`query-input-${name}`} size="small" value={value} error={error} placeholder="Unit, as km" sx={{ width: 150 }}
      onChange={event => onChange(event.target.value)} slotProps={{ htmlInput: { sx: { fontFamily: 'monospace' } } }} />
  );
}

// The query's fields, for a collection's data query or an instance's: a field per query parameter, as fieldSpecs has
// them, each with today's control inside
const QueryFields: React.FC<{ collection: Collection; queryKey: string; queryState: UseQueryUrlReturn; specs: FieldSpec[] }> = ({ collection, queryKey, queryState, specs }) => {
  const {
    selectedFormat, setSelectedFormat,
    selectedParameters, setSelectedParameters,
    datetime,
    vertical, setVertical, verticalMode, setVerticalMode,
    dimensions, setDimension, dimensionModes, setDimensionMode,
    getEffectiveOutputFormats,
    queryParams, setQueryParam,
    bboxAsCoords, setBboxAsCoords,
    filterByTime, setFilterByTime,
  } = queryState;
  const { radius, setRadius, radiusUnits, setRadiusUnits, selectedBbox } = useMapInteraction();
  const { issues, apiOperation } = useQueryValidation();
  const { selectedFeature } = useCollection();
  const { requestUrl } = useRequestUrl();
  const openDocs = useOpenDocs();
  const queryType = queryTypeOf(collection, queryKey);
  const variables = queryVariables(collection, queryKey);
  const timeIsFilter = timeIsOnlyAFilter(queryType, !!selectedFeature);
  const issuesOf = (id: string) => issues.filter(issue => issue.field === id);
  const hasError = (id: string) => issuesOf(id).some(issue => issue.severity === 'error');
  // What's sent, for what only the map writes: the request line, so a link's coords show as it has them
  const sent = (() => {
    try {
      return new URL(requestUrl).searchParams;
    } catch {
      return new URLSearchParams();
    }
  })();
  const customs = getEffectiveCustomDimensions(collection.extent);
  const number = (name: string) => {
    const text = queryParams[name]?.trim() ?? '';
    return text === '' || !isFinite(Number(text)) ? null : Number(text);
  };

  // A field's control, and whether it's empty, for the Left out line
  const valueOf = (spec: FieldSpec): { control: React.ReactNode; empty: boolean } => {
    const missing = issuesOf(spec.id).some(issue => issue.severity === 'missing');
    switch (spec.name) {
      case 'coords':
        return { control: <CoordsValue text={sent.get('coords') ?? ''} missing={missing} />, empty: !sent.get('coords') };
      case 'bbox':
        return {
          control: <BoxFields collection={collection} error={hasError('bbox')} requiredByApiDocs={!!apiOperation?.required.includes('coords')}
            bboxAsCoords={queryType === 'cube' && bboxAsCoords} setBboxAsCoords={setBboxAsCoords} />,
          empty: !selectedBbox,
        };
      case 'within':
        return { control: <NumberField id="query-input-within" value={radius} onChange={setRadius} error={hasError('within')} placeholder="A number" />, empty: radius === null };
      case 'within-units':
        return { control: <UnitsValue name="within-units" offered={unitsFor(variables, 'within')} value={radiusUnits} onChange={setRadiusUnits} error={hasError('within-units')} />, empty: !radiusUnits };
      case 'corridor-width':
      case 'corridor-height':
      case 'limit':
        return {
          control: <NumberField id={`query-input-${spec.name}`} value={number(spec.name)} error={hasError(spec.name)} placeholder="A number"
            onChange={value => setQueryParam(spec.name, value === null ? '' : String(value))} />,
          empty: !queryParams[spec.name]?.trim(),
        };
      case 'width-units':
      case 'height-units':
        return {
          control: <UnitsValue name={spec.name} offered={unitsFor(variables, spec.name === 'width-units' ? 'width' : 'height')}
            value={queryParams[spec.name] ?? ''} onChange={unit => setQueryParam(spec.name, unit)} error={hasError(spec.name)} />,
          empty: !queryParams[spec.name]?.trim(),
        };
      case 'parameter-name':
        return { control: <ParameterSelect collection={collection} chosen={selectedParameters} onChange={setSelectedParameters} error={hasError('parameter-name')} />, empty: selectedParameters.length === 0 };
      case 'datetime':
        return {
          control: (
            <>
              {/* A list has everything in it unless filtered by time */}
              {timeIsFilter && (
                <FormControlLabel
                  control={<Checkbox size="small" checked={filterByTime} onChange={event => setFilterByTime(event.target.checked)} />}
                  label={<Typography variant="body2">Filter {queryType === 'locations' ? 'locations' : 'items'} by time</Typography>}
                />
              )}
              {(!timeIsFilter || filterByTime) && collection.extent?.temporal && <TimeControl temporal={collection.extent.temporal} queryState={queryState} />}
            </>
          ),
          empty: !datetime || (timeIsFilter && !filterByTime),
        };
      case 'z': {
        const verticalExtent = collection.extent!.vertical!;
        return {
          control: <DimensionField listed={expandVerticalValues(verticalExtent, 500)} hasValues={!!verticalExtent.values?.length}
            text={vertical} setText={setVertical} mode={verticalMode} setMode={setVerticalMode} words={LEVEL_WORDS} />,
          empty: !vertical,
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
          control: <DimensionField listed={expandCustomDimensionValues(dimension, 500)} hasValues={!!dimension.values?.length}
            text={dimensions[dimension.id] ?? ''} setText={text => setDimension(dimension.id, text)}
            mode={dimensionModes[dimension.id] ?? 'individual'} setMode={mode => setDimensionMode(dimension.id, mode)}
            words={dimensionWords(dimension.id, dimension.reference)} />,
          empty: !dimensions[dimension.id],
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
        return (
          <ParamField key={spec.id} id={spec.id} title={spec.title} name={spec.unit ? `${spec.name} · ${spec.unit.name}` : spec.name} figure={spec.figure}
            requirement={spec.requirement} missing={own.some(issue => issue.severity === 'missing')} hints={spec.hints} link={spec.link}
            leftOut={spec.leftOut} empty={empty} issues={own} openDocs={openDocs}>
            {spec.unit && unit ? (
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ width: 128, flexShrink: 0 }}>{control}</Box>
                {/* Its own id, for the status line's within-units to jump to */}
                <Box id={`query-field-${spec.unit.id}`}>{unit.control}</Box>
              </Box>
            ) : control}
          </ParamField>
        );
      })}
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

const CollectionQueryBuilder: React.FC<CollectionQueryBuilderProps> = ({ collection, queryState }) => {
  const { selectedDataQuery, selectDataQuery, selectedInstance, instanceQueryKey, selectedParameters } = queryState;
  const { showMap, isMobile } = usePanes();
  const { leaveQuery } = useOpenCollection();
  const { apiOperation } = useQueryValidation();
  const { selectedFeature } = useCollection();
  const instanceMode = !!selectedDataQuery && queryTypeOf(collection, selectedDataQuery) === 'instances';
  // What the fields describe: the collection's query, or the picked instance's
  const target = instanceMode
    ? (selectedInstance && instanceQueryKey ? { collection: selectedInstance, queryKey: instanceQueryKey } : null)
    : (selectedDataQuery ? { collection, queryKey: selectedDataQuery } : null);
  const specs = target
    ? fieldSpecs(target.collection, target.queryKey, { parameters: selectedParameters.length }, { apiRequired: apiOperation?.required, hasLocation: !!selectedFeature })
    : [];
  const forLocations = !!target && queryTypeOf(target.collection, target.queryKey) === 'locations';
  const shown = new Set(['query', ...(instanceMode ? ['instance', 'instance-query'] : []), ...(forLocations ? ['location'] : []), ...specs.flatMap(spec => [spec.id, ...(spec.unit ? [spec.unit.id] : [])])]);

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
      {target && <QueryFields collection={target.collection} queryKey={target.queryKey} queryState={queryState} specs={specs} />}
    </>
  );
};

export default CollectionQueryBuilder;
