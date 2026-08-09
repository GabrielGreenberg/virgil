// @vitest-environment node
//
// Declared-subskill dispatch guardrail — both silos (task 2026-07-18-163).
//
// An umbrella skill's SUBSKILL SET and the sequence it actually dispatches
// are two different things, and nothing made them agree. `/library/deep-index`
// declared six subskills (library/AGENTS.md "Deep-index subskills";
// `di-preflight.md` says "Subskill of /deep-index" in its own frontmatter, and
// `di-clean-prose.md` opens with "Operates on main.tex after
// /library/di-preflight") and dispatched five. So on every deep-index pass the
// JSTOR cover-page strip, the interlibrary lending-slip strip, the
// content↔metadata mismatch policy and the pgmark-coverage reconciliation
// simply never ran — unless the operator happened to invoke di-preflight by
// hand first, which no skill told them to do and no queue kind scheduled.
//
// Nothing could have caught it. The subskill existed, was reachable as a slash
// command, was named in the docs, was exercised by nine `test-corpus.json`
// rows, and had four Python helpers written for it. Every one of those facts is
// about the subskill; none is about the caller. **A "registered and reachable"
// skill proves nothing about whether anything invokes it** — the same lesson
// the drop-spec coverage guard learned (root AGENTS.md, task 233).
//
// The declaration is DERIVED, not hand-enumerated here: a skill joins the set
// by writing "Subskill of /<umbrella>" in its own frontmatter — the routing
// copy an agent reads first — so a new subskill that nobody wires fails CI
// rather than shipping inert.
//
// Prose: library/AGENTS.md §Skills "A declared subskill is a dispatched
// subskill". Sibling guards in the same idiom:
// `skill-script-cli-guardrail.test.ts` (a documented invocation is an executed
// invocation) and `library-flag-threading.test.ts` (a frontmatter claim is a
// body obligation).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SILOS = { library: "library/skills", editor: "editor/skills" } as const;
type Silo = keyof typeof SILOS;

/**
 * Declared subskills an umbrella may legally NOT dispatch.
 *
 * Deliberately EMPTY, and it should stay that way: an entry is a skill that
 * announces itself as part of a pipeline no one runs it from. Wire it, or drop
 * the claim from its frontmatter — never list it.
 */
const PERMITTED_UNDISPATCHED_SUBSKILLS: string[] = [];

const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function skillNames(silo: Silo): Set<string> {
  return new Set(
    readdirSync(join(repoRoot, SILOS[silo]))
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3)),
  );
}

function skillFiles(silo: Silo): string[] {
  return readdirSync(join(repoRoot, SILOS[silo]))
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => `${SILOS[silo]}/${n}`);
}

const frontmatterOf = (src: string): string => {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  return m ? m[1] : "";
};

/**
 * `Subskill of /deep-index` / `Subskill of /library/deep-index`.
 *
 * The silo prefix is optional because the skills write it both ways; an
 * unqualified name resolves inside the DECLARING skill's own silo, which is
 * the only reading that makes sense for a pipeline.
 *
 * `\s+` rather than a literal space, because a frontmatter description is a
 * wrapped YAML block scalar and the phrase straddles a line break in
 * `di-preflight.md` — the one skill this guard exists to catch. A
 * space-literal version of this regex read the whole corpus as five
 * subskills and reported green.
 */
const DECLARATION = /Subskill\s+of\s+\/(?:(library|editor)\/)?([a-z][a-z0-9-]*)/;

/**
 * The dispatch form the orchestrators actually use: an imperative
 * "Run `/library/<name> …`".
 *
 * Deliberately NOT "the umbrella mentions the subskill anywhere". A prose
 * cross-reference ("see /library/di-clean-prose Step 3a") is exactly the weak
 * shape that would have let this bug through — di-preflight was referenced by
 * name in four sibling skills and dispatched by none of them.
 */
const dispatchRe = (silo: Silo, name: string) =>
  new RegExp(`[Rr]un\\s+\`?/${silo}/${name}(?![A-Za-z0-9-])`);

interface Declaration {
  /** The declaring subskill, e.g. `library/skills/di-preflight.md`. */
  file: string;
  silo: Silo;
  name: string;
  umbrella: string;
  umbrellaFile: string;
}

function declarations(): Declaration[] {
  const out: Declaration[] = [];
  for (const silo of Object.keys(SILOS) as Silo[]) {
    for (const file of skillFiles(silo)) {
      const m = DECLARATION.exec(frontmatterOf(read(file)));
      if (!m) continue;
      const umbrellaSilo = (m[1] as Silo | undefined) ?? silo;
      out.push({
        file,
        silo,
        name: file.slice(`${SILOS[silo]}/`.length, -3),
        umbrella: m[2],
        umbrellaFile: `${SILOS[umbrellaSilo]}/${m[2]}.md`,
      });
    }
  }
  return out;
}

/**
 * Every slash-command reference in skill markdown.
 *
 * Boundary-anchored on both ends so a filesystem path can't masquerade as one:
 * `.virgil/scripts/library/detect_genre.py` is not a reference to
 * `/library/detect`, and `editor/scripts/library_path.py` is not one to
 * `/editor/library`. A trailing hyphen means a glob (`/editor/answer-*`),
 * which names a family rather than a skill.
 */
const REFERENCE = /(?:^|[\s`("'*[])\/(library|editor)\/([a-z][a-z0-9-]*)(?![A-Za-z0-9_./-])/g;

interface Reference {
  file: string;
  line: number;
  silo: Silo;
  name: string;
}

function references(): Reference[] {
  const out: Reference[] = [];
  for (const silo of Object.keys(SILOS) as Silo[]) {
    for (const file of skillFiles(silo)) {
      read(file)
        .split("\n")
        .forEach((text, i) => {
          REFERENCE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = REFERENCE.exec(text)) !== null) {
            if (m[2].endsWith("-")) continue;
            out.push({ file, line: i + 1, silo: m[1] as Silo, name: m[2] });
          }
        });
    }
  }
  return out;
}

describe("declared subskill ↔ umbrella dispatch", () => {
  it("every skill declaring itself a subskill is dispatched by its umbrella", () => {
    const misses = declarations()
      .filter((d) => !PERMITTED_UNDISPATCHED_SUBSKILLS.includes(d.name))
      .filter((d) => !dispatchRe(d.silo, d.name).test(read(d.umbrellaFile)))
      .map(
        (d) =>
          `  ${d.file} declares "Subskill of /${d.umbrella}", but ` +
          `${d.umbrellaFile} never says: Run \`/${d.silo}/${d.name} …\``,
      );
    expect(
      misses,
      "A declared subskill nothing dispatches is dead pipeline: the work it\n" +
        "owns silently never happens, and every downstream step that assumes it\n" +
        "ran is reading an unprepared file. Wire the dispatch, or drop the claim\n" +
        `from the subskill's frontmatter.\n${misses.join("\n")}`,
    ).toEqual([]);
  });

  it("every umbrella a subskill names exists", () => {
    const missing = declarations()
      .filter((d) => !skillNames(d.silo).has(d.umbrella))
      .map((d) => `  ${d.file} → /${d.umbrella} (no such skill)`);
    expect(missing, `Subskill declares a non-existent umbrella.\n${missing.join("\n")}`).toEqual([]);
  });

  it("every slash-command a skill references resolves to a skill file", () => {
    // Catches the rename half of the same class: `/editor/answer-revision-comment`
    // outlived its file once already.
    const dangling = references()
      .filter((r) => !skillNames(r.silo).has(r.name))
      .map((r) => `  ${r.file}:${r.line} → /${r.silo}/${r.name}`);
    expect(
      dangling,
      "A skill points an agent at a slash command that doesn't exist.\n" +
        `${dangling.join("\n")}`,
    ).toEqual([]);
  });

  it("the scanner actually sees the declarations and dispatches it polices", () => {
    // A regex that silently matched nothing would make all three checks above
    // pass forever. Pin the real set, by name.
    const decls = declarations();
    const deepIndexSubskills = decls
      .filter((d) => d.umbrella === "deep-index")
      .map((d) => d.name)
      .sort();
    expect(deepIndexSubskills).toEqual([
      "clean-bibliography",
      "di-clean-prose",
      "di-examples",
      "di-preflight",
      "di-validate",
      "recover-footnotes",
    ]);

    // The dispatch matcher must be finding real lines, not vacuously passing.
    const orchestrator = read("library/skills/deep-index.md");
    for (const name of deepIndexSubskills) {
      expect(
        dispatchRe("library", name).test(orchestrator),
        `deep-index.md does not dispatch ${name}`,
      ).toBe(true);
    }

    // And the reference scanner must see a real corpus — the leg that would
    // otherwise report "clean" on a broken regex.
    expect(references().length).toBeGreaterThan(150);
  });
});
