import type { ValidationError, ValidationResult } from '../types/api';

// A fault in the app itself, such as a schema it couldn't load or a list it cut short: the app's own notice, which
// says nothing of the server
export const isAppFault = (error: Pick<ValidationError, 'source'>) => error.source === 'app';

// A notice of the app's own, as each validator gives one. A note, so that anything that doesn't know the source still
// counts it for nothing
export const appFault = (message: string, extra: Partial<ValidationError> = {}): ValidationError => ({ ...extra, message, severity: 'info', source: 'app' });

// Errors and warnings are problems; notes (info), passes and the app's own faults are listed but don't count against
// the service
export const isProblem = (error: ValidationError) => !isAppFault(error) && ((error.severity ?? 'error') === 'error' || error.severity === 'warning');

// The colour an alert gives a finding: undefined is an error, and a pass is a success
export const alertSeverity = (severity: ValidationError['severity']) => (severity === 'pass' ? 'success' : (severity ?? 'error'));

// A loaded service is valid when every section validated so far is, as getCollections() decides
// on load. Computed from the sections, so a section that's validated again replaces its old verdict.
export function allSectionsValid(result: ValidationResult): boolean {
  return [
    result.landingPageValidation,
    result.collectionsValidation,
    result.conformanceValidation,
    result.locationsValidation,
    result.openApiValidation,
  ].every(section => section?.isValid ?? true);
}

// How many problems a service has, as the validation badge and the service panel show it
export const problemCount = (result: ValidationResult): number => result.errors?.filter(isProblem).length ?? 0;
