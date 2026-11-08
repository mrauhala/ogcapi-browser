import { i18nText } from './i18nText';

// A CoverageJSON coverage can be charted as a time series when its domain has a t axis and
// every other axis (x, y, z, composite, ...) holds exactly one value. Each range's flattened
// values then line up 1:1 with the t axis, whatever the domainType: PointSeries, a single-point
// Grid, or e.g. DWD's MultiPolygonSeries whose composite axis holds the one grid cell polygon.

interface CoverageAxis {
  values?: unknown[];
  num?: number;
}

export function axisLength(axis: CoverageAxis | undefined): number | undefined {
  if (Array.isArray(axis?.values)) return axis.values.length;
  if (typeof axis?.num === 'number') return axis.num;
  return undefined;
}

// Returns why the coverage can't be charted as a time series, or null when it can.
export function getTimeSeriesError(coverage: unknown): string | null {
  const axes = (coverage as { domain?: { axes?: Record<string, CoverageAxis> } } | null)?.domain?.axes;
  if (!axes || typeof axes !== 'object') {
    return 'No domain axes found in the coverage data';
  }

  if (!Array.isArray(axes.t?.values) || axes.t.values.length === 0) {
    return 'No time axis found in the coverage data';
  }

  const multiValued = Object.keys(axes).filter(name => name !== 't' && axisLength(axes[name]) !== 1);
  if (multiValued.length > 0) {
    return `Only time series at a single location can be charted (axes with more than one value: ${multiValued.join(', ')})`;
  }

  return null;
}

export function isTimeSeriesCoverage(coverage: unknown): boolean {
  return getTimeSeriesError(coverage) === null;
}

// The parameters describing a coverage's ranges. A CoverageCollection may define them once for all
// its coverages (Instituto Hidrográfico does); a coverage's own definitions take precedence.
export function coverageParameters<P>(
  coverage: { parameters?: Record<string, P> },
  collectionParameters?: Record<string, P>,
): Record<string, P> | undefined {
  if (!coverage.parameters && !collectionParameters) return undefined;
  return { ...collectionParameters, ...coverage.parameters };
}

// Text, or nothing: a response can send anything where text should be, a number, an object or null
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

// A parameter's unit as text, or '' if it has none. A symbol may be text or { value, type }, and
// UCUM's "1" means no unit at all, which beside a value only reads as a mistake.
export function parameterUnit(parameter?: { unit?: { symbol?: unknown; label?: unknown } }): string {
  const symbol = parameter?.unit?.symbol;
  const fromSymbol = text(symbol) ?? (symbol !== null && typeof symbol === 'object' ? text((symbol as { value?: unknown }).value) : undefined);
  const unit = fromSymbol ?? i18nText(parameter?.unit?.label) ?? '';
  return unit === '1' ? '' : unit;
}

// A label worth showing beside its id: none where it only repeats the id, whatever the capitals, as FMI's WindSpeedMS
// does windspeedms
export const distinctLabel = (id: string, label: string): string | null => (label.toLowerCase() === id.toLowerCase() ? null : label);

// A series' name: the parameter's own label, which CoverageJSON makes its name, else the observed property's, else the
// description, else its id. The parameter's label is passed over where it only repeats the id (DWD's T_2M), so that
// "Air Temperature" isn't lost. Labels that are links are skipped: DMI labels each observed property with an ECMWF
// parameter database URL, which says nothing in a legend.
export function parameterLabel(
  id: string,
  parameter?: { label?: unknown; observedProperty?: { label?: unknown }; description?: unknown },
): string {
  const usable = (label: string | undefined): label is string => !!label?.trim() && !/^https?:\/\//i.test(label.trim());
  const own = i18nText(parameter?.label);
  if (usable(own) && distinctLabel(id, own) !== null) return own;
  return [parameter?.observedProperty?.label, parameter?.description].map(i18nText).find(usable) ?? id;
}
