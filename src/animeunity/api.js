"use strict";

// Client for the animeunity.cx JSON API (port of animeunity-api/api_client.py).
// No auth/cookies needed. Stream = signed VixCloud embed, resolved by extractVixCloud.

const { extractVixCloud } = require("../extractors");
const { createTimeoutSignal } = require("../fetch_helper.js");

const BASE_URL = "https://animeunity.cx";
const TIMEOUT = 10000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let inertiaVersion = null;

async function request(url, headers = {}) {
  const t = createTimeoutSignal(TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/plain, */*",
        Referer: `${BASE_URL}/`,
        ...headers
      },
      signal: t.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    if (typeof t.cleanup === "function") t.cleanup();
  }
}

async function getInertiaVersion() {
  if (inertiaVersion) return inertiaVersion;
  const html = await (await request(BASE_URL, { Accept: "text/html" })).text();
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) throw new Error("Inertia page data not found");
  const json = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  inertiaVersion = JSON.parse(json).version || "";
  return inertiaVersion;
}

// "/anime/1469-naruto" -> { id: 1469, slug: "naruto" }
function parseAnimePath(animePath) {
  const m = String(animePath || "").match(/^\/anime\/(\d+)(?:-([^/?#]+))?/i);
  return m ? { id: Number(m[1]), slug: m[2] || "" } : null;
}

async function getEpisode(animeId, episodeNumber) {
  const wanted = Number(episodeNumber);
  const start = Math.max(1, Math.floor(wanted));
  const data = await (await request(`${BASE_URL}/api/anime/${animeId}/episodes?start=${start}`)).json();
  const list = Array.isArray(data?.episodes) ? data.episodes : [];
  return list.find((e) => Number(e.number) === wanted) || (list.length === 1 ? list[0] : null);
}

async function getEmbedUrl(animeId, slug, videoId) {
  const version = await getInertiaVersion();
  const animeUrl = `${BASE_URL}/anime/${animeId}${slug ? `-${slug}` : ""}`;
  const data = await (
    await request(`${animeUrl}/${videoId}`, {
      "X-Inertia": "true",
      "X-Inertia-Version": version,
      "X-Inertia-Partial-Component": "Anime",
      "X-Inertia-Partial-Data": "episode,embedUrl",
      Referer: animeUrl
    })
  ).json();
  return data?.props?.embedUrl || null;
}

// Returns streams (one per available language/video) or [] on any failure.
async function extractStreamsViaApi(animePath, requestedEpisode, title = "AnimeUnity") {
  const anime = parseAnimePath(animePath);
  if (!anime) return [];

  const episode = await getEpisode(anime.id, requestedEpisode);
  const videos = Array.isArray(episode?.videos) ? episode.videos : [];
  const displayTitle = `${title} - Ep ${episode?.number ?? requestedEpisode}`;

  const perVideo = await Promise.all(
    videos.map(async (video) => {
      try {
        const embedUrl = await getEmbedUrl(anime.id, anime.slug, video.id);
        if (!embedUrl) return [];
        const streams = (await extractVixCloud(embedUrl)) || [];
        const language =
          String(video.language).toLowerCase() === "ita" ? "\u{1F1EE}\u{1F1F9}" : "\u{1F1EF}\u{1F1F5}";
        return streams.map((s) => ({
          ...s,
          easyProxySourceUrl: embedUrl.replace("vixcloud.co", "cromosino.space"),
          name: "AnimeUnity - VixCloud",
          title: displayTitle,
          language
        }));
      } catch (e) {
        console.error("[AnimeUnity API] video failed:", e.message);
        return [];
      }
    })
  );
  return perVideo.flat();
}

module.exports = { extractStreamsViaApi, parseAnimePath };
