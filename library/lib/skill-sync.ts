// Synchronizes the on-disk skill bundle in the user's library folder
// with the version shipped in this app's public/skill-bundle/.
//
// On every app launch, after the FSA folder handle is granted, we:
//   1. fetch /skill-bundle/bundle-manifest.json
//   2. read .skill-bundle-version.json from the user's folder
//   3. if versions differ, fetch every file in the manifest and overwrite
//   4. write the new manifest as .skill-bundle-version.json
//
// Bundle paths use `claude-commands/...` (no leading dot) because some
// static hosts skip hidden directories under public/. The on-disk
// destinations are rewritten when writing into the library folder so the
// user's library root stays clean (only master.bib / papers/ / unsorted/
// remain visible). See PREFIX_REWRITE / FILE_REWRITE below.

import { readJsonFile, writeBinaryFile, writeJsonFile, writeTextFile, VIRGIL_DIR, CLAUDE_DIR } from "./library-storage";

interface BundleManifest {
  version: string;
  generatedAt: string;
  files: string[];
}

interface OnDiskVersion {
  version: string;
  syncedAt: string;
  files: string[];
}

const VERSION_PATH = `${VIRGIL_DIR}/.skill-bundle-version.json`;
// Bundle path → on-disk path. Order matters; first match wins.
const PREFIX_REWRITE: Array<[string, string]> = [
  ["claude-commands/", `${CLAUDE_DIR}/commands/`],
  ["scripts/", `${VIRGIL_DIR}/scripts/`],
];
// Exact-match rewrites for individual files at the bundle root.
const FILE_REWRITE: Record<string, string> = {
  "CLAUDE.md": `${CLAUDE_DIR}/CLAUDE.md`,
};

function bundleUrl(path: string): string {
  // Resolve relative to the deployed app origin so this works under both
  // root deploys and basePath deploys (Next.js's basePath is honored by
  // browser-relative URLs starting with /).
  const base =
    typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BASE_PATH
      ? process.env.NEXT_PUBLIC_BASE_PATH
      : "";
  return `${base}/skill-bundle/${path}`;
}

function diskPathForBundlePath(bundlePath: string): string {
  if (FILE_REWRITE[bundlePath]) return FILE_REWRITE[bundlePath];
  for (const [from, to] of PREFIX_REWRITE) {
    if (bundlePath.startsWith(from)) {
      return to + bundlePath.slice(from.length);
    }
  }
  return bundlePath;
}

export interface SyncResult {
  synced: boolean;
  version: string;
  filesWritten: number;
  removed: string[];
}

export async function syncSkillBundle(
  handle: FileSystemDirectoryHandle,
): Promise<SyncResult> {
  // 1. Fetch the bundle manifest.
  const manifestUrl = bundleUrl("bundle-manifest.json");
  const resp = await fetch(manifestUrl, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`skill-sync: manifest fetch failed (${resp.status} ${resp.statusText})`);
  }
  const manifest = (await resp.json()) as BundleManifest;

  // 2. Read on-disk version.
  const onDisk = await readJsonFile<OnDiskVersion>(handle, VERSION_PATH);
  if (onDisk?.version === manifest.version) {
    return { synced: false, version: manifest.version, filesWritten: 0, removed: [] };
  }

  // 3. Fetch each file and write it into the library folder.
  let written = 0;
  for (const bundlePath of manifest.files) {
    const url = bundleUrl(bundlePath);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      throw new Error(`skill-sync: file fetch failed for ${bundlePath} (${r.status})`);
    }
    const blob = await r.blob();
    const diskPath = diskPathForBundlePath(bundlePath);
    if (looksTextual(diskPath)) {
      const text = await blob.text();
      await writeTextFile(handle, diskPath, text);
    } else {
      await writeBinaryFile(handle, diskPath, blob);
    }
    written += 1;
  }

  // 4. Remove files that were in the previous bundle but no longer in
  // this one. (Renaming a script or removing a skill cleans up.)
  const removed: string[] = [];
  if (onDisk?.files) {
    const newSet = new Set(manifest.files);
    for (const oldBundlePath of onDisk.files) {
      if (!newSet.has(oldBundlePath)) {
        const oldDiskPath = diskPathForBundlePath(oldBundlePath);
        try {
          await deletePath(handle, oldDiskPath);
          removed.push(oldDiskPath);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  // 5. Write the new version stamp.
  const stamp: OnDiskVersion = {
    version: manifest.version,
    syncedAt: new Date().toISOString(),
    files: manifest.files,
  };
  await writeJsonFile(handle, VERSION_PATH, stamp);

  return { synced: true, version: manifest.version, filesWritten: written, removed };
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
