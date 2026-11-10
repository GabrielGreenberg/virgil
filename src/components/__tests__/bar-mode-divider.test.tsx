// @vitest-environment jsdom
/**
 * **The bar's mode/tools divider is visible iff a mode chip is** (task 1391).
 *
 * The divider used to re-derive "a mode is on" from layout props
 * (`focusActive || helperOn || collabEnabled`) while the chips rendered
 * through the bar status policy — and `collabEnabled` was EditorLayout's
 * `collab.enabled` where the chip reads `CollabContext`. Any `settleMs` on a
 * mode entry, or one render where the two collab sources differed, painted a
 * divider beside an empty mode segment. It now asks `useAnyBarModeVisible`,
 * the chips' own verdicts. The REAL cluster is mounted, tools expanded.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, render, renderHook } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  isDevStorage: true,
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
  readTex: vi.fn(),
  drainDoc: vi.fn(),
}));

import { StatusCluster, type StatusClusterProps } from "@/components/editor-layout/StatusCluster";
import { useZenMode } from "@/hooks/useZenMode";
import { COLLAB_INERT, CollabProvider } from "@/hooks/useCollab";
import { BAR_STATUS_POLICY } from "@/lib/bar-status-policy";

function props(over: Partial<StatusClusterProps> = {}): StatusClusterProps {
  const noop = () => {};
  return {
    vbar: { aiDot: null, compilePdf: noop, isCompiling: false, pdfStale: false },
    zenModeOn: false,
    topbarRightCollapsed: false,
    setTopbarRightCollapsed: noop,
    hasDoc: true,
    skillSyncError: null,
    skillSyncNotice: null,
    onResyncSkills: noop,
    onDismissSkillSyncError: noop,
    onDismissSkillSyncNotice: noop,
    focusActive: false,
    onFocusDeactivate: noop,
    helperOn: false,
    onHelperToggle: noop,
    onEnableCollab: noop,
    onEditIdentity: noop,
    onDisableCollab: noop,
    onToggleZen: noop,
    setPreferencesOpen: noop,
    bugReportEnabled: false,
    setBugReportOpen: noop,
    appVersion: "0.0.0-test",
    onInsertVirgilCommand: noop,
    currentDocId: "doc1",
    codeView: false,
    pdfView: false,
    setPrintOpen: noop,
    aiWindowOpen: false,
    setAiWindowOpen: noop,
    setManageStylesOpen: noop,
    onToggleCodeView: noop,
    onTogglePdfView: noop,
    ...over,
  };
}

const divider = () => document.querySelector("[data-bar-mode-divider]");
const anyChip = () =>
  ["focus-view", "helper-mode"].some((m) => document.querySelector(`[data-bar-mode="${m}"]`)) ||
  // Zen's own off-switch (task 1552) is not one of the chips the divider
  // separates from the tools — in zen there are no tools.
  [...document.querySelectorAll('[data-bar-segment="status"] [data-bar-status-label]')].some(
    (n) => !n.closest('[data-bar-mode="zen"]'),
  );

afterEach(() => {
  const { result } = renderHook(() => useZenMode());
  act(() => result.current.set(false));
  vi.useRealTimers();
  cleanup();
});

describe("the mode divider follows the chips' own verdicts (task 1391)", () => {
  it("no mode on → no chip, no divider", () => {
    render(<StatusCluster {...props()} />);
    expect(anyChip()).toBe(false);
    expect(divider()).toBeNull();
  });

  it.each([
    ["focus view", { focusActive: true }],
    ["helper mode", { helperOn: true }],
  ] as const)("%s on → chip AND divider", (_, over) => {
    render(<StatusCluster {...props(over)} />);
    expect(anyChip()).toBe(true);
    expect(divider()).toBeTruthy();
  });

  it("collab is read from the ONE CollabContext — no layout prop can disagree", () => {
    render(
      <CollabProvider value={{ ...COLLAB_INERT, enabled: true }}>
        <StatusCluster {...props()} />
      </CollabProvider>,
    );
    expect(anyChip()).toBe(true);
    expect(divider()).toBeTruthy();
  });

  it("zen hides chips and divider alike", () => {
    const { result } = renderHook(() => useZenMode());
    act(() => result.current.set(true));
    render(<StatusCluster {...props({ focusActive: true, helperOn: true, zenModeOn: true })} />);
    expect(anyChip()).toBe(false);
    expect(divider()).toBeNull();
  });

  it("a settleMs'd mode entry: the divider waits out the SAME dwell as its chip", () => {
    vi.useFakeTimers();
    // The policy object is frozen at its top level; its entries are plain
    // objects, so a test can give one a dwell and put it back.
    const entry = BAR_STATUS_POLICY["focus-view"] as { settleMs: number };
    const original = entry.settleMs;
    entry.settleMs = 500;
    try {
      render(<StatusCluster {...props({ focusActive: true })} />);
      expect(document.querySelector('[data-bar-mode="focus-view"]')).toBeNull();
      expect(divider()).toBeNull();
      act(() => { vi.advanceTimersByTime(500); });
      expect(document.querySelector('[data-bar-mode="focus-view"]')).toBeTruthy();
      expect(divider()).toBeTruthy();
    } finally {
      entry.settleMs = original;
    }
  });
});
