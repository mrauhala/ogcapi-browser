// GeoJSON features as rows of a table: the collection's items, its locations in the request pane, and a locations list
// in the response pane

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// A GeoJSON feature as an API sends it, which may lack any of these
export interface GeoJsonFeature {
  id?: unknown;
  type?: unknown;
  geometry?: unknown;
  properties?: unknown;
}

// A row per feature, numbered, since an API under test can repeat an id or leave it out. Its properties go under
// fields of their own, as a property can have any name, id included
export interface FeatureRow {
  id: number;
  // The feature as it came, or an empty one for something in the list that isn't an object
  feature: GeoJsonFeature;
  featureId: string | number;
  geometry: string;
  [field: string]: unknown;
}

export const propertyField = (key: string) => `property:${key}`;

const propertiesOf = (feature: GeoJsonFeature): Json => (isObject(feature.properties) ? feature.properties : {});

// Every property any feature has, in the order they first come
export function propertyKeysOf(features: readonly unknown[]): string[] {
  const keys = new Set<string>();
  for (const feature of features) {
    if (isObject(feature)) Object.keys(propertiesOf(feature)).forEach(key => keys.add(key));
  }
  return [...keys];
}

// The property that names the features: the first of these that any of them has. EDR's locations schema has label
const NAME_KEYS = ['name', 'title', 'label'];
export const nameKeyOf = (keys: readonly string[]): string | null => NAME_KEYS.find(key => keys.includes(key)) ?? null;

// What a feature is called, for a label: its name, title or label, else its id
export function featureLabel(feature: GeoJsonFeature): string {
  const properties = propertiesOf(feature);
  const name = NAME_KEYS.map(key => properties[key]).find(value => typeof value === 'string' && value !== '');
  if (typeof name === 'string') return name;
  return typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) : '';
}

// Keywords stay a list, for their chips. Anything else that isn't a plain value is shown as its JSON
function cellValue(key: string, value: unknown): unknown {
  if (key === 'keywords' && Array.isArray(value)) return value;
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
}

// Each position's first two numbers, wherever they are in the coordinates or in a collection's geometries
function extendBox(box: number[], geometry: Json): void {
  if (Array.isArray(geometry.geometries)) {
    geometry.geometries.forEach(each => isObject(each) && extendBox(box, each));
    return;
  }
  const walk = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    const [x, y] = coordinates;
    if (typeof x === 'number' && typeof y === 'number') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
      return;
    }
    coordinates.forEach(walk);
  };
  walk(geometry.coordinates);
}

// A geometry as a table shows it: its type, and a point's coordinates as sent, or anything else's bounding box, west,
// south, east and north
export function geometryText(geometry: unknown): string {
  if (geometry === null) return 'null';
  if (!isObject(geometry)) return '';
  const type = typeof geometry.type === 'string' ? geometry.type : '(no type)';
  if (type === 'Point' && Array.isArray(geometry.coordinates)) return `Point ${geometry.coordinates.join(', ')}`;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  extendBox(box, geometry);
  return box[0] <= box[2] ? `${type} bbox ${box.join(', ')}` : type;
}

export function featureRows(features: readonly unknown[], propertyKeys: readonly string[]): FeatureRow[] {
  return features.map((each, index) => {
    const feature: GeoJsonFeature = isObject(each) ? each : {};
    const { id } = feature;
    const row: FeatureRow = {
      id: index,
      feature,
      featureId: typeof id === 'string' || typeof id === 'number' ? id : id === undefined || id === null ? '' : JSON.stringify(id),
      geometry: geometryText(feature.geometry),
    };
    const properties = propertiesOf(feature);
    for (const key of propertyKeys) row[propertyField(key)] = cellValue(key, properties[key]);
    return row;
  });
}
