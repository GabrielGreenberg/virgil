import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PANEL EMPTY-STATE CONTRACT — the guide describes what ships, and the shape
 * it describes is enforced (task 2026-07-18-184).
 *
 * The bug class is the third one this `src/__tests__` family covers, and the
 * only one about STRUCTURE rather than values. `token-contract.test.ts` locks
 * the guide's token *numbers* to `globals.css`; `spec-authority-guardrail.ts`
 * locks which document *is* the spec. Neither can see a sentence that asserts
 * a whole composition that was never built.
 *
 * What happened: `docs/virgil-design-system/06-panels-and-headers.md` carried
 * an explicit TODO — "the current empty state ('No items yet' or similar) is
 * not enough. Each panel teaches itself." A design brief, in the TODO voice.
 * Condensing it into `src/STYLE_GUIDE.md` dropped the "is not enough" framing
 * and rewrote it in the indicative: "Every panel has a designed empty state —
 * icon, title sentence, description, optional example card." No panel does
 * this; there is no `EmptyState` component in either silo; and twenty lines
 * later the same guide lists empty-state design under "What this guide does
 * not cover." So the one live spec both mandated a composition and disclaimed
 * it, and nothing failed — an agent reading it either hunts for a primitive
 * that isn't there, or "restores" compliance by inventing a fourteenth
 * pattern.
 *
 * Nothing here is a product decision: the richer composition stays an open
 * question in §"What this guide does not cover". What is pinned is only what
 * the code already does, in the three ways it can silently stop doing it.
 *
 *   1. CLASS      the class string the guide quotes IS `PANEL.empty`, and no
 *                 surface hand-rolls a twin of it. (The live defect: two
 *                 `OutlinePanel` sites carried a REORDERED byte-copy —
 *                 identical today, silently desynced the moment the token
 *                 moves.)
 *   2. ROUTING    every `emptyState` slot renders through `PANEL.empty`.
 *   3. COPY       a panel that is GENUINELY empty names what's missing and
 *                 teaches the way in. A filter/search miss is exempt — nothing
 *                 is missing, and the way forward is the query the user has.
 *
 * Leg 3 is the one the guide's prose is really about, and the reason it is
 * scoped to "at least one branch teaches" rather than "every branch": several
 * slots are a ternary whose other arms ARE the exempt filter/search misses
 * ("No matches found.", "All errors dismissed."). Demanding a how-to there
 * would be demanding a lie.
 *
 *   4. ABSENCE   the richer composition the guide says is NOT shipped stays
 *                un-shipped — no `EmptyState` component, no icon in an empty
 *                body. If someone builds it, this leg fails, and the right
 *                repair is to update the guide. That is the same claim read
 *                backwards, and it is the leg that makes "not shipped, and an
 *                open product question" a fact rather than a promise.
 *
 * The copy census is the SLOTS **and** the direct `PANEL.empty` renderers
 * (Outline, Search) — the guide names both, so a guard that read only the
 * slots would leave the guide asserting more than the code guarantees, which
 * is verbatim the defect this file exists to close. Adversarial review caught
 * exactly that in the first cut of this fix.
 *
 * What NO census can reach, stated plainly: whether a teaching sentence is
 * TRUE. Outline's copy read "Use the Section dropdown in the toolbar to add
 * headings" — a control that does not exist (headings live in the ¶ Block type
 * menu inside the lightning-bolt panel, and `\section` typed in the editor) —
 * and it satisfied every mechanical shape of `teaches`. A regex pins the SHAPE
 * of a how-to; only a reader pins whether it is honest.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, ".."); // src/
const LIBRARY = path.resolve(HERE, "../../library"); // the Library silo
const STYLE_GUIDE = path.join(SRC, "STYLE_GUIDE.md");
const PANEL_PRIMITIVES = path.join(SRC, "components/panel-primitives.tsx");

/**
 * Files permitted to spell a centered-muted block out by hand. `PANEL.empty`'s
 * OWNER, plus the surfaces that are not panel pods and carry their own tone —
 * each with the reason it is not a twin. A card panel NEVER qualifies: the fix
 * there is to import `PANEL`, not to add an entry.
 */
const PERMITTED_EMPTY_CLASS_SPELLERS = [
  // The owner. Every other entry below is measured against this declaration.
  "components/panel-primitives.tsx",
  // The omni RAIL, not a panel pod: a filter line ("no item types selected")
  // over the marginalia rail, deliberately text-xs against the rail's tone.
  "panels/Omni/OmniViewPanel.tsx",
  // A menu filter miss inside the font picker popup — a menu row's tone, not a
  // panel body's.
  "components/FontPicker.tsx",
  // The AI window is a floating surface with its own chrome, not a panel pod.
  "components/AIWindow.tsx",
  // A picker-menu empty line at [11px] — same menu-tone reason as FontPicker.
  "components/library/BibEntryPickerMenu.tsx",
];

/** Deliberately EMPTY: the Library silo renders no Virgil card panels. */
const PERMITTED_LIBRARY_EMPTY_CLASS_SPELLERS: string[] = [];

/**
 * Direct `PANEL.empty` renderers exempt from the TEACHING half, by the guide's
 * own filter/search carve-out. Keyed on the copy itself, so rewording forces a
 * fresh look rather than inheriting an exemption.
 */
const EXEMPT_FROM_TEACHING: { file: string; copy: string; why: string }[] = [
  {
    file: "panels/Search/SearchPanel.tsx",
    copy: "Type to search your document.",
    why: "no query yet — nothing is missing, and the way in IS the query about to be typed",
  },
  {
    file: "panels/Search/SearchPanel.tsx",
    copy: "No matches found.",
    why: "a search miss — the way forward is the query the user already has",
  },
  {
    file: "panels/Search/SearchPanel.tsx",
    copy: "Showing the first",
    why: "not an empty state at all — an informational note sitting BELOW live results",
  },
];

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "__fixtures__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkSource(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (root: string, f: string) =>
  path.relative(root, f).split(path.sep).join("/");

/** `PANEL.empty` as code ships it — the one truth every leg below is stated against. */
const PANEL_EMPTY_CLASS = (() => {
  const m = readFileSync(PANEL_PRIMITIVES, "utf8").match(/\bempty:\s*"([^"]+)"/);
  if (!m) throw new Error("panel-primitives.tsx no longer declares PANEL.empty");
  return m[1].trim();
})();

const guide = readFileSync(STYLE_GUIDE, "utf8");

// ── Leg 1: the class ────────────────────────────────────────────────────────

describe("the empty-state class has one speller", () => {
  it("the guide quotes the class string code actually ships", () => {
    expect(
      guide,
      `STYLE_GUIDE.md must quote \`${PANEL_EMPTY_CLASS}\` — code is the truth, ` +
        "so fix the DOC, never the code.",
    ).toContain(`\`${PANEL_EMPTY_CLASS}\``);
  });

  it.each([
    ["src", SRC, PERMITTED_EMPTY_CLASS_SPELLERS],
    ["library", LIBRARY, PERMITTED_LIBRARY_EMPTY_CLASS_SPELLERS],
  ] as const)("no %s file hand-rolls a twin of it", (_label, root, permitted) => {
    // Signal is the SHAPE, not the byte string. The live defect was a reordered
    // copy ("p-6 text-center text-[var(--muted)] text-sm"), which a substring
    // match reads as absent — and a `p-6`-keyed detector is blind to the same
    // block spelled "px-3 py-6". So: centered AND muted, in any spelling, is
    // the empty-state shape.
    const flagged = walkSource(root)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].some((m) => {
          const cls = m[1] ?? m[2] ?? "";
          return (
            /\btext-center\b/.test(cls) &&
            /text-ink-muted|text-muted|text-\[var\(--muted\)\]/.test(cls)
          );
        });
      })
      .map((f) => rel(root, f))
      .sort();
    expect(
      flagged,
      "Import PANEL and use `PANEL.empty`. A second copy of the class string " +
        "renders identically today and desyncs silently on the next retone. " +
        "Only a non-panel surface with its own tone earns an allowlist entry.",
    ).toEqual([...permitted].sort());
  });
});

// ── Slot extraction, shared by legs 2 and 3 ─────────────────────────────────

/** The balanced `{…}` following `emptyState=`, string- and comment-aware. */
function readSlotExpression(src: string, from: number): SlotRange | null {
  let i = src.indexOf("{", from);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
    } else if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) return null;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
      if (i < 1) return null;
    } else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return { body: src.slice(start + 1, i), start, end: i };
    }
    i += 1;
  }
  return null;
}

interface SlotRange {
  body: string;
  start: number;
  end: number;
}

interface Slot {
  file: string;
  body: string;
  /**
   * A slot is one EXPRESSION and its branches are read together ("at least one
   * teaches"); a direct render is one ELEMENT and answers for itself.
   */
  grouped: boolean;
}

function slotRangesIn(src: string): SlotRange[] {
  return [...src.matchAll(/\bemptyState=/g)]
    .map((m) => readSlotExpression(src, m.index + m[0].length))
    .filter((r): r is SlotRange => r !== null);
}

function emptyStateSlots(root: string): Slot[] {
  const slots: Slot[] = [];
  for (const f of walkSource(root)) {
    // Skip the prop DECLARATION and the destructure in CardListPanel itself.
    for (const r of slotRangesIn(readFileSync(f, "utf8"))) {
      slots.push({ file: rel(root, f), body: r.body, grouped: true });
    }
  }
  return slots;
}

/** The children of the JSX element opened at `from`, matching `</tag>` by depth. */
function elementBody(src: string, tag: string, from: number): string {
  const open = new RegExp(`<${tag}[\\s/>]`, "g");
  const close = new RegExp(`</${tag}\\s*>`, "g");
  let depth = 1;
  let i = from;
  while (i < src.length) {
    open.lastIndex = i;
    close.lastIndex = i;
    const o = open.exec(src);
    const c = close.exec(src);
    if (!c) break;
    if (o && o.index < c.index) {
      depth += 1;
      i = o.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return src.slice(from, c.index);
    i = c.index + 1;
  }
  return src.slice(from);
}

/**
 * Panels that render their own body rather than filling `CardListPanel`'s slot
 * — Outline and Search today. The guide names them, so the copy contract has to
 * reach them; a slot-only census would leave the guide over-claiming again.
 * Sites INSIDE a slot are skipped here — the slot already answers for them, as
 * a group, which is what lets a filter-miss branch sit beside a teaching one.
 */
function directEmptyStates(root: string): Slot[] {
  const out: Slot[] = [];
  for (const f of walkSource(root)) {
    const src = readFileSync(f, "utf8");
    const slots = slotRangesIn(src);
    for (const m of src.matchAll(/<([A-Za-z][\w.]*)[^>]*?className=\{PANEL\.empty\}/g)) {
      const at = m.index;
      if (slots.some((r) => at > r.start && at < r.end)) continue;
      const openEnd = src.indexOf(">", at + m[0].length);
      if (openEnd < 0) continue;
      const body = src[openEnd - 1] === "/" ? "" : elementBody(src, m[1], openEnd + 1);
      out.push({ file: rel(root, f), body, grouped: false });
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#\d+;/g, " ");
}

/**
 * Does the literal starting at `at` sit in an attribute slot — `x="…"` or
 * `x={"…"}`? Walk back over whitespace, then over one optional `{`, and ask
 * whether the char before it is `=`.
 */
function isAttributeValue(src: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(src[i])) i -= 1;
  if (src[i] === "{") {
    i -= 1;
    while (i >= 0 && /\s/.test(src[i])) i -= 1;
  }
  return src[i] === "=";
}

/**
 * Resolve JSX expression containers, innermost first. A container holding
 * nothing but a string literal is COPY — including the `{" "}` glue JSX forces
 * between a word and a following tag — so its text stays INLINE; splitting a
 * sentence at its own space would read "No citations yet. Type" and
 * "in the editor to add one." as two bare fragments. Every other container is
 * code, and becomes a unit boundary.
 */
function resolveInterpolations(body: string): string {
  let out = body;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(/\{([^{}]*)\}/g, (_all, inner: string) => {
      const literal = inner.trim().match(/^"([^"\n]*)"$|^'([^'\n]*)'$|^`([^`]*)`$/);
      return literal ? (literal[1] ?? literal[2] ?? literal[3] ?? "") : "\n";
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The human-readable COPY units in a slot: every string/template literal, plus
 * every JSX text node. Tags and code-bearing interpolations become unit
 * boundaries (rather than being deleted) so a sentence can never be stitched
 * together across two branches of a ternary — which would let a bare "No items
 * yet." pass on its neighbour's prose. Anything still carrying code
 * punctuation is dropped, since a JS condition sitting between two JSX
 * elements survives the tag strip.
 *
 * The literal pass reads the RAW body, before interpolations are resolved, so
 * copy that lives INSIDE an expression container — `{filtered ? "…" : "…"}` —
 * survives as its own unit rather than being erased with its container. It
 * skips ATTRIBUTE values (`className=…`, `title=…`), which are not copy: a
 * `title="Add a note. Click +"` sitting beside a bare "No notes yet." would
 * otherwise satisfy the teaching leg on the empty state's behalf.
 */
function copyUnits(body: string): string[] {
  const units: string[] = [];
  for (const m of body.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    if (isAttributeValue(body, m.index)) continue;
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    units.push(raw.replace(/\$\{[^}]*\}/g, " "));
  }
  const text = resolveInterpolations(
    body.replace(/\/\/[^\n]*/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "\n"),
  ).replace(/<[^>]*>/g, "\n");
  units.push(...text.split("\n"));
  return units
    .map((u) => decodeEntities(u).replace(/\s+/g, " ").trim())
    .filter((u) => u.length > 0 && !/[{}()=<>]/.test(u) && /\p{L}{3}/u.test(u));
}

/** Names what's missing AND teaches: a sentence break with prose after it. */
const teaches = (unit: string) => /[.!?]\s+\p{L}/u.test(unit);

const SLOTS = emptyStateSlots(SRC).filter(
  // CardListPanel is the slot's HOST — its `emptyState` occurrences are the
  // prop type, the destructure and the render, not an empty state.
  (s) => !s.file.endsWith("panels/_shared/CardListPanel.tsx"),
);

const DIRECT = directEmptyStates(SRC);

/** Every empty state the guide's copy contract speaks about — both carriers. */
const EMPTY_STATES = [...SLOTS, ...DIRECT];

const label = (s: Slot) =>
  `${s.file}${s.grouped ? "" : ` [${copyUnits(s.body)[0]?.slice(0, 40) ?? "?"}]`}`;

const exemption = (s: Slot) =>
  s.grouped
    ? undefined
    : EXEMPT_FROM_TEACHING.find(
        (e) => s.file === e.file && copyUnits(s.body).some((u) => u.startsWith(e.copy)),
      );

// ── Legs 2 and 3: routing and copy ──────────────────────────────────────────

describe("every panel empty state routes through PANEL.empty", () => {
  it("finds the panel census (a census that finds nothing proves nothing)", () => {
    // Floor, not an exact count: a new panel should not have to edit this
    // guard, but a refactor that silently empties the census must fail here
    // rather than pass every leg below vacuously.
    expect(SLOTS.length).toBeGreaterThanOrEqual(10);
    // The direct renderers the guide names by hand. Zero here means the
    // extractor broke, not that Outline and Search stopped rendering.
    expect(DIRECT.length).toBeGreaterThanOrEqual(4);
  });

  it.each(SLOTS.map((s) => [s.file, s] as const))(
    "%s renders its empty state with PANEL.empty",
    (_file, slot) => {
      expect(slot.body).toContain("PANEL.empty");
    },
  );
});

describe("an empty panel teaches the way in", () => {
  it.each(EMPTY_STATES.map((s) => [label(s), s] as const))(
    "%s names what's missing and how to add one",
    (name, slot) => {
      if (exemption(slot)) return; // filter/search miss — the guide's carve-out
      const units = copyUnits(slot.body);
      expect(
        units.some(teaches),
        `${name}: ${
          slot.grouped
            ? "every branch of this empty state is a bare sentence. At least the " +
              "genuinely-empty branch must also teach the way in"
            : "this empty state names the absence and teaches nothing"
        } — "No examples. Click the (1) glyph in the formatting toolbar to insert ` +
          'one." A filter/search miss is exempt; say so in EXEMPT_FROM_TEACHING ' +
          "with the reason nothing is missing.\n" +
          `copy read: ${JSON.stringify(units)}`,
      ).toBe(true);
    },
  );

  it("every teaching exemption is still claimed by a live empty state", () => {
    // A stale exemption is an unpinned empty state wearing a pin's clothes.
    const unclaimed = EXEMPT_FROM_TEACHING.filter(
      (e) => !DIRECT.some((s) => exemption(s) === e),
    ).map((e) => `${e.file}: ${e.copy}`);
    expect(unclaimed, "delete the entry, or restore the copy it names").toEqual([]);
  });
});

// ── Leg 4: the richer composition is genuinely NOT shipped ──────────────────

describe("the design the guide declines to specify stays unbuilt", () => {
  it.each([
    ["src", SRC],
    ["library", LIBRARY],
  ] as const)("no %s file declares an EmptyState component", (_label, root) => {
    const declarers = walkSource(root)
      .filter((f) => /\b(function|const|class)\s+EmptyState\b/.test(readFileSync(f, "utf8")))
      .map((f) => rel(root, f));
    expect(
      declarers,
      "If the richer empty state gets built, this leg is the RIGHT failure — " +
        "update STYLE_GUIDE.md's §Panels paragraph and its 'does not cover' " +
        "entry in the same commit, then retire this expectation.",
    ).toEqual([]);
  });

  it.each(EMPTY_STATES.map((s) => [label(s), s] as const))(
    "%s mounts no icon",
    (name, slot) => {
      const icons = [...slot.body.matchAll(/<(svg\b|[A-Z][\w.]*Icon\b)/g)].map((m) => m[1]);
      expect(icons, `${name}: the guide says empty states carry no icon`).toEqual([]);
    },
  );
});

// ── Self-check: the guard sees the shapes it claims to ──────────────────────

describe("the guard would catch what it was written for", () => {
  it("flags the reordered OutlinePanel literal that motivated it", () => {
    const before = '<div className="p-6 text-center text-[var(--muted)] text-sm">';
    expect([...before.matchAll(/"([^"\n]*)"/g)].some(
      (m) => /\bp-6\b/.test(m[1]) && /\btext-center\b/.test(m[1]),
    )).toBe(true);
  });

  it("reads a bare empty state as not teaching, and a real one as teaching", () => {
    expect(copyUnits('<div className={PANEL.empty}>No items yet.</div>').some(teaches)).toBe(
      false,
    );
    expect(
      copyUnits(
        '<div className={PANEL.empty}>No tasks yet. Click &quot;+&quot; to create one.</div>',
      ).some(teaches),
    ).toBe(true);
  });

  it("reads through the `{\" \"}` glue JSX forces before a tag", () => {
    // The live shape at CitationsPanel: the teaching half of the sentence ends
    // in the glue, so a guard that treats every `{…}` as a boundary calls a
    // panel that DOES teach a bare one.
    const glued =
      '<div className={PANEL.empty}>No citations yet. Type{" "}' +
      '<code className="text-xs px-1">\\cite</code>{" "}in the editor to add one.</div>';
    expect(copyUnits(glued).some(teaches)).toBe(true);
  });

  it("still treats a CODE interpolation as a boundary", () => {
    // `{count}` is not copy; a sentence must not be stitched through it.
    expect(
      copyUnits('<p className={PANEL.empty}>No notes.{renderHint()}Yet more.</p>').some(teaches),
    ).toBe(false);
  });

  it("does not let an ATTRIBUTE string teach on the copy's behalf", () => {
    // The hole this closes: every string literal in the slot was a copy unit,
    // so any prose-shaped attribute nearby satisfied the leg for a bare state.
    const bareWithChattyAttr =
      '<div className={PANEL.empty} title="Add a note. Click + to create one.">' +
      "No notes yet.</div>";
    expect(copyUnits(bareWithChattyAttr).some(teaches)).toBe(false);
  });

  it("keeps copy that lives inside an expression container", () => {
    expect(
      copyUnits(
        '<p className={PANEL.empty}>{filtered ? "No matches found." : ' +
          '"No todos yet. Click + to create one."}</p>',
      ).some(teaches),
    ).toBe(true);
  });

  it("does not stitch a sentence across two branches of a ternary", () => {
    // "All errors dismissed." + "No errors match the filter." must NOT read as
    // one teaching unit just because they sit in the same expression.
    const twoBareBranches =
      'a ? (<p className={PANEL.empty}>All errors dismissed.</p>) : ' +
      '(<p className={PANEL.empty}>No errors match the filter.</p>)';
    expect(copyUnits(twoBareBranches).some(teaches)).toBe(false);
  });
});
