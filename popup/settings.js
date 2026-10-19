import { backends } from "../src/backends/index.js";

// MARK: Settings
// Backend options (e.g. default models) are declared by the backends themselves, so the
// Settings page and stored defaults grow automatically when a backend is added.

export const OPTIONS = backends.flatMap((b) => b.options ?? []);
const DEFAULTS = {
  selected: backends.map((b) => b.id),
  projectPath: "",
  ...Object.fromEntries(OPTIONS.map((o) => [o.key, o.default])),
};

export async function loadSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

export const save = (patch) => chrome.storage.local.set(patch);

/** Blank settings fall back to the backend's default instead of exporting an empty model. */
export function optionValues(settings) {
  return Object.fromEntries(OPTIONS.map((o) => [o.key, settings[o.key]?.trim() || o.default]));
}
