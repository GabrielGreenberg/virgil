// §1a regression guard — memoized hook returns.
//
// A custom hook whose body ends in a FRESH object/array literal return
// (`return { a, b, c }`) re-identifies its whole return on every render, even
// when every member is individually stable. Consumers that take the whole
// return as a memo-dep or thread it as a prop then over-render — and, in the
// keep-alive editor, this silently defeats `React.memo(EditorPane)` and inflates
// the warm paper-switch render cost (see PSR_PROFILING_FINDINGS.md / the
// MEMO_PERF_INVESTIGATION §1a sweep). `useWordCount` was the empirically-caught
// offender: its `return { counts, selection }` showed up as "changed" on every
// single render in the live profile.
//
// These hooks are consumed WHOLE (as memo-deps / props) in EditorPane /
// EditorLayout / LibraryView, so their return identity must be STABLE across a
// no-op re-render. The fix in each is `return useMemo(() => ({...}), [members])`.
// This guard fails if any of them regresses back to a bare-literal return,
// catching the whole class at the source rather than one hook at a time.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // src/hooks/__tests__
const SRC_HOOKS = resolve(HERE, ".."); // src/hooks
const REPO_ROOT = resolve(HERE, "..", "..", ".."); // repo root

// hook name → absolute source path. Every entry is consumed whole somewhere as
// a memo-dep/prop; adding a new such hook? Add it here.
const MEMOIZED_RETURN_HOOKS: Record<string, string> = {
  useWordCount: resolve(SRC_HOOKS, "useWordCount.ts"),
  useNotes: resolve(SRC_HOOKS, "useNotes.ts"),
  useTodos: resolve(SRC_HOOKS, "useTodos.ts"),
  useRevisions: resolve(SRC_HOOKS, "useRevisions.ts"),
  useCutter: resolve(SRC_HOOKS, "useCutter.ts"),
  useReports: resolve(SRC_HOOKS, "useReports.ts"),
  useFootnotes: resolve(SRC_HOOKS, "useFootnotes.ts"),
  useArchive: resolve(SRC_HOOKS, "useArchive.ts"),
  useAnnotations: resolve(SRC_HOOKS, "useAnnotations.ts"),
  useBibReview: resolve(SRC_HOOKS, "useBibReview.ts"),
  useAiRequests: resolve(SRC_HOOKS, "useAiRequests.ts"),
  useSuggestions: resolve(SRC_HOOKS, "useSuggestions.ts"),
  useExamples: resolve(SRC_HOOKS, "useExamples.ts"),
  useLibraryTabs: resolve(REPO_ROOT, "library/hooks/useLibraryTabs.ts"),
};

// The hook's OWN top-level return sits at 2-space indent. The memoized form is
// `  return useMemo(` (with an optional generic). We assert the POSITIVE: the
// hook must have a top-level `return useMemo(...)`. (We deliberately do NOT
// assert the absence of any `  return {` — helper functions inside the same
// file legitimately return bare literals, e.g. a migration default.)
const MEMOIZED_RETURN = /\n {2}return useMemo[<(]/;

describe("§1a — hooks consumed whole must return a memoized object", () => {
  for (const [hook, path] of Object.entries(MEMOIZED_RETURN_HOOKS)) {
    it(`${hook} returns a useMemo-wrapped value (not a fresh literal)`, () => {
      const src = readFileSync(path, "utf8");
      expect(
        MEMOIZED_RETURN.test(src),
        `${hook} (${path}) must end in a top-level \`return useMemo(...)\`. A bare ` +
          `\`return { ... }\` re-identifies every render and over-renders consumers ` +
          `(§1a). Wrap the return in useMemo with all members as deps.`,
      ).toBe(true);
    });
  }
});
