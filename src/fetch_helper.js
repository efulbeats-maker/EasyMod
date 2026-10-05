const FETCH_TIMEOUT = 30000; // 30 seconds

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
        if (
            typeof globalThis !== "undefined" &&
            globalThis &&
            globalThis.navigator &&
            globalThis.navigator.product === "ReactNative"
        ) {
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

function createTimeoutSignal(timeoutMs) {
    const parsed = Number.parseInt(String(timeoutMs), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return { signal: undefined, cleanup: null, timed: false };
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

    return { signal: undefined, cleanup: null, timed: false };
}

async function fetchWithTimeout(url, options = {}) {
    const fetchImpl =
        (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function")
            ? globalThis.fetch
            : (typeof fetch !== "undefined" ? fetch : undefined);

    // If global fetch doesn't exist, we can't do much in a browser/RN env
    if (typeof fetchImpl === "undefined") {
        throw new Error("No fetch implementation found!");
    }

    const { timeout, dispatcher, ...fetchOptions } = options || {};
    const requestTimeout = timeout || FETCH_TIMEOUT;
    const parsedTimeout = Number.parseInt(String(requestTimeout), 10);
    const hasDeadline = Number.isFinite(parsedTimeout) && parsedTimeout > 0;
    const timeoutConfig = createTimeoutSignal(requestTimeout);
    const externalSignal = fetchOptions.signal || null;
    const requestOptions = { ...fetchOptions };

    if (timeoutConfig.signal) {
        if (
            requestOptions.signal &&
            typeof AbortSignal !== "undefined" &&
            typeof AbortSignal.any === "function"
        ) {
            try {
                requestOptions.signal = AbortSignal.any([requestOptions.signal, timeoutConfig.signal]);
            } catch {
                // Keep the caller's signal; the Promise.race below still enforces the deadline.
            }
        } else if (!requestOptions.signal) {
            requestOptions.signal = timeoutConfig.signal;
        }
        // When an external signal exists but AbortSignal.any is unavailable, keep the
        // external signal untouched (preserves external abort) and rely on Promise.race
        // below to enforce the timeout even if fetch ignores the signal.
    }

    // undici `dispatcher` (e.g. ProxyAgent) is only meaningful on the Node server.
    // Omit it in the Nuvio runtime and never forward a falsy value, so Nuvio fetch
    // implementations that reject unknown options keep working.
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
        const response = timeoutPromise
            ? await Promise.race([fetchPromise, timeoutPromise])
            : await fetchPromise;
        return response;
    } catch (error) {
        if (timeoutFired) {
            throw buildTimeoutError();
        }
        if (error && error.name === "AbortError") {
            // Preserve an external abort: if the caller already aborted, surface the
            // original AbortError instead of converting it into a timeout.
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
}

module.exports = { fetchWithTimeout, createTimeoutSignal, isNuvioRuntime, FETCH_TIMEOUT };
