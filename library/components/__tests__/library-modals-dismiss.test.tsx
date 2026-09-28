// @vitest-environment jsdom
//
// TASK 820: the Library's two modals enter through the ONE dialog door
// (`SystemDialog`). Before, both hand-rolled a `role="dialog" aria-modal`
// shell, and `BibEditModal` — a multi-field draft form that is the only copy
// of the edit until Save queues it — discarded every typed field on Escape or
// a backdrop press with no question. Now every way out that is not Save asks
// when the form differs from its seed, and costs nothing when it does not.
// `PdfDropIntroDialog`'s dismissal is free, but must still report its "don't
// show again" checkbox on every path.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// `SystemDialogProvider` pulls `@/lib/storage`, whose backend `require` is not
// resolvable under vitest (the repo-wide gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { SystemDialogProvider } from "@/components/system-dialog-host";
import { __resetDialogStack } from "@/components/dialog-stack";
import type { BibEntry } from "@library/lib/types";
import BibEditModal from "@library/components/BibEditModal";
import PdfDropIntroDialog from "@library/components/PdfDropIntroDialog";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

const RAW = `@article{smith2020,
  author = {Smith, J.},
  title = {A Title},
  year = {2020}
}
`;

function makeEntry(): BibEntry {
  return {
    key: "smith2020",
    type: "article",
    fields: { author: "Smith, J.", title: "A Title", year: "2020" },
    raw: RAW,
  };
}

function renderBib() {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <SystemDialogProvider>
      <BibEditModal entry={makeEntry()} onSave={onSave} onClose={onClose} />
    </SystemDialogProvider>,
  );
  return { onClose, onSave };
}

function editTitle() {
  fireEvent.change(screen.getByDisplayValue("A Title"), {
    target: { value: "A Better Title" },
  });
}

function pressEscape() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const discardPrompt = () => screen.queryByText("Discard your changes?");

describe("BibEditModal — a dismissal cannot silently discard typed fields", () => {
  it("Escape on an EDITED entry asks instead of closing", async () => {
    const { onClose } = renderBib();
    editTitle();
    pressEscape();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).not.toBeNull();
    // The draft is still there behind the prompt.
    expect(screen.getByDisplayValue("A Better Title")).toBeTruthy();
  });

  it("a backdrop press on an EDITED entry asks instead of closing", async () => {
    const { onClose } = renderBib();
    editTitle();
    const scrim = screen.getByDisplayValue("A Better Title").closest("[role='dialog']")!;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).not.toBeNull();
  });

  it("✕ and Cancel ask too — neither enters the shell's door", async () => {
    const { onClose } = renderBib();
    editTitle();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).not.toBeNull();

    cleanup();
    __resetDialogStack();
    const second = renderBib();
    editTitle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(second.onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).not.toBeNull();
  });

  it("answering Discard closes; answering Keep editing keeps the draft", async () => {
    const { onClose } = renderBib();
    editTitle();
    pressEscape();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("A Better Title")).toBeTruthy();

    pressEscape();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("an UNEDITED entry closes on Escape without asking (pristine is free)", async () => {
    const { onClose } = renderBib();
    pressEscape();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });

  it("an edit typed and then undone by hand is pristine again", async () => {
    const { onClose } = renderBib();
    editTitle();
    fireEvent.change(screen.getByDisplayValue("A Better Title"), {
      target: { value: "A Title" },
    });
    pressEscape();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(discardPrompt()).toBeNull();
  });

  it("a raw block that no longer parses counts as work (it asks)", async () => {
    const { onClose } = renderBib();
    fireEvent.click(screen.getByRole("tab", { name: "Raw BibTeX" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@article{broken" } });
    pressEscape();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(discardPrompt()).not.toBeNull();
  });

  it("is labelled by its title and sits on the shell's modal frame", () => {
    renderBib();
    const dialog = screen.getByRole("dialog", { name: /Edit bib entry/ });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The modal radius tier comes from the shell's surface token, not the pod's.
    expect(dialog.querySelector(".rounded-xl")).not.toBeNull();
  });
});

describe("PdfDropIntroDialog — a free dismissal still reports the checkbox", () => {
  function renderIntro() {
    const onClose = vi.fn();
    render(
      <SystemDialogProvider>
        <PdfDropIntroDialog fileNames={["a.pdf"]} onClose={onClose} />
      </SystemDialogProvider>,
    );
    return onClose;
  }

  it("Escape reports the LIVE checkbox value", () => {
    const onClose = renderIntro();
    fireEvent.click(screen.getByRole("checkbox"));
    pressEscape();
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("Escape with the box unticked reports false", () => {
    const onClose = renderIntro();
    pressEscape();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("a backdrop press and the button report it too", () => {
    const onClose = renderIntro();
    fireEvent.click(screen.getByRole("checkbox"));
    const scrim = screen.getByRole("dialog");
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenLastCalledWith(true);

    cleanup();
    __resetDialogStack();
    const again = renderIntro();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(again).toHaveBeenCalledWith(false);
  });
});
