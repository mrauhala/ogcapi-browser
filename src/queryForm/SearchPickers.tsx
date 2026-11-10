import { useMemo } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import type { Theme } from '@mui/material/styles';
import type { Feature } from 'geojson';
import { filterParameters, moreCount, NONE, placeOf, placesShown, type NamedParameter, type Place } from './pickerSearch';

// The id as sent in mono, with the label or name beside it
const ROW_TEXT = {
  primary: { sx: { fontFamily: 'monospace', fontSize: 13 } },
  secondary: { sx: { fontSize: 12 } },
};

// parameter-name: the collection's parameters, found by typing any part of an id or a label; the picked ones as chips
export function ParameterPicker({ parameters, chosen, onChange, error }: {
  parameters: NamedParameter[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  error: boolean;
}) {
  // One the collection doesn't list, as from a link, stays, to be seen and taken out
  const options = useMemo(() => {
    const listed = new Set(parameters.map(parameter => parameter.id));
    return [...parameters, ...chosen.filter(id => !listed.has(id)).map(id => ({ id, label: id, words: '', unlisted: true }))];
  }, [parameters, chosen]);
  const value = chosen.map(id => options.find(option => option.id === id)!).filter(Boolean);
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      size="small"
      options={options}
      value={value}
      onChange={(_, picked) => onChange(picked.map(parameter => parameter.id))}
      filterOptions={filterParameters}
      getOptionLabel={parameter => parameter.id}
      isOptionEqualToValue={(option, picked) => option.id === picked.id}
      noOptionsText="No parameter has that in its id or label"
      renderOption={(props, parameter, { selected }) => {
        const { key, ...optionProps } = props;
        return (
          <li key={key} {...optionProps}>
            <Checkbox size="small" checked={selected} sx={{ py: 0, ml: -1 }} />
            <ListItemText primary={parameter.id} secondary={parameter.label !== parameter.id ? parameter.label : undefined} slotProps={ROW_TEXT} />
          </li>
        );
      }}
      renderValue={(picked, getItemProps) => picked.map((parameter, index) => {
        const { key, ...itemProps } = getItemProps({ index });
        return (
          <Chip key={key} size="small" label={parameter.id} {...itemProps}
            sx={{ fontFamily: 'monospace', fontSize: 12.5, ...(parameter.unlisted ? { color: 'warning.main', borderColor: 'warning.main' } : {}) }}
            variant={parameter.unlisted ? 'outlined' : 'filled'} />
        );
      })}
      renderInput={params => (
        <TextField {...params} error={error} placeholder={chosen.length ? 'Type to add' : `Pick from ${parameters.length}, or type to search`}
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, 'aria-label': 'parameter-name' } }} />
      )}
    />
  );
}

// The id typed or picked in mono, the placeholder in the UI's font, so it fits
const LOCATION_INPUT_SX = { fontFamily: 'monospace', '&::placeholder': { fontFamily: (theme: Theme) => theme.typography.fontFamily } };

// location, a part of the path: one of the collection's, found by typing any part of its id or name. None lists them all
export function LocationPicker({ features, selected, onChange }: {
  features: Feature[];
  selected: Feature | null;
  onChange: (feature: Feature | null) => void;
}) {
  const places = useMemo(() => features.map(placeOf), [features]);
  // A location picked on the map or from a link, though the list doesn't have it, still shows
  const value = selected ? places.find(place => place.key === String(selected.id)) ?? placeOf(selected) : null;
  return (
    <Autocomplete
      size="small"
      options={places}
      value={value}
      onChange={(_, place) => onChange(place?.feature ?? null)}
      filterOptions={(_: Place[], { inputValue }) => placesShown(places, inputValue)}
      getOptionLabel={place => (place.name ? `${place.key} · ${place.name}` : place.key)}
      getOptionDisabled={place => moreCount(place) !== null}
      isOptionEqualToValue={(option, picked) => option.key === picked.key}
      noOptionsText="No location has that in its id or name"
      renderOption={(props, place) => {
        const { key, ...optionProps } = props;
        const more = moreCount(place);
        if (more !== null) return <li key={key} {...optionProps}><Box sx={{ fontSize: 12, color: 'text.secondary' }}>{more} more: type to narrow</Box></li>;
        if (place === NONE) return <li key={key} {...optionProps}><Box sx={{ fontSize: 13, color: 'text.secondary' }}>{place.name}</Box></li>;
        return (
          <li key={key} {...optionProps}>
            <ListItemText primary={place.key} secondary={place.name || undefined} slotProps={ROW_TEXT} />
          </li>
        );
      }}
      renderInput={params => (
        <TextField {...params} placeholder="None: list them all, or type to search"
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps?.htmlInput, 'aria-label': 'location', sx: LOCATION_INPUT_SX } }} />
      )}
    />
  );
}
