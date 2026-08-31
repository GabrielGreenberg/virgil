// WHAT SHIPS, and WHERE IT LANDS — one answer, read by every builder, by the
// freshness guard, and by the link guard (task 2026-08-31-506).
//
// Four builders emit the skill bundle — `library/build/build-skill-bundle.mjs`,
// `editor/build/build-editor-bundle.mjs`, `virgil/build/build-virgil-bundle.mjs`
// and the manifest leg inside `scripts/build-meta-bundle.mjs` — and each one
// used to hand-write its own answer to "which files ship?". Two more copies of
// the same filters lived inside `skill-bundle-freshness.test.ts`
// (`skillNames`/`scriptNames`). Six statements of one fact, held together by
// nothing, is the fork this repo legislates against everywhere else; this file
// is the ONE statement, and `library/lib/skill-bundle-layout.mjs` remains the
// ONE statement of where a shipped file lands on disk.
//
// NODE-ONLY. It reads the filesystem, so — unlike the layout leaf beside it,
// which the browser's per-folder sync imports — nothing in `src/` or
// `library/lib/skill-sync.ts` may import this. It lives under `build/` to say
// so structurally.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THERE IS A REWRITE AT ALL.
//
// A skill is authored in the repo and READ on a user's synced folder, and the
// two layouts are not the same shape:
//
//     repo                        synced folder
//     editor/skills/X.md     →    .claude/commands/editor/X.md
//     editor/scripts/Y.py    →    .virgil/scripts/editor/Y.py
//     docs/workspace/Z.md    →    .claude/virgil/Z.md
//
// In the repo `editor/skills/` and `editor/scripts/` are siblings; on disk
// `.claude/commands/editor/` and `.virgil/scripts/editor/` are not. So a
// markdown link that resolves where the AUTHOR sits does not resolve where the
// READER is — measured on the pre-506 tree, 38 links in shipped skills: 25
// spelled `../scripts/<helper>.py` (landing at `.claude/commands/scripts/…`,
// which does not exist) and 13 spelled `../../docs/workspace/<doc>.md` (landing
// at `.claude/docs/workspace/…`, while the file itself sits two directories
// away at `.claude/virgil/<doc>.md`). A responder skill following one of those
// pointers on a real paper folder gets nothing.
//
// `skill-include-links.test.ts` (task 461) asserted only the REPO half of that
// question and named the gap as a stated limit — but its reasoning ("both
// builders map `<silo>/skills/*` → `claude-commands/*` and `<silo>/scripts/*` →
// `scripts/*`, so the relative shape survives") is true of the BUNDLE path and
// false of the DISK path, which is the one an agent reads from. That is why the
// 25 `../scripts/` links were counted as safe.
//
// THE REWRITE IS DERIVED, NOT A PREFIX TABLE. `rewriteMarkdownLinksForDisk`
// re-spells every relative link whose target SHIPS as the target's shipped path
// relative to the linking file's own shipped path — both halves read out of the
// same map, so the two cannot disagree by construction, and a link family
// nobody has written yet is correct for free. `rewriteScriptPathsForPaper`
// (the pre-existing prose-prefix rewrite, editor-only) stays what it was: it
// fixes `python3 editor/scripts/X.py` INVOCATIONS, which are not links.
//
// ─────────────────────────────────────────────────────────────────────────────
// REPO-ONLY SKILLS.
//
// Four skills are for a Virgil maintainer working on the skill set itself
// (`dream`, `reflect`, `iterate-virgil-editor`, `iterate-skill`). Each declares
// itself in the one place the corpus already reads that declaration: its
// description opens `Developer-only`, which is exactly the property
// `virgil/skills/start.md` rule 1 routes on ("A description that opens
// `Developer-only` is for a Virgil maintainer … Do not offer one to an end
// user"). The builders read the SAME declaration and do not ship them, which
// turns that rule from advisory into structural — a skill that is not there
// cannot be offered — and removes ~72 KB of no-op prompt from every paper
// folder. They are still MIRRORED into `.claude/commands/<silo>/`, because that
// mirror is the repo's own developer surface and is where `/editor:dream` is
// read from.
//
// Discovered, never a name list: a fifth developer skill inherits this by
// declaring itself the way the other four do.

import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { diskPathFor } from "../lib/skill-bundle-layout.mjs";

/** Every subsystem the meta-manifest carries, in `diskPathFor`'s vocabulary. */
export const SUBSYSTEMS = ["library", "editor", "virgil", "manifest"];

/** Silos that author skill markdown under `<silo>/skills/`. */
export const SKILL_SILOS = ["library", "editor", "virgil"];

/** Where the operational manifest is authored. */
export const MANIFEST_SRC_DIR = "docs/workspace";

async function listFilesIn(absDir, predicate) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && predicate(e.name))
    .map((e) => e.name)
    .sort();
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

/** True when a skill declares itself a maintainer skill the way the corpus
 *  already reads that declaration: its `description` opens `Developer-only`
 *  (`virgil/skills/start.md` rule 1). Read from the file, never a name list. */
export function isRepoOnlySkill(src) {
  const fm = FRONTMATTER.exec(src);
  if (!fm) return false;
  const lines = fm[1].split("\n");
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return false;
  // `description:` is a YAML block scalar in every skill here, so the text
  // normally starts on the NEXT line; the inline form is handled too.
  const inline = lines[i]
    .replace(/^description:\s*/, "")
    .replace(/^[|>][-+]?\s*/, "")
    .trim();
  const first = inline || lines.slice(i + 1).map((l) => l.trim()).find((l) => l !== "") || "";
  return /^developer-only/i.test(first);
}

/** Every `*.md` authored under `<silo>/skills/`, repo-only ones included. */
export async function skillFileNames(repoRoot, silo) {
  return listFilesIn(join(repoRoot, silo, "skills"), (n) => n.endsWith(".md"));
}

/** The names a silo mirrors into `.claude/commands/<silo>/` — the repo's own
 *  developer surface. `_`-prefixed includes are excluded because Claude Code
 *  registers every `.md` there as a slash command; repo-only skills are NOT,
 *  because running `/editor:dream` in this repo is the whole point of them. */
export async function commandMirrorNames(repoRoot, silo) {
  return (await skillFileNames(repoRoot, silo)).filter((n) => !n.startsWith("_"));
}

/** The skill markdown a silo SHIPS. Repo-only skills are dropped here and
 *  only here. `virgil` additionally drops `_`-includes, as its builder always
 *  has — its front door has no include family. */
async function shippedSkillNames(repoRoot, silo) {
  const names = await skillFileNames(repoRoot, silo);
  const kept = [];
  for (const name of names) {
    if (silo === "virgil" && name.startsWith("_")) continue;
    const src = await readFile(join(repoRoot, silo, "skills", name), "utf8");
    if (isRepoOnlySkill(src)) continue;
    kept.push(name);
  }
  return kept;
}

/** Helper files a silo ships under `scripts/`. Each predicate is that silo's
 *  own — the editor reads sibling `.json` data files at runtime, the library
 *  ships a `requirements.txt`. */
export async function scriptFileNames(repoRoot, silo) {
  const keep =
    silo === "editor"
      ? (n) => n.endsWith(".py") || n.endsWith(".json")
      : silo === "library"
        ? (n) => n.endsWith(".py") || n === "requirements.txt"
        : (n) => n.endsWith(".py");
  return listFilesIn(join(repoRoot, silo, "scripts"), keep);
}

/** The operational-manifest docs. `_`-prefixed files are includes, matching
 *  the skill builders' convention. */
export async function manifestFileNames(repoRoot) {
  return listFilesIn(
    join(repoRoot, MANIFEST_SRC_DIR),
    (n) => n.endsWith(".md") && !n.startsWith("_"),
  );
}

/** `{ repoPath, bundlePath }` for everything one subsystem ships. */
export async function shippedSources(repoRoot, subsystem) {
  if (subsystem === "manifest") {
    return (await manifestFileNames(repoRoot)).map((name) => ({
      repoPath: `${MANIFEST_SRC_DIR}/${name}`,
      bundlePath: name,
    }));
  }
  if (!SKILL_SILOS.includes(subsystem)) {
    throw new Error(`[bundle-sources] unknown subsystem "${subsystem}"`);
  }
  const skills = (await shippedSkillNames(repoRoot, subsystem)).map((name) => ({
    repoPath: `${subsystem}/skills/${name}`,
    bundlePath: `claude-commands/${name}`,
  }));
  const scripts = (await scriptFileNames(repoRoot, subsystem)).map((name) => ({
    repoPath: `${subsystem}/scripts/${name}`,
    bundlePath: `scripts/${name}`,
  }));
  // The library ships the workspace entry point as the folder's CLAUDE.md.
  const extra =
    subsystem === "library"
      ? [
          {
            repoPath: "library/scripts/skill-bundle-template/CLAUDE.md",
            bundlePath: "CLAUDE.md",
          },
        ]
      : [];
  return [...extra, ...skills, ...scripts];
}

/** repo path → folder-relative disk path, for everything the bundle ships.
 *  The ONE table both halves of the link rewrite read. */
export async function shippedPathMap(repoRoot) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const subsystem of SUBSYSTEMS) {
    for (const { repoPath, bundlePath } of await shippedSources(repoRoot, subsystem)) {
      const disk = diskPathFor(subsystem, bundlePath);
      if (disk) map.set(repoPath, disk);
    }
  }
  return map;
}

// ── The two transforms ───────────────────────────────────────────────────────

// Repo-relative helper-script INVOCATIONS (`python3 editor/scripts/X.py`), not
// links. Moved here from `build-editor-bundle.mjs` so both transforms sit
// beside the map they are derived from; the destination half of each pair is
// ASKED of the layout SSOT rather than restated.
//
// BOTH silos, because an editor skill legitimately reaches for a LIBRARY
// helper: `find-citation` shells out to `library/scripts/bib_auth.py` for the
// Library-first half of the find-or-surface doctrine.
//
// Idempotent: `.virgil/scripts/<silo>/` contains no `<silo>/scripts/`
// substring, so re-running never double-rewrites. Scoped to the trailing-slash
// path prefix, so it leaves the no-slash resolver fallback (`... editor/scripts;`
// in the answer-bib-review / sync-bib-to-library dual-path loops) intact.
const PAPER_SCRIPT_PREFIXES = [
  ["editor/scripts/", `${diskPathFor("editor", "scripts/")}`],
  ["library/scripts/", `${diskPathFor("library", "scripts/")}`],
];

/** Rewrite repo-relative helper-script paths to their synced-paper location. */
export function rewriteScriptPathsForPaper(text) {
  let out = text;
  for (const [repo, paper] of PAPER_SCRIPT_PREFIXES) {
    out = out.split(repo).join(paper);
  }
  return out;
}

/** `[text](href)`, with an optional `"title"`, captured in three pieces so the
 *  href alone can be replaced. Same link grammar `skill-include-links.test.ts`
 *  sweeps with — one shape of "what is a link", not two. */
const MD_LINK = /(\[[^\]\n]*\]\()([^)\s]+?)((?:\s+"[^"]*")?\))/g;

/** True for a href this rewrite has no business touching: a URL, a bare
 *  in-page anchor, a protocol-relative or root-absolute path. */
const NON_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * Re-spell every relative markdown link in one shipped file so it resolves
 * WHERE THE READER IS.
 *
 * A link whose target does not ship is left exactly as authored — the shipped
 * bytes then still carry an honest repo-relative pointer, and
 * `skill-include-links.test.ts` is what decides whether such a pointer belongs
 * in a shipped SKILL at all.
 *
 * @param {string} text     the file's repo source
 * @param {string} repoPath the file's own repo path
 * @param {Map<string,string>} map from `shippedPathMap`
 */
export function rewriteMarkdownLinksForDisk(text, repoPath, map) {
  const fromDisk = map.get(repoPath);
  if (!fromDisk) return text;
  const fromDiskDir = posix.dirname(fromDisk);
  const fromRepoDir = posix.dirname(repoPath);
  return text.replace(MD_LINK, (whole, open, href, close) => {
    if (NON_RELATIVE.test(href)) return whole;
    const hash = href.indexOf("#");
    const target = hash < 0 ? href : href.slice(0, hash);
    const frag = hash < 0 ? "" : href.slice(hash);
    if (!target) return whole;
    const targetDisk = map.get(posix.join(fromRepoDir, target));
    if (!targetDisk) return whole;
    const rel = posix.relative(fromDiskDir, targetDisk);
    if (!rel) return whole;
    return `${open}${rel}${frag}${close}`;
  });
}

/**
 * The bytes one repo file ships with — the ONE answer, so a builder and the
 * freshness guard can never disagree about what a mirrored copy should say.
 *
 * Markdown takes the link rewrite (every silo: a link is a link). The
 * prose-prefix rewrite stays EDITOR-ONLY, as it has been: library skills spell
 * their helpers at the synced path already, and the library corpus mentions
 * `library/scripts/` in prose about the REPO ("do not edit any file under
 * `library/skills/` or `library/scripts/`"), where rewriting one half of the
 * pair would make the sentence wrong. `virgil/skills/start.md` deliberately
 * names its helpers through a resolved prefix for the same reason (task 473).
 */
export function shippedBytes(repoPath, source, map) {
  if (!repoPath.endsWith(".md")) return source;
  let out = rewriteMarkdownLinksForDisk(source, repoPath, map);
  if (repoPath.startsWith("editor/skills/")) out = rewriteScriptPathsForPaper(out);
  return out;
}
