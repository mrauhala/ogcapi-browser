import React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import type { UseQueryUrlReturn } from './hooks/useQueryUrl';
import type { Instance } from './query/instances';
import { queryTypeOf } from './query/queryTypes';
import { mapInputRequired } from './query/edrRules';
import { usePanes } from './contexts/PanesContext';
import ParamField from './queryForm/ParamField';
import QueryTypeRow from './queryForm/QueryTypeRow';

const idOf = (instance: Instance) => String(instance.id);

// An instances query: pick an instance (e.g. a model run, latest first; lists can hold hundreds) and the query to run
// on it, both parts of the path
const InstancePicker: React.FC<{ queryState: UseQueryUrlReturn }> = ({ queryState }) => {
  const { instances, selectedInstance, selectInstance, instanceQueryKey, selectInstanceQuery } = queryState;
  const { showMap, isMobile } = usePanes();
  const figure = instances.status === 'ready' ? `${instances.instances.length} listed, latest first`
    : instances.status === 'loading' ? 'Loading instances…' : undefined;
  const failed = instances.status === 'error'
    ? [{ id: 'instances:error', severity: 'error' as const, source: 'edr' as const, field: 'instance', message: `Couldn't load the instances: ${instances.error}` }]
    : [];

  return (
    <>
      <ParamField id="instance" title="Instance" name="instance" path="path" figure={figure} requirement="optional"
        leftOut="the request lists the instances" empty={!selectedInstance} issues={failed}>
        <Autocomplete
          size="small"
          options={instances.instances}
          value={selectedInstance}
          loading={instances.status === 'loading'}
          loadingText="Loading instances…"
          noOptionsText={instances.status === 'error' ? "Couldn't load the instances" : 'No instances'}
          getOptionLabel={idOf}
          isOptionEqualToValue={(option, value) => idOf(option) === idOf(value)}
          onChange={(_, instance) => selectInstance(instance ? idOf(instance) : '')}
          renderOption={(props, instance) => {
            const { key, ...optionProps } = props;
            return (
              <li key={key} {...optionProps}>
                <ListItemText primary={idOf(instance)} secondary={instance.title && instance.title !== idOf(instance) ? instance.title : undefined} />
              </li>
            );
          }}
          renderInput={params => (
            <TextField {...params} placeholder="Pick an instance"
              slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, 'aria-label': 'instance', sx: { fontFamily: 'monospace' } } }} />
          )}
        />
      </ParamField>
      {selectedInstance && (
        <QueryTypeRow
          id="instance-query"
          title="Query on the instance"
          queries={Object.keys(selectedInstance.data_queries ?? {})}
          value={instanceQueryKey}
          onChange={queryKey => {
            selectInstanceQuery(queryKey);
            if (!isMobile && queryKey && mapInputRequired(queryTypeOf(selectedInstance, queryKey))) showMap();
          }}
        />
      )}
    </>
  );
};

export default InstancePicker;
