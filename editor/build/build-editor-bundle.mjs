#!/usr/bin/env node
// Build the editor's skill bundle and mirror its skills into Virgil's
// project-level Claude Code commands.
//
// Two outputs:
//
//   1. public/skill-bundle/editor/<files>   — shipped as static assets
//                                             (Next.js `output: "export"`).
//      The frontend's skill-sync engine fetches the meta-manifest at
//      /skill-bundle/bundle-manifest.json (assembled by
//      scripts/build-meta-bundle.mjs from this builder's output and the
//      library builder's output), compares against the on-disk version
//      stamp in each Virgil-managed folder, and overwrites stale files.
//
//   2. .claude/commands/editor/<skill>.md   — mirrored from editor/skills/.
//      Surfaces the editor's slash commands as /editor:<skill> in any
//      session opened in this repo (developer workflow).
//
// Sources:
//   editor/skills/*.md                              (skill prompts)
//   editor/scripts/*.py                             (helper scripts)
//
// Versioning is content-addressed: a sha256 hash of the deterministic
// concatenation of file contents becomes the bundle version.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle", "editor");
const claudeCommandsDir = join(repoRoot, ".claude", "commands", "editor");

// ── Paper-bundle helper-script path rewrite ─────────────────────────────────
// Editor skill SOURCES invoke Python helpers repo-relative — `python3
// editor/scripts/X.py`. That is correct for the `.claude/commands/editor/` dev
// mirror, where a maintainer runs `/editor/<skill>` with the repo root as cwd
// (see mirrorSkillsIntoClaudeCommands, which writes from source, unrewritten).
//
// But in a synced paper folder the layout is INVERTED: skill-sync maps
// `editor/scripts/X.py` → `.virgil/scripts/editor/X.py` (library/lib/skill-sync.ts
// diskPathFor), and the paper root is cwd — so `editor/scripts/X.py` doesn't
// resolve there. Rather than sprinkle a dual-path resolver into every skill
// (surgical × N), we rewrite the prefix ONCE, at the bundle boundary, for the
// paper bundle's command markdowns only. Every current and future skill can
// then write the natural repo-relative form and be paper-correct for free.
//
// Idempotent: `.virgil/scripts/<silo>/` contains no `<silo>/scripts/`
// substring, so re-running never double-rewrites. Scoped to the trailing-slash
// path prefix, so it leaves the no-slash resolver fallback (`... editor/scripts;`
// in the answer-bib-review / sync-bib-to-library dual-path loops) intact — that
// literal is a bare candidate token, and those loops already prefer the
// `.virgil/scripts/editor` candidate first in a paper folder.
//
// BOTH silos, because an editor skill legitimately reaches for a LIBRARY
// helper: `find-citation` shells out to `library/scripts/bib_auth.py` for the
// Library-first half of the find-or-surface doctrine, and skill-sync writes
// every subsystem's scripts into every managed folder
// (`.virgil/scripts/library/…`). Rewriting only the editor prefix left that
// one invocation unresolvable in a paper folder — the same drift as a
// fabricated flag, in the path rather than the arguments (task 158).
const PAPER_SCRIPT_PREFIXES = [
  ["editor/scripts/", ".virgil/scripts/editor/"],
  ["library/scripts/", ".virgil/scripts/library/"],
];

/** True for the paper bundle's slash-command markdowns (claude-commands/*.md). */
export function isPaperCommandMarkdown(bundlePath) {
  return bundlePath.startsWith("claude-commands/") && bundlePath.endsWith(".md");
}

/** Rewrite repo-relative helper-script paths to their synced-paper location. */
export function rewriteScriptPathsForPaper(text) {
  let out = text;
  for (const [repo, paper] of PAPER_SCRIPT_PREFIXES) {
    out = out.split(repo).join(paper);
  }
  return out;
}

async function listFilesIn(dir, predicate) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && predicate(e.name))
    .map((e) => e.name)
    .sort();
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function buildSources() {
  const skillNames = await listFilesIn(
    join(repoRoot, "editor", "skills"),
    (n) => n.endsWith(".md"),
  );
  // `.py` scripts plus the data files they read at runtime (e.g.
  // `ai_request_routing.json`, resolved beside the script) — otherwise a script
  // that reads a sibling data file breaks when run from the distributed bundle.
  const scriptNames = await listFilesIn(
    join(repoRoot, "editor", "scripts"),
    (n) => n.endsWith(".py") || n.endsWith(".json"),
  );

  return [
    ...skillNames.map((name) => ({
      repoPath: `editor/skills/${name}`,
      bundlePath: `claude-commands/${name}`,
    })),
    ...scriptNames.map((name) => ({
      repoPath: `editor/scripts/${name}`,
      bundlePath: `scripts/${name}`,
    })),
  ];
}

async function mirrorSkillsIntoClaudeCommands(skillNames) {
  await rm(claudeCommandsDir, { recursive: true, force: true });
  await mkdir(claudeCommandsDir, { recursive: true });
  for (const name of skillNames) {
    const src = join(repoRoot, "editor", "skills", name);
    const dest = join(claudeCommandsDir, name);
    const content = await readFile(src);
    await writeFile(dest, content);
  }
}

async function main() {
  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });

  const sources = await buildSources();
  const filesForManifest = [];
  const hash = createHash("sha256");
  const skillNames = [];

  for (const src of sources) {
    const absSource = join(repoRoot, src.repoPath);
    if (!(await fileExists(absSource))) {
      throw new Error(`Editor bundle source missing: ${src.repoPath}`);
    }
    const raw = await readFile(absSource);
    // Paper bundle only: rewrite `editor/scripts/` → `.virgil/scripts/editor/`
    // so helper invocations resolve from the paper root (the dev mirror is
    // written separately, from unrewritten source). Hash the shipped bytes so
    // the rewrite is reflected in the content-addressed bundle version.
    const content = isPaperCommandMarkdown(src.bundlePath)
      ? Buffer.from(rewriteScriptPathsForPaper(raw.toString("utf8")), "utf8")
      : raw;
    const dest = join(bundleDir, src.bundlePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);

    hash.update(src.bundlePath);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");

    filesForManifest.push(src.bundlePath);
    if (src.bundlePath.startsWith("claude-commands/")) {
      const name = src.bundlePath.slice("claude-commands/".length);
      // Underscore-prefixed files (e.g. `_find-or-surface.md`) ship in
      // the bundle but are NOT mirrored as slash commands — they are
      // shared includes other skills reference via markdown links. This
      // matches the library builder's convention (build-skill-bundle.mjs)
      // so the include pattern is symmetric across both silos.
      if (!name.startsWith("_")) {
        skillNames.push(name);
      }
    }
  }

  const version = hash.digest("hex").slice(0, 12);
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    files: filesForManifest,
  };
  await writeFile(
    join(bundleDir, "bundle-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  await mirrorSkillsIntoClaudeCommands(skillNames);

  console.log(
    `[editor-bundle] v${version} — ${filesForManifest.length} files → ${relative(repoRoot, bundleDir)}/, ${skillNames.length} skills → ${relative(repoRoot, claudeCommandsDir)}/`,
  );
}

// Run the build only when invoked as a script (`node build-editor-bundle.mjs`),
// not when imported by a test for the pure transform helpers above.
const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[editor-bundle] failed:", err);
    process.exit(1);
  });
}
