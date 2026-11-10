import { useMemo } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { useQueryValidationContext } from '../contexts/QueryValidationContext';
import { summarizeIssues, typedIssues, type IssueSummary } from '../query/validateQuery';
import type { QueryIssue } from '../query/types';
import type { QueryValidationState } from '../contexts/QueryValidationContext';

const NO_ISSUES: QueryIssue[] = [];

interface QueryValidation {
  active: boolean;
  issues: QueryIssue[];
  summary: IssueSummary;
  apiOperation: QueryValidationState['apiOperation'];
}

// Issues of the data query behind the current request URL, if the query builder made that URL
export function useQueryValidation(): QueryValidation {
  const { queryValidation } = useQueryValidationContext();
  const { collectionUrl } = useCollection();
  const { requestUrl } = useRequestUrl();
  const active = !!queryValidation && queryValidation.url === collectionUrl;
  // A value typed in the line isn't missing, though the form may not have read it yet, or can't
  const issues = useMemo(() => (active ? typedIssues(queryValidation.issues, requestUrl) : NO_ISSUES), [active, queryValidation, requestUrl]);
  const apiOperation = active ? queryValidation.apiOperation : null;
  return useMemo(() => ({ active, issues, summary: summarizeIssues(issues), apiOperation }), [active, issues, apiOperation]);
}
