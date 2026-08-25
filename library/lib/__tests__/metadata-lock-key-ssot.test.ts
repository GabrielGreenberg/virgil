// @vitest-environment node
//
// The metadata-lock catalog key ↔ the prose that teaches it (task 449).
//
// `metadataLock: true` is the ONLY block-the-pass condition in the whole
// deep-index convergence loop — one of the four reasons the pipeline may
// emit `DEEP_INDEX_STALLED`. It is a key an operator sets BY HAND (there is
// no UI), so the skill prose is the only place anyone learns how to spell
// it. Before this guard the prose and the reader had forked: every doctrine
// site spelled the key `metadata-lock` (kebab) while the sole reader,
// `apply_metadata_mismatch_policy.py`, read `metadataLock` (camelCase). A
// user following the docs literally wrote a key nothing reads, the pin was
// silently ignored, and the pass proceeded to rewrite the metadata they had
// pinned.
//
// Nothing throws in that failure. The catalog row is well-formed, the
// script's guard is intact, and the promise simply is not kept — which is
// why the drift survived for months across four doctrine sites.
//
// THE SSOT IS THE READER. `METADATA_LOCK_KEY` in
// `apply_metadata_mismatch_policy.py` is the one place the key is spelled;
// every leg below DERIVES the expected spelling from it, so renaming the
// key there fails this file rather than silently orphaning the docs again.
//
// TWO WORDS, NOT ONE. The camelCase `metadataLock` is the catalog KEY; the
// kebab `metadata-lock` is the STALLED REASON TOKEN printed in the banner
// beside `pathological-loop` / `validator-abort` / `extraction-empty-body`.
// Both spellings are legitimate — in different roles — so the census below
// forbids the kebab only in the shape that makes it a key
// (`metadata-lock: true`, `"metadata-lock":`), never the bare token.
//
// Prose: library/skills/_doctrine.md §4.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SSOT = "library/scripts/apply_metadata_mismatch_policy.py";
const CATALOG_TS = "library/lib/catalog.ts";
const DOCTRINE = "library/skills/_doctrine.md";
const DEEP_INDEX = "library/skills/deep-index.md";
const SKILLS_DIR = "library/skills";

/** This file's own path, excluded from the census: it must spell the
 *  forbidden shape in order to forbid it. */
const SELF = "library/lib/__tests__/metadata-lock-key-ssot.test.ts";

const ssot = read(SSOT);

/** The one spelling of the catalog key, read out of the reader. */
const KEY = (() => {
  const m = ssot.match(/^METADATA_LOCK_KEY = "([A-Za-z0-9_]+)"$/m);
  if (!m) throw new Error(`${SSOT} no longer publishes METADATA_LOCK_KEY`);
  return m[1];
})();

/** Files under library/skills/ that mention the lock at all. DISCOVERED —
 *  a fifth doctrine site inherits every leg by mentioning it. */
function skillsMentioningLock(): string[] {
  return readdirSync(join(repoRoot, SKILLS_DIR))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${SKILLS_DIR}/${f}`)
    .filter((rel) => /metadata[-_]?lock/i.test(read(rel)));
}

/** Every tracked source/prose file the census sweeps. */
function censusFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (/\.(ts|tsx|py|md|json)$/.test(e.name) && child !== SELF) out.push(child);
    }
  };
  walk("library");
  walk("src");
  return out;
}

describe("metadata-lock: one key, one spelling", () => {
  it("the reader publishes the key as a constant and reads it through that constant", () => {
    expect(KEY).toBe("metadataLock");
    // No inline literal: the lookup goes through the constant, or the
    // reason string below could report a key the lookup does not use.
    expect(ssot).toMatch(/catalog_row\.get\(METADATA_LOCK_KEY\)/);
    expect(ssot).not.toMatch(/catalog_row\.get\("\w/);
  });

  it("the block reason is DERIVED from the key, not spelled a second time", () => {
    // A hand-written reason string is a second speller of the key: it can
    // report `metadata-lock` while the lookup reads `metadataLock`, which
    // is exactly how an operator debugging a live block gets sent to the
    // wrong catalog field.
    expect(ssot).toMatch(
      /METADATA_LOCK_BLOCK_REASON = \(\s*\n\s*f"\{METADATA_LOCK_KEY\}: true on catalog row; pass blocked"/,
    );
    expect(ssot).toMatch(/"reason": METADATA_LOCK_BLOCK_REASON/);
  });

  it("the app declares the key on CatalogEntry, so the row round-trips with a name a reader can use", () => {
    const ts = read(CATALOG_TS);
    const entry = ts.slice(ts.indexOf("export interface CatalogEntry"));
    const body = entry.slice(0, entry.indexOf("\n}"));
    expect(body).toMatch(new RegExp(`\\n\\s*${KEY}\\?: boolean;`));
  });
});

describe("metadata-lock: the prose teaches the key the reader consumes", () => {
  const sites = skillsMentioningLock();

  it("discovers the doctrine sites", () => {
    // Canary: a discovery that silently found nothing would make every
    // leg below pass vacuously.
    expect(sites.length).toBeGreaterThanOrEqual(4);
    expect(sites).toContain(DOCTRINE);
  });

  it.each(sites)("%s spells the exact catalog key", (rel) => {
    expect(read(rel)).toContain(KEY);
  });

  it("no file spells the kebab form AS A KEY", () => {
    // The bare token `metadata-lock` is the STALLED reason and is fine;
    // what is forbidden is the shape that reads as a catalog field.
    // Allowlist is EMPTY — a hit is RENAME-it.
    const shape = /metadata-lock"?\s*:\s*(true|false)|"metadata-lock"\s*:/;
    const hits = censusFiles().filter((rel) => shape.test(read(rel)));
    expect(hits).toEqual([]);
  });

  it("every quotation of the block reason matches the emitter byte-for-byte", () => {
    const emitted = `${KEY}: true on catalog row; pass blocked`;
    const tail = "on catalog row; pass blocked";
    for (const rel of censusFiles()) {
      const text = read(rel);
      if (!text.includes(tail)) continue;
      for (const line of text.split("\n")) {
        if (!line.includes(tail)) continue;
        // The emitter itself builds the string from the constant.
        if (rel === SSOT && line.includes("METADATA_LOCK_KEY")) continue;
        expect(line, `${rel}: stale quotation of the block reason`).toContain(
          emitted,
        );
      }
    }
  });

  it("the doctrine carries an executable set-it recipe, so the pin is reachable", () => {
    // The affordance was documented for months with no writer, no catalog
    // field and no way to set it. A doctrine that promises to honour a pin
    // must say how the pin is made.
    const doctrine = read(DOCTRINE);
    const section = doctrine.slice(
      doctrine.indexOf("**4. The only block-the-pass exception"),
      doctrine.indexOf("**5. Outstanding-work categories"),
    );
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain("update_catalog_entry.py");
    expect(section).toContain(`"${KEY}": true`);
  });
});

describe("the DEEP_INDEX_STALLED enumeration is honest", () => {
  /** The machine-facing token list, from deep-index.md's Output format. */
  const tokens = (() => {
    const m = read(DEEP_INDEX).match(/^\s*Reason: <([^>]+)>$/m);
    if (!m) throw new Error(`${DEEP_INDEX} no longer prints a Reason token list`);
    return m[1].split("|").map((t) => t.trim());
  })();

  it("declares the four reasons", () => {
    expect(tokens).toContain("metadata-lock");
    expect(tokens.length).toBeGreaterThanOrEqual(4);
  });

  /** `_doctrine.md`'s §0 STALLED bullet — the canonical enumeration.
   *  Scoped to the BULLET, not the file: the tokens also appear in §4's
   *  prose, so a file-wide `toContain` passes on a bullet that has lost
   *  one (measured — that was this leg's first draft). */
  const stalledBullet = (() => {
    const d = read(DOCTRINE);
    const start = d.indexOf("- `DEEP_INDEX_STALLED`");
    const end = d.indexOf("\n\nAnything else", start);
    if (start < 0 || end < 0) throw new Error(`${DOCTRINE} §0 bullet not found`);
    return d.slice(start, end);
  })();

  it.each(tokens)("the §0 STALLED bullet names the `%s` reason", (token) => {
    // §0 listed only THREE reasons while deep-index.md had named four
    // since the empty-body hard-stop was routed through the STALLED
    // banner — the canonical doctrine's own enumeration was short by one.
    // Derived from the token list, never a hand count.
    expect(stalledBullet).toContain(token);
  });

  it("the doctrine enumerates the reasons ONCE", () => {
    // The anti-pattern-enforcement section used to restate them, and the
    // restatement is what fell behind. It defers to §0 now, so there is
    // one list to keep honest rather than two.
    const after = read(DOCTRINE).slice(
      read(DOCTRINE).indexOf("**Anti-pattern enforcement.**"),
    );
    for (const token of tokens) {
      if (token === "metadata-lock") continue; // §4's own rule lives past here
      expect(after, `reason token re-enumerated after §0`).not.toContain(token);
    }
  });
});

// ---------------------------------------------------------------------------
// The affordance is REAL, not merely well-spelled.
//
// Every leg above is about names. This one drives the shipped reader against
// a scratch library and asserts the pin actually blocks — including the leg
// with the teeth of the original finding: the KEBAB spelling does NOT block,
// which is precisely what a user following the pre-449 docs produced.
//
// Shells out to `python3` for the reason the sibling `*-python.test.ts`
// suites give: `npm test` is vitest-only, so a Python-side guarantee is
// advisory unless something runs it. If `python3` is unavailable this FAILS
// rather than skips — a guard that quietly opts out of the environment it
// protects is worthless.
// ---------------------------------------------------------------------------

/** Build a scratch library holding one paper, then ask the shipped policy
 *  script what it would do. `lockValue` is written under `lockKey`; pass
 *  `null` for no pin at all. */
function policyVerdict(
  lockKey: string | null,
  lockValue: unknown,
): { applied: boolean; blocked?: boolean; reason?: string; error?: string } {
  const root = mkdtempSync(join(tmpdir(), "virgil-lock-"));
  try {
    mkdirSync(join(root, ".virgil"), { recursive: true });
    mkdirSync(join(root, "papers", "k1999"), { recursive: true });
    const row: Record<string, unknown> = {
      citekey: "k1999",
      title: "A Chapter",
      addedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      pdf: { state: "present" },
      indexed: { state: "indexed" },
      bib: { state: "none" },
    };
    if (lockKey !== null) row[lockKey] = lockValue;
    writeFileSync(
      join(root, ".virgil", "catalog.json"),
      JSON.stringify({ version: 1, generatedAt: row.addedAt, entries: [row] }),
    );
    // Present but empty: the gates the driver stubs are the only ones that
    // read them, and the cover-page read past the lock must FAIL loudly so a
    // lifted block is distinguishable from a silent no-op.
    writeFileSync(join(root, "papers", "k1999", "k1999.pdf"), "");
    writeFileSync(join(root, "papers", "k1999", "main.tex"), "\\title{A Chapter}\n");

    // Stub the two gates that precede the lock (a real book PDF is not a
    // fixture we can carry); everything after the stubs is shipped code.
    const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(repoRoot, "library", "scripts"))})
import apply_metadata_mismatch_policy as m
m._detect_kind = lambda ck: "file-is-book-bib-is-chapter"
m._pdf_page_count = lambda p: 300
print(json.dumps(m.apply("k1999", dry_run=True)))
`;
    const out = execFileSync("python3", ["-c", driver], {
      encoding: "utf8",
      env: { ...process.env, VIRGIL_LIBRARY_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out.trim().split("\n").pop() as string);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("metadata-lock: the pin actually blocks", () => {
  it(`\`${KEY}: true\` blocks the pass before any read`, () => {
    const v = policyVerdict(KEY, true);
    expect(v.blocked).toBe(true);
    expect(v.applied).toBe(false);
    // The reason names the key the reader consumes.
    expect(v.reason).toBe(`${KEY}: true on catalog row; pass blocked`);
    // It never reached the cover page — the unlocked runs below do.
    expect(v.error).toBeUndefined();
  });

  it("an unpinned row is not blocked", () => {
    for (const [k, val] of [[null, null], [KEY, false]] as const) {
      const v = policyVerdict(k, val);
      expect(v.blocked).toBeUndefined();
      // Proceeds past the gate into the cover-page read, which the empty
      // fixture PDF fails — the observable proof the block lifted.
      expect(v.error).toBeDefined();
    }
  });

  it("the KEBAB spelling does NOT block — the original finding, pinned", () => {
    // This is what a user following the pre-449 doctrine wrote. It sets a
    // key nothing reads and the pass proceeds to rewrite the metadata they
    // believed they had pinned. Nothing throws; nothing is logged.
    const v = policyVerdict("metadata-lock", true);
    expect(v.blocked).toBeUndefined();
    expect(v.error).toBeDefined();
  });
});
