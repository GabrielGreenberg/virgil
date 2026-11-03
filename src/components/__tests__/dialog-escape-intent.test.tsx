// @vitest-environment jsdom
//
// Task 1448 — **the dialog Escape doors answer only a deliberate press.**
//
// Both dialog Escape doors — `SystemDialog`'s bubble listener and
// `useNonModalDialogKeys` (the Fonts… window) — tested the raw key:
//
//  - IME: an Escape pressed while a Japanese/Chinese input method is composing
//    cancels the COMPOSITION. It closed the whole dialog, and its draft.
//  - Repeat: a HELD Escape over a stacked pair closed the top dialog, the
//    stack popped, and the next auto-repeat closed the dialog beneath — one
//    gesture, two dialogs.
//
// The legs drive the real shells with real `keydown`s on `window` (the doors'
// own seat), and close the dialogs for real so the stack actually pops.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import SystemDialog from "../system-dialog";
import FontsDialog from "../FontsDialog";
import { __resetDialogStack } from "../dialog-stack";
import { __resetRepeatSwallowForTests } from "@/lib/key-intent";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";

const rafs: FrameRequestCallback[] = [];
let realRaf: typeof window.requestAnimationFrame;

beforeEach(() => {
  realRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
});

afterEach(() => {
  cleanup();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  __resetDialogStack();
  __resetRepeatSwallowForTests();
});

function key(type: "keydown" | "keyup", init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true, ...init }),
    );
  });
}
const escape = (init: KeyboardEventInit = {}) => key("keydown", init);

/** A dialog that really closes (unmounts) when asked to. */
function Closable({ label, onClose }: { label: string; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SystemDialog
      open={open}
      variant="draggable"
      onClose={() => {
        onClose();
        setOpen(false);
      }}
    >
      <div>{label}</div>
    </SystemDialog>
  );
}

function Fonts({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <FontsDialog
      open={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      prefs={DEFAULT_PREFS}
      onUpdate={() => {}}
    />
  );
}

describe("SystemDialog's Escape door (task 1448)", () => {
  it("DEFECT: an IME composition-cancel Escape does not close the dialog", () => {
    const onClose = vi.fn();
    render(<Closable label="d" onClose={onClose} />);
    escape({ isComposing: true });
    escape({ keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("d")).toBeTruthy();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("DEFECT: a held Escape over a stacked pair closes only the top dialog", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Closable label="outer" onClose={outer} />
        <Closable label="inner" onClose={inner} />
      </>,
    );
    escape();
    escape({ repeat: true });
    escape({ repeat: true });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByText("outer")).toBeTruthy();
    // Release, then a fresh press closes the one beneath.
    key("keyup");
    escape();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("a repeat that arrives first (the dialog opened under a held key) ends nothing", () => {
    const onClose = vi.fn();
    render(<Closable label="d" onClose={onClose} />);
    escape({ repeat: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("useNonModalDialogKeys' Escape door — the Fonts… window (task 1448)", () => {
  it("DEFECT: an IME composition-cancel Escape does not cancel the window", () => {
    const onClose = vi.fn();
    render(<Fonts onClose={onClose} />);
    escape({ isComposing: true });
    escape({ keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("DEFECT: a held Escape over Preferences closes only Fonts", () => {
    const onPrefs = vi.fn();
    const onFonts = vi.fn();
    render(
      <>
        <Closable label="prefs" onClose={onPrefs} />
        <Fonts onClose={onFonts} />
      </>,
    );
    escape();
    escape({ repeat: true });
    expect(onFonts).toHaveBeenCalledTimes(1);
    expect(onPrefs).not.toHaveBeenCalled();
  });
});
