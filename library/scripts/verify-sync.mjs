#!/usr/bin/env node
// Dev-only end-to-end sync verifier.
//
// Mirrors what src/lib/skill-sync.ts does at runtime, but via Node fetch
// against a running dev server rather than browser FSA. Used to confirm
// the bundle endpoints are reachable, the manifest is correct, and the
// path-rewrite produces the expected layout in the user's library folder.
//
// Usage: node scripts/verify-sync.mjs [<libraryRoot>] [<bundleOrigin>]

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const libraryRoot = resolve(process.argv[2] || `${process.env.HOME}/Virgil-Library`);
const bundleOrigin = process.argv[3] || `http://localhost:54564`;

const PREFIX_REWRITE = [["claude-commands/", ".claude/commands/"]];

function diskPath(bundlePath) {
  for (const [from, to] of PREFIX_REWRITE) {
    if (bundlePath.startsWith(from)) {
      return to + bundlePath.slice(from.length);
    }
  }
  return bundlePath;
}

async function main() {
  const manifest = await fetch(`${bundleOrigin}/skill-bundle/bundle-manifest.json`).then((r) =>
    r.json(),
  );
  console.log(`[verify-sync] manifest v${manifest.version}, ${manifest.files.length} files`);

  for (const bp of manifest.files) {
    const url = `${bundleOrigin}/skill-bundle/${bp}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    const text = await r.text();
    const dest = join(libraryRoot, diskPath(bp));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, text);
  }
  await writeFile(
    join(libraryRoot, ".skill-bundle-version.json"),
    JSON.stringify(
      { version: manifest.version, syncedAt: new Date().toISOString(), files: manifest.files },
      null,
      2,
    ) + "\n",
  );
  console.log(`[verify-sync] wrote ${manifest.files.length} files to ${libraryRoot}`);
}

main().catch((err) => {
  console.error("[verify-sync] failed:", err);
  process.exit(1);
});
