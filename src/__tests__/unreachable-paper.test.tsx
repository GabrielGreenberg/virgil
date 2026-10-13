// @vitest-environment jsdom
//
// Task 1102 — a paper Virgil cannot reach is a STATE with a way out, not a
// silent blank pane:
//   1. the typed load outcome (`classifyDocLoadFailure`, `probeDocFolder`);
//   2. `useDocument` publishes a failed load into the per-doc registry instead
//      of only logging, and clears it on a successful load;
//   3. the gate offers Locate / Try again / Remove;
//   4. any Recents row can be forgotten, and the X never opens the paper;
//   5. the forget door (`useFiles.deleteFile`) has production callers — it was
//      exported for its whole life with none.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderHook,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import React, { type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockRead = vi.fn();
vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: vi.fn(async () => ({ landed: true })),
  invalidateSidecarBundle: () => {},
}));

import {
  DocUnreachableError,
  classifyDocLoadFailure,
  probeDocFolder,
  getDocLoadFailure,
  publishDocLoadFailure,
  __resetDocLoadFailuresForTests,
} from "@/lib/doc-load-failure";
import { useDocument } from "@/hooks/useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import { DocUnreachableGate } from "@/components/DocUnreachableGate";
import { RecentPapersList } from "@/components/RecentPapersList";
import type { FsaDocMeta } from "@/lib/doc-index";

function domErr(name: string, message = name): DOMException {
  return new DOMException(message, name);
}

/** A directory-handle fake: `gone` = the folder was removed (every op throws
 *  NotFound); `files` = the entries it holds. */
function fakeDir(opts: { gone?: boolean; files?: string[] }) {
  const files = opts.files ?? [];
  return {
    name: "Paper",
    values() {
      let i = 0;
      return {
        async next() {
          if (opts.gone) throw domErr("NotFoundError");
          return i < files.length
            ? { value: files[i++], done: false }
            : { value: undefined, done: true };
        },
      };
    },
    async getFileHandle(name: string) {
      if (opts.gone || !files.includes(name)) throw domErr("NotFoundError");
      return { kind: "file", name };
    },
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(() => {
  mockRead.mockReset();
  resetPipelines();
  resetFlushers();
  __resetDocLoadFailuresForTests();
});
afterEach(() => cleanup());

describe("the typed load outcome", () => {
  it("classifies NotFound as folder-missing, NotAllowed as permission, anything else as unreadable", () => {
    expect(classifyDocLoadFailure(domErr("NotFoundError")).kind).toBe("folder-missing");
    expect(classifyDocLoadFailure(domErr("NotAllowedError")).kind).toBe("permission");
    expect(classifyDocLoadFailure(new Error("boom")).kind).toBe("unreadable");
    expect(
      classifyDocLoadFailure(new Error("No folder handle stored for doc x")).kind,
    ).toBe("folder-missing");
    expect(
      classifyDocLoadFailure(new DocUnreachableError("tex-missing", "gone")).kind,
    ).toBe("tex-missing");
  });

  it("probeDocFolder tells a removed folder from a removed .tex", async () => {
    expect(await probeDocFolder(fakeDir({ gone: true }), "main.tex")).toBe(
      "folder-missing",
    );
    expect(await probeDocFolder(fakeDir({ files: ["other.tex"] }), "main.tex")).toBe(
      "tex-missing",
    );
    expect(await probeDocFolder(fakeDir({ files: [] }), "main.tex")).toBe(
      "tex-missing",
    );
    expect(await probeDocFolder(fakeDir({ files: ["main.tex"] }), "main.tex")).toBe(
      null,
    );
  });
});

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DocPipeline key={docId} docId={docId}>{children}</DocPipeline>;
  };
}

describe("useDocument publishes its load outcome", () => {
  it("a NotFound load → folder-missing in the registry (not just a log line)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRead.mockRejectedValue(domErr("NotFoundError", "gone"));
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-gone"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.content).toBeNull();
    expect(getDocLoadFailure("doc-gone")?.kind).toBe("folder-missing");
    spy.mockRestore();
  });

  it("a non-NotFound failure → unreadable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRead.mockRejectedValue(new Error("parse exploded"));
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-bad"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getDocLoadFailure("doc-bad")?.kind).toBe("unreadable");
    spy.mockRestore();
  });

  it("a successful load clears a standing failure for that doc only", async () => {
    publishDocLoadFailure("doc-ok", { kind: "folder-missing", detail: "" });
    publishDocLoadFailure("doc-other", { kind: "tex-missing", detail: "" });
    mockRead.mockResolvedValue({ content: { type: "doc", content: [] } });
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-ok"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getDocLoadFailure("doc-ok")).toBeNull();
    expect(getDocLoadFailure("doc-other")?.kind).toBe("tex-missing");
  });
});

describe("DocUnreachableGate", () => {
  it("offers Locate, Try again and Remove, and routes each", async () => {
    const onLocate = vi.fn(async () => {});
    const onRetry = vi.fn();
    const onRemove = vi.fn(async () => {});
    render(
      <DocUnreachableGate
        docName="My Paper"
        folderName="Paper"
        texFilename="main.tex"
        kind="folder-missing"
        onLocate={onLocate}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText(/can't find this paper's folder/)).toBeTruthy();
    fireEvent.click(screen.getByText("Locate folder…"));
    await waitFor(() => expect(onLocate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Remove from Recents"));
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
  });

  it("says a wrong Locate pick out loud, and hides Locate where there is no picker", async () => {
    const onLocate = vi.fn(async () => {
      throw new Error('"Elsewhere" does not contain main.tex.');
    });
    const { rerender } = render(
      <DocUnreachableGate
        docName="My Paper"
        folderName="Paper"
        texFilename="main.tex"
        kind="tex-missing"
        onLocate={onLocate}
        onRetry={() => {}}
        onRemove={async () => {}}
      />,
    );
    fireEvent.click(screen.getByText("Locate folder…"));
    await waitFor(() => expect(screen.getByText(/does not contain main.tex/)).toBeTruthy());
    rerender(
      <DocUnreachableGate
        docName="My Paper"
        folderName="Paper"
        texFilename="main.tex"
        kind="tex-missing"
        onRetry={() => {}}
        onRemove={async () => {}}
      />,
    );
    expect(screen.queryByText("Locate folder…")).toBeNull();
  });
});

describe("Recents rows can be forgotten", () => {
  const doc: FsaDocMeta = {
    id: "p1",
    name: "Lost Paper",
    texFilename: "main.tex",
    folderName: "Lost",
    createdAt: "2026-01-01T00:00:00Z",
    lastModifiedAt: "2026-01-01T00:00:00Z",
    lastAccessedAt: "2026-01-01T00:00:00Z",
  } as FsaDocMeta;

  it("the X removes without opening", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(<RecentPapersList docs={[doc]} onOpen={onOpen} onRemove={onRemove} />);
    fireEvent.click(screen.getByTestId("recent-paper-remove"));
    expect(onRemove).toHaveBeenCalledWith("p1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("no onRemove → no X (the row is unchanged)", () => {
    render(<RecentPapersList docs={[doc]} onOpen={() => {}} />);
    expect(screen.queryByTestId("recent-paper-remove")).toBeNull();
  });
});

describe("CENSUS: the forget door has production callers", () => {
  const read = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8");

  it("EditorLayout wires deleteFile to the gate, the start-screen Recents and the + menu", () => {
    const src = read("src/components/EditorLayout.tsx");
    expect(src).toMatch(/await deleteFile\(id\)/);
    expect(src).toMatch(/<RecentPapersList[^>]*onRemove=\{deleteFile\}/);
    expect(src).toMatch(/onRemoveRecent: deleteFile/);
    const tabStrip = read("src/components/editor-layout/TabStrip.tsx");
    expect(tabStrip).toMatch(/onRemoveRecent=\{onRemoveRecent\}/);
    const plus = read("src/components/TabPlusMenu.tsx");
    expect(plus).toMatch(/onRemove=\{onRemoveRecent\}/);
  });

  it("the FSA bundle read refuses an unreachable paper rather than opening a blank default", () => {
    const src = read("src/lib/storage-fsa.ts");
    const body = src.slice(
      src.indexOf("export async function readDocBundle"),
      src.indexOf("const latex = await safeReadText(docHandle, meta.texFilename"),
    );
    expect(body).toMatch(/probeDocFolder\(docHandle, meta\.texFilename\)/);
    expect(body).toMatch(/throw new DocUnreachableError/);
  });
});
