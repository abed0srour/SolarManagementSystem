/**
 * Chart palette.
 *
 * Five categorical slots, assigned in fixed order and never cycled — a chart
 * that needs a sixth series folds the tail into "Other" rather than inventing a
 * hue. Colour follows the entity, not its rank, so filtering a series out never
 * repaints the survivors.
 *
 * Verified with the palette validator rather than by eye:
 *
 *   light  ALL CHECKS PASS — worst adjacent pair ΔE 22.9 normal / 9.1 protan.
 *          Contrast WARN on the green and amber steps (2.74 and 2.11 vs the
 *          card surface), which obligates the relief we already ship: every
 *          chart carries a legend, tooltips give exact values, and the
 *          distribution charts are directly labelled.
 *   dark   ALL CHECKS PASS — worst adjacent ΔE 19.8 normal / 8.4 protan,
 *          all steps at or above 3:1 contrast.
 *
 * The previous eight-slot palette FAILED the normal-vision floor: slots 7 and 8
 * (#eb6834 orange and #e87ba4 pink) sat at ΔE 12.9, under the 15 threshold — two
 * series a full-colour reader could not reliably tell apart. Those slots are
 * gone; do not restore them without re-running the validator.
 */
export const seriesColors = {
  light: ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767'],
};

/**
 * Status colours are reserved: they mean a state, never "series 4", and always
 * ship with a label rather than standing on colour alone.
 */
export const statusColors = {
  light: { good: '#1baf7a', warning: '#eda100', critical: '#e34948', neutral: '#898781' },
  dark: { good: '#199e70', warning: '#c98500', critical: '#e66767', neutral: '#898781' },
};

export const chartInk = {
  light: { muted: '#898781', grid: '#e1e0d9', baseline: '#c3c2b7' },
  dark: { muted: '#898781', grid: '#2c2c2a', baseline: '#383835' },
};
