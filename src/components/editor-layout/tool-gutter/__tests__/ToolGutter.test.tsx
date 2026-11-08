// @vitest-environment jsdom
/**
 * The tool gutter (task 1440, split in round 3): tools write their body in
 * the top half, list icons write one list in the bottom half, "+" adds an
 * icon and "…" removes one, a divider shows only while both halves are open,
 * a row click goes through the editor's own jump door and selects the card,
 * and a to-do's box ticks without a jump.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { TodoItem } from "@/lib/types";

const scrollToFootnote = vi.fn();
const jumpToCard = vi.fn();
const setSelectedFootnoteId = vi.fn();
const setSelectedTodoId = vi.fn();

vi.mock("../../contexts/editor-ref", () => ({
  useEditorRefContext: () => ({
    editorRef: { current: { scrollToFootnote, jumpToCard, scrollToExample: vi.fn(), scrollToCitation: vi.fn() } },
  }),
}));
vi.mock("../../contexts/selections", () => ({
  useSelectionsContext: () => ({
    selected: { kind: "footnote", id: "f2" },
    selectedBibKey: null,
    setSelectedFootnoteId,
    setSelectedTodoId,
    setSelectedExampleId: vi.fn(),
    setSelectedCitationId: vi.fn(),
    setSelectedBibKey: vi.fn(),
    setSelectedNoteId: vi.fn(),
    setSelectedArchiveId: vi.fn(),
    setSelectedCommentId: vi.fn(),
    setSelectedCutterCardId: vi.fn(),
    setSelectedReportCardId: vi.fn(),
  }),
}));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/hooks/useDiagnostics", () => ({
  useDiagnosticsContext: () => ({
    allLatexErrors: [],
    dismissedErrorIds: new Set(),
    selectedErrorId: null,
    setSelectedErrorId: vi.fn(),
    errorJump: { mode: "anchor", jump: vi.fn() },
  }),
}));

import { ToolGutter } from "../ToolGutter";
import { __resetToolGutterStoreForTests, revealGutterSection } from "@/lib/tool-gutter-store";
import type { PanelKind } from "@/panels/_shared/types";

const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const footnotes = [
  { footnoteId: "f1", number: 1, pos: 1, content: para("First note") },
  { footnoteId: "f2", number: 2, pos: 9, content: para("Second note") },
] as unknown as FootnoteInfo[];
const todos = [
  { id: "t1", text: "Write the coda", done: false, notes: "", aiRequest: false, createdAt: "", links: [] },
] as TodoItem[];

const ALL: PanelKind[] = [
  "outline", "search", "wordcount", "footnotes", "examples", "todo", "notes",
  "citations", "bibliography", "reports", "archive", "revisions", "cutter", "errors",
];

function mount(visible: PanelKind[] = ALL, toggleTodo = vi.fn()) {
  render(
    <ToolGutter
      visiblePanels={visible}
      renderTool={(t) => <div data-testid="tool-body">{t} body</div>}
      footnotes={footnotes}
      examples={[]}
      todoItems={todos}
      toggleTodo={toggleTodo}
      noteCards={[]}
      citations={[]}
      bibEntries={[]}
      citationPositionMap={new Map()}
      archiveSnippets={[]}
      revisionCards={[]}
      cutterCards={[]}
      reportCards={[]}
      archivedIds={new Set()}
    />,
  );
  return { toggleTodo };
}

beforeEach(() => {
  localStorage.clear();
  __resetToolGutterStoreForTests();
  vi.clearAllMocks();
});

describe("ToolGutter", () => {
  it("shows the three tools, and the Footnotes and Bibliography icons with Footnotes open", () => {
    mount();
    expect(screen.getByRole("toolbar", { name: "Tools" }).querySelectorAll("button")).toHaveLength(3);
    const icons = [...document.querySelectorAll("[data-gutter-list-button]")].map((b) =>
      b.getAttribute("data-gutter-list-button"),
    );
    expect(icons).toEqual(["footnotes", "bibliography"]);
    const sections = [...document.querySelectorAll("[data-gutter-section]")].map((s) =>
      s.getAttribute("data-gutter-section"),
    );
    expect(sections).toEqual(["footnotes"]);
    expect(document.querySelector("[data-card]")).toBeNull();
  });

  it("a tool icon writes that tool at the top; a second click closes it", () => {
    mount();
    const outline = document.querySelector('[data-gutter-tool-button="outline"]')!;
    fireEvent.click(outline);
    expect(screen.getByTestId("tool-body").textContent).toBe("outline body");
    fireEvent.click(document.querySelector('[data-gutter-tool-button="search"]')!);
    expect(screen.getByTestId("tool-body").textContent).toBe("search body");
    fireEvent.click(document.querySelector('[data-gutter-tool-button="search"]')!);
    expect(screen.queryByTestId("tool-body")).toBeNull();
  });

  it("a list icon writes one list at a time; a second click closes it", () => {
    mount();
    const open = () =>
      [...document.querySelectorAll("[data-gutter-section]")].map((s) => s.getAttribute("data-gutter-section"));
    fireEvent.click(document.querySelector('[data-gutter-list-button="bibliography"]')!);
    expect(open()).toEqual(["bibliography"]);
    expect(screen.getByText("None yet")).toBeTruthy();
    fireEvent.click(document.querySelector('[data-gutter-list-button="bibliography"]')!);
    expect(open()).toEqual([]);
  });

  it("the divider shows only while a tool and a list are both open", () => {
    mount();
    expect(document.querySelector("[data-gutter-divider]")).toBeNull();
    fireEvent.click(document.querySelector('[data-gutter-tool-button="outline"]')!);
    expect(document.querySelector("[data-gutter-divider]")).not.toBeNull();
    fireEvent.click(document.querySelector('[data-gutter-list-button="footnotes"]')!);
    expect(document.querySelector("[data-gutter-divider]")).toBeNull();
  });

  it("every icon can leave through the … menu, the defaults included, and + brings one back", () => {
    mount();
    const icons = () =>
      [...document.querySelectorAll("[data-gutter-list-button]")].map((b) =>
        b.getAttribute("data-gutter-list-button"),
      );
    for (const label of ["Remove Footnotes", "Remove Bibliography"]) {
      fireEvent.click(screen.getByRole("button", { name: "List options" }));
      fireEvent.click(screen.getByText(label));
    }
    expect(icons()).toEqual([]);
    expect(document.querySelector("[data-gutter-section]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a list" }));
    fireEvent.click(screen.getByText("Footnotes"));
    expect(icons()).toEqual(["footnotes"]);
    // The added list opens.
    expect(document.querySelector('[data-gutter-section="footnotes"]')).not.toBeNull();
  });

  it("a row click selects the card and jumps through the editor's door", () => {
    mount();
    // Footnotes is the default open list.
    fireEvent.click(screen.getByText("First note"));
    expect(setSelectedFootnoteId).toHaveBeenCalledWith("f1");
    expect(scrollToFootnote).toHaveBeenCalledWith("f1", expect.any(HTMLElement));
    // The selected card's row is marked.
    expect(document.querySelector('[data-gutter-row="fn:f2"]')!.hasAttribute("data-selected")).toBe(true);
  });

  it("a to-do's box ticks without a jump", () => {
    revealGutterSection("todo");
    const { toggleTodo } = mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done" }));
    expect(toggleTodo).toHaveBeenCalledWith("t1");
    expect(jumpToCard).not.toHaveBeenCalled();
  });

  it("offers only what the host offers (the Reader's whitelist)", () => {
    revealGutterSection("examples");
    mount(["outline", "search", "footnotes", "examples", "notes"]);
    expect(screen.getByRole("toolbar", { name: "Tools" }).querySelectorAll("button")).toHaveLength(2);
    const icons = [...document.querySelectorAll("[data-gutter-list-button]")].map((b) =>
      b.getAttribute("data-gutter-list-button"),
    );
    expect(icons).toEqual(["footnotes", "examples"]);
  });
});
