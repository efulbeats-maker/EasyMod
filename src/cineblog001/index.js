const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
const BASE_URL = "https://cineblog001.tattoo";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

// Host consentiti (match esatto o sottodominio): niente includes() su URL intero.
const VIXSRC_BASES = ["cromosino.space", "vixsrc.to", "vixcloud.co"];

const { fetchWithTimeout } = require("../fetch_helper.js");
const { formatStream } = require("../formatter.js");
const streamingcommunity = require("../streamingcommunity/index.js");

function siteHeaders() {
  return {
    "User-Agent": USER_AGENT,
    "Referer": `${BASE_URL}/`,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7"
  };
}

async function fetchText(url) {
  try {
    const response = await fetchWithTimeout(url, { headers: siteHeaders() });
    if (!response || !response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
    });
    if (!response || !response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function requestImdbId(id, providerContext = null) {
  const idStr = String(id || "").trim();
  if (/^tt\d+$/i.test(idStr)) return idStr;
  const contextImdb = providerContext && /^tt\d+$/i.test(String(providerContext.imdbId || ""))
    ? String(providerContext.imdbId)
    : null;
  return contextImdb;
}

async function resolveTmdbId(id, type, providerContext = null) {
  const contextTmdbId = providerContext && /^\d+$/.test(String(providerContext.tmdbId || ""))
    ? String(providerContext.tmdbId)
    : null;
  if (contextTmdbId) return contextTmdbId;

  const idStr = String(id || "").trim();
  if (/^tmdb:\d+$/i.test(idStr)) return idStr.split(":")[1];
  if (/^\d+$/.test(idStr)) return idStr;

  // Niente fallback incrociato movie/tv: ogni tipo consulta solo il proprio ramo.
  const imdbId = requestImdbId(id, providerContext);
  if (!imdbId) return null;
  const normalizedType = String(type || "").toLowerCase();
  const payload = await fetchJson(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
  if (!payload) return null;

  if (normalizedType === "movie") {
    if (Array.isArray(payload.movie_results) && payload.movie_results[0]?.id) return String(payload.movie_results[0].id);
    return null;
  }
  if (Array.isArray(payload.tv_results) && payload.tv_results[0]?.id) return String(payload.tv_results[0].id);
  return null;
}

async function getShowMeta(tmdbId, providerType) {
  // L'IMDb arriva SOLO da external_ids (il dettaglio tv standard non ha imdb_id).
  const endpoint = providerType === "movie" ? "movie" : "tv";
  const payload = await fetchJson(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=it-IT&append_to_response=external_ids`);
  if (!payload) return null;
  const title = payload.title || payload.name || payload.original_title || payload.original_name || null;
  if (!title) return null;
  const altRaw = payload.original_title || payload.original_name || null;
  const dateStr = payload.release_date || payload.first_air_date || "";
  const yearMatch = String(dateStr).match(/^(19|20)\d{2}/);
  const externalImdb = payload.external_ids && /^tt\d+$/i.test(String(payload.external_ids.imdb_id || ""))
    ? String(payload.external_ids.imdb_id)
    : null;
  return {
    title,
    altTitle: altRaw && altRaw !== title ? altRaw : null,
    year: yearMatch ? yearMatch[0] : null,
    imdbId: externalImdb
  };
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(19|20)\d{2}[^)]*\)/g, " ")
    .replace(/\bstreaming\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function extractCardYear(title) {
  const match = String(title || "").match(/\((?:[^)]*?)?((?:19|20)\d{2})(?:[^)]*)?\)/);
  return match ? match[1] : null;
}

function parseSearchCards(html) {
  const cards = [];
  const articleRegex = /<article class="short[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch;
  while ((articleMatch = articleRegex.exec(String(html || ""))) !== null) {
    const body = articleMatch[1];
    const linkMatch = body.match(/<h3[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!linkMatch) continue;
    const url = linkMatch[1].trim();
    if (!url.startsWith(`${BASE_URL}/cb01-streaming/`)) continue;
    cards.push({
      url,
      title: linkMatch[2].trim(),
      isSerie: /serie\s*tv/i.test(body)
    });
  }
  return cards;
}

function titleMatches(cardTitle, expectedTitle) {
  const card = normalizeTitle(cardTitle);
  const expected = normalizeTitle(expectedTitle);
  if (!card || !expected) return false;
  if (card === expected) return true;
  // Prefix consentito SOLO perche' la validazione IMDb a valle e' obbligatoria.
  return card.startsWith(expected) || expected.startsWith(card);
}

function titleMatchesAny(cardTitle, meta) {
  if (titleMatches(cardTitle, meta.title)) return true;
  if (meta.altTitle && titleMatches(cardTitle, meta.altTitle)) return true;
  return false;
}

function selectCandidates(cards, meta, wantSerie) {
  return cards.filter((card) => {
    if (Boolean(card.isSerie) !== wantSerie) return false;
    if (!titleMatchesAny(card.title, meta)) return false;
    const cardYear = extractCardYear(card.title);
    if (meta.year && cardYear && cardYear !== meta.year) return false;
    return true;
  });
}

function extractDetailSignals(html) {
  const text = String(html || "");
  const imdbMatch = text.match(/var\s+imdb\s*=\s*['"](tt\d+)['"]/i);
  const seriesMatch = text.match(/var\s+SERIES\s*=\s*([01])/);
  const hasPlayer = /id="vidxgo-player"/.test(text) && /vixsrc\.to\//.test(text);
  return {
    imdb: imdbMatch ? imdbMatch[1] : null,
    series: seriesMatch ? seriesMatch[1] === "1" : null,
    hasPlayer
  };
}

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
  if (!host) return false;
  return VIXSRC_BASES.some((base) => host === base || host.endsWith(`.${base}`));
}

function urlHostAllowed(value) {
  try {
    return hostAllowed(new URL(String(value)).hostname);
  } catch {
    return false;
  }
}

function isVixsrcFamily(url, sourceUrl) {
  return urlHostAllowed(url) || urlHostAllowed(sourceUrl);
}

function relabelStream(stream) {
  if (!stream || !stream.url) return null;
  const streamUrl = String(stream.url);
  const sourceUrl = String(stream.easyProxySourceUrl || "");
  // Solo ramo vixsrc: host esatto o sottodominio controllato, mai includes().
  if (!isVixsrcFamily(streamUrl, sourceUrl)) return null;

  const raw = {
    name: "Cineblog001",
    title: stream.originalTitle || stream.title || "Stream",
    url: stream.url,
    easyProxySourceUrl: stream.easyProxySourceUrl,
    headers: stream.headers,
    behaviorHints: stream.behaviorHints,
    quality: stream.quality,
    language: stream.language,
    type: stream.type,
    referer: stream.referer,
    userAgent: stream.userAgent,
    subtitles: stream.subtitles,
    size: stream.size
  };
  return formatStream(raw, "Cineblog001");
}

async function getStreams(id, type, season, episode, providerContext = null) {
  const normalizedType = String(type || "").toLowerCase();
  if (normalizedType !== "movie" && normalizedType !== "tv" && normalizedType !== "series") return [];
  const wantSerie = normalizedType !== "movie";
  const providerType = normalizedType === "movie" ? "movie" : "tv";

  const tmdbId = await resolveTmdbId(id, providerType, providerContext);
  if (!tmdbId) return [];

  const meta = await getShowMeta(tmdbId, providerType);
  if (!meta) return [];

  // Validazione IMDb fail-closed: richiesta/context oppure external_ids, mai allentata.
  const expectedImdb = requestImdbId(id, providerContext) || meta.imdbId;
  if (!expectedImdb) return [];

  const searchHtml = await fetchText(`${BASE_URL}/index.php?do=search&subaction=search&story=${encodeURIComponent(meta.title)}`);
  if (!searchHtml) return [];

  const candidates = selectCandidates(parseSearchCards(searchHtml), meta, wantSerie);
  if (candidates.length === 0) return [];

  // Il dettaglio deve confermare: IMDb uguale, SERIES coerente, player vixsrc reale.
  let matched = false;
  for (const candidate of candidates.slice(0, 3)) {
    const detailHtml = await fetchText(candidate.url);
    if (!detailHtml) continue;
    const signals = extractDetailSignals(detailHtml);
    if (!signals.imdb || signals.imdb.toLowerCase() !== expectedImdb.toLowerCase()) continue;
    if (signals.series !== wantSerie) continue;
    if (!signals.hasPlayer) continue;
    matched = true;
    break;
  }
  if (!matched) return [];

  const effectiveSeason = parseInt(String(season || ""), 10) || 1;
  const effectiveEpisode = parseInt(String(episode || ""), 10) || 1;

  // Riuso del ramo vixsrc gia' funzionante: nessuna duplicazione del resolver,
  // nessun nuovo extractor, nessun bypass.
  let resolved = [];
  try {
    resolved = await streamingcommunity.getStreams(id, providerType, effectiveSeason, effectiveEpisode, providerContext);
  } catch {
    return [];
  }
  if (!Array.isArray(resolved)) return [];

  return resolved.map(relabelStream).filter(Boolean);
}

module.exports = { getStreams };
