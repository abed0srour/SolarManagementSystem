/**
 * Accent palettes.
 *
 * Each entry maps to a `[data-accent="…"]` block in globals.css that overrides
 * `--primary` and `--ring`. The swatch colours here are only for the selector's
 * preview dots — the app itself always reads the CSS variables, so the two can
 * never drift into a state where a button disagrees with its own swatch.
 */
export const ACCENTS = [
  { id: 'cedar', swatch: ['#1a4f9c', '#2f6fd0'] },
  { id: 'emerald', swatch: ['#166a45', '#22a06b'] },
  { id: 'rose', swatch: ['#b31843', '#e23e6b'] },
  { id: 'violet', swatch: ['#5b32bd', '#8b5cf6'] },
  { id: 'sunset', swatch: ['#c2510c', '#f97316'] },
  { id: 'cyan', swatch: ['#0e7490', '#06b6d4'] },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

export const DEFAULT_ACCENT: AccentId = 'cedar';

export const ACCENT_STORAGE_KEY = 'accent';

export function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((a) => a.id === value);
}

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the document renders with the default accent and then snaps to
 * the stored one once React mounts — the same flash next-themes avoids for
 * light/dark. Kept dependency-free and wrapped in try/catch because it executes
 * before anything else on the page.
 */
export const ACCENT_INIT_SCRIPT = `
(function () {
  try {
    var a = localStorage.getItem('${ACCENT_STORAGE_KEY}');
    var valid = ${JSON.stringify(ACCENTS.map((a) => a.id))};
    if (a && valid.indexOf(a) !== -1) document.documentElement.setAttribute('data-accent', a);
  } catch (e) {}
})();
`;
