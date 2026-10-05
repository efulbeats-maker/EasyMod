'use strict';
// Task B: bundle reali in VM senza process/require native, mock integrale offline.
// Frieren S2E1: tmdb:209867 s2e1 -> external_ids tt22248376 -> imdb mapping
// kitsu 49240 ep1 matchedBy null paths S2. Assert tutti e 3 fetch path S2 e
// NO path S1 / mapping TMDB. Almeno animeunity restituisce stream URL S2E1
// con HTML/JSON mocks (prova contenuto, non solo routing).
// S3 ambiguous pathS1+echoS3 senza valid episode/matchedBy -> [] tutti e 3.
// metadata 404 safe, bare composite args precedence. Niente live requests.
// Run: node --test tests/anime-frieren-bundle.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PROVIDERS_DIR = path.join(ROOT, 'providers');

const FRIEREN_TMDB = '209867';
const FRIEREN_IMDB = 'tt22248376';
const FRIEREN_KITSU_ID = 49240;

const S2_UNITY_PATH = '/anime/200002-frieren-s2';
const S2_WORLD_PATH = '/play/frieren-s2-abc123';
const S2_SATURN_PATH = '/anime/frieren-s2';
const S1_MARKER = 's1-marker';

function safeSeen(seen) {
  try {
    const text = Array.isArray(seen) ? seen.join(' | ') : String(seen ?? '');
    return text.replace(/api_key=[^&"'`\s]*/gi, 'api_key=[REDACTED]');
  } catch (_) {
    return '[unavailable]';
  }
}

function loadBundleInVM(bundlePath, { fetchImpl, settings = {} } = {}) {
  const code = fs.readFileSync(bundlePath, 'utf8');
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
  };
  if (typeof atob === 'function') sandbox.atob = atob;
  if (typeof btoa === 'function') sandbox.btoa = btoa;
  if (typeof Buffer !== 'undefined') sandbox.Buffer = Buffer;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = undefined;
  sandbox.exports = sandbox.module.exports;
  // Niente require reale in sandbox Nuvio.
  // Niente process: non definito di proposito.
  if (typeof fetchImpl !== 'undefined') sandbox.fetch = fetchImpl;
  sandbox.navigator = { product: 'ReactNative' };
  sandbox.global.navigator = sandbox.navigator;
  sandbox.globalThis.navigator = sandbox.navigator;
  sandbox.SCRAPER_SETTINGS = settings;
  sandbox.globalThis.SCRAPER_SETTINGS = settings;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n//# sourceURL=' + path.basename(bundlePath), sandbox, { timeout: 5000 });
  assert.equal(typeof sandbox.process, 'undefined', 'VM senza process');
  assert.equal(typeof sandbox.require, 'undefined', 'VM senza require');
  return { api: sandbox.module.exports, code, sandbox };
}

function frierenS2Payload() {
  return {
    requested: { season: 2, episode: 1 },
    kitsu: { id: FRIEREN_KITSU_ID, episode: 1 },
    mappings: {
      animeunity: [S2_UNITY_PATH],
      animeworld: [S2_WORLD_PATH],
      animesaturn: [S2_SATURN_PATH],
      tmdb_episode: { matchedBy: null },
    },
  };
}

function unityAnimeHtml() {
  const episodes = JSON.stringify([
    { id: 9001, number: '1', link: S2_UNITY_PATH, file_name: 'frieren-s2-e1', embed_url: 'https://www.animeunity.so/embed/9001' },
  ]);
  return (
    '<html><head><title>Frieren S2 - AnimeUnity</title>' +
    '<meta property="og:title" content="Frieren S2"></head><body>' +
    "<video-player anime='{\"title\":\"Frieren\"}' episode='{\"id\":9001}' episodes='" +
    episodes.replace(/'/g, '&#39;') +
    "' embed_url=\"https://www.animeunity.so/embed/9001\" episodes_count=\"28\"></video-player>" +
    '</body></html>'
  );
}

function unityEmbedHtml() {
  return '<html><body><video><source src="https://cdn.test/frieren-s2e1-1080p.mp4"></video></body></html>';
}

function worldAnimeHtml() {
  return (
    '<html><head><title>Frieren S2 - AnimeWorld</title></head><body>' +
    '<a data-episode-num="1" data-id="aw-ep-1" data-num="1">Ep 1</a>' +
    '</body></html>'
  );
}

function saturnAnimeHtml() {
  return (
    '<html><head><title>Frieren S2 - AnimeSaturn</title></head><body>' +
    '<h1>Frieren S2</h1>' +
    '<a href="/episode/frieren-s2/ep-1" title="Episodio 1">Episodio 1</a>' +
    '</body></html>'
  );
}

function saturnWatchHtml() {
  return '<html><body><video><source src="https://cdn.test/frieren-s2e1-saturn-720p.mp4"></video></body></html>';
}

function jsonRes(payload) {
  return {
    ok: true, status: 200,
    headers: { get: () => '' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function htmlRes(html) {
  return {
    ok: true, status: 200,
    headers: { get: () => '' },
    json: async () => { throw new Error('not json'); },
    text: async () => html,
  };
}

function notFound() {
  return { ok: false, status: 404, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
}

function makeFrierenFetch(seen, { imdbPayload = null, externalMode = 'ok' } = {}) {
  const imdbP = imdbPayload || frierenS2Payload();
  return async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('api.themoviedb.org/3/tv/') && u.includes('/external_ids')) {
      if (externalMode === 'http-fail') return notFound();
      if (externalMode === 'non-json') return { ok: true, status: 200, headers: { get: () => '' }, json: async () => { throw new Error('bad json'); }, text: async () => '' };
      if (externalMode === 'hang') return new Promise(() => {});
      if (externalMode === 'no-imdb') return jsonRes({});
      if (u.includes('/tv/' + FRIEREN_TMDB + '/external_ids')) return jsonRes({ imdb_id: FRIEREN_IMDB });
      return jsonRes({ imdb_id: 'tt9000001' });
    }
    if (u.includes('animemapping.realbestia.com/imdb/' + FRIEREN_IMDB)) return jsonRes(imdbP);
    if (u.includes('animemapping.realbestia.com/imdb/')) return jsonRes(imdbP);
    if (u.includes('animemapping.realbestia.com/tmdb/')) {
      return jsonRes({ requested: { season: 1, episode: 1 }, kitsu: { episode: 1 }, mappings: { animeunity: ['/anime/1-' + S1_MARKER], animeworld: ['/play/' + S1_MARKER], animesaturn: ['/anime/' + S1_MARKER] } });
    }
    if (u.includes('animemapping.realbestia.com/')) return jsonRes({});
    if (u === 'https://www.animeunity.so' + S2_UNITY_PATH) return htmlRes(unityAnimeHtml());
    if (u === 'https://www.animeunity.so/embed/9001') return htmlRes(unityEmbedHtml());
    if (u === 'https://www.animeworld.ac' + S2_WORLD_PATH) return htmlRes(worldAnimeHtml());
    if (u.startsWith('https://www.animeworld.ac/api/episode/info')) return jsonRes({ grabber: 'https://cdn.test/frieren-s2e1-aw-720p.mp4' });
    if (u === 'https://www.animesaturn.net' + S2_SATURN_PATH) return htmlRes(saturnAnimeHtml());
    if (u.startsWith('https://www.animesaturn.net/anime/frieren-s2/ep-1')) return htmlRes(saturnWatchHtml());
    if (u.startsWith('https://www.animesaturn.net/watch')) return htmlRes(saturnWatchHtml());
    if (u.includes('cdn.test/')) return notFound();
    if (u.includes('animeunity.so') || u.includes('animeworld.ac') || u.includes('animesaturn.net')) return notFound();
    return notFound();
  };
}

function assertOfflineOnly(seen) {
  for (const u of seen) {
    const okHost =
      u.includes('api.themoviedb.org') ||
      u.includes('animemapping.realbestia.com') ||
      u.includes('animeunity.so') ||
      u.includes('animeworld.ac') ||
      u.includes('animesaturn.net') ||
      u.includes('cdn.test/');
    assert.ok(okHost, 'solo host mockati, niente live: ' + safeSeen(u));
  }
}

describe('Frieren S2E1 bundle reali (tmdb 209867 -> tt22248376, kitsu 49240 ep1 matchedBy null)', () => {
  for (const p of ['animeunity', 'animeworld', 'animesaturn']) {
    it(`${p}: tmdb:209867 tv s2e1 fetch path S2, MAI path S1 / mapping TMDB`, async () => {
      const seen = [];
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
        fetchImpl: makeFrierenFetch(seen),
        settings: {},
      });
      const out = await api.getStreams('tmdb:' + FRIEREN_TMDB, 'tv', 2, 1);
      assert.ok(Array.isArray(out));
      assert.ok(seen.some((u) => u.includes('/external_ids') && u.includes(FRIEREN_TMDB)), 'external_ids 209867, seen=' + safeSeen(seen).slice(0, 2000));
      assert.ok(seen.some((u) => u.includes('/imdb/' + FRIEREN_IMDB) && u.includes('s=2')), 'imdb mapping S2, seen=' + safeSeen(seen).slice(0, 2000));
      assert.ok(!seen.some((u) => u.includes('/tmdb/') && u.includes('animemapping')), 'MAI mapping TMDB, seen=' + safeSeen(seen).slice(0, 2000));
      const s2hit =
        p === 'animeunity' ? seen.some((u) => u.includes(S2_UNITY_PATH)) :
        p === 'animeworld' ? seen.some((u) => u.includes(S2_WORLD_PATH)) :
        seen.some((u) => u.includes(S2_SATURN_PATH));
      assert.ok(s2hit, `${p} deve fetchare path S2, seen=` + safeSeen(seen).slice(0, 2000));
      assert.ok(!seen.some((u) => u.includes(S1_MARKER) && !u.includes('animemapping')), `${p} MAI path S1, seen=` + safeSeen(seen).slice(0, 2000));
      assertOfflineOnly(seen);
    });
  }

  it('animeunity: contenuto reale S2E1 con HTML/JSON mocks (non solo routing)', async () => {
    const seen = [];
    const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, 'animeunity.js'), {
      fetchImpl: makeFrierenFetch(seen),
      settings: {},
    });
    const out = await api.getStreams('tmdb:' + FRIEREN_TMDB, 'tv', 2, 1);
    assert.ok(Array.isArray(out) && out.length >= 1, 'animeunity deve restituire stream S2E1, got=' + JSON.stringify(out).slice(0, 1000));
    const urls = out.map((s) => String(s.url || ''));
    assert.ok(urls.some((u) => u.includes('frieren-s2e1') && u.endsWith('.mp4')), 'stream URL S2E1 atteso, got=' + urls.join(','));
    const titles = out.map((s) => String(s.title || ''));
    assert.ok(titles.some((t) => /Ep 1/.test(t)), 'titolo Ep 1 atteso, got=' + titles.join(' | '));
    assertOfflineOnly(seen);
  });

  it('S3 ambiguous pathS1+echoS3 senza valid episode/matchedBy -> [] tutti e 3', async () => {
    for (const p of ['animeunity', 'animeworld', 'animesaturn']) {
      const ambiguousS3 = {
        requested: { season: 3, episode: 1 },
        mappings: {
          animeunity: ['/anime/100001-' + S1_MARKER],
          animeworld: ['/play/' + S1_MARKER],
          animesaturn: ['/anime/' + S1_MARKER],
        },
      };
      const seen = [];
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
        fetchImpl: makeFrierenFetch(seen, { imdbPayload: ambiguousS3 }),
        settings: {},
      });
      const out = await api.getStreams('tmdb:' + FRIEREN_TMDB, 'tv', 3, 1);
      assert.ok(Array.isArray(out), `${p} S3 deve restituire array`);
      assert.equal(out.length, 0, `${p} S3 ambiguo deve restituire []`);
      assert.ok(!seen.some((u) => u.includes(S1_MARKER) && !u.includes('animemapping')), `${p} S3 non deve fetchare S1`);
      assert.ok(!seen.some((u) => u.includes('/tmdb/') && u.includes('animemapping')), `${p} S3 non deve fallback TMDB`);
      assertOfflineOnly(seen);
    }
  });

  it('metadata 404 safe -> [] senza S1 (tutti e 3)', async () => {
    for (const p of ['animeunity', 'animeworld', 'animesaturn']) {
      const seen = [];
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
        fetchImpl: makeFrierenFetch(seen, { externalMode: 'http-fail' }),
        settings: {},
      });
      const out = await api.getStreams('tmdb:' + FRIEREN_TMDB, 'tv', 2, 1);
      assert.ok(Array.isArray(out), `${p} 404 deve restituire array`);
      assert.equal(out.length, 0, `${p} metadata 404 deve restituire []`);
      assert.ok(!seen.some((u) => u.includes(S1_MARKER) && !u.includes('animemapping')), `${p} 404 non deve fetchare S1`);
      assertOfflineOnly(seen);
    }
  });

  it('bare composite e precedence: tt:S:E == imdb:tt:S:E, composite batte args', async () => {
    for (const p of ['animeunity', 'animeworld', 'animesaturn']) {
      const mk = () => {
        const pl = frierenS2Payload();
        pl.requested = { season: 2, episode: 3 };
        pl.kitsu = { id: FRIEREN_KITSU_ID, episode: 3 };
        return pl;
      };
      let seenBare = [];
      {
        const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
          fetchImpl: makeFrierenFetch(seenBare, { imdbPayload: mk() }),
          settings: {},
        });
        await api.getStreams(FRIEREN_IMDB + ':2:3', 'tv', 1, 1);
        const call = seenBare.find((u) => u.includes('/imdb/' + FRIEREN_IMDB));
        assert.ok(call && call.includes('s=2') && call.includes('ep=3'), `${p} bare composite deve valere s=2 ep=3, got ` + safeSeen(call));
      }
      let seenPref = [];
      {
        const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
          fetchImpl: makeFrierenFetch(seenPref, { imdbPayload: mk() }),
          settings: {},
        });
        await api.getStreams('imdb:' + FRIEREN_IMDB + ':2:3', 'tv', 1, 1);
        const call = seenPref.find((u) => u.includes('/imdb/' + FRIEREN_IMDB));
        assert.ok(call && call.includes('s=2') && call.includes('ep=3'), `${p} prefixed deve eguagliare bare, got ` + safeSeen(call));
      }
      let seenComp = [];
      {
        const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
          fetchImpl: makeFrierenFetch(seenComp, { imdbPayload: mk() }),
          settings: {},
        });
        await api.getStreams('tmdb:' + FRIEREN_TMDB + ':2:3', 'tv', 1, 1);
        const call = seenComp.find((u) => u.includes('/imdb/' + FRIEREN_IMDB));
        assert.ok(call && call.includes('s=2') && call.includes('ep=3'), `${p} tmdb composite deve battere args s=1, got ` + safeSeen(call));
        assert.ok(seenComp.some((u) => u.includes('/external_ids') && u.includes(FRIEREN_TMDB)), `${p} composite seasonal via external_ids, seen=` + safeSeen(seenComp).slice(0, 500));
      }
    }
  });

  it('sanitizzazione diagnostica: safeSeen redige api_key, nessun valore reale nei messaggi', async () => {
    const sentinel = 'SENTINEL_TMDB_KEY_ABC123';
    const fakeSeen = [
      `https://api.themoviedb.org/3/tv/209867/external_ids?api_key=${sentinel}&language=it`,
      'https://animemapping.realbestia.com/imdb/tt22248376?s=2&ep=1&lang=it',
    ];
    const redacted = safeSeen(fakeSeen);
    assert.ok(redacted.includes('api_key=[REDACTED]'), 'chiave redatta, got=' + redacted.slice(0, 500));
    assert.ok(!redacted.includes(sentinel), 'sentinel mai in chiaro in diagnostica');
    assert.ok(!/SENTINEL_TMDB_KEY/.test(redacted), 'nessuna traccia sentinel');
    // Flusso reale: la diagnostica redatta non deve contenere alcuna api_key in chiaro.
    const seen = [];
    const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, 'animeunity.js'), {
      fetchImpl: makeFrierenFetch(seen),
      settings: {},
    });
    const out = await api.getStreams('tmdb:' + FRIEREN_TMDB, 'tv', 2, 1);
    assert.ok(Array.isArray(out) && out.length >= 1);
    const real = safeSeen(seen);
    assert.ok(!/api_key=(?!\[REDACTED\])[^\s|]+/i.test(real), 'nessuna api_key in chiaro nel flusso reale, got=' + real.slice(0, 500));
    assert.ok(real.includes('api_key=[REDACTED]') || !/api_key=/i.test(seen.join(' ')), 'chiave reale solo redatta');
  });
});
