import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isPaperCommandMarkdown,
  rewriteScriptPathsForPaper,
} from "../build-editor-bundle.mjs";

// The editor skill bundle ships two copies of every command markdown:
//   • the DEV MIRROR (.claude/commands/editor/*.md) — written from source,
//     unrewritten; its cwd is the repo root, so `editor/scripts/X.py` resolves.
//   • the PAPER BUNDLE (public/skill-bundle/editor/claude-commands/*.md) —
//     rewritten by the build so `editor/scripts/X.py` → `.virgil/scripts/editor/X.py`,
//     because skill-sync lands helpers at `.virgil/scripts/editor/` and the
//     paper root is cwd there (library/lib/skill-sync.ts diskPathFor).
//
// This suite pins the rewrite that bridges the two layouts. It is the guardrail
// against a skill (current or future) whose helper invocation would silently
// fail in a real synced paper folder — the failure the build rewrite exists to
// prevent, and which is invisible in dev because cwd happens to be the repo.

const skillsDir = fileURLToPath(new URL("../../skills", import.meta.url));
const skillSources = readdirSync(skillsDir)
  .filter((n) => n.endsWith(".md"))
  .map((name) => ({ name, text: readFileSync(`${skillsDir}/${name}`, "utf8") }));

describe("rewriteScriptPathsForPaper", () => {
  it("maps the repo-relative helper prefix to the synced-paper location", () => {
    expect(rewriteScriptPathsForPaper("python3 editor/scripts/list_requests.py .")).toBe(
      "python3 .virgil/scripts/editor/list_requests.py .",
    );
  });

  it("is idempotent — the target path contains no `editor/scripts/` substring", () => {
    const once = rewriteScriptPathsForPaper("python3 editor/scripts/apply_response.py");
    expect(rewriteScriptPathsForPaper(once)).toBe(once);
  });

  it("leaves the library helper prefix untouched", () => {
    // sync-bib-to-library reaches into `.virgil/scripts/library/…` — only the
    // EDITOR prefix is a paper/repo mismatch; the library one must not move.
    const s = 'for p in (".virgil/scripts/library", "library/scripts")';
    expect(rewriteScriptPathsForPaper(s)).toBe(s);
  });

  it("leaves the no-slash resolver-fallback candidate intact", () => {
    // The dual-path loops in answer-bib-review / sync-bib-to-library carry a
    // bare `editor/scripts` (no trailing slash) fallback candidate; it is not a
    // path prefix and must survive the rewrite.
    const s = "for candidate in .virgil/scripts/editor editor/scripts; do";
    expect(rewriteScriptPathsForPaper(s)).toBe(s);
  });
});

describe("isPaperCommandMarkdown", () => {
  it("selects command markdowns (including underscore includes)", () => {
    expect(isPaperCommandMarkdown("claude-commands/review.md")).toBe(true);
    expect(isPaperCommandMarkdown("claude-commands/_find-or-surface.md")).toBe(true);
  });

  it("rejects helper scripts and data files", () => {
    expect(isPaperCommandMarkdown("scripts/apply_response.py")).toBe(false);
    expect(isPaperCommandMarkdown("scripts/ai_request_routing.json")).toBe(false);
    expect(isPaperCommandMarkdown("bundle-manifest.json")).toBe(false);
  });
});

describe("paper-bundle guardrail over real skill sources", () => {
  it("finds the skill sources", () => {
    // Guard against a broken glob silently asserting over nothing.
    expect(skillSources.length).toBeGreaterThan(20);
  });

  it("every skill's paper copy resolves helpers under .virgil/scripts/editor/", () => {
    // After the build rewrite, no paper-bundle markdown may still reference the
    // repo-relative `editor/scripts/` prefix — every such reference would break
    // when the skill runs from a paper-folder cwd. If a new skill invokes a
    // helper via a path form this substring rewrite can't reach, this fails.
    for (const { name, text } of skillSources) {
      expect(
        rewriteScriptPathsForPaper(text),
        `${name}: paper bundle still references editor/scripts/`,
      ).not.toContain("editor/scripts/");
    }
  });

  it("the rewrite is load-bearing — sources stay repo-relative for the dev mirror", () => {
    // The transform must actually change the invocation-bearing skills; if a
    // well-meaning edit switched the SOURCES to `.virgil/scripts/editor/`, the
    // dev mirror (repo cwd) would break instead. Assert the source still speaks
    // repo-relative and only the transform paper-izes it.
    const review = skillSources.find((s) => s.name === "review.md");
    expect(review?.text).toContain("python3 editor/scripts/list_requests.py");
    expect(rewriteScriptPathsForPaper(review!.text)).toContain(
      "python3 .virgil/scripts/editor/list_requests.py",
    );
  });
});
