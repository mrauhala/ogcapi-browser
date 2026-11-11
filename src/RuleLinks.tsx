import { Fragment } from 'react';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { useCitedEdr } from './hooks/useCitedEdr';
import { citedRules, citesEdr, edrVersionNote, type CitedEdr } from './standards';
import type { ValidationError } from './types/api';

type Cited = ValidationError['rule'];

// The rules a finding rests on, each a link to the statement itself: EDR's in the version the API declares, and two
// where standards differ. A response's checks give the version they're cited against, which depends on its URL
export default function RuleLinks({ rule, edr }: { rule: Cited; edr?: CitedEdr }) {
  const loaded = useCitedEdr();
  const { version } = edr ?? loaded;
  return (
    <>
      {citedRules(rule, version).map(cited => (
        <Fragment key={cited.url}>
          {' '}
          {/* Inside a finding that opens where it is, the link opens only the standard */}
          {/* Whole on a line where it fits, else broken where it must: Records' and Maps' ids are longer than a phone is
              wide */}
          <Link href={cited.url} target="_blank" rel="noopener noreferrer" underline="hover" onClick={event => event.stopPropagation()}
            sx={{ ml: 0.75, fontSize: '0.75rem', color: 'text.secondary', display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere' }}>
            {cited.label}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

// Said once, above findings that cite EDR, when the version they're cited against isn't one the API declares
export function EdrVersionNote({ rules, edr, sx }: { rules: readonly Cited[]; edr?: CitedEdr; sx?: SxProps<Theme> }) {
  const loaded = useCitedEdr();
  const cited = edr ?? loaded;
  const note = edrVersionNote(cited);
  if (!note || !rules.some(rule => citesEdr(citedRules(rule, cited.version)))) return null;
  return (
    <Typography variant="caption" component="p" sx={[{ display: 'block', color: 'text.secondary', m: 0, mb: 1 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {note}
    </Typography>
  );
}
