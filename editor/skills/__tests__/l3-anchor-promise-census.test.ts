// @vitest-environment node
//
// CENSUS — no skill promises a Level-3 proposal leaves "the `.tex` untouched"
// without citing `_safety-levels.md` (task 1397).
//
// Level 3 withholds the proposed CHANGE (an atom splice, a `.bib` rider, a
// suggestion's replacement) — but a `--range` card's `\vlid…\vlidend` pair is
// the card's ANCHOR and `apply_response.py` writes it at every level (task
// 1197). Seven skills that teach `--range` still told the agent (and through
// its reply, the user) that the L3 path never touches the `.tex`; move-card
// still said "Mode-A only" and listed no `document.tex` output. The rule is
// now stated ONCE, in `_safety-levels.md`; this census keeps every restatement
// pointing at it, so the next anchor-shape change (1197 → 1230 → 1397) edits
// one include, not seven sentences.
//
// Scope: every non-include skill BODY under editor/skills/. A paragraph that both
// claims the `.tex` is untouched / never edited AND is about the L3 propose
// path must cite the include. A refusal ("writes nothing — `.tex` … untouched")
// is a true statement on any path and is not a claim about L3.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readRepo as read, repoRoot } from "./_review-routes";

const SKILLS = "editor/skills";
const INCLUDE = "_safety-levels.md";

const TEX_UNTOUCHED =
  /\.tex`?\s+(?:\*\*)?(?:is\s+)?(?:left\s+)?(?:\*\*)?untouched|never edits the `?\.tex|\.tex`? anchor isn't placed/i;
const L3_CONTEXT = /level[- ]?3|\bL3\b|propos|awaiting review/i;
const REFUSAL = /writes nothing|refus|validation failed/i;

/** Blank-line-delimited blocks with their starting line number. */
function blocks(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let start = 0;
  let buf: string[] = [];
  src.split("\n").forEach((l, i) => {
    if (l.trim() === "") {
      if (buf.length) out.push({ line: start + 1, text: buf.join("\n") });
      buf = [];
    } else {
      if (!buf.length) start = i;
      buf.push(l);
    }
  });
  if (buf.length) out.push({ line: start + 1, text: buf.join("\n") });
  return out;
}

/** Drop YAML frontmatter: a `description:` is trigger text naming the op's own
 *  behaviour (reject's "the .tex UNTOUCHED" is true of reject), not the L3 path. */
const body = (src: string) => src.replace(/^---\n[\s\S]*?\n---\n/, "");

/** The uncited L3 "`.tex` untouched" claims in one skill's text. */
function violations(src: string): number[] {
  return blocks(body(src))
    .filter(({ text }) => {
      const claims = text.split("\n").filter((l) => TEX_UNTOUCHED.test(l) && !REFUSAL.test(l));
      return claims.length > 0 && L3_CONTEXT.test(text) && !text.includes(INCLUDE);
    })
    .map((b) => b.line);
}

const skillFiles = readdirSync(join(repoRoot, SKILLS))
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort();

describe("L3 anchor promise census (task 1397)", () => {
  it("the include states the rule, and the door still implements it", () => {
    const inc = read(`${SKILLS}/${INCLUDE}`);
    expect(inc).toMatch(/\\vlid/);
    expect(inc).toMatch(/every level/);
    expect(inc).toMatch(/withholds the proposed CHANGE/);
    // The include paraphrases this comment in apply_response.py's write; if the
    // door stops landing the anchor at L3, the include is wrong — revisit both.
    expect(read("editor/scripts/apply_response.py")).toMatch(/lands with the card at every level/);
  });

  it("detector catches the pre-fix sentences (non-vacuous)", () => {
    const preFix = [
      "3 → `complete-task --propose` (drafted, `.tex` untouched, awaiting\n   review)",
      "For a Level-3 proposal, say the card is *drafted and awaiting review* — it's in\n   the panel but the `.tex` anchor isn't placed yet.",
      "the Task is left **awaiting review** (`status:\n   in-progress`), the `.tex` untouched until the user accepts",
      "This is the L3 propose path — *not* legacy\n   default-apply; it never edits the `.tex`.",
      "**3** → propose (drafted; `.tex` untouched; Task left",
      "proposed `suggested_text`, with the `.tex` **untouched** and the Task left\nawaiting review.",
    ];
    for (const s of preFix) expect(violations(s), s).toHaveLength(1);
    expect(violations(`${preFix[0]} — see [${INCLUDE}](${INCLUDE})`)).toHaveLength(0);
    expect(violations("A proposal whose original is stale writes nothing — `.tex`, card and Task untouched.")).toHaveLength(0);
  });

  it.each(skillFiles)("%s cites the include wherever it promises L3 leaves the .tex untouched", (f) => {
    expect(violations(read(`${SKILLS}/${f}`)), `uncited L3 ".tex untouched" claim(s) in ${f} at block line(s)`).toEqual([]);
  });

  it("move-card names span-anchored cards as movable and lists document.tex in its output", () => {
    const mc = read(`${SKILLS}/move-card.md`);
    expect(mc).not.toMatch(/movable Mode-A card/);
    const reply = mc.slice(mc.indexOf("## Reply"));
    expect(reply).toMatch(/document\.tex/);
  });
});
