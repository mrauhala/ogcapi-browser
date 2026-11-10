import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FindingChip, SectionStatus } from './ValidationPopover';
import { words } from './coverage/cellsTestData';
import type { ValidationError } from './types/api';
import { appFault } from './validation/severity';

vi.mock('./contexts/ApiContext', () => ({ useApi: () => ({ conformsTo: null }) }));
vi.mock('./contexts/ValidationContext', () => ({ useValidation: () => ({}) }));
vi.mock('./contexts/OpenApiContext', () => ({ useOpenApi: () => ({}) }));

const status = (errors: ValidationError[], isValid = true, countSectionErrors = true) =>
  renderToStaticMarkup(<SectionStatus label="Locations" validation={{ isValid, errors }} countSectionErrors={countSectionErrors} />);

describe('SectionStatus', () => {
  const LOAD = appFault('Failed to load schema: EDR 1.2 Locations', { section: 'Locations' });

  it('says a section the app couldn’t check wasn’t checked, rather than passing it', () => {
    const html = status([LOAD]);
    expect(words(html)).toBe('Locations not checked');
    expect(html).not.toContain('CheckCircle');
  });

  it('counts only the server’s problems beside one', () => {
    const problem: ValidationError = { message: '/features/0: must have id', section: 'Locations' };
    expect(words(status([LOAD, problem], false))).toBe('Locations 1 issue');
    expect(words(status([LOAD, { ...problem, severity: 'info' }]))).toBe('Locations not checked');
    // A section counted by what has no section of its own: "No schemas loaded" was the only thing it counted
    expect(words(status([appFault('No schemas loaded. Validation skipped.')], true, false))).toBe('Locations not checked');
  });

  it('passes a section with nothing found', () => {
    expect(words(status([]))).toBe('Locations');
    expect(status([])).toContain('CheckCircle');
  });
});

describe('FindingChip', () => {
  const chip = (error: Partial<ValidationError>) => words(renderToStaticMarkup(<FindingChip error={{ message: 'x', ...error }} />));

  it('names the server’s classes as Checks does, an error by its place alone', () => {
    expect(chip({})).toBe('');
    expect(chip({ severity: 'error' })).toBe('');
    expect(chip({ severity: 'warning' })).toBe('issue');
    expect(chip({ severity: 'info' })).toBe('note');
    expect(chip({ severity: 'pass' })).toBe('pass');
  });

  it('marks the app’s own notice as the app’s, whatever its severity', () => {
    expect(chip(appFault('+5 more errors not shown'))).toBe('the app\'s');
  });
});
