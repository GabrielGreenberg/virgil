// @vitest-environment jsdom
//
// Task 110 — the SSOT card-level Delete/Backspace handler.
//
// `useCardDeleteKey` is the ONE keyboard-delete handler that the PanelCard-based
// cards which DON'T use EditableCard route through: the Cutter and Revision
// *suggestion* cards, plus Todo, Highlight, and Error. Before this hook each
// card hand-rolled the handler and some (the two suggestion cards) omitted the
// interactive-control guard — so a Backspace typed inside a selected card's
// editable field bubbled to the card root and deleted the whole card, with the
// user's typed content in it (reachable data loss). This pins the contract every
// one of those cards now inherits by construction:
//
//   1. fires the card's delete only when the card is `selected`;
//   2. NEVER fires (and never preventDefaults the key) when the keydown
//      originated inside a nested interactive control (a field), so the
//      character edit lands instead of the card vanishing;
//   3. still deletes on Backspace/Delete when focus is on the card SHELL.

import { describe, it, expect, vi } from "vitest";

// Importing the panel-primitives barrel pulls in `@/lib/storage`, whose backend
// require()s `@/lib/storage-fsa` (absent under vitest). Stub the storage surface
// so the pure UI hook under test imports cleanly (see the storage-mock note
// shared by the sibling panel-primitives tests).
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

import { renderHook } from "@testing-library/react";
import { useCardDeleteKey } from "@/components/panel-primitives";
import type React from "react";

/** A card shell containing an editable textarea + a plain input, so a keydown
 *  can be sourced from the shell itself or from a nested field. */
function makeTree() {
  const shell = document.createElement("div");
  const textarea = document.createElement("textarea");
  const input = document.createElement("input");
  const button = document.createElement("button");
  shell.append(textarea, input, button);
  return { shell, textarea, input, button };
}

function keydown(
  key: string,
  target: Element,
  currentTarget: Element,
): { evt: React.KeyboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const evt = { key, target, currentTarget, preventDefault } as unknown as React.KeyboardEvent;
  return { evt, preventDefault };
}

describe("useCardDeleteKey (task 110)", () => {
  it("deletes on Backspace when selected and focus is on the card shell", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    const { evt, preventDefault } = keydown("Backspace", shell, shell);
    result.current(evt);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("deletes on Delete when selected and focus is on the card shell", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    const { evt } = keydown("Delete", shell, shell);
    result.current(evt);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does NOT delete (nor preventDefault) when Backspace comes from an editable textarea field", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell, textarea } = makeTree();
    const { evt, preventDefault } = keydown("Backspace", textarea, shell);
    result.current(evt);
    expect(onDelete).not.toHaveBeenCalled();
    // The character edit must be allowed through — the handler leaves the key alone.
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does NOT delete when Delete comes from a plain input field", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell, input } = makeTree();
    const { evt } = keydown("Delete", input, shell);
    result.current(evt);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does NOT delete when the card is not selected", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(false, onDelete));
    const { shell } = makeTree();
    const { evt, preventDefault } = keydown("Backspace", shell, shell);
    result.current(evt);
    expect(onDelete).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores non-delete keys on the card shell", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    const { evt, preventDefault } = keydown("a", shell, shell);
    result.current(evt);
    expect(onDelete).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  // ── task 386: the guard is scoped to a STRICT DESCENDANT of the shell ──
  //
  // A card root is often itself `draggable="true"` (cross-editor anchor drags —
  // `CitationCard` ships it, and `EditableCard` has the wiring), and
  // `[draggable='true']` is a member of INTERACTIVE_CONTROL_SELECTOR. An
  // unscoped `closest()` from any nested target therefore walks PAST that
  // target and matches the card ROOT — so the guard would bail on every keydown
  // and the delete key would be dead app-wide, silently. `PanelCard`'s lift
  // blocklist scopes the identical query for the identical reason.
  it("still deletes from the shell when the shell ITSELF is draggable", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    shell.setAttribute("draggable", "true");
    const { evt } = keydown("Backspace", shell, shell);
    result.current(evt);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("still deletes from a NON-interactive descendant of a draggable shell", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    shell.setAttribute("draggable", "true");
    // e.g. the card's own focusable header row — not a field, so the key is a
    // card-delete, not a character edit.
    const header = document.createElement("div");
    header.tabIndex = 0;
    shell.appendChild(header);
    const { evt } = keydown("Backspace", header, shell);
    result.current(evt);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("an interactive ancestor OUTSIDE the shell is not this card's business", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell } = makeTree();
    const outer = document.createElement("div");
    outer.setAttribute("draggable", "true");
    outer.appendChild(shell);
    const header = document.createElement("div");
    shell.appendChild(header);
    const { evt } = keydown("Backspace", header, shell);
    result.current(evt);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("STILL bails for a field nested inside a draggable shell", () => {
    const onDelete = vi.fn();
    const { result } = renderHook(() => useCardDeleteKey(true, onDelete));
    const { shell, input } = makeTree();
    shell.setAttribute("draggable", "true");
    const { evt, preventDefault } = keydown("Backspace", input, shell);
    result.current(evt);
    expect(onDelete).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("is a no-op (no throw) when onDelete is undefined", () => {
    const { result } = renderHook(() => useCardDeleteKey(true, undefined));
    const { shell } = makeTree();
    const { evt, preventDefault } = keydown("Backspace", shell, shell);
    expect(() => result.current(evt)).not.toThrow();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
