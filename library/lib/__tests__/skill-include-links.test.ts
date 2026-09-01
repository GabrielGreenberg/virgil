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
// THE OTHER PLACE THE READER SITS (task 506). Leg 1 asks whether a link
// resolves in the SOURCE TREE. The 461 text named the bundle half as a stated
// limit and got its reasoning backwards in the one way that mattered: it said
// "both builders map `<silo>/skills/*` → `claude-commands/*` and
// `<silo>/scripts/*` → `scripts/*`, so the relative shape survives". That is
// true of the BUNDLE path — where those two are siblings under
// `public/skill-bundle/<silo>/` — and FALSE of the DISK path an agent actually
// reads from, where `.claude/commands/editor/` and `.virgil/scripts/editor/`
// are two directories apart. So the 25 links spelled `../scripts/<helper>.py`
// were counted as safe while landing at `.claude/commands/scripts/…`, which
// exists nowhere; and the 13 spelled `../../docs/workspace/<doc>.md` landed at
// `.claude/docs/workspace/…` while the file itself sat at `.claude/virgil/`.
// Thirty-eight dead pointers in shipped skills, in the exact class 461 closed
// one level up.
//
// LEG 2 is that question, asked of the SHIPPED BYTES: a link whose target
// SHIPS must be spelled so it resolves at the target's shipped path. It is
// satisfied by construction — `bundle-sources.mjs` re-spells every such link
// from the same map both halves of the assertion read — so what this leg pins
// is that the rewrite is WIRED, which is the part that can silently stop
// happening. Allowlist EMPTY.
//
// LEG 3 is the residue: a link in a shipped SKILL whose target does not ship
// at all. A skill is an INSTRUCTION an agent executes on a paper folder, so a
// pointer to a file that is not there is a step it cannot take. Allowlist
// EMPTY — a hit is de-link it (name the file in prose) or declare the skill
// repo-only the way `dream`/`reflect`/`iterate-virgil-editor`/`iterate-skill`
// do, by opening their description with `Developer-only`.
//
// STATED LIMIT, and it is a real one. Leg 3's population is SKILL markdown,
// not every shipped file. The operational manifest (`docs/workspace/*.md`,
// shipped to `.claude/virgil/`) carries ~200 pointers into `src/**` and
// `docs/architecture/` — provenance notes for a maintainer reading the doc in
// the repo, not navigation an agent performs — and whether a reference doc
// should carry them at all is a product question about that doc's audience,
// not a fact this guard can derive. Leg 2 still covers its links whose targets
// DO ship (its siblings, and its pointers into the skill set), which is the
// half that was silently broken.
//
// And a third leg keeps the myth from growing back in the place it lived: no
// skill markdown may claim transclusion. Scoped to skill markdown, which is
// what an AGENT reads; the same phrase inside a `.ts` comment is a note to a
// developer and is left to review.

import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
// WHAT SHIPS, WHERE IT LANDS, and THE BYTES IT SHIPS WITH — the same SSOT the
// four builders read, so this guard cannot come to disagree with them about
// either half of the question (task 506).
import {
  shippedBytes,
  shippedPathMap,
  shippedSources,
  SUBSYSTEMS,
} from "../../build/bundle-sources.mjs";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SILOS = ["editor/skills", "library/skills"] as const;

/** The subsystems that author skill markdown — leg 3's population. */
const SKILL_SUBSYSTEMS = SUBSYSTEMS.filter((s: string) => s !== "manifest");

/** The set of folder-relative disk paths the bundle puts on a managed folder,
 *  memoised per map so leg 2 asks it once. */
const diskPathCache = new WeakMap<Map<string, string>, Set<string>>();
function SHIPPED_DISK_PATHS(map: Map<string, string>): Set<string> {
  let set = diskPathCache.get(map);
  if (!set) {
    set = new Set(map.values());
    diskPathCache.set(map, set);
  }
  return set;
}

/** Relative markdown links whose target may legally be absent from the
 *  linking file's own silo. DELIBERATELY EMPTY, and it must stay that way:
 *  an entry is a pointer an agent following the doctrine gets nothing from.
 *  A hit is RESOLVE-it (or re-word the sentence so it carries no link). */
const PERMITTED_UNRESOLVABLE_LINKS: string[] = [];

/** Links in a SHIPPED file whose target also ships but which do not resolve at
 *  the target's shipped path. DELIBERATELY EMPTY: the bundle rewrite derives
 *  both halves from one map, so a hit means the rewrite stopped running. */
const PERMITTED_UNRESOLVED_SHIPPED_LINKS: string[] = [];

/** Links in a shipped SKILL pointing at a file that does not ship at all.
 *  DELIBERATELY EMPTY: an entry is a step an agent on a paper folder cannot
 *  take. A hit is DE-LINK it (name the file in prose), or declare the skill
 *  repo-only by opening its description with `Developer-only`. */
const PERMITTED_REPO_ONLY_POINTERS: string[] = [];

/** Skill cross-references still spelled with the bare `/<name>` form.
 *  DELIBERATELY EMPTY: both silos ship under a prefix, so the bare form
 *  resolves to nothing and an entry is a step an agent cannot take. A hit is
 *  QUALIFY-it (`/library/<name>` or `/editor/<name>`). */
const PERMITTED_BARE_SKILL_REFS: string[] = [];

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

/** Every RELATIVE markdown link in `src`, attributed to `file`. Takes the text
 *  rather than reading it, so the same grammar sweeps repo source and shipped
 *  bytes — two questions, one definition of "a link". */
function linksIn(file: string, src: string): Link[] {
  const out: Link[] = [];
  for (const m of src.matchAll(LINK)) {
    const href = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) continue; // absolute / anchor
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
      for (const link of linksIn(file, read(file))) {
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

  it("resolves every SHIPPED link at the target's SHIPPED path", async () => {
    const map = await shippedPathMap(repoRoot);
    // Every shipped markdown, whatever silo authored it — the manifest docs
    // are read from `.claude/virgil/` and their links must land too.
    const shippedMd: string[] = [];
    for (const subsystem of SUBSYSTEMS) {
      for (const src of await shippedSources(repoRoot, subsystem)) {
        if (src.repoPath.endsWith(".md")) shippedMd.push(src.repoPath);
      }
    }
    expect(shippedMd.length).toBeGreaterThan(20);

    const broken: string[] = [];
    let checked = 0;
    for (const file of shippedMd) {
      const fileDisk = map.get(file)!;
      // The bytes an agent on a synced folder actually reads.
      const shipped = shippedBytes(file, read(file), map);
      for (const link of linksIn(file, shipped)) {
        const target = link.href.split("#")[0];
        if (!target) continue;
        // Resolve the SHIPPED href against the file's own SHIPPED directory,
        // and require that it names a path the bundle puts there.
        const landsAt = posix.join(posix.dirname(fileDisk), target);
        if (!SHIPPED_DISK_PATHS(map).has(landsAt)) {
          // A pointer at something that does not ship is leg 3's question,
          // not this one — asked of the SOURCE href, below.
          const sourceTarget = posix.join(posix.dirname(file), target);
          if (!map.has(sourceTarget)) continue;
          broken.push(`${file}:${link.line} -> ${link.href} (lands at ${landsAt})`);
          continue;
        }
        checked++;
      }
    }
    // A rewrite that produced nothing would report green for the wrong reason.
    expect(checked).toBeGreaterThan(100);
    expect(
      broken.filter((b) => !PERMITTED_UNRESOLVED_SHIPPED_LINKS.includes(b)),
    ).toEqual([]);
    expect(PERMITTED_UNRESOLVED_SHIPPED_LINKS).toEqual([]);
  });

  it("lets no shipped SKILL point at a file that does not ship", async () => {
    const map = await shippedPathMap(repoRoot);
    const dead: string[] = [];
    for (const subsystem of SKILL_SUBSYSTEMS) {
      for (const src of await shippedSources(repoRoot, subsystem)) {
        if (!src.bundlePath.startsWith("claude-commands/")) continue;
        for (const link of linksIn(src.repoPath, read(src.repoPath))) {
          const target = link.href.split("#")[0];
          if (!target) continue;
          const repoTarget = posix.join(posix.dirname(src.repoPath), target);
          if (map.has(repoTarget)) continue;
          dead.push(`${src.repoPath}:${link.line} -> ${link.href}`);
        }
      }
    }
    expect(dead.filter((d) => !PERMITTED_REPO_ONLY_POINTERS.includes(d))).toEqual([]);
    expect(PERMITTED_REPO_ONLY_POINTERS).toEqual([]);
  });

  it("names every cross-referenced SKILL by its qualified `/<silo>/<name>` path", () => {
    // A skill markdown reference is an INSTRUCTION the reader may follow, and
    // both silos ship under a prefix — `.claude/commands/editor/` and
    // `.claude/commands/library/` — so `/library/<name>` and `/editor/<name>`
    // are the invocable names and the bare `/<name>` resolves to nothing.
    //
    // The editor silo has been fully qualified since it shipped, including
    // its own `# /editor/<name> $ARGUMENTS` title headers; the library silo
    // was MIXED — measured on the pre-510 tree, **97 bare references against
    // 108 qualified ones in the same files** — a shared stale convention
    // rather than one file's slip (task 510; the residue task 444's sweep
    // left). Two of the editor silo's own usage examples (150 qualified) had
    // drifted the same way.
    //
    // POPULATION DISCOVERED from the skill files themselves, so a new skill
    // is covered by existing. Allowlist EMPTY: a hit is QUALIFY-it.
    const silo = new Map<string, string>();
    for (const file of skillFiles()) {
      const [dir, name] = [file.split("/")[0], file.split("/")[2]];
      if (name.startsWith("_")) continue; // includes are reached by link
      silo.set(name.replace(/\.md$/, ""), dir);
    }
    expect(silo.size).toBeGreaterThan(20);

    // A `/`-led token whose first segment IS a skill basename, not already
    // carrying its silo. The left guard rejects a PATH segment
    // (`.virgil/scripts/library/…`, `papers/<ck>/index-paper`); the `\b` on
    // the right keeps `/deep-indexed` out.
    //
    // It deliberately does NOT reject a preceding BACKTICK, and that is the
    // hole this leg's own first cut had: excluding it saw 60 of those 99 and
    // hid the other 39, every one spelled inside a code span
    // (`` `/deep-index <citekey>` ``) — the form a skill is MOST likely to
    // use when it is telling the reader what to run, including
    // `/library/index-pending`'s own five-line dispatch table. A guard that
    // cannot see the common spelling is a habit.
    const names = [...silo.keys()].sort((a, b) => b.length - a.length).join("|");
    const BARE = new RegExp(`(?<![A-Za-z0-9_/.-])/(${names})\\b`, "g");

    const bare: string[] = [];
    for (const file of skillFiles()) {
      const src = read(file);
      for (const m of src.matchAll(BARE)) {
        bare.push(`${file}:${src.slice(0, m.index).split("\n").length} -> /${m[1]}`);
      }
    }
    expect(bare.filter((b) => !PERMITTED_BARE_SKILL_REFS.includes(b))).toEqual([]);
    expect(PERMITTED_BARE_SKILL_REFS).toEqual([]);

    // The needle must be able to SEE one — a regex that matched nothing would
    // report green for the wrong reason, and this one is built from a
    // discovered population that could silently come back empty.
    const canary =
      "See /deep-index, `/index-paper`, /editor/review, /library/setup and " +
      ".virgil/scripts/library/setup.py.";
    expect([...canary.matchAll(BARE)].map((m) => m[1])).toEqual([
      "deep-index",
      "index-paper",
    ]);
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
