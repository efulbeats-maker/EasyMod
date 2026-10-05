'use strict';

// Shared client-only helper for seasonal anime lookups (Task A).
// Resolves TMDB TV id -> IMDb id via /external_ids and validates seasonal
// IMDb mapping payloads before S1 extraction.
// Client-only: only relative require, no native modules, no dispatcher,
// URLs built with encodeURIComponent, no URL/key logging, no new deps.

const { fetchWithTimeout } = require('./fetch_helper');

var TMDB_API_KEY_DEFAULT = '68e094699525b18a70bab2f86b1fa706';
var TMDB_EXTERNAL_IDS_TIMEOUT_DEFAULT = 5000;
var TMDB_EXTERNAL_IDS_MIN_TIMEOUT = 10;
var TMDB_EXTERNAL_IDS_MAX_TIMEOUT = 30000;

function getTmdbApiKey(explicit) {
  try {
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  } catch (_) {}
  return TMDB_API_KEY_DEFAULT;
}

function getTmdbResolveTimeout(explicit) {
  try {
    if (typeof explicit !== 'undefined' && explicit !== null && explicit !== '') {
      var p = Number.parseInt(String(explicit), 10);
      if (Number.isFinite(p) && p > 0) {
        if (p < TMDB_EXTERNAL_IDS_MIN_TIMEOUT) return TMDB_EXTERNAL_IDS_MIN_TIMEOUT;
        if (p > TMDB_EXTERNAL_IDS_MAX_TIMEOUT) return TMDB_EXTERNAL_IDS_MAX_TIMEOUT;
        return p;
      }
    }
  } catch (_) {}
  try {
    var s = null;
    if (typeof globalThis !== 'undefined' && globalThis && typeof globalThis.SCRAPER_SETTINGS === 'object' && globalThis.SCRAPER_SETTINGS) {
      s = globalThis.SCRAPER_SETTINGS;
    }
    if (s) {
      var raw = s.animeMappingTmdbTimeout;
      if (typeof raw !== 'undefined' && raw !== null && raw !== '') {
        var q = Number.parseInt(String(raw), 10);
        if (Number.isFinite(q) && q > 0) {
          if (q < TMDB_EXTERNAL_IDS_MIN_TIMEOUT) return TMDB_EXTERNAL_IDS_MIN_TIMEOUT;
          if (q > TMDB_EXTERNAL_IDS_MAX_TIMEOUT) return TMDB_EXTERNAL_IDS_MAX_TIMEOUT;
          return q;
        }
      }
    }
  } catch (_) {}
  return TMDB_EXTERNAL_IDS_TIMEOUT_DEFAULT;
}

function normalizeSeasonValue(value) {
  try {
    var p = Number.parseInt(String(value), 10);
    if (Number.isInteger(p) && p >= 0) return p;
  } catch (_) {}
  return null;
}

function normalizeEpisodeValue(value) {
  try {
    var p = Number.parseInt(String(value), 10);
    if (Number.isInteger(p) && p > 0) return p;
  } catch (_) {}
  return null;
}

function normalizeLookupType(type) {
  return String(type || '').trim().toLowerCase();
}

function isSeasonalTvLookup(lookup, type) {
  try {
    if (!lookup) return false;
    if (String(lookup.provider || '').toLowerCase() !== 'tmdb') return false;
    var t = normalizeLookupType(type);
    if (t !== 'tv' && t !== 'series' && t !== 'anime') return false;
    var s = normalizeSeasonValue(lookup.season);
    return Number.isInteger(s) && s >= 2;
  } catch (_) {
    return false;
  }
}

function isSeasonalImdbLookup(lookup, type) {
  try {
    if (!lookup) return false;
    if (String(lookup.provider || '').toLowerCase() !== 'imdb') return false;
    var t = normalizeLookupType(type);
    if (t !== 'tv' && t !== 'series' && t !== 'anime') return false;
    var s = normalizeSeasonValue(lookup.season);
    return Number.isInteger(s) && s >= 2;
  } catch (_) {
    return false;
  }
}

function getRequestedEcho(payload) {
  var out = { season: null, episode: null, hasSeason: false, hasEpisode: false };
  try {
    if (!payload || typeof payload !== 'object') return out;
    var r = payload.requested;
    if (!r || typeof r !== 'object') return out;
    var seasonRaw = null;
    var episodeRaw = null;
    var hasSeason = false;
    var hasEpisode = false;
    if (Object.prototype.hasOwnProperty.call(r, 'season')) { seasonRaw = r.season; hasSeason = true; }
    else if (Object.prototype.hasOwnProperty.call(r, 's')) { seasonRaw = r.s; hasSeason = true; }
    if (Object.prototype.hasOwnProperty.call(r, 'episode')) { episodeRaw = r.episode; hasEpisode = true; }
    else if (Object.prototype.hasOwnProperty.call(r, 'ep')) { episodeRaw = r.ep; hasEpisode = true; }
    if (hasSeason && (seasonRaw === '' || seasonRaw === null || typeof seasonRaw === 'undefined')) hasSeason = false;
    if (hasEpisode && (episodeRaw === '' || episodeRaw === null || typeof episodeRaw === 'undefined')) hasEpisode = false;
    out.season = hasSeason ? normalizeSeasonValue(seasonRaw) : null;
    out.episode = hasEpisode ? normalizeEpisodeValue(episodeRaw) : null;
    out.hasSeason = hasSeason;
    out.hasEpisode = hasEpisode;
  } catch (_) {}
  return out;
}

function getMatchedBy(payload) {
  try {
    if (!payload || typeof payload !== 'object') return { present: false, value: undefined };
    var candidates = [];
    if (payload.mappings && typeof payload.mappings === 'object') {
      if (payload.mappings.tmdb_episode && typeof payload.mappings.tmdb_episode === 'object') candidates.push(payload.mappings.tmdb_episode);
      if (payload.mappings.tmdbEpisode && typeof payload.mappings.tmdbEpisode === 'object') candidates.push(payload.mappings.tmdbEpisode);
    }
    if (payload.tmdb_episode && typeof payload.tmdb_episode === 'object') candidates.push(payload.tmdb_episode);
    if (payload.tmdbEpisode && typeof payload.tmdbEpisode === 'object') candidates.push(payload.tmdbEpisode);
    for (var i = 0; i < candidates.length; i += 1) {
      var c = candidates[i];
      if (c && Object.prototype.hasOwnProperty.call(c, 'matchedBy')) return { present: true, value: c.matchedBy };
    }
  } catch (_) {}
  return { present: false, value: undefined };
}

function hasPositiveMatchedBy(payload) {
  try {
    var mb = getMatchedBy(payload);
    if (!mb.present) return false;
    var v = mb.value;
    if (v === null || typeof v === 'undefined') return false;
    if (typeof v === 'boolean') return v;
    var text = String(v).trim();
    if (!text) return false;
    var lower = text.toLowerCase();
    if (lower === 'null' || lower === 'none' || lower === 'false') return false;
    return true;
  } catch (_) {
    return false;
  }
}

function getKitsuEpisode(payload) {
  try {
    if (!payload || typeof payload !== 'object') return null;
    var direct = payload.kitsu && typeof payload.kitsu === 'object' ? payload.kitsu.episode : null;
    return normalizeEpisodeValue(direct);
  } catch (_) {}
  return null;
}

function isValidSeasonalImdbMapping(payload, lookup) {
  try {
    if (!payload || typeof payload !== 'object') return false;
    if (!lookup) return false;
    var lookupSeason = normalizeSeasonValue(lookup.season);
    var lookupEpisode = normalizeEpisodeValue(lookup.episode) || 1;
    var echo = getRequestedEcho(payload);
    if (echo.hasSeason && echo.season !== null && lookupSeason !== null && echo.season !== lookupSeason) return false;
    if (echo.hasSeason && echo.season === null) return false;
    if (echo.hasEpisode && echo.episode !== null && echo.episode !== lookupEpisode) return false;
    if (echo.hasEpisode && echo.episode === null) return false;
    // Evident mismapping: matchedBy null + kitsu assente.
    var mb = getMatchedBy(payload);
    if (mb.present && (mb.value === null || typeof mb.value === 'undefined')) {
      if (!getKitsuEpisode(payload)) return false;
    }
    // Ambiguous S>=2: echo da solo non prova matching. Richiede almeno una prova
    // positiva (kitsu.episode valido oppure matchedBy positivo), altrimenti false.
    // matchedBy null + kitsu valido resta accettato.
    if (!getKitsuEpisode(payload) && !hasPositiveMatchedBy(payload)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

async function fetchJsonWithDeadline(url, options) {
  var opts = options || {};
  var timeoutMs = getTmdbResolveTimeout(opts.timeoutMs);
  var impl = (opts && typeof opts.fetchWithTimeoutImpl === 'function') ? opts.fetchWithTimeoutImpl : fetchWithTimeout;
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    try {
      var fallback = await impl(url, { timeout: timeoutMs });
      if (!fallback || !fallback.ok) return null;
      return await fallback.json();
    } catch (_) {
      return null;
    }
  }
  var timer = null;
  var timeoutPromise = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(new Error('Request timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
  });
  var task = (async function () {
    var response = await impl(url, { timeout: timeoutMs });
    if (!response || !response.ok) return null;
    return await response.json();
  })();
  if (task && typeof task.catch === 'function') task.catch(function () {});
  try {
    return await Promise.race([task, timeoutPromise]);
  } catch (_) {
    return null;
  } finally {
    try { if (timer !== null) clearTimeout(timer); } catch (_) {}
  }
}

async function resolveTmdbTvToImdb(tmdbId, options) {
  try {
    var text = String(tmdbId == null ? '' : tmdbId).trim();
    if (!/^\d+$/.test(text)) return null;
    var opts = options || {};
    var apiKey = getTmdbApiKey(opts.apiKey);
    var url = 'https://api.themoviedb.org/3/tv/' + encodeURIComponent(text) + '/external_ids?api_key=' + encodeURIComponent(apiKey);
    var data = await fetchJsonWithDeadline(url, opts);
    if (!data || typeof data !== 'object') return null;
    var imdbText = String(data.imdb_id || '').trim();
    if (/^tt\d+$/.test(imdbText)) return imdbText;
    return null;
  } catch (_) {
    try { console.warn('[AnimeMapping] Content unavailable'); } catch (_) {}
    return null;
  }
}

module.exports = {
  TMDB_API_KEY_DEFAULT: TMDB_API_KEY_DEFAULT,
  TMDB_EXTERNAL_IDS_TIMEOUT_DEFAULT: TMDB_EXTERNAL_IDS_TIMEOUT_DEFAULT,
  getTmdbApiKey: getTmdbApiKey,
  getTmdbResolveTimeout: getTmdbResolveTimeout,
  isSeasonalTvLookup: isSeasonalTvLookup,
  isSeasonalImdbLookup: isSeasonalImdbLookup,
  getRequestedEcho: getRequestedEcho,
  getMatchedBy: getMatchedBy,
  getKitsuEpisode: getKitsuEpisode,
  isValidSeasonalImdbMapping: isValidSeasonalImdbMapping,
  fetchJsonWithDeadline: fetchJsonWithDeadline,
  resolveTmdbTvToImdb: resolveTmdbTvToImdb
};
