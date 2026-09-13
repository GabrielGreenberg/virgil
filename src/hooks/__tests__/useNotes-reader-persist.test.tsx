// @vitest-environment jsdom
//
// **A note written in the Library Reader reaches the paper folder** — task 556,
// the END-TO-END leg: the REAL `useNotes` under the REAL `READER_CHROME`
// context, for a `library-paper:` docId, through the REAL `usePersistentState`
// and the REAL dev storage backend, with only `fetch` spied. No pre-556 suite
// could represent this: `usePersistentState.test.tsx` mocks `@/lib/storage`
// (so the UI permit was the only guard it could see), and every backend suite
// drives the funnel with a hand-built handle (so the chrome was the part it
// could not see). The defect lived in the gap between the two.
//
// Three legs: the DEFECT (a Reader note LANDS), the accepting control that
// keeps the fix narrow (a Reader todo still writes NOTHING — an implementation
// that WIDENED THE DERIVATION, i.e. added `todo` to the Reader's editable
// kinds, fails here; a funnel opened wide on its own does NOT, because the UI
// permit above it still refuses — measured, and that is the point of two
// readers of one table: the funnel-only neuters are caught one suite over, in
// `reader-writability.test.ts`), and the main-app control (a normal doc under
// FULL_CHROME still writes a todo through the ordinary route).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { type ReactNode } from "react";

// Route the storage barrel onto the REAL dev backend (the barrel's top-level
// `require()` cannot be vitest-aliased — documented gotcha
// vitest_extension_barrel_storage_mock — so it is mocked onto the module it
// would have chosen under `isDevStorage`).
//
// LAZILY. `storage-dev`'s own import graph reaches the barrel
// (`document-settings.ts` imports `@/lib/storage`), so `await importActual(
// "@/lib/storage-dev")` INSIDE this factory is a cycle vitest refuses ("error
// when mocking a module"). The factory therefore returns a Proxy synchronously
// and every exported function delegates to the real module on first call; the
// dynamic import only begins once the mock is registered, so the nested
// barrel request resolves to this proxy rather than re-entering the factory.
// Every barrel export the hooks reach is async, so a promise-returning wrapper
// is faithful.
vi.mock("@/lib/storage", () => {
  const load = import("@/lib/storage-dev");
  const statics: Record<string, unknown> = { isDevStorage: true };
  // Vitest asks `key in mock` before handing an export out, so the proxy
  // must CLAIM every name it will answer (and only those).
  const MODULE_SHAPED = new Set(["then", "default", "__esModule"]);
  return new Proxy(statics, {
    has(target, key) {
      return typeof key === "string" && (key in target || !MODULE_SHAPED.has(key));
    },
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      // Never look thenable / module-shaped to the module system itself.
      if (MODULE_SHAPED.has(key)) return undefined;
      return (...args: unknown[]) =>
        load.then((m) =>
          (m as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args),
        );
    },
  });
});

import { useNotes } from "@/hooks/useNotes";
import { useTodos } from "@/hooks/useTodos";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { READER_CHROME } from "@/components/editor-layout/chrome-config";
import { libraryPaperDocId } from "@/lib/host-writability";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { invalidateSidecarBundle } from "@/lib/storage-dev";

const CITEKEY = "smith2020";
const LIBRARY_DOC = libraryPaperDocId(CITEKEY);
const NORMAL_DOC = "regular-doc-123";

function readerWrapper({ children }: { children: ReactNode }) {
  return <EditorChromeProvider value={READER_CHROME}>{children}</EditorChromeProvider>;
}

let fetchSpy: ReturnType<typeof vi.fn>;
const puts = () =>
  fetchSpy.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([url, init]) => ({ url: String(url), body: String((init as RequestInit).body) }));

beforeEach(() => {
  resetPipelines();
  invalidateSidecarBundle(LIBRARY_DOC);
  invalidateSidecarBundle(NORMAL_DOC);
  // Reads → 404 (a fresh paper folder with no sidecars yet); PUTs → 200.
  fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response("", { status: 200 })
      : new Response("", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetPipelines();
});

describe("useNotes in the Library Reader (task 556)", () => {
  it("DEFECT: a note added while reading is written to the paper's virgil/notes.json", async () => {
    beginDocPipeline(LIBRARY_DOC);
    const { result } = renderHook(() => useNotes(LIBRARY_DOC), { wrapper: readerWrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let id = "";
    act(() => {
      id = result.current.addNote(null, {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "read this" }] }],
      }).id;
    });
    expect(result.current.notes.map((n) => n.id)).toEqual([id]);

    // The content-tier debounce (300 ms) then lands ONE PUT, on the
    // dev-library route, carrying the note.
    await waitFor(
      () => {
        const landed = puts().filter((p) => p.url.endsWith("/virgil/notes.json"));
        expect(landed).toHaveLength(1);
        expect(landed[0].url).toBe(`/api/dev-library/papers/${CITEKEY}/virgil/notes.json`);
        expect(JSON.parse(landed[0].body).cards.map((c: { id: string }) => c.id)).toEqual([id]);
      },
      { timeout: 3000 },
    );
  });

  it("CONTROL: a todo in the Reader still writes NOTHING (the fix widened exactly one sidecar)", async () => {
    beginDocPipeline(LIBRARY_DOC);
    const { result } = renderHook(() => useTodos(LIBRARY_DOC), { wrapper: readerWrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addItem();
    });
    expect(result.current.items).toHaveLength(1);
    // Past the debounce, no PUT of any kind has fired.
    await new Promise((r) => setTimeout(r, 700));
    expect(puts()).toEqual([]);
  });

  it("CONTROL: a normal doc with no Reader chrome still writes its todos through the ordinary route", async () => {
    beginDocPipeline(NORMAL_DOC);
    const { result } = renderHook(() => useTodos(NORMAL_DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addItem();
    });
    await waitFor(
      () => {
        const landed = puts().filter((p) => p.url.endsWith("/virgil/todos.json"));
        expect(landed).toHaveLength(1);
        expect(landed[0].url).toBe(`/api/dev/doc/${NORMAL_DOC}/virgil/todos.json`);
      },
      { timeout: 3000 },
    );
  });
});
