#!/usr/bin/env node
// Build the library's skill bundle and mirror its skills into Virgil's
// project-level Claude Code commands.
//
// Two outputs:
//
//   1. public/skill-bundle/<files>           — shipped as static assets
//                                              (Next.js `output: "export"`).
//      The frontend fetches /skill-bundle/bundle-manifest.json on launch,
//      compares to ~/Virgil-Library/.skill-bundle-version.json, and
//      overwrites stale files in the user's library folder. This keeps
//      the user's library folder a self-contained Claude Code workspace
//      that auto-updates.
//
//   2. .claude/commands/library/<skill>.md   — mirrored from library/skills/.
//      Surfaces the library's slash commands as /library/<skill> in any
//      session opened in this repo.
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
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle");
const claudeCommandsDir = join(repoRoot, ".claude", "commands", "library");

async function listFilesIn(dir, predicate) {
  const entries = await readdir(join(repoRoot, dir), { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && predicate(e.name))
    .map((e) => e.name)
    .sort();
}

async function buildSources() {
  const skillNames = await listFilesIn("library/skills", (n) => n.endsWith(".md"));
  const scriptNames = await listFilesIn(
    "library/scripts",
    (n) => n.endsWith(".py") || n === "requirements.txt",
  );

  return [
    // Workspace entry point.
    {
      repoPath: "library/scripts/skill-bundle-template/CLAUDE.md",
      bundlePath: "CLAUDE.md",
    },
    // Bundle path uses `claude-commands/` (no leading dot) because some
    // static hosts skip hidden directories under public/. The sync module
    // on the client rewrites this back to `.claude/commands/` when it
    // writes into the user's library folder.
    ...skillNames.map((name) => ({
      repoPath: `library/skills/${name}`,
      bundlePath: `claude-commands/${name}`,
    })),
    ...scriptNames.map((name) => ({
      repoPath: `library/scripts/${name}`,
      bundlePath: `scripts/${name}`,
    })),
  ];
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function mirrorSkillsIntoClaudeCommands(skillNames) {
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

  const sources = await buildSources();
  const filesForManifest = [];
  const hash = createHash("sha256");
  const skillNames = [];

  for (const src of sources) {
    const absSource = join(repoRoot, src.repoPath);
    if (!(await fileExists(absSource))) {
      throw new Error(`Skill bundle source missing: ${src.repoPath}`);
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
      skillNames.push(src.bundlePath.slice("claude-commands/".length));
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
    `[skill-bundle] v${version} — ${filesForManifest.length} files → ${relative(repoRoot, bundleDir)}/, ${skillNames.length} skills → ${relative(repoRoot, claudeCommandsDir)}/`,
  );
}

main().catch((err) => {
  console.error("[skill-bundle] failed:", err);
  process.exit(1);
});
