#!/usr/bin/env node
// Refresh the skill mirror inside every IN-REPO Virgil-managed folder from
// `public/skill-bundle/`, using the same routing table the app's per-folder
// sync writes by.
//
// Why this exists
// ---------------
// A skill is authored once (`editor/skills/*.md`, `library/skills/*.md`,
// `library/scripts/*.py`, …), but the prompt a run actually READS — and the
// helper a run actually EXECUTES — is a mirrored copy inside a managed folder.
// Until this script, only the RUNNING APP could write those copies (doc-open /
// library-open → `syncSkillBundle`). So `npm run build:skill-bundles` — the
// command the freshness guard names as its remedy — regenerated
// `public/skill-bundle/` and the repo's own `.claude/commands/`, and left the
// managed-folder mirrors untouched.
//
// That is not hypothetical. The 2026-07-11 dream's recursion guard landed on
// main and six consecutive nightly dreams still ran the pre-guard prompt,
// because the copy they read lived in `library-data/.claude/commands/editor/`.
// Measured on 2026-08-19, the same folder also carried 17 STALE helper
// SCRIPTS under `.virgil/scripts/{editor,library}/` — executables, not just
// prompts. Same class, wider blast radius, and no guard saw it.
//
// What it does NOT do
// -------------------
// It does not write `.virgil/.skill-bundle-version.json`. That stamp is the
// APP's record of what IT last synced; a build-time refresh must not claim a
// sync happened. Leaving it stale is also the honest outcome — the app's next
// open re-syncs and converges. (Concretely, in this repo that file is a
// TRACKED artifact, so writing it would dirty a shared checkout on every
// `npm run dev`.) The stamp is still READ, for the prune step below.
//
// Absent-is-fine: a fresh clone, or CI, has no managed folder here, so every
// candidate is skipped silently. This is a local-developer convenience, never
// a build requirement.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { diskPathFor, VIRGIL_DIR } from "../library/lib/skill-bundle-layout.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, "..");

/** The app's own sync stamp. Its PRESENCE is what marks a folder as managed. */
const STAMP_PATH = `${VIRGIL_DIR}/.skill-bundle-version.json`;

// Where in-repo managed folders live. `library-data/` is the dev-storage
// library workspace; `virgil-data/<id>/` are the dev-storage paper folders.
// Listed as CONTAINERS rather than named folders so a new dev paper is covered
// by existing, and every candidate is still gated on the stamp below — the
// build never CREATES a mirror, it only refreshes one the app already made.
const MANAGED_ROOT = ["library-data"];
const MANAGED_CONTAINERS = ["virgil-data"];

/** Folder-relative disk paths of every file the bundle currently ships. */
function bundleFileMap(meta) {
  /** @type {Map<string, string>} diskPath → bundle-relative fetch path */
  const map = new Map();
  for (const src of meta.sources ?? []) {
    for (const f of src.files ?? []) {
      const diskPath = diskPathFor(src.name, f);
      if (!diskPath) continue;
      map.set(diskPath, `${src.name}/${f}`);
    }
  }
  return map;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Enumerate in-repo folders the app has synced at least once. */
export async function localManagedRoots(repoRoot = defaultRepoRoot) {
  const roots = [];
  for (const name of MANAGED_ROOT) {
    roots.push(join(repoRoot, name));
  }
  for (const container of MANAGED_CONTAINERS) {
    let entries;
    try {
      entries = await readdir(join(repoRoot, container), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) roots.push(join(repoRoot, container, e.name));
    }
  }
  return roots.filter((r) => existsSync(join(r, STAMP_PATH)));
}

/**
 * Mirror one managed folder from the built bundle.
 *
 * Writes only files whose bytes actually differ (a `npm run dev` that changed
 * nothing must not touch a hundred mtimes), and prunes copies that left the
 * bundle since the folder's last recorded sync — the same cleanup step
 * `syncSkillBundle` step 4 performs, off the same stamp.
 *
 * @returns {Promise<{written: string[], removed: string[]}>}
 */
export async function syncLocalMirror({ bundleRoot, folderRoot }) {
  const meta = await readJson(join(bundleRoot, "bundle-manifest.json"));
  if (!meta) {
    throw new Error(
      `[local-mirrors] no meta-manifest at ${bundleRoot}/bundle-manifest.json — did scripts/build-meta-bundle.mjs run?`,
    );
  }
  const files = bundleFileMap(meta);

  const written = [];
  for (const [diskPath, bundlePath] of files) {
    const src = join(bundleRoot, bundlePath);
    const dest = join(folderRoot, diskPath);
    const next = await readFile(src);
    let current = null;
    try {
      current = await readFile(dest);
    } catch {
      /* absent — write it */
    }
    if (current && current.equals(next)) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, next);
    written.push(diskPath);
  }

  // Prune what left the bundle since the app's last sync. Only paths the
  // routing table recognises are touched, so nothing outside the mirror can
  // be reached by a malformed stamp.
  const removed = [];
  const stamp = await readJson(join(folderRoot, STAMP_PATH));
  for (const oldFull of stamp?.files ?? []) {
    const slash = String(oldFull).indexOf("/");
    if (slash < 0) continue;
    const diskPath = diskPathFor(oldFull.slice(0, slash), oldFull.slice(slash + 1));
    if (!diskPath || files.has(diskPath)) continue;
    const dest = join(folderRoot, diskPath);
    if (!existsSync(dest)) continue;
    await rm(dest, { force: true });
    removed.push(diskPath);
  }

  return { written, removed };
}

async function main() {
  const repoRoot = defaultRepoRoot;
  const bundleRoot = join(repoRoot, "public", "skill-bundle");
  const roots = await localManagedRoots(repoRoot);
  if (roots.length === 0) {
    console.log("[local-mirrors] no in-repo managed folders — nothing to refresh");
    return;
  }
  for (const folderRoot of roots) {
    const { written, removed } = await syncLocalMirror({ bundleRoot, folderRoot });
    const where = relative(repoRoot, folderRoot) || ".";
    console.log(
      `[local-mirrors] ${where} — ${written.length} refreshed, ${removed.length} pruned`,
    );
  }
}

// Run only when invoked as a script, not when imported by a test.
const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error("[local-mirrors] failed:", err);
    process.exit(1);
  });
}
