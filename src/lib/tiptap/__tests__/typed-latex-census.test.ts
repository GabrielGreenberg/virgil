// Task 639 — THE typed surface has a live vocabulary, and the vocabulary is
// reconciled against SOURCE.
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
// `ACTION_REGISTRY` bills itself as "the single source of truth for every
// editing action Virgil exposes across its FOUR action surfaces". Three of the
// four were reconciled against something live — slash against `VIRGIL_COMMANDS`,
// both menus by RENDERING from the rows. The fourth, typed-LaTeX input, was a
// hand set (`CARD_IDS_WITH_TYPED_RULE`) whose own doc conceded the hazard: "it
// can only be missing a name." It was missing three.
//
// Measured at `88044ee9`: the live typed surface had FIVE members —
// `citation.ts` (`\cite{}`), `footnote.ts` (`\footnote{}`), `math.ts` ×2 (`$`,
// `$$`), `latex-comment.ts` (`% `) — and the registry accounted for two. The
// two math rows declared `surfaces: { lightning: true }` while their extensions
// installed live `handleTextInput` plugins, and the coverage assertion's block
// leg FORBADE them declaring otherwise, so correcting the flag turned CI red.
// `latex-comment` had no row at all.
//
// ── WHY THE CENSUS IS A SOURCE SCAN ───────────────────────────────────────
// `TYPED_LATEX_INPUT_RULES` (read by the extensions, reconciled by
// `assertActionCoverage`) closes the loop between the TABLE and the ROWS. It
// cannot close the loop between the table and REALITY: a sixth input rule added
// tomorrow, matching its own inline regex, would be invisible to both. What
// makes the census exact is the property the auditor used to enumerate the
// surface in the first place — every typed-LaTeX rule calls the shared collab
// gate. That is a SOURCE fact, so this suite asks source.
//
// Stated limit: the needle is the pairing of `collabReadOnly(` with
// `handleTextInput(` inside one `src/lib/tiptap/*.ts` file. A rule that skipped
// the collab gate would be invisible here — and would be its own, worse, bug
// (`typed-latex-collab-gate.test.ts` is the suite that owns it). The two
// censuses lean on each other on purpose: neither can be satisfied by weakening
// the other.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { commentsStripped, REPO_ROOT } from "@/lib/__tests__/_source-scan";
import {
  TYPED_LATEX_ACTION_IDS,
  TYPED_LATEX_INPUT_RULES,
  type TypedLatexActionId,
} from "@/lib/tiptap/typed-latex-input-rules";

const TIPTAP_DIR = path.join(REPO_ROOT, "src/lib/tiptap");

/** The extension file each census id's rule lives in — the join this suite
 *  checks source through. Declared (there is no way to read a file name off a
 *  regex), but it cannot silently drift: every leg below FAILS if a named file
 *  has no gated rule, and the set census fails if a file has one and is not
 *  named. */
const RULE_SOURCE: Readonly<Record<TypedLatexActionId, string>> = {
  citation: "citation.ts",
  footnote: "footnote.ts",
  "inline-math": "math.ts",
  "display-math": "math.ts",
  "latex-comment": "latex-comment.ts",
};

const read = (file: string) =>
  commentsStripped(readFileSync(path.join(TIPTAP_DIR, file), "utf8"));

/** Files under `src/lib/tiptap` that install a `handleTextInput` rule behind the
 *  shared collab gate — i.e. THE typed-LaTeX surface, read off source. */
function gatedInputRuleFiles(): string[] {
  return readdirSync(TIPTAP_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .filter((f) => {
      const src = read(f);
      return src.includes("handleTextInput(") && src.includes("collabReadOnly(");
    })
    .sort();
}

describe("typed-LaTeX census — the table IS the live surface", () => {
  it("names exactly the files that install a collab-gated input rule", () => {
    const declared = [...new Set(Object.values(RULE_SOURCE))].sort();
    expect(gatedInputRuleFiles()).toEqual(declared);
  });

  it("every census entry's extension reads its pattern FROM the census", () => {
    // Leaf-sharing, checked at the call site: the rule must match with
    // `TYPED_LATEX_INPUT_RULES[...]`, never a re-spelled literal. This is what
    // makes the table load-bearing rather than descriptive — the registry's
    // identity check (`row.inputRulePattern === TYPED_LATEX_INPUT_RULES[id]`)
    // then pins the row to the same object, so all three agree by construction.
    for (const id of TYPED_LATEX_ACTION_IDS) {
      const src = read(RULE_SOURCE[id]);
      expect(
        src.includes(`TYPED_LATEX_INPUT_RULES["${id}"]`) ||
          src.includes(`TYPED_LATEX_INPUT_RULES.${id}`),
        `${RULE_SOURCE[id]} must match with TYPED_LATEX_INPUT_RULES["${id}"]`,
      ).toBe(true);
    }
  });

  it("holds five entries, each a RegExp, none shared between ids", () => {
    expect(TYPED_LATEX_ACTION_IDS).toEqual([
      "citation",
      "footnote",
      "inline-math",
      "display-math",
      "latex-comment",
    ]);
    const seen = new Set<RegExp>();
    for (const id of TYPED_LATEX_ACTION_IDS) {
      const re = TYPED_LATEX_INPUT_RULES[id];
      expect(re, `${id} pattern`).toBeInstanceOf(RegExp);
      // A `g`/`y` flag carries `lastIndex` state, so a shared object would give
      // different answers on successive keystrokes. None of these may have one.
      expect(re.global, `${id} pattern must not be /g`).toBe(false);
      expect(re.sticky, `${id} pattern must not be /y`).toBe(false);
      expect(seen.has(re), `${id} reuses another id's pattern object`).toBe(false);
      seen.add(re);
    }
  });

  it("SELF-CHECK: the file needle really does fire on a gated rule", () => {
    // A census that silently matched nothing would pass every leg above.
    const src = read("math.ts");
    expect(src).toContain("handleTextInput(");
    expect(src).toContain("collabReadOnly(");
  });
});
