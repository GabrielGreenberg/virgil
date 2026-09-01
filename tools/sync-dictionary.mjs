#!/usr/bin/env node
/**
 * Vendor the Hunspell English dictionary into `public/` (task 518).
 *
 * `dictionary-en` ships its `.aff`/`.dic` behind an ESM entry that reads them
 * with `node:fs`, so the package is unusable in a browser as an import: the
 * spellchecker's Worker FETCHES the two files as static assets instead. They
 * therefore have to live under `public/` — committed, so a fresh clone works
 * with no postinstall step, and so the service worker can precache them.
 *
 * The npm package stays a DEV dependency — nothing in the app imports it (it
 * could not: `node:fs`), so it ships in no bundle. It is kept because it is the
 * SOURCE OF TRUTH this script copies from, and because
 * `dictionary-asset.test.ts` re-reads it to pin that the committed bytes still
 * match. Run this after bumping the dictionary; that test is what makes
 * forgetting a failure rather than a silently stale word list.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const src = join(repo, "node_modules", "dictionary-en");
const dest = join(repo, "public", "dictionaries", "en");

mkdirSync(dest, { recursive: true });
for (const name of ["index.aff", "index.dic", "license"]) {
  copyFileSync(join(src, name), join(dest, name === "license" ? "LICENSE" : name));
}
const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
console.log(`vendored dictionary-en@${pkg.version} → public/dictionaries/en/`);
