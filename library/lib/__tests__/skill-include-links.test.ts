// @vitest-environment node
//
// The include-by-LINK contract, both silos (task 2026-08-25-461).
//
// Every `_`-prefixed doctrine include in `editor/skills/` and
// `library/skills/` is reached the same way: the bundle ships the file next
// to the skills, and a skill reaches it through an ordinary markdown link.
// `library/build/build-skill-bundle.mjs` states the design intent outright —
// "every `*.md` under `library/skills/` ships in the published bundle,
// including include files like `_doctrine.md` that other skills reference via
// markdown links — agents reading a skill on a user's library must be able to
// resolve those links locally."
//
// THE MYTH THIS RETIRES. The two OLDEST include headers asserted the
// opposite: `_doctrine.md` claimed it was "Transcluded by every subskill via
// `@_doctrine.md`" and `_latex-output.md` claimed transclusion by
// `deep-index.md`. Measured, `@_doctrine.md` occurred exactly ONCE in the
// whole tree — in that header, asserting itself — while every real consumer
// used a link, and neither builder implements any include syntax at all.
//
// The claim was not inert. It had propagated into two CI guards' stated
// reasoning (`latex-allowlist-doctrine.test.ts`,
// `find-or-surface-doctrine.test.ts` each excused `_`-files from their
// discovered population "because an include is transcluded"), and — the live
// cost — it is WHY nobody ever checked that the links inside these files
// resolve. One did not: `library/skills/_find-or-surface.md` linked
// `_ask-shape.md`, which exists only in the editor silo. So the one
// unresolvable link in the whole skill tree sat inside the file whose own
// header explains that the byte-identical copies exist "so each silo carries
// a local copy for its skills' links to resolve" — the premise the twin rule
// is built on, violated by the twin itself, with the byte-identity guard
// structurally unable to notice (identical bytes can MEAN different things in
// two silos, which is exactly what a cross-silo link is).
//
// Two legs, because a doctrine reached by link owes two things:
//
//   1. RESOLUTION — every relative markdown link in either silo's `skills/`
//      resolves against the LINKING file's own directory. Population
//      DISCOVERED from disk; allowlist EMPTY (a hit is RESOLVE-it, never
//      list-it). This is the exact question the twin rule presupposes and the
//      only one that can catch a cross-silo copy carrying a link one silo
//      cannot resolve.
//
//   2. POINTERS — the family obliged to carry a link actually carries it.
//      `_doctrine.md` was the last include in either silo with NO pointer
//      census (its five siblings each have one: `_ask-shape.md` →
//      `ask-shape-doctrine.test.ts`, `_find-or-surface.md` →
//      `find-or-surface-doctrine.test.ts`, `_latex-allowlist.md` and
//      `_latex-output.md` → `latex-allowlist-doctrine.test.ts`,
//      `_dev-loop-principle.md` → `dev-loop-principle.test.ts`), and the
//      transclusion myth is precisely why: a file that "is transcluded" needs
//      no pointer. Its population is DISCOVERED from the frontmatter
//      declarations themselves — the umbrella plus every skill announcing
//      "Subskill of /deep-index" — reusing the derivation
//      `subskill-dispatch-guardrail.test.ts` already runs, so a new subskill
//      inherits the obligation by declaring itself. A hand list could only
//      ever be missing a name.
//
// STATED LIMIT, deliberately. Leg 1 asks whether a link resolves in the
// SOURCE TREE, not whether it resolves inside a SHIPPED bundle. Those
// coincide for every link that stays inside `skills/` or points at
// `../scripts/` (both builders map `<silo>/skills/*` → `claude-commands/*` and
// `<silo>/scripts/*` → `scripts/*`, so the relative shape survives), and they
// do NOT coincide for the ~27 links that leave those two dirs
// (`../AGENTS.md`, `../dev/README.md`, `../../docs/workspace/*.md`,
// `../lib/__tests__/*.ts`). Whether each of those is a legitimate repo-only
// pointer or a broken bundle link is a per-link product question about the
// synced-folder layout, not a fact this guard can derive — so it is named
// here rather than half-answered by an allowlist.
//
// And a third leg keeps the myth from growing back in the place it lived: no
// skill markdown may claim transclusion. Scoped to skill markdown, which is
// what an AGENT reads; the same phrase inside a `.ts` comment is a note to a
// developer and is left to review.

import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SILOS = ["editor/skills", "library/skills"] as const;

/** Relative markdown links whose target may legally be absent from the
 *  linking file's own silo. DELIBERATELY EMPTY, and it must stay that way:
 *  an entry is a pointer an agent following the doctrine gets nothing from.
 *  A hit is RESOLVE-it (or re-word the sentence so it carries no link). */
const PERMITTED_UNRESOLVABLE_LINKS: string[] = [];

/** Skill markdown that may assert transclusion. DELIBERATELY EMPTY: no
 *  builder implements any include syntax, so the claim is false wherever it
 *  appears. A file may still say what does NOT happen (`_dev-loop-principle`
 *  opens with "with NO transclusion"), which these needles do not match. */
const PERMITTED_TRANSCLUSION_CLAIMS: string[] = [];

/** `[text](href)`, with an optional `"title"`. */
const LINK = /\[[^\]\n]*\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;

/** A positive assertion that some mechanism inlines an include for you:
 *  the "Transcluded by …" phrasing, and the `@_include.md` syntax that is
 *  spelled nowhere in either builder. */
const TRANSCLUSION_CLAIM = [/transcluded\s+by/i, /@_[a-z][a-z0-9-]*\.md/];

function skillFiles(): string[] {
  const out: string[] = [];
  for (const silo of SILOS) {
    for (const name of readdirSync(join(repoRoot, silo)).sort()) {
      if (name.endsWith(".md")) out.push(`${silo}/${name}`);
    }
  }
  return out;
}

interface Link {
  /** Repo-relative path of the file holding the link. */
  file: string;
  line: number;
  href: string;
}

function relativeLinks(file: string): Link[] {
  const src = read(file);
  const out: Link[] = [];
  for (const m of src.matchAll(LINK)) {
    const href = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue; // absolute / anchor
    out.push({ file, line: src.slice(0, m.index).split("\n").length, href });
  }
  return out;
}

const frontmatterOf = (src: string): string => {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  return m ? m[1] : "";
};

/** Same declaration form `subskill-dispatch-guardrail.test.ts` derives from:
 *  `\s+` rather than a literal space, because a frontmatter description is a
 *  wrapped YAML block scalar and the phrase straddles a line break in
 *  `di-preflight.md`. */
const DECLARATION = /Subskill\s+of\s+\/(?:(?:library|editor)\/)?([a-z][a-z0-9-]*)/;

/** `deep-index.md` plus every library skill declaring itself its subskill —
 *  the family `_doctrine.md` §0 speaks for ("Every subskill in this family
 *  inherits the same contract"). */
function deepIndexFamily(): string[] {
  const family = ["library/skills/deep-index.md"];
  for (const file of skillFiles()) {
    if (!file.startsWith("library/skills/")) continue;
    const m = DECLARATION.exec(frontmatterOf(read(file)));
    if (m && m[1] === "deep-index") family.push(file);
  }
  return family.sort();
}

describe("skill include links", () => {
  it("resolves every relative markdown link against the linking file's own silo", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const file of skillFiles()) {
      for (const link of relativeLinks(file)) {
        checked++;
        const target = link.href.split("#")[0];
        if (!target) continue; // pure in-page anchor
        const abs = resolve(join(repoRoot, dirname(file)), target);
        if (existsSync(abs)) continue;
        broken.push(`${link.file}:${link.line} -> ${link.href}`);
      }
    }
    // The sweep must have something to say — a regex that matched nothing
    // would report green for the wrong reason.
    expect(checked).toBeGreaterThan(100);
    expect(broken.filter((b) => !PERMITTED_UNRESOLVABLE_LINKS.includes(b))).toEqual([]);
    expect(PERMITTED_UNRESOLVABLE_LINKS).toEqual([]);
  });

  it("holds every deep-index family member to its `_doctrine.md` pointer", () => {
    const family = deepIndexFamily();
    // The declaration derivation must still find the family it was written
    // for: the umbrella plus its six declared subskills.
    expect(family.length).toBeGreaterThanOrEqual(6);

    const missing = family.filter(
      (file) => !read(file).includes("[_doctrine.md](_doctrine.md)"),
    );
    expect(missing).toEqual([]);
  });

  it("lets no skill markdown claim a transclusion no builder implements", () => {
    const claims: string[] = [];
    for (const file of skillFiles()) {
      const src = read(file);
      for (const needle of TRANSCLUSION_CLAIM) {
        const m = needle.exec(src);
        if (m) claims.push(`${file}:${src.slice(0, m.index).split("\n").length} — "${m[0]}"`);
      }
    }
    expect(claims.filter((c) => !PERMITTED_TRANSCLUSION_CLAIMS.some((p) => c.startsWith(p)))).toEqual([]);
    expect(PERMITTED_TRANSCLUSION_CLAIMS).toEqual([]);

    // Neither builder implements any include syntax — the premise the leg
    // above rests on, checked rather than asserted.
    for (const builder of [
      "library/build/build-skill-bundle.mjs",
      "editor/build/build-editor-bundle.mjs",
    ]) {
      const src = read(builder);
      expect(src).not.toMatch(/@_[a-z][a-z0-9-]*\.md/);
      expect(src.toLowerCase()).not.toContain("transclude");
    }
  });
});
