// @vitest-environment jsdom
//
/**
 * Task 1447 — **an imperative dialog door kept ONE unkeyed pending slot.**
 *
 * `useConfirmDialog` (and, the same shape, `useDocumentClassMismatchDialog` and
 * `useCollaboratorIdentity`) stored its ask in a single `pending` state, so a
 * second `confirm()` while one was open REPLACED it: the first caller's
 * promise never settled, and the reconciled dialog kept the first ask's DOM —
 * focus on its Confirm button, so Enter on a chained DANGER confirm pressed
 * the destructive answer. Task 833 had fixed exactly this for
 * `SystemDialogProvider`; the hook doors are now on the SAME queue
 * (`useAskQueue`): FIFO, keyed per ask, every promise settled, unmount =
 * cancel.
 *
 * The census at the bottom pins the door: no source file parks a Promise's
 * `resolve` in a React state setter — a single slot is the defect.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useConfirmDialog } from "../ConfirmDialog";
import {
  useDocumentClassMismatchDialog,
  type MismatchResolution,
} from "../DocumentClassMismatchDialog";
import { useCollaboratorIdentity } from "../CollaboratorIdentityDialog";
import { __resetDialogStack } from "../dialog-stack";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import type { DocumentClassMismatch } from "@/lib/document-class";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

type ConfirmApi = ReturnType<typeof useConfirmDialog>;

function mountConfirmHost() {
  const ref: { api: ConfirmApi | null } = { api: null };
  function Host() {
    const api = useConfirmDialog();
    ref.api = api;
    return <>{api.dialog}</>;
  }
  const r = render(<Host />);
  return { api: () => ref.api!, ...r };
}

/** Settled-or-not probe for a promise, readable after a microtask flush. */
function track<T>(p: Promise<T>) {
  const box: { settled: boolean; value?: T } = { settled: false };
  void p.then((v) => {
    box.settled = true;
    box.value = v;
  });
  return box;
}

const flush = () => act(async () => {});

describe("useConfirmDialog queues overlapping asks (task 1447)", () => {
  it("two overlapping confirm() calls both resolve, in order", async () => {
    const host = mountConfirmHost();
    let a!: ReturnType<typeof track<boolean>>;
    let b!: ReturnType<typeof track<boolean>>;
    act(() => {
      a = track(host.api().confirm({ message: "First ask" }));
      b = track(host.api().confirm({ message: "Second ask" }));
    });
    // The FIRST ask is on screen; the second waits behind it.
    expect(screen.getByText("First ask")).toBeTruthy();
    expect(screen.queryByText("Second ask")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();
    expect(a).toEqual({ settled: true, value: true });
    expect(b.settled).toBe(false);
    expect(screen.getByText("Second ask")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();
    expect(b).toEqual({ settled: true, value: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a chained danger confirm mounts a FRESH dialog (keyed per ask)", async () => {
    const host = mountConfirmHost();
    act(() => {
      void host.api().confirm({ message: "Ordinary ask" });
      void host.api().confirm({
        message: "Destroy it?",
        tone: "danger",
        confirmLabel: "Delete",
      });
    });
    const firstConfirm = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(firstConfirm);
    await flush();
    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    // Reconciliation would have REUSED the first ask's button node (the one
    // focus sat on). A keyed ask mounts new DOM.
    expect(deleteBtn).not.toBe(firstConfirm);
    expect(firstConfirm.isConnected).toBe(false);
  });

  it("choose() queues behind confirm() on the same hook", async () => {
    const host = mountConfirmHost();
    let a!: ReturnType<typeof track<boolean>>;
    let b!: ReturnType<typeof track<string>>;
    act(() => {
      a = track(host.api().confirm({ message: "Yes or no" }));
      b = track(
        host.api().choose({ message: "Keep or revert", secondaryLabel: "Revert" }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    await flush();
    expect(a.value).toBe(true);
    expect(b.value).toBe("secondary");
  });

  it("unmount resolves every outstanding ask as cancel", async () => {
    const host = mountConfirmHost();
    let a!: ReturnType<typeof track<boolean>>;
    let b!: ReturnType<typeof track<string>>;
    act(() => {
      a = track(host.api().confirm({ message: "Open ask" }));
      b = track(
        host.api().choose({ message: "Queued ask", secondaryLabel: "Other" }),
      );
    });
    host.unmount();
    await flush();
    expect(a).toEqual({ settled: true, value: false });
    expect(b).toEqual({ settled: true, value: "cancel" });
  });
});

describe("the sibling hook doors share the queue", () => {
  const MISMATCH = {
    currentClass: "article",
  } as unknown as DocumentClassMismatch;

  it("useDocumentClassMismatchDialog: unmount resolves cancel for every prompt", async () => {
    const ref: { api: ReturnType<typeof useDocumentClassMismatchDialog> | null } =
      { api: null };
    function Host() {
      const api = useDocumentClassMismatchDialog();
      ref.api = api;
      // Rendering the real dialog needs a full mismatch; the queue is the
      // subject here, so the host keeps it off-screen.
      return null;
    }
    const r = render(<Host />);
    let a!: ReturnType<typeof track<MismatchResolution>>;
    let b!: ReturnType<typeof track<MismatchResolution>>;
    act(() => {
      a = track(ref.api!.prompt(MISMATCH));
      b = track(ref.api!.prompt(MISMATCH));
    });
    r.unmount();
    await flush();
    expect(a.value).toEqual({ kind: "cancel" });
    expect(b.value).toEqual({ kind: "cancel" });
  });

  it("useCollaboratorIdentity: two forced asks both settle", async () => {
    const ref: { api: ReturnType<typeof useCollaboratorIdentity> | null } = {
      api: null,
    };
    function Host() {
      const api = useCollaboratorIdentity();
      ref.api = api;
      return <>{api.dialog}</>;
    }
    const r = render(<Host />);
    let a!: ReturnType<typeof track<unknown>>;
    let b!: ReturnType<typeof track<unknown>>;
    act(() => {
      a = track(ref.api!.ensureIdentity({ force: true }));
      b = track(ref.api!.ensureIdentity({ force: true }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flush();
    expect(a).toEqual({ settled: true, value: null });
    expect(b.settled).toBe(false);
    r.unmount();
    await flush();
    expect(b).toEqual({ settled: true, value: null });
  });
});

/* ── CENSUS ──────────────────────────────────────────────────────── */

const SRC = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("CENSUS: no imperative ask parks its resolve in a single React slot", () => {
  it("no `new Promise((resolve) => set<State>(…))` anywhere in src/", () => {
    const re =
      /new Promise(?:<[^>]*>)?\(\s*\(\s*resolve\s*\)\s*=>\s*\{?\s*set[A-Z]\w*\(/;
    const offenders = walk(SRC)
      .filter((f) => re.test(codeOnly(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f));
    // Queue the ask through `useAskQueue` (src/hooks/useAskQueue.ts) instead.
    expect(offenders).toEqual([]);
  });
});
