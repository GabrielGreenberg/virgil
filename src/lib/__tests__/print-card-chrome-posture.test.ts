/**
 * Task 1114 — the PRINT CHROME POSTURE, asked of the CARD primitives.
 *
 * Print → "Include panels as appendices" renders each panel through
 * `PrintAppendices` → `PaneRailBody`: the LIVE card components. So every
 * control a card header (or its corner cluster) paints reaches paper unless it
 * declares itself editor chrome. The print block used to carry ONE rule for
 * this — `[data-print-appendix] [data-card-chrome] { display: none }` — keyed
 * on a marker NOTHING stamped, so a printed footnote / bibliography appendix
 * carried a grip glyph, an anchor-drop icon and (bib) a jump chevron on every
 * card.
 *
 * The answer is the third hook that already exists for exactly this
 * (`chromeOnly()` / `.virgil-chrome-only`, task 535), stamped where each
 * control is DEFINED — not a second marker and not a mechanism-keyed hand rule
 * (`[data-card-header] button` would also hide the kind label, which is
 * content). This census asks the question of the population: **every
 * chrome-SHAPED element a card primitive renders — a `<button>`, a
 * `PopoutButton`, `role="button"`, a hover hint (`data-hint` / `iconHint(`) —
 * is stamped `chromeOnly(…)` on its own tag, or sits on the reviewed
 * allowlist below that states why it is document content.**
 *
 * Population: every `Card*` component (exported or not) in
 * `panel-primitives.tsx` — the card-chrome SSOT — plus the collab-presence
 * components a card header renders. STATED LIMIT: a primitive defined in
 * another file and rendered into a card's `headerTrailing` slot (a per-panel
 * status dot, a Todo checkbox) is per-panel and is not discovered here; the
 * Todo done-state and suggestion status are content, which is why a slot
 * member is reviewed where it is written rather than swept.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped, cssCommentsStripped, tagEnd, REPO_ROOT } from "./_source-scan";

const PRIMITIVES = "src/components/panel-primitives.tsx";
const WHOLE_FILE_MEMBERS = [
  "src/components/CollabClaimPill.tsx",
  "src/components/CollabPresenceDots.tsx",
];

const read = (rel: string) => commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));

/**
 * `"<Component>:<tag>"` → why that chrome-SHAPED element is document content.
 * A claim, not an escape hatch: a hit that is editor chrome is COVER-it
 * (`chromeOnly(<class>)`), never an entry.
 */
const DOCUMENT_CONTENT: Record<string, string> = {};

/** `{ name → body }` for every top-level `function Card*` in the file. */
function cardFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts = [...src.matchAll(/^(?:export\s+)?(?:default\s+)?function\s+(\w+)/gm)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
    out.set(m[1], src.slice(m.index!, end));
  });
  return out;
}

const CHROME_SHAPED = /\bdata-hint\s*=|\biconHint\s*\(|\brole=["']button["']/;

/** Every chrome-shaped opening tag in `body`: `[tagName, tagText]`. */
function chromeShapedTags(body: string): [string, string][] {
  const out: [string, string][] = [];
  const open = /<([A-Za-z][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(body))) {
    if (/[\w$]/.test(body[m.index - 1] ?? "\n")) continue; // generics, comparisons
    const close = tagEnd(body, m.index);
    if (close < 0) continue;
    const tag = body.slice(m.index, close + 1);
    const name = m[1];
    if (name === "button" || name === "PopoutButton" || CHROME_SHAPED.test(tag)) out.push([name, tag]);
    open.lastIndex = close;
  }
  return out;
}

function uncovered(): { hits: number; misses: string[] } {
  let hits = 0;
  const misses: string[] = [];
  const check = (owner: string, body: string) => {
    for (const [name, tag] of chromeShapedTags(body)) {
      hits++;
      if (/\bchromeOnly\s*\(/.test(tag)) continue;
      if (`${owner}:${name}` in DOCUMENT_CONTENT) continue;
      misses.push(`${owner} <${name} …> ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  };
  for (const [fn, body] of cardFunctions(read(PRIMITIVES))) {
    if (fn.startsWith("Card")) check(fn, body);
  }
  for (const rel of WHOLE_FILE_MEMBERS) check(rel, read(rel));
  return { hits, misses };
}

describe("print card-chrome posture (task 1114)", () => {
  it("discovers a real population (the census is not vacuous)", () => {
    const fns = [...cardFunctions(read(PRIMITIVES)).keys()].filter((n) => n.startsWith("Card"));
    for (const known of [
      "CardDragHandle",
      "CardDropButton",
      "CardJumpChevron",
      "CardPopoutButton",
      "CardTrashButton",
      "CardArchiveButton",
      "CardRestoreButton",
      "CardBodyTitle",
      "CardKindDropdown",
    ]) {
      expect(fns, known).toContain(known);
    }
    expect(uncovered().hits).toBeGreaterThanOrEqual(10);
  });

  it("every chrome-shaped element a card primitive renders is stamped chromeOnly() or reviewed as content", () => {
    expect(uncovered().misses).toEqual([]);
  });

  it("the kind dropdown's caret is chrome while its label is content", () => {
    const body = cardFunctions(read(PRIMITIVES)).get("CardKindDropdown")!;
    // The caret is the shared `MenuCaret` leaf (task 1276), handed the chrome
    // class at the site.
    expect(body).toMatch(/<MenuCaret\b[^>]*className=\{chromeOnly\(/);
  });

  it("no dead appendix marker rule survives in the print block", () => {
    const css = cssCommentsStripped(readFileSync(join(REPO_ROOT, "src/app/globals.css"), "utf8"));
    expect(css).not.toMatch(/data-card-chrome/);
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/\.virgil-chrome-only\s*\{\s*display:\s*none\s*!important/);
  });
});
