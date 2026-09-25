// @vitest-environment jsdom
//
// TASK 765 — the Reader keys its loaded text on the paper's CONTENT identity.
//
// A background `/library/deep-index X` rewrites `papers/X/main.tex` and flips
// the catalog row `indexed → deepIndexed`. The Reader's load used to depend on
// a BOOLEAN "is it indexed?", which stays true across that flip, so an open
// Reader kept the pre-index text until evicted. It also pins the sibling: the
// paper folder's doc-handle row is shared by every mount of the same paper,
// and the first mount to leave must not delete it from under the other.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  handleOps: [] as string[],
}));

vi.mock("@library/lib/library-storage", () => ({
  readTextFile: vi.fn(async (_root: unknown, path: string) => disk.files.get(path)),
}));
vi.mock("@/lib/doc-index", () => ({
  setDocHandle: vi.fn(async (id: string) => {
    disk.handleOps.push(`set:${id}`);
  }),
  deleteDocHandle: vi.fn(async (id: string) => {
    disk.handleOps.push(`delete:${id}`);
  }),
}));
vi.mock("@/lib/latex-parser", () => ({
  parseLatex: (tex: string) => ({ type: "doc", attrs: { tex } }),
}));
vi.mock("@/lib/latex-serializer", () => ({ assignUuids: () => {} }));
vi.mock("@/components/EditorPane", () => ({
  default: ({ initialContent }: { initialContent: { attrs: { tex: string } } }) => (
    <div data-testid="pane">{initialContent.attrs.tex}</div>
  ),
}));
vi.mock("@/components/editor-layout/DocPipeline", () => ({
  DocPipeline: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/editor-layout/chrome-context", () => ({
  EditorChromeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/editor-layout/chrome-config", () => ({ READER_CHROME: {} }));
vi.mock("@/components/editor-layout/reader-view-prefs", () => ({
  useReaderView: () => ({ viewPrefs: {}, menuBar: {} }),
}));
vi.mock("@/components/editor-layout/reader-host", () => ({
  readerHostKind: () => "inline",
}));
vi.mock("@library/lib/view-session-store", () => ({
  getSession: () => ({ scopes: {} }),
  setListScrollQuiet: () => {},
}));
vi.mock("../PageScrollLozenge", () => ({ default: () => null }));
vi.mock("../PagePicker", () => ({ default: () => null }));

import PaperRender from "../PaperRender";

const TEX = "papers/alpha2020/main.tex";

function makeHandle(): FileSystemDirectoryHandle {
  const dir = {
    getDirectoryHandle: async () => dir,
  };
  return dir as unknown as FileSystemDirectoryHandle;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  cleanup();
  disk.files.clear();
  disk.handleOps.length = 0;
});

describe("PaperRender — content revision (task 765)", () => {
  it("re-reads main.tex when a re-index moves the revision, and swaps in the new text", async () => {
    const handle = makeHandle();
    disk.files.set(TEX, "OLD TEXT");
    const props = { handle, citekey: "alpha2020", scope: "", panel: "left" as const };
    const { rerender } = render(
      <PaperRender {...props} indexedState="indexed" contentRevision="indexed|t1|u1" />,
    );
    await act(flush);
    expect(screen.getByTestId("pane").textContent).toBe("OLD TEXT");

    // Background deep-index rewrites main.tex and flips the catalog row.
    disk.files.set(TEX, "NEW TEXT");
    rerender(
      <PaperRender {...props} indexedState="deepIndexed" contentRevision="deepIndexed|t2|u2" />,
    );
    await act(flush);
    expect(screen.getByTestId("pane").textContent).toBe("NEW TEXT");
  });

  it("an unrelated catalog touch re-reads but keeps the same mount when the text is unchanged", async () => {
    const handle = makeHandle();
    disk.files.set(TEX, "SAME");
    const props = { handle, citekey: "alpha2020", scope: "", panel: "left" as const, indexedState: "indexed" as const };
    const { rerender } = render(<PaperRender {...props} contentRevision="r1" />);
    await act(flush);
    const pane = screen.getByTestId("pane");
    rerender(<PaperRender {...props} contentRevision="r2" />);
    await act(flush);
    expect(screen.getByTestId("pane")).toBe(pane);
  });

  it("two mounts of one paper share the doc-handle row; only the last leaving deletes it", async () => {
    const handle = makeHandle();
    disk.files.set(TEX, "X");
    const props = { handle, citekey: "alpha2020", scope: "", panel: "left" as const, indexedState: "indexed" as const };
    const reader = render(<PaperRender {...props} />);
    const popped = render(<PaperRender {...props} />);
    await act(flush);

    reader.unmount();
    await act(flush);
    expect(disk.handleOps).not.toContain("delete:library-paper:alpha2020");

    popped.unmount();
    await act(flush);
    expect(disk.handleOps).toContain("delete:library-paper:alpha2020");
  });
});
