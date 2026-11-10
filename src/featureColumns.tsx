import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import CancelIcon from '@mui/icons-material/Cancel';
import { QuickFilter, QuickFilterClear, QuickFilterControl, Toolbar, type GridColDef } from '@mui/x-data-grid';
import KeywordChips from './KeywordChips';
import { propertyField, type FeatureRow } from './featureRows';

// The columns the tables of GeoJSON features share, and their search

export const featureIdColumn: GridColDef<FeatureRow> = {
  field: 'featureId',
  headerName: 'ID',
  flex: 0.5,
  minWidth: 100,
};

// A point's coordinates or anything else's bounding box, after its type
export const geometryColumn: GridColDef<FeatureRow> = {
  field: 'geometry',
  headerName: 'Geometry',
  flex: 1,
  minWidth: 220,
};

// A property under its own name. Keywords are chips
export const propertyColumn = (key: string): GridColDef<FeatureRow> => ({
  field: propertyField(key),
  headerName: key,
  flex: 1,
  minWidth: 150,
  ...(key === 'keywords' ? {
    renderCell: params => (Array.isArray(params.value) ? <KeywordChips keywords={params.value as string[]} /> : String(params.value ?? '')),
  } : {}),
});

// A search over every column, above the table
export function searchToolbar(placeholder: string) {
  return function SearchToolbar() {
    return (
      <Toolbar>
        <QuickFilter>
          <QuickFilterControl
            render={({ ref, ...controlProps }, state) => (
              <TextField
                {...controlProps}
                inputRef={ref}
                placeholder={placeholder}
                size="small"
                fullWidth
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: state.value ? (
                      <InputAdornment position="end">
                        <QuickFilterClear edge="end" size="small" aria-label="Clear search">
                          <CancelIcon fontSize="small" />
                        </QuickFilterClear>
                      </InputAdornment>
                    ) : null,
                    ...controlProps.slotProps?.input,
                  },
                  ...controlProps.slotProps,
                }}
              />
            )}
          />
        </QuickFilter>
      </Toolbar>
    );
  };
}
