// What typing in the Parameters and Location fields finds. Pure, for the pickers in SearchPickers.tsx
import { createFilterOptions } from '@mui/material/Autocomplete';
import type { Feature } from 'geojson';
import type { Collection } from '../types/api';
import { parameterLabel } from '../utils/coverageTimeSeries';
import { i18nText } from '../utils/i18nText';

export interface NamedParameter {
  id: string;
  label: string; // shown beside the id: the parameter's own label, else its observed property's
  words: string; // what typing matches besides the id: every label the metadata has
  unlisted?: boolean; // from a link, not among the collection's
}

// A parameter as the picker shows it, and every label typing can find it by
export function namedParameter(id: string, parameter: { label?: unknown; observedProperty?: { label?: unknown }; description?: unknown } | null | undefined): NamedParameter {
  const labels = [parameter?.label, parameter?.observedProperty?.label].map(i18nText).filter((label): label is string => !!label?.trim());
  return { id, label: parameterLabel(id, parameter ?? undefined), words: labels.join(' ') };
}

// A collection's parameters as the picker shows them, from either form parameter_names takes
export function parametersOf(collection: Collection): NamedParameter[] {
  const parameters = collection.parameter_names;
  return Array.isArray(parameters)
    ? parameters.map(parameter => namedParameter(String(parameter.id), parameter))
    : Object.entries(parameters ?? {}).map(([id, parameter]) => namedParameter(id, parameter));
}

// Any part of the id or of a label, ignoring case
export const filterParameters = createFilterOptions<NamedParameter>({ stringify: parameter => `${parameter.id} ${parameter.words}` });

export interface Place {
  key: string; // the id as sent, or a row that isn't a place (NONE, or the count of those not shown)
  name: string;
  feature: Feature | null;
}

// Shown at most, of the matches: a list of thousands is found by typing, not scrolled
export const SHOWN = 200;
export const NONE: Place = { key: ':none', name: 'None: list them all', feature: null };
const MORE = ':more:';

// A location as the picker shows it: its id, and its name, label or title where that says more than the id
export function placeOf(feature: Feature): Place {
  const key = String(feature.id);
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const named = [properties.name, properties.label, properties.title].find(each => typeof each === 'string' && each.trim());
  const name = typeof named === 'string' ? named.trim() : '';
  return { key, name: name === key ? '' : name, feature };
}

// The rows the list shows for what's typed: None first while nothing is, the matches by any part of the id or the name
// ignoring case, at most SHOWN of them, and then how many more there are
export function placesShown(places: Place[], typed: string): Place[] {
  const text = typed.trim().toLowerCase();
  const matches = text ? places.filter(place => place.key.toLowerCase().includes(text) || place.name.toLowerCase().includes(text)) : places;
  const more = matches.length > SHOWN ? [{ key: `${MORE}${matches.length - SHOWN}`, name: '', feature: null }] : [];
  return [...(text ? [] : [NONE]), ...matches.slice(0, SHOWN), ...more];
}

// The count a "more" row stands for, null for any other row
export const moreCount = (place: Place): number | null => (place.key.startsWith(MORE) ? Number(place.key.slice(MORE.length)) : null);
