import React from 'react';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import Alert from '@mui/material/Alert';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Select from '@mui/material/Select';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import { Collection, expandVerticalValues, expandCustomDimensionValues, getEffectiveCustomDimensions } from './DataRetrievalAPI';
import { UseQueryUrlReturn } from './hooks/useQueryUrl';
import TimeControl from './TimeControl';
import QueryIssuesPanel, { FieldIssueText } from './QueryIssuesPanel';
import QueryTypeInputs from './QueryTypeInputs';
import InstancePicker from './InstancePicker';
import { queryTypeOf, queryVariables, unitsFor } from './query/queryTypes';
import { EDR_QUERY_RULES, mapInputRequired } from './query/edrRules';
import { levelChoice, pickedLevels, startsRepeating, unlistedReason } from './query/levels';
import { intervalEnds, withEnd, type DimMode } from './query/dimensionText';
import type { QueryIssue } from './query/types';
import { timeIsOnlyAFilter } from './query/queryModel';
import { useCollection } from './contexts/CollectionContext';
import { useOpenCollection } from './contexts/OpenCollectionContext';
import { usePanes } from './contexts/PanesContext';
import { useQueryValidation } from './hooks/useQueryValidation';

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
  fieldId: string; // after query-field-, which the issues jump to: z, or dim:<id>
  legend: string;
  listed: string[]; // the values the collection lists
  hasValues: boolean; // listed as values, rather than worked out from an interval
  text: string;
  setText: (text: string) => void;
  mode: DimMode;
  setMode: (mode: DimMode) => void;
  issue?: QueryIssue;
  words: DimensionWords;
}> = ({ fieldId, legend, listed, hasValues, text, setText, mode, setMode, issue, words }) => {
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
    <Box sx={{ mb: 2 }} id={`query-field-${fieldId}`}>
      <FormLabel component="legend" sx={{ fontSize: '0.875rem', mb: 1 }}>{legend}</FormLabel>

      {tooMany && (
        <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
          <Typography variant="caption">{words.large(listed.length)}</Typography>
        </Alert>
      )}

      <FormControl component="fieldset" sx={{ mb: 1 }}>
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

      <FieldIssueText issue={issue} />
    </Box>
  );
};

// The query's fields, for a collection's data query or an instance's: everything below the query pick
const QueryFields: React.FC<{ collection: Collection; queryKey: string; queryState: UseQueryUrlReturn }> = ({ collection, queryKey, queryState }) => {
  const {
    selectedFormat, setSelectedFormat,
    selectedParameters, setSelectedParameters,
    vertical, setVertical, verticalMode, setVerticalMode,
    dimensions, setDimension, dimensionModes, setDimensionMode,
    getEffectiveOutputFormats,
    queryParams, setQueryParam,
    bboxAsCoords, setBboxAsCoords,
    filterByTime, setFilterByTime,
  } = queryState;

  const { issues } = useQueryValidation();
  // The most important issue about a field, to show under it
  const fieldIssue = (field: string) => issues.find(issue => issue.field === field && issue.severity !== 'info');
  // A feature list (items) takes no parameters, levels or custom dimensions
  const selectsData = !(queryKey && EDR_QUERY_RULES[queryTypeOf(collection, queryKey)]?.featureList);
  const { selectedFeature } = useCollection();
  const queryType = queryKey ? queryTypeOf(collection, queryKey) : '';
  const timeIsFilter = timeIsOnlyAFilter(queryType, !!selectedFeature);
  // Units of z a query declares (cube height_units); a corridor's height units belong to its height
  const zUnits = queryKey && queryTypeOf(collection, queryKey) !== 'corridor'
    ? unitsFor(queryVariables(collection, queryKey), 'height')
    : [];

  return (
    <>
      <QueryTypeInputs collection={collection} queryKey={queryKey} queryParams={queryParams} setQueryParam={setQueryParam}
        bboxAsCoords={bboxAsCoords} setBboxAsCoords={setBboxAsCoords} />

      {/* Format Selector */}
      {(() => {
        const effectiveFormats = getEffectiveOutputFormats(collection, queryKey);
        return effectiveFormats.length > 0 && (
          <FormControl fullWidth sx={{ mb: 2 }} id="query-field-f" error={fieldIssue('f')?.severity === 'error'}>
            <InputLabel id="format-select-label">Output Format</InputLabel>
            <Select
              labelId="format-select-label"
              value={selectedFormat}
              label="Output Format"
              onChange={(e) => {
                setSelectedFormat(e.target.value);
              }}
              size="small"
            >
              <MenuItem value="">
                <em>Select a format</em>
              </MenuItem>
              {effectiveFormats.map((format) => (
                <MenuItem key={format} value={format}>
                  {format}
                </MenuItem>
              ))}
              {/* From a typed URL: flagged below, and shown so that the field doesn't look empty */}
              {selectedFormat && !effectiveFormats.includes(selectedFormat) && (
                <MenuItem value={selectedFormat}>{selectedFormat}</MenuItem>
              )}
            </Select>
            <FieldIssueText issue={fieldIssue('f')} />
          </FormControl>
        );
      })()}

      {/* Parameter Selector - Multiselect */}
      { selectsData && typeof collection.parameter_names !== "undefined" && (
        <FormControl fullWidth sx={{ mb: 2 }} id="query-field-parameter-name" error={fieldIssue('parameter-name')?.severity === 'error'}>
          <InputLabel id="parameter-select-label">Parameters</InputLabel>
          <Select
            labelId="parameter-select-label"
            multiple
            value={selectedParameters}
            label="Parameters"
            onChange={(e) => {
              const parameters = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
              setSelectedParameters(parameters);
            }}
            size="small"
            renderValue={(selected) => selected.join(', ')}
          >
            {Array.isArray(collection.parameter_names)
              ? collection.parameter_names.map((param) => (
                  <MenuItem key={param.id} value={param.id}>
                    <Checkbox checked={selectedParameters.indexOf(param.id) > -1} />
                    <ListItemText primary={param.label || param.id} />
                  </MenuItem>
                ))
              : Object.keys(collection.parameter_names || {}).map((paramKey) => {
                  const params = collection.parameter_names as { [key: string]: any };
                  return (
                    <MenuItem key={paramKey} value={paramKey}>
                      <Checkbox checked={selectedParameters.indexOf(paramKey) > -1} />
                      <ListItemText primary={params[paramKey]?.description || paramKey} />
                    </MenuItem>
                  );
                })
            }
          </Select>
          <FieldIssueText issue={fieldIssue('parameter-name')} />
        </FormControl>
      )}

      {/* A list has everything in it unless filtered by time */}
      {timeIsFilter && collection.extent?.temporal && (
        <FormControlLabel
          sx={{ mb: 1 }}
          control={<Checkbox size="small" checked={filterByTime} onChange={event => setFilterByTime(event.target.checked)} />}
          label={<Typography variant="body2">Filter {queryType === 'locations' ? 'locations' : 'items'} by time</Typography>}
        />
      )}

      {/* Datetime Selector — TimeControl with slider + transport buttons */}
      {collection.extent?.temporal && (!timeIsFilter || filterByTime) && (
        <Box id="query-field-datetime">
          <TimeControl temporal={collection.extent.temporal} queryState={queryState} />
          <FieldIssueText issue={fieldIssue('datetime')} />
        </Box>
      )}

      {/* z and the custom dimensions, OGC API Maps UAD dimensions among them (top-level extent keys) */}
      {selectsData && collection.extent?.vertical && (() => {
        const verticalExtent = collection.extent.vertical;
        const hasValues = !!verticalExtent.values && verticalExtent.values.length > 0;
        const hasInterval = !!verticalExtent.interval && verticalExtent.interval.length > 0;
        return (hasValues || hasInterval) ? (
          <DimensionField
            fieldId="z"
            legend={`Vertical Level Selection${zUnits.length > 0 ? ` (${zUnits.join(', ')})` : ''}`}
            listed={expandVerticalValues(verticalExtent, 500)}
            hasValues={hasValues}
            text={vertical}
            setText={setVertical}
            mode={verticalMode}
            setMode={setVerticalMode}
            issue={fieldIssue('z')}
            words={LEVEL_WORDS}
          />
        ) : null;
      })()}

      {selectsData && getEffectiveCustomDimensions(collection.extent).map((dimension) => {
        const dimensionId = dimension.id;
        const hasValues = !!dimension.values && dimension.values.length > 0;
        const hasInterval = !!dimension.interval && dimension.interval.length > 0;
        return (hasValues || hasInterval) ? (
          <DimensionField
            key={dimensionId}
            fieldId={`dim:${dimensionId}`}
            legend={`${dimension.id} Selection ${dimension.reference ? `(${dimension.reference})` : ''}`}
            listed={expandCustomDimensionValues(dimension, 500)}
            hasValues={hasValues}
            text={dimensions[dimensionId] ?? ''}
            setText={text => setDimension(dimensionId, text)}
            mode={dimensionModes[dimensionId] ?? 'individual'}
            setMode={mode => setDimensionMode(dimensionId, mode)}
            issue={fieldIssue(`dim:${dimensionId}`)}
            words={dimensionWords(dimensionId, dimension.reference)}
          />
        ) : null;
      })}
    </>
  );
};

const CollectionQueryBuilder: React.FC<CollectionQueryBuilderProps> = ({ collection, queryState }) => {
  const { selectedDataQuery, selectDataQuery, selectedInstance, instanceQueryKey } = queryState;
  const { showMap } = usePanes();
  const { leaveQuery } = useOpenCollection();
  const instanceMode = !!selectedDataQuery && queryTypeOf(collection, selectedDataQuery) === 'instances';
  // What the fields describe: the collection's query, or the picked instance's
  const target = instanceMode
    ? (selectedInstance && instanceQueryKey ? { collection: selectedInstance, queryKey: instanceQueryKey } : null)
    : (selectedDataQuery ? { collection, queryKey: selectedDataQuery } : null);

  return (
    <>
      {/* Data Query Selector */}
      { typeof collection.data_queries !== "undefined" && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="data-query-select-label">Data Query</InputLabel>
          <Select
            labelId="data-query-select-label"
            value={selectedDataQuery}
            label="Data Query"
            onChange={(e) => {
              if (!e.target.value) {
                leaveQuery();
                return;
              }
              selectDataQuery(collection, e.target.value);
              // Its next step, drawing the query's geometry, happens on the map
              if (mapInputRequired(queryTypeOf(collection, e.target.value))) showMap();
            }}
            size="small"
          >
            <MenuItem value="">
              <em>Select a data query</em>
            </MenuItem>
            {Object.keys(collection.data_queries).map((queryKey) => (
              <MenuItem key={queryKey} value={queryKey}>
                {queryKey}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {instanceMode && <InstancePicker queryState={queryState} />}
      {selectedDataQuery && <QueryIssuesPanel />}
      {target && <QueryFields collection={target.collection} queryKey={target.queryKey} queryState={queryState} />}
    </>
  );
};

export default CollectionQueryBuilder;
