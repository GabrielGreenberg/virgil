// @vitest-environment jsdom
//
// Task 098 — the Style panel's "Document type" control. Pins the gate wiring
// end-to-end (the REAL `unsupportedSectioningFor` runs; only the per-doc hooks
// + storage are mocked):
//   - a SAFE swap (target supports every sectioning command the body uses —
//     e.g. article→book) applies as a silent, instant hard swap via
//     `setDocumentClass`, no dialog;
//   - a STRUCTURAL DOWNGRADE (target drops a command the body uses — e.g.
//     book→article with `\chapter`) routes to the restructuring prompt and
//     does NOT touch the .tex until the user confirms.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ManageStylesModal from "../ManageStylesModal";

const setDocumentClass = vi.fn(() => Promise.resolve());
const setStyle = vi.fn(() => Promise.resolve());

vi.mock("@/hooks/useDocumentStyle", () => ({
  useDocumentStyle: () => ({ styleId: "s1", setStyle, setDocumentClass }),
}));

vi.mock("@/hooks/useStyleLibrary", () => ({
  useStyleLibrary: () => ({
    styles: [
      {
        id: "s1",
        name: "Default",
        preamble: "\\documentclass{book}\n\\begin{document}\n\n",
        origin: "seed",
        createdAt: "",
        updatedAt: "",
      },
    ],
    defaultStyleId: "s1",
    addStyle: vi.fn(),
    updateStyle: vi.fn(),
    deleteStyle: vi.fn(),
    duplicateStyle: vi.fn(),
    setDefaultStyleId: vi.fn(),
  }),
}));

// The doc's live .tex — a book with a \chapter. Both the doc-preamble load
// (on open) and the gate read (on change) go through this.
let docLatex = "";
vi.mock("@/lib/storage", () => ({
  readTex: () => Promise.resolve(docLatex),
  drainDoc: () => Promise.resolve(),
}));

function renderModal() {
  return render(
    <ManageStylesModal
      onClose={() => {}}
      docId="doc1"
      aiRequests={[]}
      addStyleMergeRequest={vi.fn() as never}
    />,
  );
}

beforeEach(() => {
  setDocumentClass.mockClear();
  setStyle.mockClear();
});
afterEach(cleanup);

describe("ManageStylesModal — Document type control", () => {
  it("shows the current class and swaps hard when the target supports the body (article-only book → article)", async () => {
    docLatex =
      "\\documentclass{book}\n\\begin{document}\n\\section{A}\n\\end{document}";
    renderModal();

    const select = (await screen.findByLabelText(
      "Document type",
    )) as HTMLSelectElement;
    // Current class is reflected.
    await waitFor(() => expect(select.value).toBe("book"));

    // book → article; body uses only \section (article supports it) → hard.
    fireEvent.change(select, { target: { value: "article" } });
    await waitFor(() =>
      expect(setDocumentClass).toHaveBeenCalledWith("article"),
    );
    expect(screen.queryByText(/needs restructuring/i)).toBeNull();
  });

  it("routes a structural downgrade (book→article with \\chapter) to the prompt, applying only on confirm", async () => {
    docLatex =
      "\\documentclass{book}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    renderModal();

    const select = (await screen.findByLabelText(
      "Document type",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("book"));

    fireEvent.change(select, { target: { value: "article" } });

    // Prompt appears; .tex untouched.
    await screen.findByText(/needs restructuring/i);
    expect(setDocumentClass).not.toHaveBeenCalled();
    // The select snaps back to the current class until the swap applies.
    expect(select.value).toBe("book");

    // Confirm → the mechanical hard swap runs.
    fireEvent.click(screen.getByRole("button", { name: /change anyway/i }));
    await waitFor(() =>
      expect(setDocumentClass).toHaveBeenCalledWith("article"),
    );
  });

  it("does not fire a swap when re-selecting the current class", async () => {
    docLatex =
      "\\documentclass{book}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    renderModal();
    const select = (await screen.findByLabelText(
      "Document type",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("book"));

    fireEvent.change(select, { target: { value: "book" } });
    // No-op — neither a swap nor a prompt.
    await Promise.resolve();
    expect(setDocumentClass).not.toHaveBeenCalled();
    expect(screen.queryByText(/needs restructuring/i)).toBeNull();
  });
});
