import type { Citation, EdrRule, Rule } from './types/api';

// The rules findings rest on, to cite beside them in Checks. Each links to the statement itself, by the id the
// standard's HTML gives each paragraph, and the label names the section or requirement it's in. Every quote below is
// copied from the published text; src/__fixtures__/standardAnchors.json holds the ids each text has, and a test checks
// every link against it.

// ---- CoverageJSON 1.0 (OGC 21-069r2), a Community Standard ----
// No tests of its own, only its schema, and no names for its rules: a rule is cited by its section, linked to its
// paragraph
const COVERAGEJSON = 'https://docs.ogc.org/cs/21-069r2/21-069r2.html';
const para = (number: string, anchor: string): Rule => ({ label: `CoverageJSON ${number}`, url: `${COVERAGEJSON}#${anchor}` });

export const COVJSON = {
  // "In order to conform to this OGC Community Standard, a software implementation shall implement any CoverageJSON
  // object as a valid JSON object that conforms to the CoverageJSON schema."
  conformance: para('2', '_397e615d-ae83-1f47-ad61-0515fec3a557'),
  // "An i18n object represents a string in multiple languages where each key is a language tag as defined in BCP 47,
  // and the value is the string in that language."
  i18n: para('9.2', '_c5797c6f-10cd-b50d-e060-70792ff644fb'),
  // "A parameter object MAY have a member with the name "label" where the value MUST be an i18n object that is the name
  // of the parameter and which SHOULD be short. Note that this SHOULD be left out if it would be identical to the
  // "label" of the "observedProperty" member."
  label: para('9.3', '_d3e52e28-d374-4ead-6732-fda610a256ee'),
  // "A parameter object MAY have a member with the name "unit" … "type" references the unit serialization scheme that is
  // used. "type" MUST HAVE the value
  // "http://www.opengis.net/def/uom/UCUM/" if UCUM is used, or a custom value as recommended in section Extensions. …
  // It is RECOMMENDED to reference a unit serialization scheme to allow automatic unit conversion."
  unit: para('9.3', '_83acb4e1-2d29-6b17-4197-ef1cd3afea64'),
  // "If a Coverage conforms to one of the defined domain types then the coordinate identifier "x" is used to denote
  // geodetic longitude, "y" is used for geodetic latitude and "z" for ellipsoidal height."
  geographicAxes: para('9.5.1.1', '_4f935897-88a3-1164-e32a-95389c897c84'),
  // "A temporal RS object MUST have a member "type". The only currently defined value of it is "TemporalRS"."
  temporalRsType: para('9.5.2', '_29ad7d6c-543c-9b81-31b1-2c572070cc3d'),
  // "A temporal RS object MUST have a member "calendar" with value "Gregorian" or a URI."
  calendar: para('9.5.2', '_047098cc-a6d3-197b-1520-b9677775cf47'),
  // "If the time scale is UTC, the "timeScale" member MUST be omitted."
  timeScale: para('9.5.2', '_838ef48c-26c2-02c3-6fdb-5273ca63a25b'),
  // "If the calendar is based on years, months, days, then the referenced values SHOULD use one of the following
  // ISO8601-based lexical representations:"
  timeFormsShould: para('9.5.2', '_e5d3145b-867a-9f98-c75e-cb067d039404'),
  // "If "type" is "TemporalRS" and "calendar" is "Gregorian", then the above lexical representation MUST be used."
  timeFormsMust: para('9.5.2', '_c751ecac-903b-511e-6ed5-f830c1059ff1'),
  // "A domain object MUST have a "referencing" member if the domain object is not part of a coverage collection or if
  // the coverage collection does not have a "referencing" member."
  referencing: para('9.6.1', '_44f7cd26-de06-3452-1096-1f64b88012f8'),
  // "… then the array values in "values", if existing, MUST be ordered monotonically, that is, increasing or decreasing."
  monotonic: para('9.6.1.1', '_1284a2fe-77c6-4f27-072d-271dc4ab8263'),
  // "A reference system connection object MUST have a member "coordinates" which has as value an array of coordinate
  // identifiers that are referenced in this object. Depending on the type of referencing, the ordering of the identifiers
  // MAY be relevant, e.g. for 2D/3D coordinate reference systems. In this case, the order of the identifiers MUST match
  // the order of axes in the coordinate reference system."
  referencedAxes: para('9.6.1.2', '_cfa3cdd4-f025-594b-3ad5-e2fc9d5fd1e6'),
  // ""shape" … For >= 1D arrays it MUST be included."
  shape: para('9.6.2', '_89f0d9a2-28e0-144e-b116-977e133811c3'),
  // "Where "shape" is present and non-empty, the product of its values MUST equal the number of elements in the
  // "values" array."
  shapeProduct: para('9.6.2', '_e957e7e4-d9f3-e50a-a764-cf86decdea10'),
  // ""axisNames" where the value is an array of strings of the same length as "shape" … For >= 1D arrays it MUST be
  // included."
  axisNames: para('9.6.2', '_4455d3ce-56d1-c298-0b25-7f656e0a4f1f'),
  // "The shape and axis names of each NdArray or TiledNdArray object MUST correspond to the domain axes defined by
  // "domain", while single-valued axes MAY be omitted."
  rangesFitDomain: para('9.6.4', '_53cdeb99-83b5-7e97-ca29-b8f6db01c789'),
  // "The custom value of those members SHOULD be either an absolute URI or a compact URI." Those members include "type"
  // in reference system objects and in unit symbol objects
  customValue: para('9.7.2', '_7a3c07e7-6175-fefd-8de1-b248b3fd128b'),
  // "The axis and coordinate identifiers "x" and "y" MUST refer to horizontal spatial coordinates, "z" to vertical
  // spatial coordinates, and all of "x", "y", and "z" MUST be referenced by a spatial coordinate reference system."
  spatialReferenced: para('9.10', '_df667d6b-8d20-f16a-41ee-b953dff55f72'),
  // "The axis and coordinate identifier "t" MUST refer to temporal coordinates and be referenced by a temporal reference
  // system."
  timeReferenced: para('9.10', '_fb1dc8bf-3bff-1039-207e-fe958d4f63dd'),
  // "If a spatial CRS is used that has the axes longitude and latitude, or easting and northing, then the axis and
  // coordinate identifier "x" MUST refer to longitude / easting, and "y" to latitude / northing."
  xIsLongitude: para('9.10', '_f18f060f-bd8e-276e-9598-6fa4d2ac4a9f'),
  // "The axis "composite" MUST have the data type "tuple" and the coordinate identifiers "x","y","z" or "x","y", in
  // that order." (MultiPointSeries, then MultiPoint)
  multiPointSeriesComposite: para('9.10.5', '_2a95c2b3-b927-cb25-b3dd-5f478297baeb'),
  multiPointComposite: para('9.10.6', '_05606d99-c8bf-852f-5468-4be41299e5e8'),
  // "The value ordering of the axis "composite" MUST follow the ordering of its "t" coordinate as defined in the
  // corresponding reference system." (Trajectory, then Section)
  trajectoryOrder: para('9.10.7', '_b3e98657-ee8c-f966-5f93-d1955ea2e25b'),
  sectionOrder: para('9.10.8', '_e0131c4a-3302-45e0-d035-b1e9c8773f14'),
  // "The CoverageJSON media type SHALL be application/vnd.cov+json with an optional parameter profile …"
  mediaType: para('10', '_a3c30e19-0a25-7b38-0647-52211a7cee81'),
  // "The only profile URI defined in this document is https://covjson.org/def/core#standalone which asserts that all
  // domain and range objects are directly embedded in a CoverageJSON document and not referenced by URLs."
  standalone: para('10', '_7eea7547-bd3c-1954-d39d-bfa9e0ea5ea7'),
};

// ---- OGC API – EDR 1.1 (OGC 19-086r6) and 1.2 (OGC 19-086r9), both published ----
// A requirement is cited by its id and the statement's letter, linked to the statement, with its Abstract Test Suite
// test where it has one of its own. 1.1 tests each query parameter's rule once per query type, so those name no test
const EDR_1_1 = 'https://docs.ogc.org/is/19-086r6/19-086r6.html';
const EDR_1_2 = 'https://docs.ogc.org/is/19-086r9/19-086r9.html';
// A requirement's id and its statement's letter, as the label gives them ('/req/edr/rc-collection-info G')
const statementOf = (requirement: string): Pick<Rule, 'requirement' | 'statement'> => {
  const [id, letter] = requirement.split(' ');
  if (!id.startsWith('/req/')) return {};
  return letter && letter.length === 1 && letter >= 'A' && letter <= 'Z' ? { requirement: id, statement: letter } : { requirement: id };
};
const edr11 = (requirement: string, anchor: string, test?: string): Rule => ({ label: `EDR 1.1 ${requirement}${test ? `, test ${test}` : ''}`, url: `${EDR_1_1}#${anchor}`, ...statementOf(requirement) });
const edr12 = (requirement: string, anchor: string, test?: string): Rule => ({ label: `EDR 1.2 ${requirement}${test ? `, test ${test}` : ''}`, url: `${EDR_1_2}#${anchor}`, ...statementOf(requirement) });

export const EDR11 = {
  // A: "The server SHALL support the HTTP GET operation at the path /."
  rootOpA: edr11('/req/core/root-op A', '_2a5d88a1-9842-c517-77e5-500d4e61e35f', 'B.2'),
  // A: "A successful execution of the operation SHALL be reported as a response with an HTTP status code 200."
  rootSuccessA: edr11('/req/core/root-success A', '_8b64b7a8-e877-c31f-fe1f-4aec5f76525e', 'B.3'),
  // B: "The content of that response SHALL be based upon the OpenAPI 3.0 schema landingPage.yaml and include at least
  // links to the following resources: the API definition (relation type service-desc or service-doc) · /conformance
  // (relation type conformance) · /collections (relation type data)". Its links are cited by their own items
  rootSuccessB: edr11('/req/core/root-success B', '_561a5766-09e6-f724-854b-e54ebe76a52e', 'B.3'),
  rootConformanceLink: edr11('/req/core/root-success B', '_b178d3e5-22c3-9914-4007-ad3dadc85b19', 'B.3'),
  rootDataLink: edr11('/req/core/root-success B', '_29825e54-fc2c-6738-6879-3fb32ca8a2e2', 'B.3'),
  // A: 200. B: "The content of that response SHALL be an API Definition document."
  apiDefinitionSuccessA: edr11('/req/core/api-definition-success A', '_1b4e270c-bfb3-0e66-2bc0-e90c4f753d93', 'B.5'),
  apiDefinitionSuccessB: edr11('/req/core/api-definition-success B', '_5838504f-cb77-9381-9cb1-95efc84ad8e8', 'B.5'),
  // A: 200. B: "The content of that response SHALL be based upon the schema confClasses.yaml and list all OGC API
  // conformance classes that the API conforms to."
  conformanceSuccessA: edr11('/req/core/conformance-success A', '_4a6feebb-dc3d-2356-4a17-7575b295a08b', 'B.7'),
  conformanceSuccessB: edr11('/req/core/conformance-success B', '_4a4640bd-fbe1-9cc3-ea29-09ee6155b5d1', 'B.7'),
  // A: 200. B: "The content of that response SHALL be based upon the schema collections.yaml."
  collectionsSuccessA: edr11('/req/collections/rc-md-success A', '_f4feeccd-73f3-12ec-2073-94497c2d622d', 'B.10'),
  collectionsSuccessB: edr11('/req/collections/rc-md-success B', '_bb033ef4-99d9-0a2e-b958-2e4ebfbb883c', 'B.10'),
  // "For each spatial resource collection, the extent property, if provided, SHALL provide bounding boxes that include
  // all spatial geometries and time intervals that include all temporal geometries in this collection."
  extent: edr11('/req/core/rc-extent A', '_257a3019-f56d-88a8-7456-9a7ff54b0a64', 'B.13'),
  // A: "Every Collection within a collections array SHALL have a unique (within the array) id parameter." B, C, D:
  // "… SHOULD have a title parameter", "a description parameter", "a Keywords parameter …". E, F, G: "… SHALL have a
  // links parameter", "an extent parameter", "a crs parameter", each "which SHALL comply with" its own requirement.
  // J: "… SHALL have an f parameter containing an array of values which describe the output formats supported by the
  // collection." K: "… SHALL have a parameter_names attribute …"
  collectionInfoA: edr11('/req/edr/rc-collection-info A', '_674fd343-1b0b-33e1-a4fd-a3213ccb3fdf', 'B.14'),
  collectionInfoB: edr11('/req/edr/rc-collection-info B', '_19d324f8-1d68-b78a-fec0-855c8207a5f0', 'B.14'),
  collectionInfoC: edr11('/req/edr/rc-collection-info C', '_f9903d1f-fc9a-a226-1494-2f40de71160b', 'B.14'),
  collectionInfoD: edr11('/req/edr/rc-collection-info D', '_db109fca-70c1-2d4e-5d78-693d1c53b8c6', 'B.14'),
  collectionInfoE: edr11('/req/edr/rc-collection-info E', '_d2fa9d40-25e8-3eda-bbd6-8de49938898b', 'B.14'),
  collectionInfoF: edr11('/req/edr/rc-collection-info F', '_dd7c5ea8-a393-0a55-7a41-a866ebeb6397', 'B.14'),
  collectionInfoG: edr11('/req/edr/rc-collection-info G', '_cc84e334-575b-9abb-00d8-cebaa6853637', 'B.14'),
  collectionInfoJ: edr11('/req/edr/rc-collection-info J', '_477d4e07-fd11-92c5-da35-b992da3e8165', 'B.14'),
  collectionInfoK: edr11('/req/edr/rc-collection-info K', '_6308eaf5-9942-6dfb-adc0-c96204a43b7d', 'B.14'),
  // D: "A parameter object MAY have a member with the name “label” where the value SHALL be an i18n object that is the
  // name of the parameter …". H: "… “type” SHALL HAVE the value “http://www.opengis.net/def/uom/UCUM/” if UCUM is used"
  parameterLabel: edr11('/req/edr/rc-parameters D', '_bfec6919-edcd-b6d3-55d3-779ed750812b', 'B.24'),
  parameterUnit: edr11('/req/edr/rc-parameters H', '_acabc863-01f8-8945-2fe7-86814637140c', 'B.24'),
  // A: "If the datetime parameter is provided, only resources that have a temporal geometry that intersects the
  // temporal information in the datetime parameter SHALL be part of the result set."
  datetimeResponse: edr11('/req/core/datetime-response A', '_59cff66f-5182-e0b2-50c6-d3e40a6cc844'),
  // D: "The temporal information is either a date-time or a time interval. The parameter value SHALL conform to the
  // following syntax (using ABNF): interval-closed = date-time "/" date-time · interval-open-start = "../" date-time ·
  // interval-open-end = date-time "/.." …". E: "The syntax of date-time is specified by RFC 3339, 5.6."
  datetimeSyntax: edr11('/req/core/datetime-response D', '_68e9ebb5-7396-47ba-56ef-9e997bb18b2b'),
  datetimeRfc3339: edr11('/req/core/datetime-response E', '_160e82cf-e82b-7144-0ab2-845cf6bf460d'),
  // How z is written, each with no keyword: B "The z can be defined as a height range by specifying a min-level and
  // max-level separated by a forward slash "/"", C "A list of z can be defined be specifying a comma delimited list of
  // values level1, level2, level3 etc", D "An Arithmetic sequence using Recurring height intervals can be specified by
  // Rnumber of intervals/min height/height interval"
  zRange: edr11('/req/edr/z-response B', '_669d718f-5b33-59c8-8dfe-ff13a2f33626'),
  zList: edr11('/req/edr/z-response C', '_7ea1afab-2a7f-5ee9-e5b7-1ed348c53b9a'),
  zRepeating: edr11('/req/edr/z-response D', '_83dbb348-3297-b631-47fd-1d8b4020c79e'),
  // A bbox: D "The bounding box is provided as four or six numbers …: Lower left corner, coordinate axis 1 · Lower left
  // corner, coordinate axis 2 · … · Upper right corner, coordinate axis 1 · …", with no keyword; H "The coordinate values
  // SHALL be within the extent specified for the coordinate reference system."
  bboxCorners: edr11('/req/core/rc-bbox-response D', '_a7d3f6b2-979a-bd3d-9939-20add7d27bc2'),
  bboxWithinCrs: edr11('/req/core/rc-bbox-response H', '_e7214197-a2aa-929a-cd1c-3581afe32967'),
  // B: "The coordinates SHALL consist of a Well Known Text (WKT) POLYGON or (if supported by the collection)
  // MULTIPOLYGON geometry string."
  polygonCoords: edr11('/req/edr/polygon-coords-response B', '_5065ab1c-19d9-dd77-3718-5d3f019330ae'),
  // B: "The crs parameter SHALL consist of an identifier selected from the enumerated list of valid values supplied in
  // the collections metadata."
  crsResponseB: edr11('/req/edr/REQ_rc-crs-response B', '_1a07dd12-933c-b6ed-87c1-28f097cf121b'),
  // A: "If the z parameter is provided, only resources that have a vertical geometry that intersects the vertical
  // information in the z parameter SHALL be part of the result set." E: "If the z parameter is not provided, the server
  // SHOULD return data at all available vertical levels"
  zResponse: edr11('/req/edr/z-response A', '_05c014b7-76ff-2c78-4710-6ca05ddccbf1'),
  zAllLevels: edr11('/req/edr/z-response E', '_5406561c-0742-a189-74ba-5c811f8fedf6'),
  // B: "The parameter-name parameter SHALL consist of a comma delimited string value based on an enumerated list of
  // options listed in the collections metadata."
  parameterNameResponseB: edr11('/req/edr/parameter-name-response B', '_d2f6fcfe-d79e-2007-d61b-f4abb890bf55'),
  // A: "Each resource collection operation SHALL support a parameter f with the following characteristics …"
  fDefinition: edr11('/req/edr/rc-f-definition A', '_b14d18f2-6d04-8462-5364-5ae77c801b49'),
  // B: "The f parameter SHALL consist of a string value based on an enumerated list of available options provided in
  // the collections metadata."
  fResponseB: edr11('/req/edr/REQ_rc-f-response B', '_cf6da47c-4a66-e0a9-f143-496224c0d199'),
  // B: "A within-units value SHALL be one of the values defined in the instance metadata:" and its fragment, "name:
  // within-units / in: query / required: false / schema: type: string"
  withinUnitsDefinition: edr11('/req/edr/within-units-definition B', '_e66cddad-9b4d-93bf-2ec7-cb48e6588081'),
  // A: "Each corridor resource collection operation SHALL support a parameter width-units (height-units) with the
  // following characteristics", "required: true / schema: type: string"
  widthUnitsDefinition: edr11('/req/edr/REQ_rc-width-units-definition A', '_00c6d33e-6242-24b8-5822-76f29fde1897', 'B.145'),
  heightUnitsDefinition: edr11('/req/edr/REQ_rc-height-units-definition A', '_a08ab6fc-33da-a026-b0ab-fc057ec197a6', 'B.147'),
  // A: "Every 200-response with the media type application/geo+json SHALL be an EDR GeoJSON FeatureCollection Object
  // for features, and an EDR GeoJSON Feature Object for a single feature."
  edrGeojsonContent: edr11('/req/edr-geojson/content A', '_9313c3a3-4052-2886-70fe-1cec2ce54acc', 'B.30'),
  // A: "Every 200-response with the media type application/geo+json SHALL be a GeoJSON FeatureCollection Object for
  // features, and a GeoJSON Feature Object for a single feature." Of the GeoJSON class, which asks for no EDR properties
  geojsonContent: edr11('/req/geojson/content A', '_b3763635-d562-1859-8dde-d15308e413d0', 'B.28'),
  // A: "200-responses of the server SHALL support the following media types: application/geo+json for resources that
  // include feature content, and application/json for all other resources." Linked to its first item
  edrGeojsonDefinition: edr11('/req/edr-geojson/definition A', '_24f95235-539d-85dc-dac2-eec77558a62f', 'B.29'),
  // The GeoJSON class's, word for word the same
  geojsonDefinition: edr11('/req/geojson/definition A', '_d85cfec7-3540-0e2a-dcbb-088deca1ec93', 'B.27'),
  // A: "Every 200-response with the media type application/prs.coverage+json SHALL be a CoverageJSON Object"
  // B: "The schema of all responses with the media type application/prs.coverage+json SHALL conform with the JSON
  // Schema specified for the resource in the Core requirements class."
  covjsonContentA: edr11('/req/covjson/content A', '_4c9f2de0-0c09-ada3-0da2-f881dc8f2d0a', 'B.32'),
  covjsonContentB: edr11('/req/covjson/content B', '_077c5d22-1d00-3385-8c1c-22e60e28a87a', 'B.32'),
  // A: "200-responses of the server SHALL support the following media types: application/prs.coverage+json for
  // resources that include data content, and application/json for all other resources." Linked to its first item
  covjsonDefinition: edr11('/req/covjson/definition A', '_da8d1d16-17c3-6009-f1e9-d07ea6096a7e', 'B.31'),
  // A: "The JSON representation SHALL conform to the OpenAPI Specification, version 3.0."
  oas30Definition: edr11('/req/oas30/oas-definition-2 A', '_9005f4b9-c9b2-b009-2d56-6120c5936338', 'B.38'),
  // "If the server is intended to be accessed from the browser, cross-origin requests SHOULD be supported."
  crossOrigin: edr11('Recommendation 3', '_c72da0e4-d0a5-6e55-fdfb-133d87a0c674'),
  // Annex C (informative), the Temporal Object's values: "An array of ISO 8601 datestrings which details the time
  // intervals available in the collection, each member of the array can either be a single time, an ISO 8601 time
  // interval or an ISO 8601 time duration"
  temporalValues: edr11('Annex C.7 (informative)', '_8f4c9f38-bc6a-4b98-8fd9-772e42d60ab2'),
  // The Locations query, in the clause's text: "If a location id is not defined the API SHALL return a GeoJSON features
  // array of valid location identifiers, the schema of the GeoJSON response SHOULD be defined in the OpenAPI definition"
  locationsQuery: edr11('8.2.8', '_76907fac-bf01-f4f3-6672-cbc8f25486c0'),
  // D: "If a locationId is not specified a list of valid locationId’s SHALL be returned with a description of their
  // geospatial extent."
  locationsList: edr11('/req/edr/rc-locations D', '_784daa3f-2230-d6c2-626b-30bd13ba9256', 'B.159'),
  // What each query type's GET operation "SHALL include" (or, for some, "MUST include"): "A position GET or POST
  // operation SHALL include a coords query parameter", "A radius GET or POST operation MUST include a within-units
  // query parameter", "A cube GET or POST operation SHALL include a z query parameter", …
  positionCoords: edr11('/req/queries/position D', '_4cf82899-a56a-e0ce-da7d-d06d6bfbac6a'),
  areaCoords: edr11('/req/edr/rc-area D', '_052c1f6c-3f51-15aa-c8da-d184b5fe5842'),
  trajectoryCoords: edr11('/req/edr/rc-trajectory D', '_f52298bf-1280-743b-f2f0-81e20c97e660'),
  radiusCoords: edr11('/req/queries/radius D', '_c819b4dc-596e-0d23-7802-c45ae6dbdc30'),
  radiusWithin: edr11('/req/queries/radius F', '_a13766f9-0d63-0e4b-a30a-347cddcc6035'),
  radiusWithinUnits: edr11('/req/queries/radius H', '_d9915e95-659d-1af5-ed1a-b768ae4b90a0'),
  cubeBbox: edr11('/req/edr/rc-cube D', '_1c93a974-fd28-f076-a476-ec247d6c88cc'),
  cubeZ: edr11('/req/edr/rc-cube G', '_25231992-983f-999a-e67a-6fe913290aba'),
  corridorCoords: edr11('/req/edr/rc-corridor D', '_4d3b192a-3135-2ffd-3767-9698e1ef76aa'),
  corridorWidth: edr11('/req/edr/rc-corridor F', '_b0f6183e-1b2f-9b8c-88fd-d4e411687ff1'),
  corridorHeight: edr11('/req/edr/rc-corridor H', '_fdcd499d-7441-c077-6504-0257462bd7c8'),
  corridorWidthUnits: edr11('/req/edr/rc-corridor J', '_58017117-57f4-fe3a-c03d-683d6a43c4f2'),
  corridorHeightUnits: edr11('/req/edr/rc-corridor M', '_3f6fca65-ce13-3910-328a-13ff8fce1cc2'),
  // L, O: "If the width-units [height-units] query parameter value is not one of the supported values a HTTP 400 error
  // should be generated"
  corridorWidthUnitsUnsupported: edr11('/req/edr/rc-corridor L', '_44ede6eb-f916-c610-117f-1ccef8744dbb'),
  corridorHeightUnitsUnsupported: edr11('/req/edr/rc-corridor O', '_534096a2-9648-0fd3-4483-e0fbc640579f'),
  // The items query: "If an itemId is not specified, the query will return a list of the available itemId's. This
  // behavior is specified in OGC API — Features. All other parameters for use with the Items query are defined by OGC API
  // — Features." Its table lists bbox, datetime and limit
  itemsParameters: edr11('8.2.7.1', '_26b0e263-d85c-2d79-0aeb-f0a33ec85841'),
};

export const EDR12 = {
  // As in 1.1
  rootOpA: edr12('/req/core/root-op A', '_06509f8d-1fa6-965d-46cf-faa57d300424', 'B.2'),
  rootSuccessA: edr12('/req/core/root-success A', '_b4b2eb29-a3cc-271a-bfb3-e082499388d8', 'B.3'),
  rootSuccessB: edr12('/req/core/root-success B', '_fdf8ce8b-2e96-d412-325e-360181ae5a2b', 'B.3'),
  rootConformanceLink: edr12('/req/core/root-success B', '_19df1cce-4c2f-1039-f659-7a0a4f52abb9', 'B.3'),
  rootDataLink: edr12('/req/core/root-success B', '_f1075e8f-92cf-1800-c347-8c58ddb1304d', 'B.3'),
  apiDefinitionSuccessA: edr12('/req/core/api-definition-success A', '_abeff2dd-c2ea-156b-7fd5-a6cb28d9ae67', 'B.5'),
  apiDefinitionSuccessB: edr12('/req/core/api-definition-success B', '_3eddd8f1-3dca-37e2-ba38-e0ca281e6aa9', 'B.5'),
  conformanceSuccessA: edr12('/req/core/conformance-success A', '_5361fb97-e76b-7728-2f01-c2d54d1f62d1', 'B.7'),
  conformanceSuccessB: edr12('/req/core/conformance-success B', '_b0fefc96-fd39-83e2-b0d5-cba067c33584', 'B.7'),
  collectionsSuccessA: edr12('/req/collections/rc-md-success A', '_bd3d9d06-d599-42b4-e73f-9511fb50fa59', 'B.10'),
  collectionsSuccessB: edr12('/req/collections/rc-md-success B', '_4e79031f-31fa-fb3e-90d0-fc813f1b7631', 'B.10'),
  // "… the extent property (if provided) SHALL specify bounding boxes …"
  extent: edr12('/req/core/rc-extent A', '_ee60137e-e925-1e6b-baf8-2eaf9c94139c', 'B.13'),
  // As 1.1's, and G is new: "Every Collection within a collections array SHALL have a data_queries parameter which
  // SHALL comply with the requirement /req/edr/rc-data-queries." The crs moves to H, the output formats to K ("an
  // output_formats parameter") and parameter_names to L
  collectionInfoA: edr12('/req/edr/rc-collection-info A', '_1fdd19b3-2587-d511-f40e-f46bab33516b', 'B.14'),
  collectionInfoB: edr12('/req/edr/rc-collection-info B', '_811f393e-394b-ec03-5829-001ce9241661', 'B.14'),
  collectionInfoC: edr12('/req/edr/rc-collection-info C', '_16ef3dcd-f8c2-7075-c74f-6bed2722d6de', 'B.14'),
  collectionInfoD: edr12('/req/edr/rc-collection-info D', '_723662da-9c8a-be94-29a0-7f838f30a149', 'B.14'),
  collectionInfoE: edr12('/req/edr/rc-collection-info E', '_fd7fd338-4045-0d52-4d1e-2b024d934796', 'B.14'),
  collectionInfoF: edr12('/req/edr/rc-collection-info F', '_36b7bfbd-6053-0457-391c-59e6b74d5012', 'B.14'),
  collectionInfoG: edr12('/req/edr/rc-collection-info G', '_d44658e8-3bd4-8f42-425a-93fd6ea37d31', 'B.14'),
  collectionInfoH: edr12('/req/edr/rc-collection-info H', '_f6444822-6e22-6dc3-244d-ec37b48d8161', 'B.14'),
  collectionInfoK: edr12('/req/edr/rc-collection-info K', '_9fb9162e-43f7-830d-aeed-7e32eb659b34', 'B.14'),
  collectionInfoL: edr12('/req/edr/rc-collection-info L', '_da66ef45-81b8-b88a-18fa-d04a52eaf553', 'B.14'),
  // What a data query's variables hold, where the text and OGC's schema for it differ: the schema requires each of
  // these, and the text has B "A variables property MAY include a title property of type string", C "… MAY include an
  // output_formats property which SHALL be a string array", D "… SHOULD include a default_output_format property of
  // type string" and F "… MAY include a crs_details property which SHALL be an array of objects"
  variablesTitle: edr12('/req/edr/rc-common-variables B', '_ca8871b6-1c72-0c03-39e8-97d5659a234c'),
  variablesOutputFormats: edr12('/req/edr/rc-common-variables C', '_d8861939-aeae-1070-b7e2-20d7067a8d89'),
  variablesDefaultOutputFormat: edr12('/req/edr/rc-common-variables D', '_705c1fc2-89fd-b0f3-014a-6e9d341e04d2'),
  variablesCrsDetails: edr12('/req/edr/rc-common-variables F', '_c94a74dc-0181-29a9-66a2-509f67c4c65d'),
  // D: a parameter's label "SHALL be a string that is the name of the parameter"; G: "“type” SHALL HAVE the value
  // “https://www.opengis.net/def/uom/UCUM/” if UCUM is used"
  parameterLabel: edr12('/req/edr/rc-parameters D', '_59f2d7e2-242f-8571-ec80-543153e1f2fd', 'B.26'),
  parameterUnit: edr12('/req/edr/rc-parameters G', '_5047a43b-0afc-3b92-6bab-228999e4d7ae', 'B.26'),
  datetimeResponse: edr12('/req/core/datetime-response A', '_fab3a148-185f-b720-f07c-2b384ea2ba73', 'B.53'),
  // As 1.1's D and E, the syntax adding a repeating interval and a list of date-times
  datetimeSyntax: edr12('/req/core/datetime-response D', '_70039415-8dad-3ec7-c08a-249b635c0558', 'B.53'),
  datetimeRfc3339: edr12('/req/core/datetime-response E', '_9b0d745e-98a2-e78b-d0f2-3af2d156c1c1', 'B.53'),
  // As 1.1's B, C and D, now C "The z MAY be defined as a height range …", D "A list of z MAY be defined …", E "An
  // Arithmetic sequence using Recurring height intervals MAY be specified …"
  zRange: edr12('/req/edr/z-response C', '_6832ca68-9704-30de-e88d-1fa63aa3cda4', 'B.55'),
  zList: edr12('/req/edr/z-response D', '_dfce0c58-3e4d-faba-b702-6e5157c62802', 'B.55'),
  zRepeating: edr12('/req/edr/z-response E', '_d469b061-34f8-54a8-0e27-ebde94cbc0e1', 'B.55'),
  // As 1.1's
  bboxCorners: edr12('/req/core/rc-bbox-response D', '_36d917d1-0470-60d4-8ba1-ab0f0a8bb9df', 'B.143'),
  bboxWithinCrs: edr12('/req/core/rc-bbox-response H', '_a760316a-4ac1-9edf-dcb6-2cda63d85590', 'B.143'),
  polygonCoords: edr12('/req/edr/polygon-coords-response B', '_218be6fb-1f05-ab62-9655-af5648b46f67'),
  crsResponseB: edr12('/req/edr/REQ_rc-crs-response B', '_d2a10b07-8915-9c3d-224f-bf3f5d6aacfe'),
  // A: "The operation SHALL support a parameter limit with the following characteristics …", its fragment "type:
  // integer / minimum: 1 / maximum: 10000 / default: 10". Linked to the fragment. 1.1 has no limit
  limitDefinition: edr12('/req/edr/rc-limit-definition A', '_ce8f259f-ce1a-2bc4-4f4e-cb620db1ed2c', 'B.62'),
  // A, new: "If the z parameter is provided and a vertical extent is not defined in a collection, the z value SHALL be
  // ignored". B and F say what 1.1's A and E do
  zIgnored: edr12('/req/edr/z-response A', '_ab1fb9fa-774a-ac74-efe7-4e5804c0ab43', 'B.55'),
  zResponse: edr12('/req/edr/z-response B', '_6d458fa8-adfe-a9d3-7655-92a6c8210952', 'B.55'),
  zAllLevels: edr12('/req/edr/z-response F', '_5a1dea3c-9ddc-70cc-43fa-e35299a185c7', 'B.55'),
  parameterNameResponseB: edr12('/req/edr/parameter-name-response B', '_c3cce842-c10e-423e-877c-7fe1f29bf2aa', 'B.51'),
  // J: "A data query GET or POST operation SHOULD include an f query parameter"
  queryF: edr12('/req/edr/rc-core-query-parameters J', '_36756374-4167-aa52-7f49-8800c1f3aca2', 'B.49'),
  fResponseB: edr12('/req/edr/REQ_rc-f-response B', '_8458c6b5-9cd2-a890-a6e0-a8646eeddb04', 'B.59'),
  withinUnitsDefinition: edr12('/req/edr/within-units-definition B', '_82b6b45c-22d7-42c7-352b-26053aabdba3', 'B.80'),
  widthUnitsDefinition: edr12('/req/edr/REQ_rc-width-units-definition A', '_e94367a5-e9c7-9063-54c3-604bda2e056d', 'B.133'),
  heightUnitsDefinition: edr12('/req/edr/REQ_rc-height-units-definition A', '_ac3bbd2e-f4e6-f744-0bf6-a2a158d1fa7c', 'B.135'),
  edrGeojsonContent: edr12('/req/edr-geojson/content A', '_69adc7ab-8dd9-3f65-c44b-554197db81d2', 'B.32'),
  // As 1.1's
  geojsonContent: edr12('/req/geojson/content A', '_7074d0d8-e04e-a0b9-24bb-cff9a8401a0c', 'B.30'),
  // As 1.1's: "application/geo+json for resources that include feature content"
  edrGeojsonDefinition: edr12('/req/edr-geojson/definition A', '_050d2df9-d0e6-40ba-7336-372056cb0065', 'B.31'),
  geojsonDefinition: edr12('/req/geojson/definition A', '_4ae1940b-1c86-ba89-8433-a52f301d349a', 'B.29'),
  // A still names application/prs.coverage+json, where B and /req/covjson/definition name application/vnd.cov+json
  covjsonContentA: edr12('/req/covjson/content A', '_1902215f-6f6d-4db8-f23c-f5ef3592a2cf', 'B.34'),
  covjsonContentB: edr12('/req/covjson/content B', '_042d33ad-a3b8-6278-8ce2-33687bd1c422', 'B.34'),
  // "application/vnd.cov+json for resources that include data content"
  covjsonDefinition: edr12('/req/covjson/definition A', '_78b443c3-aebb-83f1-314c-3a5af586caff', 'B.33'),
  // "The JSON representation SHALL conform to the OpenAPI Specification 3.0." (3.1 likewise)
  oas30Definition: edr12('/req/oas30/oas-definition A', '_977ce8d6-aafe-4498-fdf8-e781133a7c98'),
  oas31Definition: edr12('/req/oas31/oas-definition A', '_0396bf08-e85d-1246-0a8a-19b6f040e362'),
  crossOrigin: edr12('Recommendation 3', '_b41b4d07-fb4e-7add-07cd-d7684805ffb6'),
  temporalValues: edr12('Annex C.8 (informative)', '_db0d9ee1-a7e2-4238-af58-631cd46f6404'),
  // "If a location id is not defined, the API implementation SHALL return a GeoJSON features array of valid location
  // identifiers and the schema of the GeoJSON response SHOULD be defined in the OpenAPI definition of the EDR service."
  locationsQuery: edr12('8.2.8', '_c7ea2a8a-9696-0d9f-7141-fb986d941c20'),
  // B, as 1.1's D
  locationsList: edr12('/req/edr/rc-locations B', '_98bca02a-03b6-6add-e630-3959a302eb99', 'B.151'),
  // "… SHALL include …", as in 1.1, all SHALL now; a cube no longer has to include z
  positionCoords: edr12('/req/edr/rc-position B', '_627e531f-5174-8af2-c1f8-d2f8db2b92e4', 'B.64'),
  areaCoords: edr12('/req/edr/rc-area B', '_99d70341-bb6c-459c-7028-d6d60e5e2bee', 'B.82'),
  trajectoryCoords: edr12('/req/edr/rc-trajectory B', '_72e7707b-485f-4e3c-369a-1a83fb152ba6', 'B.101'),
  radiusCoords: edr12('/req/edr/rc-radius B', '_9c1c44d4-9aeb-d614-e574-4f911000443a', 'B.70'),
  radiusWithin: edr12('/req/edr/rc-radius F', '_96ee0146-09f9-22d9-45ad-be29ad863d9e', 'B.70'),
  radiusWithinUnits: edr12('/req/edr/rc-radius H', '_464d691f-2623-2061-b6b8-12f2cf5af1fc', 'B.70'),
  cubeBbox: edr12('/req/edr/rc-cube B', '_60400cf8-db1f-2a35-6cdf-fa512d7e7292', 'B.88'),
  corridorCoords: edr12('/req/edr/rc-corridor B', '_f28489ff-dd0c-1580-befd-1dc2fe456101', 'B.112'),
  corridorWidth: edr12('/req/edr/rc-corridor E', '_ba63e6bd-2bd2-508c-b612-3dd281e71ba6', 'B.112'),
  corridorHeight: edr12('/req/edr/rc-corridor G', '_3d8916ab-6378-1e70-dfee-c60a5c2799d7', 'B.112'),
  corridorWidthUnits: edr12('/req/edr/rc-corridor I', '_dd7889dd-0cc8-cfd0-8c28-a3f6def9022e', 'B.112'),
  corridorHeightUnits: edr12('/req/edr/rc-corridor L', '_e456bdfa-5010-05cb-95b2-1578b0afaa0d', 'B.112'),
  // K, N: as 1.1's L and O, "… a HTTP 400 error SHOULD be generated"
  corridorWidthUnitsUnsupported: edr12('/req/edr/rc-corridor K', '_e98e127e-f6a0-ed77-3a1c-7dc9e75f70c1', 'B.112'),
  corridorHeightUnitsUnsupported: edr12('/req/edr/rc-corridor N', '_714e7636-d5f4-4c35-ba3c-995d17e4c425', 'B.112'),
  // As 1.1's, under 8.2.7 itself, with "OGC API-Features" for "OGC API — Features"
  itemsParameters: edr12('8.2.7', '_3c2581c9-194c-a22c-1898-4f2e87035833'),
};

// An EDR rule as both versions word it, for Checks to cite the one the API declares. A version without one cites none
const both = (v11: Rule | undefined, v12: Rule | undefined): EdrRule => ({ edr: { '1.1': v11, '1.2': v12 } });

export const EDR = {
  rootOpA: both(EDR11.rootOpA, EDR12.rootOpA),
  rootSuccessA: both(EDR11.rootSuccessA, EDR12.rootSuccessA),
  rootSuccessB: both(EDR11.rootSuccessB, EDR12.rootSuccessB),
  rootConformanceLink: both(EDR11.rootConformanceLink, EDR12.rootConformanceLink),
  rootDataLink: both(EDR11.rootDataLink, EDR12.rootDataLink),
  apiDefinitionSuccessA: both(EDR11.apiDefinitionSuccessA, EDR12.apiDefinitionSuccessA),
  apiDefinitionSuccessB: both(EDR11.apiDefinitionSuccessB, EDR12.apiDefinitionSuccessB),
  conformanceSuccessA: both(EDR11.conformanceSuccessA, EDR12.conformanceSuccessA),
  collectionsSuccessA: both(EDR11.collectionsSuccessA, EDR12.collectionsSuccessA),
  collectionsSuccessB: both(EDR11.collectionsSuccessB, EDR12.collectionsSuccessB),
  extent: both(EDR11.extent, EDR12.extent),
  collectionId: both(EDR11.collectionInfoA, EDR12.collectionInfoA),
  collectionTitle: both(EDR11.collectionInfoB, EDR12.collectionInfoB),
  collectionDescription: both(EDR11.collectionInfoC, EDR12.collectionInfoC),
  collectionKeywords: both(EDR11.collectionInfoD, EDR12.collectionInfoD),
  collectionLinks: both(EDR11.collectionInfoE, EDR12.collectionInfoE),
  collectionExtent: both(EDR11.collectionInfoF, EDR12.collectionInfoF),
  // 1.1's rc-collection-info has no statement for data_queries: its collections.yaml requires them
  collectionDataQueries: both(EDR11.collectionsSuccessB, EDR12.collectionInfoG),
  collectionCrs: both(EDR11.collectionInfoG, EDR12.collectionInfoH),
  collectionOutputFormats: both(EDR11.collectionInfoJ, EDR12.collectionInfoK),
  collectionParameterNames: both(EDR11.collectionInfoK, EDR12.collectionInfoL),
  datetimeResponse: both(EDR11.datetimeResponse, EDR12.datetimeResponse),
  datetimeSyntax: both(EDR11.datetimeSyntax, EDR12.datetimeSyntax),
  datetimeRfc3339: both(EDR11.datetimeRfc3339, EDR12.datetimeRfc3339),
  zRange: both(EDR11.zRange, EDR12.zRange),
  zList: both(EDR11.zList, EDR12.zList),
  zRepeating: both(EDR11.zRepeating, EDR12.zRepeating),
  bboxCorners: both(EDR11.bboxCorners, EDR12.bboxCorners),
  bboxWithinCrs: both(EDR11.bboxWithinCrs, EDR12.bboxWithinCrs),
  polygonCoords: both(EDR11.polygonCoords, EDR12.polygonCoords),
  crsResponseB: both(EDR11.crsResponseB, EDR12.crsResponseB),
  limitDefinition: both(undefined, EDR12.limitDefinition),
  corridorWidthUnitsUnsupported: both(EDR11.corridorWidthUnitsUnsupported, EDR12.corridorWidthUnitsUnsupported),
  corridorHeightUnitsUnsupported: both(EDR11.corridorHeightUnitsUnsupported, EDR12.corridorHeightUnitsUnsupported),
  zResponse: both(EDR11.zResponse, EDR12.zResponse),
  zIgnored: both(undefined, EDR12.zIgnored),
  zAllLevels: both(EDR11.zAllLevels, EDR12.zAllLevels),
  parameterNameResponseB: both(EDR11.parameterNameResponseB, EDR12.parameterNameResponseB),
  // 1.1: each operation SHALL support f; 1.2: a data query SHOULD include it
  queryF: both(EDR11.fDefinition, EDR12.queryF),
  fResponseB: both(EDR11.fResponseB, EDR12.fResponseB),
  withinUnitsDefinition: both(EDR11.withinUnitsDefinition, EDR12.withinUnitsDefinition),
  widthUnitsDefinition: both(EDR11.widthUnitsDefinition, EDR12.widthUnitsDefinition),
  heightUnitsDefinition: both(EDR11.heightUnitsDefinition, EDR12.heightUnitsDefinition),
  covjsonContentA: both(EDR11.covjsonContentA, EDR12.covjsonContentA),
  covjsonContentB: both(EDR11.covjsonContentB, EDR12.covjsonContentB),
  covjsonDefinition: both(EDR11.covjsonDefinition, EDR12.covjsonDefinition),
  edrGeojsonDefinition: both(EDR11.edrGeojsonDefinition, EDR12.edrGeojsonDefinition),
  geojsonDefinition: both(EDR11.geojsonDefinition, EDR12.geojsonDefinition),
  geojsonContent: both(EDR11.geojsonContent, EDR12.geojsonContent),
  oas30Definition: both(EDR11.oas30Definition, EDR12.oas30Definition),
  oas31Definition: both(undefined, EDR12.oas31Definition),
  crossOrigin: both(EDR11.crossOrigin, EDR12.crossOrigin),
  locationsQuery: both(EDR11.locationsQuery, EDR12.locationsQuery),
  locationsList: both(EDR11.locationsList, EDR12.locationsList),
  temporalValues: both(EDR11.temporalValues, EDR12.temporalValues),
  positionCoords: both(EDR11.positionCoords, EDR12.positionCoords),
  areaCoords: both(EDR11.areaCoords, EDR12.areaCoords),
  trajectoryCoords: both(EDR11.trajectoryCoords, EDR12.trajectoryCoords),
  radiusCoords: both(EDR11.radiusCoords, EDR12.radiusCoords),
  radiusWithin: both(EDR11.radiusWithin, EDR12.radiusWithin),
  radiusWithinUnits: both(EDR11.radiusWithinUnits, EDR12.radiusWithinUnits),
  cubeBbox: both(EDR11.cubeBbox, EDR12.cubeBbox),
  cubeZ: both(EDR11.cubeZ, undefined),
  corridorCoords: both(EDR11.corridorCoords, EDR12.corridorCoords),
  corridorWidth: both(EDR11.corridorWidth, EDR12.corridorWidth),
  corridorHeight: both(EDR11.corridorHeight, EDR12.corridorHeight),
  corridorWidthUnits: both(EDR11.corridorWidthUnits, EDR12.corridorWidthUnits),
  corridorHeightUnits: both(EDR11.corridorHeightUnits, EDR12.corridorHeightUnits),
  itemsParameters: both(EDR11.itemsParameters, EDR12.itemsParameters),
};

// ---- OGC API – Common Part 1 (OGC 19-072), published ----
const COMMON_1 = 'https://docs.ogc.org/is/19-072/19-072.html';
const common1 = (requirement: string, anchor: string): Rule => ({ label: `Common 1 ${requirement}`, url: `${COMMON_1}#${anchor}` });

export const COMMON1 = {
  // A: "The server SHALL support the HTTP GET operation on the URI {root}/"
  rootOpA: common1('/req/landing-page/root-op A', '_6fb8dd73-5b9d-ed6a-7d7f-69a66a8020aa'),
  // B: "The content of that response SHALL be based upon the schema landingPage.yaml and include links to the following
  // resources: API Definition (relation type ‘service-desc’ or ‘service-doc’) · Conformance Declaration (relation type
  // ‘http://www.opengis.net/def/rel/ogc/1.0/conformance’)"
  rootSuccessB: common1('/req/landing-page/root-success B', '_b08a7693-7aaf-7d12-0fae-fb28d38b7e17'),
  rootConformanceLink: common1('/req/landing-page/root-success B', '_66e188ee-2ac8-d985-e7f4-b1da46da0d6c'),
  // B: "The content of that response SHALL be based upon the schema confClasses.yaml and list all OGC API conformance
  // classes that the API conforms to."
  conformanceSuccessB: common1('/req/landing-page/conformance-success B', '_1419e71c-6dac-65d3-46f1-8caead08cafb'),
  // A: "Parameter names and values SHALL be case sensitive."
  caseSensitive: common1('/req/core/query-param-capitalization A', '_48554098-bbeb-a114-43e1-ea1340770228'),
  // A: "The server SHALL return a response with the status code 400 IF · the request URI includes a query parameter that
  // is not specified in the API definition · /per/core/query-param-name-specified does not apply, and ·
  // /per/core/query-param-name-tolerance does not apply." The latter: "Servers MAY display tolerance for requests with
  // incorrect query parameter names", such as "Ignore unknown/unrecognized parameters"
  unknownParameter: common1('/req/core/query-param-name-unknown A', '_e5765c7a-dfcd-59aa-9c61-ddb071d20944'),
  // Informative: "there is no requirement for the API definition to list every endpoint for which there is a non-404
  // behavior, for it to list every possible query parameter that might affect the behavior of an endpoint, or for it to
  // list every possible value that each query parameter might accept."
  notEverything: common1('8.3.1', '_47dc2dee-1319-6f8c-9b86-19b5dcfa8862'),
  // A: "The JSON representation SHALL conform to the OpenAPI Specification, version 3.0."
  oas30Definition: common1('/req/oas30/oas-definition-2 A', '_48babc53-510b-a0e2-e472-1ed54b360850'),
};

// ---- OGC API – Features Part 1 (OGC 17-069r4, the corrigendum), published ----
// Its HTML has no ids on paragraphs, so a rule links to its requirement
const FEATURES_1 = 'https://docs.ogc.org/is/17-069r4/17-069r4.html';
const features1 = (requirement: string, anchor: string): Rule => ({ label: `Features 1 ${requirement}`, url: `${FEATURES_1}#${anchor}` });

export const FEATURES1 = {
  // A: "The server SHALL support the HTTP GET operation at the path /."
  rootOpA: features1('/req/core/root-op A', 'req_core_root-op'),
  // B: "The content of that response SHALL be based upon the OpenAPI 3.0 schema landingPage.yaml and include at least
  // links to the following resources: the API definition (relation type service-desc or service-doc) · /conformance
  // (relation type conformance) · /collections (relation type data)"
  rootSuccessB: features1('/req/core/root-success B', 'req_core_root-success'),
  // B: "The content of that response SHALL be based upon the OpenAPI 3.0 schema confClasses.yaml and list all OGC API
  // conformance classes that the server conforms to."
  conformanceSuccessB: features1('/req/core/conformance-success B', 'req_core_conformance-success'),
  // B: "The content of that response SHALL be based upon the OpenAPI 3.0 schema collections.yaml."
  collectionsSuccessB: features1('/req/core/fc-md-success B', 'req_core_fc-md-success'),
  // The informative text after the requirement: "In case of a degenerated bounding box, the resulting geometry is used.
  // For example, if the lower left corner is the same as the upper right corner, all features match where the geometry
  // intersects with this point." and "in cases where the box spans the anti-meridian the first value (west-most box
  // edge) is larger than the third value (east-most box edge)."
  bboxResponse: features1('/req/core/fc-bbox-response, its notes', 'req_core_fc-bbox-response'),
  // A: "The operation SHALL support a parameter datetime with the following characteristics (using an OpenAPI
  // Specification 3.0 fragment): name: datetime in: query required: false schema: type: string style: form explode:
  // false". The operation is a collection's items
  timeDefinition: features1('/req/core/fc-time-definition A', 'req_core_fc-time-definition'),
};

// ---- OGC API – Records Part 1 (OGC 20-004r1), published ----
// A requirement's statements have ids of their own
const RECORDS_1 = 'https://docs.ogc.org/is/20-004r1/20-004r1.html';
const records1 = (requirement: string, anchor: string): Rule => ({ label: `Records 1 ${requirement}`, url: `${RECORDS_1}#${anchor}` });

export const RECORDS1 = {
  // A: "A searchable endpoint SHALL support a Temporal Searching (datetime) parameter as defined in the OGC API — Features
  // — Part 1: Core Standard." B: "All references to the term "features" in the OGC API — Features — Part 1: Core Standard
  // SHALL be replaced by the term "records" or "local resources" as the context may indicate."
  datetime: records1('/req/record-core-query-parameters/datetime A', '_6b8fcab1-1090-e860-2ade-4cd7856bcfd4'),
};

// ---- OpenAPI 3.0.3 and BCP 47 ----
export const OAS = {
  // "The path is appended to the URL from the Server Object in order to construct the full URL."
  paths: { label: 'OpenAPI 3.0.3 §4.7.8', url: 'https://spec.openapis.org/oas/v3.0.3.html#paths-object' } as Rule,
  // A Parameter Object's required: "Determines whether this parameter is mandatory."
  parameterRequired: { label: 'OpenAPI 3.0.3 §4.7.12, required', url: 'https://spec.openapis.org/oas/v3.0.3.html#parameterRequired' } as Rule,
};
export const RFC = {
  // "A language tag is composed from a sequence of one or more "subtags", each of which refines or narrows the range
  // of language identified by the overall tag."
  languageTag: { label: 'BCP 47 (RFC 5646) §2.1', url: 'https://www.rfc-editor.org/rfc/rfc5646.html#section-2.1' } as Rule,
  // GeoJSON's Feature Object: "If a Feature has a commonly used identifier, that identifier SHOULD be included as a member
  // of the Feature object with the name "id", and the value of this member is either a JSON string or number."
  featureId: { label: 'GeoJSON (RFC 7946) §3.2', url: 'https://www.rfc-editor.org/rfc/rfc7946.html#section-3.2' } as Rule,
};

// ---- MetOcean Common Profile for OGC API: a draft, cited only in notes, by file, commit and line ----
const METOCEAN_COMMON = 'https://github.com/opengeospatial/metocean-common-profile-ogcapi/blob/026d0ba48542bf6dd6e7a7f74705d5a38e8de5c8/profile/requirements';

export const METOCEAN_COMMON_DRAFT = {
  // "A parameter object SHALL specify the following fields: ``label``, ``description``, ``unit``"
  parameterFields: { label: 'MetOcean Common draft 026d0ba /req/collection-parameters/names', url: `${METOCEAN_COMMON}/collection-parameters/REQ_names.adoc?plain=1#L7` } as Rule,
  // "unit SHALL use QUDT as vocabulary, and ``unit.symbol.type`` SHALL be on the form
  // ``https://qudt.org/vocab/unit/<unit>`` and ``unit.symbol.value`` SHALL be set to the value of ``qudt:symbol``"
  qudtUnits: { label: 'MetOcean Common draft 026d0ba /req/collection-parameters/names', url: `${METOCEAN_COMMON}/collection-parameters/REQ_names.adoc?plain=1#L10` } as Rule,
};

// ---- Which EDR the API declares, and so which a finding cites ----
export type DeclaredEdr = '1.0' | '1.1' | '1.2';
// Newest first, so an API declaring several is taken at its latest
const EDR_VERSIONS: DeclaredEdr[] = ['1.2', '1.1', '1.0'];

// The newest EDR version whose core the API declares, by its conformance class's path (1.2's are https, 1.1's http),
// or null for none
export function detectEdrVersion(conformsTo: readonly string[] | null | undefined): DeclaredEdr | null {
  if (!conformsTo) return null;
  return EDR_VERSIONS.find(version => conformsTo.some(url => url.endsWith(`/spec/ogcapi-edr-1/${version}/conf/core`))) ?? null;
}

// The EDR text findings are cited against: 1.2 if the API declares it, else 1.1, the oldest whose text is cited
export interface CitedEdr {
  version: '1.1' | '1.2';
  declared: DeclaredEdr | null;
  // A response from an API other than the one loaded, whose conformance isn't known
  elsewhere?: boolean;
}

export function citedEdrOf(conformsTo: readonly string[] | null | undefined): CitedEdr {
  const declared = detectEdrVersion(conformsTo);
  return { version: declared === '1.2' ? '1.2' : '1.1', declared };
}

// The rules to show for a finding, in the cited EDR version
export function citedRules(rule: Citation | readonly Citation[] | undefined, edr: CitedEdr['version']): Rule[] {
  const citations: readonly Citation[] = rule === undefined ? [] : 'url' in rule || 'edr' in rule ? [rule as Citation] : rule as readonly Citation[];
  return citations.flatMap(citation => {
    if (!('edr' in citation)) return [citation];
    const chosen = citation.edr[edr];
    return chosen ? [chosen] : [];
  });
}

// The letter of the /req/edr/rc-collection-info statement a rule cites in that version, if it cites one there
export const COLLECTION_INFO = '/req/edr/rc-collection-info';
export function collectionInfoLetter(rule: Citation | readonly Citation[] | undefined, edr: CitedEdr['version']): string | null {
  return citedRules(rule, edr).find(cited => cited.requirement === COLLECTION_INFO)?.statement ?? null;
}

// Whether a rule shown is EDR's, the only standard whose version is chosen
export const citesEdr = (rules: readonly Rule[]) => rules.some(rule => rule.url.startsWith(EDR_1_1) || rule.url.startsWith(EDR_1_2));

// What Checks says once when its EDR citations rest on a version the API doesn't declare
export function edrVersionNote({ version, declared, elsewhere }: CitedEdr): string | null {
  if (elsewhere) return `This response isn't from the API that's loaded, so its EDR version isn't known; cited against EDR ${version}`;
  if (declared === version) return null;
  return declared ? `The API declares EDR ${declared}; cited against EDR ${version}` : `The API declares no EDR version; cited against EDR ${version}`;
}
