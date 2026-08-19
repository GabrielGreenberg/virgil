// @vitest-environment jsdom
//
// ExternalChangeBadge — the topbar surface of the external-change subsystem.
//
// Pins the load-bearing render-by-severity + action map (DESIGN §5/§7):
//   1. severity === null            → renders NOTHING;
//   2. 'change' (amber)             → "Changed on disk"; Reload (NO confirm)
//                                     → reloadFromDisk; Dismiss → acknowledge;
//   3. 'change' + removed           → "Removed on disk" label;
//   4. 'conflict' (warning)         → "Changed on disk · unsaved edits"; BOTH
//                                     doors inline (Keep mine / Use disk), each
//                                     routed through `resolveConflict` (which
//                                     nets both sides first — task 364);
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

let outcome: unknown = {
  choice: "keep-mine",
  archive: { slot: "2026-01-01", disk: ["main.tex"], mine: "unsaved-main.tex" },
  applied: true,
};
const resolveConflict = vi.fn(async (_choice: string) => outcome);

vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => ({ reloadFromDisk, resolveConflict }),
}));

// Control the confirm resolution deterministically. `confirmResult` flips per
// test; `dialog` is a marker so we can assert it mounts but it's inert here.
let confirmResult = true;
const confirmSpy = vi.fn(async (_opts: { title?: string }) => confirmResult);
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
  resolveConflict.mockClear();
  outcome = {
    choice: "keep-mine",
    archive: { slot: "2026-01-01", disk: ["main.tex"], mine: "unsaved-main.tex" },
    applied: true,
  };
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

// RENEGOTIATED (task 364), not merely re-scoped. The four legs this replaces
// pinned the ONE-SIDED conflict affordance as intended behaviour: a danger
// tone, Reload behind a destructive confirm, and "Keep my version" reachable
// only from the kebab where it re-baselined the ledger and left the outcome to
// whenever the next autosave happened to fire. The detection they sat on was
// right; the affordance was the defect, so the assertions that described it are
// rewritten here rather than relaxed.
describe("ExternalChangeBadge — 'conflict' (warning, unsaved edits)", () => {
  beforeEach(() => {
    currentState = state({ severity: "conflict", changes: [texModified] });
  });

  it("labels the conflict calmly and does NOT paint the danger ramp", () => {
    const { container } = render(<ExternalChangeBadge />);
    expect(screen.getByText("Changed on disk · unsaved edits")).toBeTruthy();
    const pill = container.querySelector(
      '[data-external-change-badge="conflict"]',
    );
    expect(pill).toBeTruthy();
    // The tone is asserted on the SPECIFIED value: jsdom resolves no CSS vars,
    // so a computed read cannot tell `--amber-100` from `--danger-soft`.
    const swatch = pill!.querySelector("span")!.getAttribute("style") ?? "";
    expect(swatch).toContain("--amber-100");
    expect(swatch).not.toContain("--danger");
  });

  it("offers BOTH doors inline — the user's own side is not behind a menu", () => {
    render(<ExternalChangeBadge />);
    expect(screen.getByText("Keep mine")).toBeTruthy();
    expect(screen.getByText("Use disk")).toBeTruthy();
    // The one-sided "Reload" primary is gone from this tier.
    expect(screen.queryByText("Reload")).toBeNull();
  });

  it("'Keep mine' resolves through the conflict door, never a bare acknowledge", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Keep mine"));
    await flush();
    expect(resolveConflict).toHaveBeenCalledWith("keep-mine");
    // The pre-364 behaviour — re-baseline and hope the next autosave lands —
    // must NOT be what this button does.
    expect(acknowledge).not.toHaveBeenCalled();
    expect(reloadFromDisk).not.toHaveBeenCalled();
  });

  it("'Use disk' resolves through the conflict door, never a bare reload", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Use disk"));
    await flush();
    expect(resolveConflict).toHaveBeenCalledWith("take-disk");
    expect(reloadFromDisk).not.toHaveBeenCalled();
  });

  it("neither door takes a destructive confirm — the net is what replaces it", async () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Use disk"));
    await flush();
    fireEvent.click(screen.getByText("Keep mine"));
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("a resolution that got NO net is REPORTED, not passed off as done", async () => {
    outcome = { choice: "keep-mine", archive: null, applied: true };
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Keep mine"));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]?.title ?? "").toContain("no history copy");
  });

  it("a resolution that failed to APPLY is reported too", async () => {
    outcome = { choice: "take-disk", archive: null, applied: false };
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByText("Use disk"));
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]?.title ?? "").toContain("Couldn't resolve");
  });

  it("the kebab carries both full labels with their loss-side stated", () => {
    render(<ExternalChangeBadge />);
    fireEvent.click(screen.getByLabelText("External change options"));
    expect(screen.getByText("Keep my version")).toBeTruthy();
    expect(screen.getByText("Load the disk version")).toBeTruthy();
    expect(
      document.body.textContent?.includes("virgil/.history/"),
    ).toBe(true);
    // The copy names the likely writer rather than nobody.
    expect(document.body.textContent).toMatch(/sync service/i);
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
