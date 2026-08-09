// Simple in-memory TTL cache (single-instance process, mirrors the SQLite session store assumption).

const store = new Map(); // key -> { value, expiresAt }

function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
    }
    return entry.value;
}

function set(key, value, ttlMs) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Deletes a single key, or every key starting with `prefix` when `pattern` ends with '*'.
function del(pattern) {
    if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        for (const key of store.keys()) {
            if (key.startsWith(prefix)) store.delete(key);
        }
    } else {
        store.delete(pattern);
    }
}

// Cache-aside helper: returns the cached value, or calls fetchFn, caches, and returns its result.
async function getOrSet(key, ttlMs, fetchFn) {
    const cached = get(key);
    if (cached !== undefined) return cached;

    const value = await fetchFn();
    set(key, value, ttlMs);
    return value;
}

// Patches an already-cached value in place (e.g. splice one row out of a cached list)
// instead of dropping the whole entry. No-ops if the key isn't cached or has expired -
// the next read just falls through to a normal fetch, which is always correct.
function update(key, updater) {
    const entry = store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
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
    for (const [key, entry] of store) {
        if (!key.startsWith(prefix)) continue;
        if (now > entry.expiresAt) {
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
        if (now > entry.expiresAt) store.delete(key);
    }
}, 5 * 60 * 1000).unref();

module.exports = { get, set, del, getOrSet, update, updatePrefix };
