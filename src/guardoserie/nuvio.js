'use strict';

// Entry client-only per Nuvio (build --nuvio).
// Duplica esattamente il ramo client (!IS_SERVER) di src/guardoserie/index.js
// senza includere alcun ramo/require server-only (cf_handler, cf_bypass,
// extractors, fs/path/child_process). La build --nuvio usa questo file come
// entry per guardoserie, cosi' il bundle non contiene rami Node.
// Mantenere sincronizzato con il ramo client di src/guardoserie/index.js.

const { fetchWithTimeout } = require('../fetch_helper');

var GUARDOSERIE_RESOLVE_DEFAULT_BASE = 'https://easystreams.realbestia.com/resolve/guardoserie';
var GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT = 10000;
var GUARDOSERIE_RESOLVE_MIN_TIMEOUT = 10;
var GUARDOSERIE_RESOLVE_MAX_TIMEOUT = 30000;

function getGuardoserieClientSettings() {
    try {
        if (typeof globalThis !== 'undefined' && globalThis && typeof globalThis.SCRAPER_SETTINGS === 'object' && globalThis.SCRAPER_SETTINGS) {
            return globalThis.SCRAPER_SETTINGS;
        }
    } catch (_) {}
    return {};
}

function getGuardoserieResolveBase(settings) {
    try {
        var raw = settings ? settings.guardoserieResolveBase : undefined;
        if (typeof raw !== 'string') return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        var trimmed = raw.trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        if (/\s/.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        if (trimmed.indexOf('?') !== -1 || trimmed.indexOf('#') !== -1) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        if (trimmed.indexOf('@') !== -1) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        if (!/^https?:\/\/[^\/\s?#@]+(?::\d+)?(\/[^\s?#]*)?$/i.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
        return trimmed;
    } catch (_) {
        return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    }
}

function getGuardoserieResolveTimeout(settings) {
    try {
        var raw = settings ? settings.guardoserieResolveTimeout : undefined;
        if (typeof raw === 'undefined' || raw === null || raw === '') return GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT;
        var parsed = Number.parseInt(String(raw), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT;
        if (parsed < GUARDOSERIE_RESOLVE_MIN_TIMEOUT) return GUARDOSERIE_RESOLVE_MIN_TIMEOUT;
        if (parsed > GUARDOSERIE_RESOLVE_MAX_TIMEOUT) return GUARDOSERIE_RESOLVE_MAX_TIMEOUT;
        return parsed;
    } catch (_) {
        return GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT;
    }
}

module.exports = {
    getStreams: async (id, type, season, episode) => {
        var settings = getGuardoserieClientSettings();
        var base = getGuardoserieResolveBase(settings);
        var timeout = getGuardoserieResolveTimeout(settings);
        var url = base + '?id=' + encodeURIComponent(String(id == null ? '' : id)) + '&type=' + encodeURIComponent(String(type == null ? '' : type)) + '&s=' + encodeURIComponent(String(season || 1)) + '&ep=' + encodeURIComponent(String(episode || 1));
        var task = (async function () {
            var response = await fetchWithTimeout(url, { timeout: timeout });
            if (!response || !response.ok) return [];
            var data = await response.json();
            if (!data || !Array.isArray(data.streams)) return [];
            return data.streams;
        })();
        if (task && typeof task.catch === 'function') task.catch(function () {});
        if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
            try {
                return await task;
            } catch (_) {
                try { console.warn('[Guardoserie-Client] Content unavailable'); } catch (__) {}
                return [];
            }
        }
        var timer = null;
        var timeoutPromise = new Promise(function (_, reject) {
            timer = setTimeout(function () {
                reject(new Error('Request timed out after ' + timeout + 'ms'));
            }, timeout);
        });
        try {
            return await Promise.race([task, timeoutPromise]);
        } catch (_) {
            try { console.warn('[Guardoserie-Client] Content unavailable'); } catch (__) {}
            return [];
        } finally {
            try { if (timer !== null) clearTimeout(timer); } catch (_) {}
        }
    }
};
