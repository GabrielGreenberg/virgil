// @vitest-environment jsdom
//
/**
 * Task 833 — **queued imperative dialogs reused ONE React instance.**
 *
 * `SystemDialogProvider` renders only the head of its FIFO queue. Unkeyed, a
 * second same-kind ask reconciled INTO the first's `SystemDialog`: `open` never
 * left `true`, so the shell's per-open focus capture/restore and initial focus
 * never re-ran, native `autoFocus` (mount-only) never re-fired, and a queued
 * prompt kept the previous prompt's draft. The live hazard: confirm A answered
 * with Enter leaves focus on the reused right-hand button, which is now confirm
 * B's DANGER action — the next Enter destroys, bypassing task 386/528's derived
 * Cancel cue. The host now keys each ask by a minted id, so every ask mounts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { act, cleanup, render, screen } from "@testing-library/react";
import {
  SystemDialogProvider,
  useSystemDialog,
  type SystemDialogApi,
} from "../system-dialog-host";
import { __resetDialogStack } from "../dialog-stack";

const rafs: FrameRequestCallback[] = [];
let realRaf: typeof window.requestAnimationFrame;
let realCaf: typeof window.cancelAnimationFrame;

function flushFrames() {
  // A frame may schedule another (mount → focus rAF); drain a few rounds.
  for (let i = 0; i < 4 && rafs.length; i++) {
    const pending = rafs.splice(0, rafs.length);
    act(() => {
      for (const cb of pending) cb(performance.now());
    });
  }
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

let api: SystemDialogApi;
function Grab() {
  api = useSystemDialog();
  return null;
}

beforeEach(() => {
  realRaf = window.requestAnimationFrame;
  realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  render(
    <SystemDialogProvider>
      <Grab />
    </SystemDialogProvider>,
  );
});

afterEach(() => {
  cleanup();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  __resetDialogStack();
  vi.restoreAllMocks();
});

describe("SystemDialogProvider queue — each ask mounts its own dialog (task 833)", () => {
  it("a queued danger confirm takes its OWN cued default (Cancel), not the previous confirm's focused button", async () => {
    let a!: Promise<boolean>;
    let b!: Promise<boolean>;
    act(() => {
      a = api.confirm({ title: "First", message: "a", confirmLabel: "Go" });
      b = api.confirm({
        title: "Second",
        message: "b",
        confirmLabel: "Destroy",
        cancelLabel: "Keep",
        tone: "danger",
      });
    });
    flushFrames();

    const go = screen.getByRole("button", { name: "Go" });
    expect(document.activeElement).toBe(go);

    click(go);
    await expect(a).resolves.toBe(true);
    flushFrames();

    expect(screen.getByText("Second")).toBeTruthy();
    const keep = screen.getByRole("button", { name: "Keep" });
    const destroy = screen.getByRole("button", { name: "Destroy" });
    expect(document.activeElement).toBe(keep);
    expect(document.activeElement).not.toBe(destroy);

    click(keep);
    await expect(b).resolves.toBe(false);
  });

  it("a queued prompt shows its OWN initial value, not the previous prompt's draft", async () => {
    let a!: Promise<string | null>;
    let b!: Promise<string | null>;
    act(() => {
      a = api.prompt({ title: "One", initial: "alpha" });
      b = api.prompt({ title: "Two", initial: "beta" });
    });
    flushFrames();

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("alpha");
    click(screen.getByRole("button", { name: "OK" }));
    await expect(a).resolves.toBe("alpha");
    flushFrames();

    expect(screen.getByText("Two")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("beta");
    click(screen.getByRole("button", { name: "Cancel" }));
    await expect(b).resolves.toBeNull();
  });
});
