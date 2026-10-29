// @vitest-environment jsdom
/**
 * **A mode the user turned on stays visible when the Virgil bar collapses**
 * (task 1353).
 *
 * Gabriel: "When I collapse the top tool bar … if focus view is on, the focus
 * view pod should live outside of the collapsed toolbar." The chip used to be
 * hand-placed inside the collapsible tool group (`data-bar-tier="collapsible"`),
 * which collapse hides — so the mode's own off-switch vanished. The REAL
 * cluster is mounted here, collapsed, and asked where the chips are.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  isDevStorage: true,
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
  readTex: vi.fn(),
  drainDoc: vi.fn(),
}));

import { StatusCluster, type StatusClusterProps } from "@/components/editor-layout/StatusCluster";
import { useZenMode } from "@/hooks/useZenMode";

function props(over: Partial<StatusClusterProps> = {}): StatusClusterProps {
  const noop = () => {};
  return {
    vbar: { aiDot: null, compilePdf: noop, isCompiling: false, pdfStale: false },
    collabEnabled: false,
    zenModeOn: false,
    topbarRightCollapsed: true,
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
    preferencesOpen: false,
    setPreferencesOpen: noop,
    bugReportEnabled: false,
    bugReportOpen: false,
    setBugReportOpen: noop,
    appVersion: "0.0.0-test",
    helperBtnRef: createRef<HTMLButtonElement>(),
    helperMenuOpen: false,
    setHelperMenuOpen: noop,
    helperPositionRef: noop,
    helperPositionStyle: {},
    commandsPopoutOpen: false,
    setCommandsPopoutOpen: noop,
    onInsertVirgilCommand: noop,
    currentDocId: "doc1",
    codeView: false,
    pdfView: false,
    printOpen: false,
    setPrintOpen: noop,
    aiWindowOpen: false,
    setAiWindowOpen: noop,
    manageStylesOpen: false,
    setManageStylesOpen: noop,
    onToggleCodeView: noop,
    onTogglePdfView: noop,
    ...over,
  };
}

const chip = (mode: string) => document.querySelector(`[data-bar-mode="${mode}"]`);
const inCollapsible = (el: Element | null) => !!el?.closest('[data-bar-tier="collapsible"]');

afterEach(() => {
  const { result } = renderHook(() => useZenMode());
  act(() => result.current.set(false));
  cleanup();
});

describe("mode chips survive the bar's collapse (task 1353)", () => {
  it("Focus view ON + collapsed → the chip is visible, outside the collapsible group, and still exits focus", () => {
    const onFocusDeactivate = vi.fn();
    render(<StatusCluster {...props({ focusActive: true, onFocusDeactivate })} />);
    const el = chip("focus-view");
    expect(el).toBeTruthy();
    expect(inCollapsible(el)).toBe(false);
    const btn = el!.querySelector("button")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(onFocusDeactivate).toHaveBeenCalledTimes(1);
  });

  it("Helper mode ON + collapsed → visible outside the group", () => {
    render(<StatusCluster {...props({ helperOn: true })} />);
    expect(chip("helper-mode")).toBeTruthy();
    expect(inCollapsible(chip("helper-mode"))).toBe(false);
  });

  it("a running compile shows ONE spinner, outside the group", () => {
    const { container } = render(
      <StatusCluster {...props({ vbar: { aiDot: null, compilePdf: () => {}, isCompiling: true, pdfStale: false } })} />,
    );
    expect(chip("compile")).toBeTruthy();
    expect(inCollapsible(chip("compile"))).toBe(false);
    expect(container.querySelectorAll(".animate-spin").length).toBe(1);
  });

  it("modes OFF → no chips", () => {
    render(<StatusCluster {...props()} />);
    for (const m of ["focus-view", "helper-mode", "compile"]) expect(chip(m)).toBeNull();
  });

  it("expanded: the chips still sit left of the tools, with the divider inside the group", () => {
    const { container } = render(
      <StatusCluster {...props({ focusActive: true, topbarRightCollapsed: false })} />,
    );
    const group = container.querySelector('[data-bar-tier="collapsible"]')!;
    const el = chip("focus-view")!;
    // Document order: chip precedes the tool group.
    expect(el.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.querySelector("span.w-px")).toBeTruthy();
  });

  it("zen keeps hiding the chips (the policy's explicit zen rule)", () => {
    const { result } = renderHook(() => useZenMode());
    act(() => result.current.set(true));
    render(<StatusCluster {...props({ focusActive: true, helperOn: true, zenModeOn: true })} />);
    expect(chip("focus-view")).toBeNull();
    expect(chip("helper-mode")).toBeNull();
  });
});
