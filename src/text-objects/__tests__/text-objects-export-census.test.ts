// `src/text-objects/` exports nothing that nothing calls (task 1201).
//
// THE LAW
//
//   A value exported from any module under `src/text-objects/` is alive only if
//   something CALLS it. A re-export is not a caller, and a suite is not a
//   consumer. (docs/agents/laws/a-registry-earns-its-name-by-being-read.md)
//
// WHY THIS DIRECTORY. `active-text-object-context.tsx` published
// `ActiveTextObjectProvider` + `useActiveTextObject()` — "one subscription per
// editor for the resolved active text object" — and `Editor.tsx` mounted the
// provider around every editor. Nothing ever called the hook: the consumers the
// reactor-sweep memo planned to migrate onto it never moved. So every caret move
// (i.e. every keystroke) ran a `selectionUpdate` recompute that notified an
// always-empty subscriber set, it held a slot in the keystroke-subscriber
// guardrail's selection allowlist on a cost justification for work nobody read,
// and its 50 ms editor-ready poll outlived unmount. Beside it,
// `selection-payload.ts::wholeBlockSelectionIn` had zero callers of any kind.
// The shared export census already guarded `src/links/`, `src/cards/`, the
// menu primitive, `editor-layout/` and `lib/identity/` — not this directory, so
// nothing refused either. Both were deleted; this census is what stops the next.
//
// SCOPE — every git-tracked non-test module under `src/text-objects/`.
import { describe, expect, it } from "vitest";
import {
  censusFiles,
  deadExports,
  declaredExports,
  staleAllowlistEntries,
  swallowedInCensusedFiles,
} from "@/lib/__tests__/_export-census";
import { trackedFiles } from "@/lib/__tests__/_source-scan";

const ROOT = "src/text-objects";

const TEXT_OBJECTS = censusFiles(
  trackedFiles(ROOT, /\.tsx?$/)
    .map((abs) => abs.slice(abs.indexOf(`${ROOT}/`)))
    .filter((rel) => !rel.includes("__tests__")),
  ROOT,
);

/** Uncalled value exports deliberately kept, each with its reason.
 *
 *  An entry here is a claim that the export earns its keep WITHOUT a caller —
 *  a high bar. WIRE it or DELETE it; do not list it to make CI quiet. */
const PERMITTED_UNCALLED: Record<string, string> = {
  "types.ts::MIME_TEXTOBJECT":
    "A RESERVED wire name, documented as such in docs/agents/architecture.md " +
    "(the drag/drop MIME map: \"defined for future HTML5 drag-out producers\"). " +
    "In-app text-object drags ride the drop-mode session, not dataTransfer, so " +
    "nothing produces this MIME yet; the constant pins the spelling the day an " +
    "external drag-out lands. Retire this entry when that producer is wired.",
};

describe("src/text-objects/ exports nothing that nothing calls (task 1201)", () => {
  it("censuses real files", () => {
    // A census that silently scans nothing is compliance-shaped and worthless.
    const rels = TEXT_OBJECTS.map((f) => f.rel);
    expect(rels).toEqual(
      expect.arrayContaining(["text-object-registry.ts", "selection-payload.ts", "types.ts"]),
    );
    expect(declaredExports(TEXT_OBJECTS).size).toBeGreaterThan(30);
  });

  it("the scanner swallowed no line of a censused file", () => {
    expect(swallowedInCensusedFiles(TEXT_OBJECTS)).toEqual([]);
  });

  it("every value export has a non-test caller", () => {
    expect(deadExports(TEXT_OBJECTS, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the allowlist has no stale entries — still declared, still uncalled", () => {
    expect(staleAllowlistEntries(TEXT_OBJECTS, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the deleted active-text-object provider is gone, not renamed", () => {
    const declared = [...declaredExports(TEXT_OBJECTS).keys()].map((k) => k.split("::")[1]);
    expect(declared).not.toContain("ActiveTextObjectProvider");
    expect(declared).not.toContain("useActiveTextObject");
    expect(declared).not.toContain("wholeBlockSelectionIn");
  });
});
