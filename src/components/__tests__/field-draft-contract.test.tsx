// @vitest-environment jsdom
//
// A FIELD WHOSE VALUE IS OWNED ELSEWHERE (task 532) — the behavioural half.
//
// Two fields edited a value some other thing owned, and each was missing one
// half of what that needs. They failed in OPPOSITE directions, which is why
// neither had a leg: the hex box rejected every keystroke and the todo title
// accepted every one of them and then wrote a stale value back.
//
// Every leg here drives the REAL component. The typing leg types ONE CHARACTER
// AT A TIME on purpose: a single `fireEvent.change` carrying a complete
// `#c45a5a` passes on the pre-532 implementation — its `onChange` committed
// exactly that string — and would have proved nothing about the box the user
// has to get there through.

import { describe, it, expect, vi, afterEach } from "vitest";

// `panel-primitives` reaches the card stack, which reaches `@/lib/storage` —
// whose backend `require` cannot resolve under vitest. The standing stub every
// suite that mounts a card carries.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "mutateSidecar", "readTex", "writeTex", "readDocBundle", "writeDocBundle",
    "readBib", "writeBib", "createDocFromPicker", "createDocInFolder",
    "pickProjectFolder", "registerDocInFolder", "openExistingDocFromPicker",
    "listDocs", "renameDoc", "deleteDocFromIndex", "flushDoc", "drainDoc",
    "detectBibPackage", "readPaperFolder", "getTexFilename", "writePdf",
    "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster",
    "readFigureIndex", "writeFigureIndex", "getDocWriteHandle",
    "importFigureFile", "deleteSidecarSiblings", "snapshotPriorBundle",
    "snapshotConflictSides", "listSidecarSiblings",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { HexColorField } from "../HexColorField";
import { CardTitleInput, CardBodyTitle } from "../panel-primitives";

afterEach(cleanup);

/** The pre-532 hex cell, reproduced locally so the defect legs fail for the
 *  reason they name rather than by arithmetic identity with the live rule. */
function LegacyHexBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      aria-label="legacy"
      value={value}
      onChange={(e) => {
        const v = e.target.value.trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(v)) onChange(v);
      }}
    />
  );
}

/** Drive a real controlled box the way a user does: one character appended per
 *  event, reading the box back each time. Returns what the box ends up
 *  holding. */
function typeInto(el: HTMLInputElement, text: string): string {
  for (const ch of text) {
    fireEvent.change(el, { target: { value: el.value + ch } });
  }
  return el.value;
}


/** The hex field's TEXT box. `getByDisplayValue` cannot pick it out: the native
 *  swatch beside it carries the same value, which is the whole point of the
 *  pair. */
function hexBox(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="text"]') as HTMLInputElement;
}

/** A field's OWNER, which is what makes a commit observable end to end: a
 *  harness that pins `value` and only spies on `onChange` is not a store, and
 *  the box correctly reverts to the source it was told is still there. */
function OwnedHex({ initial, spy }: { initial: string; spy: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <HexColorField
      value={value}
      onChange={(v) => {
        spy(v);
        setValue(v);
      }}
    />
  );
}

describe("M1 — the hex box is a DRAFT (task 532)", () => {
  it("accepts ordinary typing, one character at a time", () => {
    const onChange = vi.fn();
    const { container } = render(<HexColorField value="#000000" onChange={onChange} />);
    const box = hexBox(container);
    fireEvent.change(box, { target: { value: "" } });
    expect(typeInto(box, "#c45a5a")).toBe("#c45a5a");
    // Not one intermediate string reached the store.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("…which the pre-532 implementation could not do — the CANARY", () => {
    // Same keystrokes, the retired rule: React's controlled-input contract
    // resets `node.value` to the source after every event whose handler wrote
    // no state, so the box never leaves its starting value.
    const onChange = vi.fn();
    render(<LegacyHexBox value="#000000" onChange={onChange} />);
    const box = screen.getByLabelText("legacy") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "" } });
    expect(typeInto(box, "#c45a5a")).not.toBe("#c45a5a");
  });

  it("backspacing is legal", () => {
    const { container } = render(<HexColorField value="#c45a5a" onChange={vi.fn()} />);
    const box = hexBox(container);
    fireEvent.change(box, { target: { value: "#c45a5" } });
    expect(box.value).toBe("#c45a5");
  });

  it("commits on BLUR, auto-prefixing #", () => {
    const onChange = vi.fn();
    const { container } = render(<OwnedHex initial="#000000" spy={onChange} />);
    const box = hexBox(container);
    fireEvent.change(box, { target: { value: "c45a5a" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("#c45a5a");
    // …and the box is normalized to what was stored, so it is not left
    // permanently dirty against a source it agrees with.
    expect(box.value).toBe("#c45a5a");
  });

  it("Enter blurs, which is what commits", () => {
    const onChange = vi.fn();
    const { container } = render(<OwnedHex initial="#000000" spy={onChange} />);
    const box = hexBox(container);
    fireEvent.change(box, { target: { value: "#abcdef" } });
    box.focus();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("a malformed value does NOT commit — it flashes invalid and reverts", () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { container } = render(<HexColorField value="#000000" onChange={onChange} />);
      const box = hexBox(container);
      fireEvent.change(box, { target: { value: "nope" } });
      fireEvent.blur(box);
      expect(onChange).not.toHaveBeenCalled();
      expect(box.className).toContain("border-danger");
      expect(box.value).toBe("nope");
      act(() => { vi.advanceTimersByTime(900); });
      expect(box.value).toBe("#000000");
      expect(box.className).not.toContain("border-danger");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a bare focus+blur commits NOTHING", () => {
    const onChange = vi.fn();
    const { container } = render(<HexColorField value="#c45a5a" onChange={onChange} />);
    const box = hexBox(container);
    box.focus();
    fireEvent.blur(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the swatch RECONCILES the text box", () => {
    const { container, rerender } = render(<HexColorField value="#000000" onChange={vi.fn()} />);
    const box = hexBox(container);
    // The swatch writes the source; the source coming back down is what the
    // text box must follow.
    rerender(<HexColorField value="#123456" onChange={vi.fn()} />);
    expect(box.value).toBe("#123456");
  });

  it("a MID-EDIT draft is not clobbered by an external change, and wins on commit", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<HexColorField value="#000000" onChange={onChange} />);
    const box = hexBox(container);
    fireEvent.change(box, { target: { value: "#aaa" } });
    rerender(<HexColorField value="#123456" onChange={onChange} />);
    expect(box.value).toBe("#aaa");
    fireEvent.change(box, { target: { value: "#aaabbb" } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("#aaabbb");
  });
});

describe("M2 — an uncontrolled title RECONCILES and GUARDS (task 532)", () => {
  it("follows its source when the value changes beneath a mounted input", () => {
    const { rerender } = render(<CardTitleInput defaultValue="old title" onChange={vi.fn()} />);
    const box = screen.getByDisplayValue("old title") as HTMLInputElement;
    rerender(<CardTitleInput defaultValue="AI rewrote this" onChange={vi.fn()} />);
    // The SAME element — the row re-renders in place, it does not remount.
    expect(screen.getByRole("textbox")).toBe(box);
    expect(box.value).toBe("AI rewrote this");
  });

  it("a focus+blur that changed NOTHING calls onChange zero times", () => {
    const onChange = vi.fn();
    render(<CardTitleInput defaultValue="task" onChange={onChange} />);
    const box = screen.getByDisplayValue("task") as HTMLInputElement;
    box.focus();
    fireEvent.blur(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("…and a blur after a REAL edit still commits", () => {
    const onChange = vi.fn();
    render(<CardTitleInput defaultValue="task" onChange={onChange} />);
    const box = screen.getByDisplayValue("task") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "task two" } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("task two");
  });

  it("a MID-EDIT draft survives a concurrent external change and wins on blur", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CardTitleInput defaultValue="old" onChange={onChange} />);
    const box = screen.getByDisplayValue("old") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "my edit" } });
    rerender(<CardTitleInput defaultValue="AI rewrote this" onChange={onChange} />);
    expect(box.value).toBe("my edit");
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("my edit");
  });

  it("a blur after a purely EXTERNAL change does not write the stale value back", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CardTitleInput defaultValue="old" onChange={onChange} />);
    const box = screen.getByDisplayValue("old") as HTMLInputElement;
    rerender(<CardTitleInput defaultValue="AI rewrote this" onChange={onChange} />);
    fireEvent.blur(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CardBodyTitle follows its source too — the same staleness class", () => {
    const { rerender } = render(<CardBodyTitle value="old" onChange={vi.fn()} />);
    const box = screen.getByDisplayValue("old") as HTMLInputElement;
    rerender(<CardBodyTitle value="external" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBe(box);
    expect(box.value).toBe("external");
  });

  it("an input that UNMOUNTS and comes back is SEEDED, not dirty", () => {
    // `CardBodyTitle` renders a `+T` button instead of the input whenever the
    // title is empty, so the element genuinely comes and goes. A draft that has
    // just appeared holds whatever `defaultValue` gave it — a sync point, not
    // an edit — and reading it as an uncommitted edit leaves the re-mounted box
    // permanently dirty against a `lastSynced` left behind while it was gone,
    // i.e. never reconciled again.
    const onChange = vi.fn();
    const { rerender } = render(<CardBodyTitle value="A" onChange={onChange} />);
    expect(screen.getByDisplayValue("A")).toBeTruthy();

    // Title cleared ⇒ the input is replaced by the +T affordance.
    rerender(<CardBodyTitle value="" onChange={onChange} />);
    expect(screen.queryByRole("textbox")).toBeNull();

    // An external write lands while the input is gone, and the +T brings it
    // back seeded with that value…
    rerender(<CardBodyTitle value="Z" onChange={onChange} />);
    const box = screen.getByDisplayValue("Z") as HTMLInputElement;

    // …so a LATER external change must still reach it.
    rerender(<CardBodyTitle value="Q" onChange={onChange} />);
    expect(box.value).toBe("Q");
  });

  it("CardBodyTitle's Escape restores the source AND leaves the field clean", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CardBodyTitle value="kept" onChange={onChange} />);
    const box = screen.getByDisplayValue("kept") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "discard me" } });
    // The source ALSO moves while the edit is in flight — which is what makes
    // this leg falsifiable. With the draft dirty against `lastSynced` ("kept")
    // the reconcile correctly holds off, so the box still shows the edit.
    rerender(<CardBodyTitle value="external" onChange={onChange} />);
    expect(box.value).toBe("discard me");

    fireEvent.keyDown(box, { key: "Escape" });
    // Cancel adopts the CURRENT source, not the one the session opened with.
    expect(box.value).toBe("external");
    expect(onChange).not.toHaveBeenCalled();

    // …and marks the field CLEAN, so the next external change still reaches
    // it. A revert that only restored the DOM value would leave `lastSynced`
    // at "kept" and the field dirty forever.
    rerender(<CardBodyTitle value="later" onChange={onChange} />);
    expect(box.value).toBe("later");
  });
});
