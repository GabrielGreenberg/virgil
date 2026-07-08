// @vitest-environment node
//
// Drift guard for the cross-silo ALLOWABLE-LaTeX doctrine. The doctrine
// (`_latex-allowlist.md`) is authored ONCE but must ship in BOTH skill
// bundles (editor + library land in separate on-disk folders, so each silo
// carries a local copy for its skills' `[_latex-allowlist.md](...)` links to
// resolve). This test makes the two copies a single source of truth in
// practice: if they diverge, or if a `.tex`-writing skill drops its pointer
// back to the allowlist (re-paraphrasing the vocabulary inline — the very
// drift this task eliminates), the test fails.
//
// The renderer-SSOT ↔ inventory drift (a phantom command in the doc, or a
// cite command the parser gained but the doc lost) is caught by a separate
// coherence check (`tools/check-coherence.mjs`, check #6 "allowlist"); this
// test guards silo-parity + link-not-paraphrase, mirroring
// `find-or-surface-doctrine.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const LIBRARY_DOCTRINE = "library/skills/_latex-allowlist.md";
const EDITOR_DOCTRINE = "editor/skills/_latex-allowlist.md";

// Skills that MUST reference the allowlist rather than re-paraphrase it. The
// path is relative to each skill (same directory), so the link text is the
// bare filename. The library side references it transitively through
// `_latex-output.md` (the library appendix), which itself links the allowlist.
const REFERENCING_SKILLS = [
  "editor/skills/find-citation.md",
  "editor/skills/draft-suggestion.md",
  "editor/skills/draft-footnote.md",
  "editor/skills/answer-note-request.md",
  "editor/skills/answer-report-request.md",
  "editor/skills/answer-cutter-comment.md",
  "editor/skills/answer-revision-request.md",
  "editor/skills/answer-todo-request.md",
  "editor/skills/answer-bib-review.md",
  "editor/skills/create-card.md",
  "editor/skills/edit-card.md",
  "editor/skills/style-merge.md",
  "library/skills/_latex-output.md",
];

describe("allowable-LaTeX doctrine (cross-silo SSOT)", () => {
  it("ships a byte-identical copy in each silo", () => {
    expect(read(EDITOR_DOCTRINE)).toBe(read(LIBRARY_DOCTRINE));
  });

  it("declares itself an include, not a slash command", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/Not a slash command/i);
  });

  it("prescribes the tie `~` and forbids `\\textasciitilde{}` for it", () => {
    const doc = read(LIBRARY_DOCTRINE);
    // The load-bearing rule the reported symptom (ex.\textasciitilde{}14)
    // violated: use `~`, never `\textasciitilde{}` for a non-breaking space.
    expect(doc).toContain("~");
    expect(doc).toContain("\\textasciitilde{}");
    expect(doc).toMatch(/tie|non-breaking space/i);
  });

  it("carries a machine-checked Command inventory block", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/##\s*Command inventory/i);
    expect(doc).toContain("```latex-allowlist");
  });

  it.each(REFERENCING_SKILLS)("%s links to the allowlist, not a paraphrase", (skill) => {
    expect(read(skill)).toContain("_latex-allowlist.md");
  });
});
