'use strict';

// Offline tests for src/cineblog001/index.js — network fully mocked.
// Run with: node --test tests/cineblog001.test.js
// EasyMod plugin-only: contiene solo provider offline + integrazione
// manifest/build. Niente src/index.js, stremio_addon.js, views (assenti).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'src', 'cineblog001', 'index.js');
const SC_PATH = path.join(__dirname, '..', 'src', 'streamingcommunity', 'index.js');

const FILM_IMDB = 'tt36429458';
const FILM_TMDB = '1458857';
const TV_IMDB = 'tt36849871';
const TV_TMDB = '290856';

function filmSearchHtml() {
  return `
<article class="short block-list">
  <div class="short-main">
    <h3 class="story-heading"><a href="https://cineblog001.tattoo/cb01-streaming/35054-doing-life-streaming-cb01.html">Doing Life streaming [ITA] [HD] (2026)</a></h3>
    <div class="text-uppercase"><b>Drammatico/Romantico</b></div>
  </div>
</article>
<article class="short block-list">
  <div class="short-main">
    <h3 class="story-heading"><a href="https://cineblog001.tattoo/cb01-streaming/99999-doing-other-streaming-cb01.html">Doing Other [ITA] [HD] (2020)</a></h3>
    <div class="text-uppercase"><b>Drammatico</b></div>
  </div>
</article>`;
}

function tvSearchHtml() {
  return `
<article class="short block-list">
  <div class="short-main">
    <h3 class="story-heading"><a href="https://cineblog001.tattoo/cb01-streaming/33122-marshals-streaming-cb01.html">Marshals - Serie TV (2026)</a></h3>
    <div class="text-uppercase"><b>Serie TV/Crime/Azione</b></div>
  </div>
</article>`;
}

// Dettaglio realistico: var imdb + var SERIES + iframe player vixsrc.
function detailHtml({ imdb = null, series = 0, player = true } = {}) {
  const imdbLine = imdb ? `var imdb = '${imdb}';` : `var imdb = '';`;
  const playerHtml = player
    ? `<iframe id="vidxgo-player" src=""></iframe><script>iframe.src = 'https://vixsrc.to/movie/${imdb || 'tt0'}?lang=it';</script>`
    : `<div class="no-player"></div>`;
  return `<html><body><script>${imdbLine}var SERIES = ${series};</script>${playerHtml}</body></html>`;
}

function installFetchMock({ searchHtml, detail = { imdb: FILM_IMDB, series: 0, player: true }, failUrls = [] } = {}) {
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    if (failUrls.some((f) => u.includes(f))) throw new Error('mock-network-error');
    if (u.includes('do=search') || u.includes('subaction=search')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => searchHtml };
    }
    if (u.includes('/cb01-streaming/')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => detailHtml(detail) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return seen;
}

// Mock TMDB completo: find (strict per tipo) + detail + external_ids via append_to_response.
// Il dettaglio tv standard NON contiene imdb_id (fixture realistico).
function installTmdbMock() {
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.themoviedb.org/3/find/')) {
      const m = u.match(/find\/(tt\d+)/i);
      const imdb = m ? m[1] : '';
      // Lo scope tipo viene verificato dal provider: qui restituiamo entrambi i rami
      // popolati solo per l'imdb corretto; il provider sceglie il ramo del suo tipo.
      if (imdb === FILM_IMDB) return { ok: true, status: 200, json: async () => ({ movie_results: [{ id: 1458857 }], tv_results: [] }), text: async () => '' };
      if (imdb === TV_IMDB) return { ok: true, status: 200, json: async () => ({ movie_results: [], tv_results: [{ id: 290856 }] }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({ movie_results: [], tv_results: [] }), text: async () => '' };
    }
    if (u.includes(`/3/movie/${FILM_TMDB}`)) {
      return {
        ok: true, status: 200,
        json: async () => ({
          title: 'Doing Life', original_title: 'Doing Life', release_date: '2026-05-01',
          external_ids: { imdb_id: FILM_IMDB }
        }),
        text: async () => ''
      };
    }
    if (u.includes(`/3/tv/${TV_TMDB}`)) {
      return {
        ok: true, status: 200,
        json: async () => ({
          name: 'Marshals', original_name: 'Marshals: A Yellowstone Story', first_air_date: '2026-03-01',
          external_ids: { imdb_id: TV_IMDB }
        }),
        text: async () => ''
      };
    }
    return prev(url, opts);
  };
}

function scStreamFixture() {
  return {
    name: '📡 StreamingCommunity',
    title: '📁 Doing Life | 🇮🇹',
    originalTitle: 'Doing Life',
    url: 'https://cromosino.space/playlist/214325.m3u8?b=1&token=AAA&expires=999&h=1&lang=it',
    easyProxySourceUrl: 'https://cromosino.space/embed/214325?token=AAA&lang=en&skin=vixsrc',
    quality: '720p',
    qualityTag: '💿 HD',
    language: '🇮🇹',
    type: 'direct',
    headers: { 'User-Agent': 'UA-MOCK', Referer: 'https://cromosino.space/embed/214325' },
    behaviorHints: { notWebReady: false },
    subtitles: [{ lang: 'it', url: 'https://cromosino.space/subs/214325_it.vtt' }],
    provider: 'streamingcommunity'
  };
}

describe('cineblog001 provider (offline)', () => {
  let realFetch;
  let scMod;
  let origGetStreams;
  let scCalls;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    delete require.cache[require.resolve(SRC_PATH)];
    scMod = require(SC_PATH);
    origGetStreams = scMod.getStreams;
    scCalls = [];
    scMod.getStreams = async (...args) => {
      scCalls.push(args);
      return [scStreamFixture()];
    };
  });

  afterEach(() => {
    if (typeof realFetch === 'undefined') delete globalThis.fetch;
    else globalThis.fetch = realFetch;
    if (scMod && origGetStreams) scMod.getStreams = origGetStreams;
  });

  function load() {
    delete require.cache[require.resolve(SRC_PATH)];
    return require(SRC_PATH);
  }

  function mockSite({ searchHtml, detail }) {
    installFetchMock({ searchHtml, detail });
    installTmdbMock();
  }

  it('film: ricerca + dettaglio con IMDb corrispondente => stream rietichettato Cineblog001', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: true } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.equal(out.length, 1);
    assert.ok(out[0].name.includes('Cineblog'), out[0].name);
    assert.ok(!out[0].name.includes('StreamingCommunity'), out[0].name);
    assert.equal(out[0].url, scStreamFixture().url);
    assert.deepEqual(out[0].headers['User-Agent'], 'UA-MOCK');
    assert.deepEqual(out[0].subtitles, scStreamFixture().subtitles);
    assert.equal(out[0].qualityTag, '💿 HD');
    assert.equal(out[0].language, '🇮🇹');
    assert.equal(scCalls.length, 1);
  });

  it('tv: IMDb via external_ids (dettaglio tv senza imdb_id), S/E mappati, titolo S02E03', async () => {
    mockSite({ searchHtml: tvSearchHtml(), detail: { imdb: TV_IMDB, series: 1, player: true } });
    scMod.getStreams = async (...args) => {
      scCalls.push(args);
      const s = scStreamFixture();
      s.originalTitle = 'Marshals 2x3';
      return [s];
    };
    const api = load();
    const out = await api.getStreams(TV_IMDB, 'series', 2, 3);
    assert.equal(out.length, 1);
    assert.equal(scCalls[0][1], 'tv');
    assert.equal(scCalls[0][2], 2);
    assert.equal(scCalls[0][3], 3);
    assert.ok(out[0].title.includes('S02E03'), out[0].title);
  });

  it('input tmdb: e numerici usano external_ids per la validazione', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: true } });
    const api = load();
    for (const id of [`tmdb:${FILM_TMDB}`, FILM_TMDB]) {
      const out = await api.getStreams(id, 'movie', 1, 1);
      assert.equal(out.length, 1, `id ${id} deve risolvere`);
    }
  });

  it('IMDb dettaglio diverso dalla richiesta => [] e nessun riuso', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: 'tt9999999', series: 0, player: true } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('dettaglio senza var imdb => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: null, series: 0, player: true } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('dettaglio senza player vixsrc => [] (niente risoluzione su dettagli privi di player)', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: false } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('SERIES dettaglio incoerente col tipo richiesto => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 1, player: true } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('titolo/anno non corrispondenti => []', async () => {
    mockSite({
      searchHtml: `<article class="short"><div><h3><a href="https://cineblog001.tattoo/cb01-streaming/1-x.html">Altro Film (2020)</a></h3><div><b>Drammatico</b></div></div></article>`,
      detail: { imdb: FILM_IMDB, series: 0, player: true }
    });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('tipo serie scarta card film e viceversa', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: true } });
    const api = load();
    const out = await api.getStreams(TV_IMDB, 'series', 1, 1);
    assert.deepEqual(out, []);
  });

  it('errori rete (search/detail) => [] senza throw', async () => {
    installFetchMock({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB }, failUrls: ['cineblog001.tattoo'] });
    installTmdbMock();
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('search vuota => []', async () => {
    mockSite({ searchHtml: '<div class="row">no results</div>', detail: { imdb: FILM_IMDB, series: 0, player: true } });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('host spoof in query o suffisso dominio scartati', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: true } });
    const spoofs = [
      { name: 'X', title: 'X', url: 'https://evil.example/x?d=https://cromosino.space/a.m3u8', easyProxySourceUrl: 'https://evil.example/e', quality: '720p', headers: {} },
      { name: 'X', title: 'X', url: 'https://cromosino.space.evil.com/x.m3u8', easyProxySourceUrl: '', quality: '720p', headers: {} },
      { name: 'X', title: 'X', url: 'https://sub.cromosino.space/x.m3u8', easyProxySourceUrl: '', quality: '720p', headers: {} }
    ];
    const api = load();
    for (const [i, s] of spoofs.entries()) {
      scMod.getStreams = async () => [s];
      const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
      if (i < 2) assert.deepEqual(out, [], `spoof ${i} deve essere scartato`);
      else assert.equal(out.length, 1, 'sottodominio legittimo accettato');
    }
  });

  it('resolver streamingcommunity che lancia => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB, series: 0, player: true } });
    scMod.getStreams = async () => { throw new Error('sc-down'); };
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('tipo non supportato (anime) => [] senza rete sito', async () => {
    const seen = installFetchMock({ searchHtml: filmSearchHtml(), detail: { imdb: FILM_IMDB } });
    installTmdbMock();
    const api = load();
    const out = await api.getStreams('kitsu:1', 'anime', 1, 1);
    assert.deepEqual(out, []);
    assert.ok(!seen.some((u) => u.includes('cineblog001.tattoo')));
  });

  it('sorgente usa fetchWithTimeout, mai raw fetch(), nessun nuovo extractor', () => {
    const src = fs.readFileSync(SRC_PATH, 'utf8');
    assert.ok(src.includes('fetchWithTimeout'), 'deve usare fetchWithTimeout');
    assert.ok(!/(^|[^a-zA-Z_])await\s+fetch\s*\(/.test(src), 'mai raw fetch()');
    assert.ok(src.includes('streamingcommunity/index'), 'riuso streamingcommunity');
    assert.ok(!/stayonline|mixdrop|unPack|atob\(|eval\(function|cf_bypass|scrapling/i.test(src), 'nessun nuovo extractor/bypass');
    assert.ok(src.includes('append_to_response=external_ids'), 'IMDb da external_ids');
    assert.ok(src.includes('new URL('), 'allowlist via hostname URL');
  });
});

describe('cineblog001 registrazione/integrazione (offline)', () => {
  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('manifest: voce easystreams-cineblog001 coerente e bundle esistente', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(/^\d+\.\d+\.\d+$/.test(String(manifest.version)), 'manifest version semver');
    const entry = manifest.scrapers.find((s) => s.id === 'easystreams-cineblog001');
    assert.ok(entry, 'voce manifest presente');
    assert.equal(entry.filename, 'providers/cineblog001.js');
    assert.ok(fs.existsSync(path.join(ROOT, entry.filename)), 'bundle generato esistente');
    assert.deepEqual(entry.supportedTypes, ['movie', 'tv', 'series']);
    assert.deepEqual(entry.idPrefixes, ['tmdb:', 'tt']);
  });

  it('build: NUVIO_SCRAPERS include cineblog001', () => {
    const build = read('build.js');
    assert.ok(/'cineblog001'/.test(build), 'NUVIO_SCRAPERS esteso');
  });
});
