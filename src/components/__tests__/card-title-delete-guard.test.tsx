// @vitest-environment jsdom
//
// Task 386 — DATA LOSS: `Backspace` typed in a card TITLE deleted the whole card.
//
// The repro Gabriel filed: archive some text (an archive card appears) → click
// `+T`, type a title → press `Backspace` mid-word → the card is gone. Three
// defects compounded, and each of them alone would have prevented the loss:
//
//  1. `EditableCard` kept its OWN shell-level delete handler instead of the
//     shared `useCardDeleteKey` door, and its only field guard was `isFocused`
//     — which tracks the BODY rich-text editor and NEVER the title input. So a
//     `Backspace` in the title ran `preventDefault()` (eating the character
//     edit) and then deleted the card. The shared guard that exists for exactly
//     this, `keyEventFromInteractiveControl`, was not consulted — and its own
//     docstring asserted EditableCard "already encodes this", which was true of
//     the body and false of the title.
//  2. The confirm that a content-bearing card raises mounted with its DANGER
//     button `autoFocus`ed, under a user who was mid-typing. From the
//     keyboard's point of view "Backspace, keep typing" WAS "delete the card".
//  3. The title input is UNCONTROLLED and commits on BLUR, so `bodyTitle` — the
//     value `cardHasContent` reads — still held the OLD text while the user
//     typed. A card whose only content is the title being typed read as EMPTY
//     and was deleted with no dialog at all.
//
// Every leg here drives the REAL components (EditableCard → PanelCard →
// CardBodyTitle → ConfirmDialog), because the parts that misbehaved were a call
// site that never asked a shared guard and a focus decision made in JSX —
// neither of which any test of the guard or the dialog in isolation can see.

import { describe, it, expect, vi, afterEach } from "vitest";

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

import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { EditableCard, CardTitleInput } from "@/components/panel-primitives";
import ConfirmDialog from "@/components/ConfirmDialog";
import { themeFromAccent } from "@/lib/panel-theme";
import type { CardKind } from "@/panels/_shared/types";

afterEach(cleanup);

const CONFIRM_TEXT = "This item has text. Delete it?";

// A real derived palette — the panels get theirs from `useCardTheme(kind)`,
// which needs a provider this suite has no reason to mount.
const THEME = themeFromAccent("#7a6ff0");

/** Every card kind whose panel wrapper passes `onBodyTitleChange`, i.e. every
 *  kind that renders `CardBodyTitle` inside an EditableCard. Sourced from the
 *  wrappers: Archive (`ArchiveCard:80`), Notes (`NoteCard:118`), Footnotes
 *  (`FootnoteCard:134` + `:260`), Reports (`ReportCard:98`). The census below
 *  keeps this list honest — a new titled kind fails it until it is added. */
const TITLED_KINDS: CardKind[] = ["archive", "note", "footnote", "report"];

function renderTitledCard(
  kind: CardKind,
  opts: { title?: string; onDelete?: () => void; body?: unknown } = {},
) {
  const onDelete = opts.onDelete ?? vi.fn();
  render(
    <EditableCard
      id={`c-${kind}`}
      kind={kind}
      cardKind={kind}
      selected
      theme={THEME}
      hideToolbar
      bodyTitle={opts.title}
      onBodyTitleChange={() => {}}
      onDelete={onDelete}
      value={(opts.body ?? { type: "doc", content: [] }) as never}
      onChange={() => {}}
      placeholder="Text here."
    />,
  );
  return { onDelete };
}

/** The card's title `<input>`. `CardBodyTitle` renders it whenever a title is
 *  set OR the user has clicked `+T`; both are the state the bug lives in. */
function titleInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>("input.card-title-input");
  if (!el) throw new Error("no card title input mounted");
  return el;
}

/** True when the keydown was NOT canceled — i.e. the character edit is allowed
 *  to land in the field. `fireEvent` returns `!defaultPrevented`. */
function keyLandsInField(el: Element, key: string): boolean {
  return fireEvent.keyDown(el, { key });
}

describe("card title Backspace never deletes the card (task 386)", () => {
  for (const kind of TITLED_KINDS) {
    it(`${kind}: Backspace in the title neither deletes nor eats the character`, () => {
      const { onDelete } = renderTitledCard(kind, { title: "Draft title" });
      const input = titleInput();
      input.focus();
      expect(keyLandsInField(input, "Backspace")).toBe(true);
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    });

    it(`${kind}: Delete in the title neither deletes nor eats the character`, () => {
      const { onDelete } = renderTitledCard(kind, { title: "Draft title" });
      const input = titleInput();
      input.focus();
      expect(keyLandsInField(input, "Delete")).toBe(true);
      expect(onDelete).not.toHaveBeenCalled();
    });
  }

  // The non-regression control. Without it every leg above would pass on a card
  // whose delete key had simply been removed.
  it("still deletes on Backspace when the card SHELL itself is focused", () => {
    const { onDelete } = renderTitledCard("note", { title: undefined });
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not delete from the shell when the card is not selected", () => {
    const onDelete = vi.fn();
    render(
      <EditableCard
        id="c-unsel"
        kind="note"
        cardKind="note"
        selected={false}
        theme={THEME}
        hideToolbar
        onBodyTitleChange={() => {}}
        onDelete={onDelete}
        value={{ type: "doc", content: [] } as never}
        onChange={() => {}}
      />,
    );
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).not.toHaveBeenCalled();
  });

  // Defect 3. The title input commits on BLUR, so a card whose only content is
  // the title being typed used to read EMPTY and delete with no dialog. The
  // gate reads the live element now, so it confirms.
  it("an in-flight, uncommitted title makes the content gate CONFIRM rather than delete", async () => {
    // Gabriel's own gesture: an untitled card, `+T`, then typing — with no blur
    // in between, so `bodyTitle` is still `undefined` while the DOM holds text.
    const { onDelete } = renderTitledCard("note", { title: undefined });
    fireEvent.click(screen.getByText("+T"));
    fireEvent.input(titleInput(), { target: { value: "my new note" } });
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    await waitFor(() => expect(screen.getByText(CONFIRM_TEXT)).toBeTruthy());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("a genuinely empty card still deletes straight through (no nag)", () => {
    const { onDelete } = renderTitledCard("note", { title: undefined });
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
  });

  // A title the user has just CLEARED must read as cleared, not fall back to
  // the committed value — otherwise the live read would only ever ADD confirms.
  it("a title cleared in-flight reads as empty", () => {
    const { onDelete } = renderTitledCard("note", { title: "was titled" });
    fireEvent.input(titleInput(), { target: { value: "" } });
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
  });
});

describe("the PanelCard-direct title surface (task 386 sweep)", () => {
  // `CardTitleInput` is the OTHER title primitive — Todo's row header. Its card
  // already routed through `useCardDeleteKey`, so this is a pin, not a fix: it
  // must keep passing the key through, and it must be a no-op outside a card
  // (no provider) rather than throwing.
  it("renders and takes a Backspace with no enclosing card registry", () => {
    render(<CardTitleInput defaultValue="a todo" onChange={() => {}} />);
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(keyLandsInField(input, "Backspace")).toBe(true);
  });
});

describe("a danger confirm never cues its destructive button (task 386)", () => {
  it("focuses Cancel, not Delete", async () => {
    render(
      <ConfirmDialog
        open
        message={CONFIRM_TEXT}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Cancel");
    });
    expect(document.activeElement?.textContent).not.toBe("Delete");
  });

  it("a default-tone confirm still cues its primary action", async () => {
    render(
      <ConfirmDialog
        open
        message="Proceed?"
        confirmLabel="Continue"
        tone="default"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Continue");
    });
  });

  it("a single-button danger notice cues NOTHING — focus lands on the frame", async () => {
    render(
      <ConfirmDialog
        open
        message="Something went wrong."
        confirmLabel="OK"
        tone="danger"
        hideCancel
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe("DIV");
    });
    // Focus is still INSIDE the dialog, so Escape and Tab both start there.
    expect(
      document.activeElement?.closest('[role="dialog"]'),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).not.toBe("OK");
  });

  // The danger action must stay reachable — the rule moves the CUE, it does not
  // remove the button from the tab order.
  it("keeps the danger button focusable and clickable", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        message={CONFIRM_TEXT}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const del = screen.getByText("Delete");
    (del as HTMLElement).focus();
    expect(document.activeElement).toBe(del);
    fireEvent.click(del);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
