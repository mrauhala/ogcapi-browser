import React from 'react';
import type { Collection } from './types/api';
import { queryVariables, unitsFor } from './query/queryTypes';
import { toggledUnit } from './query/units';

// The radius's unit in the map's card, as the form's within-units: the units the radius query lists, nothing picked
// until one is, and a pick taken back by clicking it again. The card is dark in either theme, so these are styled as
// its other buttons rather than as the form's toggles
const buttonStyle = (picked: boolean): React.CSSProperties => ({
  minWidth: '34px',
  padding: '4px 8px',
  borderRadius: '4px',
  border: `1px solid ${picked ? '#4da3ff' : 'rgba(255, 255, 255, 0.3)'}`,
  backgroundColor: picked ? 'rgba(0, 123, 255, 0.45)' : 'rgba(255, 255, 255, 0.1)',
  color: 'white',
  fontFamily: 'monospace',
  fontSize: '12px',
  fontWeight: picked ? 'bold' : 'normal',
  cursor: 'pointer',
});

const RadiusUnits: React.FC<{
  target: { collection: Collection; queryKey: string } | null; // the radius query, null for any other
  value: string;
  onChange: (unit: string) => void;
}> = ({ target, value, onChange }) => {
  const units = target ? unitsFor(queryVariables(target.collection, target.queryKey), 'within') : [];
  if (units.length === 0) return null;
  return (
    <span role="group" aria-label="within-units" style={{ display: 'flex', gap: '4px' }}>
      {units.map(unit => (
        <button key={unit} type="button" aria-pressed={unit === value} style={buttonStyle(unit === value)} onClick={() => onChange(toggledUnit(value, unit))}>
          {unit}
        </button>
      ))}
    </span>
  );
};

export default RadiusUnits;
