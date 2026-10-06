'use strict';

// Offline tests for src/altadefinizionex/index.js — network fully mocked.
// Run with: node --test tests/altadefinizionex.test.js
// EasyMod plugin-only: contiene solo provider offline + VM Nuvio +
// integrazione manifest/build. Niente src/index.js, stremio_addon.js,
// views (assenti).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'src', 'altadefinizionex', 'index.js');
const SC_PATH = path.join(__dirname, '..', 'src', 'streamingcommunity', 'index.js');
const BASE_URL = 'https://altadefinizionex.surf';

const FILM_IMDB = 'tt36429458';
const FILM_TMDB = '1458857';
const TV_IMDB = 'tt36849871';
const TV_TMDB = '290856';

// Card DLE reali (.movie + data-link/data-year + h2.movie-title).
// Nota: data-imdb della card e' il rating, mai usato per validare.
function filmSearchHtml() {
  return `
<div class="col">
  <div class="movie"
  data-imdb="7.3"
  data-year="2026"
  data-link="https://altadefinizionex.surf/drammatico/35054-doing-life-streaming.html"
  >
    <div class="movie-poster"><a href="https://altadefinizionex.surf/drammatico/35054-doing-life-streaming.html"><img src="/uploads/thumb/203x293-0-70/2026-10/tt36429458.jpg" /></a></div>
    <div class="movie-info"><h2 class="movie-title"><a href="https://altadefinizionex.surf/drammatico/35054-doing-life-streaming.html">Doing Life</a></h2></div>
  </div>
</div>
<div class="col">
  <div class="movie"
  data-imdb="6.1"
  data-year="2020"
  data-link="https://altadefinizionex.surf/drammatico/99999-doing-other-streaming.html"
  >
    <div class="movie-poster"><a href="https://altadefinizionex.surf/drammatico/99999-doing-other-streaming.html"><img src="/uploads/thumb/203x293-0-70/2020-01/tt0000001.jpg" /></a></div>
    <div class="movie-info"><h2 class="movie-title"><a href="https://altadefinizionex.surf/drammatico/99999-doing-other-streaming.html">Doing Other</a></h2></div>
  </div>
</div>`;
}

function tvSearchHtml() {
  return `
<div class="col">
  <div class="movie"
  data-imdb="0.0"
  data-year="2026"
  data-link="https://altadefinizionex.surf/serie-tv/33122-marshals-streaming.html"
  >
    <div class="movie-poster"><a href="https://altadefinizionex.surf/serie-tv/33122-marshals-streaming.html"><img src="/uploads/thumb/2026-03/marshals-streaming_1772500141.jpg" /></a></div>
    <div class="movie-info"><h2 class="movie-title"><a href="https://altadefinizionex.surf/serie-tv/33122-marshals-streaming.html">Marshals</a></h2></div>
  </div>
</div>`;
}

// Dettaglio film realistico: iframe vixsrc /movie/<tt> + Anno.
// Include il fallback vidxgo commentato come nelle pagine reali: dopo lo
// strip dei commenti non deve contare come player.
function filmDetailHtml({ imdb = FILM_IMDB, year = '2026', tvPlayer = false } = {}) {
  const iframe = imdb
    ? `<!--<iframe src="https://v.vidxgo.co/${imdb}"></iframe>--><iframe id="dle-player" src="https://vixsrc.to/movie/${imdb}?lang=it" allowfullscreen frameborder="0"></iframe>`
    : `<div class="no-player"></div>`;
  const tv = tvPlayer ? `<script>iframe.src = 'https://vixsrc.to/tv/${imdb || 'tt0'}' + imdb;</script>` : '';
  return `<html><body>${iframe}${tv}<div class="movie_entry-details"><div class="row"><div class="col-auto label-text">Anno:</div><div class="col-auto">${year}</div></div></div></body></html>`;
}

// Dettaglio serie realistico: var imdb + player JS vixsrc /tv/ + Anno.
// I poster contengono tt ma non bastano: serve var imdb + player /tv/.
function serieDetailHtml({ imdb = TV_IMDB, year = '2026', moviePlayer = false } = {}) {
  const varLine = imdb ? `var imdb = '${imdb}';` : `var imdb = '';`;
  const commented = `<!--<iframe src="https://v.vidxgo.co/[xfvalue_imdbid]"></iframe>-->`;
  const tvJs = `<script>(function(){ ${varLine} iframe.src = 'https://vixsrc.to/tv/' + imdb; })();</script>`;
  const movie = moviePlayer && imdb
    ? `<iframe src="https://vixsrc.to/movie/${imdb}?lang=it"></iframe>`
    : '';
  return `<html><body>${commented}${tvJs}${movie}<div class="movie_entry-details"><div class="row"><div class="col-auto label-text">Anno:</div><div class="col-auto">${year}</div></div></div></body></html>`;
}

function installFetchMock({ searchHtml, detailHtml, failUrls = [], seen = null } = {}) {
  const calls = seen || [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: String(opts.method || 'GET').toUpperCase(), body: String(opts.body || '') });
    if (failUrls.some((f) => u.includes(f))) throw new Error('mock-network-error');
    if (u.includes('api.themoviedb.org')) {
      return globalThis.__tmdbPrev ? globalThis.__tmdbPrev(url, opts) : { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    if (u === `${BASE_URL}/`) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => searchHtml };
    }
    if (u.startsWith(`${BASE_URL}/`)) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => detailHtml };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return calls;
}

// Mock TMDB: find strict per tipo + detail con external_ids (tv senza imdb_id diretto).
function installTmdbMock() {
  const prev = globalThis.fetch;
  globalThis.__tmdbPrev = prev;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.themoviedb.org/3/find/')) {
      const m = u.match(/find\/(tt\d+)/i);
      const imdb = m ? m[1] : '';
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

describe('altadefinizionex provider (offline)', () => {
  let realFetch;
  let scMod;
  let origGetStreams;
  let scCalls;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    delete globalThis.__tmdbPrev;
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
    delete globalThis.__tmdbPrev;
    if (scMod && origGetStreams) scMod.getStreams = origGetStreams;
  });

  function load() {
    delete require.cache[require.resolve(SRC_PATH)];
    return require(SRC_PATH);
  }

  function mockSite({ searchHtml, detailHtml }) {
    installFetchMock({ searchHtml, detailHtml });
    installTmdbMock();
  }

  it('film: ricerca POST DLE + dettaglio con IMDb corrispondente => stream AltadefinizioneX', async () => {
    const seen = [];
    installFetchMock({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml(), seen });
    installTmdbMock();
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.equal(out.length, 1);
    assert.ok(out[0].name.includes('AltadefinizioneX'), out[0].name);
    assert.ok(!out[0].name.includes('StreamingCommunity'), out[0].name);
    assert.equal(out[0].url, scStreamFixture().url);
    assert.equal(out[0].easyProxySourceUrl, scStreamFixture().easyProxySourceUrl);
    assert.deepEqual(out[0].headers['User-Agent'], 'UA-MOCK');
    assert.deepEqual(out[0].subtitles, scStreamFixture().subtitles);
    assert.deepEqual(out[0].behaviorHints.proxyHeaders.request, scStreamFixture().headers);
    assert.equal(out[0].qualityTag, '💿 HD');
    assert.equal(out[0].language, '🇮🇹');
    assert.equal(scCalls.length, 1);
    const searchCall = seen.find((c) => c.url === `${BASE_URL}/`);
    assert.ok(searchCall, 'ricerca eseguita');
    assert.equal(searchCall.method, 'POST');
    assert.ok(searchCall.body.includes('story='), 'campo story presente');
    assert.ok(searchCall.body.includes('do=search'), 'campo do presente');
    assert.ok(searchCall.body.includes('subaction=search'), 'campo subaction presente');
  });

  it('tv: IMDb via external_ids, S/E mappati, titolo S02E03', async () => {
    mockSite({ searchHtml: tvSearchHtml(), detailHtml: serieDetailHtml() });
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
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml() });
    const api = load();
    for (const id of [`tmdb:${FILM_TMDB}`, FILM_TMDB]) {
      const out = await api.getStreams(id, 'movie', 1, 1);
      assert.equal(out.length, 1, `id ${id} deve risolvere`);
    }
  });

  it('IMDb dettaglio diverso dalla richiesta => [] e nessun riuso', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml({ imdb: 'tt9999999' }) });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('tt solo nei poster (nessun player vixsrc) => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml({ imdb: null }) });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('iframe/script solo commentati non contano come player => []', async () => {
    const filmCommentedOnly = `<html><body><!--<iframe id="dle-player" src="https://vixsrc.to/movie/${FILM_IMDB}?lang=it"></iframe>--><img src="/uploads/thumb/tt36429458.jpg" /><div class="movie_entry-details"><div class="row"><div class="col-auto label-text">Anno:</div><div class="col-auto">2026</div></div></div></body></html>`;
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmCommentedOnly });
    const api = load();
    assert.deepEqual(await api.getStreams(FILM_IMDB, 'movie', 1, 1), []);
    const serieCommentedOnly = `<html><body><!--<script>var imdb = '${TV_IMDB}'; iframe.src = 'https://vixsrc.to/tv/' + imdb;</script>--><img src="/uploads/logos/tt36849871.webp" /><div class="movie_entry-details"><div class="row"><div class="col-auto label-text">Anno:</div><div class="col-auto">2026</div></div></div></body></html>`;
    mockSite({ searchHtml: tvSearchHtml(), detailHtml: serieCommentedOnly });
    assert.deepEqual(await api.getStreams(TV_IMDB, 'series', 1, 1), []);
    assert.equal(scCalls.length, 0);
  });

  it('serie senza var imdb (solo player /tv/ generico) => []', async () => {
    mockSite({ searchHtml: tvSearchHtml(), detailHtml: serieDetailHtml({ imdb: null }) });
    const api = load();
    const out = await api.getStreams(TV_IMDB, 'series', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('tipo incoerente: dettaglio /tv/ per richiesta movie => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml({ imdb: FILM_IMDB, tvPlayer: true }).replace(/<iframe[^>]*><\/iframe>/, '') });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('tipo incoerente: dettaglio /movie/ per richiesta series => []', async () => {
    mockSite({ searchHtml: tvSearchHtml(), detailHtml: serieDetailHtml({ moviePlayer: true }).replace(/vixsrc\.to\/tv\//, 'vixsrc.to/other/') });
    const api = load();
    const out = await api.getStreams(TV_IMDB, 'series', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('anno dettaglio diverso dal TMDB => []', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml({ year: '2020' }) });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('titolo/anno card non corrispondenti => []', async () => {
    mockSite({
      searchHtml: `<div class="col"><div class="movie" data-imdb="5.0" data-year="2020" data-link="https://altadefinizionex.surf/drammatico/1-x-streaming.html"><div class="movie-info"><h2 class="movie-title"><a href="https://altadefinizionex.surf/drammatico/1-x-streaming.html">Altro Film</a></h2></div></div></div>`,
      detailHtml: filmDetailHtml()
    });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
    assert.equal(scCalls.length, 0);
  });

  it('tipo serie scarta card film e viceversa', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml() });
    const api = load();
    const out = await api.getStreams(TV_IMDB, 'series', 1, 1);
    assert.deepEqual(out, []);
  });

  it('errori rete (search/detail) => [] senza throw', async () => {
    installFetchMock({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml(), failUrls: ['altadefinizionex.surf'] });
    installTmdbMock();
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('search vuota => []', async () => {
    mockSite({ searchHtml: '<div class="row">no results</div>', detailHtml: filmDetailHtml() });
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('host spoof in query o suffisso dominio scartati', async () => {
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml() });
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
    mockSite({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml() });
    scMod.getStreams = async () => { throw new Error('sc-down'); };
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.deepEqual(out, []);
  });

  it('tipo non supportato (anime) => [] senza rete sito', async () => {
    const seen = installFetchMock({ searchHtml: filmSearchHtml(), detailHtml: filmDetailHtml() });
    installTmdbMock();
    const api = load();
    const out = await api.getStreams('kitsu:1', 'anime', 1, 1);
    assert.deepEqual(out, []);
    assert.ok(!seen.some((c) => c.url.includes('altadefinizionex.surf')));
  });

  it('sorgente usa fetchWithTimeout POST, mai raw fetch(), nessun nuovo extractor', () => {
    const src = fs.readFileSync(SRC_PATH, 'utf8');
    assert.ok(src.includes('fetchWithTimeout'), 'deve usare fetchWithTimeout');
    assert.ok(!/(^|[^a-zA-Z_])await\s+fetch\s*\(/.test(src), 'mai raw fetch()');
    assert.ok(src.includes('streamingcommunity/index'), 'riuso streamingcommunity');
    assert.ok(!/stayonline|mixdrop|unPack|atob\(|eval\(function|cf_bypass|voe|vidara|firestream|supervideo/i.test(src), 'nessun nuovo extractor/bypass');
    assert.ok(src.includes('append_to_response=external_ids'), 'IMDb da external_ids');
    assert.ok(src.includes('new URL('), 'allowlist via hostname URL');
    assert.ok(src.includes('subaction'), 'ricerca DLE con subaction');
    assert.ok(/method:\s*["']POST["']/.test(src), 'ricerca via POST');
    assert.ok(!src.includes('URLSearchParams'), 'nessuna dipendenza da URLSearchParams (runtime Nuvio)');
  });

  it('form search codifica & # apostrofi e unicode via encodeURIComponent', async () => {
    const special = `L'Ultima & Alba #2 è`;
    const card = `<div class="col"><div class="movie" data-imdb="7.0" data-year="2026" data-link="https://altadefinizionex.surf/drammatico/35054-doing-life-streaming.html"><div class="movie-info"><h2 class="movie-title"><a href="https://altadefinizionex.surf/drammatico/35054-doing-life-streaming.html">${special}</a></h2></div></div></div>`;
    const seen = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      seen.push({ url: u, method: String(opts.method || 'GET').toUpperCase(), body: String(opts.body || '') });
      if (u.includes('/3/find/')) return { ok: true, status: 200, json: async () => ({ movie_results: [{ id: 1458857 }], tv_results: [] }), text: async () => '' };
      if (u.includes(`/3/movie/${FILM_TMDB}`)) {
        return {
          ok: true, status: 200,
          json: async () => ({ title: special, original_title: special, release_date: '2026-01-01', external_ids: { imdb_id: FILM_IMDB } }),
          text: async () => ''
        };
      }
      if (u === `${BASE_URL}/`) return { ok: true, status: 200, json: async () => ({}), text: async () => card };
      if (u.startsWith(`${BASE_URL}/`)) return { ok: true, status: 200, json: async () => ({}), text: async () => filmDetailHtml() };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    const api = load();
    const out = await api.getStreams(FILM_IMDB, 'movie', 1, 1);
    assert.equal(out.length, 1);
    const searchCall = seen.find((c) => c.url === `${BASE_URL}/`);
    const expected = `story=${encodeURIComponent(special)}&do=search&subaction=search`;
    assert.equal(searchCall.body, expected, searchCall.body);
  });
});

describe('altadefinizionex in VM senza URLSearchParams (runtime Nuvio)', () => {
  const vm = require('node:vm');
  const realFormatter = require(path.join(__dirname, '..', 'src', 'formatter.js'));

  function tmdbPayload(u) {
    if (u.includes('/3/find/')) {
      const m = u.match(/find\/(tt\d+)/i);
      const imdb = m ? m[1] : '';
      if (imdb === FILM_IMDB) return { movie_results: [{ id: 1458857 }], tv_results: [] };
      if (imdb === TV_IMDB) return { movie_results: [], tv_results: [{ id: 290856 }] };
      return { movie_results: [], tv_results: [] };
    }
    if (u.includes(`/3/movie/${FILM_TMDB}`)) {
      return { title: 'Doing Life', original_title: 'Doing Life', release_date: '2026-05-01', external_ids: { imdb_id: FILM_IMDB } };
    }
    if (u.includes(`/3/tv/${TV_TMDB}`)) {
      return { name: 'Marshals', original_name: 'Marshals', first_air_date: '2026-03-01', external_ids: { imdb_id: TV_IMDB } };
    }
    return null;
  }

  function runVmGetStreams(id, type, season, episode) {
    const src = fs.readFileSync(SRC_PATH, 'utf8');
    assert.ok(!src.includes('URLSearchParams'), 'sorgente senza URLSearchParams');
    const fetchWithTimeout = async (url, opts = {}) => {
      const u = String(url);
      const tmdb = tmdbPayload(u);
      if (tmdb) return { ok: true, status: 200, json: async () => tmdb, text: async () => '' };
      if (u === `${BASE_URL}/`) {
        const body = String(opts.body || '');
        const html = body.includes('Marshals') ? tvSearchHtml() : filmSearchHtml();
        return { ok: true, status: 200, json: async () => ({}), text: async () => html };
      }
      if (u.startsWith(`${BASE_URL}/`)) {
        const html = u.includes('/serie-tv/') ? serieDetailHtml() : filmDetailHtml();
        return { ok: true, status: 200, json: async () => ({}), text: async () => html };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    };
    const scCalls = [];
    const sandbox = {
      module: { exports: {} },
      console: { log() {}, warn() {}, error() {} },
      Promise,
      JSON,
      Object,
      Array,
      String,
      Number,
      RegExp,
      Error,
      encodeURIComponent,
      decodeURIComponent,
      URL,
      URLSearchParams: undefined,
      require: (spec) => {
        if (String(spec).endsWith('fetch_helper.js')) return { fetchWithTimeout };
        if (String(spec).endsWith('formatter.js')) return realFormatter;
        if (String(spec).endsWith('streamingcommunity/index.js')) {
          return {
            getStreams: async (...args) => {
              scCalls.push(args);
              const s = scStreamFixture();
              if (String(args[1]).toLowerCase() !== 'movie') s.originalTitle = 'Marshals 1x1';
              return [s];
            }
          };
        }
        throw new Error('require non disponibile in sandbox: ' + String(spec));
      }
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${src}\n//# sourceURL=altadefinizionex-index.js`, sandbox, { timeout: 5000 });
    return sandbox.module.exports.getStreams(id, type, season, episode, {}).then((out) => ({ out, scCalls }));
  }

  it('film in VM senza URLSearchParams => 1 stream AltadefinizioneX', async () => {
    const { out, scCalls } = await runVmGetStreams(FILM_IMDB, 'movie', 1, 1);
    assert.equal(out.length, 1);
    assert.ok(out[0].name.includes('AltadefinizioneX'), out[0].name);
    assert.equal(scCalls.length, 1);
  });

  it('serie S1E1 in VM senza URLSearchParams => 1 stream con titolo episodio', async () => {
    const { out, scCalls } = await runVmGetStreams(TV_IMDB, 'series', 1, 1);
    assert.equal(out.length, 1);
    assert.ok(out[0].name.includes('AltadefinizioneX'), out[0].name);
    assert.equal(scCalls[0][1], 'tv');
    assert.ok(out[0].title.includes('S01E01'), out[0].title);
  });
});

describe('altadefinizionex registrazione/integrazione (offline)', () => {
  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('manifest: voce easystreams-altadefinizionex coerente e bundle esistente', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.ok(/^\d+\.\d+\.\d+$/.test(String(manifest.version)), 'manifest version semver');
    const entry = manifest.scrapers.find((s) => s.id === 'easystreams-altadefinizionex');
    assert.ok(entry, 'voce manifest presente');
    assert.equal(entry.filename, 'providers/altadefinizionex.js');
    assert.ok(fs.existsSync(path.join(ROOT, entry.filename)), 'bundle generato esistente');
    assert.deepEqual(entry.supportedTypes, ['movie', 'tv', 'series']);
    assert.deepEqual(entry.idPrefixes, ['tmdb:', 'tt']);
  });

  it('build: NUVIO_SCRAPERS include altadefinizionex', () => {
    const build = read('build.js');
    assert.ok(/'altadefinizionex'/.test(build), 'NUVIO_SCRAPERS esteso');
  });
});
