import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, type Theme } from '@mui/material/styles';
import type { Hint, Requirement } from '../query/fieldSpecs';
import type { Declarer } from '../query/declared';
import type { QueryIssue } from '../query/types';
import RuleLinks from '../RuleLinks';

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

// A finding under a field or a row: its message, the rule it rests on, as Checks cites it, and for the API docs' own a
// tag that opens them where it is
export const IssueLine: React.FC<{ issue: QueryIssue; openDocs?: (pointer: string) => void }> = ({ issue, openDocs }) => (
  <Box sx={{ ...SMALL, mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'flex-start', color: COLOUR[issue.severity] }}>
    <Box sx={{ flex: 1, minWidth: 0 }}>{issue.message}{issue.rule && <RuleLinks rule={issue.rule} />}</Box>
    {issue.source === 'openapi' && (
      <Chip label="API docs" size="small" variant="outlined"
        onClick={issue.pointer && openDocs ? () => openDocs(issue.pointer!) : undefined}
        sx={{ height: 18, fontSize: 10.5, color: 'inherit', borderColor: 'currentColor', flexShrink: 0 }} />
    )}
  </Box>
);

const TAG_SX = { height: 18, fontSize: 10.5, flexShrink: 0, '& .MuiChip-label': { px: 0.75 } };

// Who declared the parameter, in its head: a conformance class in blue, a draft profile dashed, linking to where it's
// being written, and the API docs in orange, opening them where they list it. Each says more on hover
const DeclaredTags: React.FC<{ declaredBy: Declarer[]; openDocs?: (pointer: string) => void }> = ({ declaredBy, openDocs }) => (
  <>
    {declaredBy.map(declarer => {
      if (declarer.kind === 'class') {
        return (
          <Tooltip key={`class:${declarer.name}`} title={`The API declares the conformance class ${declarer.uri}`}>
            <Chip label={declarer.name} size="small" variant="outlined" color="primary" sx={{ ...TAG_SX, fontFamily: 'monospace' }} />
          </Tooltip>
        );
      }
      if (declarer.kind === 'profile') {
        return (
          <Tooltip key={`profile:${declarer.name}`} title={declarer.note}>
            <Chip label={declarer.name} size="small" variant="outlined" component="a" href={declarer.href} target="_blank" rel="noopener noreferrer" clickable
              sx={{ ...TAG_SX, color: 'text.secondary', borderStyle: 'dashed' }} />
          </Tooltip>
        );
      }
      return (
        <Tooltip key="api-docs" title="The API docs' operation for this request lists it">
          <Chip label="API docs" size="small" variant="outlined" color="warning"
            onClick={openDocs ? () => openDocs(declarer.pointer) : undefined} sx={TAG_SX} />
        </Tooltip>
      );
    })}
  </>
);

export interface ParamFieldProps {
  id: string; // after query-field-, which the status line and issues jump to
  title: string; // in plain words: Output format, Time
  name: string; // as sent: f, datetime
  path?: string; // for a part of the path rather than a query parameter: shown after the name, as "(path)"
  figure?: string; // what the metadata says, at the right
  requirement?: Requirement;
  declaredBy?: Declarer[]; // who declared it: tagged at the right
  missing?: boolean; // required and still empty: the requirement turns orange
  hints?: Hint[];
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
  id, title, name, path, figure, requirement, declaredBy = [], missing = false, hints = [], link, leftOut, empty = false, issues = [], openDocs, children,
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
        {(right || declaredBy.length > 0) && (
          <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', columnGap: 0.5, rowGap: 0.25 }}>
            {right && (
              <Typography component="div" sx={{ ...SMALL, textAlign: 'right', color: missing ? 'warning.main' : 'text.secondary' }}>
                {right}
              </Typography>
            )}
            <DeclaredTags declaredBy={declaredBy} openDocs={openDocs} />
          </Box>
        )}
      </Box>
      <Box sx={BODY_SX}>
        {children}
        {hints.map(hint => (
          <Typography key={typeof hint === 'string' ? hint : hint.text} component="div" sx={{ ...SMALL, mt: 0.5, color: 'text.secondary' }}>
            {/* Why the field is there, and the rule it rests on, cited as an issue's is */}
            {typeof hint === 'string' ? <Said text={hint} /> : <><Said text={hint.text} /><RuleLinks rule={hint.rule} /></>}
          </Typography>
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
        {issues.map(issue => <IssueLine key={issue.id} issue={issue} openDocs={openDocs} />)}
      </Box>
    </Box>
  );
};

export default ParamField;
