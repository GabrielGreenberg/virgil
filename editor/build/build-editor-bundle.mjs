#!/usr/bin/env node
// Mirror the editor's skill markdown into the repo's `.claude/commands/editor/`
// folder so any Claude Code session opened in this repo surfaces them as
// `/editor/<name>` slash commands.
//
// Editor skills run against a user-picked paper folder (passed as `<docPath>`),
// so unlike the library bundle we do NOT emit a `public/skill-bundle/` for
// end-user sync today. Skills shell out to Python helpers via paths relative
// to this repo (`editor/scripts/*.py`); when an end-user-folder sync becomes
// needed, this script can grow a bundle output the way `library/build/
// build-skill-bundle.mjs` does.

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const skillsSrcDir = join(repoRoot, "editor", "skills");
const claudeCommandsDir = join(repoRoot, ".claude", "commands", "editor");

async function listSkillFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

async function main() {
  const names = await listSkillFiles(skillsSrcDir);

  await rm(claudeCommandsDir, { recursive: true, force: true });
  await mkdir(claudeCommandsDir, { recursive: true });

  for (const name of names) {
    const src = join(skillsSrcDir, name);
    const dest = join(claudeCommandsDir, name);
    const content = await readFile(src);
    await writeFile(dest, content);
  }

  console.log(
    `[editor-bundle] ${names.length} skills → ${relative(repoRoot, claudeCommandsDir)}/`,
  );
}

main().catch((err) => {
  console.error("[editor-bundle] failed:", err);
  process.exit(1);
});
