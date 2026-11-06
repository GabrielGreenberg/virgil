// @vitest-environment jsdom
//
// Task 1459 — what the active paper's pane shows is ONE total function of its
// access state, so no state renders a blank pane:
//   1. RESOLVER — over the full product (every DocPermState × handle ± ×
//      failure ±), a current paper always gets a view, the permission gate
//      only ever with a handle;
//   2. CHECK    — `useDocAccessCheck`: a paper with no stored handle publishes
//      folder-missing; a THROWING lookup after a previous paper's handle was
//      resolved never offers that old handle;
//   3. PHASE    — a NotFound/TypeMismatch from a FILE lookup is tex-missing; an
//      unnamed enumeration error stays unreadable;
//   4. WIRING   — EditorLayout reads the resolver at every site, and Remove
//      clears the gate only on a removal that happened.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  lookup: new Map<string, () => Promise<unknown>>(),
  perm: "granted" as "granted" | "prompt" | "denied",
}));

vi.mock("@/lib/doc-index", () => ({
  getDocHandle: vi.fn(async (id: string) => {
    const f = h.lookup.get(id);
    return f ? f() : undefined;
  }),
}));
vi.mock("@/lib/fsa-permissions", () => ({
  queryRW: vi.fn(async () => h.perm),
}));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));

import {
  resolveDocAccessView,
  type DocPermState,
} from "@/lib/doc-access-view";
import {
  classifyDocLoadFailure,
  probeDocFolder,
  getDocLoadFailure,
  __resetDocLoadFailuresForTests,
  type DocLoadFailure,
} from "@/lib/doc-load-failure";
import { useDocAccessCheck } from "@/hooks/useDocAccessCheck";

function domErr(name: string): DOMException {
  return new DOMException(name, name);
}

function dir(name: string, files: string[] = ["main.tex"]) {
  return {
    name,
    values() {
      let i = 0;
      return {
        async next() {
          return i < files.length
            ? { value: files[i++], done: false }
            : { value: undefined, done: true };
        },
      };
    },
    async getFileHandle(f: string) {
      if (!files.includes(f)) throw domErr("NotFoundError");
      return { kind: "file", name: f };
    },
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(() => {
  h.lookup.clear();
  h.perm = "granted";
  __resetDocLoadFailuresForTests();
});

describe("RESOLVER: total over the access state", () => {
  const STATES: DocPermState[] = ["loading", "granted", "needs-grant", "no-handle"];
  const HANDLES = [null, dir("Paper")];
  const FAILURES: (DocLoadFailure | null)[] = [
    null,
    { kind: "folder-missing", detail: "" },
    { kind: "unreadable", detail: "x" },
  ];

  it("a current paper is never left without a view; the permission gate always has a handle", () => {
    for (const docPermState of STATES)
      for (const handle of HANDLES)
        for (const loadFailure of FAILURES) {
          const view = resolveDocAccessView({
            hasDoc: true,
            docPermState,
            handle,
            loadFailure,
          });
          expect(view.kind).not.toBe("none");
          if (view.kind === "permission") expect(view.handle).toBe(handle);
          if (view.kind === "editor") {
            expect(docPermState).toBe("granted");
            expect(loadFailure).toBeNull();
          }
          // Only the in-flight check may show nothing, and only transiently.
          if (docPermState !== "loading") {
            expect(["editor", "permission", "unreachable"]).toContain(view.kind);
          }
        }
  });

  it("no-handle → unreachable/folder-missing (Locate / Remove), not a blank pane", () => {
    const view = resolveDocAccessView({
      hasDoc: true,
      docPermState: "no-handle",
      handle: null,
      loadFailure: null,
    });
    expect(view).toMatchObject({
      kind: "unreachable",
      failure: { kind: "folder-missing" },
    });
  });

  it("needs-grant with no handle → unreachable, never a permission gate with nothing to grant", () => {
    const view = resolveDocAccessView({
      hasDoc: true,
      docPermState: "needs-grant",
      handle: null,
      loadFailure: null,
    });
    expect(view.kind).toBe("unreachable");
  });

  it("no current paper → the start screen", () => {
    for (const docPermState of STATES)
      expect(
        resolveDocAccessView({
          hasDoc: false,
          docPermState,
          handle: null,
          loadFailure: null,
        }).kind,
      ).toBe("none");
  });
});

describe("CHECK: useDocAccessCheck", () => {
  it("a current paper with no stored handle publishes folder-missing", async () => {
    const { result } = renderHook(() => useDocAccessCheck("b", "main.tex"));
    await waitFor(() => expect(result.current.docPermState).toBe("no-handle"));
    expect(result.current.handle).toBeNull();
    expect(getDocLoadFailure("b")?.kind).toBe("folder-missing");
  });

  it("a throwing lookup after paper A resolved never hands A's handle to B", async () => {
    const a = dir("A-folder");
    h.lookup.set("a", async () => a);
    h.lookup.set("b", async () => {
      throw new Error("IDB exploded");
    });
    h.perm = "prompt";
    const { result, rerender } = renderHook(
      ({ id }) => useDocAccessCheck(id, "main.tex"),
      { initialProps: { id: "a" } },
    );
    await waitFor(() => expect(result.current.docPermState).toBe("needs-grant"));
    expect(result.current.handle).toBe(a);

    rerender({ id: "b" });
    // Even before the lookup settles, A's handle is not B's.
    expect(result.current.handle).toBeNull();
    await waitFor(() => expect(result.current.docPermState).toBe("no-handle"));
    expect(result.current.handle).toBeNull();
    const failure = getDocLoadFailure("b");
    expect(failure?.kind).toBe("unreadable");
    expect(
      resolveDocAccessView({
        hasDoc: true,
        docPermState: result.current.docPermState,
        handle: result.current.handle,
        loadFailure: failure,
      }).kind,
    ).toBe("unreachable");
  });

  it("a later successful check clears the failure the earlier one published", async () => {
    let fail = true;
    h.lookup.set("c", async () => {
      if (fail) throw new Error("transient");
      return dir("C");
    });
    const { result } = renderHook(() => useDocAccessCheck("c", "main.tex"));
    await waitFor(() => expect(getDocLoadFailure("c")).not.toBeNull());
    fail = false;
    result.current.recheck();
    await waitFor(() => expect(result.current.docPermState).toBe("granted"));
    expect(getDocLoadFailure("c")).toBeNull();
  });
});

describe("PHASE: classify a NotFound by where it was raised", () => {
  it("file phase → tex-missing; folder phase → folder-missing", () => {
    expect(classifyDocLoadFailure(domErr("NotFoundError"), "file").kind).toBe("tex-missing");
    expect(classifyDocLoadFailure(domErr("NotFoundError")).kind).toBe("folder-missing");
    expect(classifyDocLoadFailure(domErr("TypeMismatchError"), "file").kind).toBe(
      "tex-missing",
    );
  });

  it("probeDocFolder keeps an unnamed enumeration error unreadable (Try again), not folder-missing", async () => {
    const flaky = {
      name: "P",
      values() {
        return {
          async next() {
            throw domErr("InvalidStateError");
          },
        };
      },
    } as unknown as FileSystemDirectoryHandle;
    expect(await probeDocFolder(flaky, "main.tex")).toBe("unreadable");
  });
});

describe("WIRING: EditorLayout reads the one resolver", () => {
  const src = readFileSync(join(process.cwd(), "src/components/EditorLayout.tsx"), "utf8");

  it("every gate site and the hooks' doc id derive from docAccessView", () => {
    expect(src).toMatch(/resolveDocAccessView\(/);
    expect(src).toMatch(/docAccessView\.kind === "permission"/);
    expect(src).toMatch(/docAccessView\.kind === "unreachable"/);
    expect(src).toMatch(/docAccessView\.kind === "editor" \? currentDocId : null/);
    // The old per-site conjunctions are gone.
    expect(src).not.toMatch(/docPermState === "needs-grant" && activeDocHandle/);
    expect(src).not.toMatch(/docPermState === "granted" && activeLoadFailure/);
  });

  it("Remove clears the gate only when deleteFile says the paper was forgotten", () => {
    const body = src.slice(
      src.indexOf("const removeActiveDoc = useCallback"),
      src.indexOf("}, [currentDocId, deleteFile]);"),
    );
    expect(body).toMatch(/if \(await deleteFile\(id\)\) publishDocLoadFailure\(id, null\)/);
  });
});
