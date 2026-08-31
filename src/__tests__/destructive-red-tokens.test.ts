import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped, cssRuleBodies } from "@/lib/__tests__/_source-scan";
import { hexToRgb, rgbToHsl, contrastRatio } from "@/lib/color-math";
import { KATEX_ERROR_COLOR } from "@/lib/tiptap/math";

/**
 * DESTRUCTIVE / ALARM REDS — one family, one scale, no raw spellings
 * (task 2026-07-20-195).
 *
 * ## What this guards, and why the existing guards could not
 *
 * The sibling colour guards each ask a question this defect answers "clean" to:
 *
 *  - `color-token-consumers.test.ts` is **value-keyed** — it locks the amber and
 *    drag families by naming their literals. Its own header records why it
 *    stops there: a general "raw literal duplicates a token" guard reports ~490
 *    pre-existing sites tree-wide. So a red nobody thought to list is invisible
 *    to it, and `#cc0000` / `#b8261a` were exactly that.
 *  - `phantom-css-var.test.ts` asks whether a `var()` READ resolves. A rule that
 *    spells `#b45757` makes no `var()` claim at all.
 *  - `atom-chrome-tokens.test.ts` asks whether a registered inline ATOM's rest
 *    rule spells a literal. None of these sites is an atom.
 *  - `inert-preference-controls.test.ts` asks whether a defined token has a
 *    reader. These reds had no token to be unread.
 *
 * So this census runs the axis none of them cover: **a red literal in a place
 * where a value is USED rather than DEFINED.** It is deliberately scoped to one
 * HUE FAMILY rather than to all colours, which is what makes an empty allowlist
 * achievable — the general sweep stays the deferred cross-surface effort
 * `color-token-consumers` describes, and this is one family of it, finished.
 *
 * ## The needle is a HUE, not a list
 *
 * Keying on the hexes someone happened to find is the weakness task 194
 * recorded: it cannot see the next one. `#fff5f5` — the sixth rust hex, where
 * the audit's §8 count said five — was found BY the hue predicate during this
 * task, after the finding had enumerated three; so was the library page-mark
 * `#c0392b`, which the predicate then correctly hands to a reader, who excludes
 * it as a different family. So the needle is
 * `saturation ≥ 15% ∧ hue ∈ [340°, 20°]`, computed through `color-math` — the
 * repo's one home for hex↔HSL — and the anti-vacuity legs below pin that it
 * catches the reds and spares the warm neutrals and ambers this palette is
 * mostly made of (a manila/stone/umber palette sits at hue 30-50, so the window
 * has real room either side).
 *
 * ## Three stated limits
 *
 *  1. **A `var(--token, #hex)` fallback is excluded by RULE**, not by
 *     allowlist: it is the repo's documented idiom and there are 255 of them.
 *     A fallback that DISAGREES with its token is a real hazard (this task fixed
 *     five in the danger family, one of which described a colour the token has
 *     never had) and it is governed for the whole tree, as a pinned census, by
 *     `phantom-css-var.test.ts`. What this file adds is the family-scoped ban in
 *     `describe("no danger-family read carries a hex fallback")` below.
 *  2. **Hue is not role.** The predicate cannot tell a destructive affordance
 *     from a red used for something else, so a legitimately non-destructive red
 *     lands on an allowlist with its reason rather than being silently skipped —
 *     the rule task 326 states. Both allowlists may only shrink, by convention:
 *     each is an EXACT set, so growth fails CI and a removal is a deliberate
 *     edit.
 *  3. **A red does not have to be a hex.** The needle reads hexes, so stock
 *     `*-red-N` / `*-rose-N` utilities and decimal `rgb()` are invisible to
 *     legs 1-2. Leg 7 pins both as exact FILE sets so a new one still fails CI,
 *     and the self-checks below pin the three shapes that used to slip through
 *     the hex path itself (a 3-digit `#c00`, a single-line rule, a nested
 *     `:root`). What remains genuinely unseen: `hsl()`, `oklch()`, and a colour
 *     assembled at runtime.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"] as const;
const globals = read("src/app/globals.css");

/* ── The needle ──────────────────────────────────────────────────── */

/** Hue window (degrees, wrapping through 0) and saturation floor. */
const RED_HUE_MAX = 20;
const RED_HUE_MIN = 340;
const RED_SAT_FLOOR = 0.15;

export function isDestructiveRed(hex: string): boolean {
  // Expand `#c00` → `#cc0000` FIRST: color-math's `hexToRgb` accepts only the
  // 6-digit form and returns [0,0,0] otherwise, so every 3-digit red would
  // classify as BLACK and walk straight through the census. `#c00` is exactly
  // the `.math-error` red this task retired, in the spelling that evades it.
  const m = /^#([0-9a-f]{3})$/i.exec(hex.trim());
  const full = m ? `#${m[1].split("").map((c) => c + c).join("")}` : hex;
  const [h, s] = rgbToHsl(...hexToRgb(full));
  return s >= RED_SAT_FLOOR && (h >= RED_HUE_MIN || h <= RED_HUE_MAX);
}

/** `#rgb` and `#rrggbb` only — `#rrggbbaa` is not a colour this palette uses. */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const isPlainHex = (m: string) => m.length === 4 || m.length === 7;

/**
 * Blank `var(--token, …)` fallbacks. See limit 1 in the header: the fallback
 * axis has its own guard, and leaving these in would bury this family's real
 * sites under 255 pre-existing ones.
 */
const withoutVarFallbacks = (src: string) =>
  src.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, (m) => " ".repeat(m.length));

type Hit = { file: string; line: number; hex: string; text: string };

function redHits(file: string, source: string): Hit[] {
  const out: Hit[] = [];
  withoutVarFallbacks(source)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(HEX)) {
        if (isPlainHex(m[0]) && isDestructiveRed(m[0])) {
          out.push({ file, line: i + 1, hex: m[0].toLowerCase(), text: line.trim().slice(0, 100) });
        }
      }
    });
  return out;
}

const fmt = (h: Hit) => `${h.file}:${h.line} ${h.hex} — ${h.text}`;

/* ── Leg 1: the stylesheets ──────────────────────────────────────── */

/**
 * Raw destructive-family reds still spelled in a CSS RULE BODY.
 *
 * `globals.css` is EMPTY and must stay so — every one of its fifteen former
 * sites reads a token now. The two survivors are a different family that this
 * task deliberately did not repaint.
 */
const PERMITTED_RAW_CSS_REDS: Readonly<Record<string, string>> = {
  "library/styles/library.css:#c0392b":
    "the library reader's page-mark RULE + tag (.pgmark-rule / .pgmark-rule-tag). " +
    "Not a destructive affordance — it is reader chrome, and its sibling .pgmark-chip " +
    "reads --pgmark-color (#856a1c, a gold), so the red is deliberate and belongs to " +
    "no existing token. Minting one is a visual decision about the reader's palette, " +
    "not this family's cleanup.",
};

describe("stylesheets spell no raw destructive red in a rule body", () => {
  const hits = STYLESHEETS.flatMap((rel) =>
    // Comments stripped: this task's own migration notes NAME the hexes they
    // retired, and a census that counted those would be unfalsifiable.
    redHits(rel, cssRuleBodies(cssCommentsStripped(read(rel)))),
  );

  it("every hit is a recorded, reasoned exception", () => {
    const keys = [...new Set(hits.map((h) => `${h.file}:${h.hex}`))].sort();
    expect(keys, `unrecorded raw destructive red:\n${hits.map(fmt).join("\n")}`).toEqual(
      Object.keys(PERMITTED_RAW_CSS_REDS).sort(),
    );
  });

  it("globals.css has none at all", () => {
    const inGlobals = hits.filter((h) => h.file === "src/app/globals.css");
    expect(inGlobals.map(fmt)).toEqual([]);
  });

  // A FLOOR against an empty or one-word excuse, not a test of the reasoning —
  // only a reader settles whether a sentence is true. Stated so the next person
  // does not mistake a green run for the justification having been checked.
  it("no exception is excused wordlessly", () => {
    for (const [key, why] of Object.entries(PERMITTED_RAW_CSS_REDS)) {
      expect(why.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

/* ── Leg 2: the TS/TSX silos ─────────────────────────────────────── */

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".next-preview", ".next-preview-dev", ".next-preview-audit",
  ".git", ".claude", "virgil-data", "library-data", "samples", "dist", "build", "out",
  "__tests__",
]);

function walkSource(rel: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(path.join(ROOT, rel));
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = path.join(rel, name);
    if (statSync(path.join(ROOT, childRel)).isDirectory()) walkSource(childRel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(childRel);
  }
  return out;
}

/**
 * Keyed `file:#hex` — finer than per FILE, which is the lesson task 189 paid
 * for. `AIWindow.tsx` is why: it holds an allowlisted status palette AND the
 * destructive hover this task migrated, so a file-level entry would have
 * exempted the very site under repair. It is deliberately NOT per LINE: a line
 * number churns on every edit above it, and the pair (file, colour) is what
 * actually identifies the decision being excused.
 */
const PERMITTED_RAW_TS_REDS: Readonly<Record<string, string>> = {
  "src/lib/panel-theme.ts:#b45757":
    "the 'Rust' swatch of the panel-colour PICKER. Palette DATA — the value IS the " +
    "thing the user chooses, not a spelling of a role.",
  "src/components/ActionsMenuPanel.tsx:#dc2626":
    "a swatch in the actions-menu colour palette. Palette DATA, same as above.",
  "src/components/SelectionColorPopover.tsx:#ff0000":
    "two stops of the hue-wheel conic gradient (#ff0000 opens and closes the ring). " +
    "Palette DATA — the spectrum itself, which no token could express.",
  "src/components/AIWindow.tsx:#9a3412":
    "the 'open' status chip's foreground, one of a dot/bg/fg triple beside amber " +
    "siblings. A STATUS palette, not a destructive one; folding those onto the " +
    "--status-* family is its own decision, and pre-existing.",
};

describe("src/ and library/ spell no raw destructive red outside the recorded sites", () => {
  const hits = [...walkSource("src"), ...walkSource("library")].flatMap((rel) =>
    // Comments stripped, STRING LITERALS KEPT: a raw red lives in an arbitrary
    // Tailwind value or a style string, i.e. inside quotes.
    redHits(rel, commentsStripped(read(rel))),
  );

  it("every hit is a recorded, reasoned exception", () => {
    const keys = [...new Set(hits.map((h) => `${h.file}:${h.hex}`))].sort();
    expect(keys, `unrecorded raw destructive red:\n${hits.map(fmt).join("\n")}`).toEqual(
      Object.keys(PERMITTED_RAW_TS_REDS).sort(),
    );
  });

  it("no exception is excused wordlessly", () => {
    for (const [key, why] of Object.entries(PERMITTED_RAW_TS_REDS)) {
      expect(why.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

/* ── Leg 3: the family is DERIVED, not re-spelled ────────────────── */

const decl = (token: string) =>
  new RegExp(`${token}:\\s*([^;]+);`).exec(cssCommentsStripped(globals))?.[1]?.trim() ?? "";

describe("the destructive role family", () => {
  it("aliases into the rust scale where the value coincides", () => {
    // The point of the family is to CODIFY the relationship §8 calls implicit.
    // A re-spelled `#fef2f2` / `#b45757` would satisfy a value check and leave
    // the two scales free to drift apart, which is the whole defect.
    expect(decl("--danger-soft")).toBe("var(--footnote-50)");
    expect(decl("--danger-muted")).toBe("var(--footnote-500)");
  });

  it("keeps the rust scale rungs those aliases depend on", () => {
    expect(decl("--footnote-50")).toBe("#fef2f2");
    expect(decl("--footnote-500")).toBe("#b45757");
  });

  it("pins --danger-strong to the warm hand-picked dark, not a pure primary", () => {
    expect(decl("--danger-strong")).toBe("#b8261a");
  });

  it("emits a Tailwind alias for every rung spelled as a utility class", () => {
    // The silent half of the boundary STYLE_GUIDE describes: a token minted in
    // `:root` gets no utility for free, so `text-danger-muted` without a
    // `--color-danger-muted` row emits NO CLASS AT ALL — no error, no style,
    // nothing to grep. This leg exists because an edit to the COMMENT beside
    // that row deleted it during this very task, with every other leg green.
    const theme = cssCommentsStripped(globals);
    for (const rung of ["danger", "danger-soft", "danger-muted", "danger-strong"]) {
      const usedAsUtility = [...walkSource("src"), ...walkSource("library")].some((rel) =>
        new RegExp(
          `\\b(?:hover:|focus:|active:|group-hover:|disabled:)?(?:text|bg|border|ring|fill|stroke)-${rung}\\b`,
        ).test(commentsStripped(read(rel))),
      );
      const aliased = new RegExp(`--color-${rung}:\\s*var\\(--${rung}\\)`).test(theme);
      expect(aliased, `${rung} is spelled as a utility class but has no --color-${rung} alias`).toBe(
        usedAsUtility,
      );
    }
  });

  it("keeps error ink above AA on the surface it actually paints on", () => {
    // The merge of #cc0000 into #b8261a was justified partly on contrast, and
    // the rejected alternative (adopting --danger for error TEXT) fails here.
    // --code-bg is the panel .figure-error / .math-error sit on.
    const codeBg = decl("--code-bg");
    expect(contrastRatio("#b8261a", codeBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ef4444", codeBg)).toBeLessThan(4.5);
  });
});

/* ── Leg 4: the migrated surfaces read the family ────────────────── */

/**
 * The value-keyed half, in the spirit of `color-token-consumers.test.ts`: the
 * census above proves no raw red REMAINS, and these prove the right token
 * ARRIVED. Without them a future edit could satisfy the census by deleting the
 * declaration outright.
 */
describe("the block surfaces read the destructive family", () => {
  // The WHOLE sheet, not the rule-bodies view: that view blanks the line a rule
  // OPENS on (it exists to isolate declaration text from selectors), so the
  // selector these legs match on is precisely what it removes.
  const sheet = cssCommentsStripped(globals);

  it.each([
    // The heading label lozenge — the twin the finding did not mention, whose
    // four sites are byte-identical to the figure ones it did.
    ".heading-annotation-delete:hover",
    ".heading-label-input.has-conflict",
    ".heading-label-warning",
    // The figure label lozenge.
    ".figure-block .figure-label-input.has-conflict",
    ".figure-block .figure-label-warning",
    ".figure-block .figure-annotation-delete:hover",
  ])("%s paints --danger-muted", (selector) => {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const body = rule.exec(sheet)?.[1] ?? "";
    expect(body, `${selector} not found`).not.toBe("");
    expect(body).toContain("var(--danger-muted)");
  });

  it.each([
    ".figure-block .figure-error",
    ".math-error",
    ".figure-block .figure-chrome-btn-danger:hover",
  ])("%s paints --danger-strong", (selector) => {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const body = rule.exec(sheet)?.[1] ?? "";
    expect(body, `${selector} not found`).not.toBe("");
    expect(body).toContain("var(--danger-strong)");
  });
});

/* ── Leg 5: the two layers that must agree on error ink ──────────── */

/**
 * KaTeX writes `errorColor` onto the error span's INLINE style, which beats any
 * stylesheet rule — so `.katex-error { color: … }` could not own this and the
 * value has to arrive from JS. That makes it a colour two layers must agree on
 * byte-for-byte, the shape `latex-markers.ts` earned its "spelled ONCE" rule
 * for. Both KaTeX call sites read the ONE constant, and the constant resolves
 * the same token the CSS fallback rule does.
 */
describe("KaTeX error ink is spelled once", () => {
  it("the constant is a token read, not a hex", () => {
    expect(KATEX_ERROR_COLOR).toBe("var(--danger-strong)");
  });

  it("agrees with the .math-error rule it can override", () => {
    const body = /\.math-error\s*\{([^}]*)\}/.exec(cssCommentsStripped(globals))?.[1] ?? "";
    expect(body).toContain(KATEX_ERROR_COLOR);
  });

  it.each(["src/lib/tiptap/math.ts", "src/components/NodeEditPopover.tsx"])(
    "%s passes the constant rather than its own copy",
    (rel) => {
      const src = commentsStripped(read(rel));
      expect(src).toMatch(/errorColor:\s*KATEX_ERROR_COLOR/);
      expect(src).not.toMatch(/errorColor:\s*["'#]/);
    },
  );
});

/* ── Leg 6: no danger-family read carries a hex fallback ─────────── */

/**
 * The family-scoped half of limit 1. A `var(--danger…, #hex)` is decoration
 * that a retone will never reach, and every one this task found described a
 * DIFFERENT red from the token: `var(--danger, #b45757)` in the menu registry
 * (the token is #ef4444), plus `#b91c1c` ×3 and `#b3261e` ×1. Nothing failed —
 * the token resolves, so the fallback simply never rendered — which is exactly
 * why the disagreement could sit there.
 *
 * Empty allowlist: `--danger*` is defined unconditionally in `globals.css`, so
 * there is no true statement of the form "this read might not resolve".
 */
describe("no danger-family read carries a hex fallback", () => {
  it("finds none in either silo", () => {
    const files = [...walkSource("src"), ...walkSource("library"), ...STYLESHEETS];
    const bad: string[] = [];
    for (const rel of files) {
      const src = /\.css$/.test(rel) ? cssCommentsStripped(read(rel)) : commentsStripped(read(rel));
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--danger[\w-]*)\s*,([^)]*)\)/g)) {
          bad.push(`${rel}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});

/* ── Leg 7: the two spellings the hex needle cannot see ──────────── */

/**
 * A red does not have to be a hex. `src/STYLE_GUIDE.md` names both escapes in
 * its own token section — "that ban covers the value, not the spelling"
 * (`rgba(59, 130, 246, …)` is `#3b82f6` in decimal) and the stock-Tailwind trap
 * (`bg-amber-50` is a real utility, so it satisfies "no hex literal" while
 * bypassing the token and painting the WRONG warm). Everything above is
 * hex-keyed and is therefore structurally blind to both.
 *
 * These two sets are the honest residual, PINNED rather than mentioned — the
 * rule task 326 states. They are deliberately NOT repaired here:
 *
 *  - The stock-red sites are the suggestion-card "Original" dialect and its
 *    relatives (`bg-danger-soft` + `border-red-200` + `text-red-700` is a
 *    DESIGNED look). Repainting them needs two rungs this family does not have
 *    — a light border and a dark body ink — and a visual decision per card
 *    surface, which is a product call, not a sweep. (The library status chips
 *    used to sit here too; task 500 retired them onto the shared status-pill
 *    tone family instead — see the note in the list below.)
 *  - The decimal site is one file's CodeMirror theme object, whose accent is
 *    equally decimal (`rgba(124, 94, 60, …)` IS `--accent`). Tokenizing the
 *    code-view theme is that file's own unit of work. (The Outline position
 *    wash sat here too until task 2026-08-02-284 retired it — it was
 *    `--footnote-500` at 13% marking where the CARET is, and it now reads an
 *    `--accent` tint, so the whole borrow is gone rather than re-spelled.)
 *
 * Pinning them means a NEW one fails CI even though this file cannot see its
 * hex, and both sets can only SHRINK.
 */
const PINNED_STOCK_RED_SITES: readonly string[] = [
  // `rose` is in the needle, not just `red`: Tailwind's rose ramp lands at hue
  // ~350 — inside the hue window the hex leg uses — so a rose utility IS this
  // family wearing another palette's name.
  //
  // The two library status-chip sites that sat here — `library-entry-status`
  // and `provenance-chips` — are GONE since task 500, and the way they went is
  // the interesting part. They were not repainted onto this family: the
  // bib-auth axis they were colouring had THREE hand-written tables across two
  // silos, so the fix was one tone resolution
  // (`src/lib/library/status-tone.ts`) that both silos read, painting from the
  // `--pill-<tone>-{bg,fg,edge}` triple. `failed` reaches this family's ROLE
  // through `--pill-red-*` rather than through a `rose` utility, and the dead
  // third table went with it. This list may only SHRINK; that is what shrinking
  // looks like.
  "src/components/DocPermissionGate.tsx",
  "src/components/PreferencesModal.tsx",
  // NOT field-primitives.tsx: its only `border-red-300` is inside the doc
  // comment explaining why the primitive refuses one (task 190). The comment
  // strip is what tells those apart — a raw grep reports it as a live site.
  "src/panels/Cutter/CutterSuggestionCard.tsx",
  "src/panels/Revisions/RevisionSuggestionCard.tsx",
  "src/panels/_shared/suggestion-fields.tsx",
];

const PINNED_DECIMAL_RED_SITES: readonly string[] = [
  "src/components/CodeEditor.tsx", // .cm-virgil-band, rgba(220, 38, 38, 0.09)
];

describe("the residual red spellings are a pinned census", () => {
  const files = [...walkSource("src"), ...walkSource("library")];

  it("stock Tailwind red utilities appear in exactly the recorded files", () => {
    const found = files
      .filter((rel) =>
        /\b(?:hover:|focus:|active:|placeholder:|group-hover:|disabled:)?(?:text|bg|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret)-(?:red|rose)-\d{2,3}\b/.test(
          commentsStripped(read(rel)),
        ),
      )
      .sort();
    expect(found).toEqual([...PINNED_STOCK_RED_SITES].sort());
  });

  it("decimal-spelled reds appear in exactly the recorded files", () => {
    // Both silos AND both stylesheets: a decimal red is as reachable from CSS
    // as from a theme object, and scanning only *.tsx would have left the
    // sheets — the surface this whole task is about — outside this leg.
    const found = [...files, ...STYLESHEETS]
      .filter((rel) => {
        const src = /\.css$/.test(rel) ? cssCommentsStripped(read(rel)) : commentsStripped(read(rel));
        // Legacy comma form AND the modern space form (`rgb(220 38 38 / 9%)`),
        // which is what a new site is most likely to be written in.
        for (const m of src.matchAll(
          /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g,
        )) {
          const [r, g, b] = [+m[1], +m[2], +m[3]];
          // Same shape as the hue needle, expressed on raw channels: red
          // dominant by a wide margin over BOTH others.
          if (r > 120 && r - g > 40 && r - b > 40) return true;
        }
        return false;
      })
      .sort();
    expect(found).toEqual([...PINNED_DECIMAL_RED_SITES].sort());
  });
});

/* ── Self-checks: the census can SEE, and does not over-see ──────── */

describe("the hue needle is neither blind nor indiscriminate", () => {
  it.each(["#b45757", "#c45a5a", "#cc0000", "#b8261a", "#ef4444", "#fecaca", "#fff5f5", "#c0392b", "#b00020"])(
    "flags %s",
    (hex) => expect(isDestructiveRed(hex)).toBe(true),
  );

  it.each([
    "#d9d3c8", // --border, a warm neutral at hue ~39
    "#f0eeeb", // --code-bg
    "#7c5e3c", // --accent, umber
    "#fef3c3", // amber highlight wash
    "#fbbf24", // --mark-bg
    "#d97706", // the AIWindow status dot
    "#856a1c", // --pgmark-color
    "#ffffff",
    "#1a1a1a",
    "#555555",
    "#9ca3af",
  ])("spares %s", (hex) => expect(isDestructiveRed(hex)).toBe(false));

  it("would catch a red planted in a rule body", () => {
    const planted = ".some-new-rule {\n  color: #d11b2a;\n}\n";
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(planted)))).toHaveLength(1);
  });

  it("does not count a red that is merely NAMED in a comment", () => {
    const commented = ".r {\n  /* was #cc0000 before the token */\n  color: var(--danger-strong);\n}\n";
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(commented)))).toHaveLength(0);
  });

  it("does not count a red that is a var() fallback", () => {
    const fallback = ".r {\n  color: var(--footnote-color, #b45757);\n}\n";
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(fallback)))).toHaveLength(0);
  });

  it("does not count a red in a :root definition", () => {
    const def = ":root {\n  --footnote-500: #b45757;\n}\n";
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(def)))).toHaveLength(0);
  });

  it("flags a 3-digit shorthand red", () => {
    // color-math's hexToRgb takes only the 6-digit form and returns black
    // otherwise, so an unexpanded `#c00` — the retired .math-error red exactly
    // — would classify as a neutral and walk through every leg above.
    expect(isDestructiveRed("#c00")).toBe(true);
    expect(isDestructiveRed("#f00")).toBe(true);
    expect(isDestructiveRed("#fff")).toBe(false);
  });

  it("sees a red in a SINGLE-LINE rule", () => {
    // A line filter must drop the whole opening line (depth is still 0 when it
    // is read), which hides every single-line rule's declarations. globals.css
    // has a 20-rule block of them.
    const oneLiner = '.linked-anchor[data-x="y"] { color: #cc0000; }\n';
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(oneLiner)))).toHaveLength(1);
  });

  it("treats a NESTED :root as a definition and a nested rule as a rule", () => {
    const nested =
      "@media print {\n  :root { --x: #b45757; }\n  .r { color: #cc0000; }\n}\n";
    const hits = redHits("x.css", cssRuleBodies(cssCommentsStripped(nested)));
    expect(hits.map((h) => h.hex)).toEqual(["#cc0000"]);
  });

  it("DOES count a red under a :root ANCESTOR combinator", () => {
    // The hole the private copy of this walker carried: `:root` is also a
    // legitimate ancestor selector, and `globals.css` uses it that way for the
    // three WCO rules. A substring test exempts those bodies from every census
    // built on the walker — silently, since an exemption looks like a pass.
    const wco = ':root[data-display-mode="window-controls-overlay"] .virgil-bar {\n  color: #cc0000;\n}\n';
    expect(redHits("x.css", cssRuleBodies(cssCommentsStripped(wco)))).toHaveLength(1);
  });

  it("the strippers did not swallow the stylesheet", () => {
    // A runaway stripper makes every leg above pass vacuously (task 202b).
    const stripped = cssCommentsStripped(globals);
    expect(stripped.length).toBeGreaterThan(globals.length * 0.7);
    // Balance, not equality with the raw sheet: `globals.css` comments contain
    // braces of their own (prose about rules), so the stripped source
    // legitimately holds FEWER. What a runaway would destroy is the balance.
    expect((stripped.match(/\{/g) ?? []).length).toBe((stripped.match(/\}/g) ?? []).length);
    expect((stripped.match(/\{/g) ?? []).length).toBeGreaterThan(400);
    // And the rule-body view must still hold most of the sheet.
    expect(cssRuleBodies(stripped).replace(/\s/g, "").length).toBeGreaterThan(10_000);
  });
});
