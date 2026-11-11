import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getCollections, landingUrlOf } from './client';
import { COMMON1, EDR, EDR11, EDR12, FEATURES1, MAPS1 } from '../standards';
import meteogate from './__fixtures__/meteogate-climate.json';

const MG = 'https://api.meteogate.eu/eu-eumetnet-climate-observations/v1';
type Responses = Record<string, unknown>;

// Serve the given responses by URL; anything else is a 404
const serve = (responses: Responses) => vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
  if (!(url in responses)) throw Object.assign(new Error(`Request failed with status code 404: ${url}`), { response: { headers: {}, statusText: 'Not Found', status: 404 } });
  return { data: responses[url], status: 200, headers: {}, request: { responseURL: url } };
});

// Schemas come from the app's public directory
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join('public', url), 'utf8')));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

// The recorded responses with the landing page at {root}/, where the client asks first
const atRoot = (responses: Responses, root: string): Responses =>
  Object.fromEntries(Object.entries(responses).map(([url, body]) => [url === `${root}?f=json` ? `${root}/?f=json` : url, body]));

const titles = (errors: { title?: string; severity?: string }[] | null | undefined) =>
  (errors ?? []).map(error => `${error.severity ?? 'error'}: ${error.title}`);

describe('getCollections', () => {
  it('uses a conformance link misfiled as data, and the collections from /collections (Meteogate)', async () => {
    const get = serve(atRoot(meteogate as Responses, MG));
    const result = await getCollections(MG);

    expect(result.collections.map(collection => collection.id)).toEqual(['nl-daily']);
    // The conformance declaration is fetched once, as conformance, not tried as a collections list
    expect(get.mock.calls.map(([url]) => url)).toEqual([`${MG}/?f=json`, `${MG}/conformance?f=json`, `${MG}/collections?f=json`]);

    // No rel="conformance" link breaks root-success B, as no link at all does: an error, said once
    const problems = titles(result.validation.errors);
    expect(problems).toContain('error: Conformance Linked as Data');
    expect(problems).not.toContain('error: Conformance Link Missing');
    expect(problems.some(problem => problem.endsWith('Multiple Data Links'))).toBe(false);
    expect(result.validation.errors?.find(error => error.title === 'Conformance Linked as Data')?.message)
      .toBe(`The landing page links its conformance declaration (${MG}/conformance) as rel="data" and has no rel="conformance" link. It was used as the conformance link.`);
    expect(result.validation.conformanceValidation?.isValid).toBe(true);
  });

  it('cites the rule a finding rests on: Meteogate’s conformance linked as data', async () => {
    serve(meteogate as Responses);
    const { validation } = await getCollections(MG);
    expect(validation.errors?.find(error => error.title === 'Conformance Linked as Data')?.rule).toEqual([EDR.rootConformanceLink, COMMON1.rootConformanceLink, FEATURES1.rootSuccessB]);
  });

  it('cites a schema’s findings by the requirement its schema is, in the version declared', async () => {
    const API = 'https://edr12.example/edr';
    const declares = (version: string) => serve({
      [`${API}?f=json`]: { links: [{ rel: 'data', href: `${API}/collections` }, { rel: 'conformance', href: `${API}/conformance` }] },
      [`${API}/conformance?f=json`]: { conformsTo: [`https://www.opengis.net/spec/ogcapi-edr-1/${version}/conf/core`] },
      [`${API}/collections?f=json`]: { links: [], collections: [{ id: 'one', links: [] }] },
    });
    for (const [version, schema, rule] of [['1.2', 'OGC API EDR Part 1 v1.2', EDR12.collectionsSuccessB], ['1.1', 'OGC API EDR Part 1 v1.1', EDR11.collectionsSuccessB]] as const) {
      declares(version);
      const { validation } = await getCollections(API);
      const found = validation.errors?.filter(error => error.schema === schema && error.section === 'Collections') ?? [];
      expect(found.length, version).toBeGreaterThan(0);
      expect(found.every(error => error.rule === rule), version).toBe(true);
      // As the collection's Checks show them
      expect(validation.collectionErrors?.one?.every(error => error.rule === rule), version).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it('moves on from a data link that answers without a collections list', async () => {
    const landing = { links: [{ rel: 'data', href: `${MG}/other` }, { rel: 'data', href: `${MG}/collections` }] };
    serve({ [`${MG}/?f=json`]: landing, [`${MG}/other?f=json`]: { hello: 'world' }, [`${MG}/collections?f=json`]: meteogate[`${MG}/collections?f=json`] });
    const result = await getCollections(MG);

    expect(result.collections.map(collection => collection.id)).toEqual(['nl-daily']);
    // The landing page links "at least" /collections as data, so more break nothing: a note of what the app did
    const multiple = result.validation.errors?.find(error => error.title === 'Multiple Data Links');
    expect(multiple?.severity).toBe('info');
    expect(multiple?.message).toContain(`The collections came from ${MG}/collections.`);
  });

  it('says so when no data link gives a collections list', async () => {
    serve({ [`${MG}/?f=json`]: { links: [{ rel: 'data', href: `${MG}/other` }] }, [`${MG}/other?f=json`]: { hello: 'world' } });
    const result = await getCollections(MG);

    expect(result.collections).toEqual([]);
    expect(result.validation.errors?.find(error => error.title === 'No Collections List')?.message)
      .toBe(`${MG}/other answered without a "collections" array, so no collections can be listed.`);
    expect(result.validation.errors?.find(error => error.title === 'No Collections List')?.rule).toEqual([EDR.collectionsSuccessB, FEATURES1.collectionsSuccessB]);
    // No conformance link either: EDR's root-success B and Common's name it
    expect(result.validation.errors?.find(error => error.title === 'Conformance Link Missing')?.rule).toEqual([EDR.rootConformanceLink, COMMON1.rootConformanceLink, FEATURES1.rootSuccessB]);
  });

  it('cites the landing page’s /collections link where it has none', async () => {
    serve({ [`${MG}?f=json`]: { links: [] }, [`${MG}/collections?f=json`]: meteogate[`${MG}/collections?f=json`] });
    const result = await getCollections(MG);
    expect(result.validation.errors?.find(error => error.title === 'Collections Link Missing')?.rule).toEqual([EDR.rootDataLink, FEATURES1.rootSuccessB]);
    serve({ [`${MG}?f=json`]: {}, [`${MG}/collections?f=json`]: meteogate[`${MG}/collections?f=json`] });
    const bare = await getCollections(MG);
    expect(bare.validation.errors?.find(error => error.message.startsWith('Landing page has no links array'))?.rule).toEqual([EDR.rootSuccessB, FEATURES1.rootSuccessB]);
  });

  it('cites a 200 for a conformance declaration not found', async () => {
    const landing = { links: [{ rel: 'data', href: `${MG}/collections` }, { rel: 'conformance', href: `${MG}/conformance` }] };
    serve({ [`${MG}?f=json`]: landing, [`${MG}/collections?f=json`]: meteogate[`${MG}/collections?f=json`] });
    const result = await getCollections(MG);
    expect(result.validation.errors?.find(error => error.title === 'Conformance Not Found')?.rule).toEqual([EDR.conformanceSuccessA, FEATURES1.conformanceSuccessA]);
  });

  it("asks for the landing page at {root}/, as OGC API Common has it, and from there on as before", async () => {
    // KNMI answers 404 at https://geoservices.knmi.nl/edr and 200 at …/edr/, which a link's root, worked out without
    // the slash, missed
    const get = serve(atRoot(meteogate as Responses, MG));
    const result = await getCollections(MG);
    expect(get.mock.calls[0][0]).toBe(`${MG}/?f=json`);
    expect(result.landingPageUrl).toBe(`${MG}/?f=json`);
    expect(titles(result.validation.errors).some(title => title.endsWith('Landing Page Not at {root}/'))).toBe(false);
  });

  // EDR's and Features' /req/core/root-op A, "The server SHALL support the HTTP GET operation at the path /", and
  // Common's, on "the URI {root}/": an error, citing all three
  it('reads it from the root as given when {root}/ answers 404, and makes an error of it', async () => {
    const get = serve(meteogate as Responses);
    const result = await getCollections(MG);
    expect(result.collections.map(collection => collection.id)).toEqual(['nl-daily']);
    expect(get.mock.calls.map(([url]) => url).slice(0, 2)).toEqual([`${MG}/?f=json`, `${MG}?f=json`]);
    expect(result.landingPageUrl).toBe(`${MG}?f=json`);
    const found = result.validation.errors?.find(error => error.title === 'Landing Page Not at {root}/');
    expect(found?.severity).toBe('error');
    expect(found?.message).toBe(`${MG}/?f=json answered 404, so the landing page was read from ${MG}?f=json. OGC API puts it at {root}/, with the slash.`);
    expect(found?.rule).toEqual([EDR.rootOpA, FEATURES1.rootOpA, COMMON1.rootOpA]);
  });

  it('makes an issue of CORS and of a link after the landing page that gets no answer, and notes the rest', async () => {
    const landing = { links: [{ rel: 'data', href: `${MG}/collections` }, { rel: 'conformance', href: `${MG}/conformance` }] };
    const failing = (failure: Error) => vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url === `${MG}/?f=json`) return { status: 200, data: landing, headers: {}, request: { responseURL: url } };
      throw failure;
    });
    const network = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', config: { url: `${MG}/conformance?f=json` } });
    failing(network);
    const unreached = await getCollections(MG);
    // A browser can't tell CORS from a server that's down: once the landing page answered, the server's to fix
    expect(titles(unreached.validation.errors)).toEqual(expect.arrayContaining(['warning: Collections Unreachable', 'warning: Conformance Unreachable']));
    vi.restoreAllMocks();
    failing(Object.assign(new Error('Request failed with status code 401'), { config: { url: `${MG}/collections?f=json` } }));
    expect(titles((await getCollections(MG)).validation.errors)).toContain('info: Collections Authentication Error');
    vi.restoreAllMocks();
    // The landing page itself: maybe the user's network or address
    vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', config: { url: `${MG}/?f=json` } }));
    expect(titles((await getCollections(MG)).validation.errors)).toEqual(['info: Connection Failed']);
    vi.restoreAllMocks();
    vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('CORS: no Access-Control-Allow-Origin'), { config: { url: `${MG}/?f=json` } }));
    expect((await getCollections(MG)).validation.errors?.[0]).toMatchObject({ title: 'CORS Error', severity: 'warning', rule: [EDR.crossOrigin, FEATURES1.crossOrigin] });
  });

  it('asks once for a root that ends in a slash', async () => {
    const get = serve({});
    await getCollections(`${MG}/`);
    expect(get.mock.calls.map(([url]) => url)).toEqual([`${MG}/?f=json`]);
  });
});

describe('landingUrlOf', () => {
  it('is {root}/ with f=json, or the root as given, keeping what the root asks with', () => {
    expect(landingUrlOf('https://geoservices.knmi.nl/edr', true)).toBe('https://geoservices.knmi.nl/edr/?f=json');
    expect(landingUrlOf('https://geoservices.knmi.nl/edr', false)).toBe('https://geoservices.knmi.nl/edr?f=json');
    expect(landingUrlOf('https://geoservices.knmi.nl/edr/', true)).toBe('https://geoservices.knmi.nl/edr/?f=json');
    expect(landingUrlOf('https://api.test/edr?f=html&key=1', true)).toBe('https://api.test/edr/?f=html&key=1');
    expect(landingUrlOf('https://api.test', true)).toBe(landingUrlOf('https://api.test', false));
  });
});

describe('getCollections when a request fails', () => {
  // The first request goes to {root}/; only a 404 there is tried again without the slash
  const LANDING = `${MG}/?f=json`;
  const COLLECTIONS = `${MG}/collections?f=json`;

  // The landing page answers unless it is the URL that fails; the failing URL throws like axios does
  const failAt = (failingUrl: string, error: Error) => vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    if (url === failingUrl) throw Object.assign(error, { config: { url } });
    if (url === LANDING) return { data: { links: [{ rel: 'data', href: `${MG}/collections` }] }, status: 200, headers: {}, request: { responseURL: url } };
    throw new Error(`unexpected request: ${url}`);
  });
  const fatal = async () => (await getCollections(MG)).validation.errors?.[0];

  it.each([
    [LANDING, new Error('Network Error'), 'Connection Failed', 'network',
      `Unable to connect to landing page. This may be due to CORS restrictions or the service being unavailable. URL: ${LANDING}`],
    [COLLECTIONS, new Error('Network Error'), 'Collections Unreachable', 'network',
      `Unable to connect to collections endpoint. This may be due to CORS restrictions or the service being unavailable. URL: ${COLLECTIONS}`],
    [COLLECTIONS, new Error('Blocked by CORS policy'), 'Collections CORS Error', 'cors',
      `collections endpoint does not allow cross-origin requests from web browsers. URL: ${COLLECTIONS}`],
    [COLLECTIONS, new Error('Request failed with status code 404'), 'Collections Not Found', 'network',
      `collections endpoint returned 404. URL: ${COLLECTIONS}`],
    [LANDING, new Error('Request failed with status code 401'), 'Authentication Error', 'network',
      `landing page requires authentication or returned access denied. URL: ${LANDING}`],
    [LANDING, new Error('socket hang up'), 'Error', 'unknown',
      `Failed to fetch landing page: socket hang up. URL: ${LANDING}`],
  ])('%s: %s → %s', async (url, error, title, type, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failAt(url, error);
    expect(await fatal()).toMatchObject({ title, type, message });
  });

  // CORS is EDR's Recommendation 3 and Features Part 1's /rec/core/cross-origin A, SHOULDs; a 404 breaks the 200 the
  // landing page and the collections SHALL answer with, in EDR and Features alike; nothing is cited for a request that
  // got no answer, or for authentication
  it.each([
    [COLLECTIONS, new Error('Blocked by CORS policy'), [EDR.crossOrigin, FEATURES1.crossOrigin]],
    [COLLECTIONS, new Error('Request failed with status code 404'), [EDR.collectionsSuccessA, FEATURES1.collectionsSuccessA]],
    [LANDING, new Error('Request failed with status code 404'), [EDR.rootSuccessA, FEATURES1.rootSuccessA]],
    [LANDING, new Error('Network Error'), undefined],
    [LANDING, new Error('Request failed with status code 401'), undefined],
  ])('%s: %s cites its rule', async (url, error, rule) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failAt(url, error);
    expect((await fatal())?.rule).toEqual(rule);
  });

  // Maps' cors class makes it a SHALL, where the API declares it: known once the conformance has answered, as it has
  // beside a collections list that failed
  it('cites Maps’ cors for a collections list blocked by CORS, where the API declares that class', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const CONFORMANCE = `${MG}/conformance?f=json`;
    const declaring = (classes: string[]) => vi.spyOn(axios, 'get').mockImplementation(async (url: string) => {
      if (url === COLLECTIONS) throw Object.assign(new Error('Blocked by CORS policy'), { config: { url } });
      if (url === CONFORMANCE) return { data: { conformsTo: classes }, status: 200, headers: {}, request: { responseURL: url } };
      if (url === LANDING) {
        return { data: { links: [{ rel: 'data', href: `${MG}/collections` }, { rel: 'conformance', href: `${MG}/conformance` }] }, status: 200, headers: {}, request: { responseURL: url } };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    declaring(['https://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/core', 'https://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/cors']);
    expect((await fatal())?.rule).toEqual([EDR.crossOrigin, FEATURES1.crossOrigin, MAPS1.cors]);
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Either scheme, as the conformance is matched by its path
    declaring(['http://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/cors']);
    expect((await fatal())?.rule).toEqual([EDR.crossOrigin, FEATURES1.crossOrigin, MAPS1.cors]);
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    declaring(['https://www.opengis.net/spec/ogcapi-maps-1/1.0/conf/core']);
    expect((await fatal())?.rule).toEqual([EDR.crossOrigin, FEATURES1.crossOrigin]);
  });

  it('treats an unclassified ERR_NETWORK as unreachable, without assuming CORS', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failAt(LANDING, Object.assign(new Error('xhr failed'), { code: 'ERR_NETWORK' }));
    expect(await fatal()).toMatchObject({
      title: 'Connection Failed',
      type: 'network',
      message: `Unable to connect to landing page. The service may be unreachable or blocking cross-origin requests. URL: ${LANDING}`,
    });
  });

  describe('what it keeps of its requests', () => {
    const API = 'https://capture.example/edr';
    const LANDING = {
      title: 'Captured',
      links: [
        { href: `${API}/collections`, rel: 'data', type: 'application/json' },
        { href: `${API}/conformance`, rel: 'conformance', type: 'application/json' },
      ],
    };
    const responses = {
      [`${API}/?f=json`]: LANDING,
      [`${API}/conformance?f=json`]: { conformsTo: ['a', 'b'] },
      [`${API}/collections?f=json`]: { links: [], collections: [{ id: 'one', links: [], extent: {} }] },
    };

    it('keeps each answer, with the URL as asked for', async () => {
      serve(responses);
      const { captured } = await getCollections(API);
      expect(captured?.landingPage?.url).toBe(`${API}/?f=json`);
      expect(captured?.landingPage?.response?.status).toBe(200);
      expect(captured?.conformance?.url).toBe(`${API}/conformance?f=json`);
      expect(captured?.collections?.url).toBe(`${API}/collections?f=json`);
      expect(captured?.collections?.response?.status).toBe(200);
    });

    it('adds no requests', async () => {
      const get = serve(responses);
      await getCollections(API);
      expect(get).toHaveBeenCalledTimes(3);
    });

    it('asks with the API key, and keeps the URL without it', async () => {
      const keyed = Object.fromEntries(Object.entries(responses).map(([url, body]) => [`${url}&api-key=sekret1`, body]));
      const get = serve(keyed);
      const { captured } = await getCollections(API, { apiKey: 'sekret1', apiKeyParam: 'api-key' });
      expect(get.mock.calls.every(([url]) => String(url).includes('api-key=sekret1'))).toBe(true);
      for (const capture of [captured?.landingPage, captured?.conformance, captured?.collections]) {
        expect(capture?.url).not.toContain('sekret1');
        expect(capture?.response?.status).toBe(200);
      }
    });

    it('keeps what came back from a failed conformance request, and carries on', async () => {
      serve({ [`${API}/?f=json`]: LANDING, [`${API}/collections?f=json`]: responses[`${API}/collections?f=json`] });
      const { captured, collections } = await getCollections(API);
      expect(captured?.conformance?.response?.status).toBe(404);
      expect(captured?.collections?.response?.status).toBe(200);
      expect(collections).toHaveLength(1);
    });

    it('keeps what it got when the load fails at the list', async () => {
      serve({ [`${API}/?f=json`]: LANDING, [`${API}/conformance?f=json`]: { conformsTo: ['a'] } });
      const { captured, collections } = await getCollections(API);
      expect(collections).toEqual([]);
      expect(captured?.landingPage?.response?.status).toBe(200);
      expect(captured?.collections?.response?.status).toBe(404);
    });

    it('still says what conformance declares when the load fails at the list', async () => {
      serve({ [`${API}/?f=json`]: LANDING, [`${API}/conformance?f=json`]: { conformsTo: ['a'] } });
      const { conformsTo } = await getCollections(API);
      expect(conformsTo).toEqual(['a']);
    });

    it('keeps what it got when the load fails at the landing page, at {root}/ and then as given, and asks for nothing more', async () => {
      const get = serve({});
      const { captured } = await getCollections(API);
      expect(captured?.landingPage?.url).toBe(`${API}?f=json`);
      expect(captured?.landingPage?.response?.status).toBe(404);
      expect(captured?.conformance).toBeUndefined();
      expect(captured?.collections).toBeUndefined();
      expect(get.mock.calls.map(([url]) => url)).toEqual([`${API}/?f=json`, `${API}?f=json`]);
    });

    it('says when no response came', async () => {
      vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
      const { captured } = await getCollections(API);
      expect(captured?.landingPage?.response).toBeNull();
      expect(captured?.landingPage?.failure).toMatch(/^Network error/);
    });

    it('keeps the answer it used, with several links to try', async () => {
      const second = `${API}/second`;
      serve({
        [`${API}/?f=json`]: { links: [...LANDING.links, { href: second, rel: 'data', type: 'application/json' }] },
        [`${API}/conformance?f=json`]: { conformsTo: [] },
        [`${API}/collections?f=json`]: { nothing: 'here' },
        [`${second}?f=json`]: { links: [], collections: [{ id: 'one', links: [], extent: {} }] },
      });
      const { captured, collections } = await getCollections(API);
      expect(collections).toHaveLength(1);
      expect(captured?.collections?.url).toBe(`${second}?f=json`);
    });

    it('keeps the first answer when none has a list, as it does for the validation', async () => {
      const second = `${API}/second`;
      serve({
        [`${API}/?f=json`]: { links: [...LANDING.links, { href: second, rel: 'data', type: 'application/json' }] },
        [`${API}/conformance?f=json`]: { conformsTo: [] },
        [`${API}/collections?f=json`]: { first: true },
        [`${second}?f=json`]: { second: true },
      });
      const { captured } = await getCollections(API);
      expect(captured?.collections?.url).toBe(`${API}/collections?f=json`);
    });
  });
});
