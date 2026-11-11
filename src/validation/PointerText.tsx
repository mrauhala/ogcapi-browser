import { Fragment, type ReactNode } from 'react';
import Box from '@mui/material/Box';

// A JSON pointer that wraps where a narrow box needs it to: after a `/`, or a `~1` (a `/` in a name), and inside a
// segment only where one is still too long for the line (with overflow-wrap: anywhere on its box). What comes after it,
// as a link's icon, stays on the line with its last character.
export default function PointerText({ path, after }: { path: string; after?: ReactNode }) {
  const parts = path.split(/(?<=\/|~1)/);
  const last = parts.pop() ?? '';
  return (
    <>
      {parts.map((part, index) => <Fragment key={index}>{part}<wbr /></Fragment>)}
      {after ? (
        <>
          {last.slice(0, -1)}
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{last.slice(-1)}{after}</Box>
        </>
      ) : last}
    </>
  );
}
