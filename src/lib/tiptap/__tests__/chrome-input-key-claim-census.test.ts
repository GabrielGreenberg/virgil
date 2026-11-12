// Chrome-input key-claim CENSUS (task 1441) — "an editor-chrome input claims
// the keys it answers" as a rule, not a per-site repair.
//
// Task 552 claimed Enter/Escape on the paragraph-title strip by hand; its
// expex-label and heading-label twins hand-rolled their own keydown with a bare
// `preventDefault()`, so Escape cancelled the label AND kept bubbling to
// `useMarginEdit`'s window listener (discarding unsaved margin guides), a
// scrimless window's Escape and `NodeEditPopover`. All three now go through
// ONE door, `answerFieldKeys` (`src/lib/tiptap/field-keys.ts`).
//
// The census: every Escape a handler under `src/lib/tiptap/**` or
// `src/lib/editor-extensions.ts` answers (`isCancelEscape(` or a literal
// `"Escape"`) must either live in the door itself or CLAIM the press
// (`claimGestureKey(`) within the same handler arm. A new hand-rolled label
// input that only `preventDefault()`s fails here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/components/menu/__tests__/_menu-census";
import { walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = path.resolve(__dirname, "../../..");
const TIPTAP = path.join(SRC, "lib/tiptap");
const DOOR = path.join(TIPTAP, "field-keys.ts");

/** How far after the Escape test the claim must appear (one handler arm). */
const CLAIM_WINDOW_LINES = 8;
const ESCAPE_TEST = /isCancelEscape\(|["']Escape["']/;

function walk(dir: string): string[] {
  return walkFiles(dir, { skipDirs: ["__tests__"] }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
}

/** Every unclaimed Escape test in `source`, as `line:text`. */
export function unclaimedEscapes(source: string): string[] {
  const lines = stripComments(source).split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    if (!ESCAPE_TEST.test(line)) return;
    const arm = lines.slice(i, i + CLAIM_WINDOW_LINES).join("\n");
    if (!/\bclaimGestureKey\(/.test(arm)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

describe("chrome-input key-claim CENSUS (task 1441)", () => {
  it("the detector sees a hand-rolled preventDefault-only Escape and passes a claimed one", () => {
    const leak = `input.addEventListener("keydown", (e) => {\n  if (e.key === "Escape") {\n    e.preventDefault();\n    cancel();\n  }\n});`;
    const claimed = `if (isCancelEscape(e)) {\n  claimGestureKey(e);\n  cancel();\n}`;
    expect(unclaimedEscapes(leak)).toHaveLength(1);
    expect(unclaimedEscapes(claimed)).toEqual([]);
  });

  it("every Escape answered in editor chrome claims the press (or is the door)", () => {
    const files = [...walk(TIPTAP), path.join(SRC, "lib/editor-extensions.ts")];
    const offenders: string[] = [];
    for (const file of files) {
      if (file === DOOR) continue;
      for (const hit of unclaimedEscapes(readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(SRC, file)}:${hit}`);
      }
    }
    expect(
      offenders,
      "an editor-chrome Escape handler must CLAIM the key it answers — use " +
        "`answerFieldKeys` (src/lib/tiptap/field-keys.ts) for an input, or " +
        "`claimGestureKey(e)` in the handler arm",
    ).toEqual([]);
  });

  it("the three label/title inputs answer their keys through the one door", () => {
    // Since task 1588 the heading strip's and the expex pods' label inputs
    // are ONE session (`label-edit-session.ts`); the title inputs are the other.
    for (const rel of [
      "lib/tiptap/label-edit-session.ts",
      "lib/tiptap/title-edit-session.ts",
    ]) {
      expect(readFileSync(path.join(SRC, rel), "utf8"), rel).toMatch(/\banswerFieldKeys\(/);
    }
  });
});
