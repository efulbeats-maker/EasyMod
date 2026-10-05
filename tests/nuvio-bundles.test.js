'use strict';
// Offline tests per compito 3 ciclo1 (SOLO plugin): bundle reali caricati integralmente in VM.
// Eseguire con (NODE_PATH per risoluzione esbuild da installazione standard):
//   NODE_PATH=<deps> node --test tests/nuvio-bundles.test.js
// Oppure dopo normale `npm install`: `node --test tests/nuvio-bundles.test.js`
// Nessuna rete verso scraper: ogni fetch e' mockata, timeout brevi.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const PROVIDERS_DIR = path.join(ROOT, 'providers');
const SRC_DIR = path.join(ROOT, 'src');

const NUVIO_SCRAPERS = [
  'guardoserie',
  'animeunity',
  'animeworld',
  'animesaturn',
  'streamingcommunity',
  'altadefinizionestreaming'
];

// Solo per classificare i tentativi registrati dallo stub (nessun require reale).
const OPTIONAL_ATTEMPTS = new Set(['undici', 'crypto']);
const FORBIDDEN_ATTEMPTS = new Set([
  'fs', 'path', 'os', 'child_process', 'axios',
  'http', 'https', 'http2', 'url', 'util', 'zlib',
  'stream', 'events', 'assert', 'cheerio', 'cheerio-select',
  'sql.js', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth',
  'form-data', 'https-proxy-agent', 'crypto-js'
]);

function resolveEsbuild() {
  // Risoluzione standard via NODE_PATH (impostato nel comando) o node_modules di progetto.
  return require('esbuild');
}

function nuvioBuildOptions(entryPoint, minify = false) {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    minify,
    platform: 'neutral',
    target: ['es2016'],
    format: 'cjs',
    define: { 'process.env.NODE_ENV': minify ? '"production"' : '"development"' },
    external: ['undici', 'fs', 'path', 'https', 'http', 'http2', 'url', 'crypto', 'util', 'zlib', 'stream', 'events', 'assert', 'sql.js', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth', 'axios', 'child_process'],
    nodePaths: process.env.NODE_PATH ? String(process.env.NODE_PATH).split(path.delimiter).filter(Boolean) : [],
    write: false
  };
}

function entryFor(provider) {
  if (provider === 'guardoserie') return path.join(SRC_DIR, 'guardoserie', 'nuvio.js');
  return path.join(SRC_DIR, provider, 'index.js');
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Carica l'intero bundle in VM senza process.
// requireStub === null: nessun global require nel sandbox (prova carico senza require reale).
// requireStub === function: stub conteggiato che deve sempre lanciare (nessuna dipendenza servita).
function loadBundleInVM(bundlePath, { fetchImpl, settings = {}, nuvio = true, requireStub = undefined, extraGlobals = {} } = {}) {
  const code = fs.readFileSync(bundlePath, 'utf8');
  const attempts = [];
  let sandboxRequire;
  if (requireStub === null) {
    sandboxRequire = undefined;
  } else if (typeof requireStub === 'function') {
    sandboxRequire = (...a) => {
      if (a[0] !== undefined) attempts.push(String(a[0]));
      return requireStub(...a);
    };
  } else {
    sandboxRequire = (...a) => {
      if (a[0] !== undefined) attempts.push(String(a[0]));
      throw new Error('require not available in Nuvio sandbox: ' + String(a[0]));
    };
  }
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
    ...extraGlobals
  };
  if (typeof atob === 'function') sandbox.atob = atob;
  if (typeof btoa === 'function') sandbox.btoa = btoa;
  if (typeof Buffer !== 'undefined') sandbox.Buffer = Buffer;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = undefined;
  sandbox.exports = sandbox.module.exports;
  if (typeof sandboxRequire !== 'undefined') sandbox.require = sandboxRequire;
  if (typeof fetchImpl !== 'undefined') sandbox.fetch = fetchImpl;
  if (nuvio) {
    sandbox.navigator = { product: 'ReactNative' };
    sandbox.global.navigator = sandbox.navigator;
    sandbox.globalThis.navigator = sandbox.navigator;
  }
  sandbox.SCRAPER_SETTINGS = settings;
  sandbox.globalThis.SCRAPER_SETTINGS = settings;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n//# sourceURL=' + path.basename(bundlePath), sandbox, { timeout: 5000 });
  return { api: sandbox.module.exports, code, attempts, sandbox };
}

const throwingFetch = async () => { throw new Error('offline-mock-fetch-error'); };
const okEmptyFetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });

function sampleArgs(provider) {
  if (provider === 'guardoserie') return ['tt123', 'movie', 1, 1];
  if (provider === 'streamingcommunity') return ['tt0133093', 'movie', 1, 1];
  if (provider === 'altadefinizionestreaming') return ['tt0133093', 'movie', 1, 1];
  return ['kitsu:1', 'tv', 1, 1];
}

function altaMockFetch(seen) {
  return async (url, opts = {}) => {
    seen.push({ url: String(url), headers: { ...(opts.headers || {}) } });
    const u = String(url);
    if (u.includes('api.themoviedb.org/3/find/')) {
      return { ok: true, status: 200, json: async () => ({ movie_results: [{ id: 123 }], tv_results: [] }), text: async () => '' };
    }
    if (u.includes('api.themoviedb.org/3/movie/123')) {
      return { ok: true, status: 200, json: async () => ({ title: 'Film Mock' }), text: async () => '' };
    }
    if (u.includes('api.themoviedb.org')) {
      return { ok: true, status: 200, json: async () => ({ title: 'Film Mock' }), text: async () => '' };
    }
    if (u.includes('/api/player-sources/')) {
      return { ok: true, status: 200, json: async () => ({ sources: [{ provider: 'cdn', url: 'https://cdn.test/f.m3u8' }] }), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}

describe('manifest JSON / filenames / exports (offline)', () => {
  it('manifest valido con 6 scraper e file esistenti', () => {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    assert.ok(manifest.version, 'overall version presente');
    assert.equal(manifest.scrapers.length, 6);
    const byFile = {};
    for (const s of manifest.scrapers) {
      assert.ok(s.id && s.version && s.filename, 'scraper con id/version/filename');
      assert.ok(s.filename.startsWith('providers/') && s.filename.endsWith('.js'));
      const full = path.join(ROOT, s.filename);
      assert.ok(fs.existsSync(full), 'bundle esiste: ' + s.filename);
      byFile[s.filename] = s;
    }
    for (const p of NUVIO_SCRAPERS) {
      assert.ok(byFile[`providers/${p}.js`], 'manifest copre ' + p);
    }
  });

  it('tutti e 6 i bundle esportano getStreams', () => {
    for (const p of NUVIO_SCRAPERS) {
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), { fetchImpl: throwingFetch, nuvio: true, requireStub: null });
      assert.equal(typeof api.getStreams, 'function', p + ' deve esportare getStreams');
    }
  });

  it('target/format preservati nei bundle (cjs, es2016)', () => {
    for (const p of NUVIO_SCRAPERS) {
      const code = fs.readFileSync(path.join(PROVIDERS_DIR, `${p}.js`), 'utf8');
      assert.ok(!/^import\s+/m.test(code), p + ': nessun import ESM');
      assert.ok(code.includes('module.exports') || code.includes('exports.'), p + ': formato cjs');
    }
  });
});

describe('bundle reali in VM senza require reale: errors -> []', () => {
  for (const p of NUVIO_SCRAPERS) {
    it(`${p}: fetch che lancia => [] (senza require)`, async () => {
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), { fetchImpl: throwingFetch, nuvio: true, requireStub: null });
      const out = await api.getStreams(...sampleArgs(p));
      assert.ok(Array.isArray(out), p + ' deve restituire array');
      assert.equal(out.length, 0);
    });

    it(`${p}: fetch non-ok => [] (senza require)`, async () => {
      const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), { fetchImpl: okEmptyFetch, nuvio: true, requireStub: null });
      const out = await api.getStreams(...sampleArgs(p));
      assert.ok(Array.isArray(out));
      assert.equal(out.length, 0);
    });
  }
});

describe('zero require nativi (stub che lancia sempre, tentativi dopo getStreams)', () => {
  it('guardoserie: nessun tentativo di require, anche dopo getStreams', async () => {
    const { api, attempts } = loadBundleInVM(path.join(PROVIDERS_DIR, 'guardoserie.js'), {
      nuvio: true,
      requireStub: () => { throw new Error('blocked-native'); },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ streams: [] }) })
    });
    assert.equal(attempts.length, 0, 'load guardoserie non deve tentare require, tentativi: ' + JSON.stringify(attempts));
    const out = await api.getStreams('tt1', 'movie', 1, 1);
    assert.ok(Array.isArray(out));
    assert.equal(attempts.length, 0, 'getStreams guardoserie non deve tentare require, tentativi: ' + JSON.stringify(attempts));
  });

  for (const p of NUVIO_SCRAPERS) {
    it(`${p}: nessuna dipendenza obbligatoria (stub throw, solo tentativi opzionali ammessi)`, async () => {
      const { api, attempts } = loadBundleInVM(path.join(PROVIDERS_DIR, `${p}.js`), {
        nuvio: true,
        requireStub: () => { throw new Error('blocked-native'); },
        fetchImpl: throwingFetch
      });
      const out = await api.getStreams(...sampleArgs(p));
      assert.ok(Array.isArray(out));
      assert.equal(out.length, 0);
      // Lo stub lancia sempre: nessuna dipendenza e' stata servita con successo per costruzione.
      // Ammessi solo tentativi opzionali guarded (undici/crypto) che finiscono in catch interno.
      for (const a of attempts) {
        const base = String(a).split('/')[0];
        assert.ok(
          OPTIONAL_ATTEMPTS.has(String(a)) || OPTIONAL_ATTEMPTS.has(base),
          `${p}: tentativo non opzionale non ammesso: ${a} (tutti: ${JSON.stringify(attempts)})`
        );
        assert.ok(
          !FORBIDDEN_ATTEMPTS.has(String(a)) && !FORBIDDEN_ATTEMPTS.has(base),
          `${p}: tentativo nativo obbligatorio non ammesso: ${a}`
        );
      }
    });
  }
});

describe('guardoserie bundle (entry client dedicata)', () => {
  const BUNDLE = path.join(PROVIDERS_DIR, 'guardoserie.js');
  const DEFAULT_BASE = 'https://easystreams.realbestia.com/resolve/guardoserie';

  it('non contiene rami/require Node server', () => {
    const code = fs.readFileSync(BUNDLE, 'utf8');
    for (const needle of ['cf_handler', 'smartFetch', 'cf_bypass', 'getGuardoserieBaseUrl', 'IS_SERVER', 'process.cwd']) {
      assert.ok(!code.includes(needle), 'bundle nuvio non deve contenere ' + needle);
    }
    for (const spec of ['require("fs")', 'require("path")', 'require("child_process")', 'require("http")', 'require("axios")', 'require("https")']) {
      assert.ok(!code.includes(spec), 'bundle nuvio non deve contenere ' + spec);
    }
    assert.ok(code.includes('guardoserieResolveBase'), 'base configurabile presente');
    assert.ok(code.includes('encodeURIComponent'), 'encoding via encodeURIComponent');
  });

  it('payload success + encoding &,#', async () => {
    let seenUrl = '';
    const { api } = loadBundleInVM(BUNDLE, {
      nuvio: true,
      requireStub: null,
      settings: {},
      fetchImpl: async (url) => {
        seenUrl = String(url);
        return { ok: true, status: 200, json: async () => ({ streams: [{ url: 'https://cdn.test/x.m3u8' }] }) };
      }
    });
    const trickyId = 'tt123&x=1#frag';
    const out = await api.getStreams(trickyId, 'series&y=2#z', 2, 3);
    assert.equal(out.length, 1);
    assert.ok(seenUrl.startsWith(DEFAULT_BASE + '?'), 'default base: ' + seenUrl);
    assert.ok(seenUrl.includes('id=' + encodeURIComponent(trickyId)), seenUrl);
    assert.ok(seenUrl.includes('%26') && seenUrl.includes('%23'), 'encoding &,#: ' + seenUrl);
  });

  it('deadline con body hung (json mai risolta) => [] veloce', async () => {
    const { api } = loadBundleInVM(BUNDLE, {
      nuvio: true,
      requireStub: null,
      settings: { guardoserieResolveTimeout: 40 },
      fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })
    });
    const start = Date.now();
    const out = await api.getStreams('tt1', 'movie', 1, 1);
    assert.equal(out.length, 0);
    assert.ok(Date.now() - start < 2000, 'hung json deve rispettare deadline offline');
  });
});

describe('guardoserie staging: entry client canonica (no parity server)', () => {
  it('staging usa solo nuvio.js, nessun index.js server', () => {
    const nuvioSrc = fs.readFileSync(path.join(SRC_DIR, 'guardoserie', 'nuvio.js'), 'utf8');
    assert.ok(nuvioSrc.includes("require('../fetch_helper')"), 'nuvio entry riusa fetch_helper');
    assert.ok(nuvioSrc.includes('var GUARDOSERIE_RESOLVE_DEFAULT_BASE'), 'nuvio vars presenti');
    assert.ok(nuvioSrc.includes('https://easystreams.realbestia.com/resolve/guardoserie'), 'URL default presente');
    assert.ok(!/if\s*\(\s*!?IS_SERVER/.test(nuvioSrc), 'nessun branching server in nuvio entry');
    assert.ok(!/require\s*\(\s*['"][^'"]*cf_handler[^'"]*['"]\s*\)/.test(nuvioSrc), 'nessun require server in nuvio entry');
    assert.ok(!fs.existsSync(path.join(SRC_DIR, 'guardoserie', 'index.js')), 'staging non include src/guardoserie/index.js');
    assert.equal(entryFor('guardoserie'), path.join(SRC_DIR, 'guardoserie', 'nuvio.js'), 'build usa entry client');
  });

  it('build entry client only: bundle in-memoria da nuvio.js identico al disco', () => {
    const esbuild = resolveEsbuild();
    const entry = entryFor('guardoserie');
    const onDisk = fs.readFileSync(path.join(PROVIDERS_DIR, 'guardoserie.js'));
    const res = esbuild.buildSync(nuvioBuildOptions(entry, false));
    assert.ok(res.outputFiles && res.outputFiles.length === 1);
    const inMem = Buffer.from(res.outputFiles[0].contents);
    assert.ok(inMem.equals(onDisk), 'bundle guardoserie da entry client deve coincidere');
  });
});

describe('streamingcommunity bundle: dispatcher assente in runtime Nuvio', () => {
  it('nessuna fetch riceve dispatcher (mock integrale)', async () => {
    const seen = [];
    const fetchImpl = async (url, opts = {}) => {
      seen.push({ url: String(url), opts: { ...opts } });
      if (String(url).includes('themoviedb')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    const { api } = loadBundleInVM(path.join(PROVIDERS_DIR, 'streamingcommunity.js'), { fetchImpl, nuvio: true, requireStub: null });
    const out = await api.getStreams('tt0133093', 'movie', 1, 1);
    assert.ok(Array.isArray(out));
    assert.ok(seen.length > 0, 'deve aver effettuato almeno una fetch mockata');
    for (const { opts } of seen) {
      assert.ok(!('dispatcher' in opts), 'dispatcher non deve raggiungere fetch Nuvio, opts=' + JSON.stringify(Object.keys(opts)));
    }
  });
});

describe('altadefinizione senza cookie hardcoded (algoritmo offline)', () => {
  const SRC_ALTA = path.join(SRC_DIR, 'altadefinizionestreaming', 'index.js');
  const BUNDLE_ALTA = path.join(PROVIDERS_DIR, 'altadefinizionestreaming.js');
  const SENTINEL = 'SENTINEL_COOKIE_ABC123';

  it('sorgente senza sid hardcoded, Cookie condizionato e guard typeof process', () => {
    const src = fs.readFileSync(SRC_ALTA, 'utf8');
    assert.ok(!/sid=/.test(src), 'nessun sid hardcoded nel sorgente');
    assert.ok(!/SESSION_COOKIE/.test(src), 'nessuna costante SESSION_COOKIE');
    assert.ok(src.includes('if (cookie'), 'Cookie condizionato a valore non vuoto');
    assert.ok(src.includes('typeof process'), 'guard typeof process per non reference-error in client');
    assert.ok(src.includes('typeof globalThis'), 'guard typeof globalThis in client');
  });

  it('senza cookie: nessuna request invia header Cookie (nessun throw nascosto)', async () => {
    const code = fs.readFileSync(BUNDLE_ALTA, 'utf8');
    assert.ok(!/sid=/.test(code), 'nessun sid hardcoded nel bundle');
    const seen = [];
    const { api } = loadBundleInVM(BUNDLE_ALTA, { fetchImpl: altaMockFetch(seen), nuvio: true, requireStub: null, settings: {} });
    const out = await api.getStreams('tt0133093', 'movie', 1, 1);
    assert.ok(Array.isArray(out), 'getStreams non deve lanciare senza cookie');
    const baseCalls = seen.filter(s => s.url.startsWith('https://altadefinizionestreaming.tv'));
    assert.ok(baseCalls.length > 0, 'deve chiamare BASE_URL in mock');
    for (const { url, headers } of baseCalls) {
      const keys = Object.keys(headers);
      assert.ok(!keys.some(k => String(k).toLowerCase() === 'cookie'), 'assenza Cookie senza config verso ' + url);
    }
  });

  it('con cookie settings: Cookie SOLO su host provider, mai su TMDB', async () => {
    const seen = [];
    const { api } = loadBundleInVM(BUNDLE_ALTA, {
      fetchImpl: altaMockFetch(seen),
      nuvio: true,
      requireStub: null,
      settings: { altadefinizioneCookie: SENTINEL }
    });
    const out = await api.getStreams('tt0133093', 'movie', 1, 1);
    assert.ok(Array.isArray(out), 'getStreams non deve lanciare con cookie');
    const baseCalls = seen.filter(s => s.url.startsWith('https://altadefinizionestreaming.tv'));
    const tmdbCalls = seen.filter(s => s.url.includes('api.themoviedb.org'));
    assert.ok(baseCalls.length > 0, 'deve chiamare BASE_URL in mock');
    assert.ok(tmdbCalls.length > 0, 'deve chiamare TMDB in mock');
    for (const { url, headers } of baseCalls) {
      const entry = Object.entries(headers).find(([k]) => String(k).toLowerCase() === 'cookie');
      assert.ok(entry, 'Cookie presente su host provider ' + url);
      assert.ok(String(entry[1]).includes(SENTINEL), 'sentinel su host provider ' + url);
    }
    for (const { url, headers } of tmdbCalls) {
      const keys = Object.keys(headers);
      assert.ok(!keys.some(k => String(k).toLowerCase() === 'cookie'), 'mai Cookie su TMDB ' + url);
      for (const v of Object.values(headers)) {
        assert.ok(!String(v).includes(SENTINEL), 'sentinel mai verso TMDB ' + url);
      }
    }
  });
});

describe('build --nuvio negativa: preload intercetta esbuild => exit nonzero, outputs invariati', () => {
  function approvedTempBase() {
    try {
      const local = process.env.LOCALAPPDATA || process.env.TEMP || process.env.TMP;
      if (local) {
        const cand = path.join(local, 'Temp', 'opencode');
        if (fs.existsSync(cand)) return cand;
      }
    } catch (_) {}
    return os.tmpdir();
  }
  it('spawn build con preload mock (indipendente da node_modules) non modifica i bundle', () => {
    const before = new Map();
    for (const p of NUVIO_SCRAPERS) {
      before.set(p, sha256Hex(fs.readFileSync(path.join(PROVIDERS_DIR, `${p}.js`))));
    }
    // Preload che intercetta Module._load('esbuild'): indipendente da NODE_PATH/node_modules,
    // funziona anche dopo `npm install` (esbuild locale verrebbe comunque intercettata).
    // Nessuna patch al progetto: solo file preload in temp approvata.
    const tmpBase = approvedTempBase();
    const mockRoot = fs.mkdtempSync(path.join(tmpBase, 'mock-esbuild-preload-'));
    const preloadFile = path.join(mockRoot, 'preload-mock-esbuild.cjs');
    try {
      fs.writeFileSync(preloadFile, [
        "'use strict';",
        "const Module = require('node:module');",
        "const origLoad = Module._load;",
        "Module._load = function (request, parent, isMain) {",
        "  if (request === 'esbuild') {",
        "    return { build: async () => { throw new Error('mock-esbuild-fail'); }, buildSync: () => { throw new Error('mock-esbuild-fail'); } };",
        "  }",
        "  return origLoad.call(this, request, parent, isMain);",
        "};",
        ""
      ].join('\n'));
      const res = spawnSync(process.execPath, ['--require', preloadFile, 'build.js', '--nuvio'], {
        cwd: ROOT,
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 60000
      });
      assert.notEqual(res.status, 0, 'build con esbuild mock deve fallire nonzero. stdout=' + (res.stdout || '') + ' stderr=' + (res.stderr || ''));
      const combined = String(res.stdout || '') + '\n' + String(res.stderr || '');
      assert.ok(/mock-esbuild-fail/.test(combined), 'errore mock visibile in output: ' + combined.slice(0, 2000));
      for (const p of NUVIO_SCRAPERS) {
        const after = sha256Hex(fs.readFileSync(path.join(PROVIDERS_DIR, `${p}.js`)));
        assert.equal(after, before.get(p), p + ' invariato dopo build fallita');
      }
    } finally {
      fs.rmSync(mockRoot, { recursive: true, force: true });
    }
  });
});

describe('build reproducibility in memoria (opzioni identiche, byte reali)', () => {
  for (const p of NUVIO_SCRAPERS) {
    it(`${p}: byte bundle == build in-memoria`, () => {
      const esbuild = resolveEsbuild();
      const entry = entryFor(p);
      const onDisk = fs.readFileSync(path.join(PROVIDERS_DIR, `${p}.js`));
      const res = esbuild.buildSync(nuvioBuildOptions(entry, false));
      assert.ok(res.outputFiles && res.outputFiles.length === 1);
      const inMem = Buffer.from(res.outputFiles[0].contents);
      assert.equal(inMem.length, onDisk.length, `${p}: lunghezza diversa (mem ${inMem.length} vs disco ${onDisk.length})`);
      assert.ok(inMem.equals(onDisk), `${p}: byte diversi tra build in-memoria e bundle su disco`);
    });
  }
});
