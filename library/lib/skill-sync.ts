// Synchronizes the on-disk skill bundle in a Virgil-managed folder
// (library OR paper) with the meta-bundle shipped in this app's
// public/skill-bundle/.
//
// On every doc-open and library-open, after the FSA folder handle is
// granted, we:
//   1. fetch /skill-bundle/bundle-manifest.json (the meta-manifest)
//   2. read .virgil/.skill-bundle-version.json from the user's folder
//   3. if versions differ, fetch every file listed in each sub-manifest
//      and overwrite; also delete stale files that left the bundle
//   4. write the new meta-manifest summary as .skill-bundle-version.json
//   5. write .virgil/library-path.json with the currently-configured
//      library absolute path (or null when no library is set)
//
// Bundle layout (produced by scripts/build-meta-bundle.mjs):
//
//   public/skill-bundle/
//     bundle-manifest.json            ← {version, sources: [...]}
//     library/
//       bundle-manifest.json          (sub-manifest, format unchanged)
//       CLAUDE.md
//       claude-commands/*.md
//       scripts/*.py
//     editor/
//       bundle-manifest.json
//       claude-commands/*.md
//       scripts/*.py
//
// On-disk rewrite (per-folder), keyed by `<subsystem>/<bundlePath>`:
//   library/CLAUDE.md                  → .claude/CLAUDE.md
//   library/claude-commands/X.md       → .claude/commands/library/X.md
//   library/scripts/X.py               → .virgil/scripts/library/X.py
//   editor/claude-commands/X.md        → .claude/commands/editor/X.md
//   editor/scripts/X.py                → .virgil/scripts/editor/X.py
//   manifest/X.md                      → .claude/virgil/X.md
//
// We use `claude-commands/` (no leading dot) inside the bundle because
// some static hosts skip hidden directories under public/. The disk
// rewrite restores the canonical `.claude/commands/...` location.
//
// The `manifest` subsystem is the operational manifest (docs/workspace/*.md,
// emitted by scripts/build-meta-bundle.mjs). Unlike commands/scripts it is
// Virgil-global, not subsystem-scoped, so it lands in a single per-folder
// `.claude/virgil/` rather than under a `<subsystem>/` segment.

import { readJsonFile, writeBinaryFile, writeJsonFile, writeTextFile, VIRGIL_DIR, CLAUDE_DIR } from "./library-storage";
import { publicAssetUrl } from "@/lib/public-asset-url";

interface SubManifest {
  version: string;
  generatedAt: string;
  files: string[];
}

interface MetaManifestSource {
  name: string;
  version: string;
  files: string[];
}

interface MetaManifest {
  version: string;
  generatedAt: string;
  sources: MetaManifestSource[];
}

interface OnDiskVersion {
  version: string;
  syncedAt: string;
  /** Bundle-relative paths (e.g. "library/scripts/foo.py"). Used at the
   *  next sync to detect files that left the bundle so they can be
   *  cleaned up from the folder. */
  files: string[];
}

const VERSION_PATH = `${VIRGIL_DIR}/.skill-bundle-version.json`;
const LIBRARY_PATH_PATH = `${VIRGIL_DIR}/library-path.json`;

/** Map `<subsystem>/<bundle-relative path>` to its on-disk destination.
 *  Returns undefined for paths whose subsystem we don't recognise — the
 *  caller skips them (defence against malformed manifests). Exported for
 *  unit testing of the routing table. */
export function diskPathFor(subsystem: string, bundlePath: string): string | undefined {
  // The workspace CLAUDE.md only ships from the library subsystem.
  if (subsystem === "library" && bundlePath === "CLAUDE.md") {
    return `${CLAUDE_DIR}/CLAUDE.md`;
  }
  // The operational manifest is Virgil-global: it lands in one shared
  // `.claude/virgil/`, not under a per-subsystem segment.
  if (subsystem === "manifest") {
    return `${CLAUDE_DIR}/virgil/${bundlePath}`;
  }
  if (bundlePath.startsWith("claude-commands/")) {
    const rest = bundlePath.slice("claude-commands/".length);
    return `${CLAUDE_DIR}/commands/${subsystem}/${rest}`;
  }
  if (bundlePath.startsWith("scripts/")) {
    const rest = bundlePath.slice("scripts/".length);
    return `${VIRGIL_DIR}/scripts/${subsystem}/${rest}`;
  }
  return undefined;
}

function bundleUrl(path: string): string {
  // Resolve relative to the deployed app origin so this works under both root
  // deploys and basePath deploys — through the ONE public-asset door (task 365,
  // which folded this hand-rolled prefix and its five twins onto one spelling).
  return publicAssetUrl(`/skill-bundle/${path}`);
}

export interface SyncResult {
  synced: boolean;
  version: string;
  filesWritten: number;
  removed: string[];
}

export interface SyncOptions {
  /** Absolute path of the currently-configured library, or null when no
   *  library is set up. Written to `<folder>/.virgil/library-path.json`
   *  so library skills running in this folder can resolve the root. */
  libraryRoot?: string | null;
}

export async function syncSkillBundle(
  handle: FileSystemDirectoryHandle,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { libraryRoot = null } = options;

  // 1. Fetch the top-level meta-manifest.
  const metaUrl = bundleUrl("bundle-manifest.json");
  const resp = await fetch(metaUrl, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`skill-sync: meta-manifest fetch failed (${resp.status} ${resp.statusText})`);
  }
  const meta = (await resp.json()) as MetaManifest;

  // 2. Read on-disk version stamp.
  const onDisk = await readJsonFile<OnDiskVersion>(handle, VERSION_PATH);
  const versionsMatch = onDisk?.version === meta.version;

  // Always (re)write the library-path pointer — it can change
  // independently of the bundle version (user picks a different library
  // folder), and rewriting is cheap.
  await writeJsonFile(handle, LIBRARY_PATH_PATH, { libraryRoot });

  if (versionsMatch) {
    return { synced: false, version: meta.version, filesWritten: 0, removed: [] };
  }

  // 3. Build the new full file list (bundle-relative, prefixed with
  //    subsystem name), and walk + write everything.
  const newFiles: string[] = [];
  for (const src of meta.sources) {
    for (const f of src.files) {
      newFiles.push(`${src.name}/${f}`);
    }
  }

  let written = 0;
  for (const fullBundlePath of newFiles) {
    const slash = fullBundlePath.indexOf("/");
    const subsystem = fullBundlePath.slice(0, slash);
    const bundlePath = fullBundlePath.slice(slash + 1);
    const diskPath = diskPathFor(subsystem, bundlePath);
    if (!diskPath) continue;

    const url = bundleUrl(fullBundlePath);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      throw new Error(`skill-sync: file fetch failed for ${fullBundlePath} (${r.status})`);
    }
    const blob = await r.blob();
    if (looksTextual(diskPath)) {
      const text = await blob.text();
      await writeTextFile(handle, diskPath, text);
    } else {
      await writeBinaryFile(handle, diskPath, blob);
    }
    written += 1;
  }

  // 4. Remove files that were in the previous bundle but no longer in
  //    this one. (Renaming a script or removing a skill cleans up.)
  const removed: string[] = [];
  if (onDisk?.files) {
    const newSet = new Set(newFiles);
    for (const oldFullBundlePath of onDisk.files) {
      if (newSet.has(oldFullBundlePath)) continue;
      const slash = oldFullBundlePath.indexOf("/");
      if (slash < 0) continue;
      const subsystem = oldFullBundlePath.slice(0, slash);
      const bundlePath = oldFullBundlePath.slice(slash + 1);
      const oldDiskPath = diskPathFor(subsystem, bundlePath);
      if (!oldDiskPath) continue;
      try {
        await deletePath(handle, oldDiskPath);
        removed.push(oldDiskPath);
      } catch {
        /* best-effort */
      }
    }
  }

  // 5. Write the new version stamp.
  const stamp: OnDiskVersion = {
    version: meta.version,
    syncedAt: new Date().toISOString(),
    files: newFiles,
  };
  await writeJsonFile(handle, VERSION_PATH, stamp);

  return { synced: true, version: meta.version, filesWritten: written, removed };
}

function looksTextual(diskPath: string): boolean {
  return /\.(md|txt|py|json|tex|bib|css|ts|tsx|js|jsx|mjs|html?)$/i.test(diskPath);
}

async function deletePath(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur: FileSystemDirectoryHandle = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      cur = await cur.getDirectoryHandle(parts[i]);
    } catch {
      return;
    }
  }
  await cur.removeEntry(parts[parts.length - 1]);
}
