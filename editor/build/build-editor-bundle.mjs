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
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle", "editor");
const claudeCommandsDir = join(repoRoot, ".claude", "commands", "editor");

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
  const scriptNames = await listFilesIn(
    join(repoRoot, "editor", "scripts"),
    (n) => n.endsWith(".py"),
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
    const content = await readFile(absSource);
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

main().catch((err) => {
  console.error("[editor-bundle] failed:", err);
  process.exit(1);
});
