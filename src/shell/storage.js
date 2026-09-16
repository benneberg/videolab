/** Thin localStorage wrapper with JSON serialisation and safe fallback. */

const PREFIX = 'videolab:';

export function get(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode — silently ignore.
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

/** Persist a single object key reactively — merges into existing data. */
export function merge(key, patch) {
  const current = get(key, {});
  set(key, { ...current, ...patch });
}
