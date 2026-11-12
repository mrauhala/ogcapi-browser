import { useMemo } from 'react';
import { useApi } from '../contexts/ApiContext';
import { useCollection } from '../contexts/CollectionContext';
import { useOpenApi } from '../contexts/OpenApiContext';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { useQueryValidationContext } from '../contexts/QueryValidationContext';
import { summarizeIssues, typedIssues, type IssueSummary } from '../query/validateQuery';
import { undeclaredIssues } from '../query/declared';
import { mapOffer, mapProfileNames } from '../query/mapOffer';
import { subsetAxisIssues } from '../query/mapDimensions';
import { paramsIn } from '../query/requestUrl';
import { SEVERITY_ORDER, type QueryIssue } from '../query/types';
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
  const { conformsTo } = useApi();
  const { status: docsStatus } = useOpenApi();
  const active = !!queryValidation && queryValidation.url === collectionUrl;
  const apiOperation = active ? queryValidation.apiOperation : null;
  const declaring = active ? queryValidation.declaring : null;
  // A value typed in the line isn't missing, though the form may not have read it yet, or can't. And of a map's, each
  // parameter and each axis of subset that no Maps class the API declares, nor the draft profile, nor the API docs name,
  // typed ones included: not while the API docs are still being read, as they may name it. Its subset is also read
  // with the rest of the line: a spatial axis with bbox, a time with datetime where the API docs say they don't go
  const issues = useMemo(() => {
    if (!active) return NO_ISSUES;
    const typed = typedIssues(queryValidation.issues, requestUrl);
    if (!declaring || docsStatus === 'loading') return typed;
    const offer = mapOffer(mapProfileNames(declaring.collection), conformsTo, apiOperation?.params ?? null);
    const undeclared = undeclaredIssues(paramsIn(requestUrl).map(([name]) => name), offer, apiOperation?.pointer);
    const line = (name: string) => paramsIn(requestUrl).filter(([each]) => each === name).map(([, value]) => value).join(',');
    const axes = subsetAxisIssues(declaring.collection, offer, {
      subset: line('subset'), datetime: line('datetime'), bbox: line('bbox'), center: line('center'), subsetCrs: line('subset-crs'),
    });
    const more = [...undeclared, ...axes];
    return more.length ? [...typed, ...more].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) : typed;
  }, [active, queryValidation, requestUrl, declaring, docsStatus, conformsTo, apiOperation]);
  return useMemo(() => ({ active, issues, summary: summarizeIssues(issues), apiOperation }), [active, issues, apiOperation]);
}
