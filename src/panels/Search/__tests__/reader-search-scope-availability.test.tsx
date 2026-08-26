// @vitest-environment jsdom
//
// Task 485 — the Search panel joins the Library Reader's chrome, and a HOST's
// visible-panel whitelist is what its search may OFFER.
//
// Every scope but `mainText` ends its jump in a PANEL: `navigateToResult`
// calls `onOpenItem(SCOPE_PANEL[scope], itemId)`, which docks that panel into
// the live `dockStack`. A host that HIDES the panel (the Reader hides todos /
// archive / cutter / reports / revisions) still mounts every sidecar hook, so
// the hits are real — but the rail filters the docked band out and the click
// surfaces nothing. That is the false-affordance class ("what the hover OFFERS
// is what the commit ACCEPTS"), so the offer is DERIVED from the whitelist in
// ONE place rather than restated per host.
//
// The leg with teeth here is the CENSUS: the derivation was never the part
// that could misbehave — a host that hands the panel a literal is, and
// `availableScopes={SCOPE_ORDER}` type-checks perfectly.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Storage stub (the editor extension stack pulls @/lib/storage transitively).
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { useState } from "react";
import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  SCOPE_ORDER,
  SCOPE_PANEL,
  SCOPE_LABEL,
  scopesForVisiblePanels,
  type SearchScope,
} from "@/lib/search-sources";
import { READER_CHROME, FULL_CHROME } from "@/components/editor-layout/chrome-config";
import type { PanelKind } from "@/panels/_shared/types";
import type { TodoItem } from "@/lib/types";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
  type SearchPanelState,
} from "@/panels/Search/SearchPanel";

const SRC = join(process.cwd(), "src");

/* ── 1. The derivation ───────────────────────────────────────────────── */

describe("scopesForVisiblePanels — the offer follows the whitelist", () => {
  it("no whitelist (FULL_CHROME) offers every scope — the main editor is untouched", () => {
    expect(scopesForVisiblePanels(FULL_CHROME.visiblePanelKinds)).toEqual(
      SCOPE_ORDER,
    );
    expect(scopesForVisiblePanels(undefined)).toEqual(SCOPE_ORDER);
  });

  it("the Reader offers main text + its five panel-backed scopes, and NOT the five it hides", () => {
    expect(scopesForVisiblePanels(READER_CHROME.visiblePanelKinds)).toEqual([
      "mainText",
      "footnotes",
      "notes",
      "citations",
      "bibliography",
    ]);
  });

  // SWEPT from SCOPE_PANEL, so a new scope is covered by DECLARING itself
  // rather than by anyone remembering to extend a fixture list.
  it("per scope: a panel-backed scope tracks its panel's visibility; mainText never does", () => {
    let panelBacked = 0;
    let panelFree = 0;
    for (const scope of SCOPE_ORDER) {
      const panel = SCOPE_PANEL[scope];
      if (panel === undefined) {
        panelFree++;
        // Available against a whitelist that names nothing at all.
        expect(scopesForVisiblePanels([])).toContain(scope);
        continue;
      }
      panelBacked++;
      expect(scopesForVisiblePanels([panel])).toContain(scope);
      const withoutIt = (Object.values(SCOPE_PANEL) as PanelKind[]).filter(
        (p) => p !== panel,
      );
      expect(scopesForVisiblePanels(withoutIt)).not.toContain(scope);
    }
    // The sweep crossed BOTH shapes — otherwise it could pass vacuously.
    expect(panelFree).toBeGreaterThan(0);
    expect(panelBacked).toBeGreaterThan(0);
  });

  it("preserves SCOPE_ORDER (the chip order is the panel's order)", () => {
    const got = scopesForVisiblePanels(READER_CHROME.visiblePanelKinds);
    const expectedOrder = SCOPE_ORDER.filter((s) => got.includes(s));
    expect(got).toEqual(expectedOrder);
  });
});

/* ── 2. The panel honours it — offer AND search ──────────────────────── */

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-0" },
        content: [{ type: "text", text: "A paragraph with no keyword." }],
      },
    ],
  };
}

const TODO: TodoItem = {
  id: "todo-1",
  text: "Chase the ZEBRAFISH reference",
  notes: "",
  done: false,
  aiRequest: false,
  createdAt: "2026-08-25T00:00:00.000Z",
  links: [],
};

let editor: Editor;

beforeEach(() => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return () => {
    editor.destroy();
    element.remove();
    cleanup();
  };
});

function Harness({ availableScopes }: { availableScopes: SearchScope[] }) {
  // `enabledScopes` deliberately CARRIES "todos" — the panel state survives a
  // close/reopen and is shared with hosts that DO offer it, so the gate has to
  // be the intersection, not a hope that nobody ever enabled it.
  const [state, setState] = useState<SearchPanelState>({
    ...INITIAL_SEARCH_STATE,
    query: "ZEBRAFISH",
    enabledScopes: ["mainText", "todos"],
  });
  return (
    <SearchPanel
      editor={editor}
      onHighlightRange={vi.fn()}
      footnotes={[]}
      orphanedFootnotes={[]}
      notes={[]}
      citations={[]}
      editorCitations={[]}
      getCitationDisplayText={(c) => c}
      todos={[TODO]}
      archiveSnippets={[]}
      cutterCards={[]}
      reportCards={[]}
      comments={[]}
      bibEntries={[]}
      onOpenItem={vi.fn()}
      availableScopes={availableScopes}
      state={state}
      onStateChange={setState}
    />
  );
}

describe("SearchPanel — an unavailable scope is neither offered nor searched", () => {
  // The ACCEPTING CONTROL. Without it every leg below passes on a panel that
  // simply never finds anything.
  it("offers and searches todos when the host offers that scope", () => {
    const { container } = render(<Harness availableScopes={SCOPE_ORDER} />);
    expect(container.textContent).toContain("ZEBRAFISH");
    expect(container.querySelectorAll("[data-result-idx]").length).toBe(1);
  });

  it("under the Reader's whitelist the todo hit is NOT produced", () => {
    const reader = scopesForVisiblePanels(READER_CHROME.visiblePanelKinds);
    const { container } = render(<Harness availableScopes={reader} />);
    expect(container.querySelectorAll("[data-result-idx]").length).toBe(0);
    expect(container.textContent).toContain("No matches found");
  });

  it("under the Reader's whitelist no hidden scope is OFFERED as a chip or a row", () => {
    const reader = scopesForVisiblePanels(READER_CHROME.visiblePanelKinds);
    const { container } = render(<Harness availableScopes={reader} />);
    const text = container.textContent ?? "";
    for (const scope of SCOPE_ORDER) {
      if (reader.includes(scope)) continue;
      expect(text).not.toContain(SCOPE_LABEL[scope]);
    }
    // …and the ones it DOES offer are still reachable (the primary chips are
    // rendered inline; the rest live behind the dropdown, so assert the
    // primary pair rather than all five).
    expect(text).toContain(SCOPE_LABEL.mainText);
    expect(text).toContain(SCOPE_LABEL.footnotes);
  });
});

/* ── 3. The census — the leg with teeth ──────────────────────────────── */

describe("census — the HOST resolves the offer; nothing hands the panel a literal", () => {
  const hostSrc = readFileSync(
    join(SRC, "components/editor-layout/panels/search-host.tsx"),
    "utf8",
  );

  it("SearchHost derives availableScopes from the live chrome whitelist", () => {
    expect(hostSrc).toContain("useEditorChrome");
    expect(hostSrc).toContain("scopesForVisiblePanels(chrome.visiblePanelKinds)");
    expect(hostSrc).toContain("availableScopes={availableScopes}");
  });

  it("the ONLY production mount of SearchPanel is that host", () => {
    // A second mount would be a second answer to "what may this surface
    // offer?", and no behavioural test of the panel can see one.
    const out = walk(SRC).filter(
      (f) =>
        !f.includes("__tests__") &&
        /<SearchPanel[\s>]/.test(readFileSync(f, "utf8")),
    );
    expect(out.map((f) => f.slice(SRC.length + 1))).toEqual([
      "components/editor-layout/panels/search-host.tsx",
    ]);
  });
});

function walk(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out.sort();
}
