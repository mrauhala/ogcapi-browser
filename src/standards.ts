import type { Rule } from './types/api';

// The rules findings rest on, to cite beside them in Checks. CoverageJSON 1.0 (OGC 21-069r2) has no tests of its own,
// only its schema, and no names for its rules, so a rule the schema can't check is cited by its section
const COVERAGEJSON = 'https://docs.ogc.org/cs/21-069r2/21-069r2.html';
const section = (number: string, anchor: string): Rule => ({ label: `CoverageJSON ${number}`, url: `${COVERAGEJSON}#${anchor}` });

export const COVJSON = {
  // An axis's values in order, and a referencing member
  domain: section('9.6.1', '_d5c16418-1a20-4dbf-bf7a-8e685062df97'),
  // x, y and z referenced by a spatial coordinate reference system, t by a temporal one
  domainTypes: section('9.10', '_2ebca2a8-cdde-41b4-ad83-2ede16d3792e'),
  multiPointSeries: section('9.10.5', '_02f1c364-8655-4fb4-aaab-03a9858d30fb'),
  multiPoint: section('9.10.6', '_59acccc2-582f-4de7-b5fc-21dcf5bf762d'),
  trajectory: section('9.10.7', '_f3799769-df55-4139-8c88-19a1fe723d1c'),
  section: section('9.10.8', '_f9bfd24d-abe1-4bde-9a89-6ed630898fc7'),
};
