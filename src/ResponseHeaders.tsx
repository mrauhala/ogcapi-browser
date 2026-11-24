import { Fragment } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ResponseHeader } from './api/sendRequest';

const TITLE_SX = { display: 'block', color: 'text.secondary', fontWeight: 500, mb: 0.5 };

// Headers, stacked in a narrow pane, where a long name would leave its value no room
const HeaderList = ({ headers }: { headers: ResponseHeader[] }) => (
  <Box
    component="dl"
    sx={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      columnGap: 1,
      m: 0,
      fontFamily: 'monospace',
      fontSize: '0.75rem',
      lineHeight: '18px',
      '& dt': { overflowWrap: 'anywhere' },
      '& dd': { m: 0, mb: 1, overflowWrap: 'anywhere' },
      '@container (min-width: 440px)': {
        gridTemplateColumns: 'minmax(0, 214px) minmax(0, 1fr)',
        '& dd': { mb: 0 },
      },
    }}
  >
    {headers.map(({ name, value }) => (
      <Fragment key={name}>
        <Box component="dt" sx={{ color: 'primary.main' }}>{name}</Box>
        <Box component="dd">{value}</Box>
      </Fragment>
    ))}
  </Box>
);

// The response's headers, and before them the Accept the request was sent with, which the request line can't show,
// where the app sent it
export default function ResponseHeaders({ headers, accept }: { headers: ResponseHeader[]; accept?: string }) {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, containerType: 'inline-size' }}>
      {accept !== undefined && (
        <>
          <Typography component="h3" variant="caption" sx={TITLE_SX}>Request</Typography>
          <HeaderList headers={[{ name: 'accept', value: accept }]} />
          <Typography component="h3" variant="caption" sx={{ ...TITLE_SX, mt: 2 }}>Response</Typography>
        </>
      )}
      <HeaderList headers={headers} />
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>
        {accept !== undefined && "Request shows the Accept the app sent, which the request line can't; the browser adds headers of its own. "}
        A browser only lets this app read the headers the API exposes through CORS (Access-Control-Expose-Headers), so the server may have sent more.
      </Typography>
    </Box>
  );
}
