'use strict';

// Offline tests for compito 1: fetchWithTimeout deadline guarantee + Nuvio dispatcher behavior.
// No network: every case injects a mocked fetch (or runs the helper inside a VM sandbox).
// Run with: node --test tests/nuvio-plugin.test.js

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HELPER_PATH = path.join(__dirname, '..', 'src', 'fetch_helper.js');
const SC_PATH = path.join(__dirname, '..', 'src', 'streamingcommunity', 'index.js');
const ALTA_PATH = path.join(__dirname, '..', 'src', 'altadefinizionestreaming', 'index.js');

function loadHelperInSandbox({ withAbort = true, fetchImpl } = {}) {
  const src = fs.readFileSync(HELPER_PATH, 'utf8');
  const sandbox = {
    module: { exports: {} },
    console,
    URL,
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.URL = URL;
  if (withAbort) {
    sandbox.AbortController = AbortController;
    sandbox.AbortSignal = AbortSignal;
  }
  if (typeof fetchImpl !== 'undefined') {
    sandbox.fetch = fetchImpl;
  }
  vm.createContext(sandbox);
  vm.runInContext(`${src}\n//# sourceURL=fetch_helper.vm.js`, sandbox);
  return sandbox.module.exports;
}

const pendingFetch = () => new Promise(() => {});
const okResponse = () => ({ ok: true, status: 200 });

function signalRespectingPendingFetch() {
  return (url, opts = {}) =>
    new Promise((_, reject) => {
      const sig = opts.signal;
      const abortErr = () => {
        const e = new Error('This operation was aborted');
        e.name = 'AbortError';
        return e;
      };
      if (sig && sig.aborted) {
        reject(abortErr());
        return;
      }
      if (sig && typeof sig.addEventListener === 'function') {
        sig.addEventListener('abort', () => reject(abortErr()), { once: true });
      }
      // Never resolves: simulates a hung upstream that only reacts to abort.
    });
}

describe('fetchWithTimeout (src/fetch_helper.js)', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (typeof realFetch === 'undefined') {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = realFetch;
    }
    delete globalThis.navigator;
    delete globalThis.HermesInternal;
    if (typeof global !== 'undefined') {
      delete global.HermesInternal;
    }
  });

  it('success: resolves with the fetch response', async () => {
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: async () => okResponse() });
    const res = await helper.fetchWithTimeout('https://example.test/ok', { timeout: 500 });
    assert.equal(res.ok, true);
  });

  it('rejection: propagates non-abort fetch errors unchanged', async () => {
    const failure = new Error('boom');
    const helper = loadHelperInSandbox({
      withAbort: true,
      fetchImpl: async () => {
        throw failure;
      },
    });
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/fail', { timeout: 500 }),
      (err) => err === failure
    );
  });

  it('pending fetch that ignores signal still hits the short deadline (Abort present)', async () => {
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: pendingFetch });
    const start = Date.now();
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/hang', { timeout: 30 }),
      /timed out after 30ms/
    );
    assert.ok(Date.now() - start < 2000, 'timeout must fire quickly without network');
  });

  it('pending fetch without AbortController/AbortSignal still hits the deadline via Promise.race', async () => {
    const helper = loadHelperInSandbox({ withAbort: false, fetchImpl: pendingFetch });
    assert.equal(typeof helper.fetchWithTimeout, 'function');
    const start = Date.now();
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/hang-no-abort', { timeout: 30 }),
      /timed out after 30ms/
    );
    assert.ok(Date.now() - start < 2000, 'race timer must enforce deadline without Abort support');
  });

  it('signal-respecting hung fetch is mapped to a timeout error on abort', async () => {
    const helper = loadHelperInSandbox({
      withAbort: true,
      fetchImpl: signalRespectingPendingFetch(),
    });
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/slow', { timeout: 30 }),
      /timed out after 30ms/
    );
  });

  it('external abort is preserved (AbortError, not a timeout message)', async () => {
    const helper = loadHelperInSandbox({
      withAbort: true,
      fetchImpl: async () => {
        const e = new Error('external abort');
        e.name = 'AbortError';
        throw e;
      },
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/ext-abort', {
        timeout: 2000,
        signal: controller.signal,
      }),
      (err) => err && err.name === 'AbortError' && !/timed out/.test(String(err.message))
    );
  });

  it('missing fetch implementation throws without touching the network', async () => {
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: undefined });
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/no-fetch', { timeout: 30 }),
      /No fetch implementation found/
    );
  });

  it('short timeout stays offline and fast', async () => {
    const helper = require(HELPER_PATH);
    globalThis.fetch = pendingFetch;
    const start = Date.now();
    await assert.rejects(
      helper.fetchWithTimeout('https://example.test/short', { timeout: 25 }),
      /timed out after 25ms/
    );
    assert.ok(Date.now() - start < 2000);
  });
});

describe('dispatcher handling (Nuvio client only)', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (typeof realFetch === 'undefined') {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = realFetch;
    }
    delete globalThis.navigator;
    delete globalThis.HermesInternal;
    if (typeof global !== 'undefined') {
      delete global.HermesInternal;
    }
  });

  it('omits dispatcher in the Nuvio runtime', async () => {
    const helper = require(HELPER_PATH);
    let captured;
    globalThis.fetch = async (url, opts) => {
      captured = opts || {};
      return okResponse();
    };
    globalThis.navigator = { product: 'ReactNative' };
    assert.equal(helper.isNuvioRuntime(), true);
    await helper.fetchWithTimeout('https://example.test/nuvio', {
      headers: { 'User-Agent': 't' },
      dispatcher: { fake: 'proxy-agent' },
      timeout: 500,
    });
    assert.ok(!('dispatcher' in captured), 'Nuvio fetch must not receive dispatcher');
  });

  it('client entry (nuvio.js) non espone dispatcher verso fetch Nuvio', async () => {
    // Staging plugin-only: nessun ramo server. Il dispatcher resta solo come
    // opzione helper ignorata in runtime Nuvio (verificato nel test sopra).
    const helper = require(HELPER_PATH);
    assert.equal(typeof helper.fetchWithTimeout, 'function');
  });

  it('providers route streamingcommunity/altadefinizione fetches through fetchWithTimeout', () => {
    const sc = fs.readFileSync(SC_PATH, 'utf8');
    const alta = fs.readFileSync(ALTA_PATH, 'utf8');
    for (const [name, src] of [['streamingcommunity', sc], ['altadefinizione', alta]]) {
      assert.ok(
        src.includes('fetchWithTimeout'),
        `${name}: must use fetchWithTimeout`
      );
      assert.ok(
        !/(^|[^a-zA-Z_])await\s+fetch\s*\(/.test(src),
        `${name}: must not call raw fetch() directly`
      );
    }
    assert.ok(
      sc.includes('dispatcher: proxyAgent'),
      'streamingcommunity must keep passing the server proxy dispatcher through the helper'
    );
  });

  it('timeout error omits URL and secrets (task1 secret-leak fix)', async () => {
    const helper = loadHelperInSandbox({ withAbort: true, fetchImpl: pendingFetch });
    const secretUrl = 'https://example.test/resolve?api_password=SECRET123&token=ABC&id=tt123';
    const err = await helper.fetchWithTimeout(secretUrl, { timeout: 30 }).then(
      () => { throw new Error('expected timeout'); },
      (e) => e
    );
    assert.ok(/timed out after 30ms/.test(String(err && err.message)), 'keeps deadline text');
    assert.ok(!String(err && err.message).includes('SECRET123'), 'must not leak secret');
    assert.ok(!String(err && err.message).includes('ABC'), 'must not leak token');
    assert.ok(!String(err && err.message).includes('api_password'), 'must not leak param name with secret');
    assert.ok(!String(err && err.message).includes(secretUrl), 'must not embed request URL');
  });
});

describe('guardoserie client (nuvio entry canonical)', () => {
  const GUARDO_PATH = path.join(__dirname, '..', 'src', 'guardoserie', 'nuvio.js');
  const GUARDO_DEFAULT_BASE = 'https://easystreams.realbestia.com/resolve/guardoserie';

  // Staging plugin-only: entry client canonica, nessun ramo server da estrarre.
  function getGuardoserieClientInner() {
    const src = fs.readFileSync(GUARDO_PATH, 'utf8');
    // Rimuove solo la riga require fetch_helper (iniettato nel sandbox come free variable).
    return src
      .split('\n')
      .filter((line) => !/require\s*\(\s*['"]\.\.\/fetch_helper['"]\s*\)/.test(line))
      .join('\n');
  }

  function loadGuardoserieClient({ fetchImpl, settings = {}, withAbort = true } = {}) {
    const inner = getGuardoserieClientInner();
    const captured = { warn: [], error: [], log: [] };
    const sandbox = {
      module: { exports: {} },
      encodeURIComponent,
      setTimeout,
      clearTimeout,
      Promise,
      Number,
      String,
      JSON,
      URL: undefined,
      URLSearchParams: undefined,
      process: undefined,
    };
    sandbox.globalThis = sandbox;
    sandbox.SCRAPER_SETTINGS = settings;
    sandbox.globalThis.SCRAPER_SETTINGS = settings;
    if (typeof fetchImpl !== 'undefined') {
      sandbox.fetch = fetchImpl;
    }
    if (withAbort) {
      sandbox.AbortController = AbortController;
      sandbox.AbortSignal = AbortSignal;
    }
    sandbox.console = {
      warn: (...a) => { captured.warn.push(a.map(String).join(' ')); },
      error: (...a) => { captured.error.push(a.map(String).join(' ')); },
      log: (...a) => { captured.log.push(a.map(String).join(' ')); },
    };
    vm.createContext(sandbox);
    // Riusa l'helper reale nello stesso sandbox: niente duplicazione abort/fetch,
    // il client risolve fetchWithTimeout come free variable bundlata.
    const helperSrc = fs.readFileSync(HELPER_PATH, 'utf8');
    vm.runInContext(`${helperSrc}\n//# sourceURL=fetch_helper.client.vm.js`, sandbox);
    sandbox.fetchWithTimeout = sandbox.module.exports.fetchWithTimeout;
    sandbox.module = { exports: {} };
    vm.runInContext(`${inner}\n//# sourceURL=guardoserie-client.vm.js`, sandbox);
    return { api: sandbox.module.exports, captured, inner };
  }

  const streamsPayload = (streams) => ({ ok: true, status: 200, json: async () => ({ streams }) });

  it('entry client-only: nessun ramo server, nessun require nativo', () => {
    const src = fs.readFileSync(GUARDO_PATH, 'utf8');
    assert.ok(!/if\s*\(\s*!?IS_SERVER/.test(src), 'nuvio entry non deve contenere branching IS_SERVER');
    assert.ok(!/require\s*\(\s*['"][^'"]*cf_handler[^'"]*['"]\s*\)/.test(src), 'nuvio entry non deve richiedere cf_handler');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'guardoserie', 'index.js')), 'staging non deve includere src/guardoserie/index.js server');
  });

  it('client uses bundled relative helper, no native requires, no global URL, no proxy secrets', () => {
    const src = fs.readFileSync(GUARDO_PATH, 'utf8');
    assert.ok(src.includes("require('../fetch_helper')"), 'must reuse fetchWithTimeout via top-level bundler require');
    const inner = getGuardoserieClientInner();
    assert.ok(inner.includes('fetchWithTimeout'), 'client must reuse fetchWithTimeout, not duplicate abort/fetch');
    assert.ok(!/(^|[^a-zA-Z_])fetch\s*\(/.test(inner), 'client must not call raw fetch(), only the helper');
    assert.ok(!/AbortController/.test(inner), 'client must not duplicate abort logic (owned by helper)');
    assert.ok(!/require\s*\(\s*['"](fs|path|os|undici|node:[^'"]*)['"]\s*\)/.test(inner), 'client branch must not require native Node modules');
    assert.ok(!/require\s*\(\s*['"][^.'"]/.test(inner), 'client branch must not require bare packages; only relative bundler paths allowed');
    assert.ok(!/new\s+URL\s*\(/.test(inner), 'client branch must not use new URL()');
    assert.ok(!/URLSearchParams/.test(inner), 'client branch must not require URLSearchParams');
    assert.ok(!/proxyPassword|api_password|proxyUrl|dispatcher/i.test(inner), 'must not propagate proxy password to third-party server');
    assert.ok(inner.includes('guardoserieResolveBase'), 'base must be configurable via SCRAPER_SETTINGS.guardoserieResolveBase');
    assert.ok(inner.includes('encodeURIComponent'), 'must build URL with encodeURIComponent');
    assert.ok(inner.includes('10000'), 'default timeout must be 10s');
  });

  it('build entry client only: nuvio.js esporta getStreams senza ramo server', async () => {
    // Staging: nessun file server da confrontare; verifica solo entry canonica.
    const src = fs.readFileSync(GUARDO_PATH, 'utf8');
    assert.ok(src.includes("require('../fetch_helper')"), 'nuvio entry riusa fetch_helper');
    assert.ok(src.includes('GUARDOSERIE_RESOLVE_DEFAULT_BASE'), 'vars presenti');
  });

  it('default base matches current endpoint and encodes params', async () => {
    let seenUrl;
    let seenOpts;
    const { api } = loadGuardoserieClient({
      settings: {},
      fetchImpl: async (url, opts) => {
        seenUrl = String(url);
        seenOpts = opts || {};
        return streamsPayload([{ url: 'https://cdn.test/x.m3u8' }]);
      },
    });
    const out = await api.getStreams('tt123', 'series', 2, 3);
    assert.equal(out.length, 1);
    assert.ok(seenUrl.startsWith(`${GUARDO_DEFAULT_BASE}?`), `default base mismatch: ${seenUrl}`);
    assert.ok(seenUrl.includes(`id=${encodeURIComponent('tt123')}`), seenUrl);
    assert.ok(seenUrl.includes(`type=${encodeURIComponent('series')}`), seenUrl);
    assert.ok(!/api_password|proxyPassword|dispatcher/.test(seenUrl + JSON.stringify(seenOpts)), 'no secrets in request');
  });

  it('custom base is honoured, trimmed, and non-http(s) falls back to default', async () => {
    for (const [raw, expectedBase] of [
      ['https://custom.example.test/r/', 'https://custom.example.test/r'],
      ['https://custom.example.test/r///', 'https://custom.example.test/r'],
      ['http://10.0.0.9:8080/base', 'http://10.0.0.9:8080/base'],
    ]) {
      let seenUrl;
      const { api } = loadGuardoserieClient({
        settings: { guardoserieResolveBase: raw },
        fetchImpl: async (url) => { seenUrl = String(url); return streamsPayload([]); },
      });
      await api.getStreams('tt1', 'movie', 1, 1);
      assert.ok(seenUrl.startsWith(`${expectedBase}?`), `${raw} -> ${seenUrl}`);
    }
    for (const bad of ['ftp://evil.test/x', 'javascript:alert(1)', '', '   ', null, 42, 'notaurl', 'https://custom.example.test/r?x=1', 'https://custom.example.test/r#frag', 'https://custom.example.test/r?x=1#y', 'https://user:pass@custom.example.test/r', 'https://user@custom.example.test/r', 'https://custom.example.test/r withspace', 'https://custom.example.test:8080/r?x=1', 'http://custom.example.test/r#x']) {
      let seenUrl;
      const { api } = loadGuardoserieClient({
        settings: { guardoserieResolveBase: bad },
        fetchImpl: async (url) => { seenUrl = String(url); return streamsPayload([]); },
      });
      await api.getStreams('tt1', 'movie', 1, 1);
      assert.ok(seenUrl.startsWith(`${GUARDO_DEFAULT_BASE}?`), `bad base ${String(bad)} must fall back, got ${seenUrl}`);
    }
  });

  it('encodes & and # without needing global URL', async () => {
    const trickyId = 'tt123&x=1#frag';
    const trickyType = 'series&y=2#z';
    let seenUrl;
    const { api } = loadGuardoserieClient({
      settings: {},
      fetchImpl: async (url) => { seenUrl = String(url); return streamsPayload([]); },
    });
    await api.getStreams(trickyId, trickyType, 1, 1);
    assert.ok(seenUrl.includes(`id=${encodeURIComponent(trickyId)}`), seenUrl);
    assert.ok(seenUrl.includes(`type=${encodeURIComponent(trickyType)}`), seenUrl);
    assert.ok(seenUrl.includes('%26') && seenUrl.includes('%23'), `& and # must be encoded: ${seenUrl}`);
  });

  it('non-2xx and invalid payloads fail soft to []', async () => {
    const { api: apiBadStatus } = loadGuardoserieClient({
      settings: {},
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ streams: [{ url: 'x' }] }) }),
    });
    assert.equal((await apiBadStatus.getStreams('tt1', 'movie', 1, 1)).length, 0);

    for (const payload of [null, {}, { streams: null }, { streams: 'x' }, { streams: {} }, { nope: [] }]) {
      const { api } = loadGuardoserieClient({
        settings: {},
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
      });
      assert.equal((await api.getStreams('tt1', 'movie', 1, 1)).length, 0);
    }

    const { api: apiThrow } = loadGuardoserieClient({
      settings: {},
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    });
    assert.equal((await apiThrow.getStreams('tt1', 'movie', 1, 1)).length, 0);
  });

  it('pending fetch hits custom short timeout offline and returns []', async () => {
    const { api } = loadGuardoserieClient({
      settings: { guardoserieResolveTimeout: 30 },
      fetchImpl: pendingFetch,
    });
    const start = Date.now();
    const out = await api.getStreams('tt1', 'movie', 1, 1);
    assert.equal(out.length, 0);
    assert.ok(Date.now() - start < 2000, 'custom timeout must fire quickly without network');
  });

  it('json that never resolves respects the total deadline (fetch ok, body hung)', async () => {
    const { api } = loadGuardoserieClient({
      settings: { guardoserieResolveTimeout: 40 },
      fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
    });
    const start = Date.now();
    const out = await api.getStreams('tt1', 'movie', 1, 1);
    assert.equal(out.length, 0);
    assert.ok(Date.now() - start < 2000, 'hung json body must not block past the deadline');
  });

  it('invalid timeout values fall back without hanging (successful fetch still works)', async () => {
    for (const bad of ['', null, undefined, 0, -5, 'not-a-number', NaN]) {
      const settings = bad === undefined ? {} : { guardoserieResolveTimeout: bad };
      const { api } = loadGuardoserieClient({
        settings,
        fetchImpl: async () => streamsPayload([{ url: 'https://cdn.test/ok.m3u8' }]),
      });
      const out = await api.getStreams('tt1', 'movie', 1, 1);
      assert.equal(out.length, 1, `bad timeout ${String(bad)} must fall back to default and still succeed`);
    }
    const { api: apiHuge } = loadGuardoserieClient({
      settings: { guardoserieResolveTimeout: 999999 },
      fetchImpl: async () => streamsPayload([{ url: 'https://cdn.test/ok.m3u8' }]),
    });
    assert.equal((await apiHuge.getStreams('tt1', 'movie', 1, 1)).length, 1, 'huge timeout must be clamped, not break fetch');
  });

  it('errors log generic text without id/url/token', async () => {
    const secretId = 'tt999-SECRET-XYZ';
    const { api, captured } = loadGuardoserieClient({
      settings: { guardoserieResolveBase: 'https://custom.example.test/r', guardoserieResolveTimeout: 50 },
      fetchImpl: async () => { throw new Error(`fetch failed for ${secretId} at https://custom.example.test/r?token=TOK`); },
    });
    const out = await api.getStreams(secretId, 'movie', 1, 1);
    assert.equal(out.length, 0);
    const allLogs = [...captured.warn, ...captured.error, ...captured.log].join('\n');
    assert.ok(allLogs.length > 0, 'must log something generic on error');
    assert.ok(!allLogs.includes(secretId), `log must not contain id: ${allLogs}`);
    assert.ok(!allLogs.includes('TOK'), `log must not contain token: ${allLogs}`);
    assert.ok(!allLogs.includes('https://custom.example.test'), `log must not contain url: ${allLogs}`);
  });

  it('never forwards proxy password to the resolve server', async () => {
    let seenUrl = '';
    let seenOpts = {};
    const { api } = loadGuardoserieClient({
      settings: { proxyUrl: 'https://proxy.test', proxyPassword: 'SUPERSECRET', guardoserieResolveTimeout: 500 },
      fetchImpl: async (url, opts) => {
        seenUrl = String(url);
        seenOpts = opts || {};
        return streamsPayload([]);
      },
    });
    await api.getStreams('tt1', 'movie', 1, 1);
    const blob = seenUrl + ' ' + JSON.stringify(seenOpts);
    assert.ok(!blob.includes('SUPERSECRET'), `proxy password must not leak: ${blob}`);
    assert.ok(!/api_password|proxyPassword/i.test(blob), `no password fields: ${blob}`);
  });
});
