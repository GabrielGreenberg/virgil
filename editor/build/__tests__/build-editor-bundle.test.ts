import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  rewriteScriptPathsForPaper,
  shippedBytes,
  shippedPathMap,
} from "../../../library/build/bundle-sources.mjs";

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
//
// Both transforms moved to `library/build/bundle-sources.mjs` in task 506, so
// they sit beside the shipped-path map the SECOND one (the markdown-link
// rewrite) is derived from. `isPaperCommandMarkdown` went with them — as a
// DELETION rather than a move: `shippedBytes` decides which transforms a file
// takes from the file's own repo path, so a separate predicate had no caller
// left, and a dead one is what the next author reaches for. Its two legs are
// renegotiated in place at the bottom of this file against `shippedBytes`,
// which is the question they were really asking.

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

  it("maps the LIBRARY helper prefix too", () => {
    // An editor skill legitimately reaches for a library helper —
    // find-citation shells out to bib_auth.py for the Library-first half of
    // the find-or-surface doctrine — and skill-sync lands library scripts at
    // `.virgil/scripts/library/` in every managed folder. Before task 158 only
    // the editor prefix moved, so that one invocation was unresolvable from a
    // paper root: the same drift as a fabricated flag, in the path.
    expect(
      rewriteScriptPathsForPaper("python3 library/scripts/bib_auth.py --query x"),
    ).toBe("python3 .virgil/scripts/library/bib_auth.py --query x");
    const once = rewriteScriptPathsForPaper("python3 library/scripts/bib_auth.py");
    expect(rewriteScriptPathsForPaper(once)).toBe(once);
  });

  it("leaves the bare (no-slash) library candidate token intact", () => {
    // The dual-path loops carry `library/scripts` with NO trailing slash as a
    // resolver candidate. It is a token, not a path prefix, and the
    // trailing-slash scoping is what keeps it out of the rewrite.
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

describe("shippedBytes", () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

  it("gives an editor skill BOTH transforms — links and helper prefixes", async () => {
    const map = await shippedPathMap(repoRoot);
    const out = shippedBytes(
      "editor/skills/review.md",
      "See [x](../scripts/card_by_id.py) and run `python3 editor/scripts/card_by_id.py`.\n",
      map,
    );
    // The LINK is re-spelled relative to where the shipped copy sits
    // (`.claude/commands/editor/` → three up, then `.virgil/scripts/editor/`);
    // the INVOCATION takes the prose-prefix rewrite it always did.
    expect(out).toContain("[x](../../../.virgil/scripts/editor/card_by_id.py)");
    expect(out).toContain("python3 .virgil/scripts/editor/card_by_id.py");
  });

  it("gives a LIBRARY skill the link rewrite and NOT the prose-prefix one", async () => {
    // The library corpus talks about `library/scripts/` as a REPO path ("do
    // not edit any file under `library/skills/` or `library/scripts/`"), where
    // rewriting one half of the pair would make the sentence wrong. Its skills
    // already spell helper invocations at the synced path.
    const map = await shippedPathMap(repoRoot);
    const out = shippedBytes(
      "library/skills/deep-index.md",
      "Do not edit `library/scripts/`. See [d](_doctrine.md).\n",
      map,
    );
    expect(out).toContain("Do not edit `library/scripts/`.");
    expect(out).toContain("[d](_doctrine.md)");
  });

  it("ships helper scripts and data files byte-for-byte", async () => {
    const map = await shippedPathMap(repoRoot);
    const py = "run('editor/scripts/x.py')\n";
    expect(shippedBytes("editor/scripts/apply_response.py", py, map)).toBe(py);
    expect(shippedBytes("editor/scripts/ai_request_routing.json", py, map)).toBe(py);
  });
});

describe("paper-bundle guardrail over real skill sources", () => {
  it("finds the skill sources", () => {
    // Guard against a broken glob silently asserting over nothing.
    expect(skillSources.length).toBeGreaterThan(20);
  });

  it("every skill's paper copy resolves helpers under .virgil/scripts/", () => {
    // After the build rewrite, no paper-bundle markdown may still reference a
    // repo-relative `<silo>/scripts/` prefix — every such reference would break
    // when the skill runs from a paper-folder cwd. If a new skill invokes a
    // helper via a path form this substring rewrite can't reach, this fails.
    for (const { name, text } of skillSources) {
      const rewritten = rewriteScriptPathsForPaper(text);
      for (const prefix of ["editor/scripts/", "library/scripts/"]) {
        expect(
          rewritten,
          `${name}: paper bundle still references ${prefix}`,
        ).not.toContain(prefix);
      }
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
