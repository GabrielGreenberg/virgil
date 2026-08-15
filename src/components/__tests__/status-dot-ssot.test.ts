/**
 * Status-dot SSOT (task 2026-08-08-315) — the CI half of "one small colored
 * status dot, one tone vocabulary, one token map". Same source-census +
 * allowlist discipline as the keystroke-sanctity / scroll-reposition /
 * pane-drag laws, and the same reasoning as its nearest colour-family sibling,
 * `color-token-consumers.test.ts`.
 *
 * THE LAW
 * -------
 * A tiny round element whose fill encodes a STATE is `<StatusDot tone=… >`.
 * The caller names what the dot MEANS; `StatusDot.tsx` owns the only mapping
 * from a tone to a `var(--…)` token. Nothing else spells a status-dot colour.
 *
 * WHY THE CENSUS IS THE LEG WITH TEETH
 * ------------------------------------
 * The primitive was never the part that could misbehave — a call site that
 * doesn't ask it is. Before this task the Virgil bar rendered the idiom four
 * ways, and each was internally fine: a nested `var(--status-*)` ternary (the
 * AI dot), one token (pdf-stale), a private `PausedDot` helper, and a
 * `Record<string, string>` of RAW HEX with a raw `?? "#888"` fallback (the
 * collab pen dot). Nothing was a type error and no behavioural test could see
 * the difference, because each spelled its colour the same way the code
 * testing it did. What a hex-in-tsx grep would have caught is one of the four;
 * what this census catches is the SHAPE — a hand-rolled dot, however it is
 * coloured.
 *
 * The two-hex collab pair also had to leave the file WITHOUT adopting a
 * byte-identical token from another family: `#15803d` is `--note-color` (the
 * note CARD KIND) and `#d4a843` is `--amber-500` (the warm SCALE). Adopting
 * either would have coupled pen state to a kind, so that a retint of the Note
 * colour repaints the collaborator dot — the coupling task 135's own comment
 * warns against, arrived at by the route that looks free. Hence a dedicated
 * `--status-collab-*` pair pinned to the shipped hexes: a zero-diff swap.
 *
 * REACH, STATED HONESTLY
 * ----------------------
 *   • SHAPE — the census keys on a JSX tag carrying `rounded-full` AND a
 *     dot-sized `w-*`/`h-*` pair (either class order). A dot sized by inline
 *     `style={{ width: 6 }}` is invisible to it — `CollabPresenceDots` and the
 *     library silo's own `Dot` primitive are both that shape. The library one
 *     is a REAL primitive with its own closed tone union
 *     (`library/components/StatusPill.tsx`), so the silo is not ungoverned;
 *     it simply isn't governed by this needle.
 *   • SIZE — `w-1` … `w-2.5`. Round BUTTONS (w-5/w-6) and colour-picker
 *     swatches are excluded by size, which is what keeps the census precise
 *     rather than merely large.
 *   • SCOPE — both silos, tests excluded. A test may hand-roll a dot.
 *
 * The allowlists are keyed by file AND a distinctive fragment of the tag, not
 * by file alone: a file-scoped exemption would also excuse the NEXT dot added
 * beside the exempt one, which is the failure mode this repo keeps re-learning
 * (task 204's per-line rule).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, tagAround } from "@/lib/__tests__/_source-scan";
import { TONE_TOKEN, type StatusTone } from "@/components/StatusDot";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const LIBRARY = path.join(ROOT, "library");
const read = (abs: string) => readFileSync(abs, "utf8");
const globals = read(path.join(SRC, "app/globals.css"));

/** The primitive itself — the one place a dot's classes are spelled. */
const PRIMITIVE = "src/components/StatusDot.tsx";

/**
 * Dots that are NOT status dots. Each paints an IDENTITY or a CATEGORY, not a
 * state, so it has no tone to take and correctly owns its own colour: a
 * collaborator's personal colour, a search scope's live panel accent, the
 * accent-toned "drifted" marker (the accent is a user preference, not a
 * status). This list may grow, but only with a stated reason of that shape.
 */
const PERMITTED_NON_STATUS_DOTS: ReadonlyArray<[file: string, fragment: string, why: string]> = [
  [
    "src/components/CollabClaimPill.tsx",
    "backgroundColor: color",
    "the PARTNER's own identity colour, per user — an identity swatch, not a state",
  ],
  [
    "src/panels/Search/SearchPanel.tsx",
    "scopeDotBackground(scopeAccent(s))",
    "search-scope swatch: the scope's live panel accent (a category), with on/off carried by opacity",
  ],
  [
    "src/panels/Search/SearchPanel.tsx",
    "scopeDotBackground(color)",
    "the same scope swatch on the ScopeChip — category colour, not a state",
  ],
  [
    "src/components/ManageStylesModal.tsx",
    "bg-[var(--accent)]",
    "'preamble drifted' marker painted in the live accent preference; a token read, no status tone applies",
  ],
];

/**
 * Hand-rolled STATUS dots that predate this law. Each is a real member of the
 * class, recorded rather than swept — and each needs a colour decision this
 * task had no mandate to make, because none of their values is byte-identical
 * to an existing status token (unlike the four the Virgil bar converted). This
 * list may only SHRINK: a hit is CONVERT-it, never a new entry.
 */
const PERMITTED_HAND_ROLLED_STATUS_DOTS: ReadonlyArray<[file: string, fragment: string, why: string]> = [
  [
    "src/components/AIWindow.tsx",
    "background: meta.dot",
    "STATUS_META's per-status RAW HEX (#d97706 / #7c3aed / #16a34a) — the same defect one surface over, but its purple belongs to no status family and its dot sits beside chipBg/chipFg hexes in the same record, so tokenizing the dot alone would be half a job",
  ],
  [
    "src/panels/_shared/suggestion-fields.tsx",
    "STATUS_DOT[status]",
    "a five-state Tailwind palette map (blue-400 / sky-300 / amber-400 / var(--positive) / red-400): four of the five resolve to no token, so adopting tones is a palette decision",
  ],
  [
    "src/panels/Bibliography/BibliographyPanel.tsx",
    "bg-amber-400 animate-pulse",
    "pending pulse in raw Tailwind amber-400 (#fbbf24), which matches no token; also the only ANIMATED dot, a capability the primitive does not model",
  ],
  [
    "src/components/BibEntryCard.tsx",
    "rounded-full h-2 w-2 bg-amber-500",
    "PulsingDot's core, under a second ping layer — same amber-400/500 question as the Bibliography pending dot, plus a two-layer shape",
  ],
];

/* ── The census ─────────────────────────────────────────────────────── */

const DOT_SIZED =
  /(?:\bw-(?:1|1\.5|2|2\.5)\s+h-(?:1|1\.5|2|2\.5)\b|\bh-(?:1|1\.5|2|2\.5)\s+w-(?:1|1\.5|2|2\.5)\b)/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) sourceFiles(abs, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(abs);
  }
  return out;
}

type DotHit = { file: string; line: number; tag: string };

function censusDots(): DotHit[] {
  const hits: DotHit[] = [];
  for (const abs of [...sourceFiles(SRC), ...sourceFiles(LIBRARY)]) {
    const rel = path.relative(ROOT, abs);
    if (rel === PRIMITIVE) continue;
    // Comments stripped, string LITERALS kept: a dot's classes live in a
    // string, so blanking literals would blind the census to every hit.
    const src = commentsStripped(read(abs));
    for (const m of src.matchAll(/rounded-full/g)) {
      const tag = tagAround(src, m.index ?? 0);
      if (!tag || !DOT_SIZED.test(tag)) continue;
      hits.push({
        file: rel,
        line: src.slice(0, m.index).split("\n").length,
        tag: tag.replace(/\s+/g, " "),
      });
    }
  }
  return hits;
}

const permitted = [...PERMITTED_NON_STATUS_DOTS, ...PERMITTED_HAND_ROLLED_STATUS_DOTS];

const isPermitted = (hit: DotHit) =>
  permitted.some(([file, fragment]) => hit.file === file && hit.tag.includes(fragment));

describe("status-dot census: no hand-rolled dot outside the allowlists", () => {
  it("flags every dot-shaped element, and every flagged one is allowlisted", () => {
    const unlisted = censusDots().filter((h) => !isPermitted(h));
    expect(
      unlisted.map((h) => `${h.file}:${h.line}  ${h.tag.slice(0, 140)}`),
    ).toEqual([]);
  });

  it("can see dots at all (a census that finds nothing proves nothing)", () => {
    // Anchored on the PERMITTED sites, never on a converted one: a canary
    // standing on the defect evaporates the moment the defect is fixed.
    const files = new Set(censusDots().map((h) => h.file));
    expect(files.has("src/panels/_shared/suggestion-fields.tsx")).toBe(true);
    expect(files.has("src/components/AIWindow.tsx")).toBe(true);
    expect(censusDots().length).toBeGreaterThanOrEqual(permitted.length);
  });

  it("has no stale allowlist entry", () => {
    const hits = censusDots();
    const stale = permitted.filter(
      ([file, fragment]) => !hits.some((h) => h.file === file && h.tag.includes(fragment)),
    );
    expect(stale.map(([f, frag]) => `${f} :: ${frag}`)).toEqual([]);
  });

  it("leaves the four Virgil-bar sites this task converted with no hand-rolled dot", () => {
    // The defect leg: each of these rendered its own span before task 315, and
    // each would be reported by the census above if it did again.
    const converted = new Set(censusDots().map((h) => h.file));
    for (const file of [
      "src/components/CollabStatusPill.tsx",
      "src/components/editor-layout/StatusCluster.tsx",
      "src/components/ExternalChangeBadge.tsx",
      "src/components/EditorLayout.tsx",
    ]) {
      expect(converted.has(file)).toBe(false);
    }
  });
});

/* ── The tone map ───────────────────────────────────────────────────── */

describe("every tone resolves to a token that globals.css defines", () => {
  it.each(Object.entries(TONE_TOKEN))("%s reads a var()", (_tone, value) => {
    expect(value).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });

  it.each(Object.entries(TONE_TOKEN))("%s's token is defined in :root", (_tone, value) => {
    const token = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
    expect(token).toBeDefined();
    expect(globals).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
  });

  it("keeps muted and inactive distinct — they are different greys for different facts", () => {
    // `muted` is ink (a real-but-unreachable state); `inactive` is an edge
    // weight (a mechanism switched off). Folding them would be a colour change
    // wearing a cleanup's clothes.
    expect(TONE_TOKEN.muted).not.toBe(TONE_TOKEN.inactive);
  });
});

describe("the collab pen pair is its own family, pinned byte-neutral", () => {
  it.each([
    ["--status-collab-active", "#15803d"],
    ["--status-collab-idle", "#d4a843"],
  ])("defines %s = %s (the hex the pill painted before the token)", (token, hex) => {
    expect(globals).toMatch(new RegExp(`${token}:\\s*${hex}\\s*;`));
  });

  it("does not alias the note card kind or the amber scale", () => {
    // The byte-identical tokens next door. Aliasing either would make a retint
    // of the Note colour (or the amber scale) repaint the collaborator dot.
    for (const token of ["--status-collab-active", "--status-collab-idle"]) {
      const decl = new RegExp(`${token}:\\s*([^;]+);`).exec(globals)?.[1] ?? "";
      expect(decl).not.toMatch(/var\(--note-color\)|var\(--amber-500\)/);
    }
  });

  it("leaves no pen-status colour literal in CollabStatusPill", () => {
    // Comments stripped, string literals KEPT: the needle here IS a literal,
    // so blanking literals would make the leg unfalsifiable (task 205's
    // lesson, read the right way round) — while a comment that NAMES the
    // retired hex to explain why it is gone is prose, not a spelling.
    const src = commentsStripped(read(path.join(SRC, "components/CollabStatusPill.tsx")));
    for (const hex of ["#15803d", "#d4a843", "#78716c", "#7191b0", "#888"]) {
      expect(src).not.toContain(hex);
    }
  });

  it("keys the pen tone map on the closed PenStatus union, so the dead fallback cannot return", () => {
    // `?? "#888"` was a defensive branch over a `Record<string, string>` that
    // could never fire — and it spelled a fifth raw hex to say so. A Record
    // over the union makes a missing state a compile error instead.
    const src = commentsStripped(read(path.join(SRC, "components/CollabStatusPill.tsx")));
    expect(src).toMatch(/Record<PenStatus,\s*StatusTone>/);
    expect(src).not.toMatch(/\?\?\s*["'`]#/);
  });
});

describe("the AI dot's producer names a state, not a colour", () => {
  it("returns tones from the shared vocabulary", () => {
    const src = commentsStripped(read(path.join(SRC, "components/AIWindow.tsx")));
    // The pre-315 union. A colour-named state union just moves the paint
    // decision up a layer — the consumer then re-derives the meaning.
    expect(src).not.toMatch(/"red"\s*\|\s*"green"\s*\|\s*"yellow"/);
    expect(src).toMatch(/export type AiDotTone = Extract<StatusTone,/);
  });

  it("leaves the Virgil bar with no state→colour mapping of its own", () => {
    const src = commentsStripped(
      read(path.join(SRC, "components/editor-layout/StatusCluster.tsx")),
    );
    expect(src).not.toMatch(/var\(--status-/);
  });
});

/** A type-level accepting control for the tone map's totality: it goes red if
 *  `TONE_TOKEN` ever stops covering the union, and the `@ts-expect-error` twin
 *  goes red (TS2578) if the record is widened to something that accepts
 *  anything — so neither leg can pass for the wrong reason. Enforced by
 *  `tsc --noEmit`, not by vitest. */
const _toneMapIsTotal: Record<StatusTone, string> = TONE_TOKEN;
void _toneMapIsTotal;
// @ts-expect-error — a tone the union does not declare must not be assignable.
const _toneMapIsNotWider: Record<StatusTone | "scratch-tone", string> = TONE_TOKEN;
void _toneMapIsNotWider;
