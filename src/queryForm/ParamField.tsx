import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import type { Requirement } from '../query/fieldSpecs';
import type { QueryIssue } from '../query/types';

// Text from the field specs, with `backticks` shown as code
export const Said: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('`').map((part, index) => (index % 2 === 1
      ? <Box key={index} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.95em' }}>{part}</Box>
      : <React.Fragment key={index}>{part}</React.Fragment>))}
  </>
);

const SMALL = { fontSize: 12, lineHeight: '16px' };

// Each field an outlined block with a tinted header strip, so the pane is easy to scan: a plain title, then the
// parameter's name as sent, muted, in mono. Where the line is too long, as on a phone, the right side drops under it
const TITLE = { fontSize: 14, lineHeight: '20px', fontWeight: 600 };
const NAME = { fontFamily: 'monospace', fontSize: 12.5, lineHeight: '18px', color: 'text.secondary', overflowWrap: 'anywhere' };
const FIELD_SX = { mt: 1.25, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' };
const HEAD_SX = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, rowGap: 0.25,
  px: 1.25, py: 0.5, borderBottom: 1, borderColor: 'divider',
  bgcolor: (theme: Theme) => alpha(theme.palette.text.primary, 0.05),
};
const BODY_SX = { px: 1.25, pt: 0.75, pb: 1 };
const COLOUR: Record<QueryIssue['severity'], string> = { missing: 'warning.main', error: 'error.main', warning: 'warning.main', info: 'text.secondary' };

export interface ParamFieldProps {
  id: string; // after query-field-, which the status line and issues jump to
  title: string; // in plain words: Output format, Time
  name: string; // as sent: f, datetime
  path?: string; // for a part of the path rather than a query parameter: shown after the name, as "(path)"
  figure?: string; // what the metadata says, at the right
  requirement?: Requirement;
  missing?: boolean; // required and still empty: the requirement turns orange
  hints?: string[];
  link?: { label: string; href: string };
  leftOut?: string; // said while empty
  empty?: boolean;
  issues?: QueryIssue[];
  openDocs?: (pointer: string) => void; // opens the API docs where an issue's rule is
  children?: React.ReactNode;
}

// One query parameter: its name as it's sent, whether it's required and what the metadata says of it, the control for
// its value, what the collection allows, what the server does while it's left out, and what's wrong with it
const ParamField: React.FC<ParamFieldProps> = ({
  id, title, name, path, figure, requirement, missing = false, hints = [], link, leftOut, empty = false, issues = [], openDocs, children,
}) => {
  const right = [figure, requirement].filter(Boolean).join(' · ');
  return (
    <Box id={`query-field-${id}`} sx={FIELD_SX}>
      <Box sx={HEAD_SX}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 0.75, minWidth: 0 }}>
          <Typography component="span" sx={{ ...TITLE, color: 'text.primary' }}>{title}</Typography>
          <Box component="span" sx={NAME}>
            {name}
            {path && <Box component="span" sx={{ color: 'text.disabled' }}> ({path})</Box>}
          </Box>
        </Box>
        {right && (
          <Typography component="div" sx={{ ...SMALL, ml: 'auto', textAlign: 'right', color: missing ? 'warning.main' : 'text.secondary' }}>
            {right}
          </Typography>
        )}
      </Box>
      <Box sx={BODY_SX}>
        {children}
        {hints.map(hint => (
          <Typography key={hint} component="div" sx={{ ...SMALL, mt: 0.5, color: 'text.secondary' }}><Said text={hint} /></Typography>
        ))}
        {link && (
          <Typography component="div" sx={{ ...SMALL, mt: 0.5 }}>
            <Link href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</Link>
          </Typography>
        )}
        {empty && leftOut && (
          <Typography component="div" sx={{ ...SMALL, mt: 0.5, color: 'text.secondary' }}>
            <Box component="span" sx={{ color: 'text.disabled' }}>Left out: </Box><Said text={leftOut} />
          </Typography>
        )}
        {issues.map(issue => (
          <Box key={issue.id} sx={{ ...SMALL, mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'flex-start', color: COLOUR[issue.severity] }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>{issue.message}</Box>
            {issue.source === 'openapi' && (
              <Chip label="API docs" size="small" variant="outlined"
                onClick={issue.pointer && openDocs ? () => openDocs(issue.pointer!) : undefined}
                sx={{ height: 18, fontSize: 10.5, color: 'inherit', borderColor: 'currentColor', flexShrink: 0 }} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ParamField;
