// Simple in-memory TTL cache (assumes a single app instance).

const store = new Map(); // key -> { value, expiresAt, staleUntil }
const inflight = new Map(); // key -> Promise of the fetch currently filling that key

function isFresh(entry, now = Date.now()) {
    return now <= entry.expiresAt;
}

function isUsable(entry, now = Date.now()) {
    return now <= entry.staleUntil;
}

function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    return isFresh(entry) ? entry.value : undefined;
}

// `staleMs` keeps the value around after it expires so getOrSet can serve it while it
// refreshes in the background (stale-while-revalidate). Defaults to 0: no stale serving.
function writeEntry(key, value, ttlMs, staleMs = 0) {
    const expiresAt = Date.now() + ttlMs;
    store.set(key, { value, expiresAt, staleUntil: expiresAt + staleMs });
}

function set(key, value, ttlMs, staleMs = 0) {
    inflight.delete(key);
    writeEntry(key, value, ttlMs, staleMs);
}

// Any write to a key also orphans an in-flight fetch for it, so a fetch that started
// before the write can't land afterwards and overwrite it with pre-write data.
function forget(key) {
    store.delete(key);
    inflight.delete(key);
}

// Deletes a single key, or every key starting with `prefix` when `pattern` ends with '*'.
function del(pattern) {
    if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        for (const key of new Set([...store.keys(), ...inflight.keys()])) {
            if (key.startsWith(prefix)) forget(key);
        }
    } else {
        forget(pattern);
    }
}

// Runs fetchFn at most once per key at a time: concurrent callers (e.g. several tabs, or
// the dashboard's parallel requests) share one upstream request instead of each crawling Keygen.
function refresh(key, ttlMs, staleMs, fetchFn) {
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
        try {
            const value = await fetchFn();
            // Only store the result if nothing invalidated this key while we were fetching.
            if (inflight.get(key) === promise) writeEntry(key, value, ttlMs, staleMs);
            return value;
        } finally {
            if (inflight.get(key) === promise) inflight.delete(key);
        }
    })();
    inflight.set(key, promise);
    return promise;
}

// Cache-aside helper: returns the cached value, or calls fetchFn, caches, and returns its result.
// With `staleMs`, an expired-but-recent value is returned immediately and refreshed in the
// background, so only the very first load (or one after a long idle) waits on Keygen.
async function getOrSet(key, ttlMs, fetchFn, staleMs = 0) {
    const entry = store.get(key);
    const now = Date.now();
    if (entry && isFresh(entry, now)) return entry.value;

    if (entry && isUsable(entry, now)) {
        refresh(key, ttlMs, staleMs, fetchFn).catch(error => {
            console.error('[Cache] Background refresh failed for %s:', key, error.message);
        });
        return entry.value;
    }

    return refresh(key, ttlMs, staleMs, fetchFn);
}

// Patches an already-cached value in place (e.g. splice one row out of a cached list)
// instead of dropping the whole entry. No-ops if the key isn't cached or has expired -
// the next read just falls through to a normal fetch, which is always correct.
function update(key, updater) {
    inflight.delete(key);
    const entry = store.get(key);
    if (!entry || !isUsable(entry)) {
        store.delete(key);
        return;
    }
    entry.value = updater(entry.value);
}

// Same as update(), applied to every currently-cached key starting with `prefix`.
// Useful when a write affects a cache that's keyed per-user/per-license (e.g. `licenses:user:`)
// and we don't know which specific key(s) are affected.
function updatePrefix(prefix, updater) {
    const now = Date.now();
    for (const key of inflight.keys()) {
        if (key.startsWith(prefix)) inflight.delete(key);
    }
    for (const [key, entry] of store) {
        if (!key.startsWith(prefix)) continue;
        if (!isUsable(entry, now)) {
            store.delete(key);
            continue;
        }
        entry.value = updater(entry.value);
    }
}

// Periodic sweep so expired entries don't linger in memory between accesses.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (!isUsable(entry, now)) store.delete(key);
    }
}, 5 * 60 * 1000).unref();

module.exports = { get, set, del, getOrSet, update, updatePrefix };
