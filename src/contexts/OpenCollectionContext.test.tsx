import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Collection } from '../types/api';
import { OpenCollectionProvider, useOpenCollection } from './OpenCollectionContext';

// What the request line gets on opening a collection and on leaving its query. What the provider needs from
// around it is stood in for, with the two calls that matter recorded.
const around = vi.hoisted(() => ({
  selectedCollection: null as unknown,
  setCollectionUrl: vi.fn(),
  selectDataQuery: vi.fn(),
}));
const nothing = () => {};
vi.mock('./CollectionContext', () => ({
  useCollection: () => ({
    selectedCollection: around.selectedCollection, setSelectedCollection: nothing, setSelectedFeature: nothing,
    setCollectionUrl: around.setCollectionUrl, setSelectedCollectionExtents: nothing, setLocationFeatures: nothing,
  }),
}));
vi.mock('./GeoJsonLayerContext', () => ({ useGeoJsonLayers: () => ({ geoJsonLayers: [], setGeoJsonLayers: nothing }) }));
vi.mock('./MapInteractionContext', () => ({ useMapInteraction: () => ({ setClickedCoords: nothing, setDataQuery: nothing }) }));
vi.mock('./ServiceContext', () => ({ useService: () => ({ getAuthCredentials: () => undefined }) }));
// As KNMI is listed, with a slash at the end
vi.mock('./ApiContext', () => ({ useApi: () => ({ apiUrl: 'https://api.test/edr/', conformsTo: [] }) }));
vi.mock('./ValidationContext', () => ({ useValidation: () => ({ setValidationResult: nothing, setEndpointUrls: nothing, setRawResponses: nothing }) }));
vi.mock('./QueryBuilderContext', () => ({
  useQueryBuilder: () => ({
    selectedDatetime: '', datetimeMode: 'individual', startDatetime: '', endDatetime: '',
    resetQueryState: nothing, selectDataQuery: around.selectDataQuery,
  }),
}));

// Its data links are its queries, the first a position query, as MeteoCore's and Polytope's are
const IFS = {
  id: 'ecmwf-ifs-pressure',
  links: [
    { rel: 'data', href: 'https://api.test/edr/collections/ecmwf-ifs-pressure/position' },
    { rel: 'data', href: 'https://api.test/edr/collections/ecmwf-ifs-pressure/area' },
  ],
  extent: {},
  data_queries: { position: { link: { href: 'https://api.test/edr/collections/ecmwf-ifs-pressure/position', rel: 'data' } } },
} as unknown as Collection;
const IFS_URL = 'https://api.test/edr/collections/ecmwf-ifs-pressure';

type Seen = ReturnType<typeof useOpenCollection>;
function Report({ onSeen }: { onSeen: (seen: Seen) => void }) {
  onSeen(useOpenCollection());
  return null;
}

function provided(): Seen {
  let seen: Seen | undefined;
  renderToStaticMarkup(<OpenCollectionProvider><Report onSeen={value => { seen = value; }} /></OpenCollectionProvider>);
  return seen!;
}

describe('OpenCollectionProvider', () => {
  beforeEach(() => {
    around.selectedCollection = null;
    around.setCollectionUrl.mockClear();
    around.selectDataQuery.mockClear();
  });

  it('opens a collection on its own URL, not on the query its first data link names', async () => {
    await provided().openCollection(IFS);
    expect(around.setCollectionUrl).toHaveBeenCalledTimes(1);
    expect(around.setCollectionUrl).toHaveBeenCalledWith(IFS_URL);
  });

  it("leaving the query takes the form back to no query, and the line to the collection's URL", () => {
    around.selectedCollection = IFS;
    provided().leaveQuery();
    expect(around.selectDataQuery).toHaveBeenCalledWith(IFS, '');
    expect(around.setCollectionUrl).toHaveBeenCalledWith(IFS_URL);
  });

  it('has no query to leave with no collection open', () => {
    provided().leaveQuery();
    expect(around.selectDataQuery).not.toHaveBeenCalled();
    expect(around.setCollectionUrl).not.toHaveBeenCalled();
  });
});
