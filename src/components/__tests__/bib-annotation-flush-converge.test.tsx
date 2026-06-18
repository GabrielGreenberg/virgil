// @vitest-environment jsdom
//
// W5a — C4 data-loss + convergence on the BibEntryCard annotation field.
//
// BIB-F8-01 (DATA-LOSS): the annotation contentEditable persists on a ~400ms
// debounce. Collapsing/closing the card (unmount) or blurring within that
// window used to drop the edit — the orphaned timer fired against a now-null
// ref and wrote ''. The field now FLUSHES on blur and on unmount, so a fast
// collapse always persists the in-flight edit.
//
// BIB-F8-02 (HIGH): the docked card and the popped float each mount their own
// AnnotationEditor for the same entry. They share ONE source of truth (the
// useAnnotations store, threaded as the same getAnnotation/setAnnotation pair),
// and the seed effect now re-syncs from the controlled `content` prop, so an
// edit in one surface reflects in the other with no last-writer clobber.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/storage
// gotcha) — stub it; nothing here touches a real sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
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
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import React, { useState, useCallback } from "react";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

function makeEntry(): BibEntry {
  return {
    uid: "u-flush",
    key: "flush2020",
    type: "article",
    fields: { author: "A. Author", year: "2020", title: "T" },
    raw: "",
  } as BibEntry;
}

/** Find the live annotation contentEditable in a given card container. */
function editorIn(container: HTMLElement): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>(".annotation-editor");
  if (!el) throw new Error("annotation editor not mounted");
  return el;
}

/** Simulate the user typing `html` into a contentEditable + firing onInput. */
function typeInto(el: HTMLElement, html: string) {
  el.innerHTML = html;
  fireEvent.input(el);
}

/* ───────────────────────── single-store harness ───────────────────────── */
//
// Mirrors the production wiring: BOTH the docked card and the popped float read
// and write the SAME getAnnotation/setAnnotation pair (the useAnnotations
// sidecar store), so there is exactly one owner of the value. `setAnnotation`
// drops empty writes (matching useAnnotations: an empty string deletes the key)
// so a regression to the empty-write-on-unmount bug surfaces as a missing key.
function useAnnotationStore(initial: Record<string, string> = {}) {
  const [store, setStore] = useState<Record<string, string>>(initial);
  const getAnnotation = useCallback((k: string) => store[k] ?? "", [store]);
  const setAnnotation = useCallback((k: string, text: string) => {
    setStore((prev) => {
      const next = { ...prev };
      if (!text) delete next[k];
      else next[k] = text;
      return next;
    });
  }, []);
  return { store, getAnnotation, setAnnotation };
}

const NOOP_PROPS = {
  onRequestReview: () => {},
  onCancelReview: () => {},
  getReviewStatus: () => "none" as const,
  onUpdateBibEntry: () => {},
  onUpdateBibKeyAndType: () => {},
};

/* ─────────────────────────── BIB-F8-01 (flush) ─────────────────────────── */

describe("BibEntryCard annotation — flush before debounce (BIB-F8-01)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes the in-flight edit on UNMOUNT (collapse/close within the 400ms window)", () => {
    const saved: Array<[string, string]> = [];
    const { container, unmount } = render(
      <BibEntryCard
        entry={makeEntry()}
        isSelected
        onClick={() => {}}
        getAnnotation={() => ""}
        setAnnotation={(k, t) => saved.push([k, t])}
        {...NOOP_PROPS}
      />,
    );
    fireEvent.click(screen.getByText("Annotations"));
    const editor = editorIn(container);

    // Type, then unmount WITHOUT advancing past the debounce (< 400ms).
    typeInto(editor, "<b>in-flight</b> note");
    vi.advanceTimersByTime(100); // still well inside the 400ms debounce
    act(() => unmount());

    // The edit must have been flushed on unmount — NOT lost, NOT written as ''.
    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect(last[0]).toBe("flush2020");
    expect(last[1]).toContain("in-flight");
    // Regression guard: the orphaned-timer-writes-empty bug.
    expect(saved.some(([, t]) => t === "")).toBe(false);
  });

  it("flushes the in-flight edit on BLUR (deselect collapses the card)", () => {
    const saved: Array<[string, string]> = [];
    const { container } = render(
      <BibEntryCard
        entry={makeEntry()}
        isSelected
        onClick={() => {}}
        getAnnotation={() => ""}
        setAnnotation={(k, t) => saved.push([k, t])}
        {...NOOP_PROPS}
      />,
    );
    fireEvent.click(screen.getByText("Annotations"));
    const editor = editorIn(container);

    typeInto(editor, "blurred note");
    vi.advanceTimersByTime(50); // inside the window
    fireEvent.blur(editor);

    const last = saved[saved.length - 1];
    expect(last[1]).toContain("blurred note");
    expect(saved.some(([, t]) => t === "")).toBe(false);
  });

  it("does NOT fire an empty orphaned-timer write after unmount", () => {
    const saved: Array<[string, string]> = [];
    const { container, unmount } = render(
      <BibEntryCard
        entry={makeEntry()}
        isSelected
        onClick={() => {}}
        getAnnotation={() => ""}
        setAnnotation={(k, t) => saved.push([k, t])}
        {...NOOP_PROPS}
      />,
    );
    fireEvent.click(screen.getByText("Annotations"));
    typeInto(editorIn(container), "x");
    act(() => unmount());
    const writesAfterUnmount = saved.length;

    // Advance well past the debounce: the cancelled timer must NOT fire and must
    // NOT write '' against the (now-null) ref.
    vi.advanceTimersByTime(1000);
    expect(saved.length).toBe(writesAfterUnmount); // no further (empty) write
    expect(saved.some(([, t]) => t === "")).toBe(false);
  });
});

/* ──────────────────── BIB-F8-02 (single source, converge) ──────────────── */

describe("BibEntryCard annotation — docked⇄float convergence (BIB-F8-02)", () => {
  // Two cards for the SAME entry, sharing ONE store — the docked card and a
  // popped float in production. A separate `data-surface` wrapper lets each
  // test scope to a surface.
  function TwoSurfaces() {
    const { store, getAnnotation, setAnnotation } = useAnnotationStore();
    const entry = makeEntry();
    return (
      <>
        <div data-surface="docked">
          <BibEntryCard
            entry={entry}
            isSelected
            onClick={() => {}}
            getAnnotation={getAnnotation}
            setAnnotation={setAnnotation}
            {...NOOP_PROPS}
          />
        </div>
        <div data-surface="float">
          <BibEntryCard
            entry={entry}
            isSelected
            isPoppedOut
            onClick={() => {}}
            getAnnotation={getAnnotation}
            setAnnotation={setAnnotation}
            {...NOOP_PROPS}
          />
        </div>
        <div data-store>{JSON.stringify(store)}</div>
      </>
    );
  }

  function surface(name: "docked" | "float"): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-surface="${name}"]`)!;
  }

  it("an edit in the float reflects in the docked card (single source of truth)", () => {
    vi.useFakeTimers();
    try {
      render(<TwoSurfaces />);
      // Expand the Annotations pod on BOTH surfaces.
      document.querySelectorAll("button").forEach((b) => {
        if (b.textContent === "Annotations") fireEvent.click(b);
      });

      const floatEd = editorIn(surface("float"));
      const dockedEd = editorIn(surface("docked"));

      // Type in the float and let the debounce commit.
      typeInto(floatEd, "<b>from the float</b>");
      act(() => vi.advanceTimersByTime(450));

      // The store got the float's value …
      expect(document.querySelector("[data-store]")!.textContent).toContain("from the float");
      // … and the DOCKED card (not focused) re-seeded from the shared source.
      expect(dockedEd.innerHTML).toContain("from the float");
    } finally {
      vi.useRealTimers();
    }
  });

  it("editing the stale surface does NOT clobber the other surface's edit", () => {
    vi.useFakeTimers();
    try {
      render(<TwoSurfaces />);
      document.querySelectorAll("button").forEach((b) => {
        if (b.textContent === "Annotations") fireEvent.click(b);
      });

      const floatEd = editorIn(surface("float"));
      const dockedEd = editorIn(surface("docked"));

      // Float writes first.
      typeInto(floatEd, "float text");
      act(() => vi.advanceTimersByTime(450));
      // Docked converged (no longer "stale").
      expect(dockedEd.innerHTML).toContain("float text");

      // Now the docked surface appends — it serializes the CONVERGED DOM, so the
      // float's text is preserved, not overwritten by a stale empty doc.
      typeInto(dockedEd, "float text + docked text");
      act(() => vi.advanceTimersByTime(450));

      const storeText = document.querySelector("[data-store]")!.textContent!;
      expect(storeText).toContain("float text");
      expect(storeText).toContain("docked text");
      // The float (not focused) re-seeded the merged value — convergence holds.
      expect(floatEd.innerHTML).toContain("docked text");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT stomp the live caret: a focused field is not re-seeded mid-edit", () => {
    vi.useFakeTimers();
    try {
      render(<TwoSurfaces />);
      document.querySelectorAll("button").forEach((b) => {
        if (b.textContent === "Annotations") fireEvent.click(b);
      });
      const floatEd = editorIn(surface("float"));
      const dockedEd = editorIn(surface("docked"));

      // User is actively editing the docked field (focused).
      fireEvent.focus(dockedEd);
      typeInto(dockedEd, "user typing");

      // Meanwhile the float commits a write to the shared store.
      typeInto(floatEd, "float wrote this");
      act(() => vi.advanceTimersByTime(450));

      // The focused docked field keeps the user's in-progress text — NOT
      // re-seeded out from under the caret.
      expect(dockedEd.innerHTML).toContain("user typing");
    } finally {
      vi.useRealTimers();
    }
  });
});
