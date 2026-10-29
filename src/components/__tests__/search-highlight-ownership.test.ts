// T5 Pillar B — search-highlight ownership lives in EditorPane; EditorLayout's
// dead duplicate is gone.
//
// The bug class (SR-F3-01 / SR-F8-01 / SR-F1-01-jump): the search-highlight pipe
// was a migration orphan. `SearchHost` mounts INSIDE EditorPane and writes
// EditorPane's `searchHighlightRange` local — which was `void`-ed and never
// rendered — while EditorLayout kept a SECOND `useState` of the same name that
// NOTHING wrote, fed it into `effectiveHighlightRange`, and passed THAT down to
// the editor. So a result click set a value the renderer never read → no
// highlight, no scroll.
//
// The fix makes EditorPane the single owner: it renders the highlight from its
// own local (`effectiveHighlightRange = searchHighlightRange ?? errorHighlightRange`)
// EditorLayout DELETES its dead `useState`. (It later read the range back off
// `paneState` to gate the legacy suggestions.json text highlight; task 1360
// retired that store, so neither the bubble slice nor the read survives.) These are source-level guards (the components can't be unit-
// mounted) that fail if the orphan is re-introduced.
//
// P5 item 4 update: the ERROR range is now ALSO owned locally in EditorPane
// (`useDiagnostics` supplies `errorHighlightRange`), so the merge reads the
// local error range instead of a bare `highlightRange` prop bubbled DOWN from
// EditorLayout — that cross-boundary seam (the very thing the old comment
// flagged) is gone. EditorPane now owns BOTH sides of the merge.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf8");
}

const EDITOR_PANE = read("EditorPane.tsx");
const EDITOR_LAYOUT = read("EditorLayout.tsx");

describe("EditorPane owns the search highlight", () => {
  it("no longer `void`s the search highlight (it is rendered now)", () => {
    // The literal admission of the half-finished migration.
    expect(EDITOR_PANE).not.toContain("void searchHighlightRange");
  });

  it("renders its own search highlight (search ?? error) into the editor", () => {
    // The editor's highlightRange prop must read the effective range. Both sides
    // of the merge are now EditorPane-local: `searchHighlightRange` (SearchHost)
    // and `errorHighlightRange` (useDiagnostics) — no error-range prop is bubbled
    // DOWN from EditorLayout anymore (P5 item 4).
    expect(EDITOR_PANE).toContain(
      "const effectiveHighlightRange = searchHighlightRange ?? errorHighlightRange;",
    );
    expect(EDITOR_PANE).toContain("highlightRange={effectiveHighlightRange}");
  });

  it("does not bubble the range up — its only reader was retired (task 1360)", () => {
    // The layout read `paneState.searchHighlightRange` solely to gate the
    // legacy suggestions.json TEXT highlight; that store and the prop are
    // deleted, so the bubble slice would be a field nothing reads.
    expect(EDITOR_PANE).not.toMatch(/searchHighlightRange:\s*\{/);
  });
});

describe("EditorLayout's dead search state is gone", () => {
  it("no longer declares its own searchHighlightRange/searchState useState", () => {
    // The dead duplicates that nothing wrote.
    expect(EDITOR_LAYOUT).not.toMatch(
      /useState<\{[^}]*from[^}]*\}\s*\|\s*null>\(null\);\s*\/\/?[^\n]*search/i,
    );
    expect(EDITOR_LAYOUT).not.toContain(
      "const [searchHighlightRange, setSearchHighlightRange] = useState",
    );
    expect(EDITOR_LAYOUT).not.toContain(
      "const [searchState, setSearchState] = useState",
    );
  });

  it("does not import the dead SearchHost (it mounts only inside EditorPane)", () => {
    expect(EDITOR_LAYOUT).not.toContain(
      'import { SearchHost } from "./editor-layout/panels/search-host"',
    );
  });

  it("reads no search highlight at all (the text-highlight gate is gone, task 1360)", () => {
    expect(EDITOR_LAYOUT).not.toContain("searchHighlightRange");
  });
});
