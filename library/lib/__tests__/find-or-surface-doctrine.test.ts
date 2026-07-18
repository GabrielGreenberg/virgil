// @vitest-environment node
//
// Drift guard for the cross-silo "find-or-surface, never fabricate"
// doctrine. The doctrine is authored ONCE but must ship in BOTH skill
// bundles (editor + library land in separate on-disk folders, so each
// silo carries a local `_find-or-surface.md` for its skills'
// `[_find-or-surface.md](_find-or-surface.md)` links to resolve). This
// test makes the two copies a single source of truth in practice: if
// they diverge, or if a core citation/bib skill drops its pointer back
// to the doctrine (re-paraphrasing the rule inline — the very drift this
// task eliminates), the test fails.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const LIBRARY_DOCTRINE = "library/skills/_find-or-surface.md";
const EDITOR_DOCTRINE = "editor/skills/_find-or-surface.md";

// Skills that MUST reference the doctrine rather than re-paraphrase it.
// The path is relative to each skill (same directory), so the link text
// is the bare filename in both silos. This list is the MIRROR IMAGE of
// the doctrine body's own enumeration (`_find-or-surface.md`): every
// sourcing skill named there — anything that can mint, authenticate, or
// synthesize a real bib entry / cite command — must link back here, and
// a future skill silently dropping the pointer fails CI. Keep the two in
// sync (same discipline as `latex-allowlist-doctrine.test.ts`).
const REFERENCING_SKILLS = [
  "editor/skills/find-citation.md",
  "editor/skills/answer-bib-review.md",
  "editor/skills/draft-footnote.md",
  "editor/skills/sync-bib-to-library.md",
  "library/skills/authenticate-bib.md",
  "library/skills/import-bib.md",
  "library/skills/merge-bibs.md",
  "library/skills/clean-bibliography.md",
];

describe("find-or-surface doctrine (cross-silo SSOT)", () => {
  it("ships a byte-identical copy in each silo", () => {
    expect(read(EDITOR_DOCTRINE)).toBe(read(LIBRARY_DOCTRINE));
  });

  it("declares itself an include, not a slash command", () => {
    const doc = read(LIBRARY_DOCTRINE);
    // Leading-underscore filename + the header note both gate command
    // registration; assert the load-bearing header marker is present.
    expect(doc).toMatch(/Not a slash command/i);
  });

  it("carries the Library-first + never-fabricate steps", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/Never fabricate/i);
    expect(doc).toMatch(/Search the Library first/i);
    expect(doc).toMatch(/surface the gap/i);
  });

  it.each(REFERENCING_SKILLS)("%s links to the doctrine, not a paraphrase", (skill) => {
    expect(read(skill)).toContain("_find-or-surface.md");
  });
});
