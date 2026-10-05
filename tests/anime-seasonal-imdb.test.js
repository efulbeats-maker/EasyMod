'use strict';
// Offline tests Task A: seasonal TMDB S>=2 IMDb-first for all 3 anime sources.
// No network: every fetch is mocked. Run: node --test tests/anime-seasonal-imdb.test.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const HELPER_PATH = path.join(SRC_DIR, 'anime_mapping_helper.js');
const FETCH_HELPER_PATH = path.join(SRC_DIR, 'fetch_helper.js');

function clearAnimeCaches() {
  for (const p of [
    HELPER_PATH,
    FETCH_HELPER_PATH,
    path.join(SRC_DIR, 'animeunity', 'index.js'),
    path.join(SRC_DIR, 'animeworld', 'index.js'),
    path.join(SRC_DIR, 'animesaturn', 'index.js'),
  ]) {
    try { delete require.cache[require.resolve(p)]; } catch (_) {}
  }
}

function loadFresh() {
  clearAnimeCaches();
  const helper = require(HELPER_PATH);
  const unity = require(path.join(SRC_DIR, 'animeunity', 'index.js'));
  const world = require(path.join(SRC_DIR, 'animeworld', 'index.js'));
  const saturn = require(path.join(SRC_DIR, 'animesaturn', 'index.js'));
  return { helper, unity, world, saturn };
}

function loadHelperInSandbox({ withAbort = true, fetchImpl, fetchWithTimeoutImpl } = {}) {
  const helperSrc = fs.readFileSync(HELPER_PATH, 'utf8');
  const fetchSrc = fs.readFileSync(FETCH_HELPER_PATH, 'utf8');
  // Strip requires: helper requires ./fetch_helper, fetch_helper has no requires.
  const helperInner = helperSrc
    .split('\n')
    .filter((line) => !/require\s*\(\s*['"]\.\/fetch_helper['"]\s*\)/.test(line))
    .join('\n');
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    Promise,
    Number,
    String,
    JSON,
    Object,
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  if (withAbort) {
    sandbox.AbortController = AbortController;
    sandbox.AbortSignal = AbortSignal;
  }
  if (typeof fetchImpl !== 'undefined') sandbox.fetch = fetchImpl;
  if (typeof URL !== 'undefined') sandbox.URL = URL;
  if (typeof URLSearchParams !== 'undefined') sandbox.URLSearchParams = URLSearchParams;
  vm.createContext(sandbox);
  vm.runInContext(`${fetchSrc}\n//# sourceURL=fetch_helper.vm.js`, sandbox);
  // Expose fetch_helper exports as free variables for helperInner.
  sandbox.fetchWithTimeout = sandbox.module.exports.fetchWithTimeout;
  sandbox.createTimeoutSignal = sandbox.module.exports.createTimeoutSignal;
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  if (typeof fetchWithTimeoutImpl === 'function') sandbox.fetchWithTimeout = fetchWithTimeoutImpl;
  vm.runInContext(`${helperInner}\n//# sourceURL=anime_mapping_helper.vm.js`, sandbox);
  return sandbox.module.exports;
}

const pendingFetch = () => new Promise(() => {});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function safeSeen(seen) {
  try {
    return JSON.stringify(seen).replace(/([?&]api_key=)[^&\s"']+/gi, '$1[REDACTED]');
  } catch (_) {
    return '[unavailable]';
  }
}
const okEmptyAnimePage = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });

function s2Payload(provider) {
  const base = {
    requested: { season: 2, episode: 1 },
    kitsu: { episode: 5 },
    mappings: { tmdb_episode: { matchedBy: 'tmdb' } },
  };
  if (provider === 'unity') base.mappings.animeunity = ['/anime/200002-s2-marker'];
  if (provider === 'world') base.mappings.animeworld = ['/play/s2-marker'];
  if (provider === 'saturn') base.mappings.animesaturn = ['/anime/s2-marker'];
  // Include all three so each source resolves regardless of which provider under test.
  base.mappings.animeunity = base.mappings.animeunity || ['/anime/200002-s2-marker'];
  base.mappings.animeworld = base.mappings.animeworld || ['/play/s2-marker'];
  base.mappings.animesaturn = base.mappings.animesaturn || ['/anime/s2-marker'];
  return base;
}

function s1Payload() {
  return {
    requested: { season: 1, episode: 1 },
    kitsu: { episode: 1 },
    mappings: {
      animeunity: ['/anime/100001-s1-marker'],
      animeworld: ['/play/s1-marker'],
      animesaturn: ['/anime/s1-marker'],
      tmdb_episode: { matchedBy: 'tmdb' },
    },
  };
}

describe('anime_mapping_helper client-only + robust deadline', () => {
  let realFetch;
  let realSettings;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    realSettings = globalThis.SCRAPER_SETTINGS;
    delete globalThis.SCRAPER_SETTINGS;
  });
  afterEach(() => {
    if (typeof realFetch === 'undefined') delete globalThis.fetch;
    else globalThis.fetch = realFetch;
    if (typeof realSettings === 'undefined') delete globalThis.SCRAPER_SETTINGS;
    else globalThis.SCRAPER_SETTINGS = realSettings;
    clearAnimeCaches();
  });

  it('client-only: solo require relativo, nessuna dipendenza nuova, key default preservata', () => {
    const src = fs.readFileSync(HELPER_PATH, 'utf8');
    assert.ok(src.includes("require('./fetch_helper')"), 'must reuse fetch_helper via relative require');
    assert.ok(!/require\s*\(\s*['"][^.'"]/.test(src.replace(/require\s*\(\s*['"]\.\/fetch_helper['"]\s*\)/g, '')), 'only relative requires allowed');
    assert.ok(!/require\s*\(\s*['"](fs|path|os|undici|node:[^'"]*)['"]\s*\)/.test(src), 'no native requires');
    assert.ok(src.includes('68e094699525b18a70bab2f86b1fa706'), 'existing TMDB key preserved as default');
    assert.ok(src.includes('fetchWithTimeout'), 'must use robust fetchWithTimeout, not only createTimeoutSignal');
    // Must race json body too, not only signal.
    assert.ok(src.includes('Promise.race'), 'must deadline json body via Promise.race');
    const helper = require(HELPER_PATH);
    assert.equal(helper.TMDB_API_KEY_DEFAULT, '68e094699525b18a70bab2f86b1fa706');
    assert.equal(helper.TMDB_EXTERNAL_IDS_TIMEOUT_DEFAULT, 5000);
    assert.equal(helper.getTmdbResolveTimeout(undefined), 5000);
    assert.equal(helper.getTmdbResolveTimeout(30), 30);
  });

  it('safeSeen redige api_key senza ricorsione: route/season visibili, secret sparito, mai [unavailable]', () => {
    const sentinel = 'SENTINEL_API_KEY_XYZ789';
    const seen = [
      `https://api.themoviedb.org/3/tv/209867/external_ids?api_key=${sentinel}&language=it`,
      'https://animemapping.realbestia.com/imdb/tt22248376?s=2&ep=1&lang=it',
    ];
    const out = safeSeen(seen);
    assert.notEqual(out, '[unavailable]', 'safeSeen non deve ricadere su unavailable');
    assert.ok(out.includes('api_key=[REDACTED]'), 'chiave redatta, got=' + String(out).slice(0, 500));
    assert.ok(!out.includes(sentinel), 'sentinel mai in chiaro in diagnostica');
    assert.ok(out.includes('/external_ids'), 'route visibile, got=' + String(out).slice(0, 500));
    assert.ok(out.includes('209867'), 'id visibile');
    assert.ok(out.includes('s=2'), 'season visibile');
  });

  it('nessun log URL/key: errori generici senza secrets', async () => {
    const helper = require(HELPER_PATH);
    const logs = [];
    const origWarn = console.warn;
    const origError = console.error;
    const origLog = console.log;
    console.warn = (...a) => logs.push(a.join(' '));
    console.error = (...a) => logs.push(a.join(' '));
    console.log = (...a) => logs.push(a.join(' '));
    try {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ imdb_id: 'tt9990001' }) });
      const out = await helper.resolveTmdbTvToImdb('12345', { timeoutMs: 200 });
      assert.equal(out, 'tt9990001');
      globalThis.fetch = async () => { throw new Error('fail https://api.themoviedb.org/3/tv/123?api_key=SECRETKEY tt999'); };
      const out2 = await helper.resolveTmdbTvToImdb('12345', { timeoutMs: 200 });
      assert.equal(out2, null);
    } finally {
      console.warn = origWarn;
      console.error = origError;
      console.log = origLog;
    }
    const blob = logs.join('\n');
    assert.ok(!blob.includes('SECRETKEY'), 'must not log key: ' + blob.slice(0, 500));
    assert.ok(!blob.includes('api.themoviedb.org'), 'must not log URL: ' + blob.slice(0, 500));
    assert.ok(!blob.includes('tt999'), 'must not log id in helper error path: ' + blob.slice(0, 500));
  });

  it('abort missing: senza AbortController deadline via race comunque veloce', async () => {
    const helper = loadHelperInSandbox({ withAbort: false, fetchImpl: pendingFetch });
    const start = Date.now();
    const out = await helper.resolveTmdbTvToImdb('99991', { timeoutMs: 30 });
    assert.equal(out, null);
    assert.ok(Date.now() - start < 2000, 'must timeout quickly without Abort support');
  });

  it('fetch che ignora signal rispetta comunque deadline breve (Abort presente)', async () => {
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: pendingFetch });
    const start = Date.now();
    const out = await helper.resolveTmdbTvToImdb('99992', { timeoutMs: 30 });
    assert.equal(out, null);
    assert.ok(Date.now() - start < 2000);
  });

  it('hung json breve con timeout injection: json mai risolta -> null veloce, nessuna wait 5s', async () => {
    const hangingJsonFetch = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: hangingJsonFetch });
    const start = Date.now();
    const out = await helper.fetchJsonWithDeadline('https://example.test/hung', { timeoutMs: 30, fetchWithTimeoutImpl: async (url) => hangingJsonFetch(url) });
    assert.equal(out, null);
    assert.ok(Date.now() - start < 2000, 'hung json must respect short injected timeout');
    // Direct helper path with global fetch mock too.
    const direct = require(HELPER_PATH);
    globalThis.fetch = hangingJsonFetch;
    const start2 = Date.now();
    const out2 = await direct.resolveTmdbTvToImdb('99993', { timeoutMs: 30 });
    assert.equal(out2, null);
    assert.ok(Date.now() - start2 < 2000);
  });

  it('budget totale: fetch 50ms + json 50ms con timeout 80ms -> null entro budget (non successo tardivo)', async () => {
    const helper = require(HELPER_PATH);
    const slowFetchWithTimeout = async () => {
      await delay(50);
      return { ok: true, status: 200, json: async () => { await delay(50); return { imdb_id: 'tt1234567' }; } };
    };
    const start = Date.now();
    const out = await helper.fetchJsonWithDeadline('https://example.test/total', { timeoutMs: 80, fetchWithTimeoutImpl: slowFetchWithTimeout });
    const elapsed = Date.now() - start;
    assert.equal(out, null, 'total 100ms > budget 80ms must timeout to null, not late success');
    assert.ok(elapsed < 180, `must respect total budget quickly, elapsed=${elapsed}ms`);
  });

  it('fail-safe metadata: HTTP non-ok / non-json throw / hang -> null veloce', async () => {
    const helper = require(HELPER_PATH);
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    assert.equal(await helper.resolveTmdbTvToImdb('111', { timeoutMs: 50 }), null);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    assert.equal(await helper.resolveTmdbTvToImdb('111', { timeoutMs: 50 }), null);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) });
    assert.equal(await helper.resolveTmdbTvToImdb('111', { timeoutMs: 50 }), null);
    globalThis.fetch = pendingFetch;
    const start = Date.now();
    assert.equal(await helper.resolveTmdbTvToImdb('111', { timeoutMs: 30 }), null);
    assert.ok(Date.now() - start < 2000);
  });

  it('validazione seasonal: mismatch requested e mismapping evidente, ma matchedBy null + kitsu valido resta valido', () => {
    const helper = require(HELPER_PATH);
    const lookup = { provider: 'imdb', externalId: 'tt1000001', season: 2, episode: 1 };
    // Valid S2.
    assert.equal(helper.isValidSeasonalImdbMapping(s2Payload(), lookup), true);
    // Requested season mismatch.
    const mismatchS = JSON.parse(JSON.stringify(s2Payload()));
    mismatchS.requested.season = 1;
    assert.equal(helper.isValidSeasonalImdbMapping(mismatchS, lookup), false);
    // Requested episode mismatch.
    const mismatchE = JSON.parse(JSON.stringify(s2Payload()));
    mismatchE.requested.episode = 9;
    assert.equal(helper.isValidSeasonalImdbMapping(mismatchE, lookup), false);
    // matchedBy null + kitsu assente -> invalido (non estrarre S1).
    const badMap = JSON.parse(JSON.stringify(s2Payload()));
    badMap.mappings.tmdb_episode = { matchedBy: null };
    delete badMap.kitsu;
    assert.equal(helper.isValidSeasonalImdbMapping(badMap, lookup), false);
    // Ambiguo S>=2: soli paths+echo senza kitsu valido e senza matchedBy positivo -> invalido.
    const ambiguous = {
      requested: { season: 2, episode: 1 },
      mappings: {
        animeunity: ['/anime/100001-s1-marker'],
        animeworld: ['/play/s1-marker'],
        animesaturn: ['/anime/s1-marker'],
      },
    };
    assert.equal(helper.isValidSeasonalImdbMapping(ambiguous, lookup), false);
    const ambiguousNoEcho = {
      mappings: {
        animeunity: ['/anime/100001-s1-marker'],
        animeworld: ['/play/s1-marker'],
        animesaturn: ['/anime/s1-marker'],
      },
    };
    assert.equal(helper.isValidSeasonalImdbMapping(ambiguousNoEcho, lookup), false);
    // matchedBy null + kitsu valido (Frieren S2 style) -> valido, non reject.
    const goodFrieren = JSON.parse(JSON.stringify(s2Payload()));
    goodFrieren.mappings.tmdb_episode = { matchedBy: null };
    goodFrieren.kitsu = { episode: 130 };
    goodFrieren.requested = { season: 2, episode: 4 };
    assert.equal(helper.isValidSeasonalImdbMapping(goodFrieren, { provider: 'imdb', externalId: 'ttx', season: 2, episode: 4 }), true);
    // matchedBy positivo senza kitsu -> valido (una prova basta).
    const positiveNoKitsu = JSON.parse(JSON.stringify(s2Payload()));
    delete positiveNoKitsu.kitsu;
    positiveNoKitsu.mappings.tmdb_episode = { matchedBy: 'tmdb' };
    assert.equal(helper.isValidSeasonalImdbMapping(positiveNoKitsu, lookup), true);
    // Null payload -> invalido.
    assert.equal(helper.isValidSeasonalImdbMapping(null, lookup), false);
  });

  it('isSeasonal* solo tmdb/imdb + tv/series/anime + season>=2, mai hardcode titoli', () => {
    const src = fs.readFileSync(HELPER_PATH, 'utf8');
    assert.ok(!/frieren/i.test(src), 'no hardcode Frieren');
    const helper = require(HELPER_PATH);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 2, episode: 1 }, 'tv'), true);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 2, episode: 1 }, 'series'), true);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 2, episode: 1 }, 'anime'), true);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 1, episode: 1 }, 'tv'), false);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 0, episode: 1 }, 'tv'), false);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'tmdb', externalId: '1', season: 2, episode: 1 }, 'movie'), false);
    assert.equal(helper.isSeasonalTvLookup({ provider: 'imdb', externalId: 'tt1', season: 2, episode: 1 }, 'tv'), false);
    assert.equal(helper.isSeasonalImdbLookup({ provider: 'imdb', externalId: 'tt1', season: 2, episode: 1 }, 'tv'), true);
    assert.equal(helper.isSeasonalImdbLookup({ provider: 'imdb', externalId: 'tt1', season: 2, episode: 1 }, 'movie'), false);
    assert.equal(helper.isSeasonalImdbLookup({ provider: 'tmdb', externalId: '1', season: 2, episode: 1 }, 'tv'), false);
  });
});

function makeProviderFetch({ seen, imdbId = 'tt9990001', imdbPayload = null, tmdbPayload = null, kitsuPayload = null, externalMode = 'ok' }) {
  const imdbP = imdbPayload || s2Payload();
  const tmdbP = tmdbPayload || s1Payload();
  return async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('api.themoviedb.org/3/tv/') && u.includes('/external_ids')) {
      if (externalMode === 'http-fail') return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      if (externalMode === 'non-json') return { ok: true, status: 200, json: async () => { throw new Error('bad json'); }, text: async () => '' };
      if (externalMode === 'hang') return new Promise(() => {});
      if (externalMode === 'no-imdb') return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ imdb_id: imdbId }), text: async () => '' };
    }
    if (u.includes('animemapping.realbestia.com/imdb/')) {
      return { ok: true, status: 200, json: async () => imdbP, text: async () => '' };
    }
    if (u.includes('animemapping.realbestia.com/tmdb/')) {
      return { ok: true, status: 200, json: async () => tmdbP, text: async () => '' };
    }
    if (u.includes('animemapping.realbestia.com/kitsu/')) {
      const kp = kitsuPayload || { requested: { episode: 1 }, kitsu: { episode: 1 }, mappings: { animeunity: ['/anime/1-k'], animeworld: ['/play/k'], animesaturn: ['/anime/k'] } };
      return { ok: true, status: 200, json: async () => kp, text: async () => '' };
    }
    if (u.includes('animemapping.realbestia.com/')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    // Anime site pages: record but fail soft (no streams needed for precedence asserts).
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}

describe('seasonal TMDB S>=2 IMDb-first (all3 sources)', () => {
  let realFetch;
  let realSettings;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    realSettings = globalThis.SCRAPER_SETTINGS;
    delete globalThis.SCRAPER_SETTINGS;
  });
  afterEach(() => {
    if (typeof realFetch === 'undefined') delete globalThis.fetch;
    else globalThis.fetch = realFetch;
    if (typeof realSettings === 'undefined') delete globalThis.SCRAPER_SETTINGS;
    else globalThis.SCRAPER_SETTINGS = realSettings;
    clearAnimeCaches();
  });

  for (const [key, modKey, s2marker, s1marker] of [
    ['animeunity', 'unity', 's2-marker', 's1-marker'],
    ['animeworld', 'world', 's2-marker', 's1-marker'],
    ['animesaturn', 'saturn', 's2-marker', 's1-marker'],
  ]) {
    it(`${key}: tmdb S2 tv -> external_ids + imdb mapping S2, MAI tmdb mapping S1`, async () => {
      const { helper, unity, world, saturn } = loadFresh();
      void helper;
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000001' });
      const out = await mod.getStreams('tmdb:555001', 'tv', 2, 1);
      assert.ok(Array.isArray(out));
      const hasExternal = seen.some((u) => u.includes('/external_ids') && u.includes('555001'));
      assert.ok(hasExternal, 'must resolve TMDB->IMDb via external_ids, seen=' + safeSeen(seen));
      const hasImdbMapping = seen.some((u) => u.includes('/imdb/tt9000001') && u.includes('s=2'));
      assert.ok(hasImdbMapping, 'must call IMDb mapping S2 with same season, seen=' + safeSeen(seen));
      const hasTmdbMapping = seen.some((u) => u.includes('/tmdb/555001'));
      assert.ok(!hasTmdbMapping, 'MUST NOT call TMDB mapping (would risk S1), seen=' + safeSeen(seen));
      const hasS1Anime = seen.some((u) => u.includes(s1marker));
      assert.ok(!hasS1Anime, 'MUST NOT fetch S1 anime path, seen=' + safeSeen(seen));
    });

    it(`${key}: metadata fail (http/non-json/hang) -> [] senza S1 extraction`, async () => {
      for (const mode of ['http-fail', 'non-json', 'no-imdb']) {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const seen = [];
        globalThis.fetch = makeProviderFetch({ seen, externalMode: mode });
        const out = await mod.getStreams('tmdb:555002', 'tv', 2, 3);
        assert.deepEqual(out, [], `${key} mode ${mode} must return []`);
        assert.ok(!seen.some((u) => u.includes(s1marker)), `${key} mode ${mode} must not fetch S1, seen=${safeSeen(seen)}`);
        assert.ok(!seen.some((u) => u.includes('/tmdb/555002') && u.includes('animemapping')), `${key} mode ${mode} must not fallback TMDB mapping`);
        assert.ok(!seen.some((u) => u.includes('animeunity.so') || u.includes('animeworld.ac') || u.includes('animesaturn.net')), `${key} mode ${mode} must not fetch any streaming paths globally`);
      }
      // Hang with short injected timeout (no 5s wait).
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const seen = [];
        globalThis.SCRAPER_SETTINGS = { animeMappingTmdbTimeout: 30 };
        globalThis.fetch = makeProviderFetch({ seen, externalMode: 'hang' });
        const start = Date.now();
        const out = await mod.getStreams('tmdb:555003', 'tv', 2, 1);
        assert.deepEqual(out, []);
        assert.ok(Date.now() - start < 2000, `${key} hang must fail fast via injected timeout`);
        assert.ok(!seen.some((u) => u.includes(s1marker)), 'hang must not fetch S1');
        assert.ok(!seen.some((u) => u.includes('animeunity.so') || u.includes('animeworld.ac') || u.includes('animesaturn.net')), 'hang must not fetch any streaming paths globally');
      }
    });

    it(`${key}: seasonal IMDb mismatch (requested S1 vs lookup S2) -> [] senza S1`, async () => {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const bad = s2Payload();
      bad.requested = { season: 1, episode: 1 };
      const seen = [];
      // Converted path: tmdb S2 -> imdb mismatch.
      globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000002', imdbPayload: bad });
      const out = await mod.getStreams('tmdb:555004', 'tv', 2, 1);
      assert.deepEqual(out, [], 'converted mismatch must return []');
      assert.ok(!seen.some((u) => u.includes(s1marker) && !u.includes('animemapping')), 'converted mismatch must not fetch S1 anime');
      // Direct path: imdb S2 mismatch.
      const seen2 = [];
      globalThis.fetch = makeProviderFetch({ seen: seen2, imdbPayload: bad });
      const out2 = await mod.getStreams('imdb:tt9000002', 'tv', 2, 1);
      assert.deepEqual(out2, [], 'direct mismatch must return []');
      assert.ok(!seen2.some((u) => u.includes(s1marker) && !u.includes('animemapping')), 'direct mismatch must not fetch S1 anime');
    });

    it(`${key}: matchedBy null + kitsu assente -> [] ; matchedBy null + kitsu valido (S2) -> tenta estrazione`, async () => {
      // Evident mismapping.
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const bad = s2Payload();
        bad.mappings.tmdb_episode = { matchedBy: null };
        delete bad.kitsu;
        const seen = [];
        globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000003', imdbPayload: bad });
        const out = await mod.getStreams('tmdb:555005', 'tv', 2, 2);
        assert.deepEqual(out, []);
        assert.ok(!seen.some((u) => u.includes(s1marker) && !u.includes('animemapping')));
      }
      // Valid Frieren-style: matchedBy null but kitsu episode present -> must fetch S2 path.
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const good = s2Payload();
        good.mappings.tmdb_episode = { matchedBy: null };
        good.kitsu = { episode: 130 };
        good.requested = { season: 2, episode: 4 };
        const seen = [];
        globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000004', imdbPayload: good });
        const out = await mod.getStreams('tmdb:555006', 'tv', 2, 4);
        assert.ok(Array.isArray(out));
        assert.ok(seen.some((u) => u.includes(s2marker)), 'valid S2 with kitsu must fetch S2 path, seen=' + safeSeen(seen));
      }
      // Realistic Frieren fixture: kitsu.episode 1 + matchedBy null -> must fetch S2 path.
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const frieren = {
          requested: { season: 2, episode: 1 },
          kitsu: { episode: 1 },
          mappings: {
            animeunity: ['/anime/200002-s2-marker'],
            animeworld: ['/play/s2-marker'],
            animesaturn: ['/anime/s2-marker'],
            tmdb_episode: { matchedBy: null },
          },
        };
        const seen = [];
        globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000006', imdbPayload: frieren });
        const out = await mod.getStreams('tmdb:555008', 'tv', 2, 1);
        assert.ok(Array.isArray(out));
        assert.ok(seen.some((u) => u.includes(s2marker)), `${key} realistic Frieren S2 must fetch S2 path, seen=` + safeSeen(seen));
        assert.ok(!seen.some((u) => u.includes(s1marker)), `${key} realistic Frieren must not fetch S1`);
      }
    });

    it(`${key}: S1paths + requestedS2 senza markers (no kitsu, no matchedBy) -> []`, async () => {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const ambiguous = {
        requested: { season: 2, episode: 1 },
        mappings: {
          animeunity: ['/anime/100001-s1-marker'],
          animeworld: ['/play/s1-marker'],
          animesaturn: ['/anime/s1-marker'],
        },
      };
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000007', imdbPayload: ambiguous });
      const out = await mod.getStreams('tmdb:555009', 'tv', 2, 1);
      assert.deepEqual(out, [], `${key} ambiguous S1paths+requestedS2 without proofs must return []`);
      assert.ok(!seen.some((u) => u.includes(s1marker) && !u.includes('animemapping')), `${key} ambiguous must not fetch S1 anime, seen=` + safeSeen(seen));
    });

    it(`${key}: season3 senza stagione reale (mapping S1/empty) -> [] senza S1`, async () => {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const emptyImdb = { requested: { season: 3, episode: 1 }, kitsu: {}, mappings: {} };
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000005', imdbPayload: emptyImdb, tmdbPayload: s1Payload() });
      const out = await mod.getStreams('tmdb:555007', 'tv', 3, 1);
      assert.deepEqual(out, [], 'S3 with empty IMDb must not fallback to S1');
      assert.ok(!seen.some((u) => u.includes('/tmdb/555007') && u.includes('animemapping')), 'S3 must not call TMDB mapping');
      assert.ok(!seen.some((u) => u.includes(s1marker) && !u.includes('animemapping')), 'S3 must not fetch S1 anime');
    });
  }

  it('precedence composite: tmdb:ID:S:E batte season/episode args (all3)', async () => {
    for (const [key] of [['animeunity'], ['animeworld'], ['animesaturn']]) {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen, imdbId: 'tt9000010' });
      await mod.getStreams('tmdb:777001:2:5', 'tv', 1, 1);
      const imdbCall = seen.find((u) => u.includes('/imdb/tt9000010'));
      assert.ok(imdbCall && imdbCall.includes('s=2') && imdbCall.includes('ep=5'), `${key} composite must win, got ${imdbCall} seen=${safeSeen(seen)}`);
      // Riprova: composite seasonal deve restare IMDb-first (external_ids + no tmdb mapping).
      assert.ok(seen.some((u) => u.includes('/external_ids') && u.includes('777001')), `${key} composite seasonal must resolve via external_ids`);
      assert.ok(!seen.some((u) => u.includes('/tmdb/777001') && u.includes('animemapping')), `${key} composite seasonal must not call tmdb mapping`);
    }
  });

  it('bare ttID:S:E stesso parse di imdb:tt composite (all3)', async () => {
    for (const [key] of [['animeunity'], ['animeworld'], ['animesaturn']]) {
      const mk = () => { const p = s2Payload(); p.requested = { season: 2, episode: 3 }; p.kitsu = { episode: 3 }; return p; };
      // Bare call with fresh modules (evita cache mapping).
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const seenBare = [];
        globalThis.fetch = makeProviderFetch({ seen: seenBare, imdbPayload: mk() });
        await mod.getStreams('tt9000020:2:3', 'tv', 1, 1);
        const bareCall = seenBare.find((u) => u.includes('/imdb/tt9000020'));
        assert.ok(bareCall && bareCall.includes('s=2') && bareCall.includes('ep=3'), `${key} bare tt composite must parse like imdb:, got ${bareCall}`);
      }
      // Prefixed call with fresh modules e ID distinto per evitare cache residua.
      {
        const { unity, world, saturn } = loadFresh();
        const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
        const seenPref = [];
        globalThis.fetch = makeProviderFetch({ seen: seenPref, imdbPayload: mk() });
        await mod.getStreams('imdb:tt9000021:2:3', 'tv', 1, 1);
        const prefCall = seenPref.find((u) => u.includes('/imdb/tt9000021'));
        assert.ok(prefCall && prefCall.includes('s=2') && prefCall.includes('ep=3'), `${key} prefixed must match bare`);
      }
    }
  });

  it('direct IMDb S2 senza TMDB fallback quando mapping vuoto (all3)', async () => {
    for (const [key] of [['animeunity'], ['animeworld'], ['animesaturn']]) {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const seen = [];
      const emptyImdb = { requested: { season: 2, episode: 1 }, kitsu: { episode: 1 }, mappings: {} };
      globalThis.fetch = makeProviderFetch({ seen, imdbPayload: emptyImdb, tmdbPayload: s1Payload() });
      const out = await mod.getStreams('imdb:tt9000030', 'tv', 2, 1);
      assert.deepEqual(out, []);
      assert.ok(!seen.some((u) => u.includes('/tmdb/') && u.includes('animemapping')), `${key} direct S2 empty must NOT fallback to TMDB, seen=${safeSeen(seen)}`);
    }
  });

  it('S1/special0/movie/direct Kitsu invariati: tmdb mapping diretto, imdb->tmdb fallback solo non-seasonal', async () => {
    // TMDB S1 tv: direct tmdb mapping, no external_ids.
    for (const [key] of [['animeunity'], ['animeworld'], ['animesaturn']]) {
      const { unity, world, saturn } = loadFresh();
      const mod = key === 'animeunity' ? unity : key === 'animeworld' ? world : saturn;
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen });
      await mod.getStreams('tmdb:888001', 'tv', 1, 1);
      assert.ok(seen.some((u) => u.includes('/tmdb/888001') && u.includes('animemapping')), `${key} S1 must call tmdb mapping`);
      assert.ok(!seen.some((u) => u.includes('/external_ids')), `${key} S1 must NOT call external_ids`);
    }
    // Special 0.
    {
      const { unity } = loadFresh();
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen });
      await unity.getStreams('tmdb:888002', 'tv', 0, 1);
      assert.ok(seen.some((u) => u.includes('/tmdb/888002')), 'special0 must call tmdb mapping');
      assert.ok(!seen.some((u) => u.includes('/external_ids')), 'special0 must NOT call external_ids');
    }
    // Movie type with season 2: not seasonal, direct tmdb.
    {
      const { unity } = loadFresh();
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen });
      await unity.getStreams('tmdb:888003', 'movie', 2, 1);
      assert.ok(!seen.some((u) => u.includes('/external_ids')), 'movie must NOT trigger seasonal IMDb-first');
    }
    // Direct kitsu: kitsu mapping, no external_ids.
    {
      const { unity } = loadFresh();
      const seen = [];
      globalThis.fetch = makeProviderFetch({ seen });
      await unity.getStreams('kitsu:1234', 'tv', 2, 1);
      assert.ok(seen.some((u) => u.includes('/kitsu/1234')), 'kitsu must call kitsu mapping');
      assert.ok(!seen.some((u) => u.includes('/external_ids')), 'kitsu must NOT call external_ids');
    }
    // IMDb S1 empty -> fallback TMDB preserved.
    {
      const { unity } = loadFresh();
      const seen = [];
      const emptyImdb = { requested: { season: 1, episode: 1 }, mappings: { ids: { tmdb: '999888' } } };
      globalThis.fetch = makeProviderFetch({ seen, imdbPayload: emptyImdb, tmdbPayload: s1Payload() });
      await unity.getStreams('imdb:tt9000040', 'tv', 1, 1);
      assert.ok(seen.some((u) => u.includes('/tmdb/') && u.includes('animemapping')), 'S1 imdb empty must fallback to TMDB');
    }
  });
});
