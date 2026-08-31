import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped } from "@/lib/__tests__/_source-scan";
import {
  DERIVED_CSS,
  PREFERENCES_TREE,
  PREF_TO_CSS,
  isLeaf,
  type PrefLeaf,
  type PrefNode,
} from "@/lib/preferences-tree";
import { DEFAULT_PREFS, type EditorPreferences } from "@/hooks/usePreferences";

/**
 * INERT PREFERENCE CONTROLS — a declared preference is a PROMISE that some
 * pixel reads it (task 2026-08-11-326).
 *
 * This is the reverse direction of `phantom-css-var.test.ts`, and the
 * direction nothing ran. That census asks whether a `var(--x)` READ resolves
 * to a definition; this asks whether a DEFINITION reaches a read. Both failure
 * modes are silent and neither guard can see the other's:
 *
 *  - a read with no definition is CSS's guaranteed-invalid value (the rule is
 *    dropped);
 *  - a definition with no read is a **labelled control in the Preferences
 *    dialog that does nothing** — the user picks a color, watches the swatch
 *    change, and the document does not move.
 *
 * `mathColor` / `mathPrefixColor` were the named instance, and what makes the
 * class worth a guard is how *complete* they looked: an `EditorPreferences`
 * field, a shipped default, a dialog row with a description, a `PREF_TO_CSS`
 * row so `EditorLayout` wrote the token onto `:root` on every change, a
 * `dev-prefs-registry` source, and a first-paint seed in the managed
 * `PROMOTE-DEFAULTS` block. Every plumbing axis but the last one, which no
 * type and no test could see. `atom-chrome-tokens.test.ts` (the task-194
 * census) is blind to it by construction too: it asks whether an atom's rest
 * rule spells a literal, and `.inline-math` declared no `color` at all, so it
 * answered honestly "clean".
 *
 * ── The two legs ─────────────────────────────────────────────────────────
 *
 * **TOKEN** (leg A) — every `PREF_TO_CSS` / `DERIVED_CSS` `cssVar` is read
 * somewhere. This is the mechanical question and its allowlist is a pinned,
 * shrink-only census: a token nothing reads is dead weight even when the
 * preference behind it paints through a sibling.
 *
 * **CONTROL** (leg B) — the user-visible question, and the one the defect was
 * really about: every leaf of `PREFERENCES_TREE` (a labelled row someone can
 * actually change) moves at least one pixel. A preference reaches pixels
 * through THREE channels, and the census reads all three rather than only the
 * first, because a false accusation here is a red CI run against working
 * styling:
 *
 *   1. its own `cssVar` is read;
 *   2. a `DERIVED_CSS` token whose value it demonstrably changes is read —
 *      established by PERTURBATION against the real `compute` (change the
 *      pref, see whether the output moves), never by parsing the compute's
 *      source. `commentColor` reaches the document only this way: its own
 *      `--comment-color` has no reader and its derived `--comment-bg` does;
 *   3. production TS/TSX names the key (`editorPrefs.editorFontSize` is a real
 *      consumer that no CSS token can account for).
 *
 * ── What this cannot see, stated ─────────────────────────────────────────
 *
 *  - A read INSIDE another custom property's definition counts as a read, and
 *    the census does not chase whether that host is itself read. No pref token
 *    is alias-only today (checked), so the hole costs nothing now; a future
 *    `--a: var(--b)` whose `--a` nobody reads would report `--b` alive.
 *  - Channel 3 is a bare-name grep, deliberately generous: the guard's job is
 *    to catch a control with NO consumer at all, and a false accusation is a
 *    red CI run against working styling. It really does over-report — `\
 *    borderColor` matches ten files whose `style={{ borderColor: … }}` has
 *    nothing to do with the pref of that name. What it is tightened against is
 *    the failure that would MATTER: the boundaries are `[^\w-]` rather than
 *    `\b`, so a pref cannot be reported alive off a same-named kebab CSS token
 *    (`\b` counts `var(--foreground)` and `text-foreground` as reads of the
 *    `foreground` pref — four of that pref's six `\b` hits are exactly that).
 *  - "Read" is not "visible". A token read inside a rule whose selector never
 *    matches, or behind a flag nobody turns on, passes here. Only an eyeball
 *    settles that.
 *  - Leg B walks `PREFERENCES_TREE`, which is not the only labelled-control
 *    surface — `FontsDialog` renders its own rows. Those rows are covered
 *    only INDIRECTLY: every prefs control surface is excluded from channel 3
 *    (see `DECLARATION_FILES`), so a Fonts-dialog pref that reaches nothing
 *    falls to leg C as an orphan rather than to leg B as an inert control.
 *    The diagnosis it prints is therefore right about the fact and vague
 *    about the row. Folding a second surface into leg B needs that surface to
 *    become DATA first; JSX rows are not enumerable.
 *  - `perturb` has no boolean/enum arm because `EditorPreferences` has no
 *    boolean today (16 numbers, 49 strings, 3 nullable families). If one
 *    lands, `perturb(true)` returns a truthy string, so a `p.flag ? A : B`
 *    compute would report NO dependency. That fails toward a false ACCUSATION
 *    (red CI, someone looks) rather than a false exoneration — the safe
 *    direction — but give it a real arm when the first boolean pref lands.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every stylesheet the app ships. `globals.css` `@import`s the library one. */
const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"] as const;

/**
 * The files that DECLARE or OFFER the preference vocabulary. Naming a key in
 * one of them is a declaration, not a consumption, so channel 3 must not read
 * them — **a file that renders the control is not a witness that the control
 * works.** That is the whole defect class: an inert picker's own dialog names
 * its key, and a bare-name grep would exonerate it off exactly the surface
 * whose emptiness is the bug.
 *
 * The set is the two vocabulary files plus every prefs CONTROL SURFACE (the
 * files typed over `keyof EditorPreferences` with an `onUpdate`). That second
 * group matters because `PREFERENCES_TREE` is NOT the only labelled-control
 * surface: `FontsDialog` renders its own `<FieldRow label="…">` rows bound
 * straight to prefs, outside the tree entirely — so leg B cannot see them and,
 * before this exclusion, leg C could not either. With them excluded, a new
 * Fonts-dialog pref that reaches no token is caught as an ORPHAN by leg C.
 *
 * Verified to be a pure tightening when it landed: excluding all five (task 495
 * retired one of them with the preference-mode picker, leaving four) changes
 * the inert set by nothing (every real font pref reaches pixels through its
 * own `--font-*` token or a derived one), so it adds no false accusation.
 */
const DECLARATION_FILES = new Set([
  // Vocabulary.
  "src/lib/preferences-tree.ts",
  "src/hooks/usePreferences.ts",
  // Control surfaces — they OFFER prefs, they do not consume them. Their live
  // previews do paint the value, which is precisely the illusion an inert
  // control trades on.
  "src/components/FontsDialog.tsx",
  "src/components/PreferencesModal.tsx",
  "src/components/PreferenceTree.tsx",
  "src/components/SmartPreferences.tsx",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-preview",
  ".next-preview-dev",
  ".next-preview-audit",
  ".git",
  ".claude",
  "virgil-data",
  "library-data",
  "samples",
  "dist",
  "build",
  "out",
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

const SOURCE_FILES = [...walkSource("src"), ...walkSource("library")];

/** Comments stripped, STRING LITERALS KEPT — every `var()` in a `.tsx` lives
 *  inside a quoted style value, so blanking literals would empty the census
 *  (the same choice `phantom-css-var` makes, for the same reason). */
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ...STYLESHEETS.map((f) => [f, cssCommentsStripped(read(f))] as const),
  ...SOURCE_FILES.map((f) => [f, commentsStripped(read(f))] as const),
];

// ── Channel 1: which tokens are READ ────────────────────────────────────────

const readSites = new Map<string, string[]>();
for (const [file, text] of SOURCES) {
  text.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {
      const at = readSites.get(m[1]) ?? [];
      at.push(`${file}:${i + 1}`);
      readSites.set(m[1], at);
    }
  });
}
const isRead = (token: string) => readSites.has(token);

// ── Channel 2: which preferences each DERIVED token depends on ──────────────

/**
 * A value the compute will treat as different but not choke on. Colors get a
 * different hex (`deriveLight`/`hexToRgba` parse them), numbers get +1,
 * strings get a suffix, and a null family field gets a name — the `?? fallback`
 * shape in the maketitle/headers/par-title rows means BOTH the nullable field
 * and its fallback pref are real dependencies, and this probe finds both.
 */
function perturb(value: unknown): unknown {
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") {
    if (/^#[0-9a-f]{3,8}$/i.test(value))
      return value.toLowerCase() === "#123456" ? "#654321" : "#123456";
    return `${value} Zz`;
  }
  return "Zz Probe Face";
}

/** cssVar → the pref keys whose value demonstrably moves it. */
const derivedDeps = new Map<string, Set<string>>();
for (const row of DERIVED_CSS) {
  const base = row.compute(DEFAULT_PREFS);
  const deps = new Set<string>();
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof EditorPreferences)[]) {
    const probe = { ...DEFAULT_PREFS, [key]: perturb(DEFAULT_PREFS[key]) } as EditorPreferences;
    try {
      if (row.compute(probe) !== base) deps.add(key);
    } catch {
      // A compute that THROWS on the probe value read the key to choke on it.
      deps.add(key);
    }
  }
  derivedDeps.set(row.cssVar, deps);
}

// ── Channel 3: a production TS/TSX consumer names the key ───────────────────

const jsConsumers = new Map<string, string[]>();
for (const [file, text] of SOURCES) {
  if (STYLESHEETS.includes(file as (typeof STYLESHEETS)[number])) continue;
  if (DECLARATION_FILES.has(file)) continue;
  for (const key of Object.keys(DEFAULT_PREFS)) {
    // `[^\w-]` boundaries, not `\b`: a `\b` match fires INSIDE a kebab token
    // (`var(--foreground)` would report the `foreground` pref consumed by
    // JS), which would let a dead control hide behind a same-named CSS token.
    if (new RegExp(`(?<![\\w-])${key}(?![\\w-])`).test(text)) {
      const at = jsConsumers.get(key) ?? [];
      at.push(file);
      jsConsumers.set(key, at);
    }
  }
}

// ── The resolved question, per preference key ───────────────────────────────

const ownVar = new Map<string, string>(PREF_TO_CSS.map((e) => [e.key as string, e.cssVar]));

function reachesPixels(key: string): boolean {
  const own = ownVar.get(key);
  if (own && isRead(own)) return true;
  for (const [cssVar, deps] of derivedDeps) if (deps.has(key) && isRead(cssVar)) return true;
  return jsConsumers.has(key);
}

function leaves(nodes: PrefNode[], out: PrefLeaf[] = []): PrefLeaf[] {
  for (const n of nodes) {
    if (isLeaf(n)) out.push(n);
    else leaves(n.children, out);
  }
  return out;
}
const LEAVES = leaves(PREFERENCES_TREE);

// ── Leg A: every preference token has a reader ──────────────────────────────

/**
 * Tokens `EditorLayout` writes onto `:root` that nothing reads back. Each
 * entry states what IS true of it — where the surface it names actually takes
 * its value from — rather than a guess at why it was left. The set may only
 * SHRINK: wire it, or delete the declaration (interface + defaults + tree row +
 * PREF_TO_CSS + dev-prefs-registry + both `globals.css` seeds), which is what
 * task 326 did to `--math-prefix-color`.
 *
 * Every entry here is PRE-EXISTING — surfaced by this census on its first run,
 * recorded rather than swept, and none of them is what task 326 set out to fix.
 */
const PERMITTED_UNREAD_PREF_TOKENS: Readonly<Record<string, string>> = {
  "--tab-bg":
    "no reader and no dialog row; the tab strip paints from --main-tab-bg (aliased to --background) and --topbar-bg",
  "--comment-color":
    "the Comments 'Highlight color' row paints through the DERIVED --comment-bg (.commented-text background-color, globals.css:4274); this base ink token has no reader",
  "--comment-border":
    "derived comment border tint with no reader — the commented-text mark paints fill only",
  "--mark-bg":
    "Suggestions 'Mark background' row; suggestion text is painted by the --link-anchor-accent-* family instead, which panel colors theme",
  "--mark-border":
    "Suggestions 'Mark border' row; same as --mark-bg — the anchor-accent family owns that chrome",
  "--panel-header-size":
    "Panels 'Header size' slider; .panel-header-title takes color + font-family from prefs and its size from the .panel-container --panel-font-size inheritance",
  "--font-display-override":
    "Fonts 'Display' picker; the display face is reached as the bare next/font var --font-display (panel-typography.ts), which skips the override rung the sans/serif/mono chains have",
  "--font-logo-override":
    "Fonts 'Logo' picker; same shape as --font-display-override — the Cinzel stack reads the bare --font-logo",
};

describe("every preference token has a reader", () => {
  it("the set of unread PREF_TO_CSS / DERIVED_CSS tokens is exactly the recorded one", () => {
    const declared = [
      ...PREF_TO_CSS.map((e) => e.cssVar),
      ...DERIVED_CSS.map((e) => e.cssVar),
    ];
    const unread = [...new Set(declared.filter((t) => !isRead(t)))].sort();
    expect(
      unread,
      "A preference token nothing reads is a control that cannot work: the " +
        "pref writes it onto :root on every change and no pixel consults it. " +
        "Give it a reader, or delete the declaration everywhere it is spelled. " +
        "This list may only shrink.",
    ).toEqual(Object.keys(PERMITTED_UNREAD_PREF_TOKENS).sort());
  });

  it("every recorded token states a reason", () => {
    // A length floor pins the SHAPE of the obligation, never its honesty — an
    // inaccurate reason passes exactly as a true one does. Read each against
    // the code before trusting it (the sibling phantom census learned this the
    // hard way: its heading-registry reason said "h1–h4" for a registry that
    // covers h1–h3).
    for (const [token, why] of Object.entries(PERMITTED_UNREAD_PREF_TOKENS)) {
      expect(why.length, `${token} needs a stated reason, not an empty string`).toBeGreaterThan(20);
    }
  });
});

// ── Leg B: every labelled control moves a pixel ─────────────────────────────

/**
 * Dialog rows that change nothing. Each is a token from leg A wearing its
 * user-facing name — the difference is that leg A would also flag a dead token
 * behind a WORKING control (`--comment-color`), while a hit here is a control
 * the user can operate that does nothing at all.
 *
 * All five are pre-existing and each needs a VISUAL decision (which element
 * takes the value), not a mechanical wiring — the reason they are recorded
 * here rather than fixed alongside the math pref, whose consumer was
 * unambiguous. Shrink-only.
 */
const PERMITTED_INERT_CONTROLS: Readonly<Record<string, string>> = {
  markBackground: "Suggestions › Mark background — see --mark-bg above",
  markBorder: "Suggestions › Mark border — see --mark-border above",
  panelHeaderSize: "Panels › Header size — see --panel-header-size above",
  fontDisplay: "Global Font Families › Display — see --font-display-override above",
  fontLogo: "Global Font Families › Logo — see --font-logo-override above",
};

describe("every labelled preference control moves a pixel", () => {
  it("the set of inert dialog rows is exactly the recorded one", () => {
    const inert = LEAVES.filter((l) => !reachesPixels(l.key as string))
      .map((l) => l.key as string)
      .sort();
    expect(
      inert,
      "A Preferences row whose value reaches no CSS token and no code is a " +
        "control that does nothing — the user changes it and watches the app " +
        "stay put. Wire it, or retire the row. This list may only shrink.",
    ).toEqual(Object.keys(PERMITTED_INERT_CONTROLS).sort());
  });

  it("every recorded inert control states which row it is", () => {
    for (const [key, why] of Object.entries(PERMITTED_INERT_CONTROLS)) {
      expect(why.length, `${key} needs a stated reason`).toBeGreaterThan(20);
      expect(
        LEAVES.some((l) => l.key === key),
        `${key} is recorded as an inert dialog row but has no row in PREFERENCES_TREE — ` +
          "delete the entry (or the census is reading the wrong tree)",
      ).toBe(true);
    }
  });
});

// ── Leg C: a shipped default is a preference, not a leftover ────────────────

/**
 * The DURABILITY half, and the reason leg A alone would not have held.
 *
 * `usePreferences.defaults.json` is not hand-maintained: `promote-defaults.mjs`
 * folds Gabriel's mirrored localStorage blob into it on a Tue/Fri cron that
 * commits and pushes to main with a `JSON.parse` gate and no tests. His blob is
 * written by `loadPrefs`'s `{ ...DEFAULT_PREFS, ...JSON.parse(raw) }` and
 * re-serialized whole, so a preference retired from the interface is never
 * pruned from his storage — and before task 326 the promoter copied EVERY
 * snapshot key, which resurrected the retired key in the shipped defaults.
 * Proof it happens: `aiMarkerText`/`aiMarkerBg`/`aiMarkerBorder` were retired
 * in `1c0c52be` and back in the JSON the next day (`ffa7dfe0`), where they sat
 * unread for two months. `check-prefs-coverage` asserts interface ⊆ defaults
 * and so is blind to an EXTRA key by construction; this is that other
 * direction, expressed the way this census already asks its question.
 *
 * The mechanism fix is `applyAll` ignoring keys the target does not declare.
 * This leg is the net under it — and the allowlist is EMPTY, because there is
 * no true statement of the form "this shipped default is meant to reach
 * nothing." A hit is DELETE-it.
 */
describe("every shipped default is a preference something consumes", () => {
  it("no key in usePreferences.defaults.json is an orphan", () => {
    const declaredRows = new Set(PREF_TO_CSS.map((e) => e.key as string));
    const leafKeys = new Set(LEAVES.map((l) => l.key as string));
    const orphans = Object.keys(DEFAULT_PREFS).filter(
      (key) =>
        !declaredRows.has(key) &&
        !leafKeys.has(key) &&
        ![...derivedDeps.values()].some((deps) => deps.has(key)) &&
        !jsConsumers.has(key),
    );
    expect(
      orphans,
      "A shipped default that no PREF_TO_CSS row, no DERIVED_CSS compute, no " +
        "dialog row and no code reads is a leftover — most likely a retired " +
        "preference the promote-defaults cron copied back out of Gabriel's " +
        "localStorage. Delete it from usePreferences.defaults.json.",
    ).toEqual([]);
  });
});

// ── The math prefs specifically: one wired, one retired ─────────────────────

describe("rendered math takes the user's ink", () => {
  it("--math-color is read by the rule that paints KaTeX", () => {
    const css = cssCommentsStripped(read("src/app/globals.css"));
    // The declaration must sit on a selector that reaches BOTH math surfaces:
    // KaTeX sets `color` on nothing of its own, so the wrapper's color is what
    // every glyph inherits.
    const rule = css
      .split("}")
      .find((block) => /\.inline-math\b/.test(block) && /var\(\s*--math-color/.test(block));
    expect(
      rule,
      "No rule paints `.inline-math` from var(--math-color) — the Editor › " +
        "Code & Math 'Math text color' picker is inert again (task 326).",
    ).toBeTruthy();
    expect(rule).toMatch(/\.display-math\b/);
  });

  it("mathColor is a live control by the census's own reckoning", () => {
    expect(reachesPixels("mathColor")).toBe(true);
    expect(LEAVES.some((l) => l.key === "mathColor")).toBe(true);
  });

  it("the retired mathPrefixColor is gone from every declaration site", () => {
    // KaTeX runs with `output: "html"` (src/lib/tiptap/math.ts), so no `$`
    // delimiter survives into the DOM: there is no element the pref could ever
    // have painted. Retiring beats leaving a labelled picker that cannot work.
    // Comments are stripped, so the prose that RECORDS the retirement (in
    // globals.css and usePreferences.ts) does not fail this leg.
    const hits: string[] = [];
    for (const [file, text] of SOURCES) {
      text.split("\n").forEach((lineText, i) => {
        if (/mathPrefixColor|--math-prefix-color/.test(lineText))
          hits.push(`${file}:${i + 1}`);
      });
    }
    // The JSON declaration sites the source walk cannot see.
    for (const rel of [
      "src/hooks/usePreferences.defaults.json",
      "src/lib/dev-prefs-registry.json",
    ])
      if (/mathPrefixColor|--math-prefix-color/.test(read(rel))) hits.push(rel);
    expect(hits, "mathPrefixColor was retired in task 326 — re-add it only WITH a reader").toEqual(
      [],
    );
  });
});

// ── Self-checks: a blind census passes every assertion above ────────────────

describe("the census can see", () => {
  it("reads real files, real tokens and real reads", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(200);
    expect(PREF_TO_CSS.length).toBeGreaterThan(50);
    expect(DERIVED_CSS.length).toBeGreaterThan(10);
    expect(readSites.size).toBeGreaterThan(150);
    expect(LEAVES.length).toBeGreaterThan(40);
  });

  it("would catch a planted token, and sees the live ones", () => {
    expect(isRead("--definitely-not-a-token-xyz")).toBe(false);
    expect(isRead("--citation-color")).toBe(true);
    expect(isRead("--comment-bg")).toBe(true); // the channel-2 target
  });

  it("the perturbation probe finds real dependencies and invents none", () => {
    // `--comment-bg` is `hexToRgba(commentColor, .25)` — the dependency leg B
    // rests on for the Comments row, and a probe that found nothing would
    // silently widen the inert list rather than fail.
    expect(derivedDeps.get("--comment-bg")).toContain("commentColor");
    expect(derivedDeps.get("--comment-bg")).not.toContain("citationColor");
    // `--citation-bg` computes a constant: no pref moves it, and saying so is
    // how the probe proves it is not just marking everything a dependency.
    // RE-ANCHOR, don't delete, if this goes red: deriving the citation chip's
    // fill from the user's ink is the shape task 194 holds up as correct, so a
    // legitimate change lands here. Swap in any other pref-independent
    // DERIVED_CSS row — the leg's job is only to show the probe can answer
    // "nothing moves this", not to freeze which token that is.
    expect([...(derivedDeps.get("--citation-bg") ?? [])]).toEqual([]);
    // The `?? fallback` shape resolves BOTH sides.
    const headers = derivedDeps.get("--font-headers-family");
    expect(headers).toContain("fontHeadersFamily");
    expect(headers).toContain("fontSerif");
  });

  it("channel 3 sees a JS-only consumer, and does not read a kebab token as one", () => {
    // `editorFontSize` has a token AND a direct read in EditorLayout; the
    // channel is what keeps a future token-less pref from being accused.
    expect(jsConsumers.has("editorFontSize")).toBe(true);
    expect(jsConsumers.has("mathPrefixColor")).toBe(false); // retired
    // The boundary that matters: `foreground` is spelled all over the app as
    // `var(--foreground)` / `text-foreground`, and none of that is a read of
    // the PREF. Under `\b` boundaries it would report four phantom consumers,
    // which is how a dead control hides behind a same-named token. (The pref
    // is alive regardless — through its own token, channel 1.)
    // RE-ANCHOR, don't delete, if this goes red: the first legitimate
    // `prefs.foreground` read in either silo makes the pref a real channel-3
    // consumer. Pick another pref whose name collides with a kebab token and
    // has no JS reader — the leg pins the BOUNDARY rule, not this key.
    expect(jsConsumers.has("foreground")).toBe(false);
    expect(isRead("--foreground")).toBe(true);
  });

  it("the comment stripper did not swallow the stylesheets", () => {
    // The 202b runaway: a bad stripper empties its input and every census
    // above reports green. Count DECLARATIONS, the thing this consumes.
    const count = (css: string) => [...css.matchAll(/(--[A-Za-z][\w-]*)\s*:/g)].length;
    for (const f of STYLESHEETS) {
      const raw = read(f);
      const kept = count(cssCommentsStripped(raw));
      expect(kept, `${f} lost its declarations to the stripper`).toBeGreaterThan(count(raw) * 0.8);
      expect(kept, `${f} stripped to nothing`).toBeGreaterThan(10);
    }
  });

  it("the CSS stripper keeps line numbers honest", () => {
    const stripped = cssCommentsStripped("a {}\n/* two\nline */\nb {}\n");
    expect(stripped.split("\n").length).toBe(5);
    expect(stripped).not.toContain("two");
  });
});
