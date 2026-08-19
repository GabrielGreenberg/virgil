#!/usr/bin/env node
// Build the Virgil front-door skill bundle and mirror its skills into
// Virgil's project-level Claude Code commands.
//
// Two outputs:
//
//   1. public/skill-bundle/virgil/<files>   — shipped as static assets
//                                             (Next.js `output: "export"`).
//      The frontend's skill-sync engine fetches the meta-manifest at
//      /skill-bundle/bundle-manifest.json (assembled by
//      scripts/build-meta-bundle.mjs from this builder's output and the
//      editor/library builders' outputs), compares against the on-disk
//      version stamp in each Virgil-managed folder, and overwrites stale
//      files.
//
//   2. .claude/commands/virgil/<skill>.md   — mirrored from virgil/skills/.
//      Surfaces the front-door's slash command as /virgil:<skill> in any
//      session opened in this repo (developer workflow).
//
// Sources:
//   virgil/skills/*.md                              (skill prompts)
//   virgil/scripts/*.py                             (helper scripts, optional)
//
// The `virgil` subsystem has no helper scripts at the moment; the
// front-door skill shells out to editor/scripts/library_path.py and
// editor/scripts/list_requests.py, which sync into
// .virgil/scripts/editor/ in every paper folder. If a virgil-specific
// helper becomes general enough to extract, drop it into
// virgil/scripts/*.py and this builder will pick it up automatically.
//
// Versioning is content-addressed: a sha256 hash of the deterministic
// concatenation of file contents becomes the bundle version.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandsDirFor } from "../../library/lib/skill-bundle-layout.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const bundleDir = join(repoRoot, "public", "skill-bundle", "virgil");
// Routed through the layout SSOT (library/lib/skill-bundle-layout.mjs) — the
// same table the app's per-folder sync writes by, so the repo's dev mirror
// and a synced folder can never disagree about where a command lands.
const claudeCommandsDir = join(repoRoot, commandsDirFor("virgil"));

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
    join(repoRoot, "virgil", "skills"),
    (n) => n.endsWith(".md") && !n.startsWith("_"),
  );
  const scriptNames = await listFilesIn(
    join(repoRoot, "virgil", "scripts"),
    (n) => n.endsWith(".py"),
  );

  return [
    ...skillNames.map((name) => ({
      repoPath: `virgil/skills/${name}`,
      bundlePath: `claude-commands/${name}`,
    })),
    ...scriptNames.map((name) => ({
      repoPath: `virgil/scripts/${name}`,
      bundlePath: `scripts/${name}`,
    })),
  ];
}

async function mirrorSkillsIntoClaudeCommands(skillNames) {
  await rm(claudeCommandsDir, { recursive: true, force: true });
  await mkdir(claudeCommandsDir, { recursive: true });
  for (const name of skillNames) {
    const src = join(repoRoot, "virgil", "skills", name);
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
      throw new Error(`Virgil bundle source missing: ${src.repoPath}`);
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
    `[virgil-bundle] v${version} — ${filesForManifest.length} files → ${relative(repoRoot, bundleDir)}/, ${skillNames.length} skills → ${relative(repoRoot, claudeCommandsDir)}/`,
  );
}

main().catch((err) => {
  console.error("[virgil-bundle] failed:", err);
  process.exit(1);
});
