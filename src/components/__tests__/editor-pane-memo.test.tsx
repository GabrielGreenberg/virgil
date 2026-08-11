// @vitest-environment jsdom
//
// Phase 5 (instant-switch render multiplier) memoization guards.
//
// Goal: a warm paper↔paper switch must re-render ONLY the newly-active
// keep-alive pane, not all 3 warm EditorPane bodies. That hinges on two
// things, pinned here:
//
//   (A) `buildEditorPaneViewPrefs` ISOLATES the scroll-churning section-path
//       fields (Phase 5a). Building the bundle with `EMPTY_SECTION_PATHS`
//       (the value EditorLayout passes to INACTIVE panes) yields the SAME
//       non-section-path field identities regardless of how the live section
//       path changes — so an inactive pane's `viewPrefs` prop is stable across
//       a scroll/switch and `React.memo(EditorPane)` can bail.
//
//   (B) `React.memo` with the DEFAULT shallow comparison actually bails: a
//       memoized component does NOT re-execute its body when its parent
//       re-renders with identity-stable props, but DOES when one of its own
//       props changes. A full EditorPane mount is far too heavy for jsdom, so
//       this tests the memo contract on a faithful stub that mirrors the
//       gated-prop pattern EditorLayout uses (active pane gets churning props;
//       inactive pane gets stable ones).
import { describe, it, expect } from "vitest";
import { memo, useRef, type ReactNode } from "react";
import { render } from "@testing-library/react";
import {
  buildEditorPaneViewPrefs,
  EMPTY_SECTION_PATHS,
  type EditorMutationHandlers,
  type EditorPaneViewDerivations,
  type EditorPaneSectionPaths,
} from "../editor-layout/build-editor-pane-view-prefs";
import type { UseViewPrefsResult } from "@/hooks/useViewPrefs";
import type { SectionPathEntry } from "@/panels/Outline";

/* ──────────────────────────────────────────────────────────────────────────
 * (A) buildEditorPaneViewPrefs — section-path isolation
 * ────────────────────────────────────────────────────────────────────────── */

// The builder only READS/COPIES fields, so a sparse object satisfies the test
// behavior; cast through `unknown` to the named types. All field VALUES used
// below are referentially stable across calls (defined once) so any identity
// change in the output can ONLY come from the section-path arg.
const stableFn = () => {};
const VP = {
  prefs: { placements: [] },
  getPanelWidth: stableFn,
  setPanelWidth: stableFn,
  setPanelHeight: stableFn,
  clearPanelHeight: stableFn,
  tradePanelHeights: stableFn,
  notePanelUse: {},
  setEditorLeftMargin: stableFn,
  setEditorRightMargin: stableFn,
  setEditorTopMargin: stableFn,
  setEditorBottomMargin: stableFn,
  setActiveLeft: stableFn,
  setActiveRight: stableFn,
  togglePanel: stableFn,
  movePanel: stableFn,
  closePopout: stableFn,
  setFloatPosition: stableFn,
  undockPanel: stableFn,
  redockPanel: stableFn,
  toggleCardPopout: stableFn,
  closeCardPopout: stableFn,
  setCardFloatPosition: stableFn,
  toggleOmniHideAllCards: stableFn,
  setBibFilter: stableFn,
  collapseLeft: stableFn,
  collapseRight: stableFn,
  expandLeft: stableFn,
  expandRight: stableFn,
  setBlank: stableFn,
  clearBlankIfSet: stableFn,
  openPanelDocked: stableFn,
  toggleOmniCategory: stableFn,
} as unknown as UseViewPrefsResult;

const HANDLERS = {
  onEditOrphan: stableFn,
  onDeleteOrphan: stableFn,
  onEditOrphanTitle: stableFn,
  onScrollToHeading: stableFn,
  onReorderBlocks: stableFn,
  onRenameHeading: stableFn,
  onRenameParTitle: stableFn,
  onUpdateLabel: stableFn,
  isLabelTaken: () => false,
  onFocusActivate: stableFn,
  onFocusDeactivate: stableFn,
  onFocusToggleLock: stableFn,
  onFocusMoveTo: stableFn,
  onFocusExpandTo: stableFn,
  onFocusSnapBoundary: stableFn,
  focusFloating: stableFn,
  setIsResizingPanels: stableFn,
  syncPanelPrefsToRendered: stableFn,
  setZenLeftMargin: stableFn,
  setZenRightMargin: stableFn,
  setCardArchiveView: stableFn,
  setSuppressArchiveAtomWarning: stableFn,
} as unknown as EditorMutationHandlers;

const VIEW = {
  isResizingPanels: false,
  focusState: null,
  zenMode: false,
  zenLeftMargin: 0,
  zenRightMargin: 0,
  getOmniEnabled: stableFn,
  getOmniHideAll: stableFn,
  setOmniSideToDefault: stableFn,
  categorySides: {},
  remapCardPopKey: stableFn,
} as unknown as EditorPaneViewDerivations;

describe("buildEditorPaneViewPrefs — section-path isolation (Phase 5a)", () => {
  it("inactive bundle: a section-path change leaves EVERY field identical", () => {
    // Two builds with the SAME inputs the inactive pane gets (EMPTY_SECTION_PATHS),
    // representing two renders across a scroll/switch.
    const a = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, EMPTY_SECTION_PATHS);
    const b = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, EMPTY_SECTION_PATHS);

    // Section paths are pinned to the SAME frozen empty constants.
    expect(a.activeSectionPath).toBe(b.activeSectionPath);
    expect(a.activeParTitleIndex).toBe(b.activeParTitleIndex);

    // And every other field carried through is referentially identical, so a
    // shallow prop compare of the two bundles would report them equal.
    expect(a.prefs).toBe(b.prefs);
    expect(a.togglePanel).toBe(b.togglePanel);
    expect(a.onScrollToHeading).toBe(b.onScrollToHeading);
    expect(a.getOmniEnabled).toBe(b.getOmniEnabled);
    expect(a.setBibFilter).toBe(b.setBibFilter);
  });

  it("active bundle: the live section path flows through to the consumers", () => {
    const path1 = [{ level: 1 } as unknown as SectionPathEntry];
    const path2 = [{ level: 2 } as unknown as SectionPathEntry];
    const sp1: EditorPaneSectionPaths = {
      activeSectionPath: path1,
      activeParTitleIndex: 0,
    };
    const sp2: EditorPaneSectionPaths = {
      activeSectionPath: path2,
      activeParTitleIndex: 3,
    };

    const a = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, sp1);
    const b = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, sp2);

    // The active pane DOES see the section path change (so the breadcrumb /
    // Outline highlight stay live) ...
    expect(a.activeSectionPath).toBe(path1);
    expect(b.activeSectionPath).toBe(path2);
    expect(a.activeParTitleIndex).toBe(0);
    expect(b.activeParTitleIndex).toBe(3);

    // ... while the NON-section-path fields are still identical between builds
    // (only the section path moved), proving the churn is contained to those 4
    // fields and nothing else in the bundle re-identifies.
    expect(a.prefs).toBe(b.prefs);
    expect(a.togglePanel).toBe(b.togglePanel);
    expect(a.onScrollToHeading).toBe(b.onScrollToHeading);
  });

  it("orphanedFootnotes is NOT sourced from handlers (Phase 5b)", () => {
    // The orphan ARRAY no longer rides the shared bundle from the builder; it
    // defaults to the stable empty list (EditorPane injects the per-doc list).
    const a = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, EMPTY_SECTION_PATHS);
    const b = buildEditorPaneViewPrefs(VP, HANDLERS, VIEW, EMPTY_SECTION_PATHS);
    expect(a.orphanedFootnotes).toEqual([]);
    // Stable identity across builds → does not bust an inactive pane's memo.
    expect(a.orphanedFootnotes).toBe(b.orphanedFootnotes);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * (B) React.memo bail contract — the faithful stub
 * ────────────────────────────────────────────────────────────────────────── */

// A render-body-execution counter, the SAME measurement the // __P5_PROBE
// counters use in the real components.
const bodyRuns: Record<string, number> = {};

type PaneStubProps = {
  paneId: string;
  // A "churning" prop (mirrors `viewPrefs` / `menuBar`): the active pane gets a
  // fresh value each parent render; the inactive pane gets a stable one.
  viewPrefs: object;
  // A gated prop (mirrors `onAiWindowClose`): undefined for inactive panes.
  onClose?: () => void;
};

const PaneStub = memo(function PaneStub({ paneId, viewPrefs }: PaneStubProps) {
  bodyRuns[paneId] = (bodyRuns[paneId] || 0) + 1;
  // Touch the prop so it isn't elided.
  void viewPrefs;
  return null;
});

// A parent that mirrors the keep-alive map: one active pane (id "active") whose
// props churn each render, and one inactive pane (id "inactive") whose props
// are pinned to stable module constants — exactly the EditorLayout gating.
const STABLE_INACTIVE_VIEWPREFS = { kind: "inactive" };
const STABLE_NOOP = () => {};

function Harness({ tick }: { tick: number }) {
  // Re-created every render → the ACTIVE pane's prop identity changes per tick
  // (the section-path / menuBar churn). useRef would defeat the point.
  const activeViewPrefs = { kind: "active", tick };
  // Stable across renders for the inactive pane.
  const stableRef = useRef(STABLE_INACTIVE_VIEWPREFS);
  return (
    <>
      <PaneStub
        paneId="active"
        viewPrefs={activeViewPrefs}
        onClose={STABLE_NOOP}
      />
      <PaneStub
        paneId="inactive"
        viewPrefs={stableRef.current}
        onClose={undefined}
      />
    </>
  ) as ReactNode;
}

describe("React.memo(EditorPane) bail contract (Phase 5d)", () => {
  it("re-rendering the parent re-runs ONLY the pane whose props changed", () => {
    bodyRuns.active = 0;
    bodyRuns.inactive = 0;

    const { rerender } = render(<Harness tick={0} />);
    expect(bodyRuns.active).toBe(1);
    expect(bodyRuns.inactive).toBe(1);

    // Parent re-renders 5 times (the "render multiplier" — ~28× in prod).
    for (let t = 1; t <= 5; t++) rerender(<Harness tick={t} />);

    // The active pane re-runs every time (its viewPrefs identity churns) ...
    expect(bodyRuns.active).toBe(6);
    // ... but the inactive pane's body did NOT re-run: its props are
    // identity-stable, so memo bailed. This is the multiplier being killed.
    expect(bodyRuns.inactive).toBe(1);
  });

  it("the inactive pane DOES re-run when ITS OWN prop changes", () => {
    bodyRuns.active = 0;
    bodyRuns.inactive = 0;

    // A harness where the inactive pane's viewPrefs DOES change per tick.
    function ChangingHarness({ tick }: { tick: number }) {
      return (
        <PaneStub
          paneId="inactive"
          viewPrefs={{ kind: "inactive", tick }}
          onClose={undefined}
        />
      ) as ReactNode;
    }

    const { rerender } = render(<ChangingHarness tick={0} />);
    expect(bodyRuns.inactive).toBe(1);
    rerender(<ChangingHarness tick={1} />);
    // A genuine prop change must NOT be swallowed (a custom `() => true`
    // comparator would have frozen it — we use the default shallow compare).
    expect(bodyRuns.inactive).toBe(2);
  });
});
