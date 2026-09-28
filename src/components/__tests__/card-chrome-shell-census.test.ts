// @vitest-environment jsdom
// Card chrome lives in the SHELL (task 825).
//
// Each leg below is a fact a card kind used to spell by hand — and drift on —
// that now has exactly one owner:
//
//   1. the GRAB CURSOR — derived by `PanelCard` from its `draggable` prop
//      (`withDragCursor`); a kind passing it through `extraCardClass` is how a
//      draft citation showed a grab cursor it could not honour;
//   2. MONO inside a card — `.card-mono` (the override-first font stack);
//      Tailwind's `font-mono` skips the user's mono preference;
//   3. the AI-REQUEST ROW — `EditableCard`'s `aiRequest` prop / `AiRequestRow`,
//      never a hand-copied wrapper around `AiRequestCheckbox`;
//   4. the EMPTY-BODY PLACEHOLDER — `cardBodyPlaceholder(kind)`, with a
//      registry-declared override where the derived prompt is wrong;
//   5. the bib card's pending-request amber — `amber-attention` tokens, not
//      raw Tailwind palette classes.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
vi.mock("@/lib/storage", () => ({}));

import { withDragCursor, CARD_DRAG_CURSOR_CLASS } from "@/components/panel-primitives";
import { cardBodyPlaceholder, cardTypeLabel } from "@/panels/panel-registry";

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

/** Runtime text only — comments stripped so prose naming a class is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const ALL = walk(SRC);
/** The card components: every `*Card.tsx` under panels/, plus the card rows
 *  whose file names do not say so. */
const CARD_FILES = ALL.filter(
  (f) =>
    (/\/panels\/.*Card\.tsx$/.test(f) && !/Popover|Picker/.test(f)) ||
    /\/components\/BibEntryCard\.tsx$/.test(f) ||
    /\/panels\/Todo\/TodoRow\.tsx$/.test(f),
);

describe("card chrome lives in the shell (task 825)", () => {
  it("sweeps a real set of card components", () => {
    expect(CARD_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it("no kind passes a grab cursor through extraCardClass — PanelCard derives it", () => {
    const offenders = ALL.filter((f) => {
      const src = code(readFileSync(f, "utf8"));
      return /extraCardClass=\{?[^\n]*cursor-grab/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("withDragCursor: draggable wears the grab pair INSTEAD of any caller cursor; not draggable adds none", () => {
    expect(withDragCursor("cursor-pointer opacity-60", true)).toBe(
      `opacity-60 ${CARD_DRAG_CURSOR_CLASS}`,
    );
    expect(withDragCursor("cursor-pointer", false)).toBe("cursor-pointer");
    expect(withDragCursor(undefined, false)).toBeUndefined();
    expect(withDragCursor(undefined, true)).toBe(CARD_DRAG_CURSOR_CLASS);
  });

  it("no Tailwind font-mono in a card component (use .card-mono)", () => {
    const offenders = CARD_FILES.filter((f) =>
      /className=[^\n]*\bfont-mono\b/.test(code(readFileSync(f, "utf8"))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no card hand-wraps AiRequestCheckbox — the row is the shell's", () => {
    const offenders = CARD_FILES.filter((f) =>
      /<AiRequestCheckbox\b/.test(code(readFileSync(f, "utf8"))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no card body spells its placeholder by hand", () => {
    const offenders: string[] = [];
    for (const f of CARD_FILES) {
      const src = code(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/placeholder=(?:"([^"]*)"|\{`\$\{cardTypeLabel)/g)) {
        const text = m[1];
        // Short field prompts inside a card ("range", "Title") are not BODY
        // placeholders; the old body spellings are.
        if (text === undefined || /^(Text here\.|Notes\.\.\.|What should Claude)/.test(text)) {
          offenders.push(`${rel(f)}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("cardBodyPlaceholder derives '<label> text…' and honours declared overrides", () => {
    expect(cardBodyPlaceholder("note")).toBe(`${cardTypeLabel("note")} text…`);
    expect(cardBodyPlaceholder("footnote")).toBe(`${cardTypeLabel("footnote")} text…`);
    expect(cardBodyPlaceholder("report-request")).toBe("What should Claude report on?");
    expect(cardBodyPlaceholder("todo")).toBe("Notes…");
  });

  it("the bib card's pending-request state uses amber tokens, not raw palette classes", () => {
    const src = code(readFileSync(path.join(SRC, "components/BibEntryCard.tsx"), "utf8"));
    const raw = src
      .split("\n")
      .filter((l) => /\b(?:text|bg|border|hover:bg|hover:text)-amber-\d{2,3}\b/.test(l))
      // The PulsingDot's two spans answer to status-dot-ssot's allowlist.
      .filter((l) => !/rounded-full/.test(l));
    expect(raw).toEqual([]);
  });
});
