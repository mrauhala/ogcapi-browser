import { useQueryValidation } from '../hooks/useQueryValidation';
import { useOpenApi } from '../contexts/OpenApiContext';
import { openApiDocumentAt } from '../validation/openapi/openApiDocument';
import type { QueryIssue } from '../query/types';
import type { ValidationError } from '../types/api';

// Heard by More, which opens: a field closed inside it is jumped to once it shows
export const OPEN_MORE = 'open-query-more';

// Scroll a field into view and focus its control (fields carry id `query-field-<field>`). One inside More, closed, is
// there once More opens
export function focusQueryField(field: string, opened = false) {
  const element = document.getElementById(`query-field-${field}`);
  if (!element) {
    if (opened) return;
    document.dispatchEvent(new Event(OPEN_MORE));
    requestAnimationFrame(() => focusQueryField(field, true));
    return;
  }
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.querySelector<HTMLElement>('[role="combobox"], input:not([type="hidden"]), button')?.focus({ preventScroll: true });
}

const asFinding = (issue: QueryIssue): ValidationError => ({
  message: issue.message,
  path: issue.pointer,
  severity: issue.severity === 'info' ? 'info' : 'warning',
  section: 'OpenAPI',
  schema: 'API docs',
});

// Opens the API docs at a rule, with all of this query's API docs issues marked
export function useOpenDocs(): ((pointer: string) => void) | undefined {
  const { issues } = useQueryValidation();
  const { description } = useOpenApi();
  if (!description) return undefined;
  const findings = issues.filter(issue => issue.source === 'openapi' && issue.pointer).map(asFinding);
  return (pointer: string) => openApiDocumentAt(description, pointer, findings);
}
