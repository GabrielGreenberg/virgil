// @vitest-environment jsdom
/**
 * A bibliography row, open (Gabriel, 2026-11-08): the reference; PDF ↗ only
 * when the library holds the paper, the citekey, the status word; "Cited in"
 * with ‹ n / N › and one clamped line per citation, the citation in bold and
 * the current one marked; the annotation as one line; and a foot whose
 * buttons each open ONE part of the entry's card.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
const libraryItems = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/hooks/useLibrary", () => ({ useLibraryItems: () => libraryItems }));
const openLibraryPdf = vi.hoisted(() => vi.fn());
vi.mock("@/lib/library/open-library-pdf", () => ({ openLibraryPdf }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Schema } from "@tiptap/pm/model";
import type { BibEntry } from "@/lib/types";
import { BibOpenView, sentencePartsAt } from "../BibOpenView";
import type { GutterListRow } from "../gutter-lists";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    citation: { group: "inline", inline: true, atom: true, attrs: { command: { default: "" }, displayText: { default: "" } } },
  },
});
const cite = (cmd: string) => schema.nodes.citation.create({ command: cmd, displayText: "" });
// "Intro. Margins speak back ⟨cite⟩ to readers. Then ⟨cite⟩ again."
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("Intro. Margins speak back "),
    cite("\\citet{jackson2001}"),
    schema.text(" to readers. Then "),
    cite("\\citep{jackson2001}"),
    schema.text(" again."),
  ]),
]);
const posOfCite = (n: number) => {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "citation") found.push(pos);
  });
  return found[n];
};

const entry = { uid: "j", key: "jackson2001", type: "book", fields: { author: "Jackson, H. J.", year: "2001", title: "Marginalia" }, raw: "" } as unknown as BibEntry;
const row: GutterListRow = {
  key: "bib:jackson2001",
  entityId: "jackson2001",
  marker: "",
  snippet: { kind: "reference", entry },
  pos: 1,
  jump: null,
  card: { kind: "bib", key: "jackson2001" },
  bibKey: "jackson2001",
};

function mount(over: Partial<Parameters<typeof BibOpenView>[0]> = {}) {
  const goTo = vi.fn();
  const close = vi.fn();
  const renderSection = vi.fn((c) => <div data-testid="section">{c.kind === "bib" ? c.section : ""}</div>);
  render(
    <BibOpenView
      row={row}
      bibKey="jackson2001"
      close={close}
      citationIds={["c1", "c2"]}
      current={null}
      goTo={goTo}
      cites={[
        { citationId: "c1", keys: ["jackson2001"], pos: posOfCite(0) },
        { citationId: "c2", keys: ["jackson2001"], pos: posOfCite(1) },
      ]}
      bibEntries={[entry]}
      sections={[]}
      doc={doc}
      renderSection={renderSection}
      {...over}
    />,
  );
  return { goTo, close, renderSection };
}

beforeEach(() => {
  libraryItems.items = [];
  openLibraryPdf.mockReset();
});

describe("BibOpenView", () => {
  it("splits the citing sentence so the citation can be bold", () => {
    expect(sentencePartsAt(doc, posOfCite(0), [entry], () => "Jackson (2001)")).toEqual({
      lead: "",
      before: "Margins speak back ",
      cite: "Jackson (2001)",
      after: " to readers.",
    });
  });

  it("shows one line per citation, steps ‹ n / N ›, and a line click jumps there", () => {
    const { goTo } = mount({ current: "c2" });
    const lines = document.querySelectorAll(".gutter-bib-cited-line");
    expect(lines).toHaveLength(2);
    expect(lines[1].hasAttribute("data-current")).toBe(true);
    expect(lines[0].querySelector("b")).not.toBeNull();
    expect(document.querySelector(".gutter-bib-stepper-count")!.textContent).toBe("2 / 2");
    fireEvent.click(document.querySelector('[data-gutter-act="next"]')!);
    expect(goTo).toHaveBeenLastCalledWith("c1", expect.anything());
    fireEvent.click(lines[0]);
    expect(goTo).toHaveBeenLastCalledWith("c1", expect.anything());
  });

  // Task 1573: the current occurrence is a citation, not a slot in the list.
  it("keeps the same citation current when a cite is inserted ahead of it", () => {
    const { goTo } = mount({ current: "c2", citationIds: ["c0", "c1", "c2"] });
    expect(document.querySelector(".gutter-bib-stepper-count")!.textContent).toBe("3 / 3");
    const current = document.querySelector(".gutter-bib-cited-line[data-current]");
    expect(current?.textContent).toBe(document.querySelectorAll(".gutter-bib-cited-line")[1].textContent);
    fireEvent.click(document.querySelector('[data-gutter-act="prev"]')!);
    expect(goTo).toHaveBeenLastCalledWith("c1", expect.anything());
  });

  it("a deleted current citation reads as none, never past the end", () => {
    const { goTo } = mount({ current: "gone" });
    expect(document.querySelector(".gutter-bib-stepper-count")!.textContent).toBe("– / 2");
    expect(document.querySelector(".gutter-bib-cited-line[data-current]")).toBeNull();
    fireEvent.click(document.querySelector('[data-gutter-act="next"]')!);
    expect(goTo).toHaveBeenLastCalledWith("c1", expect.anything());
  });

  it("offers no PDF ↗ when the library does not hold the paper", () => {
    mount();
    expect(screen.queryByText("PDF ↗")).toBeNull();
  });

  it("PDF ↗ opens the paper; a missing file shows a message, not a blank window", async () => {
    libraryItems.items = [{ id: "x", status: "ready", citekey: "jackson2001", indexTier: "indexed", bibState: "authenticated" }];
    openLibraryPdf.mockResolvedValue("missing");
    mount();
    expect(screen.getByText(/Verified/)).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("PDF ↗"));
    });
    expect(openLibraryPdf).toHaveBeenCalledWith("jackson2001");
    expect(screen.getByRole("status").textContent).toMatch(/no PDF/);
  });

  it("shows the annotation as one line, and each foot button opens only its part", () => {
    const { renderSection } = mount({ annotation: "A history of readers' notes." });
    expect(document.querySelector(".gutter-bib-note")!.textContent).toBe("Note: A history of readers' notes.");
    expect(screen.queryByTestId("section")).toBeNull();
    fireEvent.click(screen.getByText("Edit entry"));
    expect(screen.getByTestId("section").textContent).toBe("fields");
    expect(renderSection).toHaveBeenLastCalledWith({ kind: "bib", key: "jackson2001", section: "fields" });
    fireEvent.click(screen.getByText("Check with Claude"));
    expect(screen.getByTestId("section").textContent).toBe("review");
    fireEvent.click(screen.getByText("Check with Claude"));
    expect(screen.queryByTestId("section")).toBeNull();
  });

  it("its ⌄ closes the view", () => {
    const { close } = mount();
    fireEvent.click(document.querySelector("[data-gutter-list-close]")!);
    expect(close).toHaveBeenCalled();
  });
});
