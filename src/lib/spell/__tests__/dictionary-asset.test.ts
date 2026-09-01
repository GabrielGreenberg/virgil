// Task 2026-08-31-518 — the vendored dictionary, and the two places its paths
// are spelled.
//
// `dictionary-en` reads its files with `node:fs`, so it cannot be imported in a
// browser at all: the two Hunspell files are VENDORED into `public/` and
// FETCHED. That makes two things checkable rather than hopeful — the committed
// bytes still matching the package they were copied from, and the SERVICE
// WORKER precaching them by the same paths the app requests. A service worker
// cannot import TypeScript, so the two spellings are pinned against each other
// here; drift means the spellchecker is the one part of the app that silently
// stops working offline.
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DICTIONARY_ASSET_PATHS, dictionaryAssetUrls } from "@/lib/spell/dictionary-asset";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";

const read = (rel: string) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

describe("the vendored dictionary", () => {
  it("is committed under public/, at the declared paths", () => {
    for (const rel of Object.values(DICTIONARY_ASSET_PATHS)) {
      expect(existsSync(resolve(REPO_ROOT, "public", rel))).toBe(true);
    }
  });

  it("still matches the `dictionary-en` package it was copied from", () => {
    // The package stays a dependency BECAUSE it is the source of truth this
    // pins against. `tools/sync-dictionary.mjs` is the copier; forgetting to
    // re-run it after a bump is a failure here rather than a silently stale
    // word list.
    for (const [key, rel] of Object.entries(DICTIONARY_ASSET_PATHS)) {
      const vendored = read(resolve("public", rel));
      const source = read(resolve("node_modules/dictionary-en", `index.${key}`));
      expect(vendored).toBe(source);
    }
  });

  it("is US English — the resolved default", () => {
    // `color`/`center` present, `colour` absent. A British variant is a
    // different package (`dictionary-en-gb`) vendored the same way; this leg
    // is what makes swapping it a deliberate decision rather than a surprise.
    const dic = read(resolve("public", DICTIONARY_ASSET_PATHS.dic));
    expect(dic).toMatch(/^color\//m);
    expect(dic).not.toMatch(/^colour\b/m);
  });

  it("every URL goes through `publicAssetUrl` — the deploy door", () => {
    const urls = dictionaryAssetUrls();
    expect(urls.aff.endsWith(DICTIONARY_ASSET_PATHS.aff)).toBe(true);
    expect(urls.dic.endsWith(DICTIONARY_ASSET_PATHS.dic)).toBe(true);
  });
});

describe("the service worker precaches the SAME paths", () => {
  const sw = read("public/sw.js");

  it("lists both files, scope-relative", () => {
    for (const rel of Object.values(DICTIONARY_ASSET_PATHS)) {
      // Scope-relative by contract (task 365): a leading slash would discard
      // the SW's own scope and escape to the origin root, which under a
      // subdirectory deploy 404s every asset silently.
      expect(sw).toContain(`"./${rel}"`);
    }
  });

  it("…and folds them into the install-time precache list", () => {
    expect(sw).toMatch(/paths\s*=\s*\[[^\]]*DICTIONARY_PRECACHE/);
  });

  it("no production file builds a dictionary path by hand", () => {
    // The census with teeth: this module was never the part that could
    // misbehave — a fetch site that spells the path itself is, and it works
    // perfectly in dev (where `basePath` is "") while 404ing in production.
    const offenders: string[] = [];
    for (const rel of ["src/lib/spell/spell-client.ts", "src/lib/spell/spell-core.ts"]) {
      if (read(rel).includes("dictionaries/en/")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
