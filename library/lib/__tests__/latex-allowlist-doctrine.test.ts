// @vitest-environment node
//
// Drift guard for the cross-silo ALLOWABLE-LaTeX doctrine. The doctrine
// (`_latex-allowlist.md`) is authored ONCE but must ship in BOTH skill
// bundles (editor + library land in separate on-disk folders, so each silo
// carries a local copy for its skills' `[_latex-allowlist.md](...)` links to
// resolve). This test makes the two copies a single source of truth in
// practice: if they diverge, or if a `.tex`-writing skill drops its pointer
// back to the allowlist (re-paraphrasing the vocabulary inline — the very
// drift this task eliminates), the test fails.
//
// The renderer-SSOT ↔ inventory drift (a phantom command in the doc, or a
// cite command the parser gained but the doc lost) is caught by a separate
// coherence check (`tools/check-coherence.mjs`, check #6 "allowlist"); this
// test guards silo-parity + link-not-paraphrase, mirroring
// `find-or-surface-doctrine.test.ts`.
//
// THE POPULATION IS DISCOVERED (task 448). Until then the coverage leg ran
// off a hand-written `REFERENCING_SKILLS` array of 13 entries, above a
// comment asserting that "the library side references it transitively
// through `_latex-output.md`". That claim was true of `deep-index.md` and of
// NO other library skill: eight `.tex`-writing library skills reached the
// doctrine through neither path, and one of them
// (`clean-bibliography.md`) had already re-paraphrased the tie rule in its
// own words — correct at the time, which is exactly what a fork looks like
// before it drifts. A hand list can only ever be missing a name.
//
// So the member set is derived from the doctrines' OWN machine-readable
// inventories: the shared ```latex-allowlist``` block plus the library
// appendix's ```latex-appendix``` block. A skill (any non-`_` file under
// `{editor,library}/skills/`) that SPELLS one of those commands is treated
// as a `.tex` writer and must link back to a doctrine — or sit on
// `PERMITTED_NON_TEX_SKILLS` with a stated reason. That allowlist is an
// EXACT SET, so a stale exemption (a skill that has since gained its link)
// fails too, and it may only shrink.
//
// Why it matters: the deep-index subskills are advertised as standalone-
// callable (`/library/clean-bibliography <citekey>` re-itemizes References
// without the umbrella), and each carries a frontmatter `description`
// inviting direct invocation. Invoked standalone, an agent that never reads
// a link never sees the doctrine.
//
// `_`-prefixed files are excluded by construction rather than by allowlist:
// an include is transcluded into a skill that carries its own link and
// cannot be invoked standalone at all, so it has no "the agent never sees
// the doctrine" failure mode. The one include that is itself a doctrine
// (`_latex-output.md`, the library appendix) gets its own leg below.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const LIBRARY_DOCTRINE = "library/skills/_latex-allowlist.md";
const EDITOR_DOCTRINE = "editor/skills/_latex-allowlist.md";
const LIBRARY_APPENDIX = "library/skills/_latex-output.md";

/** Either doctrine satisfies the link obligation — the appendix links the
 *  shared SSOT in turn, and for an extraction skill it is the more useful
 *  entry point. */
const DOCTRINE_LINKS = ["_latex-allowlist.md", "_latex-output.md"];

/** Skills that spell a doctrine command but do NOT compose or edit LaTeX.
 *  EXACT SET — a stale entry (one that has since gained a link) fails, and
 *  a new entry needs a stated reason. A hit is LINK-it, not list-it. */
const PERMITTED_NON_TEX_SKILLS: Record<string, string> = {
  "editor/skills/link-cards.md":
    "writes only each card's `relatedCards` field; its single `\\ex` is prose " +
    "describing `examples.json` as the app's `\\ex`-derived projection.",
  "editor/skills/move-card.md":
    "rewrites `links[*].anchor.textObjectIds`, never the document text (it " +
    "says so outright and DEFERS atom-bearing cards); its `\\footnote`/`\\cite` " +
    "are prose naming the atom it refuses to move.",
  "editor/skills/iterate-virgil-editor.md":
    "a DEVELOPER meta-skill: it runs other skills against a sandboxed copy " +
    "of the sample paper and edits skill markdown — it never composes a " +
    "paper's `.tex`. Its single `\\citet` is prose naming the fabrication a " +
    "cross-skill test case must NOT produce (task 451 added the sentence).",
  "library/skills/authenticate-bib.md":
    "reads a `\\section{}` heading to seed a title guess; the field values it " +
    "writes reach `master.bib` verbatim from the auth helper — the skill " +
    "explicitly forbids hand-marshalling them.",
  "library/skills/triage-pdf.md":
    "reads `\\title/\\author/\\date` for metadata and copies a `.tex` drop " +
    "through verbatim (passthrough); composes no LaTeX of its own.",
  "library/skills/triage-pending.md":
    "the batch form of the same read — metadata only, no `.tex` composed.",
};

type Skill = { rel: string; body: string };

/** Every invocable skill in both silos (`_`-prefixed includes excluded — see
 *  the header). Discovered from disk, so a new skill is covered by shipping. */
function allSkills(): Skill[] {
  const out: Skill[] = [];
  for (const silo of ["editor", "library"]) {
    const dir = join(repoRoot, silo, "skills");
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name.startsWith("_")) continue;
      out.push({ rel: `${silo}/skills/${name}`, body: read(`${silo}/skills/${name}`) });
    }
  }
  return out;
}

/** Command names out of a fenced inventory block (`# …` lines are comments). */
function inventory(rel: string, fence: string): string[] {
  const m = new RegExp("```" + fence + "\\n([\\s\\S]*?)```").exec(read(rel));
  if (!m) return [];
  const cmds: string[] = [];
  for (const line of m[1].split("\n")) {
    for (const tok of line.split("#")[0].split(/\s+/)) {
      if (tok.startsWith("\\")) cmds.push(tok);
    }
  }
  return cmds;
}

/** The needle set: the union of both doctrines' own inventories. Never a
 *  hand list in this file — a hand list inside the guard that outlaws hand
 *  lists is the same defect one level up. */
function latexNeedles(): string[] {
  return [
    ...new Set([
      ...inventory(LIBRARY_DOCTRINE, "latex-allowlist"),
      ...inventory(LIBRARY_APPENDIX, "latex-appendix"),
    ]),
  ].sort();
}

/** A command is "spelled" when it appears NOT as a prefix of a longer control
 *  word — so `\ref` does not match `\refstepcounter`, and `\a` does not match
 *  `\author`. */
function spells(body: string, cmds: string[]): string[] {
  const re = new RegExp(
    [...cmds]
      .sort((a, b) => b.length - a.length)
      .map((c) => c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&") + "(?![A-Za-z@])")
      .join("|"),
    "g",
  );
  return [...new Set(body.match(re) ?? [])].sort();
}

const linksADoctrine = (body: string) => DOCTRINE_LINKS.some((l) => body.includes(l));

describe("allowable-LaTeX doctrine (cross-silo SSOT)", () => {
  it("ships a byte-identical copy in each silo", () => {
    expect(read(EDITOR_DOCTRINE)).toBe(read(LIBRARY_DOCTRINE));
  });

  it("declares itself an include, not a slash command", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/Not a slash command/i);
  });

  it("prescribes the tie `~` and forbids `\\textasciitilde{}` for it", () => {
    const doc = read(LIBRARY_DOCTRINE);
    // The load-bearing rule the reported symptom (ex.\textasciitilde{}14)
    // violated: use `~`, never `\textasciitilde{}` for a non-breaking space.
    expect(doc).toContain("~");
    expect(doc).toContain("\\textasciitilde{}");
    expect(doc).toMatch(/tie|non-breaking space/i);
  });

  it("carries a machine-checked Command inventory block", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/##\s*Command inventory/i);
    expect(doc).toContain("```latex-allowlist");
  });

  it("the library appendix links the shared SSOT and carries its own inventory", () => {
    const appendix = read(LIBRARY_APPENDIX);
    expect(appendix).toContain("_latex-allowlist.md");
    expect(appendix).toContain("```latex-appendix");
    expect(inventory(LIBRARY_APPENDIX, "latex-appendix").length).toBeGreaterThan(10);
  });

  // The can-see canary: the needle set must be non-trivial and must draw
  // from BOTH blocks, or the coverage leg below passes vacuously. Anchored
  // on commands neither block can lose (`\cite` is the renderer-checked
  // shared inventory; `\pgmark` is the extraction anchor the whole library
  // pipeline is built on) — never on a command this task happened to add.
  it("derives its needle set from both doctrines' inventories", () => {
    const needles = latexNeedles();
    expect(needles.length).toBeGreaterThan(50);
    expect(needles).toContain("\\cite");
    expect(needles).toContain("\\textasciitilde");
    expect(needles).toContain("\\pgmark");
    expect(needles).toContain("\\begingl");
  });

  // The leg with teeth. The doctrine was never the part that could
  // misbehave — a `.tex`-writing skill that never points at it is.
  it("every skill that composes LaTeX links a doctrine (population discovered)", () => {
    const needles = latexNeedles();
    const offenders = allSkills()
      .filter(({ rel, body }) => {
        if (rel in PERMITTED_NON_TEX_SKILLS) return false;
        return spells(body, needles).length > 0 && !linksADoctrine(body);
      })
      .map(({ rel, body }) => `${rel} — spells ${spells(body, needles).slice(0, 6).join(" ")}`);

    expect(
      offenders,
      "these skills compose or edit LaTeX but link neither `_latex-allowlist.md` " +
        "nor `_latex-output.md`. Add the doctrine link block (never a paraphrase); " +
        "if the skill genuinely only READS LaTeX, add it to PERMITTED_NON_TEX_SKILLS " +
        "with the reason.",
    ).toEqual([]);
  });

  // The allowlist is an EXACT SET, so an exemption that has stopped excusing
  // anything (the skill gained its link, or stopped mentioning LaTeX) fails
  // rather than standing as a licence for the next writer under that name.
  it("carries no stale non-writer exemption", () => {
    const needles = latexNeedles();
    const skills = new Map(allSkills().map((s) => [s.rel, s.body]));
    const stale = Object.keys(PERMITTED_NON_TEX_SKILLS).filter((rel) => {
      const body = skills.get(rel);
      if (body === undefined) return true; // renamed or deleted
      return spells(body, needles).length === 0 || linksADoctrine(body);
    });
    expect(stale, "these exemptions no longer excuse anything — delete them").toEqual([]);
  });

  it("every non-writer exemption states a reason", () => {
    for (const [rel, why] of Object.entries(PERMITTED_NON_TEX_SKILLS)) {
      expect(why.length, `${rel} needs a stated reason`).toBeGreaterThan(30);
    }
  });
});
