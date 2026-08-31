#!/usr/bin/env node
// Build the library's skill bundle and mirror its skills into Virgil's
// project-level Claude Code commands.
//
// Two outputs:
//
//   1. public/skill-bundle/library/<files>   — shipped as static assets
//                                              (Next.js `output: "export"`).
//      The frontend's skill-sync engine fetches the meta-manifest at
//      /skill-bundle/bundle-manifest.json (assembled by
//      scripts/build-meta-bundle.mjs from this builder's output and the
//      editor builder's output), compares against the on-disk version
//      stamp in each Virgil-managed folder, and overwrites stale files.
//
//   2. .claude/commands/library/<skill>.md   — mirrored from library/skills/.
//      Surfaces the library's slash commands as /library:<skill> in any
//      session opened in this repo (developer workflow).
//
// Sources:
//   library/skills/*.md                              (skill prompts)
//   library/scripts/*.py, library/scripts/requirements.txt   (Python pipeline)
//   library/scripts/skill-bundle-template/CLAUDE.md  (workspace entry-point)
//
// Versioning is content-addressed: a sha256 hash of the deterministic
// concatenation of file contents becomes the bundle version. Same input
// → same hash → no spurious "synced" toasts.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandsDirFor } from "../lib/skill-bundle-layout.mjs";
// What ships, where it lands, and the bytes it ships with — the ONE answer,
// read by every builder and by both guards (task 506).
import {
  commandMirrorNames,
  shippedBytes,
  shippedPathMap,
  shippedSources,
} from "./bundle-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle", "library");
// Routed through the layout SSOT (library/lib/skill-bundle-layout.mjs) — the
// same table the app's per-folder sync writes by, so the repo's dev mirror
// and a synced folder can never disagree about where a command lands.
const claudeCommandsDir = join(repoRoot, commandsDirFor("library"));

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function mirrorSkillsIntoClaudeCommands(skillNames) {
  // The repo's own developer surface. Only non-underscore names — Claude Code's
  // loader registers every `.md` here as a slash command — and, unlike the
  // BUNDLE, repo-only maintainer skills are mirrored here: `/library:iterate-skill`
  // is read from this directory.
  await rm(claudeCommandsDir, { recursive: true, force: true });
  await mkdir(claudeCommandsDir, { recursive: true });
  for (const name of skillNames) {
    const src = join(repoRoot, "library", "skills", name);
    const dest = join(claudeCommandsDir, name);
    const content = await readFile(src);
    await writeFile(dest, content);
  }
}

async function main() {
  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });

  const sources = await shippedSources(repoRoot, "library");
  const map = await shippedPathMap(repoRoot);
  const filesForManifest = [];
  const sourceDigests = {};
  const hash = createHash("sha256");

  for (const src of sources) {
    const absSource = join(repoRoot, src.repoPath);
    if (!(await fileExists(absSource))) {
      throw new Error(`Skill bundle source missing: ${src.repoPath}`);
    }
    const raw = await readFile(absSource);
    // Markdown ships REWRITTEN (links re-spelled for the synced layout);
    // helper scripts ship verbatim, byte for byte.
    const content = src.repoPath.endsWith(".md")
      ? Buffer.from(shippedBytes(src.repoPath, raw.toString("utf8"), map), "utf8")
      : raw;
    const dest = join(bundleDir, src.bundlePath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);

    hash.update(src.bundlePath);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");

    filesForManifest.push(src.bundlePath);
    // What this shipped copy was BUILT FROM. A drift check reads these rather
    // than re-deriving the build's transforms (see build-editor-bundle.mjs).
    sourceDigests[src.bundlePath] = {
      repoPath: src.repoPath,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  }

  const skillNames = await commandMirrorNames(repoRoot, "library");
  const version = hash.digest("hex").slice(0, 12);
  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    files: filesForManifest,
    sourceDigests,
  };
  await writeFile(
    join(bundleDir, "bundle-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  await mirrorSkillsIntoClaudeCommands(skillNames);

  console.log(
    `[skill-bundle] v${version} — ${filesForManifest.length} files → ${relative(repoRoot, bundleDir)}/, ${skillNames.length} skills → ${relative(repoRoot, claudeCommandsDir)}/`,
  );
}

main().catch((err) => {
  console.error("[skill-bundle] failed:", err);
  process.exit(1);
});
