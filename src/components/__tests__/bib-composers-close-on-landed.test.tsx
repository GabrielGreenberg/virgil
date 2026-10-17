// @vitest-environment jsdom
//
// Task 1158 — the bib card's two composers closed BEFORE the write's result
// was known. "Edit entry" Save called `writes.save(…)` then closed the editor;
// the review-request composer called `request(…)` then deleted the draft. A
// refused write (a library paper's read-only `.bib` / review sidecar, the
// unbalanced-span refusal, a vanished entry) rolled the optimistic view back,
// and the user's typed fields / note were gone — silently, for the unvoiced
// `read-only` kind.
//
// The contract now:
//   - both composers close only on a write that LANDED; a refusal keeps the
//     draft and says why, beside it;
//   - a host whose `.bib` / review sidecar is not writable (the Reader's
//     chrome) does not offer Edit entry / Request review at all;
//   - `useBibReview` persists OUTSIDE `setState` updaters, once per mutation.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { READER_CHROME } from "@/components/editor-layout/chrome-config";
import type { BibEntry } from "@/lib/types";
import type { BibSaveResult } from "@/lib/project-bib";
import type { BibReviewWriteResult } from "@/hooks/useBibReview";

afterEach(cleanup);

const ENTRY: BibEntry = {
  uid: "u-1",
  key: "foo2020",
  type: "article",
  fields: { author: "A. Author", title: "A title", year: "2020" },
  raw: "",
} as BibEntry;

function renderCard(opts: {
  save?: () => Promise<BibSaveResult>;
  request?: () => Promise<BibReviewWriteResult>;
  reader?: boolean;
}) {
  const save = vi.fn(opts.save ?? (async () => ({ kind: "declined" as const })));
  const request = vi.fn(opts.request ?? (async () => ({ ok: true as const })));
  const card = (
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={request}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={save}
    />
  );
  const utils = render(
    opts.reader ? (
      <EditorChromeProvider value={READER_CHROME}>{card}</EditorChromeProvider>
    ) : (
      card
    ),
  );
  return { save, request, ...utils };
}

function openEditorAndType(container: HTMLElement) {
  fireEvent.click(screen.getByText("BibTeX Fields"));
  fireEvent.click(screen.getByText("Edit entry"));
  const titleInput = Array.from(container.querySelectorAll("input")).find(
    (i) => i.value === "A title",
  )!;
  fireEvent.change(titleInput, { target: { value: "My retyped title" } });
}

const typedTitleInput = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("input")).find((i) => i.value === "My retyped title");

describe("task 1158 — Edit entry closes only on a save that LANDED", () => {
  it("a refused save keeps the editor open with the typed fields, and says why", async () => {
    const { container, save } = renderCard({
      save: async () => ({ kind: "read-only" as const }),
    });
    openEditorAndType(container);
    fireEvent.click(screen.getByText("Save"));
    expect(save).toHaveBeenCalledTimes(1);
    const alert = await waitFor(() => {
      const el = container.querySelector("[data-bib-save-error]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert.textContent).toMatch(/read-only/i);
    expect(typedTitleInput(container)).toBeDefined();
  });

  it("an unbalanced-span refusal (failed) shows the door's own message", async () => {
    const { container } = renderCard({
      save: async () => ({
        kind: "failed" as const,
        error: new Error("references.bib could not be updated safely: unbalanced braces"),
      }),
    });
    openEditorAndType(container);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(container.querySelector("[data-bib-save-error]")?.textContent).toMatch(
        /unbalanced braces/,
      ),
    );
    expect(typedTitleInput(container)).toBeDefined();
  });

  it("a landed save closes the editor", async () => {
    const { container } = renderCard({
      save: async () => ({ kind: "written" as const, entries: [], bibText: "" }),
    });
    openEditorAndType(container);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(typedTitleInput(container)).toBeUndefined());
    expect(screen.getByText("Edit entry")).toBeTruthy();
  });
});

describe("task 1158 — the review composer keeps the note until the write LANDED", () => {
  const chip = (c: HTMLElement) =>
    c.querySelector('[data-review-request-chip="fields"]') as HTMLButtonElement;
  const noteInput = (c: HTMLElement) =>
    c.querySelector('[data-review-request-note="fields"]') as HTMLInputElement | null;

  it("a refused request keeps the typed note and shows the reason", async () => {
    const { container, request } = renderCard({
      request: async () => ({ ok: false as const, reason: "Not sent — nope." }),
    });
    fireEvent.click(chip(container));
    fireEvent.change(noteInput(container)!, { target: { value: "check the DOI" } });
    fireEvent.keyDown(noteInput(container)!, { key: "Enter" });
    expect(request).toHaveBeenCalledWith("foo2020", "fields", "check the DOI");
    await waitFor(() =>
      expect(
        container.querySelector('[data-review-request-error="fields"]')?.textContent,
      ).toBe("Not sent — nope."),
    );
    expect(noteInput(container)?.value).toBe("check the DOI");
  });

  it("a landed request closes the composer", async () => {
    const { container } = renderCard({});
    fireEvent.click(chip(container));
    fireEvent.change(noteInput(container)!, { target: { value: "check the DOI" } });
    fireEvent.keyDown(noteInput(container)!, { key: "Enter" });
    await waitFor(() => expect(noteInput(container)).toBeNull());
  });
});

describe("task 1158 — a host that refuses the write does not offer it", () => {
  it("under the Reader's chrome: no Edit entry, no Request review chips", () => {
    const { container } = renderCard({ reader: true });
    fireEvent.click(screen.getByText("BibTeX Fields"));
    expect(screen.queryByText("Edit entry")).toBeNull();
    expect(screen.getByText(/managed by the library/)).toBeTruthy();
    expect(container.querySelector("[data-review-request-chip]")).toBeNull();
  });

  it("the main app's chrome offers both", () => {
    const { container } = renderCard({});
    fireEvent.click(screen.getByText("BibTeX Fields"));
    expect(screen.getByText("Edit entry")).toBeTruthy();
    expect(container.querySelector('[data-review-request-chip="fields"]')).not.toBeNull();
  });
});

describe("task 1158 — useBibReview persists outside setState updaters", () => {
  it("no `persist(` call sits inside a `setState((prev) => …)` updater", () => {
    const src = readFileSync(join(__dirname, "../../hooks/useBibReview.ts"), "utf8");
    // Every updater body, from `setState((prev) =>` to its matching `});`.
    const updaters = src.split("setState((prev) =>").slice(1).map((tail) => {
      let depth = 1;
      for (let i = 0; i < tail.length; i++) {
        if (tail[i] === "(") depth++;
        else if (tail[i] === ")") depth--;
        if (depth === 0) return tail.slice(0, i);
      }
      return tail;
    });
    for (const body of updaters) expect(body).not.toMatch(/\bpersist\(/);
  });
});
