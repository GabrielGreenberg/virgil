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
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commandsDirFor } from "../../library/lib/skill-bundle-layout.mjs";
// What ships, where it lands, and the bytes it ships with — the ONE answer,
// read by every builder and by both guards (task 506). The two rewrites this
// builder used to own (`rewriteScriptPathsForPaper`, and now the derived
// markdown-link rewrite) live there, beside the map they are derived from.
import {
  commandMirrorNames,
  shippedBytes,
  shippedPathMap,
  shippedSources,
} from "../../library/build/bundle-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle", "editor");
// Routed through the layout SSOT (library/lib/skill-bundle-layout.mjs) — the
// same table the app's per-folder sync writes by, so the repo's dev mirror
// and a synced folder can never disagree about where a command lands.
const claudeCommandsDir = join(repoRoot, commandsDirFor("editor"));

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// The repo's own developer surface. Unlike the BUNDLE it carries repo-only
// maintainer skills (`/editor:dream` is read from here) and it is written from
// UNREWRITTEN source, because a maintainer runs a slash command with the repo
// root as cwd.
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

  const sources = await shippedSources(repoRoot, "editor");
  const map = await shippedPathMap(repoRoot);
  const filesForManifest = [];
  const sourceDigests = {};
  const hash = createHash("sha256");

  for (const src of sources) {
    const absSource = join(repoRoot, src.repoPath);
    if (!(await fileExists(absSource))) {
      throw new Error(`Editor bundle source missing: ${src.repoPath}`);
    }
    const raw = await readFile(absSource);
    // Markdown ships REWRITTEN — helper invocations re-prefixed and every
    // relative link re-spelled for the synced layout — so the shipped bytes
    // differ from the SSOT bytes BY DESIGN. Helper scripts ship verbatim.
    // Hash the SHIPPED bytes so the rewrite is reflected in the
    // content-addressed bundle version.
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
    // What this shipped copy was BUILT FROM. A drift check (`dream.py`'s §1
    // preflight) reads these instead of re-deriving the build's transforms:
    // the shipped bytes differ from the source by design, so a diff that does
    // not know every transform reports EVERY command markdown as drifted —
    // a false positive on every file, every night. A digest knows none of them
    // and cannot go stale when a transform is added.
    sourceDigests[src.bundlePath] = {
      repoPath: src.repoPath,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  }

  const skillNames = await commandMirrorNames(repoRoot, "editor");
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
