// @vitest-environment jsdom
//
// Task 1186 — the bib card's Annotations editor was offered in the Library
// Reader, whose host refuses `annotations.json`: the user typed an annotation,
// saw it in the field, and it was gone on reload, with no message. Task 1158
// gated the card's other three write doors by hand and missed this one.
//
// The contract now: every door in `writes` takes its host permit from ONE
// door → persisted-target table, so under READER_CHROME
//   - an EXISTING annotation still reads, in a non-editable field, with a
//     reason beside it;
//   - with no annotation, the pod is not offered at all;
// and under full chrome the editor is unchanged (editable, toolbar on focus).

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

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BibEntryCard from "@/components/BibEntryCard";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { READER_CHROME, isSidecarWriteAllowed } from "@/components/editor-layout/chrome-config";
import type { BibEntry } from "@/lib/types";

afterEach(cleanup);

const ENTRY = {
  uid: "u-1186",
  key: "reader2024",
  type: "article",
  fields: { author: "A. Author", title: "A title", year: "2024" },
  raw: "",
} as BibEntry;

function renderCard(opts: { annotation: string; reader: boolean }) {
  const setAnnotation = vi.fn();
  const card = (
    <BibEntryCard
      entry={ENTRY}
      isSelected
      onClick={() => {}}
      getAnnotation={() => opts.annotation}
      setAnnotation={setAnnotation}
      onRequestReview={async () => ({ ok: true as const })}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={async () => ({ kind: "declined" as const })}
    />
  );
  const utils = render(
    opts.reader ? <EditorChromeProvider value={READER_CHROME}>{card}</EditorChromeProvider> : card,
  );
  return { setAnnotation, ...utils };
}

describe("bib annotation door asks the host (task 1186)", () => {
  it("premise: the Reader host refuses annotations.json", () => {
    expect(isSidecarWriteAllowed(READER_CHROME, "annotations.json")).toBe(false);
  });

  it("Reader + existing annotation: the pod reads it, but the field is not editable", () => {
    const { container } = renderCard({ annotation: "<p>kept note</p>", reader: true });
    fireEvent.click(screen.getByText("Annotations"));
    const dom = container.querySelector<HTMLElement>(".rtf-content");
    expect(dom).not.toBeNull();
    expect(container.textContent).toContain("kept note");
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.getByText(/annotations can't be saved in this view/i)).toBeTruthy();
    // No toolbar even on focus — there is nothing to format.
    fireEvent.focus(dom!);
    expect(container.querySelector('[data-hint="Bold"]')).toBeNull();
  });

  it("Reader + no annotation: the Annotations pod is not offered", () => {
    renderCard({ annotation: "", reader: true });
    expect(screen.queryByText("Annotations")).toBeNull();
  });

  it("full chrome: unchanged — the pod is offered and the field is editable", () => {
    const { container } = renderCard({ annotation: "", reader: false });
    fireEvent.click(screen.getByText("Annotations"));
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(screen.queryByText(/annotations can't be saved in this view/i)).toBeNull();
  });

  it("every write door's permit is derived from the door → target table", () => {
    const src = readFileSync(join(__dirname, "..", "BibEntryCard.tsx"), "utf8");
    const writes = src.slice(src.indexOf("const writes = readOnly"), src.indexOf("const draggable"));
    // Each door reads its permit through the table; no hand-written permit,
    // and no door handed through bare.
    for (const door of ["save", "setAnnotation", "requestReview", "cancelReview"]) {
      expect(writes).toMatch(new RegExp(`\\b${door}: hostPermitsDoor\\(chrome, "${door}"\\)`));
    }
    expect(writes).not.toMatch(/isSidecarWriteAllowed|isBibFileWriteAllowed/);
    expect(writes).toMatch(/satisfies Record<BibCardDoor, unknown>/);
  });
});
