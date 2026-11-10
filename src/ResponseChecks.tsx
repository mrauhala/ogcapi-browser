import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { alpha, darken, lighten, type SxProps, type Theme } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import { checksCount } from './responseTabs';
import { isAppFault } from './validation/severity';
import RuleLinks, { EdrVersionNote } from './RuleLinks';
import { useCitedEdr } from './hooks/useCitedEdr';
import { findingMessage, findingPath } from './findingText';
import type { ValidationError } from './types/api';

// A long list says little more, and every finding is flagged in Raw anyway
const MOST_SHOWN = 100;

const SEVERITY_ICON = {
  error: <ErrorOutlineIcon fontSize="inherit" color="error" aria-label="Error" />,
  warning: <WarningAmberIcon fontSize="inherit" color="warning" aria-label="Issue" />,
  info: <InfoOutlinedIcon fontSize="inherit" color="info" aria-label="Note" />,
  pass: <CheckIcon fontSize="inherit" color="success" aria-label="Passed" />,
};
// The app's own notice, such as a schema it couldn't load: not a finding about the server
const APP_ICON = <BuildOutlinedIcon fontSize="inherit" color="action" aria-label="The app’s own notice" />;
const WORST_FIRST = ['error', 'warning', 'info', 'pass'] as const;
// A finding about the data, and its line in Raw if it's about something there
type DataNote = { message: string; line?: number; severity?: ValidationError['severity']; source?: ValidationError['source']; rule?: ValidationError['rule'] };
const worstFirst = (notes: DataNote[]) => WORST_FIRST.flatMap(severity => notes.filter(note => (note.severity ?? 'info') === severity));

const Item = ({ icon, children, line, onClick }: { icon: ReactNode; children: ReactNode; line?: number; onClick?: () => void }) => (
  <Box component="li" sx={{ display: 'flex', gap: 1, alignItems: 'baseline', py: 0.25, fontSize: '0.8125rem', lineHeight: '18px' }}>
    <Box component="span" sx={{ flexShrink: 0, fontSize: '0.9rem', alignSelf: 'center', display: 'inline-flex' }}>{icon}</Box>
    <Box sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    {line !== undefined && (
      <Link component="button" type="button" onClick={onClick} sx={{ flexShrink: 0, fontFamily: 'monospace', fontSize: '0.75rem' }}>
        line {line}
      </Link>
    )}
  </Box>
);

const Heading = ({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) => (
  <Typography component="h3" variant="caption" sx={[{ display: 'block', color: 'text.secondary', fontWeight: 500, mb: 0.5 }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</Typography>
);

// The tab's name, with how many of the worst kind of finding there are
export function ChecksTabLabel({ findings }: { findings: Pick<ValidationError, 'severity'>[] }) {
  const count = checksCount(findings);
  return (
    // One element, since a tab stacks what's in it
    <span>
      Checks
      {count && (
        <Box
          component="span"
          sx={theme => {
            const colour = theme.palette[count.color].main;
            return {
              ml: 0.75,
              px: 0.75,
              borderRadius: 2,
              fontSize: '0.72rem',
              backgroundColor: alpha(colour, 0.16),
              color: theme.palette.mode === 'dark' ? lighten(colour, 0.4) : darken(colour, 0.4),
            };
          }}
        >
          {count.label}
        </Box>
      )}
    </span>
  );
}

interface ResponseChecksProps {
  // The schema the response was checked against, if one applies, and the rule its findings rest on
  schemaName: string | null;
  schemaRule?: ValidationError['rule'];
  // The domainType its coverages were checked as, if they inherit the collection's
  checkedAs?: string | null;
  findings: ValidationError[];
  // Each line with findings on it, in the order Raw steps through them
  lines: { line: number; errors: ValidationError[] }[];
  onGoToLine: (lineIndex: number) => void;
  // What's worth knowing about the format beyond its schema, such as its media type, each where it is in Raw
  formatNotes?: DataNote[];
  // What's worth knowing about the data itself, each where it is in Raw: what's wrong with it, and what's right
  dataNotes?: DataNote[];
  onGoToNote?: (line: number) => void;
  // The collection the response was checked against, if it was
  collectionId?: string | null;
  // Where the response came from: the loaded API's EDR version is cited only for a response of that API
  url?: string | null;
}

// What was checked about this response, and what that found
export default function ResponseChecks({ schemaName, schemaRule, checkedAs, findings, lines, onGoToLine, formatNotes = [], dataNotes = [], onGoToNote, collectionId, url }: ResponseChecksProps) {
  const edr = useCitedEdr(url);
  if (!schemaName && findings.length === 0 && formatNotes.length === 0 && dataNotes.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
        No schema applies to this response, so there was nothing to check it against.
      </Typography>
    );
  }

  // A fault in the app, such as a schema it couldn't load, is said apart and counts for nothing against the server
  const appNotices = findings.filter(isAppFault);
  const serverFindings = findings.filter(finding => !isAppFault(finding));
  const count = checksCount(serverFindings);
  const hasFormat = Boolean(schemaName) || findings.length > 0 || formatNotes.length > 0;
  const noteItem = (note: DataNote) => (
    <Item key={note.message} icon={SEVERITY_ICON[note.severity ?? 'info']} line={note.line} onClick={() => note.line !== undefined && onGoToNote?.(note.line)}>
      {note.message}
      <RuleLinks rule={note.rule} edr={edr} />
    </Item>
  );
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
      <EdrVersionNote edr={edr} rules={[schemaRule, ...findings.map(finding => finding.rule), ...formatNotes.map(note => note.rule), ...dataNotes.map(note => note.rule)]} />
      {hasFormat && <Heading>The format</Heading>}
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {schemaName && (
          <Item icon={appNotices.length > 0 ? APP_ICON : count ? SEVERITY_ICON[count.color] : <CheckIcon fontSize="inherit" color="success" aria-label="Passed" />}>
            {schemaName} schema: {appNotices.length > 0 ? 'not checked' : count ? count.label : '0 errors'}
            <RuleLinks rule={schemaRule} edr={edr} />
            {checkedAs && (
              <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.75rem' }}>
                Each coverage checked as a {checkedAs}, the collection's domainType, which it inherits
              </Box>
            )}
          </Item>
        )}
        {appNotices.map(notice => (
          <Item key={notice.message} icon={APP_ICON}>
            {notice.message}
            <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.75rem' }}>
              A fault in the app, not in the response: not counted against the server
            </Box>
          </Item>
        ))}
        {worstFirst(formatNotes).map(noteItem)}
        {serverFindings.slice(0, MOST_SHOWN).map((finding, index) => {
          const lineIndex = lines.findIndex(entry => entry.errors.includes(finding));
          return (
            <Item
              key={index}
              icon={SEVERITY_ICON[finding.severity ?? 'error']}
              line={lineIndex >= 0 ? lines[lineIndex].line : undefined}
              onClick={() => onGoToLine(lineIndex)}
            >
              {finding.path && <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary', mr: 1 }}>{findingPath(finding)}</Box>}
              {findingMessage(finding)}
              {/* Its schema's rule is on the schema's line */}
              {finding.rule !== schemaRule && <RuleLinks rule={finding.rule} edr={edr} />}
            </Item>
          );
        })}
      </Box>
      {serverFindings.length > MOST_SHOWN && (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
          And {serverFindings.length - MOST_SHOWN} more, flagged in Raw.
        </Typography>
      )}
      {[
        { heading: 'The data', notes: worstFirst(dataNotes.filter(note => note.source !== 'collection')) },
        { heading: `Against the collection${collectionId ? `: ${collectionId}` : ''}`, notes: worstFirst(dataNotes.filter(note => note.source === 'collection')) },
      ].filter(section => section.notes.length > 0).map((section, index) => (
        <Box key={section.heading}>
          <Heading sx={{ mt: index > 0 || hasFormat ? 2 : 0 }}>{section.heading}</Heading>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {section.notes.map(noteItem)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
