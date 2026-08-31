// @vitest-environment jsdom
//
// Task 500 — a library entry's bib-auth state (and its processing tier) had
// THREE hand-written colour tables across two silos, and they disagreed. The
// worst of it was not a colour drift: `library-entry-status.tsx` collapsed
// `unverified` and `failed` into ONE switch branch labelled "Unverified", so
// the paper-side surface a user reads while writing could not tell *"nobody
// has tried to authenticate this"* from *"we tried and it FAILED"*.
//
// The two surfaces describe the SAME catalog row one tab apart, so what these
// legs assert is AGREEMENT between them — driven through the REAL components,
// because a table-only test passes on an implementation that resolves the tone
// correctly and then renders the old classes.
//
// jsdom resolves no CSS vars, so the tone is read back off the SPECIFIED
// inline style (`var(--pill-<tone>-…)`), which jsdom retains verbatim for both
// the shorthand `background` the pill writes and the longhands the chip does.
// That is the same value the browser resolves, so it is the real signal rather
// than a test-only marker.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  codeOnly,
  commentsStripped,
  swallowedLines,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

// Defensive: the status row pulls `open-library-entry`, which transitively
// reaches the `@/lib/storage` barrel (the known vitest resolver gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: () => noop });
});

import {
  BIB_STATES,
  INDEX_TIERS,
  bibStateTone,
  indexStateTier,
  indexTierTone,
  type Tone,
} from "@/lib/library/status-tone";
import { LibraryStatusRow } from "@/components/library/library-entry-status";
import { BibEntryPickerMenu } from "@/components/library/BibEntryPickerMenu";
import { BibPill, IndexedPill } from "@library/components/StatusPill";
import type { IndexedState } from "@library/lib/catalog";

afterEach(() => cleanup());

const TONES: readonly Tone[] = ["green", "amber", "red", "gray", "blue"];

/** The tone an element paints, read off its SPECIFIED inline style. */
function toneOf(el: Element | null): Tone | null {
  if (!el) return null;
  const style = el.getAttribute("style") ?? "";
  const m = /--pill-([a-z]+)-/.exec(style);
  return (m?.[1] as Tone) ?? null;
}

/** WCAG 2.x relative-luminance contrast ratio between two 6-digit hexes. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The paper-side auth chip for a state, or null when it renders none.
 *
 * `inLibrary` is TRUE so the ROW renders whatever the chip does — with it
 * false, `LibraryStatusRow` returns null for the whole row when there is no
 * chip and no tier, and the `none` leg below would then pass identically on an
 * implementation whose `verifiedChip` rendered a chip that the row swallowed.
 * The Open link the row adds carries no `data-hint`, so it cannot be mistaken
 * for the chip.
 */
function paperAuthChip(state: (typeof BIB_STATES)[number]) {
  const { container } = render(
    <LibraryStatusRow bibState={state} citekey="k" inLibrary />,
  );
  return container.querySelector("span[data-hint][aria-label]");
}

/** The paper-side tier chip for a tier. */
function paperTierChip(tier: (typeof INDEX_TIERS)[number]) {
  const { container } = render(
    <LibraryStatusRow indexTier={tier} citekey="k" inLibrary />,
  );
  return container.querySelector("span[data-hint][aria-label]");
}

/** The bib-entry PICKER's per-row auth pill — the surface the census found
 *  (it was never in the task's list of three): pre-500 it painted a two-way
 *  `verified ? emerald : amber` and labelled everything that was not
 *  `authenticated` "unverified", `failed` and `manuscript` included. */
function pickerAuthChip(state: (typeof BIB_STATES)[number]) {
  render(
    <BibEntryPickerMenu
      open
      anchorRect={new DOMRect(0, 0, 10, 10)}
      onClose={() => {}}
      entries={[{ key: "k1", type: "article", fields: { title: "T" } } as never]}
      onPick={() => "addable" as const}
      getLibraryItem={() => ({ id: "k1", status: "ready", bibState: state })}
    />,
  );
  // The picker portals, so query the document rather than the RTL container.
  // Selected by its ROLE in the row (a hinted status span), never by the inline
  // token the fix happens to write — a selector keyed on the mechanism returns
  // null under a neuter, and every leg that reads `chip?.textContent ?? ""`
  // then passes vacuously. Measured: the first draft did exactly that.
  const hinted = [...document.querySelectorAll("span[data-hint][aria-label]")];
  expect(hinted.length, "exactly one hinted status span per picker row").toBe(1);
  return hinted[0];
}

/** The Library-list pill for a bib state. */
function listBibPill(state: (typeof BIB_STATES)[number]) {
  const { container } = render(<BibPill state={state} />);
  return container.querySelector("span");
}

/** The Library-list pill for a raw catalog index state. */
function listIndexPill(state: IndexedState) {
  const { container } = render(<IndexedPill state={state} />);
  return container.querySelector("span");
}

describe("bib-auth state resolves ONE tone that both silos read", () => {
  it("the sweep crosses every state and every tone in the family", () => {
    // A sweep that only ever saw one tone would pass on a table that answers
    // the same colour for everything.
    expect(BIB_STATES.length).toBe(7);
    const seen = new Set(BIB_STATES.map((s) => bibStateTone(s)));
    expect([...seen].sort()).toEqual(["amber", "blue", "gray", "green", "red"]);
  });

  it.each(BIB_STATES)(
    "%s paints the same tone in the Bibliography panel and the Library list",
    (state) => {
      const expected = bibStateTone(state);
      expect(TONES).toContain(expected);

      const pill = listBibPill(state);
      expect(toneOf(pill), `Library list pill for ${state}`).toBe(expected);
      cleanup();

      const chip = paperAuthChip(state);
      if (state === "none") {
        // The one state the paper side deliberately renders nothing for: an
        // absence of any authentication attempt is not a badge. The list still
        // shows a gray "— bib" because its grid has a cell to fill, and the
        // PICKER shows "not authenticated" because its pill must say something
        // about every library-backed row — three surfaces, one tone table,
        // three legitimate answers to "should this be visible at all".
        expect(chip, "the `none` state renders no paper-side chip").toBeNull();
        const pickerNone = pickerAuthChip("none");
        expect(toneOf(pickerNone), "picker `none` tone").toBe(expected);
        expect(
          (pickerNone?.textContent ?? "").toLowerCase(),
          "`none` must not borrow the word `unverified` — under one tone table " +
            "that would be one word in two colours, which is the reported " +
            "defect wearing a fix's clothes",
        ).not.toContain("unverified");
        return;
      }
      expect(chip, `paper-side chip for ${state}`).not.toBeNull();
      expect(toneOf(chip), `paper-side chip tone for ${state}`).toBe(expected);
      cleanup();

      const picker = pickerAuthChip(state);
      expect(picker, `bib-picker chip for ${state}`).not.toBeNull();
      expect(toneOf(picker), `bib-picker chip tone for ${state}`).toBe(expected);
    },
  );

  it("`failed` and `unverified` are DISTINGUISHABLE on the paper side — tone AND label", () => {
    // The reported defect. Pre-500 both rendered the amber "Unverified" chip
    // from a shared `case`, so this leg fails on that tree in three ways.
    const failed = paperAuthChip("failed");
    const failedTone = toneOf(failed);
    const failedText = failed?.textContent ?? "";
    const failedAria = failed?.getAttribute("aria-label") ?? "";
    cleanup();
    const unverified = paperAuthChip("unverified");

    expect(failedTone).toBe("red");
    expect(toneOf(unverified)).toBe("amber");
    expect(failedTone).not.toBe(toneOf(unverified));
    expect(failedText).not.toBe(unverified?.textContent ?? "");
    expect(failedText.toLowerCase()).not.toContain("unverified");
    expect(failedAria).not.toBe(unverified?.getAttribute("aria-label"));
  });

  it("`failed` and `unverified` are DISTINGUISHABLE in the bib-entry picker too", () => {
    // The fourth renderer, found by this file's own census rather than by the
    // audit. Pre-500 BOTH read amber and BOTH printed the word "unverified".
    const failed = pickerAuthChip("failed");
    const failedTone = toneOf(failed);
    const failedText = failed?.textContent ?? "";
    cleanup();
    const unverified = pickerAuthChip("unverified");
    expect(failedTone).toBe("red");
    expect(failedTone).not.toBe(toneOf(unverified));
    expect(failedText).not.toBe(unverified?.textContent ?? "");
    expect(failedText.toLowerCase()).not.toContain("unverified");
  });

  it("the picker no longer labels `manuscript` / `canonical` / `needs-reauth` \"unverified\"", () => {
    for (const s of ["manuscript", "canonical", "needs-reauth"] as const) {
      const chip = pickerAuthChip(s);
      expect(chip, `${s} must render a picker chip at all`).not.toBeNull();
      expect(
        (chip?.textContent ?? "").toLowerCase(),
        `${s} must not read "unverified" in the picker`,
      ).not.toContain("unverified");
      // …and its tooltip must say what it IS, not "has not been authenticated".
      expect(chip?.getAttribute("aria-label") ?? "").not.toContain(
        "has not been authenticated",
      );
      cleanup();
    }
  });

  it("`failed` and `unverified` are DISTINGUISHABLE in the Library list too", () => {
    const failed = listBibPill("failed");
    const failedText = failed?.textContent ?? "";
    const failedTone = toneOf(failed);
    cleanup();
    const unverified = listBibPill("unverified");
    expect(failedTone).toBe("red");
    expect(failedTone).not.toBe(toneOf(unverified));
    expect(failedText).not.toBe(unverified?.textContent ?? "");
  });
});

describe("the processing tier resolves ONE tone that both silos read", () => {
  const INDEX_STATES: readonly IndexedState[] = [
    "none",
    "queued",
    "running",
    "indexed",
    "deepIndexed",
    "failed",
  ];

  it.each(INDEX_STATES)(
    "%s paints the same tone in the Bibliography panel and the Library list",
    (state) => {
      const tier = indexStateTier(state);
      const expected = indexTierTone(tier);
      const pill = listIndexPill(state);
      expect(toneOf(pill), `Library list idx pill for ${state}`).toBe(expected);
      cleanup();
      const chip = paperTierChip(tier);
      expect(toneOf(chip), `paper-side tier chip for ${tier}`).toBe(expected);
    },
  );

  it("`deep-indexed` shares GREEN with `indexed` and is distinguished by its LABEL", () => {
    // A DECISION, pinned so a later reader does not file it as a bug: pre-500
    // the paper side gave `deep-indexed` its own darker emerald step and the
    // Library list gave it plain green. A deep index is not a different STATUS
    // from an index, it is a better one — a second green is a colour the reader
    // has to learn to read, so the distinction lives in the label.
    expect(indexTierTone("deep-indexed")).toBe(indexTierTone("indexed"));
    const deep = paperTierChip("deep-indexed");
    const deepText = deep?.textContent ?? "";
    cleanup();
    const plain = paperTierChip("indexed");
    expect(deepText).not.toBe(plain?.textContent ?? "");
  });

  it("`manuscript` and `canonical` share BLUE and are distinguished by their LABEL", () => {
    // The same decision on the auth axis: neither is a problem to fix, so
    // neither earns a colour of its own.
    expect(bibStateTone("manuscript")).toBe(bibStateTone("canonical"));
    const ms = paperAuthChip("manuscript");
    const msText = ms?.textContent ?? "";
    cleanup();
    const canon = paperAuthChip("canonical");
    expect(msText).not.toBe(canon?.textContent ?? "");
  });
});

describe("the tone tokens the two surfaces share are DECLARED", () => {
  // The chip and the pill both build their token name at RUNTIME
  // (`var(--pill-${tone}-edge)`), which is exactly the form `phantom-css-var`'s
  // reader channel exonerates by PREFIX — so a missing declaration there is
  // invisible: the border simply paints nothing, silently. This leg is the
  // premise those runtime reads rest on.
  const css = fs.readFileSync(
    path.join(REPO_ROOT, "library/styles/library.css"),
    "utf8",
  );

  it.each(TONES)("--pill-%s- declares bg, fg and edge", (tone) => {
    for (const rung of ["bg", "fg", "edge"]) {
      expect(css, `--pill-${tone}-${rung} must be declared`).toContain(
        `--pill-${tone}-${rung}:`,
      );
    }
  });

  // The family stopped being one surface's palette in task 500: it now paints
  // 10px chips on the paper side as well as the list's 11px pills. A shared
  // role has to meet the obligation its shared use imposes, so every ink is
  // held to WCAG AA for small text on its OWN ground. Measured before this
  // leg existed, two rungs did not: amber at 4.48 and gray at 4.01 (which had
  // been under AA on the Library list for as long as the family had existed —
  // the leg is what found it, not anyone's reading).
  it.each(TONES)("--pill-%s- clears WCAG AA (4.5:1) for small text", (tone) => {
    const hex = (rung: string) => {
      const m = new RegExp(`--pill-${tone}-${rung}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(m, `--pill-${tone}-${rung} must be a 6-digit hex`).not.toBeNull();
      return m![1];
    };
    expect(contrast(hex("fg"), hex("bg"))).toBeGreaterThanOrEqual(4.5);
  });
});

// ── The leg with teeth ──────────────────────────────────────────────────────
//
// The resolution was never the part that could misbehave; a FOURTH renderer
// that maps a state to a colour itself is, and it type-checks perfectly. So no
// production file outside the leaf may carry a per-state table (a
// `Record<…State|…Tier, …>` or a `switch` over its members) that yields a
// colour — a Tailwind palette utility, a LITERAL `--pill-<tone>-` token, or a
// quoted {@link Tone} name (which is a colour one indirection away: that is the
// exact shape `StatusPill`'s retired `bibTone` had).
//
// Allowlist EMPTY. A hit is MIGRATE-it.

const TONE_LEAF = "src/lib/library/status-tone.ts";

/** The two state vocabularies, by the TYPE NAME a table is keyed on. */
const AXIS_TYPE_NAMES = [
  "BibAuthState",
  "LibraryBibState",
  "IndexedState",
  "LibraryIndexTier",
];

/** Every member of either axis, in both silos' spellings. */
const AXIS_MEMBERS = [
  ...BIB_STATES,
  ...INDEX_TIERS,
  "queued",
  "running",
  "deepIndexed",
];

const TAILWIND_PALETTE =
  /\b(?:text|bg|border|from|via|to|ring|fill|stroke|decoration|outline|shadow|accent|caret|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const LITERAL_PILL_TOKEN = /--pill-(?:green|amber|red|gray|blue)-/;
const QUOTED_TONE = /["'`](?:green|amber|red|gray|blue)["'`]/;
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/;

function yieldsColour(region: string): boolean {
  return (
    TAILWIND_PALETTE.test(region) ||
    LITERAL_PILL_TOKEN.test(region) ||
    QUOTED_TONE.test(region) ||
    HEX_LITERAL.test(region)
  );
}

/** Brace-balanced span starting at `open` (which must index a `{` or `[`). */
function balancedSpan(src: string, open: number): string {
  const close = src[open] === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Statement-ish span around `at` — back to the previous `;`/`{`/`}`, forward
 *  to the next `;` or the region's end. Keeps a ternary chain's arms together
 *  and keeps an unrelated `===` five hundred lines away out. */
function statementSpan(src: string, at: number): string {
  let from = at;
  while (from > 0 && !";{}".includes(src[from - 1])) from--;
  let to = at;
  while (to < src.length && src[to] !== ";") to++;
  return src.slice(from, Math.min(to + 1, src.length));
}

const isAxisMember = (s: string) => AXIS_MEMBERS.includes(s as never);

/** Axis members used as the OWN keys of the object literal `span` starts with
 *  (depth 1 only, so a nested table's keys belong to the nested span). */
function ownKeys(span: string): Set<string> {
  const keys = new Set<string>();
  const KEY = /^\s*(?:["'`]([\w-]+)["'`]|([A-Za-z_$][\w$]*))\s*:/;
  let depth = 0;
  let i = 0;
  while (i < span.length) {
    const c = span[i];
    if (c === "{" || c === "[") { depth++; i++; continue; }
    if (c === "}" || c === "]") { depth--; i++; continue; }
    if (depth === 1) {
      const m = KEY.exec(span.slice(i));
      if (m) {
        const k = m[1] ?? m[2];
        if (k && isAxisMember(k)) keys.add(k);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return keys;
}

/**
 * The SPANS in a region that map a status state to something. Flagging is
 * per-span, not per-declaration, and that scoping is load-bearing rather than
 * tidy: `AXIS_MEMBERS` holds ordinary words (`none`, `failed`, `indexed`,
 * `running`), so a declaration-wide colour test would indict any large
 * component that happens to compare two of them — `PaperHeader`,
 * `catalog-stats` and `PaperRender` all do, colour-free, today. Scoping to the
 * MAPPING is what keeps the allowlist honestly empty instead of accidentally
 * so.
 *
 * Four shapes, which is every form this axis has actually been tabulated in:
 *
 *  1. an OBJECT LITERAL whose own keys name ≥2 axis members. This is the rung
 *     that matters: it covers the annotated `Record<Axis, …>` the pre-500 tree
 *     used, the bare `{ none: "gray", failed: "red" }` an author writes beside
 *     an existing label table, AND a `Record<S, …>` behind an ALIASED type
 *     import, which a `Record<` name grep is blind to.
 *  2. a `switch` whose `case` arms name ≥2 axis members → its body.
 *  3. a `new Map([["none", …], ["failed", …]])` → the argument span.
 *  4. a ternary / `&&` chain of `=== "member"` comparisons → the enclosing
 *     statement. Neither `Record` nor `switch` appears in this one, and it is
 *     the natural re-fork for an inline `style={{ … }}`.
 */
function stateMappingSpans(region: string): string[] {
  const spans: string[] = [];

  // 1 — object literals keyed by axis members. Scanned by hand rather than by
  // one regex: a single alternation that both counts braces AND matches keys
  // consumes the opening `{` as part of the first key's delimiter, so depth
  // never reaches 1 and the leg silently detects nothing. Measured — that was
  // this function's own first draft, and the synthetic canary caught it.
  for (let i = 0; i < region.length; i++) {
    if (region[i] !== "{") continue;
    const span = balancedSpan(region, i);
    if (ownKeys(span).size >= 2) spans.push(span);
  }

  // 2 — switch bodies with ≥2 axis-member cases.
  for (const m of region.matchAll(/\bswitch\s*\(/g)) {
    const brace = region.indexOf("{", m.index);
    if (brace < 0) continue;
    const body = balancedSpan(region, brace);
    const cases = new Set<string>();
    for (const c of body.matchAll(/case\s+["'`]([\w-]+)["'`]\s*:/g)) {
      if (isAxisMember(c[1])) cases.add(c[1]);
    }
    if (cases.size >= 2) spans.push(body);
  }

  // 3 — Map constructors over axis members.
  for (const m of region.matchAll(/new\s+Map\s*\(/g)) {
    const bracket = region.indexOf("[", m.index);
    if (bracket < 0) continue;
    const body = balancedSpan(region, bracket);
    const members = new Set<string>();
    for (const q of body.matchAll(/["'`]([\w-]+)["'`]/g)) {
      if (isAxisMember(q[1])) members.add(q[1]);
    }
    if (members.size >= 2) spans.push(body);
  }

  // 4 — comparison chains, scoped to the enclosing statement.
  const cmp = [...region.matchAll(/[=!]==\s*["'`]([\w-]+)["'`]/g)].filter((m) =>
    isAxisMember(m[1]),
  );
  for (const m of cmp) {
    const span = statementSpan(region, m.index!);
    const members = new Set<string>();
    for (const q of span.matchAll(/[=!]==\s*["'`]([\w-]+)["'`]/g)) {
      if (isAxisMember(q[1])) members.add(q[1]);
    }
    if (members.size >= 2) spans.push(span);
  }

  return spans;
}

/** Coarse declaration regions: from one column-0 declaration to the next. */
function declarationRegions(src: string): string[] {
  const lines = src.split("\n");
  const starts: number[] = [];
  const DECL =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\b/;
  lines.forEach((l, i) => {
    if (DECL.test(l)) starts.push(i);
  });
  if (starts.length === 0) return [src];
  const out: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    out.push(lines.slice(from, to).join("\n"));
  }
  return out;
}

function productionSources(): Array<{ rel: string; src: string }> {
  const files = [
    ...trackedFiles("src", /\.tsx?$/),
    ...trackedFiles("library", /\.tsx?$/),
  ];
  return files
    .map((abs) => ({ abs, rel: path.relative(REPO_ROOT, abs) }))
    .filter(
      ({ rel }) =>
        !rel.includes("__tests__") &&
        !rel.endsWith(".test.ts") &&
        !rel.endsWith(".test.tsx") &&
        rel !== TONE_LEAF,
    )
    .map(({ abs, rel }) => ({ rel, src: fs.readFileSync(abs, "utf8") }));
}

/** Files carrying a per-state region that yields a colour, with the region. */
function offenders(
  sources: Array<{ rel: string; src: string }>,
): Array<{ rel: string; why: string }> {
  const hits: Array<{ rel: string; why: string }> = [];
  for (const { rel, src } of sources) {
    // Strings KEPT: the whole needle vocabulary — quoted state names, quoted
    // tone names, Tailwind class strings — lives inside string literals, so
    // `codeOnly` would blank the very thing this census greps for.
    const scanned = commentsStripped(src);
    for (const region of declarationRegions(scanned)) {
      const span = stateMappingSpans(region).find(yieldsColour);
      if (span) {
        hits.push({ rel, why: region.split("\n")[0].trim().slice(0, 90) });
        break;
      }
    }
  }
  return hits;
}

describe("census — nothing outside the tone leaf maps a status state to a colour", () => {
  it("the allowlist is EMPTY", () => {
    const hits = offenders(productionSources());
    expect(
      hits.map((h) => `${h.rel} — ${h.why}`).sort(),
      "A per-state table that yields a colour is a SECOND answer to a question " +
        `${TONE_LEAF} already answers, and the two describe the same catalog ` +
        "row one tab apart. MIGRATE it onto bibStateTone / indexTierTone; do " +
        "not add an allowlist entry.",
    ).toEqual([]);
  });

  it("the detector can SEE the shape it exists to catch (synthetic canary)", () => {
    // A canary must not stand on the defect: these fixtures are synthetic, not
    // lines the fix drained, so draining more code can never make this vacuous.
    const recordTable = [
      'const t: Record<BibAuthState, Tone> = {',
      '  none: "gray",',
      '  failed: "red",',
      "};",
    ].join("\n");
    const switchTable = [
      "function chipFor(s: LibraryBibState) {",
      "  switch (s) {",
      '    case "authenticated":',
      '      return "text-emerald-700 bg-emerald-50";',
      '    case "failed":',
      '      return "text-rose-700 bg-rose-50";',
      "  }",
      "}",
    ].join("\n");
    const innocent = [
      "const BIB_RANK: Record<BibAuthState, number> = {",
      "  none: 0,",
      "  failed: 1,",
      "};",
    ].join("\n");
    const alsoInnocent = [
      "function paint(tone: Tone) {",
      "  return { color: `var(--pill-${tone}-fg)` };",
      "}",
    ].join("\n");

    const ternaryChain = [
      "function chipStyle(s: string) {",
      "  return {",
      '    color: s === "failed" ? "#8a3030" : s === "unverified" ? "#856a1c" : "#000",',
      "  };",
      "}",
    ].join("\n");

    // The three shapes an adversarial pass found blind in this census's own
    // first draft — a BARE literal (no `Record<`), a literal behind an ALIASED
    // type import, and a `new Map`. Each is a realistic re-fork and each used
    // to pass clean, so each gets a fixture rather than a sentence.
    const bareLiteral = [
      'const TONE = { none: "gray", failed: "red" } as const;',
      "function paint(s: LibraryBibState) { return TONE[s]; }",
    ].join("\n");
    const aliasedType = [
      'import type { LibraryBibState as S } from "@/lib/library/library-types";',
      "const T: Record<S, string> = {",
      '  none: "text-slate-600",',
      '  failed: "text-rose-700",',
      "};",
    ].join("\n");
    const mapTable = [
      "const T = new Map([",
      '  ["none", "#75716a"],',
      '  ["failed", "#8a3030"],',
      "]);",
    ].join("\n");
    // …and the false-positive shape the SPAN scoping exists to spare: a large
    // component that compares two axis members for an unrelated reason and
    // paints something, far away, for another. `PaperHeader`, `PaperRender`
    // and `catalog-stats` are all this shape on the live tree.
    const unrelatedComparisons = [
      "export default function Big({ s, t }: { s: string; t: string }) {",
      '  const busy = s === "queued" || s === "running";',
      "  const rows = t.length;",
      "  void rows;",
      '  return <div className={busy ? "text-amber-700" : "text-ink-body"} />;',
      "}",
    ].join("\n");

    expect(offenders([{ rel: "x.ts", src: recordTable }])).toHaveLength(1);
    expect(offenders([{ rel: "y.ts", src: switchTable }])).toHaveLength(1);
    expect(offenders([{ rel: "t.ts", src: ternaryChain }])).toHaveLength(1);
    expect(offenders([{ rel: "b.ts", src: bareLiteral }])).toHaveLength(1);
    expect(offenders([{ rel: "a.ts", src: aliasedType }])).toHaveLength(1);
    expect(offenders([{ rel: "m.ts", src: mapTable }])).toHaveLength(1);
    expect(offenders([{ rel: "z.ts", src: innocent }])).toHaveLength(0);
    expect(offenders([{ rel: "w.ts", src: alsoInnocent }])).toHaveLength(0);
    expect(offenders([{ rel: "u.tsx", src: unrelatedComparisons }])).toHaveLength(0);
  });

  it("the population is real and the stripper did not swallow it", () => {
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(300);
    // The three files the pre-500 tree carried tables in are all still in the
    // population — a census that stopped SEEING them would report green.
    for (const rel of [
      "library/components/StatusPill.tsx",
      "src/components/library/library-entry-status.tsx",
      "src/components/library/provenance-chips.tsx",
    ]) {
      expect(sources.some((s) => s.rel === rel), `${rel} is censused`).toBe(true);
    }
    // The one-pass scanner's own failure mode: a quoted string that met a
    // newline means it swallowed to end-of-line and the census went partly
    // blind there. A repo-wide exact-set of swallowed lines would be a
    // nine-entry filing cabinet (they are all REGEX LITERALS holding a quote —
    // the one construct `_source-scan` does not model), so the leg asserts the
    // PROPERTY that makes them harmless instead: `_source-scan`'s own contract
    // bounds a swallow to its own LINE, and no line this census could care
    // about is also a regex literal. So every swallowed line must be free of
    // every needle — which stays true as files are added, and goes red the day
    // a swallow lands on a line that could hide a status colour table.
    const blindHits: string[] = [];
    for (const { rel, src } of sources) {
      const lines = src.split("\n");
      for (const n of swallowedLines(src)) {
        const line = lines[n - 1] ?? "";
        if (
          yieldsColour(line) ||
          AXIS_TYPE_NAMES.some((a) => line.includes(a)) ||
          /case\s+["'`][\w-]+["'`]\s*:/.test(line)
        ) {
          blindHits.push(`${rel}:${n} — ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(
      blindHits.sort(),
      "The source scanner swallowed to end-of-line on a line that carries one " +
        "of this census's needles, so the census is blind exactly where it " +
        "matters. Rework the line (usually: hoist the regex literal to its " +
        "own statement) or teach `_source-scan` the construct.",
    ).toEqual([]);
    // …and the scanner is not swallowing GLOBALLY, which would make every leg
    // above pass vacuously. A synthetic canary, so draining production code
    // can never neuter it.
    expect(swallowedLines('const a = "ok";\nconst b = /["]/;\n')).toEqual([2]);
    expect(swallowedLines('const a = "ok";\nconst b = "also ok";\n')).toEqual([]);
    // `codeOnly` is imported for parity with its siblings' self-checks; assert
    // it is the STRINGS-KEPT view this census reads, not the blanked one.
    expect(codeOnly('const a = "text-rose-700";')).not.toContain("rose");
  });
});

describe("census — the dead bib-state chip cluster stays dead", () => {
  // Task 202's law: a table that declares per-kind behaviour is an SSOT only
  // if something READS it, and a dead one is worse than none because the next
  // author asking "how do we colour a bib state?" finds two tables and the
  // dead one looks the most complete. `provenanceFor` had zero production
  // callers; its `bib-state` chip kind was filtered out by its only consumer.
  const RETIRED = ["provenanceFor", '"bib-state"', "bib-state"];

  it("no production file names the retired provenance bib-state surface", () => {
    const hits: string[] = [];
    for (const { rel, src } of productionSources()) {
      // Comments stripped, strings KEPT: `"bib-state"` only ever appears as a
      // quoted union tag, and a note SAYING the kind was retired is exactly
      // the prose this repo asks a fix to leave behind.
      const code = commentsStripped(src);
      for (const needle of RETIRED) {
        if (code.includes(needle)) hits.push(`${rel} — ${needle}`);
      }
    }
    expect(
      hits.sort(),
      "`provenanceFor` and the `bib-state` provenance chip kind were deleted " +
        "in task 500. Re-adding either reinstates a third renderer of an axis " +
        "two surfaces already agree on.",
    ).toEqual([]);
  });
});
