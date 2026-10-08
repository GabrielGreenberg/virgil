// @vitest-environment jsdom
// Task 1016 — a bar status menu's lifetime is its KEBAB's.
//
//   1. A blocking-flow request that reaches the external-change badge while
//      disk watching is PAUSED (permission lost after a disk change) opens a
//      visible surface — the re-grant menu — not an anchorless invisible one.
//   2. Re-granting from that menu re-polls the watcher and leaves the menu
//      CLOSED when the live conflict pill replaces the paused one.
//   3. A menu open when its badge's condition clears does not pop back open
//      the next time the condition appears.
//   4. The primitive: `openMenu` with no kebab mounted opens nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { ExternalChangeState, FileChange } from "@/lib/disk-watcher";

const pollNow = vi.fn(async () => {});
const fakeWatcher = { acknowledge: vi.fn(), clearChanges: vi.fn(), pollNow } as unknown;
let currentState: ExternalChangeState;

vi.mock("@/hooks/useExternalChanges", () => ({
  useExternalChangesOrNull: () => ({ state: currentState, watcher: fakeWatcher }),
}));
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => ({
    activeDocId: "doc-1",
    reloadFromDisk: vi.fn(),
    resolveConflict: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDocumentInterruption", () => ({
  useDocumentInterruption: () => null,
}));
vi.mock("@/components/ConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true), dialog: null }),
}));
const fakeHandle = {} as FileSystemDirectoryHandle;
vi.mock("@/lib/doc-index", () => ({
  getDocHandle: vi.fn(async () => fakeHandle),
}));
const ensureRW = vi.fn(async (_h: unknown) => true);
vi.mock("@/lib/fsa-permissions", () => ({
  ensureRW: (h: unknown) => ensureRW(h),
}));

import ExternalChangeBadgeMemo from "../ExternalChangeBadge";
import { useBarStatusMenu } from "../status/BarStatusPill";
import { requestBlockingFlow, resetBlockingFlowRequests } from "@/lib/save-request";

const texModified: FileChange = { relPath: "main.tex", role: "tex", kind: "modified" };
const state = (over: Partial<ExternalChangeState>): ExternalChangeState => ({
  changes: [],
  severity: null,
  detectedAt: null,
  paused: false,
  ...over,
});
// The badge is memo'd with no props, and its store is a mock read at render —
// so a changing `tick` is what makes `rerender` re-read the mocked state
// WITHOUT remounting (a remount would make the lifetime assertions vacuous).
const Badge = ExternalChangeBadgeMemo as unknown as (p: { tick?: number }) => React.ReactElement | null;
let tick = 0;
const flush = () => new Promise((r) => setTimeout(r, 0));
const menu = () => document.body.querySelector('[role="menu"]');

beforeEach(() => {
  pollNow.mockClear();
  ensureRW.mockClear();
  resetBlockingFlowRequests();
});
afterEach(() => cleanup());

describe("task 1016 — paused external change: 'Resolve…' lands somewhere", () => {
  it("a conflict blocking-flow request opens the paused pill's re-grant menu", () => {
    currentState = state({ severity: "conflict", changes: [texModified], paused: true });
    render(<Badge tick={++tick} />);
    act(() => {
      requestBlockingFlow("doc-1", "conflict");
    });
    expect(menu()).toBeTruthy();
    expect(screen.getByText("Allow access…")).toBeTruthy();
  });

  it("re-granting re-polls, and the menu is closed once the live pill replaces the paused one", async () => {
    currentState = state({ severity: "conflict", changes: [texModified], paused: true });
    const { rerender } = render(<Badge tick={++tick} />);
    act(() => {
      requestBlockingFlow("doc-1", "conflict");
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Allow access…"));
      await flush();
    });
    expect(ensureRW).toHaveBeenCalledWith(fakeHandle);
    expect(pollNow).toHaveBeenCalledTimes(1);

    currentState = state({ severity: "conflict", changes: [texModified], paused: false });
    rerender(<Badge tick={++tick} />);
    expect(menu()).toBeNull();
    expect(screen.getByLabelText("External change options").getAttribute("aria-expanded")).not.toBe(
      "true",
    );
  });

  it("an open paused menu does not survive into the live pill (re-grant from elsewhere)", () => {
    currentState = state({ severity: "conflict", changes: [texModified], paused: true });
    const { rerender } = render(<Badge tick={++tick} />);
    fireEvent.click(screen.getByLabelText("Disk watching options"));
    expect(menu()).toBeTruthy();
    currentState = state({ severity: "conflict", changes: [texModified], paused: false });
    rerender(<Badge tick={++tick} />);
    expect(menu()).toBeNull();
  });
});

describe("task 1016 — the menu's state does not outlive its pill", () => {
  it("open menu, condition clears, condition returns → menu is closed", () => {
    currentState = state({ severity: "change", changes: [texModified] });
    const { rerender } = render(<Badge tick={++tick} />);
    fireEvent.click(screen.getByLabelText("External change options"));
    expect(menu()).toBeTruthy();

    currentState = state({ severity: null });
    rerender(<Badge tick={++tick} />);
    expect(menu()).toBeNull();

    currentState = state({ severity: "change", changes: [texModified] });
    rerender(<Badge tick={++tick} />);
    expect(menu()).toBeNull();
    expect(screen.getByLabelText("External change options").getAttribute("aria-expanded")).not.toBe(
      "true",
    );
  });

  it("openMenu with no kebab mounted opens nothing", () => {
    let seen: boolean | null = null;
    function Harness() {
      const ctl = useBarStatusMenu();
      const { openMenu } = ctl;
      useEffect(() => {
        openMenu();
      }, [openMenu]);
      seen = ctl.open;
      return null;
    }
    render(<Harness />);
    expect(seen).toBe(false);
  });
});
