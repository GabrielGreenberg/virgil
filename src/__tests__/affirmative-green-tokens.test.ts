import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped, cssRuleBodies } from "@/lib/__tests__/_source-scan";
import { hexToRgb, rgbToHsl, contrastRatio } from "@/lib/color-math";

/**
 * AFFIRMATIVE / ATTAINED GREENS — one family, one scale, no raw spellings
 * (task 2026-08-31-501).
 *
 * The twin of `destructive-red-tokens.test.ts`, and it exists for the reason
 * that suite's own §8 fix sentence names: the destructive family grew four
 * rungs and a hue-keyed census, and its affirmative counterpart never did. The
 * clearest evidence was a single control pair — the Keep / Dismiss buttons on a
 * pending AI change — whose destructive half read `hover:bg-danger-soft
 * hover:text-danger` while its affirmative half four lines away spelled a raw
 * `text-emerald-600 hover:bg-emerald-50`. One row, one gesture, two governance
 * regimes.
 *
 * ## The needle that matters here is a CLASS, not a hex
 *
 * The red census is HEX-keyed, and it says so in its own limit 3: a stock
 * `*-red-N` utility is invisible to it, pinned only as an exact FILE set. That
 * blindness is total for this family, because the affirmative literals live
 * almost entirely in Tailwind class attributes — `text-emerald-600`, not
 * `#059669`. So leg 1 below is the leg with teeth, keyed on the class NAME and
 * counted per `file :: utility` occurrence.
 *
 * The hue-keyed hex legs (2 and 3) run beside it for completeness, over the
 * same green window, so a future hand-spelled `#059669` is caught too. Their
 * allowlists are mostly the NOTE CARD KIND and colour-picker palette DATA —
 * different families that happen to share a hue, exactly the situation the red
 * census's own limit 2 records ("hue is not role").
 *
 * ## Three stated limits, inherited and one new
 *
 *  1. **A `var(--token, #hex)` fallback is excluded by RULE**, as in the red
 *     census — the repo's documented idiom, governed for the whole tree by
 *     `phantom-css-var.test.ts`. Leg 6 adds the family-scoped ban.
 *  2. **Hue is not role.** A legitimately non-affirmative green lands on an
 *     allowlist with its reason rather than being silently skipped.
 *  3. **Occurrence COUNTS are part of leg 1's key.** The red census keys
 *     `file:#hex` and records the cost ("a file may grow a SECOND occurrence of
 *     a literal it already carries without failing"). Here the two exempted
 *     shapes are a DIFF LEGEND and a diff FIELD DIALECT — both of which are
 *     one-per-file by construction — so the count is cheap to pin and closes
 *     that hole for this family.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"] as const;
const globals = read("src/app/globals.css");

/* ── The needles ─────────────────────────────────────────────────── */

/**
 * Hue window (degrees) and saturation floor for the affirmative green family.
 *
 * Measured against the shipped palette: emerald spans hue 152-164, the
 * traffic-light / note greens sit at ~142, and Tailwind teal reaches ~173. The
 * warm neutrals this palette is mostly built from live at hue 30-50 and
 * `--status-info` at 209, so the window has real room either side — the
 * anti-vacuity legs below pin both directions.
 */
const GREEN_HUE_MIN = 120;
const GREEN_HUE_MAX = 175;
const GREEN_SAT_FLOOR = 0.2;

export function isAffirmativeGreen(hex: string): boolean {
  // Expand `#0a0` → `#00aa00` FIRST, for the reason the red census records:
  // `hexToRgb` accepts only the 6-digit form and returns [0,0,0] otherwise, so
  // every 3-digit green would classify as BLACK and walk straight through.
  const m = /^#([0-9a-f]{3})$/i.exec(hex.trim());
  const full = m ? `#${m[1].split("").map((c) => c + c).join("")}` : hex;
  const [h, s] = rgbToHsl(...hexToRgb(full));
  return s >= GREEN_SAT_FLOOR && h >= GREEN_HUE_MIN && h <= GREEN_HUE_MAX;
}

/** The Tailwind ramps that land inside the hue window above. */
const GREEN_RAMPS = "emerald|green|teal|lime";

/** Every utility prefix that takes a colour, with every variant prefix. */
const GREEN_UTILITY = new RegExp(
  `\\b(?:(?:hover|focus|focus-visible|active|group-hover|disabled|placeholder|dark|first|last|even|odd):)*` +
    `(?:text|bg|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide)-` +
    `(?:${GREEN_RAMPS})-\\d{2,3}\\b`,
  "g",
);

/**
 * `#rgb` and `#rrggbb` only — `#rrggbbaa` is not a colour this palette uses.
 *
 * The `(?<!&)` is not decoration: an HTML NUMERIC ENTITY (`&#182;`, the pilcrow
 * `MenuBar` renders) is textually a 3-digit hex, and `#182` expands to `#118822`
 * — a green squarely inside the window below. The red census records the same
 * hole as a stated limit ("a 3- or 6-character DOM id would read as a colour")
 * and never had a live one; this family does, so the entity form is excluded by
 * RULE rather than bought off with an allowlist entry that would also excuse a
 * real colour in that file.
 */
const HEX = /(?<!&)#[0-9a-fA-F]{3,8}\b/g;
const isPlainHex = (m: string) => m.length === 4 || m.length === 7;

/** Blank `var(--token, …)` fallbacks — see limit 1. */
const withoutVarFallbacks = (src: string) =>
  src.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, (m) => " ".repeat(m.length));

/* ── The file walk ───────────────────────────────────────────────── */

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

const PRODUCTION_FILES = [...walkSource("src"), ...walkSource("library")];

/* ── Leg 1: the CLASS census (the leg with teeth) ────────────────── */

/**
 * Raw green Tailwind utilities still spelled on a production surface, keyed
 * `file :: utility` with the number of occurrences.
 *
 * Both surviving entries are the suggestion card family's DIFF vocabulary —
 * green = the proposed text, red = the text it replaces. Their RED halves are
 * likewise pinned rather than repainted (`destructive-red-tokens.test.ts` →
 * `PINNED_STOCK_RED_SITES`, whose own reason is quoted below), so converting
 * one half of a two-colour legend would leave the pair speaking two
 * vocabularies. Repainting BOTH needs rungs this family does not have — a light
 * border, a dark body ink and a placeholder ink — and a visual decision per card
 * surface, which is a product call rather than a sweep.
 *
 * **This list may only SHRINK.** A new raw green utility on an affirmative
 * control is TOKENIZE-it (`--positive-soft` / `--positive-ink` /
 * `--positive-strong`), never a new entry.
 */
const PERMITTED_GREEN_UTILITIES: Readonly<Record<string, { count: number; why: string }>> = {
  "src/panels/Cutter/CutterSuggestionCard.tsx :: text-emerald-700": {
    count: 1,
    why:
      "the compressed diff legend — `text-emerald-700/90` (the proposed text) reads only " +
      "against the `text-red-700/70` two lines below it. Not an affirmative CONTROL; the " +
      "red half is pinned in destructive-red-tokens for the same reason.",
  },
  "src/panels/Revisions/RevisionSuggestionCard.tsx :: text-emerald-700": {
    count: 1,
    why:
      "the compressed diff legend, twin of the Cutter card's. Same pair, same reason: a " +
      "legend is a two-colour statement and converting one half is worse than converting " +
      "neither.",
  },
  "src/panels/_shared/suggestion-fields.tsx :: bg-emerald-50": {
    count: 1,
    why:
      "FIELD_TEXTAREA_CLASS.suggested_text — the ORIGINAL/SUGGESTED field dialect, whose " +
      "red half destructive-red-tokens already pins as 'a DESIGNED look' needing rungs " +
      "this family does not have. Ground of the suggested field.",
  },
  "src/panels/_shared/suggestion-fields.tsx :: border-emerald-200": {
    count: 1,
    why: "the same field dialect's resting border. See the ground entry above.",
  },
  "src/panels/_shared/suggestion-fields.tsx :: text-emerald-800": {
    count: 1,
    why: "the same field dialect's BODY ink — a rung the four-rung family has no member for.",
  },
  "src/panels/_shared/suggestion-fields.tsx :: placeholder:text-emerald-400": {
    count: 1,
    why: "the same field dialect's placeholder ink — likewise no member in this family.",
  },
  "src/panels/_shared/suggestion-fields.tsx :: focus:border-emerald-400": {
    count: 1,
    why: "the same field dialect's focus border. Converting it alone would split one control.",
  },
};

function greenUtilityHits(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rel of PRODUCTION_FILES) {
    // Comments stripped, STRING LITERALS KEPT: a Tailwind utility lives inside
    // a quoted class attribute, and this task's own fixes quote the retired
    // spellings in prose — a raw-source grep would flag its own explanation.
    const src = commentsStripped(read(rel));
    for (const m of src.matchAll(GREEN_UTILITY)) {
      const key = `${rel} :: ${m[0]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

describe("no raw green Tailwind utility on an affirmative control", () => {
  const counts = greenUtilityHits();

  it("every hit is a recorded, reasoned exception with its exact count", () => {
    const found = Object.fromEntries(Object.entries(counts).sort());
    const expected = Object.fromEntries(
      Object.entries(PERMITTED_GREEN_UTILITIES)
        .map(([k, v]) => [k, v.count] as const)
        .sort(),
    );
    expect(found, "unrecorded raw green utility (or a changed occurrence count)").toEqual(expected);
  });

  it("no exception is excused wordlessly", () => {
    for (const [key, { why }] of Object.entries(PERMITTED_GREEN_UTILITIES)) {
      expect(why.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it("the two commit surfaces carry none at all", () => {
    // The reported pair. Both mount the shared `CommitActions`, so neither may
    // spell a palette literal even in a variant it happens not to use today.
    for (const rel of [
      "src/components/PendingChangePill.tsx",
      "src/components/CommitActions.tsx",
    ]) {
      const hits = Object.keys(counts).filter((k) => k.startsWith(`${rel} ::`));
      expect(hits, `${rel} must read the --positive family`).toEqual([]);
    }
  });
});

/* ── Leg 2: the stylesheets ──────────────────────────────────────── */

type Hit = { file: string; line: number; hex: string; text: string };

function greenHexHits(file: string, source: string): Hit[] {
  const out: Hit[] = [];
  withoutVarFallbacks(source)
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(HEX)) {
        if (isPlainHex(m[0]) && isAffirmativeGreen(m[0])) {
          out.push({ file, line: i + 1, hex: m[0].toLowerCase(), text: line.trim().slice(0, 100) });
        }
      }
    });
  return out;
}

const fmt = (h: Hit) => `${h.file}:${h.line} ${h.hex} — ${h.text}`;

const PERMITTED_RAW_CSS_GREENS: Readonly<Record<string, string>> = {
  "src/app/globals.css:#dcfce7":
    "the .note-marker HOVER ground. The note CARD KIND's own colour family " +
    "(--note-color / --note-bg / --note-marker-border), deliberately separate from the " +
    "affirmative family — globals.css states the same reasoning for --status-collab-*. " +
    "Tokenising the note marker's hover/active states is that kind's own decision.",
  "src/app/globals.css:#4ade80":
    "the .note-marker hover border, sibling of the ground above. Same family, same reason.",
  "src/app/globals.css:#bbf7d0":
    "the .note-marker SELECTED ground. Same note-kind family; a selected marker is a card " +
    "state, not an affirmative role.",
  "src/app/globals.css:#22c55e":
    "the .note-marker selected border. Byte-identical to --status-ok by coincidence of ramp, " +
    "not by role: this is the note kind's own edge, and merging it would couple a card kind " +
    "to the traffic light.",
};

describe("stylesheets spell no raw affirmative green in a rule body", () => {
  const hits = STYLESHEETS.flatMap((rel) =>
    greenHexHits(rel, cssRuleBodies(cssCommentsStripped(read(rel)))),
  );

  it("every hit is a recorded, reasoned exception", () => {
    const keys = [...new Set(hits.map((h) => `${h.file}:${h.hex}`))].sort();
    expect(keys, `unrecorded raw green:\n${hits.map(fmt).join("\n")}`).toEqual(
      Object.keys(PERMITTED_RAW_CSS_GREENS).sort(),
    );
  });

  it("no exception is excused wordlessly", () => {
    for (const [key, why] of Object.entries(PERMITTED_RAW_CSS_GREENS)) {
      expect(why.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

/* ── Leg 3: the TS/TSX silos ─────────────────────────────────────── */

/**
 * Keyed `file:#hex`, the granularity the red census earned: finer than per FILE
 * (a file may hold both palette DATA and a real role literal) and deliberately
 * not per LINE (a line number churns on every edit above it).
 */
const PERMITTED_RAW_TS_GREENS: Readonly<Record<string, string>> = {
  "src/components/SelectionColorPopover.tsx:#00ff00":
    "one stop of the hue-wheel conic gradient. Palette DATA — the spectrum itself, which no " +
    "token could express.",
  "src/components/ActionsMenuPanel.tsx:#16a34a":
    "the green swatch of the actions-menu colour palette. Palette DATA — the value IS the " +
    "thing the user chooses, not a spelling of a role.",
  "src/lib/panel-theme.ts:#15803d":
    "the 'Green' swatch of the panel-colour PICKER. Palette DATA, same as above.",
  "src/lib/panel-theme.ts:#14b8a6":
    "the 'Teal' swatch of the panel-colour picker. Palette DATA.",
  "src/lib/collab.ts:#15803d":
    "the 'Green' collaborator colour a user may pick for themselves. Palette DATA.",
  "src/lib/collab.ts:#14b8a6":
    "the 'Teal' collaborator colour. Palette DATA.",
  "src/components/AIWindow.tsx:#16a34a":
    "the 'resolved' status chip's DOT, one of a dot/bg/fg triple beside amber and red " +
    "siblings. A STATUS palette, not an affirmative one; folding those onto --status-* is " +
    "its own decision, and pre-existing (its red twin is allowlisted identically).",
  "src/components/AIWindow.tsx:#f0fdf4":
    "the 'resolved' status chip's GROUND, sibling of the dot above. Same status palette.",
  "src/components/AIWindow.tsx:#15803d":
    "the 'resolved' status chip's FOREGROUND, sibling of the two above. Same status palette.",
};

describe("src/ and library/ spell no raw affirmative green outside the recorded sites", () => {
  const hits = PRODUCTION_FILES.flatMap((rel) => greenHexHits(rel, commentsStripped(read(rel))));

  it("every hit is a recorded, reasoned exception", () => {
    const keys = [...new Set(hits.map((h) => `${h.file}:${h.hex}`))].sort();
    expect(keys, `unrecorded raw green:\n${hits.map(fmt).join("\n")}`).toEqual(
      Object.keys(PERMITTED_RAW_TS_GREENS).sort(),
    );
  });

  it("no exception is excused wordlessly", () => {
    for (const [key, why] of Object.entries(PERMITTED_RAW_TS_GREENS)) {
      expect(why.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});

/* ── Leg 4: the family is ONE RAMP ───────────────────────────────── */

const decl = (token: string) =>
  new RegExp(`${token}:\\s*([^;]+);`).exec(cssCommentsStripped(globals))?.[1]?.trim() ?? "";

describe("the affirmative role family", () => {
  it("has four rungs", () => {
    expect(decl("--positive-soft")).toBe("#ecfdf5");
    expect(decl("--positive")).toBe("#10b981");
    expect(decl("--positive-ink")).toBe("#059669");
    expect(decl("--positive-strong")).toBe("#047857");
  });

  it("draws every rung from ONE ramp generation", () => {
    // The two rungs task 286 minted are Tailwind v3 emerald 500/700, and Virgil
    // ships Tailwind v4 (whose emerald ramp is oklch and renders different
    // values). A family assembled from two generations would re-create exactly
    // the implicit relationship the family exists to codify, so the two NEW
    // rungs are pinned to the v3 ramp too — emerald-50 and emerald-600.
    const V3_EMERALD: Record<string, string> = {
      "--positive-soft": "#ecfdf5", // v3 emerald-50 (v4 renders the same bytes)
      "--positive": "#10b981", // v3 emerald-500
      "--positive-ink": "#059669", // v3 emerald-600
      "--positive-strong": "#047857", // v3 emerald-700
    };
    for (const [token, hex] of Object.entries(V3_EMERALD)) {
      expect(decl(token), `${token} left the ramp`).toBe(hex);
    }
  });

  it("is monotone in luminance, soft → strong", () => {
    const lum = (hex: string) => rgbToHsl(...hexToRgb(hex))[2];
    const rungs = ["--positive-soft", "--positive", "--positive-ink", "--positive-strong"];
    const lums = rungs.map((t) => lum(decl(t)));
    for (let i = 1; i < lums.length; i += 1) {
      expect(lums[i], `${rungs[i]} is not darker than ${rungs[i - 1]}`).toBeLessThan(lums[i - 1]);
    }
  });

  it("keeps the accept-control ink at or above the non-text AA bar on white", () => {
    // The ink paints 15px glyphs at strokeWidth 2.5-3 and small labels, so the
    // 3:1 non-text/large bar applies rather than 4.5:1. Measured, --positive-ink
    // also slightly IMPROVES on what the raw v4 emerald-600 utility painted
    // (3.77:1 vs 3.65:1) — the same argument shape --danger-strong's merge made.
    expect(contrastRatio(decl("--positive-ink"), "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(decl("--positive-ink"), "#ffffff")).toBeGreaterThan(
      contrastRatio("#009966", "#ffffff"),
    );
  });

  it("emits a Tailwind alias for every rung spelled as a utility class", () => {
    // The silent half of the boundary: a token minted in `:root` gets no utility
    // for free, so `text-positive-ink` without a `--color-positive-ink` row emits
    // NO CLASS AT ALL — no error, no style, nothing to grep. The biconditional
    // also refuses an alias minted ahead of its first consumer, which is the
    // rule the --color-danger-strong comment states beside it.
    const theme = cssCommentsStripped(globals);
    for (const rung of ["positive", "positive-soft", "positive-ink", "positive-strong"]) {
      const usedAsUtility = PRODUCTION_FILES.some((rel) =>
        // `(?!-)` rather than a bare `\b`: a hyphen IS a word boundary, so
        // `bg-positive-soft` would otherwise satisfy the `positive` rung and
        // the biconditional would demand an alias nothing spells.
        new RegExp(
          `\\b(?:(?:hover|focus|focus-visible|active|group-hover|disabled):)*(?:text|bg|border|ring|fill|stroke)-${rung}(?!-)\\b`,
        ).test(commentsStripped(read(rel))),
      );
      const aliased = new RegExp(`--color-${rung}:\\s*var\\(--${rung}\\)`).test(theme);
      expect(
        aliased,
        `${rung}: utility=${usedAsUtility} alias=${aliased} — the two must agree`,
      ).toBe(usedAsUtility);
    }
  });
});

/* ── Leg 5: the migrated surfaces read the family ────────────────── */

/**
 * The value-keyed half. The censuses above prove no raw green REMAINS; these
 * prove the right token ARRIVED — without them a future edit could satisfy
 * every census by deleting the affordance outright.
 */
describe("the swept surfaces read the affirmative family", () => {
  it.each([
    ["src/components/CommitActions.tsx", "text-positive-ink"],
    ["src/components/CommitActions.tsx", "hover:bg-positive-soft"],
    ["src/panels/Citations/CitationCard.tsx", "text-positive-ink"],
    ["src/components/library/BibEntryPickerMenu.tsx", "text-positive-ink"],
    ["src/components/BibEntryCard.tsx", "text-positive-ink"],
    ["src/components/BibEntryCard.tsx", "hover:bg-positive-soft"],
    ["src/components/BibEntryCard.tsx", "hover:text-positive-strong"],
    ["src/components/CompileLogDisclosure.tsx", "text-positive-strong"],
  ])("%s spells %s", (rel, utility) => {
    expect(commentsStripped(read(rel))).toContain(utility);
  });
});

/* ── Leg 6: no positive-family read carries a hex fallback ───────── */

describe("no positive-family read carries a hex fallback", () => {
  it("finds none in either silo", () => {
    // `--positive*` is defined unconditionally in globals.css, so there is no
    // true statement of the form "this read might not resolve". A fallback that
    // DISAGREES with its token is decoration a retone will never reach.
    const files = [...PRODUCTION_FILES, ...STYLESHEETS];
    const bad: string[] = [];
    for (const rel of files) {
      const src = /\.css$/.test(rel) ? cssCommentsStripped(read(rel)) : commentsStripped(read(rel));
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--positive[\w-]*)\s*,([^)]*)\)/g)) {
          bad.push(`${rel}:${i + 1} ${m[0]}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});

/* ── Self-checks: the census can SEE, and does not over-see ──────── */

describe("the hue needle is neither blind nor indiscriminate", () => {
  it.each([
    "#ecfdf5", "#10b981", "#059669", "#047857", // the family
    "#00bc7d", "#009966", "#007a55", // the v4 emerald ramp
    "#22c55e", "#15803d", "#16a34a", "#4ade80", "#bbf7d0", "#14b8a6", // greens/teals
    "#0f0",
  ])("flags %s", (hex) => expect(isAffirmativeGreen(hex)).toBe(true));

  it.each([
    "#d9d3c8", // --border, a warm neutral at hue ~39
    "#7c5e3c", // --accent, umber
    "#eab308", // --status-warn, yellow
    "#7191b0", // --status-info, steel
    "#ef4444", // --danger
    "#b45757", // --footnote-500, rust
    "#7191b0",
    "#ffffff",
    "#1a1a1a",
    "#9ca3af",
    "#f8f3ed", // --background
  ])("spares %s", (hex) => expect(isAffirmativeGreen(hex)).toBe(false));

  it("would catch a green planted in a rule body", () => {
    const planted = ".some-new-rule {\n  color: #12b886;\n}\n";
    expect(greenHexHits("x.css", cssRuleBodies(cssCommentsStripped(planted)))).toHaveLength(1);
  });

  it("does not count a green that is merely NAMED in a comment", () => {
    const commented = ".r {\n  /* was #10b981 before the token */\n  color: var(--positive);\n}\n";
    expect(greenHexHits("x.css", cssRuleBodies(cssCommentsStripped(commented)))).toHaveLength(0);
  });

  it("does not count a green that is a var() fallback", () => {
    const fallback = ".r {\n  color: var(--note-color, #15803d);\n}\n";
    expect(greenHexHits("x.css", cssRuleBodies(cssCommentsStripped(fallback)))).toHaveLength(0);
  });

  it("does not count a green in a :root definition", () => {
    const def = ":root {\n  --positive: #10b981;\n}\n";
    expect(greenHexHits("x.css", cssRuleBodies(cssCommentsStripped(def)))).toHaveLength(0);
  });

  it("does not read an HTML numeric entity as a colour", () => {
    // `&#182;` is the pilcrow, and `#182` expands to a green. This fired for
    // real on `MenuBar.tsx` before the `(?<!&)` guard.
    expect(greenHexHits("x.tsx", 'const p = "&#182;";')).toHaveLength(0);
    // …and a genuine 3-digit green in the same file is still caught.
    expect(greenHexHits("x.tsx", 'const c = "#182";')).toHaveLength(1);
  });

  it("the utility needle sees every variant prefix and every green ramp", () => {
    const planted =
      'const a = "text-emerald-600 hover:bg-green-50 focus:border-teal-400 disabled:text-lime-700";';
    const found = [...commentsStripped(planted).matchAll(GREEN_UTILITY)].map((m) => m[0]);
    expect(found).toEqual([
      "text-emerald-600",
      "hover:bg-green-50",
      "focus:border-teal-400",
      "disabled:text-lime-700",
    ]);
  });

  it("the utility needle does not count one merely NAMED in a comment", () => {
    // The shape this task's own fixes take: a retired spelling quoted in prose.
    const planted = '// was text-emerald-600 hover:bg-emerald-50 before the token\nconst a = 1;';
    expect([...commentsStripped(planted).matchAll(GREEN_UTILITY)]).toHaveLength(0);
  });

  it("the strippers did not swallow the stylesheet", () => {
    // A runaway stripper makes every leg above pass vacuously (task 202b).
    const stripped = cssCommentsStripped(globals);
    expect(stripped.length).toBeGreaterThan(globals.length * 0.7);
    expect((stripped.match(/\{/g) ?? []).length).toBe((stripped.match(/\}/g) ?? []).length);
    expect((stripped.match(/\{/g) ?? []).length).toBeGreaterThan(400);
    expect(cssRuleBodies(stripped).replace(/\s/g, "").length).toBeGreaterThan(10_000);
  });

  it("the production walk found both silos", () => {
    expect(PRODUCTION_FILES.filter((f) => f.startsWith("src/")).length).toBeGreaterThan(300);
    expect(PRODUCTION_FILES.filter((f) => f.startsWith("library/")).length).toBeGreaterThan(20);
  });
});
