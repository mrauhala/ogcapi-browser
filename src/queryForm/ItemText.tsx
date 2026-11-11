import React, { useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import { itemToSet, type ItemAction } from './itemEdit';
import { VALUE_SX } from './valueSx';

// An item's id, a part of the path: the form's, like a location picked. What's typed goes in on Enter or on leaving the
// field, and the request line follows. Escape puts back what was there. Empty, the request lists the items.
const ItemText: React.FC<{
  word?: 'item' | 'record'; // what the collection's items are, as sent in the path
  value: string;
  onChange: (item: string) => void;
}> = ({ word = 'item', value, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs the field, and leaving it mustn't then set what Escape took back
  const undoing = useRef(false);

  const finish = (action: ItemAction) => {
    const item = itemToSet(draft, value, action);
    if (item !== null) onChange(item);
    setDraft(null);
  };

  return (
    <TextField
      id="query-input-item"
      size="small"
      fullWidth
      value={draft ?? value}
      placeholder={`A${word === 'item' ? 'n' : ''} ${word}'s id, or none for the list`}
      onBlur={() => {
        if (!undoing.current) finish('blur');
        undoing.current = false;
      }}
      onChange={event => setDraft(event.target.value.replace(/[\r\n]+/g, ''))}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          finish('enter');
        } else if (event.key === 'Escape' && draft !== null) {
          undoing.current = true;
          finish('escape');
          (event.target as HTMLElement).blur();
        }
      }}
      slotProps={{ htmlInput: { 'aria-label': word, spellCheck: false, autoComplete: 'off', sx: VALUE_SX } }}
    />
  );
};

export default ItemText;
