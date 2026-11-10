import React from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQueryValidation } from '../hooks/useQueryValidation';
import { useOpenApi } from '../contexts/OpenApiContext';
import type { QueryIssue } from '../query/types';
import { focusQueryField, useOpenDocs } from './fieldFocus';

// As the field is named: a dimension by its id, the query on an instance as query
const nameOf = (field: string) => (field.startsWith('dim:') ? field.slice(4) : field === 'instance-query' ? 'query' : field);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The fields named in one part of the line, each jumping to its field
const Names: React.FC<{ issues: QueryIssue[] }> = ({ issues }) => {
  const fields = [...new Set(issues.map(issue => issue.field))];
  return (
    <>
      {fields.map((field, index) => (
        <React.Fragment key={field}>
          {index > 0 && ', '}
          <Link component="button" onClick={() => focusQueryField(field)} sx={{ fontFamily: 'monospace', fontSize: 'inherit', verticalAlign: 'baseline', color: 'inherit' }}>
            {nameOf(field)}
          </Link>
        </React.Fragment>
      ))}
    </>
  );
};

// One line under the query, in place of a box of issues: what's missing, wrong or doubtful, by name, and whether the
// API docs were read. What has no field of its own to sit under, like a corridor height the collection can't have,
// is said under the line.
const QueryStatus: React.FC<{ shown: Set<string> }> = ({ shown }) => {
  const { active, issues, apiOperation } = useQueryValidation();
  const { status } = useOpenApi();
  const openDocs = useOpenDocs();
  if (!active) return null;

  const missing = issues.filter(issue => issue.severity === 'missing');
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const elsewhere = issues.filter(issue => !shown.has(issue.field));
  return (
    <Box sx={{ mt: 1.25 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, fontSize: 13, lineHeight: '18px', color: 'text.secondary' }}>
        {missing.length > 0 && <Box component="span" sx={{ color: 'warning.main' }}>Missing: <Names issues={missing} /></Box>}
        {errors.length > 0 && <Box component="span" sx={{ color: 'error.main' }}>{plural(errors.length, 'error')}: <Names issues={errors} /></Box>}
        {warnings.length > 0 && <Box component="span" sx={{ color: 'warning.main' }}>{plural(warnings.length, 'warning')}: <Names issues={warnings} /></Box>}
        {missing.length === 0 && errors.length === 0 && <Box component="span" sx={{ color: 'success.main' }}>✓ Nothing missing</Box>}
        {status === 'loading' && <span>Reading the API docs…</span>}
        {apiOperation && openDocs && (
          <span>
            Checked against the{' '}
            <Tooltip title={`GET ${apiOperation.template}`}>
              <Link component="button" onClick={() => openDocs(apiOperation.pointer)} sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}>API docs</Link>
            </Tooltip>
          </span>
        )}
      </Box>
      {elsewhere.map(issue => (
        <Typography key={issue.id} component="div" sx={{ fontSize: 12, lineHeight: '16px', mt: 0.5, color: issue.severity === 'error' ? 'error.main' : issue.severity === 'info' ? 'text.secondary' : 'warning.main' }}>
          {issue.message}
        </Typography>
      ))}
    </Box>
  );
};

export default QueryStatus;
