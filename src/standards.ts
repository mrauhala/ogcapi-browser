import type { Rule } from './types/api';

// The rules findings rest on, to cite beside them in Checks. CoverageJSON 1.0 (OGC 21-069r2) has no tests of its own,
// only its schema, and no names for its rules, so a rule the schema can't check is cited by its section
const COVERAGEJSON = 'https://docs.ogc.org/cs/21-069r2/21-069r2.html';
const section = (number: string, anchor: string): Rule => ({ label: `CoverageJSON ${number}`, url: `${COVERAGEJSON}#${anchor}` });

export const COVJSON = {
  // Each key of an i18n object a BCP 47 language tag
  i18n: section('9.2', '_aaeb6c03-12a7-4193-9743-08b5b0b40b4f'),
  // A parameter's label and unit, and a unit symbol's type: UCUM's scheme URI, or a custom one
  parameter: section('9.3', '_848e0786-20e2-4b65-a232-ebb02da2d387'),
  // A custom value for a unit symbol's type, as an absolute URI or a compact one
  customTypes: section('9.7.2', '_0d49d4a4-20d7-416c-ae89-3d3fc987b5ed'),
  // The media type, application/vnd.cov+json, and its one profile, standalone
  mediaType: section('10', '_b8b17e78-0147-4b58-8ade-a19465b57abc'),
  // An axis's values in order, and a referencing member
  domain: section('9.6.1', '_d5c16418-1a20-4dbf-bf7a-8e685062df97'),
  // x, y and z referenced by a spatial coordinate reference system, t by a temporal one
  domainTypes: section('9.10', '_2ebca2a8-cdde-41b4-ad83-2ede16d3792e'),
  multiPointSeries: section('9.10.5', '_02f1c364-8655-4fb4-aaab-03a9858d30fb'),
  multiPoint: section('9.10.6', '_59acccc2-582f-4de7-b5fc-21dcf5bf762d'),
  trajectory: section('9.10.7', '_f3799769-df55-4139-8c88-19a1fe723d1c'),
  section: section('9.10.8', '_f9bfd24d-abe1-4bde-9a89-6ed630898fc7'),
};

// OGC API – EDR 1.1 (OGC 19-086r6)
const EDR_1_1 = 'https://docs.ogc.org/is/19-086r6/19-086r6.html';
export const EDR11 = {
  // A response with data in CoverageJSON is application/prs.coverage+json
  covjsonContent: { label: 'EDR 1.1 /req/covjson/content', url: `${EDR_1_1}#req_covjson_content` } as Rule,
};

// OGC API – EDR 1.2 (OGC 19-086r9), whose requirements are named
const EDR_1_2 = 'https://docs.ogc.org/is/19-086r9/19-086r9.html';
export const EDR12 = {
  // A collection's parameter_names: its unit symbol's type for UCUM is https://www.opengis.net/def/uom/UCUM/
  parameters: { label: 'EDR 1.2 /req/edr/rc-parameters', url: `${EDR_1_2}#req_edr_rc-parameters` } as Rule,
};
