/**
 * The motion-duration ladder, for JS that must agree with a CSS rung
 * (task 1413).
 *
 * The SSOT is the `--motion-*` block in `src/app/globals.css`; CSS, inline
 * style strings and Tailwind read it as `var(--motion-…)`. A rAF animation,
 * a WAAPI `duration` or a timeout that ends a CSS fade cannot read a custom
 * property cheaply, so it reads this table instead — and
 * `motion-token-census.test.ts` pins every entry to its CSS twin, so the two
 * cannot drift.
 */
export const MOTION_MS = {
  instant: 80,
  quick: 100,
  fast: 120,
  base: 150,
  slide: 180,
  slow: 200,
  fade: 250,
  settle: 300,
} as const;

export type MotionRung = keyof typeof MOTION_MS;
