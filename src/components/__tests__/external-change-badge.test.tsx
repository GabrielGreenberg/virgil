// @vitest-environment jsdom
//
// ExternalChangeBadge — the topbar surface of the external-change subsystem.
//
// Pins the load-bearing render-by-severity + action map (DESIGN §5/§7):
//   1. severity === null            → renders NOTHING;
//   2. 'change' (amber)             → "Changed on disk"; Reload (NO confirm)
//                                     → reloadFromDisk; Dismiss → acknowledge;
//   3. 'change' + removed           → "Removed on disk" label;
//   4. 'conflict' (danger)          → "Disk changed · unsaved edits"; Reload is
//                                     gated behind a confirm; "Keep my version"
//                                     → acknowledge;
//   5. paused                       → muted "Watching paused", NO Reload;
//   6. the kebab menu portals to document.body (escapes the topbar z-30 trap).
//
// The two consumed hooks (useExternalChangesOrNull / useDiskWatcherOrNull) and
// the confirm dialog are mocked so this is a focused chrome test, not a full app
// boot. (The badge uses the NULLABLE hooks so it can render in the topbar on the
// no-document landing screen without a provider — see the no-provider test.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type {
  ExternalChangeState,
  FileChange,
} from "@/lib/disk-watcher";

// ── mocks ────────────────────────────────────────────────────────────
const reloadFromDisk = vi.fn(async () => {});
const acknowledge = vi.fn(async () => {});
const clearChanges = vi.fn(() => {});

// The fake watcher only needs `acknowledge` for the badge's actions.
const fakeWatcher = { acknowledge, clearChanges } as unknown;

let currentState: ExternalChangeState;

vi.mock("@/hooks/useExternalChanges", () => ({
  useExternalChangesOrNull: () => ({ state: currentState, watcher: fakeWatcher }),
}));

vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => ({ reloadFromDisk }),
}));

// Control the confirm resolution deterministically. `confirmResult` flips per
// test; `dialog` is a marker so we can assert it mounts but it's inert here.
let confirmResult = true;
const confirmSpy = vi.fn(async () => confirmResult);
vi.mock("@/components/ConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmSpy, dialog: null }),
}));

import ExternalChangeBadge from "../ExternalChangeBadge";

function state(over: Partial<ExternalChangeState>): ExternalChangeState {
  return {
    changes: [],
    severity: null,
    detectedAt: null,
    paused: false,
    ...over,
  };
}

const texModified: FileChange = {
  relPath: "main.tex",
  role: "tex",
  kind: "modified",
};
const texRemoved: FileChange = {
  relPath: "main.tex",
  role: "tex",
  kind: "removed",
};

beforeEach(() => {
  reloadFromDisk.mockClear();
  acknowledge.mockClear();
  clearChanges.mockClear();
  confirmSpy.mockClear();
  confirmResult = true;
});

afterEach(() => cleanup());

// Flush microtasks so awaited handlers (reload / acknowledge / confirm) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ExternalChangeBadge — render gate", () => {
  it("renders nothing when severity is null", () => {
    currentState = state({ severity: null });
    const { container } = render(<ExternalChangeBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a muted, non-actionable variant when paused (no Reload)", () => {
    currentState = state({
      severity: "change",
      changes: [texModified],
      paused: true,
    });
    render(<ExternalChangeBadge />);
    expect(screen.getByText("Watching paused")).toBeTruthy();
    // No Reload affordance while watching is paused.
    expect(screen.queryByText("Reload")).toBeNull();
  });
});

describe("ExternalChangeBadge — 'change' (amber, no unsaved edits)", () => {
  beforeEach(() => {
    currentState = state({ severity: "change", changes: [texModified] });
  });

  it("labels a modified change 'Changed on disk' and tones amber", () => {
    const { container } = render(<ExternalChangeBadge />);
    expect(screen.getByText("Changed on disk")).toBeTruthy();
    expect(
      container.querySelector('[data-external-change-badge="change"]'),
    ).toBeTruthy();
  });

  it("primary Reload calls reloadFromDisk WITHOUT a confirm", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Reload"));
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
  });

  it("Dismiss (kebab) calls watcher.acknowledge", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByLabelText("External change options"));
    fireEvent.click(screen.getByText("Dismiss"));
    await flush();
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("labels a removed change 'Removed on disk'", () => {
    currentState = state({ severity: "change", changes: [texRemoved] });
    render(<ExternalChangeBadge />);
    expect(screen.getByText("Removed on disk")).toBeTruthy();
  });
});

describe("ExternalChangeBadge — 'conflict' (danger, unsaved edits)", () => {
  beforeEach(() => {
    currentState = state({ severity: "conflict", changes: [texModified] });
  });

  it("labels the conflict and tones danger", () => {
    const { container } = render(<ExternalChangeBadge />);
    expect(screen.getByText("Disk changed · unsaved edits")).toBeTruthy();
    expect(
      container.querySelector('[data-external-change-badge="conflict"]'),
    ).toBeTruthy();
  });

  it("Reload is gated behind a confirm; confirmed → reloadFromDisk", async () => {
    confirmResult = true;
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Reload"));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
  });

  it("Reload confirm declined → reloadFromDisk NOT called", async () => {
    confirmResult = false;
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Reload"));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).not.toHaveBeenCalled();
  });

  it("'Keep my version' (kebab) calls watcher.acknowledge", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByLabelText("External change options"));
    fireEvent.click(screen.getByText("Keep my version"));
    await flush();
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });
});

describe("ExternalChangeBadge — menu portals to body", () => {
  it("the kebab menu renders under document.body, not inside the badge wrapper", () => {
    currentState = state({ severity: "change", changes: [texModified] });
    const { container } = render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByLabelText("External change options"));
    // The menu role="menu" container is portaled to body.
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    // It must NOT be a descendant of the component's own wrapper.
    expect(container.contains(menu)).toBe(false);
  });
});
