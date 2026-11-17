import React from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Collection, Citation } from '../types/api';
import type { UseQueryUrlReturn } from '../hooks/useQueryUrl';
import { useRequestUrl } from '../contexts/RequestUrlContext';
import { paramOf } from '../query/requestUrl';
import { bboxCrsChoices } from '../query/mapBox';
import { readColour, transparentIs } from '../query/mapMore';
import { MAPS1 } from '../standards';
import RuleLinks from '../RuleLinks';
import NameToggles from './NameToggles';
import { Said } from './ParamField';
import { VALUE_SX } from './valueSx';

// What's under More for a map, as the fields' controls: the background and what's outside the CRS's area as true/false
// toggles and a colour typed with its swatch, the centre and its CRS, the subset's CRS, and the Accept header. They read
// the line, so what's typed and not yet left counts. What the server does with what's left out is said under them, by
// what the rest of the request has

const NOTE_SX = { fontSize: 12, lineHeight: '16px', mt: 0.5, color: 'text.secondary' };
const Note: React.FC<{ text: string; rule?: Citation | readonly Citation[] }> = ({ text, rule }) => (
  <Typography component="div" sx={NOTE_SX}><Said text={text} />{rule && <RuleLinks rule={rule} />}</Typography>
);

const useTyped = () => {
  const { requestUrl } = useRequestUrl();
  return (name: string) => paramOf(requestUrl, name)?.trim() ?? '';
};

const BOOLEANS = ['true', 'false'];
// A colour that's partly see-through shows over a checkerboard
const CHECKS = 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 8px 8px';

// A colour as typed, painted: an empty dashed square while there's none, or one the form can't read
export const ColourSwatch: React.FC<{ text: string }> = ({ text }) => {
  const read = readColour(text);
  const css = read && read.form !== 'unread' ? read.css : null;
  return (
    <Box component="span" role="img" aria-label={css ? `The colour ${text.trim()}` : 'No colour'}
      sx={{
        display: 'inline-block', width: 18, height: 18, borderRadius: 0.5, flexShrink: 0,
        border: 1, borderColor: 'divider', borderStyle: css ? 'solid' : 'dashed',
        ...(css ? { background: `linear-gradient(${css}, ${css}), ${CHECKS}` } : {}),
      }} />
  );
};

// transparent and bgcolor, or void-transparent and void-color: true or false, the default marked, and the colour typed
// beside them. What the server does with the one left out depends on the other: said under them
export const BackgroundValue: React.FC<{ queryState: UseQueryUrlReturn; outside: boolean; colourText: React.ReactNode }> = ({ queryState, outside, colourText }) => {
  const typed = useTyped();
  const [flag, colour] = outside ? ['void-transparent', 'void-color'] : ['transparent', 'bgcolor'];
  const value = typed(flag);
  const painted = typed(colour);
  // The background's, given or left out: what void-transparent is without one of its own
  const background = transparentIs(typed('transparent'), typed('bgcolor'));
  const marked = outside ? background.value : transparentIs('', painted).value;
  const notes: { text: string; rule: Citation | readonly Citation[] }[] = [];
  if (!outside) {
    if (painted && !value) notes.push({ text: '`transparent` left out is `false`, as there\'s a `bgcolor`: the map is drawn on it', rule: MAPS1.transparentWithBgcolor });
    if (painted && value === 'true') notes.push({ text: 'With `transparent=true`, `bgcolor` has an opacity of 0: it doesn\'t show', rule: MAPS1.transparentOpacity });
    if (!painted && value === 'false') {
      notes.push({
        text: '`bgcolor` left out: the style\'s background colour, else a neutral one such as white, `0xFFFFFF` by its definition',
        rule: [MAPS1.bgcolorStyle, MAPS1.bgcolorNeutral, MAPS1.bgcolorDefinitionB],
      });
    }
  } else if (value || painted) {
    if (!value) notes.push({ text: `\`void-transparent\` left out is \`${background.value}\`, as \`transparent\` is`, rule: MAPS1.voidTransparentDefault });
    if (!painted) notes.push({ text: `\`void-color\` left out is \`bgcolor\`'s${typed('bgcolor') ? `, \`${typed('bgcolor')}\`` : ', given or left out'}`, rule: MAPS1.voidColorDefault });
  }
  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ flexShrink: 0 }}>
          <NameToggles label={flag} options={BOOLEANS} value={value} marked={marked} onChange={picked => queryState.setQueryParam(flag, picked)} tall />
        </Box>
        {/* Its own id, for the status line's bgcolor or void-color to jump to */}
        <Box id={`query-field-${colour}`} sx={{ flex: '1 1 200px', minWidth: 0 }}>{colourText}</Box>
      </Box>
      {notes.map(note => <Note key={note.text} text={note.text} rule={note.rule} />)}
    </>
  );
};

// A CRS's valid values to pick, as bbox-crs has them: CRS84, the storage CRS and the crs asked, each short
const CrsChoices: React.FC<{ collection: Collection; name: string; queryState: UseQueryUrlReturn }> = ({ collection, name, queryState }) => {
  const typed = useTyped();
  // CRS84 is always among them
  const choices = bboxCrsChoices(collection, typed('crs'));
  return (
    <Box sx={{ mt: 0.75 }}>
      <NameToggles label={name} options={choices.map(choice => choice.value)} labels={Object.fromEntries(choices.map(choice => [choice.value, choice.label]))}
        value={choices.find(choice => choice.value === typed(name))?.value ?? ''} onChange={value => queryState.setQueryParam(name, value)} />
    </Box>
  );
};

// center and center-crs side by side, and center-crs's valid values to pick
export const CenterValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn; centerText: React.ReactNode; centerCrsText: React.ReactNode }> = ({
  collection, queryState, centerText, centerCrsText,
}) => (
  <>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>{centerText}</Box>
      {/* Its own id, for the status line's center-crs to jump to */}
      <Box id="query-field-center-crs" sx={{ width: { xs: 118, sm: 150 }, flexShrink: 0 }}>{centerCrsText}</Box>
    </Box>
    <CrsChoices collection={collection} name="center-crs" queryState={queryState} />
  </>
);

// subset-crs, and its valid values to pick
export const SubsetCrsValue: React.FC<{ collection: Collection; queryState: UseQueryUrlReturn; text: React.ReactNode }> = ({ collection, queryState, text }) => (
  <>
    {text}
    <CrsChoices collection={collection} name="subset-crs" queryState={queryState} />
  </>
);

// The Accept header, typed, with the formats the API says it makes to pick. Not in the line: it's sent with it
export const AcceptValue: React.FC<{ options: string[]; accept: string; setAccept: (accept: string) => void }> = ({ options, accept, setAccept }) => (
  <>
    <TextField size="small" fullWidth value={accept} placeholder="A media type, as image/jpeg" onChange={event => setAccept(event.target.value.replace(/[\r\n]+/g, ''))}
      slotProps={{ htmlInput: { 'aria-label': 'Accept', spellCheck: false, autoComplete: 'off', sx: VALUE_SX } }} />
    {options.length > 0 && (
      <Box sx={{ mt: 0.75 }}>
        <NameToggles label="Accept" options={options} value={options.includes(accept.trim()) ? accept.trim() : ''} onChange={setAccept} />
      </Box>
    )}
  </>
);
