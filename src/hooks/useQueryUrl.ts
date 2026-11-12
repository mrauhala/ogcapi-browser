import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Collection } from '../DataRetrievalAPI';
import { useMapInteraction } from '../contexts/MapInteractionContext';
import { useCollection } from '../contexts/CollectionContext';
import { useQueryValidationContext } from '../contexts/QueryValidationContext';
import { useOpenApi } from '../contexts/OpenApiContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { buildQueryModel, timeIsOnlyAFilter } from '../query/queryModel';
import { intervalEnds, modeOf, switchMode, withEnd, type DimMode } from '../query/dimensionText';
import { buildQueryUrl } from '../query/buildQueryUrl';
import { matchDataQuery, matchInstance, readQuerySelections, type QuerySelections } from '../query/parseQueryUrl';
import { readableUrl } from '../query/requestUrl';
import { effectiveOutputFormats, keptFormat, queryTypeOf, queryVariables, unitsFor } from '../query/queryTypes';
import { keptUnit } from '../query/units';
import { addApiDocsIssues, validateQuery } from '../query/validateQuery';
import { checkQueryUrlAgainstOpenApi } from '../validation/openapi/checkQueryUrl';
import { useInstances, type InstancesState } from './useInstances';
import { instanceStep, type Instance } from '../query/instances';
import { normalizeHref } from '../utils/href';
import { styleLinkFills, withLinkQueries } from '../query/mapQuery';
import { hasParameterNames } from '../query/mapOffer';
import { apiDocsParams } from '../query/declared';
import { getMapsLinks } from '../api/maps';
import { useMapStyles, type MapStylesState } from './useMapStyles';
import type { QueryIssue } from '../query/types';

// No style: the collection's own map
const NO_STYLE = { id: '', href: '', linked: {} };

// A time range's end as the time control has it: '' where it's open or still to pick
const openEnd = (end: string | undefined) => (end && end !== '..' ? end : '');

export interface UseQueryUrlReturn {
  // Query states
  selectedDataQuery: string;
  setSelectedDataQuery: (q: string) => void;
  selectedFormat: string;
  setSelectedFormat: (f: string) => void;
  selectedParameters: string[];
  setSelectedParameters: (p: string[]) => void;
  // datetime, z and each custom dimension as sent, one text each. The time control shows the datetime in a mode,
  // Single or Range, and switching it keeps the text: see switchMode. z and the dimensions are typed, with a list of
  // their values to pick from.
  datetime: string;
  setDatetime: (text: string) => void;
  datetimeMode: DimMode;
  setDatetimeMode: (mode: DimMode) => void;
  // The time control's view of the datetime: one time, or a range's ends ('' for one open or still to pick).
  // Writing one end keeps the other, and leaves one not picked open.
  selectedDatetime: string;
  setSelectedDatetime: (time: string) => void;
  startDatetime: string;
  setStartDatetime: (time: string) => void;
  endDatetime: string;
  setEndDatetime: (time: string) => void;
  vertical: string;
  setVertical: (text: string) => void;
  dimensions: Record<string, string>;
  setDimension: (id: string, text: string) => void;
  // Parameters of the query type set in their own fields (corridor width and height)
  queryParams: Record<string, string>;
  setQueryParam: (name: string, value: string) => void;
  // Cube: also send the box as coords, for servers whose API docs require coords
  bboxAsCoords: boolean;
  setBboxAsCoords: (value: boolean) => void;
  // Lists (items, a locations query with no location): the time is an optional filter, off unless chosen
  filterByTime: boolean;
  setFilterByTime: (value: boolean) => void;
  // Instances queries: the collection's instances (loaded on demand), the one picked and the query
  // run on it. The query fields then describe the instance.
  instances: InstancesState;
  selectedInstance: Instance | null;
  selectInstance: (id: string) => void;
  instanceQueryKey: string;
  // One item of an items query, a part of its path: '' for the list
  itemId: string;
  setItemId: (item: string) => void;
  // A map query's style, a part of its path ('' for the collection's own map), and the styles to pick from, loaded
  // when the map query is picked
  styleId: string;
  styleByLink: boolean; // asked for by its own map link, as when picked, rather than by the path a typed URL gave
  selectStyle: (styleId: string) => void;
  mapStyles: MapStylesState;
  selectInstanceQuery: (queryKey: string) => void;
  // What is queried: the collection and its query, or the picked instance and the query on it. Null until both are
  queryTarget: { collection: Collection; queryKey: string } | null;
  // Utilities
  resetQueryState: () => void;
  getEffectiveOutputFormats: (collection: Collection, queryType: string) => string[];
  selectDataQuery: (collection: Collection, queryType: string) => void;
  // Put a request URL's values into the form and map, if it's for the open collection. Says after
  // whether they could follow it, which for an instance has to wait for the list of instances.
  applyRequestUrl: (url: string, onResult?: (followed: boolean) => void) => void;
}

export function useQueryUrl(): UseQueryUrlReturn {
  const { clickedCoords, setClickedCoords, selectedArea, setSelectedArea, selectedBbox, setSelectedBbox, radius, setRadius, radiusUnits, setRadiusUnits, dataQuery, setDataQuery } = useMapInteraction();
  const { selectedCollection: openCollection, selectedFeature, setSelectedFeature, locationFeatures, setCollectionUrl } = useCollection();
  // The open collection as the form sees it: a Features or Records collection's items link as an items query, and a
  // Maps collection's map link as a map query
  const selectedCollection = withLinkQueries(openCollection);
  const { editUrl } = useRequestUrl();
  const { setQueryValidation } = useQueryValidationContext();
  const { index: apiIndex } = useOpenApi();

  const [selectedDataQuery, setSelectedDataQuery] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<string>('');
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [datetime, setDatetime] = useState('');
  const [datetimeMode, setDatetimeModeState] = useState<DimMode>('individual');
  const [vertical, setVertical] = useState('');
  const [dimensions, setDimensions] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [bboxAsCoords, setBboxAsCoords] = useState(false);
  const [filterByTime, setFilterByTime] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [instanceQueryKey, setInstanceQueryKey] = useState('');
  const [itemId, setItemId] = useState('');
  // The style picked, and its own map link: '' to go by the path Maps gives a style, as for one from a typed URL. And
  // what its link put in the form's fields, by name, as text: the next style's link replaces those, unless they changed
  const [style, setStyle] = useState<{ id: string; href: string; linked: Record<string, string> }>(NO_STYLE);
  const setQueryParam = useCallback((name: string, value: string) => setQueryParams(params => ({ ...params, [name]: value })), []);

  // A mode switched keeps the text, as far as the other control can hold it
  const setDatetimeMode = useCallback((mode: DimMode) => {
    setDatetimeModeState(mode);
    setDatetime(text => switchMode(text, mode, true));
  }, []);
  const setDimension = useCallback((id: string, text: string) => setDimensions(texts => ({ ...texts, [id]: text })), []);

  // The time control's view of the datetime. Each end is written on what the text has by then, so that writing
  // both ends in a row keeps both. An end not picked is open, as EDR allows for datetime.
  const timeEnds = intervalEnds(datetime);
  const selectedDatetime = datetimeMode === 'individual' && !timeEnds ? datetime : '';
  const startDatetime = datetimeMode === 'range' ? openEnd(timeEnds?.start) : '';
  const endDatetime = datetimeMode === 'range' ? openEnd(timeEnds?.end) : '';
  const setStartDatetime = useCallback((time: string) => setDatetime(text => withEnd(text, 'start', time, true)), []);
  const setEndDatetime = useCallback((time: string) => setDatetime(text => withEnd(text, 'end', time, true)), []);

  const resetQueryState = useCallback(() => {
    setSelectedDataQuery('');
    setSelectedFormat('');
    setSelectedParameters([]);
    setDatetime('');
    setDatetimeModeState('individual');
    setVertical('');
    setDimensions({});
    setQueryParams({});
    setBboxAsCoords(false);
    setFilterByTime(false);
    setSelectedInstanceId('');
    setInstanceQueryKey('');
    setItemId('');
    setStyle(NO_STYLE);
  }, []);

  const getEffectiveOutputFormats = effectiveOutputFormats;

  // What a newly picked query starts from: nothing that wasn't chosen, not even the format the query
  // names as its default. The output format and the radius's unit stay if the new query offers them.
  // Another query type's sizes and units go (a radius goes with the map's query type), and the map
  // hears the query type, which drops geometry the new type can't use. The query is a collection's,
  // or an instance's.
  const applyQueryDefaults = useCallback((collection: Collection, queryKey: string) => {
    setSelectedFormat(current => keptFormat(collection, queryKey, current));
    const queryType = queryKey ? queryTypeOf(collection, queryKey) : '';
    if (queryType !== dataQuery) setQueryParams({});
    if (queryType === 'radius') setRadiusUnits(keptUnit(unitsFor(queryVariables(collection, queryKey), 'within'), radiusUnits));
    setDataQuery(queryType);
  }, [dataQuery, setDataQuery, setRadiusUnits, radiusUnits]);

  // Switch the collection's data query, leaving any instance
  const selectDataQuery = useCallback((collection: Collection, queryKey: string) => {
    setSelectedDataQuery(queryKey);
    setItemId('');
    setStyle(NO_STYLE);
    setSelectedInstanceId('');
    setInstanceQueryKey('');
    applyQueryDefaults(collection, queryKey);
  }, [applyQueryDefaults]);

  // An instances query loads the instances; picking one and a query on it makes a data query
  const instancesHref = selectedCollection && selectedDataQuery && queryTypeOf(selectedCollection, selectedDataQuery) === 'instances'
    ? normalizeHref(selectedCollection.data_queries[selectedDataQuery]?.link?.href)
    : null;
  const instances = useInstances(instancesHref);
  const selectedInstance = instances.instances.find(instance => String(instance.id) === selectedInstanceId) ?? null;

  // A map query loads the collection's styles, to pick one for the path
  const forMap = !!selectedCollection && !!selectedDataQuery && queryTypeOf(selectedCollection, selectedDataQuery) === 'map';
  const stylesHref = selectedCollection ? normalizeHref(getMapsLinks(selectedCollection).stylesLink?.href) : null;
  const mapStyles = useMapStyles(stylesHref, (openCollection as { styles?: unknown } | null)?.styles, forMap);
  // A style picked is asked for by its own map link, as the server gives it: MeteoCore's carries the parameter the style
  // is for. Without one, by the path Maps gives a style. What the link asks for that the form has a field for goes into
  // that field, in place of what the last style's link put there; a value chosen in the field stays
  const selectStyle = useCallback((styleId: string) => {
    const href = mapStyles.styles.find(each => each.id === styleId)?.href ?? '';
    const { fills, linked } = styleLinkFills(href, { 'parameter-name': selectedParameters.join(','), f: selectedFormat }, style.linked);
    if ('parameter-name' in fills) setSelectedParameters(fills['parameter-name'].split(',').map(id => id.trim()).filter(Boolean));
    if ('f' in fills) setSelectedFormat(fills.f);
    setStyle({ id: styleId, href, linked });
  }, [mapStyles.styles, style.linked, selectedParameters, selectedFormat]);

  // Pick an instance, keeping the query if it has one too. A time from another run may lie outside
  // this one, so it goes.
  const selectInstance = useCallback((id: string) => {
    setSelectedInstanceId(id);
    setDatetime('');
    const instance = instances.instances.find(candidate => String(candidate.id) === id);
    if (instance && instanceQueryKey && instance.data_queries?.[instanceQueryKey]) {
      applyQueryDefaults(instance, instanceQueryKey);
    } else {
      setInstanceQueryKey('');
      setDataQuery('instances');
    }
  }, [instances.instances, instanceQueryKey, applyQueryDefaults, setDataQuery]);

  const selectInstanceQuery = useCallback((queryKey: string) => {
    setInstanceQueryKey(queryKey);
    setItemId('');
    if (selectedInstance && queryKey) applyQueryDefaults(selectedInstance, queryKey);
    else setDataQuery('instances');
  }, [selectedInstance, applyQueryDefaults, setDataQuery]);

  // The form and map take on what a request URL says
  const applySelections = useCallback((selections: QuerySelections, queryType: string, hasLocation: boolean) => {
    const { format, parameters, datetime, vertical, customDims, points, polygons, bbox, bboxAsCoords: boxAsCoords } = selections;
    setSelectedFormat(format);
    setSelectedParameters(parameters);
    // Each as written, shown in the mode its form is in: an interval as a range
    setDatetime(datetime);
    setDatetimeModeState(modeOf(datetime));
    if (timeIsOnlyAFilter(queryType, hasLocation)) setFilterByTime(!!datetime);
    setVertical(vertical);
    setDimensions(customDims);
    setClickedCoords(points);
    setSelectedArea(polygons);
    setSelectedBbox(bbox);
    setBboxAsCoords(boxAsCoords);
    // The unit first: changing it converts the radius. What the URL leaves out, the form leaves out.
    setRadiusUnits(selections.radiusUnits ?? '');
    setRadius(selections.radius);
    setQueryParams(params => ({ ...params, ...selections.queryParams }));
  }, [setClickedCoords, setSelectedArea, setSelectedBbox, setRadius, setRadiusUnits]);

  // A location in the URL has to be one of the collection's: undefined if it isn't
  const featureFor = useCallback((locationId: string | undefined) => (
    locationId === undefined ? null : locationFeatures?.find(feature => String(feature.id) === locationId)
  ), [locationFeatures]);

  // The picked instance and query, from a URL for one. A query or location the instance doesn't
  // have leaves the form where it is, with the URL as typed.
  const applyInstanceUrl = useCallback((url: string, instanceId: string, hasQuery: boolean): boolean => {
    const instance = instances.instances.find(candidate => String(candidate.id) === instanceId);
    if (!instance) return false;
    if (!hasQuery) {
      setSelectedInstanceId(instanceId);
      setInstanceQueryKey('');
      setDataQuery('instances');
      return true;
    }
    const target = matchDataQuery(url, instance);
    const feature = target ? featureFor(target.locationId) : undefined;
    if (!target || feature === undefined) return false;
    setSelectedInstanceId(instanceId);
    setInstanceQueryKey(target.queryKey);
    applyQueryDefaults(instance, target.queryKey);
    setSelectedFeature(feature);
    setItemId(target.itemId ?? '');
    applySelections(readQuerySelections(url, instance, target.queryKey), queryTypeOf(instance, target.queryKey), !!feature);
    return true;
  }, [instances.instances, featureFor, applyQueryDefaults, applySelections, setDataQuery, setSelectedFeature]);

  // Whoever applied a URL hears how it went once the form has published the URL it now builds: until
  // then other URLs can pass by, like the map panel's on opening a collection with a map. State, not
  // a ref, so that it comes with the form's new values, however early the effect applying it ran.
  const [applied, setApplied] = useState<{ onResult?: (followed: boolean) => void; followed: boolean } | null>(null);

  // A URL for an instance waits for the list of instances, which picking the instances query loads
  const urlAwaitingInstances = useRef<{ url: string; instanceId: string; hasQuery: boolean; onResult?: (followed: boolean) => void } | null>(null);
  useEffect(() => {
    const waiting = urlAwaitingInstances.current;
    if (!waiting || (instances.status !== 'ready' && instances.status !== 'error')) return;
    urlAwaitingInstances.current = null;
    const followed = instances.status === 'ready' && applyInstanceUrl(waiting.url, waiting.instanceId, waiting.hasQuery);
    // Moving to the list on the way there replaced the URL
    editUrl(waiting.url);
    setApplied({ onResult: waiting.onResult, followed });
  }, [instances.status, applyInstanceUrl, editUrl]);

  const applyRequestUrl = useCallback((url: string, onResult?: (followed: boolean) => void) => {
    if (!selectedCollection) {
      setApplied({ onResult, followed: false });
      return;
    }

    const instance = matchInstance(url, selectedCollection);
    if (instance) {
      if (selectedDataQuery === instance.queryKey && instances.status === 'ready') {
        setApplied({ onResult, followed: applyInstanceUrl(url, instance.instanceId, instance.hasQuery) });
      } else {
        urlAwaitingInstances.current = { url, instanceId: instance.instanceId, hasQuery: instance.hasQuery, onResult };
        selectDataQuery(selectedCollection, instance.queryKey);
      }
      return;
    }

    const target = matchDataQuery(url, selectedCollection);
    const feature = target ? featureFor(target.locationId) : undefined;
    if (!target || feature === undefined) {
      setApplied({ onResult, followed: false });
      return;
    }
    if (target.queryKey !== selectedDataQuery || selectedInstanceId) selectDataQuery(selectedCollection, target.queryKey);
    if (feature !== selectedFeature) setSelectedFeature(feature);
    setItemId(target.itemId ?? '');
    // By its path: what a typed URL asks for besides is in the line already
    setStyle({ ...NO_STYLE, id: target.styleId ?? '' });
    applySelections(readQuerySelections(url, selectedCollection, target.queryKey), queryTypeOf(selectedCollection, target.queryKey), !!feature);
    setApplied({ onResult, followed: true });
  }, [selectedCollection, selectedDataQuery, selectedInstanceId, selectedFeature, instances.status, featureFor, selectDataQuery, setSelectedFeature, applyInstanceUrl, applySelections]);

  // Selecting a location (on the map, in the Location Features list or via search) switches the
  // query to `locations`, so the request targets that location
  useEffect(() => {
    if (!selectedFeature) return;
    // Inside an instance the location is queried through the instance's own locations query
    if (selectedInstance) {
      const instanceLocations = Object.keys(selectedInstance.data_queries ?? {}).find(q => q.toLowerCase() === 'locations');
      if (instanceLocations && instanceQueryKey !== instanceLocations) selectInstanceQuery(instanceLocations);
      return;
    }
    if (!selectedCollection?.data_queries) return;
    const locationsQuery = Object.keys(selectedCollection.data_queries).find(q => q.toLowerCase() === 'locations');
    if (locationsQuery && selectedDataQuery !== locationsQuery) {
      selectDataQuery(selectedCollection, locationsQuery);
    }
    // Only a new selection switches the query, not the user picking another query afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFeature]);

  // What is queried: the collection's data query, or in an instances query the picked instance's
  const target = useMemo(() => {
    if (instancesHref) return selectedInstance && instanceQueryKey ? { collection: selectedInstance, queryKey: instanceQueryKey } : null;
    return selectedCollection && selectedDataQuery ? { collection: selectedCollection, queryKey: selectedDataQuery } : null;
  }, [instancesHref, selectedInstance, instanceQueryKey, selectedCollection, selectedDataQuery]);

  // The data query as one model: it builds the request URL and is validated
  const queryModel = useMemo(() => {
    if (!target) return null;
    const queryType = queryTypeOf(target.collection, target.queryKey);
    // A time chosen for another query doesn't carry over to a list, unless it's filtered by time
    const timeIsFilter = timeIsOnlyAFilter(queryType, !!selectedFeature);
    // A location's href points at the collection's locations; an instance's is addressed by id
    const locationFeature = queryType !== 'locations' || !selectedFeature ? null
      : instancesHref ? { id: selectedFeature.id } : selectedFeature;
    return buildQueryModel({
      collection: target.collection,
      queryKey: target.queryKey,
      format: selectedFormat,
      parameters: selectedParameters,
      datetime: timeIsFilter && !filterByTime ? '' : datetime,
      vertical,
      customDims: dimensions,
      points: clickedCoords,
      polygons: selectedArea,
      bbox: selectedBbox,
      bboxAsCoords,
      radius: { value: radius, units: radiusUnits },
      queryParams,
      locationFeature,
      itemId,
      styleId: style.id,
      styleHref: style.href,
      styles: queryType === 'map' ? mapStyles.styles : undefined,
    });
  }, [
    target, instancesHref, selectedFormat, selectedParameters,
    datetime, filterByTime, vertical,
    dimensions, clickedCoords, selectedArea, selectedBbox, bboxAsCoords, radius, radiusUnits, queryParams, selectedFeature, itemId, style,
    mapStyles.styles,
  ]);

  // Publish the request URL and what the query is still missing, adding the API docs' view once
  // the service's API definition is loaded
  useEffect(() => {
    let url: string | null = null;
    let issues: QueryIssue[] = [];
    if (queryModel) {
      url = buildQueryUrl(queryModel);
      if (url) issues = validateQuery(queryModel);
    } else if (instancesHref) {
      ({ url, issues } = instanceStep(instancesHref, selectedInstance));
    }
    if (!url) {
      setQueryValidation(null);
      return;
    }
    url = readableUrl(url);
    setCollectionUrl(url);
    const apiDocs = apiIndex ? checkQueryUrlAgainstOpenApi(url, apiIndex) : null;
    const operation = apiDocs?.operation?.entry;
    setQueryValidation({
      url,
      issues: apiDocs ? addApiDocsIssues(queryModel, issues, apiDocs) : issues,
      apiOperation: operation ? {
        template: operation.template,
        pointer: operation.pointer,
        required: operation.params.filter(param => param.in === 'query' && param.required).map(param => param.name),
        params: apiDocsParams(operation.params),
      } : null,
      declaring: queryModel?.queryType === 'map' ? { query: 'map', parameterNames: hasParameterNames(queryModel.collection) } : null,
    });
  }, [queryModel, instancesHref, selectedInstance, apiIndex, setCollectionUrl, setQueryValidation]);

  // After the effect above, for the URL to be out by now
  useEffect(() => {
    if (!applied) return;
    setApplied(null);
    applied.onResult?.(applied.followed);
  }, [applied]);

  return {
    selectedDataQuery, setSelectedDataQuery,
    selectedFormat, setSelectedFormat,
    selectedParameters, setSelectedParameters,
    datetime, setDatetime,
    datetimeMode, setDatetimeMode,
    selectedDatetime, setSelectedDatetime: setDatetime,
    startDatetime, setStartDatetime,
    endDatetime, setEndDatetime,
    vertical, setVertical,
    dimensions, setDimension,
    queryParams, setQueryParam,
    bboxAsCoords, setBboxAsCoords,
    filterByTime, setFilterByTime,
    instances, selectedInstance, selectInstance,
    instanceQueryKey, selectInstanceQuery,
    itemId, setItemId,
    styleId: style.id, styleByLink: !!style.href, selectStyle, mapStyles,
    queryTarget: target,
    resetQueryState,
    getEffectiveOutputFormats,
    selectDataQuery,
    applyRequestUrl,
  };
}
