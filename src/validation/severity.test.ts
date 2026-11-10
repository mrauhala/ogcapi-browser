import { describe, expect, it } from 'vitest';
import { alertSeverity, allSectionsValid, appFault, isAppFault, isProblem, problemCount } from './severity';
import type { ValidationError, ValidationResult } from '../types/api';

describe('isProblem', () => {
  it('counts errors (also without a severity) and warnings, not notes', () => {
    expect(isProblem({ message: 'x' })).toBe(true);
    expect(isProblem({ message: 'x', severity: 'warning' })).toBe(true);
    expect(isProblem({ message: 'x', severity: 'info' })).toBe(false);
    expect(isProblem({ message: 'x', severity: 'pass' })).toBe(false);
  });

  it('never counts a fault in the app itself, whatever its severity says', () => {
    expect(isProblem({ message: 'x', source: 'app' })).toBe(false);
    expect(isProblem({ message: 'x', source: 'app', severity: 'error' })).toBe(false);
    expect(isProblem({ message: 'x', source: 'collection', severity: 'warning' })).toBe(true);
  });
});

describe('appFault', () => {
  it('is the app’s, and a note to anything that doesn’t know the source', () => {
    const fault: ValidationError = appFault('Failed to load schema: X', { type: 'schema', section: 'Locations' });
    expect(fault).toEqual({ message: 'Failed to load schema: X', type: 'schema', section: 'Locations', severity: 'info', source: 'app' });
    expect(isAppFault(fault)).toBe(true);
    expect(isAppFault({ source: 'collection' })).toBe(false);
    // What it's given can't make it the server's
    expect(appFault('x', { severity: 'error', source: 'collection' })).toMatchObject({ severity: 'info', source: 'app' });
  });
});

describe('allSectionsValid', () => {
  const section = (isValid: boolean) => ({ isValid, errors: null });

  it('is valid when every validated section is', () => {
    expect(allSectionsValid({ isValid: true, errors: null })).toBe(true);
    expect(allSectionsValid({ isValid: true, errors: null, landingPageValidation: section(true), openApiValidation: section(true) })).toBe(true);
    expect(allSectionsValid({ isValid: true, errors: null, landingPageValidation: section(true), openApiValidation: section(false) })).toBe(false);
  });

  it('takes a revalidated section\'s new verdict instead of the stored overall one', () => {
    const before: ValidationResult = { isValid: false, errors: null, landingPageValidation: section(true), openApiValidation: section(false) };
    expect(allSectionsValid({ ...before, openApiValidation: section(true) })).toBe(true);
  });
});

describe('problemCount', () => {
  it('counts the errors and warnings of every section, not notes, as the badge does', () => {
    const result: ValidationResult = {
      isValid: true,
      errors: [
        { message: 'empty temporal values', section: 'collections' },
        { message: 'conformance linked as data', section: 'conformance', severity: 'warning' },
        { message: 'features lack datetime', section: 'Locations' },
        { message: 'bbox marked optional', section: 'OpenAPI', severity: 'info' },
        { message: 'No schemas loaded. Validation skipped.', source: 'app' },
      ],
    };
    expect(problemCount(result)).toBe(3);
    expect(problemCount({ isValid: true, errors: null })).toBe(0);
  });
});

describe('alertSeverity', () => {
  it('gives an alert the colour of a finding, a pass a success', () => {
    expect(alertSeverity(undefined)).toBe('error');
    expect(alertSeverity('warning')).toBe('warning');
    expect(alertSeverity('info')).toBe('info');
    expect(alertSeverity('pass')).toBe('success');
  });
});
