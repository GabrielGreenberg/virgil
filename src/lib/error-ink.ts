/**
 * The error-TEXT role as an inline-style value (task 867) — the JS twin of the
 * `text-error` utility (`--color-error` in globals.css). Both resolve
 * `--danger-strong`, the rung STYLE_GUIDE reserves for error text because
 * `--danger` paints under AA. Read this, never `var(--danger)`, wherever a
 * `style={{ color }}` paints a string that reports a failure. The element-level
 * reading is `<InlineError>` (src/components/InlineError.tsx).
 */
export const ERROR_INK = "var(--danger-strong)";
