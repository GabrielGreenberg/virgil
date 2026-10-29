// @vitest-environment jsdom
/**
 * **Bar occupants are spaced by their CONTAINER** (task 1354).
 *
 * Gabriel, on the "⟳ Virgil update" pill sitting flush against the « chip:
 * "there should be a small gap between visual elements". Spacing in the strip
 * was owned by nobody — every item brought (or didn't bring) its own, and a
 * BORDERED pill shows its edge where a transparent `.topbarbtn`'s padding reads
 * as space. The fix states the gap ONCE: the status segment's `gap` + trailing
 * margin, both `--bar-occupant-gap`. jsdom resolves no CSS vars, so this pins
 * the SPECIFIED classes, not a computed gap.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  isDevStorage: true,
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
  readTex: vi.fn(),
  drainDoc: vi.fn(),
}));

import { StatusCluster, type StatusClusterProps } from "@/components/editor-layout/StatusCluster";
import { BAR_STATUS_PILL_CLASS } from "@/components/status/BarStatusPill";

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

const MARGIN = /(^|\s)!?-?m[trblxyse]?-/;
const segment = (c: HTMLElement) => c.querySelector('[data-bar-segment="status"]') as HTMLElement | null;

afterEach(() => cleanup());

describe("bar occupants: the container owns the gap (task 1354)", () => {
  it("the status segment states the gap and the trailing gap with ONE token", () => {
    const { container } = render(<StatusCluster {...props({ focusActive: true, helperOn: true })} />);
    const seg = segment(container)!;
    expect(seg).toBeTruthy();
    expect(seg.className).toContain("gap-[var(--bar-occupant-gap)]");
    expect(seg.className).toContain("mr-[var(--bar-occupant-gap)]");
    // Two pills showing together are siblings in the segment, so the gap spaces them.
    expect(seg.children.length).toBe(2);
  });

  it("no occupant carries its own margin — not the pill class, not any mounted item's root", () => {
    expect(BAR_STATUS_PILL_CLASS).not.toMatch(MARGIN);
    const { container } = render(
      <StatusCluster
        {...props({
          focusActive: true,
          helperOn: true,
          vbar: { aiDot: null, compilePdf: () => {}, isCompiling: true, pdfStale: false },
        })}
      />,
    );
    const seg = segment(container)!;
    expect(seg.children.length).toBeGreaterThan(0);
    for (const el of Array.from(seg.children)) {
      expect(el.getAttribute("class") ?? "").not.toMatch(MARGIN);
      expect((el as HTMLElement).style.margin + (el as HTMLElement).style.marginLeft + (el as HTMLElement).style.marginRight).toBe("");
    }
  });

  it("all quiet → the segment is :empty, so `empty:hidden` takes its trailing gap with it", () => {
    const { container } = render(<StatusCluster {...props()} />);
    const seg = segment(container)!;
    expect(seg.childNodes.length).toBe(0);
    expect(seg.className).toContain("empty:hidden");
  });

  it("the gap is NOT a root gap (it would double around the zero-width collapsed tools)", () => {
    const { container } = render(<StatusCluster {...props({ focusActive: true })} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/(^|\s)gap-/);
    // The tool group itself adds no gap between `.topbarbtn`s.
    const group = container.querySelector('[data-bar-tier="collapsible"]') as HTMLElement;
    expect(group.className).not.toMatch(/(^|\s)gap-/);
  });

  it("the token is declared once in globals.css, beside --bar-seam-lift", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css.match(/--bar-occupant-gap:\s*[^;]+;/g)?.length).toBe(1);
  });
});
