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
// and bubbles the live range up via `PaneState.searchHighlightRange`;
// EditorLayout DELETES its dead `useState` and reads the value back from
// `paneState`. These are source-level guards (the components can't be unit-
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

  it("bubbles the live range up through PaneState", () => {
    // The field must be declared on PaneState AND populated in the payload.
    expect(EDITOR_PANE).toMatch(
      /searchHighlightRange:\s*\{\s*from:\s*number;\s*to:\s*number\s*\}\s*\|\s*null;/,
    );
    // The onPaneStateChange payload includes it (bare-key shorthand).
    const payloadStart = EDITOR_PANE.indexOf("onPaneStateChange({");
    expect(payloadStart).toBeGreaterThan(-1);
    const payload = EDITOR_PANE.slice(payloadStart, payloadStart + 1200);
    expect(payload).toContain("searchHighlightRange,");
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

  it("reads the live search highlight back from paneState", () => {
    expect(EDITOR_LAYOUT).toContain(
      "const searchHighlightRange = paneState?.searchHighlightRange ?? null;",
    );
  });
});
