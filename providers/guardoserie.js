"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/fetch_helper.js
var require_fetch_helper = __commonJS({
  "src/fetch_helper.js"(exports2, module2) {
    var FETCH_TIMEOUT = 3e4;
    function isNuvioRuntime() {
      try {
        if (typeof navigator !== "undefined" && navigator && navigator.product === "ReactNative") {
          return true;
        }
        if (typeof globalThis !== "undefined" && globalThis && globalThis.HermesInternal) {
          return true;
        }
        if (typeof global !== "undefined" && global && global.HermesInternal) {
          return true;
        }
        if (typeof globalThis !== "undefined" && globalThis && globalThis.navigator && globalThis.navigator.product === "ReactNative") {
          return true;
        }
      } catch (e) {
        return false;
      }
      return false;
    }
    function createTimeoutSignal(timeoutMs) {
      const parsed = Number.parseInt(String(timeoutMs), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { signal: void 0, cleanup: null, timed: false };
      }
      if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        return { signal: AbortSignal.timeout(parsed), cleanup: null, timed: true };
      }
      if (typeof AbortController !== "undefined" && typeof setTimeout === "function") {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, parsed);
        return {
          signal: controller.signal,
          cleanup: () => clearTimeout(timeoutId),
          timed: true
        };
      }
      return { signal: void 0, cleanup: null, timed: false };
    }
    function fetchWithTimeout2(_0) {
      return __async(this, arguments, function* (url, options = {}) {
        const fetchImpl = typeof globalThis !== "undefined" && typeof globalThis.fetch === "function" ? globalThis.fetch : typeof fetch !== "undefined" ? fetch : void 0;
        if (typeof fetchImpl === "undefined") {
          throw new Error("No fetch implementation found!");
        }
        const _a = options || {}, { timeout, dispatcher } = _a, fetchOptions = __objRest(_a, ["timeout", "dispatcher"]);
        const requestTimeout = timeout || FETCH_TIMEOUT;
        const parsedTimeout = Number.parseInt(String(requestTimeout), 10);
        const hasDeadline = Number.isFinite(parsedTimeout) && parsedTimeout > 0;
        const timeoutConfig = createTimeoutSignal(requestTimeout);
        const externalSignal = fetchOptions.signal || null;
        const requestOptions = __spreadValues({}, fetchOptions);
        if (timeoutConfig.signal) {
          if (requestOptions.signal && typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
            try {
              requestOptions.signal = AbortSignal.any([requestOptions.signal, timeoutConfig.signal]);
            } catch (e) {
            }
          } else if (!requestOptions.signal) {
            requestOptions.signal = timeoutConfig.signal;
          }
        }
        if (dispatcher && !isNuvioRuntime()) {
          requestOptions.dispatcher = dispatcher;
        }
        let raceTimer = null;
        let timeoutFired = false;
        const buildTimeoutError = () => new Error(`Request timed out after ${parsedTimeout}ms`);
        let timeoutPromise = null;
        if (hasDeadline && typeof setTimeout === "function") {
          timeoutPromise = new Promise((_, reject) => {
            raceTimer = setTimeout(() => {
              timeoutFired = true;
              reject(buildTimeoutError());
            }, parsedTimeout);
          });
        }
        const clearRaceTimer = () => {
          if (raceTimer !== null && typeof clearTimeout === "function") {
            clearTimeout(raceTimer);
            raceTimer = null;
          }
        };
        try {
          const fetchPromise = fetchImpl(url, requestOptions);
          const response = timeoutPromise ? yield Promise.race([fetchPromise, timeoutPromise]) : yield fetchPromise;
          return response;
        } catch (error) {
          if (timeoutFired) {
            throw buildTimeoutError();
          }
          if (error && error.name === "AbortError") {
            try {
              if (externalSignal && externalSignal.aborted) {
                throw error;
              }
            } catch (e) {
              throw e;
            }
            if (timeoutConfig.timed) {
              throw buildTimeoutError();
            }
          }
          throw error;
        } finally {
          clearRaceTimer();
          if (typeof timeoutConfig.cleanup === "function") {
            timeoutConfig.cleanup();
          }
        }
      });
    }
    module2.exports = { fetchWithTimeout: fetchWithTimeout2, createTimeoutSignal, isNuvioRuntime, FETCH_TIMEOUT };
  }
});

// src/guardoserie/nuvio.js
var { fetchWithTimeout } = require_fetch_helper();
var GUARDOSERIE_RESOLVE_DEFAULT_BASE = "https://easystreams.realbestia.com/resolve/guardoserie";
var GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT = 1e4;
var GUARDOSERIE_RESOLVE_MIN_TIMEOUT = 10;
var GUARDOSERIE_RESOLVE_MAX_TIMEOUT = 3e4;
function getGuardoserieClientSettings() {
  try {
    if (typeof globalThis !== "undefined" && globalThis && typeof globalThis.SCRAPER_SETTINGS === "object" && globalThis.SCRAPER_SETTINGS) {
      return globalThis.SCRAPER_SETTINGS;
    }
  } catch (_) {
  }
  return {};
}
function getGuardoserieResolveBase(settings) {
  try {
    var raw = settings ? settings.guardoserieResolveBase : void 0;
    if (typeof raw !== "string") return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    var trimmed = raw.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    if (/\s/.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    if (trimmed.indexOf("?") !== -1 || trimmed.indexOf("#") !== -1) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    if (trimmed.indexOf("@") !== -1) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    if (!/^https?:\/\/[^\/\s?#@]+(?::\d+)?(\/[^\s?#]*)?$/i.test(trimmed)) return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
    return trimmed;
  } catch (_) {
    return GUARDOSERIE_RESOLVE_DEFAULT_BASE;
  }
}
function getGuardoserieResolveTimeout(settings) {
  try {
    var raw = settings ? settings.guardoserieResolveTimeout : void 0;
    if (typeof raw === "undefined" || raw === null || raw === "") return GUARDOSERIE_RESOLVE_DEFAULT_TIMEOUT;
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
  getStreams: (id, type, season, episode) => __async(null, null, function* () {
    var settings = getGuardoserieClientSettings();
    var base = getGuardoserieResolveBase(settings);
    var timeout = getGuardoserieResolveTimeout(settings);
    var url = base + "?id=" + encodeURIComponent(String(id == null ? "" : id)) + "&type=" + encodeURIComponent(String(type == null ? "" : type)) + "&s=" + encodeURIComponent(String(season || 1)) + "&ep=" + encodeURIComponent(String(episode || 1));
    var task = (function() {
      return __async(this, null, function* () {
        var response = yield fetchWithTimeout(url, { timeout });
        if (!response || !response.ok) return [];
        var data = yield response.json();
        if (!data || !Array.isArray(data.streams)) return [];
        return data.streams;
      });
    })();
    if (task && typeof task.catch === "function") task.catch(function() {
    });
    if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") {
      try {
        return yield task;
      } catch (_) {
        try {
          console.warn("[Guardoserie-Client] Content unavailable");
        } catch (__) {
        }
        return [];
      }
    }
    var timer = null;
    var timeoutPromise = new Promise(function(_, reject) {
      timer = setTimeout(function() {
        reject(new Error("Request timed out after " + timeout + "ms"));
      }, timeout);
    });
    try {
      return yield Promise.race([task, timeoutPromise]);
    } catch (_) {
      try {
        console.warn("[Guardoserie-Client] Content unavailable");
      } catch (__) {
      }
      return [];
    } finally {
      try {
        if (timer !== null) clearTimeout(timer);
      } catch (_) {
      }
    }
  })
};
