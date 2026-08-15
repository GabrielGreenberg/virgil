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
 * What it SEES: a JSX open tag carrying `rounded-full` (or `borderRadius` at a
 * pill/50% value) together with a dot-sized box — a `w-*` and an `h-*` in the
 * 1–2.5 range asked INDEPENDENTLY (not as an adjacent pair: `w-2 rounded-full
 * h-2` is not an exotic authoring style, and requiring adjacency is a hole, not
 * a precision), the `size-*` shorthand, or arbitrary `w-[Npx]`/`h-[Npx]` at
 * ≤10px. Round BUTTONS (w-5/w-6) and colour-picker swatches fall out by size,
 * which is what keeps this precise rather than merely large. Both silos; tests
 * excluded, since a test may hand-roll a dot.
 *
 * What it does NOT see, enumerated rather than gestured at — each of these
 * reintroduces a hand-rolled dot with CI green:
 *   • a dot sized entirely by inline style (`style={{ width: 6, height: 6 }}`)
 *     — `CollabPresenceDots` and the library silo's `Dot` are both that shape,
 *     and 10px `borderRadius: "50%"` knobs elsewhere prove the spelling is
 *     native here;
 *   • an SVG `<circle>` filled by a state;
 *   • classes composed out of the tag — `clsx(DOT_SIZE, "rounded-full")`, or a
 *     template literal whose size lives in a const. `tagAround` reads the open
 *     tag's literal text and nothing else;
 *   • a size outside the range (`w-3 h-3`).
 * Closing those means parsing composition, which this needle deliberately does
 * not attempt. It catches the shape the five converted sites actually had, and
 * says so instead of implying more.
 *
 * A further limit in the helper: `tagAround` takes the nearest preceding `<`,
 * so a comparison (`i<n`) or a generic (`Record<string,`) can start a
 * pseudo-tag. Those normally die on its end-before-needle guard, but one whose
 * scan runs past the needle could report a bogus tag at a misleading line. No
 * such case is live — every censused hit today is a genuine element.
 *
 * The library silo is not ungoverned: `library/components/StatusPill.tsx`
 * exports a real `Dot` with a closed tone union. Stated exactly, though — that
 * union is CHROMATIC (`"green"`, `"amber"`, `"gray"`), the vocabulary
 * `StatusDot.tsx` argues is a layer-shifting mistake. It is a primitive; it is
 * not agreement with this law.
 *
 * ALLOWLIST KEYING — an entry names a file AND a fragment of the tag, and must
 * match EXACTLY ONE censused hit. The "exactly one" half is the load-bearing
 * part and the obvious version without it was wrong: `file + includes(fragment)`
 * excuses every OTHER hit in the same file whose tag contains the fragment, so
 * copy-pasting an allowlisted dot — the likeliest regression there is — passes.
 * Requiring a unique match makes the second copy fail, without pinning line
 * numbers that drift on every unrelated edit (task 204's per-line rule, in the
 * form that survives reformatting).
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
  [
    "src/components/EditorLayout.tsx",
    "bg-yellow-500",
    "the PDF-viewer chip's stale dot: the SAME signal StatusCluster's pdf-stale dot paints, from a different family. That one reads --status-warn (#eab308); this one is Tailwind v4's yellow-500 (oklch 79.5% 0.184 86.047 ≈ #f0b100), the ramp its own chip's bg-yellow-100/text-yellow-800 sit on — so the two ALREADY differ, and converting the dot alone both repaints it and strands it off its chip. Which family wins is a colour decision",
  ],
];

/* ── The census ─────────────────────────────────────────────────────── */

/** A round shape: the utility, or an inline radius at a pill/circle value. */
const ROUND = /rounded-full|borderRadius:\s*["'`](?:50%|var\(--radius-pill\))/;

/** The `w-*`/`h-*` halves are asked INDEPENDENTLY — see the header on why
 *  adjacency is a hole rather than a precision. */
const W_DOT = /\bw-(?:1|1\.5|2|2\.5)(?![\w.[-])/;
const H_DOT = /\bh-(?:1|1\.5|2|2\.5)(?![\w.[-])/;
const SIZE_DOT = /\bsize-(?:1|1\.5|2|2\.5)(?![\w.[-])/;
const W_ARB = /\bw-\[(?:[0-9]|10)px\]/;
const H_ARB = /\bh-\[(?:[0-9]|10)px\]/;

/**
 * BOTH axes must be small. Asking either axis alone is not a wider net, it is a
 * wrong one: the Outline's drop indicator is `left-2 right-2 h-[2px] …
 * rounded-full`, a full-width 2px RULE — round-capped, tiny on one axis, and
 * not remotely a dot. A single-axis needle flags it and every pill-capped bar
 * like it, which is how a census earns the reputation of crying wolf.
 */
function isDotSized(tag: string): boolean {
  if (SIZE_DOT.test(tag)) return true;
  return (W_DOT.test(tag) || W_ARB.test(tag)) && (H_DOT.test(tag) || H_ARB.test(tag));
}

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

/** The matcher, over ONE source string — factored out so the canary can run it
 *  against a synthetic fixture instead of standing on a live allowlisted line
 *  (a canary anchored on the defect evaporates the moment the defect is fixed,
 *  which is exactly what the allowlist below is meant to make happen). */
export function dotHitsIn(source: string, file: string): DotHit[] {
  const hits: DotHit[] = [];
  const seen = new Set<number>();
  const rounds = new RegExp(ROUND.source, "g");
  for (const m of source.matchAll(rounds)) {
    const at = m.index ?? 0;
    const tag = tagAround(source, at);
    if (!tag || !isDotSized(tag)) continue;
    // One hit per TAG, not per round-shape occurrence.
    const start = source.lastIndexOf(tag, at);
    if (seen.has(start)) continue;
    seen.add(start);
    hits.push({
      file,
      line: source.slice(0, at).split("\n").length,
      tag: tag.replace(/\s+/g, " "),
    });
  }
  return hits;
}

function censusDots(): DotHit[] {
  const hits: DotHit[] = [];
  for (const abs of [...sourceFiles(SRC), ...sourceFiles(LIBRARY)]) {
    const rel = path.relative(ROOT, abs);
    if (rel === PRIMITIVE) continue;
    // Comments stripped, string LITERALS kept: a dot's classes live in a
    // string, so blanking literals would blind the census to every hit.
    hits.push(...dotHitsIn(commentsStripped(read(abs)), rel));
  }
  return hits;
}

const permitted = [...PERMITTED_NON_STATUS_DOTS, ...PERMITTED_HAND_ROLLED_STATUS_DOTS];

const matchesFor = (hits: DotHit[], file: string, fragment: string) =>
  hits.filter((h) => h.file === file && h.tag.includes(fragment));

describe("status-dot census: no hand-rolled dot outside the allowlists", () => {
  it("flags every dot-shaped element, and every flagged one is allowlisted", () => {
    const hits = censusDots();
    const unlisted = hits.filter(
      (h) => !permitted.some(([file, fragment]) => h.file === file && h.tag.includes(fragment)),
    );
    expect(
      unlisted.map((h) => `${h.file}:${h.line}  ${h.tag.slice(0, 140)}`),
    ).toEqual([]);
  });

  it("lets each allowlist entry excuse EXACTLY ONE site", () => {
    // Without this, `file + includes(fragment)` excuses every other hit in the
    // same file whose tag contains the fragment — so copy-pasting an
    // allowlisted dot, the likeliest regression there is, passes. A second
    // match means either a new dot to CONVERT or an entry to make specific.
    const hits = censusDots();
    const ambiguous = permitted
      .map(([file, fragment]) => [file, fragment, matchesFor(hits, file, fragment)] as const)
      .filter(([, , m]) => m.length !== 1)
      .map(([file, fragment, m]) => `${file} :: "${fragment}" matched ${m.length} sites`);
    expect(ambiguous).toEqual([]);
  });

  it("can see dots at all — against a SYNTHETIC fixture, not a live line", () => {
    // The anchors are written here, so converting every allowlisted site (the
    // stated goal) can never turn this canary red. Anchoring it on a real
    // allowlisted dot would make the guard fight its own purpose.
    const fixture = `
      const A = () => <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#abc" }} />;
      const B = () => <span className="w-2 rounded-full h-2" />;            // interleaved
      const C = () => <span className="size-2 rounded-full shrink-0" />;    // size-* shorthand
      const D = () => <span className="w-[6px] h-[6px] rounded-full" />;    // arbitrary px
      const E = () => <button className="w-5 h-5 rounded-full">x</button>;  // a BUTTON, too big
      const F = () => <span className="w-2 h-2 rounded-sm" />;              // square, not a dot
      const G = () => <span className="w-3 h-3 rounded-full" />;            // outside the range
      const H = () => <div className="left-2 right-2 h-[2px] rounded-full" />; // a BAR, one axis
    `;
    const found = dotHitsIn(fixture, "fixture.tsx").map((h) => h.tag);
    expect(found).toHaveLength(4);
    for (const marker of ["w-1.5 h-1.5", "w-2 rounded-full h-2", "size-2", "w-[6px]"]) {
      expect(found.some((t) => t.includes(marker))).toBe(true);
    }
    // …and the four it must NOT flag. The last is the real shape that caught
    // this needle's first draft out (Outline's round-capped drop indicator).
    for (const marker of ["w-5 h-5", "rounded-sm", "w-3 h-3", "h-[2px]"]) {
      expect(found.some((t) => t.includes(marker))).toBe(false);
    }
  });

  it("finds the live sites too (the fixture proves the matcher, not the sweep)", () => {
    // Deliberately a COUNT floor with headroom, not a set of file names: it
    // asserts the directory walk reaches real source, and cannot be satisfied
    // by an empty sweep. It carries no opinion about WHICH files.
    expect(censusDots().length).toBeGreaterThan(0);
  });

  it("has no stale allowlist entry", () => {
    const hits = censusDots();
    const stale = permitted.filter(([file, fragment]) => matchesFor(hits, file, fragment).length === 0);
    expect(stale.map(([f, frag]) => `${f} :: ${frag}`)).toEqual([]);
  });

  it("leaves the three Virgil-bar sites this task converted with no hand-rolled dot", () => {
    // The defect leg: each of these rendered its own span before task 315, and
    // each would be reported by the census above if it did again.
    const converted = new Set(censusDots().map((h) => h.file));
    for (const file of [
      "src/components/CollabStatusPill.tsx",
      "src/components/editor-layout/StatusCluster.tsx",
      "src/components/ExternalChangeBadge.tsx",
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
    // Stated exactly: this asks whether a COLOUR is selected by a conditional
    // on a state, not merely whether a var() appears — StatusCluster keeps two
    // legitimate unconditional ones (a divider's `--edge-strong`, a checkmark's
    // `--accent`). What must not come back is the nested ternary the AI dot
    // used to carry: three tokens chosen by `vbar.aiDot === …`.
    const src = commentsStripped(
      read(path.join(SRC, "components/editor-layout/StatusCluster.tsx")),
    );
    expect(src).not.toMatch(/var\(--status-/);
    expect(src).not.toMatch(/aiDot\s*===/);
  });
});

/**
 * A type-level pin on the tone map's totality, plus its accepting control.
 *
 * The positive leg goes red if `TONE_TOKEN` ever stops covering the union. It
 * is NOT sufficient on its own, and the reason is measured rather than assumed:
 * a `Record<string, string>` (or `any`) IS assignable to `Record<StatusTone,
 * string>`, so widening the annotation would make the positive leg pass
 * vacuously while every tone lost its guarantee. The `@ts-expect-error` twin is
 * the leg that catches exactly that — under either widening the missing
 * `"scratch-tone"` becomes assignable, the expected error disappears, and
 * TS2578 fires.
 *
 * (Its sibling in `action-union-exhaustiveness.test.ts` records the opposite
 * measurement for ITS shape — there the registry is a large annotated object
 * literal, so an index-signature widening reddens at the declaration. The
 * difference is real, not a contradiction: what a positive leg can see depends
 * on where the annotation sits.)
 *
 * Enforced by `tsc --noEmit`, not by vitest.
 */
const _toneMapIsTotal: Record<StatusTone, string> = TONE_TOKEN;
void _toneMapIsTotal;
// @ts-expect-error — a tone the union does not declare must not be assignable.
const _toneMapIsNotWider: Record<StatusTone | "scratch-tone", string> = TONE_TOKEN;
void _toneMapIsNotWider;
