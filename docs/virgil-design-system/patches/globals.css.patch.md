# patches/globals.css.patch.md

> **Historical — this patch was never applied as written, and its
> values are NOT the current spec.** It is kept as the record of what
> the 2026 systematization pass proposed. Read `src/app/globals.css`
> for live token values and `src/STYLE_GUIDE.md` for the live spec.
> Known divergences: `--header-h` is **26px** in code (this patch says
> 34px), and `--pod-shadow-light` was never added at all — a snippet
> reading `var(--pod-shadow-light)` resolves to nothing. <!-- token-doc-allow -->

Drop-in replacement for the `:root { … }` block in
`src/app/globals.css`. Apply as part of **Pass 1**.

This patch:

- Adds the `--amber-*` warm-amber scale (citation, bib, quote consolidate
  here).
- Adds the `--footnote-*` rust scale (footnote, cut, error consolidate
  here).
- Aliases existing tokens (`--footnote-bg`, `--footnote-color`, etc.)
  into the new scales so callers don't break.
- Adds `hover-on-light`, `hover-on-dark` utility classes.
- Adds `iconbtn-sm`, `iconbtn-md`, `iconbtn-lg` utility classes.

The rest of `globals.css` (TipTap styles, marginalia styles, paragraph
annotations, etc.) is unchanged. Don't touch it in this pass.

---

## Replace the `:root` block with this

```css
:root {
  /* Canvas & Layout */
  --background: #f8f3ed;
  --foreground: #1a1a1a;
  --surface: #ffffff;
  --border: #e5e2dd;
  --border-light: #c9c5c5;
  --muted: #8a8580;
  --muted-light: #b5b0aa;
  --accent: #7c5e3c;
  --accent-light: #f5f0ea;

  /* App Chrome — locked aliases */
  --topbar-bg: #dcdbd7;
  --topbar-bg-bottom: var(--topbar-bg);
  --topbar-border: #cbc3b8;
  --theme-color: var(--topbar-bg);
  --tab-bg: #dcdbd7;
  --main-tab-bg: var(--background);
  --library-bg: #eae7e2;
  --virgil-bar-text: #78716c;

  /* Pod system — locked aliases */
  --pod-editor: var(--surface);
  --pod-panel: #f3f0eb;
  --pod-toolbar: #f5f3ef;
  --pod-dark: #eae6df;
  --header-bg: #e8e5de;
  --panel-admin-text-color: #44403c;
  --panel-admin-text-font: "Inter";
  --header-h: 34px;
  --pod-radius: 8px;
  --pod-gap: 10px;
  --pod-border: 1px solid var(--border-light);
  --pod-shadow: 0 1px 6px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.06);
  --pod-shadow-light: 0 1px 5px rgba(0,0,0,0.09), 0 0 2px rgba(0,0,0,0.05);
  --card-shadow-ambient: 0 2px 6px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-ambient-filter:
    drop-shadow(0 2px 6px rgba(0,0,0,0.10))
    drop-shadow(0 1px 2px rgba(0,0,0,0.06));

  /* Page sizing */
  --page-preferred: 880px;
  --page-min: 640px;
  --page-max: 1400px;
  --panel-min: 160px;
  --zen-margin-min: 20px;

  /* Editor — locked aliases */
  --editor-font-size: 1.05rem;
  --editor-line-height: 1.6;
  --editor-text-color: #000000;
  --h1-color: var(--foreground);
  --h2h3-color: var(--editor-text-color);
  --par-title-size: 0.78rem;
  --par-title-color: #c45a5a;
  --heading-annotation-color: #6b9ac4;
  --heading-annotation-border: #a8c4de;
  --blockquote-border: #d4cfc8;
  --blockquote-text: #6b6560;
  --code-bg: #f0eeeb;
  --code-block-bg: #f5f3f0;
  --math-color: #6b4fa0;
  --math-prefix-color: #a090c0;

  /* ── Warm amber scale (citation, bib, quote) ────────── */
  --amber-50:  #fef9e7;
  --amber-100: #fdf3c8;
  --amber-200: #f5e29e;
  --amber-500: #d4a843;

  /* ── Footnote rust scale (footnote, cut, error) ─────── */
  --footnote-50:  #fef2f2;
  --footnote-100: #fde8e8;
  --footnote-200: #fecaca;
  --footnote-300: #fca5a5;
  --footnote-500: #b45757;

  /* Inline elements — alias into scales */
  --comment-color: #93c5fd;
  --comment-bg: rgba(147, 197, 253, 0.25);
  --comment-border: rgba(96, 165, 250, 0.5);

  --latex-comment-color: #7191b0;
  --latex-comment-bg: #f0f5fa;

  --citation-color: #6b6245;
  --citation-bg: var(--amber-50);
  --citation-border-color: #e0d5a8;

  --footnote-color: var(--footnote-500);
  --footnote-bg: var(--footnote-50);

  --note-color: #15803d;
  --note-bg: #f0fdf4;
  --note-marker-border: #86efac;


  /* Suggestions */
  --mark-bg: #fbbf24;
  --mark-border: #c8960e;

  /* LaTeX commands */
  --latex-cmd-color: #9ca3af;

  /* Drag */
  --drag-highlight: #3b82f6;

  /* Scrollbar — locked alias */
  --scrollbar-thumb: #d4cfc8;
  --scrollbar-hover: var(--muted-light);

  /* Panel sizing */
  --panel-font-size: 13px;
  --panel-header-size: 14px;

  /* ── Semantic UI color scale ───────────────────────────────────── */

  /* Surfaces & overlays */
  --surface-muted: #fafaf9;
  --surface-muted-strong: #f5f5f4;
  --overlay-scrim: rgba(0, 0, 0, 0.3);

  /* Borders */
  --edge-subtle: #e7e5e4;
  --edge-hover: #d6d3d1;
  --edge-strong: #a8a29e;

  /* Text scale */
  --ink-faint: #d6d3d1;
  --ink-muted: #a8a29e;
  --ink-subtle: #78716c;
  --ink-body: #44403c;
  --ink-strong: #292524;

  /* Destructive */
  --danger: #ef4444;
  --danger-soft: #fef2f2;

  /* Interaction */
  --ring-drag-target: #fcd34d;

  /* Preference mode */
  --pref-mode-accent: var(--drag-highlight);
}
```

## Add immediately below the `@theme inline { … }` block

```css
/* ── Hover utilities ──────────────────────────────────────────────
   Two variants. Choose by resting bg.
   - .hover-on-light: resting bg is white / surface / surface-muted.
   - .hover-on-dark:  resting bg is pod-panel / header-bg / topbar-bg.
   Both transition 120ms ease-out and only affect background-color. */
.hover-on-light {
  transition: background-color 120ms ease-out;
}
.hover-on-light:hover {
  background-color: var(--surface-muted-strong);
}

.hover-on-dark {
  transition: background-color 120ms ease-out;
}
.hover-on-dark:hover {
  background-color: rgba(0, 0, 0, 0.04);
}

/* ── Icon-button utilities ────────────────────────────────────────
   Three locked sizes. Use for any icon-only button.
   The visual SVG inside is smaller than the button: pass width/height
   14 (sm), 16 (md), 20 (lg) on the SVG. */
.iconbtn-sm,
.iconbtn-md,
.iconbtn-lg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--ink-muted);
  background: transparent;
  transition: background-color 120ms ease-out, color 120ms ease-out;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.iconbtn-sm:hover,
.iconbtn-md:hover,
.iconbtn-lg:hover {
  background-color: var(--surface-muted-strong);
  color: var(--ink-body);
}
.iconbtn-sm:active,
.iconbtn-md:active,
.iconbtn-lg:active {
  transform: translateY(0.5px);
}
.iconbtn-sm:focus-visible,
.iconbtn-md:focus-visible,
.iconbtn-lg:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--edge-strong);
}
.iconbtn-sm[disabled],
.iconbtn-md[disabled],
.iconbtn-lg[disabled],
.iconbtn-sm[aria-disabled="true"],
.iconbtn-md[aria-disabled="true"],
.iconbtn-lg[aria-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
  cursor: not-allowed;
}

.iconbtn-sm { width: 20px; height: 20px; padding: 3px; }
.iconbtn-md { width: 24px; height: 24px; padding: 4px; }
.iconbtn-lg { width: 32px; height: 32px; padding: 6px; }

/* Toggle/active state — when an icon button represents an "on" state. */
.iconbtn-sm[aria-pressed="true"],
.iconbtn-md[aria-pressed="true"],
.iconbtn-lg[aria-pressed="true"] {
  background-color: var(--pod-dark);
  color: var(--ink-strong);
}

/* Danger variant — used for the card-trash button. */
.iconbtn-sm.iconbtn-danger,
.iconbtn-md.iconbtn-danger {
  color: var(--danger);
}
.iconbtn-sm.iconbtn-danger:hover,
.iconbtn-md.iconbtn-danger:hover {
  background-color: var(--danger-soft);
  color: var(--danger);
}
```

## Find-and-replace in the editor selection rules

In the same file, find:

```css
.footnote-marker[data-card-selected="true"],
[data-type="citation"][data-card-selected="true"] {
  box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.9);
  border-radius: 3px;
}
```

Replace with:

```css
.footnote-marker[data-card-selected="true"],
[data-type="citation"][data-card-selected="true"] {
  box-shadow: 0 0 0 2px var(--ring-drag-target);
  border-radius: 3px;
}
```

And find:

```css
[data-card-selected="paragraph"] {
  background: rgba(251, 191, 36, 0.07);
  box-shadow: inset 3px 0 0 0 rgba(251, 191, 36, 0.85);
  border-radius: 2px;
}
```

Replace with:

```css
[data-card-selected="paragraph"] {
  background: color-mix(in oklab, var(--ring-drag-target) 10%, transparent);
  box-shadow: inset 3px 0 0 0 color-mix(in oklab, var(--ring-drag-target) 85%, transparent);
  border-radius: 2px;
}
```

## Verify

- `pnpm typecheck` clean.
- `pnpm build` clean.
- App runs. No visual change yet (the new classes are unused).
- Open dev tools, confirm `.iconbtn-md` rules are present and unused.
