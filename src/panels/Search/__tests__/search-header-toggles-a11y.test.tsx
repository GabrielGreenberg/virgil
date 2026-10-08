// @vitest-environment jsdom
//
// Task 1005 — every control in the Search panel header announces its state
// and shows the app's focus ring. The scope chips and the `Aa` / `W` mode
// toggles are hand-rolled toggles, so each must carry `aria-pressed` (STYLE_GUIDE
// "Buttons": where you must hand-roll, still announce `aria-pressed`) — the
// chip's `✓` is decoration, never the state — and `.focus-ring`, the ring the
// "More" trigger already gets from `AnchoredMenu`. The census form (every
// header button, not a named list) is so a further hand-rolled toggle in this
// row cannot regress silently.

import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { SCOPE_ORDER } from "@/lib/search-sources";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
  type SearchPanelState,
} from "@/panels/Search/SearchPanel";

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
          attrs: { uuid: "u-1" },
          content: [{ type: "text", text: "Some text." }],
        },
      ],
    },
  });
  return () => {
    editor.destroy();
    element.remove();
    cleanup();
  };
});

function Harness() {
  const [state, setState] = useState<SearchPanelState>({
    ...INITIAL_SEARCH_STATE,
    enabledScopes: ["mainText"],
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

/** The header rows: the one holding the find input, and the scope-chip row
 *  right after it. */
function headerButtons(container: HTMLElement): HTMLButtonElement[] {
  const input = container.querySelector(
    'input[placeholder="Find in document..."]',
  );
  const inputRow = input?.parentElement;
  const chipRow = inputRow?.nextElementSibling;
  expect(inputRow).toBeTruthy();
  expect(chipRow).toBeTruthy();
  return [inputRow!, chipRow!].flatMap((row) =>
    Array.from(row.querySelectorAll("button")),
  );
}

function chip(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = headerButtons(container).find(
    (b) => b.textContent?.replace("✓", "").trim() === label,
  );
  expect(btn, `scope chip "${label}"`).toBeTruthy();
  return btn!;
}

describe("task 1005 — Search header toggles announce state + show the ring", () => {
  it("every header button carries .focus-ring and states its state (pressed, or a menu's expanded)", () => {
    const { container } = render(<Harness />);
    const buttons = headerButtons(container);
    // Aa, W, at least one chip, and the More trigger.
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      expect(b.classList.contains("focus-ring"), b.outerHTML).toBe(true);
      const states =
        b.hasAttribute("aria-pressed") || b.hasAttribute("aria-expanded");
      expect(states, b.outerHTML).toBe(true);
    }
  });

  it("a scope chip's aria-pressed tracks its enabled state and flips on click", () => {
    const { container } = render(<Harness />);
    const main = chip(container, "Main text");
    expect(main.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(main);
    expect(chip(container, "Main text").getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(chip(container, "Main text"));
    expect(chip(container, "Main text").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("the chip's check mark is decoration, hidden from the accessible name", () => {
    const { container } = render(<Harness />);
    const main = chip(container, "Main text");
    const check = Array.from(main.querySelectorAll("span")).find(
      (s) => s.textContent === "✓",
    );
    expect(check).toBeTruthy();
    expect(check!.getAttribute("aria-hidden")).toBe("true");
  });
});
