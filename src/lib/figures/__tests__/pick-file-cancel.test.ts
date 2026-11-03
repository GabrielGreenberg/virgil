// @vitest-environment jsdom
/**
 * Task 1436 member 6 — the hidden-input picker (Safari / Firefox / dev
 * backend) must not resolve a real pick as a cancel. The old fallback
 * resolved `null` one macrotask after the window regained focus, so a
 * `change` delivered any later dropped the user's file. Now the native
 * `cancel` event is the cancel where it exists (focus ignored), and the
 * focus fallback waits out `FOCUS_CANCEL_GRACE_MS`, inside which a late
 * `change` still wins.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage-mode", () => ({ fsaPickerUsable: () => false }));

import { pickFigureFile, FOCUS_CANCEL_GRACE_MS } from "@/lib/figures/pick-file";

function hiddenInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function choose(input: HTMLInputElement, name: string) {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, get: () => [file] });
  input.dispatchEvent(new Event("change"));
}

/** Hide the `oncancel` handler property so the picker takes the focus
 *  fallback, as on a browser without the native `cancel` event. */
function withoutNativeCancel(): () => void {
  let owner: object | null = HTMLInputElement.prototype;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, "oncancel")) {
    owner = Object.getPrototypeOf(owner);
  }
  if (!owner) return () => {};
  const desc = Object.getOwnPropertyDescriptor(owner, "oncancel")!;
  delete (owner as Record<string, unknown>).oncancel;
  return () => Object.defineProperty(owner!, "oncancel", desc);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("hidden-input picker: a real pick is never read as a cancel", () => {
  it("focus fallback: a `change` arriving after focus + 0 ms still resolves the file", async () => {
    const restore = withoutNativeCancel();
    try {
      const p = pickFigureFile();
      const input = hiddenInput();
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(50);
      choose(input, "late.png");
      const picked = await p;
      expect(picked?.file.name).toBe("late.png");
    } finally {
      restore();
    }
  });

  it("focus fallback: no `change` within the grace resolves null (a cancel)", async () => {
    const restore = withoutNativeCancel();
    try {
      const p = pickFigureFile();
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(FOCUS_CANCEL_GRACE_MS + 1);
      expect(await p).toBeNull();
    } finally {
      restore();
    }
  });

  it("native `cancel`: focus is ignored, `change` wins however late; `cancel` resolves null", async () => {
    if (!("oncancel" in document.createElement("input"))) return;
    const p = pickFigureFile();
    const input = hiddenInput();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(FOCUS_CANCEL_GRACE_MS * 5);
    choose(input, "slow.png");
    expect((await p)?.file.name).toBe("slow.png");

    const q = pickFigureFile();
    hiddenInput().dispatchEvent(new Event("cancel"));
    expect(await q).toBeNull();
  });
});
