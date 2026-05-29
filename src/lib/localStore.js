// ── localStore ──────────────────────────────────────────────────────────────
// A tiny LOCAL-FIRST persistence helper for user-generated data (saved Lab
// screens, stock classifications, …). Every value is JSON-serialised under a
// key that is scoped to the user id, so two accounts sharing one browser never
// collide and a logged-out "guest" gets their own bucket.
//
// WHY local-first: some of this data has Supabase tables that may not be
// deployed in a given environment (the migrations are optional / fail-soft).
// Writing to localStorage first means the feature ALWAYS works instantly and
// offline; Supabase is then a best-effort background mirror for cross-device
// sync. localStorage holds a handful of small text rows here — kilobytes, not
// megabytes — so there is no storage concern.
//
// All functions swallow errors (quota exceeded, private-mode, disabled storage)
// and degrade to in-memory-only behaviour rather than throwing.

const PREFIX = 'pinex_v1'

function keyFor(namespace, userId) {
  return `${PREFIX}:${namespace}:${userId || 'guest'}`
}

/** Read a JSON value for (namespace, user). Returns `fallback` if absent/corrupt. */
export function readLocal(namespace, userId, fallback = null) {
  try {
    const raw = localStorage.getItem(keyFor(namespace, userId))
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Write a JSON value for (namespace, user). Returns true on success. */
export function writeLocal(namespace, userId, value) {
  try {
    localStorage.setItem(keyFor(namespace, userId), JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** Remove the stored value for (namespace, user). */
export function clearLocal(namespace, userId) {
  try {
    localStorage.removeItem(keyFor(namespace, userId))
  } catch {
    /* non-fatal */
  }
}
