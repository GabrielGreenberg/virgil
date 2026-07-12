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

  it("is a no-op (no throw) when onDelete is undefined", () => {
    const { result } = renderHook(() => useCardDeleteKey(true, undefined));
    const { shell } = makeTree();
    const { evt, preventDefault } = keydown("Backspace", shell, shell);
    expect(() => result.current(evt)).not.toThrow();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
