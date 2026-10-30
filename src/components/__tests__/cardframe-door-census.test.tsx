// @vitest-environment jsdom
//
// Task 1367 — the card FRAME has ONE door, `cardFrameProps`
// (panel-primitives). Search result rows used to re-assemble it from the two
// loose helpers (`themedCard` + `themedCardStyle` on a bare <button>) and so
// dropped what PanelCard layers on top: the OUTLINE focus member (a Tabbed-to
// hit wore the browser's default ring) and the frame marker the
// `cardOutlineChrome` rules key on. This census pins the door shut; the RTL
// legs pin that the Search row now comes through it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import { useState } from "react";
import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { SCOPE_ORDER } from "@/lib/search-sources";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
  type SearchPanelState,
} from "@/panels/Search/SearchPanel";
import {
  CARD_THEMES,
  cardFrameProps,
  themedCardStyle,
} from "@/components/panel-primitives";
import { FOCUS_OUTLINE_CLASS } from "@/components/focus-indicator";

const ROOT = path.resolve(__dirname, "../../..");
const DOOR = "src/components/panel-primitives.tsx";

/** Prose that NAMES the helpers (a doc comment citing `themedCardStyle(…)`)
 *  is not a caller. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__tests__" || ent.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

describe("task 1367 — the card frame has ONE door (CENSUS)", () => {
  it("no file outside panel-primitives spells the raw frame", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .map((f) => path.relative(ROOT, f))
      .filter((rel) => rel !== DOOR)
      .filter((rel) =>
        /\bthemedCard(?:Style)?\s*\(/.test(
          stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")),
        ),
      );
    expect(offenders, "spread `cardFrameProps(...)` instead").toEqual([]);
  });

  it("`themedCard` is module-private — the door is the only export", () => {
    const src = fs.readFileSync(path.join(ROOT, DOOR), "utf8");
    expect(src).not.toMatch(/export\s+function\s+themedCard\s*\(/);
    expect(src).toMatch(/export\s+function\s+cardFrameProps\s*\(/);
  });

  it("the door carries the focus member, the frame marker, and the kind colour", () => {
    const theme = CARD_THEMES.footnote;
    const frame = cardFrameProps(theme, true);
    expect(frame.className.split(/\s+/)).toContain(FOCUS_OUTLINE_CLASS);
    expect(frame["data-card"]).toBe("1");
    const style = frame.style as Record<string, unknown>;
    expect(style["--link-anchor-color"]).toBe(theme.accent);
    // Paint unchanged: the door's lift/selection IS themedCardStyle's.
    expect(style.boxShadow).toBe(themedCardStyle(theme, true).boxShadow);
    expect(style.borderColor).toBe(themedCardStyle(theme, true).borderColor);
  });

  it("a kind-less row is neutral; the accent stripe is an OPTION", () => {
    const neutral = cardFrameProps(null, false).style as Record<string, unknown>;
    expect(neutral["--link-anchor-color"]).toBe("transparent");
    expect(neutral.borderLeftWidth).toBeUndefined();
    const transparent = cardFrameProps(null, false, { accentStripe: "transparent" })
      .style as Record<string, unknown>;
    expect(transparent.borderLeftWidth).toBeUndefined();
    const striped = cardFrameProps(CARD_THEMES.note, false, { accentStripe: "#123456" })
      .style as Record<string, unknown>;
    expect(striped.borderLeftColor).toBe("#123456");
    expect(striped.borderLeftWidth).toBe(3);
  });

  it("frame CHROME keys on the frame marker, not on card identity", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(css).toContain(".card-outline-chrome [data-card]:hover {");
    expect(css).not.toMatch(/\.card-outline-chrome \[data-card-key\]:hover/);
  });
});

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

let editor: Editor;

beforeEach(() => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "uuid-0" },
          content: [{ type: "text", text: "A WIDGET here." }],
        },
      ],
    } as Content,
  });
  return () => {
    editor.destroy();
    element.remove();
    cleanup();
  };
});

function Harness({ selectedIdx = null }: { selectedIdx?: number | null }) {
  const [state, setState] = useState<SearchPanelState>({
    ...INITIAL_SEARCH_STATE,
    query: "WIDGET",
    enabledScopes: ["mainText"],
    selectedIdx,
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
      todos={[]}
      archiveSnippets={[]}
      cutterCards={[]}
      reportCards={[]}
      comments={[]}
      bibEntries={[]}
      onOpenItem={vi.fn()}
      availableScopes={SCOPE_ORDER}
      state={state}
      onStateChange={setState}
    />
  );
}

describe("task 1367 — a Search result row comes through the door", () => {
  it("wears the OUTLINE focus member and the frame marker", () => {
    const { container } = render(<Harness />);
    const row = container.querySelector<HTMLElement>("[data-result-idx]");
    expect(row).not.toBeNull();
    expect(row!.classList.contains(FOCUS_OUTLINE_CLASS)).toBe(true);
    expect(row!.getAttribute("data-card")).toBe("1");
    // A hit is NOT its source card: no identity key, so the hover bridge /
    // anchor reconciler / focus-new-card never resolve to it.
    expect(row!.hasAttribute("data-card-key")).toBe(false);
  });

  it("a kind-less (main-text) hit is neutral: no stripe, transparent kind var", () => {
    const { container } = render(<Harness />);
    const row = container.querySelector<HTMLElement>("[data-result-idx]")!;
    expect(row.style.getPropertyValue("--link-anchor-color")).toBe("transparent");
    expect(row.style.borderLeftWidth).toBe("");
  });
});
