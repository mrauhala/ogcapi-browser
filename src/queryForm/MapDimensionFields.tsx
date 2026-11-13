import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Collection } from '../types/api';
import type { FieldSpec } from '../query/fieldSpecs';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { useApi } from '../contexts/ApiContext';
import { useQueryValidation } from '../hooks/useQueryValidation';
import { paramOf } from '../query/requestUrl';
import { axisBody, isNumber, subsetAxes, subsetIn, unquoted, withAxis } from '../query/subsetText';
import {
  SPATIAL_AXES, TIME_AXES, apiDocsTimeClash, axisChips, declaredAxes, dimensionOf, dimensionValueChips, latestTimeAsked, runAsked, runsUpTo,
  timesFromRun,
} from '../query/mapDimensions';
import { mapOffer, mapProfileNames } from '../query/mapOffer';
import { MAPS1 } from '../standards';
import RuleLinks from '../RuleLinks';
import TimeControl from '../TimeControl';
import NameToggles, { AxisToggles } from './NameToggles';
import { Said } from './ParamField';

// A map's time, levels, model run and subset, as the fields' controls: each writes into the request's subset, axis by
// axis, keeping the rest as typed, or its own parameter. They read the line, so what's typed and not yet left counts

const NOTE_SX = { fontSize: 12, lineHeight: '16px', mt: 0.5, color: 'text.secondary' };
const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <Typography component="div" sx={NOTE_SX}>{children}</Typography>;

// A listed value as the toggles have it: a level typed as 850.0 is the 850 listed
const asListed = (value: string, listed: string[]) => listed.find(option => isNumber(value) && isNumber(option) && Number(option) === Number(value)) ?? value;
const LATEST = { '*': 'Latest' };

// A level or a model run, one at a time, written into subset as vertical(850) or reference_time("…"): a run's toggles
// list only those that can have the time asked, and the one the request has stays, in orange where it isn't listed
export const SubsetAxisValue: React.FC<{ spec: FieldSpec; queryState: UseQueryUrlReturn }> = ({ spec, queryState }) => {
  const { requestUrl } = useRequestUrl();
  const subset = subsetIn(requestUrl);
  const axis = spec.axis ?? '';
  const run = axis === 'reference_time';
  const listed = spec.options ?? [];
  const body = axisBody(subset, axis);
  const value = body === null ? '' : run ? unquoted(body) : asListed(body, listed);
  const runs = run ? listed.filter(option => option !== '*') : [];
  const possible = run ? runsUpTo(runs, latestTimeAsked(queryState.datetime, subset)) : [];
  const options = run ? ['*', ...possible] : listed;
  if (!options.length && !value) return null;
  const write = (picked: string) => queryState.setQueryParam('subset', withAxis(subset, axis, !picked ? null : run && picked !== '*' ? `"${picked}"` : picked));
  return (
    <>
      <NameToggles label={axis} options={options} value={value} onChange={write} labels={run ? LATEST : undefined} />
      {possible.length < runs.length && <Note>Only the runs at or before the time asked: {possible.length} of {runs.length}</Note>}
    </>
  );
};

// The API docs' elevation, typed, with the levels to pick
export const ElevationValue: React.FC<{ spec: FieldSpec; queryState: UseQueryUrlReturn; text: React.ReactNode }> = ({ spec, queryState, text }) => {
  const { requestUrl } = useRequestUrl();
  const listed = spec.options ?? [];
  const typed = paramOf(requestUrl, 'elevation')?.trim() ?? '';
  return (
    <>
      {text}
      {listed.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <NameToggles label="elevation levels" options={listed} value={asListed(typed, listed)} onChange={picked => queryState.setQueryParam('elevation', picked)} />
        </Box>
      )}
    </>
  );
};

// subset as typed, with the axes declared to add over the extent, and the values of the extent's other dimensions. An
// axis that can't go with what the request has isn't offered, and says why; one the text has stays, pressed
export const SubsetValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn; text: React.ReactNode }> = ({ collection, queryState, text }) => {
  const { requestUrl } = useRequestUrl();
  const { conformsTo } = useApi();
  const { apiOperation } = useQueryValidation();
  const subset = subsetIn(requestUrl);
  const subsetCrs = paramOf(requestUrl, 'subset-crs') ?? '';
  const own = ['vertical', 'reference_time'].filter(id => dimensionOf(collection, id));
  const declared = declaredAxes(collection, mapOffer(mapProfileNames(collection), conformsTo, apiOperation?.params ?? null), subsetCrs);
  const { chips, typed } = axisChips(collection, declared, subsetCrs, own);
  const inText = subsetAxes(subset);
  const boxed = ['bbox', 'center'].filter(name => paramOf(requestUrl, name)?.trim());
  const clash = paramOf(requestUrl, 'datetime')?.trim() ? apiDocsTimeClash(apiOperation?.params ?? null) : null;
  const spatialOut = boxed.length ? chips.filter(chip => SPATIAL_AXES.has(chip.axis) && !inText.includes(chip.axis)) : [];
  const timeOut = clash ? chips.filter(chip => chip.axis === 'time' && !inText.includes(chip.axis)) : [];
  const shown = chips.filter(chip => !spatialOut.includes(chip) && !timeOut.includes(chip));
  const values = dimensionValueChips(collection, own);
  const write = (next: string) => queryState.setQueryParam('subset', next);
  const code = (names: string[]) => names.map(name => `\`${name}\``).join(', ');
  return (
    <>
      {text}
      {shown.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          <AxisToggles label="subset axes" options={shown.map(chip => chip.axis)} pressed={inText}
            onToggle={axis => write(withAxis(subset, axis, inText.includes(axis) ? null : shown.find(chip => chip.axis === axis)!.body))} />
        </Box>
      )}
      {values.map(dimension => (
        <Box key={dimension.axis} sx={{ mt: 0.75 }}>
          <Typography component="div" sx={{ ...NOTE_SX, mt: 0, mb: 0.25 }}><Said text={`\`${dimension.axis}\`, one of its values:`} /></Typography>
          <NameToggles label={`${dimension.axis} values`} options={dimension.values} value={axisBody(subset, dimension.axis) ?? ''}
            onChange={picked => write(withAxis(subset, dimension.axis, picked || null))} />
        </Box>
      ))}
      {shown.length > 0 && <Note>Each axis adds itself over the collection&apos;s whole extent, to narrow in the text</Note>}
      {spatialOut.length > 0 && (
        <Note>
          <Said text={`${code(spatialOut.map(chip => chip.axis))} not offered: the request has ${code(boxed)}, and Maps 1.0 asks a 4xx for a spatial axis with ${boxed.length > 1 ? 'either' : 'it'}`} />
          <RuleLinks rule={MAPS1.subsetWithBbox} />
        </Note>
      )}
      {timeOut.length > 0 && clash && <Note><Said text={`\`time\` not offered: the request has \`datetime\`, and the API docs say "${clash.said}"`} /></Note>}
      {typed.length > 0 && <Note><Said text={`Also declared, to type: ${code(typed)}`} /></Note>}
    </>
  );
};

// The time control over the times listed, or only those of the run asked. Where the request has a time in subset that
// the API docs say doesn't go with datetime, there's nothing to pick here until it's taken out
export const MapTimeValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn }> = ({ collection, queryState }) => {
  const { requestUrl } = useRequestUrl();
  const { apiOperation } = useQueryValidation();
  const subset = subsetIn(requestUrl);
  const temporal = collection.extent?.temporal;
  if (!temporal) return null;
  const fromRun = timesFromRun(temporal, runAsked(subset));
  const clash = apiDocsTimeClash(apiOperation?.params ?? null);
  if (clash && !queryState.datetime.trim() && subsetAxes(subset).some(axis => TIME_AXES.includes(axis))) {
    return <Note><Said text={`The request has a time in \`subset\`, and the API docs say "${clash.said}": take it out there to pick one here`} /></Note>;
  }
  return (
    <>
      <Box sx={{ mt: 1 }}><TimeControl temporal={fromRun?.temporal ?? temporal} queryState={queryState} /></Box>
      {fromRun && fromRun.kept < fromRun.of && <Note>Only the times from the run asked on: {fromRun.kept} of {fromRun.of}</Note>}
    </>
  );
};
