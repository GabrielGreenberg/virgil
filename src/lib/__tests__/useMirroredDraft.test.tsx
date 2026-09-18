// @vitest-environment jsdom
/**
 * `useMirroredDraft` — the localStorage family's answer to the two guarantees
 * the sidecar family settled in tasks 392 / 559 / 569 (task 629).
 *
 * Every leg here is written against a SHAPE that shipped: the debounce whose
 * cleanup CANCELLED the pending write, and the peer handler that re-read
 * storage over a live composition buffer. The component-level twins live in
 * `BugReportWindow.test.tsx`; these pin the door itself, so the next caller
 * inherits the contract rather than re-deriving it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useMirroredDraft } from "../cross-window-storage";

const KEY = "virgil:test-draft";

/** A peer window's write: storage changes, then the native event fires (it
 *  never fires in the writing window — see `subscribeToStorageKey`). */
function peerWrite(key: string, value: string): void {
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

interface Harness {
  value: string;
  set: (next: string) => void;
  flush: () => void;
}

function mount(key = KEY, options?: { debounceMs?: number }) {
  const api: Harness = { value: "", set: () => {}, flush: () => {} };
  function Probe() {
    const [value, setValue, flush] = useMirroredDraft(key, options);
    api.value = value;
    api.set = setValue;
    api.flush = flush;
    return null;
  }
  const view = render(<Probe />);
  return { api, view };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMirroredDraft — hydration + the debounce", () => {
  it("hydrates from storage and coalesces a typing burst into one write", () => {
    localStorage.setItem(KEY, "from disk");
    const { api } = mount();
    expect(api.value).toBe("from disk");

    const spy = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      api.set("a");
      api.set("ab");
      api.set("abc");
    });
    expect(spy).not.toHaveBeenCalled(); // still deferred
    act(() => void vi.advanceTimersByTime(400));
    expect(localStorage.getItem(KEY)).toBe("abc");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("debounceMs: 0 writes through on every set", () => {
    const { api } = mount(KEY, { debounceMs: 0 });
    act(() => api.set("office-imac"));
    expect(localStorage.getItem(KEY)).toBe("office-imac");
  });

  it("an unchanged set neither re-renders storage nor arms a write", () => {
    localStorage.setItem(KEY, "same");
    const { api } = mount();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    act(() => api.set("same"));
    act(() => void vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useMirroredDraft — the write is FLUSHED, never cancelled", () => {
  // THE DEFECT LEG. The pre-629 effect cleanup was `clearTimeout(t)`: type a
  // final sentence, reload inside 400 ms, the sentence is gone.
  it("unmount inside the debounce window writes the pending text", () => {
    const { api, view } = mount();
    act(() => api.set("the last sentence"));
    expect(localStorage.getItem(KEY)).toBeNull(); // still only in memory
    act(() => view.unmount());
    expect(localStorage.getItem(KEY)).toBe("the last sentence");
  });

  it("the tab going hidden flushes", () => {
    const { api } = mount();
    act(() => api.set("typed, then app-switched"));
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(localStorage.getItem(KEY)).toBe("typed, then app-switched");
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("pagehide flushes — the edge a SYNCHRONOUS store may still use", () => {
    const { api } = mount();
    act(() => api.set("typed, then reloaded"));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(KEY)).toBe("typed, then reloaded");
  });

  it("an edge with nothing pending writes nothing", () => {
    localStorage.setItem(KEY, "clean");
    mount();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("flush() is idempotent — a later edge does not re-write", () => {
    const { api } = mount();
    act(() => api.set("done"));
    act(() => api.flush());
    const spy = vi.spyOn(Storage.prototype, "setItem");
    act(() => void window.dispatchEvent(new Event("pagehide")));
    act(() => void vi.advanceTimersByTime(1000));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useMirroredDraft — the peer re-read is CLEAN-GATED", () => {
  it("adopts a peer's value while clean (the task-599 guarantee, kept)", () => {
    localStorage.setItem(KEY, "old");
    const { api } = mount();
    act(() => peerWrite(KEY, "typed in the other window"));
    expect(api.value).toBe("typed in the other window");
  });

  // THE DEFECT LEG. Pre-629 this handler re-read unconditionally, so a peer's
  // write reverted prose being composed here — up to 400 ms of it, with no undo.
  it("does NOT clobber an unmirrored local edit", () => {
    localStorage.setItem(KEY, "old");
    const { api } = mount();
    act(() => api.set("a sentence I am still typing"));
    act(() => peerWrite(KEY, "the peer's older draft"));
    expect(api.value).toBe("a sentence I am still typing");

    // …and our flush still lands: last-writer-wins on the local user's most
    // recent intent, the stated residual.
    act(() => void vi.advanceTimersByTime(400));
    expect(localStorage.getItem(KEY)).toBe("a sentence I am still typing");
  });

  it("re-opens to peers once the local buffer has flushed", () => {
    const { api } = mount();
    act(() => api.set("mine"));
    act(() => void vi.advanceTimersByTime(400));
    act(() => peerWrite(KEY, "theirs, after"));
    expect(api.value).toBe("theirs, after");
  });

  it("a FAILED write leaves the instance dirty, so the guard keeps holding", () => {
    const { api } = mount();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    act(() => api.set("never reached disk"));
    act(() => void vi.advanceTimersByTime(400));
    spy.mockRestore();

    // The timer is long gone — a timer-handle dirty test would answer CLEAN
    // here and hand the buffer to the peer. The predicate asks the honest
    // question instead: storage does not hold what we hold.
    act(() => peerWrite(KEY, "the peer's draft"));
    expect(api.value).toBe("never reached disk");
  });

  it("an unrelated key's event cannot reach this buffer", () => {
    const { api } = mount();
    act(() => api.set("report prose"));
    act(() => void vi.advanceTimersByTime(400));
    act(() => peerWrite("virgil:some-other-key", "office-imac"));
    expect(api.value).toBe("report prose");
  });

  it("a peer's localStorage.clear() is adopted; a sessionStorage.clear() is not", () => {
    localStorage.setItem(KEY, "something");
    const { api } = mount();
    expect(api.value).toBe("something");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: null, storageArea: sessionStorage }),
      );
    });
    expect(api.value).toBe("something");

    act(() => {
      localStorage.clear();
      const e = new StorageEvent("storage", { key: null });
      Object.defineProperty(e, "storageArea", { value: localStorage });
      window.dispatchEvent(e);
    });
    expect(api.value).toBe("");
  });
});
