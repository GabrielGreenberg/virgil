// @vitest-environment jsdom
/**
 * THE VIRGIL BAR'S ONE WIDTH NEGOTIATION (task 2026-08-19-395).
 *
 * Gabriel's screenshot: at a narrow window the bar's tool icons painted
 * directly across the "Coherence Intro: main.tex" tab label. His decision,
 * quoted: "text tabs should occlude the tools in this case" — under
 * compression tabs have priority and the tools yield.
 *
 * The bar had three independent positioners and no priority rule, while
 * TopBar's own comment claimed "the toolbar never overlaps tabs even when they
 * crowd the middle", clamped against a "topbar-left sentinel" that was a
 * COMMENT with no element and no consumer — the floating MenuBar pod that once
 * read a clamp was retired two months earlier (93b286c0 moved the MenuBar into
 * the pod chrome header; bab3a399 deleted the dead `menuLocation` pref). This
 * suite is what makes the invariant a mechanism.
 *
 * ## What can and cannot be measured here
 *
 * jsdom has no layout, so "the pod's box does not intersect any tab's box" is
 * not a question this environment can answer at all — every rect is zero. What
 * IS measurable, and is what the fix actually turns on, is the DECISION: given
 * the three widths a `ResizeObserver` reports, does the bar collapse the right
 * occupant, and does it stay put? So the suite has three layers:
 *
 *   1. the pure rule (`resolveBarOccupancy`), including the property a naive
 *      "do the tabs overflow?" implementation fails — state-independence;
 *   2. the REAL `TopBar` (real `TabStrip`, real `StatusCluster`) driven
 *      through a fake `ResizeObserver`, asserting the tools become
 *      unreachable / reachable and that the auto rule never writes the pref;
 *   3. a source census for the two halves a render cannot see — the strip's
 *      horizontal clip (the structural FLOOR: no overflow can reach the
 *      protected badges) and the shared label cap.
 *
 * A preview eyeball at the screenshot's width is OWED, not claimed: this run
 * was unattended and could not start a dev server. The class is NOT
 * FSA-masked, so that check is cheap and real.
 *
 * Task 561 added the ladder UNDER tier 2 (`tab-strip-occupancy.ts`): when the
 * tabs still do not fit after the tools have yielded, they COMPRESS (inactive
 * tabs ellipsize to a shared floor; the active tab resists) and then the strip
 * SCROLLS with the active tab kept in view — the product decision 395 left
 * open ("a scroll, an overflow chevron"), answered by Gabriel: scroll. Section
 * 5 below pins it against the REAL bar; the rule's own anti-oscillation
 * property gains the leg it needed once the row could compress (a rule fed
 * the COMPRESSED width would collapse the tools, watch the tabs decompress,
 * expand them, and loop).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRef, useEffect, useRef, useState } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { codeOnly, commentsStripped, tagsContaining } from "@/lib/__tests__/_source-scan";
import {
  resolveBarOccupancy,
  BAR_FIT_EPSILON_PX,
} from "@/components/editor-layout/bar-occupancy";

vi.mock("@/lib/storage", () => ({
  isDevStorage: () => true,
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
  readTex: vi.fn(),
  drainDoc: vi.fn(),
}));
vi.mock("@/lib/pomodoro-chime", () => ({
  playPomodoroChime: vi.fn(),
  armPomodoroAudio: vi.fn(),
}));

import { TopBar, type TopBarProps } from "@/components/editor-layout/TopBar";
import type { TabStripProps } from "@/components/editor-layout/TabStrip";
import {
  StatusCluster,
  type StatusClusterProps,
} from "@/components/editor-layout/StatusCluster";
import type { FsaDocMeta } from "@/lib/doc-index";
import { OUTER_LIBRARY_ROOT_ID } from "@/lib/doc-index";
import {
  FOLDER_TAB_SEAM_OVERLAP,
  TAB_LABEL_MAX_PX,
} from "@/components/chrome/folder-tab-geometry";
import {
  TAB_LABEL_ATTR,
  TAB_LABEL_FLOOR_MIN_WIDTH,
} from "@/components/chrome/tab-strip-occupancy";

// ───────────────────────────────────────────────────────────────────────────
// 1. The rule
// ───────────────────────────────────────────────────────────────────────────

const E = BAR_FIT_EPSILON_PX;

describe("the occupancy rule", () => {
  it("leaves the tools alone when the tabs fit beside them", () => {
    expect(
      resolveBarOccupancy({
        tabStripPx: 800,
        tabsNaturalPx: 300,
        toolsNaturalPx: 200,
        toolsCollapsed: false,
      }).toolsCollapsed,
    ).toBe(false);
  });

  it("collapses the tools when the tab row needs their width — tabs > tools", () => {
    expect(
      resolveBarOccupancy({
        tabStripPx: 250,
        tabsNaturalPx: 300,
        toolsNaturalPx: 200,
        toolsCollapsed: false,
      }).toolsCollapsed,
    ).toBe(true);
  });

  it("is STATE-INDEPENDENT: one world, one verdict, measured from either state", () => {
    // The leg with teeth, and the reason the predicate is written the way it
    // is. Fix a world — bar W, protected R, tabs T, tools K — and describe it
    // from both states. `tabStripPx` differs by exactly K between them, and
    // the verdict must not.
    for (const [W, R, T, K] of [
      [900, 120, 500, 200],
      [700, 120, 500, 200],
      [640, 120, 500, 200], // collapsing frees JUST enough: the oscillation band
      [500, 120, 500, 200],
      [300, 120, 500, 200],
    ] as const) {
      const expanded = resolveBarOccupancy({
        tabStripPx: W - R - K,
        tabsNaturalPx: T,
        toolsNaturalPx: K,
        toolsCollapsed: false,
      }).toolsCollapsed;
      const collapsed = resolveBarOccupancy({
        tabStripPx: W - R,
        tabsNaturalPx: T,
        toolsNaturalPx: K,
        toolsCollapsed: true,
      }).toolsCollapsed;
      expect(
        collapsed,
        `W=${W} R=${R} T=${T} K=${K}: the verdict flipped with the state it ` +
          "was measured in — that is the flip-flop the predicate exists to avoid",
      ).toBe(expanded);
      // …and it agrees with the state-free statement of the same question.
      expect(expanded).toBe(!(T + K + R <= W));
    }
  });

  it("fails OPEN on any missing measurement (pre-first-measure, and zen's absent strip)", () => {
    for (const m of [
      { tabStripPx: null, tabsNaturalPx: 300, toolsNaturalPx: 200 },
      { tabStripPx: 100, tabsNaturalPx: null, toolsNaturalPx: 200 },
      { tabStripPx: 100, tabsNaturalPx: 300, toolsNaturalPx: null },
    ]) {
      expect(
        resolveBarOccupancy({ ...m, toolsCollapsed: false }).toolsCollapsed,
        "an unmeasured bar must keep every occupant visible",
      ).toBe(false);
    }
  });

  it("never collapses into a chip that reveals nothing", () => {
    expect(
      resolveBarOccupancy({
        tabStripPx: 10,
        tabsNaturalPx: 300,
        toolsNaturalPx: 0,
        toolsCollapsed: false,
      }).toolsCollapsed,
    ).toBe(false);
  });

  it("spends its epsilon on the state it is already in", () => {
    // Exactly at the boundary a fractional contentRect could wobble across.
    const world = { tabsNaturalPx: 300, toolsNaturalPx: 200 };
    expect(
      resolveBarOccupancy({ ...world, tabStripPx: 300, toolsCollapsed: false })
        .toolsCollapsed,
      "expanded: a hair of crowding is tolerated before collapsing",
    ).toBe(false);
    expect(
      resolveBarOccupancy({
        ...world,
        tabStripPx: 300 + E,
        toolsCollapsed: true,
      }).toolsCollapsed,
      "collapsed: expanding demands a clear win, not a tie",
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The REAL bar, driven through a fake ResizeObserver
// ───────────────────────────────────────────────────────────────────────────

type Widths = Partial<Record<"tab-strip" | "tabs" | "status-tools", number>>;

let observed: Array<{ el: Element; cb: ResizeObserverCallback }> = [];
const RealRO = globalThis.ResizeObserver;

class FakeRO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({ el, cb: this.cb });
  }
  unobserve(el: Element) {
    observed = observed.filter((o) => o.el !== el);
  }
  disconnect() {
    observed = observed.filter((o) => o.cb !== this.cb);
  }
}

/** Deliver widths to whichever observed elements carry those roles. */
function deliver(widths: Widths) {
  act(() => {
    const byCb = new Map<ResizeObserverCallback, ResizeObserverEntry[]>();
    for (const { el, cb } of observed) {
      const role = el.getAttribute("data-bar-occupant") as keyof Widths | null;
      if (!role || widths[role] === undefined) continue;
      const entry = {
        target: el,
        contentRect: { width: widths[role] } as DOMRectReadOnly,
      } as ResizeObserverEntry;
      byCb.set(cb, [...(byCb.get(cb) ?? []), entry]);
    }
    for (const [cb, entries] of byCb) cb(entries, {} as ResizeObserver);
  });
}

const DOC: FsaDocMeta = {
  id: "doc1",
  name: "Coherence Intro",
  texFilename: "main.tex",
  folderName: "Coherence Intro",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
};

const noop = () => {};

/** Three more documents for the crowded-strip legs (section 5). */
const DOCS_MORE: FsaDocMeta[] = ["Doc Two", "Doc Three"].map((name, i) => ({
  ...DOC,
  id: `doc${i + 2}`,
  name,
  folderName: name,
}));

/** The tab wrappers the strip keys `outerTabRefs` by — exposed for the legs
 *  that stub a tab's geometry. */
let lastOuterTabRefs: Map<string, HTMLElement> | null = null;

function Harness({
  userCollapsed,
  setUserCollapsed,
  docs = [DOC],
  outerOrder = [DOC.id],
  currentDocId = DOC.id,
}: {
  userCollapsed: boolean;
  setUserCollapsed: (v: boolean) => void;
  docs?: FsaDocMeta[];
  outerOrder?: string[];
  currentDocId?: string;
}) {
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const outerTabRefs = useRef(new Map<string, HTMLElement>());
  // Published from an effect, never during render (react-hooks/globals).
  useEffect(() => {
    lastOuterTabRefs = outerTabRefs.current;
  });
  const tabStrip: TabStripProps = {
    docs,
    openTabIds: docs.map((d) => d.id),
    outerOrder,
    activePane: "doc",
    currentDocId,
    currentLibraryOuterId: null,
    currentPaperCitekey: null,
    libraryRegistry: new Map(),
    devStorage: true,
    editingTabId: null,
    setEditingTabId: noop,
    nameInput: "",
    setNameInput: noop,
    nameInputRef: createRef<HTMLInputElement>(),
    tabStripRef,
    outerTabRefs,
    paperDropIndex: null,
    setPaperDropIndex: noop,
    entryDropOuterLibId: null,
    setEntryDropOuterLibId: noop,
    onActivateDoc: noop,
    onCloseDoc: noop,
    onActivatePaper: noop,
    onClosePaper: noop,
    onActivateLibraryOuter: noop,
    onCloseLibraryOuter: noop,
    onRenameDoc: noop,
    openPaperTab: noop,
    openLibraryOuterTab: noop,
    onOpenRecent: noop,
    onOpenFolder: noop,
    onCreateNew: noop,
    onOpenExample: noop,
    onResetExample: noop,
    onOpenNewWindow: noop,
    exampleAvailable: false,
  };
  const statusCluster: StatusClusterProps = statusProps(userCollapsed, setUserCollapsed);
  const props: TopBarProps = { zenModeOn: false, tabStrip, statusCluster };
  return <TopBar {...props} />;
}

function statusProps(
  userCollapsed: boolean,
  setUserCollapsed: (v: boolean) => void,
): StatusClusterProps {
  return {
    vbar: { aiDot: null, compilePdf: noop, isCompiling: false, pdfStale: false },
    collabEnabled: false,
    zenModeOn: false,
    topbarRightCollapsed: userCollapsed,
    setTopbarRightCollapsed: setUserCollapsed as StatusClusterProps["setTopbarRightCollapsed"],
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
    currentDocId: DOC.id,
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
  };
}

/** A tool that lives INSIDE the collapsible group; reachable ⟺ expanded. */
const toolsReachable = () =>
  screen.queryByRole("button", { name: "Zen" }) !== null;
/** A TIER-1 protected occupant: never hidden, whatever the rule decides. */
const chipReachable = () =>
  screen.queryByRole("button", { name: /toolbar/i }) !== null;

function mount(over: Partial<{ userCollapsed: boolean }> = {}) {
  const setUserCollapsed = vi.fn();
  const view = render(
    <Harness
      userCollapsed={over.userCollapsed ?? false}
      setUserCollapsed={setUserCollapsed}
    />,
  );
  return { setUserCollapsed, view };
}

/**
 * The same bar, but with the persisted pref REALLY round-tripping. `mount`'s
 * `setUserCollapsed` is a spy, so the pref never comes back — which makes a
 * user collapse-then-expand unrepresentable, and that is precisely the shape
 * that stranded a sticky expand override. A harness that cannot express the
 * defect is a harness that certifies it.
 */
function StatefulHarness() {
  const [userCollapsed, setUserCollapsed] = useState(false);
  return (
    <Harness userCollapsed={userCollapsed} setUserCollapsed={setUserCollapsed} />
  );
}

describe("the REAL bar under compression", () => {
  beforeEach(() => {
    observed = [];
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = RealRO;
  });

  it("observes exactly the three boxes the rule needs, through ONE observer", () => {
    // RENEGOTIATED in place (task 561): the strip's scroll ladder mounts its
    // own ResizeObserver over the SCROLLER box (`useTabStripScroller`, so a
    // strip that narrows under the active tab scrolls it back into view) —
    // a second callback in the bar, observing ONE box. The occupancy rule's
    // own observer is still exactly three boxes through one callback, and
    // the scroller it observes is the SAME element the ladder observes.
    mount();
    const byCb = new Map<ResizeObserverCallback, string[]>();
    for (const o of observed) {
      const role = o.el.getAttribute("data-bar-occupant") ?? "?";
      byCb.set(o.cb, [...(byCb.get(o.cb) ?? []), role].sort());
    }
    const roleSets = [...byCb.values()].sort((a, b) => b.length - a.length);
    expect(roleSets).toEqual([["status-tools", "tab-strip", "tabs"], ["tab-strip"]]);
  });

  it("a wide bar keeps every occupant", () => {
    mount();
    deliver({ "tab-strip": 800, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(true);
    expect(chipReachable()).toBe(true);
  });

  it("a narrow bar collapses the TOOLS — and keeps them reachable behind the chip", () => {
    mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    expect(toolsReachable(), "the tools must yield to the tabs").toBe(false);
    expect(
      chipReachable(),
      "collapse beats bare z-order only if the chip survives it",
    ).toBe(true);
  });

  it("STAYS collapsed once the freed width reaches the strip — the flip-flop leg", () => {
    // A naive "do the tabs overflow their box?" rule expands here (300 <= 450)
    // and then re-collapses on the very next frame, forever.
    mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(false);
    deliver({ "tab-strip": 450 }); // = 250 + the 200 the tools gave back
    expect(toolsReachable()).toBe(false);
  });

  it("re-expands when the window is genuinely wide enough again", () => {
    mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(false);
    deliver({ "tab-strip": 700 }); // 300 + 200 fits
    expect(toolsReachable()).toBe(true);
  });

  it("never writes the user's persisted pref", () => {
    const { setUserCollapsed } = mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    deliver({ "tab-strip": 700 });
    expect(
      setUserCollapsed,
      "the auto rule may collapse the bar; only the user may change the pref",
    ).not.toHaveBeenCalled();
  });

  it("an explicit user collapse outranks a roomy bar", () => {
    mount({ userCollapsed: true });
    deliver({ "tab-strip": 800, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(false);
  });

  it("the expand override dies with the crowding that created it", () => {
    // The override out-ranks the rule; it must not outlive it. Without the
    // drop, one expand at a narrow width disables auto-collapse for the rest
    // of the session — the user's answer to ONE crowding applied to every
    // later one.
    mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /toolbar/i }));
    });
    expect(toolsReachable()).toBe(true);
    deliver({ "tab-strip": 700 }); // roomy again: the crowding is over
    expect(toolsReachable()).toBe(true);
    deliver({ "tab-strip": 250 }); // …and narrow once more
    expect(
      toolsReachable(),
      "a stale override kept the tools open through a fresh crowding",
    ).toBe(false);
  });

  it("a chip round trip at a ROOMY width leaves no override behind", () => {
    // The override out-ranks the auto rule, so it may only be minted when the
    // auto rule is the thing being out-ranked. Minted on every expand, it has
    // no expiry (the drop fires on the auto TRUE→FALSE edge, which never comes
    // if the verdict was already false) — so one ordinary collapse-then-expand
    // at a comfortable width silently disables auto-collapse for the session,
    // and the tab row is clipped instead of the tools yielding.
    render(<StatefulHarness />);
    deliver({ "tab-strip": 800, tabs: 300, "status-tools": 200 });
    const chip = () => screen.getByRole("button", { name: /toolbar/i });
    act(() => { fireEvent.click(chip()); });   // user collapses
    expect(toolsReachable()).toBe(false);
    act(() => { fireEvent.click(chip()); });   // …and changes their mind
    expect(toolsReachable()).toBe(true);
    deliver({ "tab-strip": 250 });             // now the window narrows
    expect(
      toolsReachable(),
      "a sticky override from a wide-window toggle disabled the whole rule",
    ).toBe(false);
  });

  it("the chip is never a dead control: expanding out of an AUTO collapse works", () => {
    mount();
    deliver({ "tab-strip": 250, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(false);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /toolbar/i }));
    });
    expect(
      toolsReachable(),
      "the user asked for the tools; the rule governs the DEFAULT, not the user",
    ).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. What a COLLAPSE owes the surfaces it hides
// ───────────────────────────────────────────────────────────────────────────

describe("collapsing the tool group", () => {
  afterEach(cleanup);

  const zen = () => screen.queryByRole("button", { name: "Zen" });

  it("REMOUNTS its children, which is what unmounting used to give them", () => {
    // The reason this matters is not tidiness: `visibility: hidden` cannot
    // reach a child that body-PORTALS its dropdown, so without a remount a
    // collapse leaves that menu floating over the canvas with no trigger under
    // it. Remounting resets every child's own open state, for every portal
    // owner present and future. The element identity IS the observable.
    const { rerender } = render(
      <StatusCluster {...statusProps(false, noop)} />,
    );
    const before = zen();
    expect(before).not.toBeNull();
    rerender(<StatusCluster {...statusProps(true, noop)} />);
    rerender(<StatusCluster {...statusProps(false, noop)} />);
    expect(zen()).not.toBeNull();
    expect(
      zen(),
      "the group's children survived the collapse, so their open menus do too",
    ).not.toBe(before);
  });

  it("hands focus to the chip rather than dropping it into a hidden subtree", () => {
    const { rerender } = render(
      <StatusCluster {...statusProps(false, noop)} />,
    );
    const inside = zen()!;
    inside.focus();
    expect(document.activeElement).toBe(inside);
    rerender(<StatusCluster {...statusProps(true, noop)} />);
    expect(
      document.activeElement,
      "focus was left in an aria-hidden subtree (or dropped to <body>) — the " +
        "chip is TIER 1 and is what brings the group back",
    ).toBe(screen.getByRole("button", { name: /toolbar/i }));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. The ladder UNDER tier 2 — compress, then scroll (task 561)
// ───────────────────────────────────────────────────────────────────────────

describe("the tab strip's occupancy ladder — compress, then scroll", () => {
  beforeEach(() => {
    observed = [];
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = RealRO;
    lastOuterTabRefs = null;
  });

  const crowded = () =>
    render(
      <Harness
        userCollapsed={false}
        setUserCollapsed={noop}
        docs={[DOC, ...DOCS_MORE]}
        outerOrder={[OUTER_LIBRARY_ROOT_ID, DOC.id, ...DOCS_MORE.map((d) => d.id)]}
      />,
    );
  const scrollerEl = () =>
    document.querySelector<HTMLElement>('[data-bar-occupant="tab-strip"]')!;
  const rowEl = () => document.querySelector<HTMLElement>('[data-bar-occupant="tabs"]')!;
  /** The per-tab wrapper the strip keys `outerTabRefs` by. */
  const wrapperOf = (label: string) => screen.getByLabelText(label).parentElement!;

  it("inactive tabs COMPRESS (`shrink`), the active tab RESISTS (`shrink-0`), the pinned Library root never compresses", () => {
    crowded();
    // Inactive: flex-shrink 1 with the automatic (min-content) minimum, which
    // is the tab's fixed chrome plus its label's floor.
    for (const name of ["Doc Two: main.tex", "Doc Three: main.tex"]) {
      const w = wrapperOf(name);
      expect(w.className, `${name} must be compressible`).toMatch(/\bshrink\b/);
      expect(w.className).not.toMatch(/shrink-0/);
    }
    // Active: the folder tab holds its name; only the strip scrolls.
    expect(wrapperOf("Coherence Intro: main.tex").className).toMatch(/shrink-0/);
    // The Library root is the strip's pinned tab (Chrome's pinned tabs).
    expect(wrapperOf("Library").className).toMatch(/shrink-0/);
  });

  it("an inactive LABEL ellipsizes to the shared floor and no further, under the shared cap", () => {
    crowded();
    const label = screen.getByLabelText("Doc Two: main.tex").querySelector<HTMLElement>(`[${TAB_LABEL_ATTR}]`)!;
    expect(label.className).toMatch(/\btruncate\b/);
    expect(label.style.minWidth).toBe(TAB_LABEL_FLOOR_MIN_WIDTH);
    expect(label.style.maxWidth).toBe(`${TAB_LABEL_MAX_PX}px`);
    // Every label in the row is visible to the occupancy reader.
    const labels = rowEl().querySelectorAll(`[${TAB_LABEL_ATTR}]`);
    expect(labels.length).toBe(4); // Library root + 3 docs
  });

  it("past the floors the strip SCROLLS: a scroller with a hidden scrollbar, and the seam kept INSIDE its clip", () => {
    crowded();
    const s = scrollerEl();
    expect(s.style.overflowX).toBe("auto");
    expect(s.style.overflowY, "an unstated axis would be coerced to auto and grow a 1px scroll range").toBe("hidden");
    expect(s.style.scrollbarWidth).toBe("none");
    // The active tab hangs FOLDER_TAB_SEAM_OVERLAP below the strip to merge
    // into the canvas; the padding keeps that inside the scroller's padding
    // box (never clipped), the margin keeps the footprint unchanged.
    expect(s.style.paddingBottom).toBe(`${FOLDER_TAB_SEAM_OVERLAP}px`);
    expect(s.style.marginBottom).toBe(`-${FOLDER_TAB_SEAM_OVERLAP}px`);
    // The row: natural width when roomy, the scroller's width when crowded.
    const row = rowEl();
    expect(row.style.width).toBe("max-content");
    expect(row.style.maxWidth).toBe("100%");
    expect(row.className).toMatch(/\bmin-w-0\b/);
    expect(s.contains(row)).toBe(true);
  });

  it("the '+' is an ACTION and stays PINNED outside the scroller", () => {
    crowded();
    const plus = screen.getByRole("button", { name: "Open paper or create new" });
    expect(scrollerEl().contains(plus)).toBe(false);
    expect(screen.getByLabelText("Library").closest('[data-bar-occupant="tab-strip"]')).not.toBeNull();
  });

  it("activating an off-screen tab scrolls it into view by the MINIMUM delta — through the real strip", () => {
    const view = crowded();
    const s = scrollerEl();
    Object.defineProperty(s, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(s, "scrollWidth", { value: 900, configurable: true });
    s.getBoundingClientRect = () =>
      ({ left: 0, right: 300, width: 300, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const three = lastOuterTabRefs!.get("doc3")!;
    three.getBoundingClientRect = () =>
      ({ left: 600, right: 700, width: 100, top: 0, bottom: 0, height: 0, x: 600, y: 0, toJSON() {} }) as DOMRect;
    expect(s.scrollLeft).toBe(0);
    view.rerender(
      <Harness
        userCollapsed={false}
        setUserCollapsed={noop}
        docs={[DOC, ...DOCS_MORE]}
        outerOrder={[OUTER_LIBRARY_ROOT_ID, DOC.id, ...DOCS_MORE.map((d) => d.id)]}
        currentDocId="doc3"
      />,
    );
    // The activated tab is re-keyed to the active (folder) wrapper — the
    // nudge read the wrapper the strip keys by id, wherever the id renders.
    expect(s.scrollLeft).toBe(400);
  });

  it("the rule still reads the NATURAL width after compression — the anti-oscillation leg", () => {
    // The row's box is capped at the scroller's width once it compresses, so
    // a rule fed the box could never say "collapse". The labels' own
    // `scrollWidth` remembers the width they were denied.
    crowded();
    const labels = rowEl().querySelectorAll<HTMLElement>(`[${TAB_LABEL_ATTR}]`);
    const squeeze = (px: number) => {
      for (const l of labels) {
        Object.defineProperty(l, "scrollWidth", { value: 90 + px, configurable: true });
        Object.defineProperty(l, "clientWidth", { value: 90, configurable: true });
      }
    };
    // Control: nothing ellipsized, the row fits its box exactly → expanded.
    squeeze(0);
    deliver({ "tab-strip": 300, tabs: 300, "status-tools": 200 });
    expect(toolsReachable()).toBe(true);
    // Now each of the four labels has lost 15px to compression: the box
    // still reads 300, the NATURAL width is 360, and the tools must yield.
    squeeze(15);
    deliver({ tabs: 300 - 1, "tab-strip": 300 - 1 }); // a hair narrower, so the entries re-fire
    expect(toolsReachable(), "a rule reading the compressed box never collapses the tools").toBe(false);
    // Collapsing freed 200px: the row decompresses to its natural 360 and the
    // box now reports it. The collapsed-state predicate asks 360 + 200 ≤ 499,
    // which is false — so the tools STAY collapsed rather than flip-flopping.
    squeeze(0);
    deliver({ "tab-strip": 499, tabs: 360 });
    expect(toolsReachable()).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The census — the halves no render can see
// ───────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("census · the structural floor and the shared cap", () => {
  const STRIP = "src/components/editor-layout/TabStrip.tsx";

  it("the tab strip's floor is a SCROLLER, and it spells no scroll axis of its own", () => {
    // RENEGOTIATED in place (task 561). This leg used to pin `overflow-x:
    // clip` + `overflow-y: visible` as the structural floor — the pair that
    // clips horizontally while leaving the seam overhang unclipped. That was
    // the floor 395 chose in place of a product decision, and it pinned the
    // decision's absence as the contract: a tab row wider than the strip
    // simply LOST its rightmost tabs. Gabriel's decision is to scroll. The
    // floor is still structural (a scroll container clips), but the axis is
    // the SHARED scroller style — `overflow-x: auto`, `overflow-y: hidden`
    // stated explicitly — and the seam overhang is kept inside the clip by
    // the shared padding/margin pair rather than by leaving the axis visible.
    // Both strips read those from tab-strip-occupancy.ts; neither may spell
    // an overflow axis of its own, or the two can disagree about the seam.
    // `commentsStripped`, NOT `codeOnly`: the needles are string literals.
    for (const rel of [STRIP, "library/components/panel-tabs/PanelTabStrip.tsx"]) {
      const code = commentsStripped(read(rel));
      expect(code, `${rel} must spread the shared scroller style`).toMatch(
        /\.\.\.TAB_STRIP_SCROLLER_STYLE/,
      );
      // Axis-SPECIFIC needle: `overflow: "hidden"` on a label (the ellipsis
      // idiom) or a menu row is not a scroll axis.
      expect(code, `${rel} spells its own scroll axis`).not.toMatch(
        /overflow[XY]:\s*"(?:clip|hidden|auto|scroll|visible)"/,
      );
    }
    const strip = commentsStripped(read(STRIP));
    expect(strip).toMatch(/tabStripSeamPadding\(FOLDER_TAB_SEAM_OVERLAP\)/);
    // The retired floor stays retired.
    expect(strip).not.toMatch(/overflowX:\s*"clip"/);
  });

  it("both strips mount the ONE scroll hook and neither re-derives the into-view nudge", () => {
    // The ladder was never the part that could misbehave — a strip writing
    // its own `scrollLeft` is (the inner strip's inline nudge was exactly
    // that, and it is what the outer strip would have copied). Any
    // `scrollLeft` WRITE outside the module, in either silo, is a re-fork.
    const MODULE = "src/components/chrome/tab-strip-occupancy.ts";
    for (const rel of [STRIP, "library/components/panel-tabs/PanelTabStrip.tsx"]) {
      expect(codeOnly(read(rel)), `${rel} does not mount useTabStripScroller`).toMatch(
        /\buseTabStripScroller\(/,
      );
    }
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          if (entry === "__tests__" || entry === "node_modules") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry)) {
          const rel = path.relative(ROOT, full).split(path.sep).join("/");
          if (rel === MODULE) continue;
          if (/\.scrollLeft\s*(?:\+=|-=|=)[^=]/.test(codeOnly(read(rel)))) offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    walk(path.join(ROOT, "library"));
    expect(offenders).toEqual([]);
    // …and the module really is the one writer (a can-see canary).
    expect(codeOnly(read(MODULE))).toMatch(/\.scrollLeft\s*=/);
  });

  it("no tab strip declares its own min-content floor — the floors are the shared module's", () => {
    // `ACTIVE_MIN_CONTENT` sat in the shared geometry module and was read by
    // ONE strip while the other hand-wrote `minWidth: 80`; the inactive floor
    // was private to the inner strip. A positive `minWidth` literal in any of
    // the five tab files is that fork coming back. (`minWidth: 0` — "let flex
    // shrink me" — is not a floor and stays legal.)
    for (const rel of [
      STRIP,
      "src/components/editor-layout/InlineTabLabel.tsx",
      "src/components/editor-layout/DocumentFolderTab.tsx",
      "library/components/panel-tabs/PanelTabStrip.tsx",
      "library/components/panel-tabs/PanelFolderTab.tsx",
    ]) {
      const code = commentsStripped(read(rel));
      // Asked PER TAG: the inner strip's body-portaled menus carry a
      // `minWidth` of their own, and a menu's floor is not a tab's.
      for (const tag of tagsContaining(code, /minWidth:\s*[1-9]\d*\s*[,}]/)) {
        expect(tag, `${rel} hand-writes a floor: ${tag.slice(0, 80)}`).toMatch(/role="menu"/);
      }
      expect(code, `${rel} hand-spells the label floor`).not.toMatch(/calc-size\(max-content,\s*min\(size/);
    }
    // The active floors read the variant spec; the inactive floor reads the
    // shared style.
    expect(codeOnly(read("src/components/editor-layout/DocumentFolderTab.tsx"))).toMatch(/minWidth:\s*V\.activeMinContent/);
    expect(codeOnly(read("library/components/panel-tabs/PanelFolderTab.tsx"))).toMatch(/V\.activeMinContent/);
    for (const rel of ["src/components/editor-layout/InlineTabLabel.tsx", "library/components/panel-tabs/PanelTabStrip.tsx"]) {
      expect(codeOnly(read(rel)), `${rel} does not take the shared label floor`).toMatch(/\.\.\.INACTIVE_TAB_LABEL_STYLE/);
    }
  });

  it("every tab label span carries the label attribute the occupancy reader finds them by", () => {
    // `tabRowNaturalWidth` recovers the row's natural width from its labels;
    // a label without the attribute is compression the rule cannot see. Asked
    // PER TAG (the three active spans + the inline one in the bar; the active
    // span + the inactive button in the inner strip), never as a count.
    const spans = [
      ...tagsContaining(commentsStripped(read(STRIP)), /\btruncate\b/),
      ...tagsContaining(commentsStripped(read("src/components/editor-layout/InlineTabLabel.tsx")), /\btruncate\b/),
    ];
    expect(spans.length, "the label needle is stale").toBe(4);
    const inner = tagsContaining(
      commentsStripped(read("library/components/panel-tabs/PanelTabStrip.tsx")),
      /lineHeight: "16px"/,
    ).filter((t) => !/^<input/.test(t));
    expect(inner.length, "the inner-strip label needle is stale").toBe(2);
    for (const tag of [...spans, ...inner]) {
      expect(tag, `a tab label with no attribute: ${tag.slice(0, 100)}`).toMatch(/TAB_LABEL_ATTRS/);
    }
  });

  it("no file promises a clamp that nothing implements", () => {
    // The prose half of the fix. The retired sentinel's own words are the
    // needle: a comment describing a dead mechanism is how the next reader
    // concludes the bar is safe.
    for (const rel of [
      "src/components/editor-layout/TopBar.tsx",
      STRIP,
      "src/components/EditorLayout.tsx",
    ]) {
      const src = read(rel);
      expect(
        /topbar-left sentinel/.test(src) &&
          !/was a COMMENT with no element|There was never an element/.test(src),
        `${rel} still describes the retired topbar-left sentinel as a live mechanism`,
      ).toBe(false);
    }
  });

  it("both tab renderers read ONE label cap", () => {
    // The active folder tab's `calc-size(max-content, …)` width let a long
    // composed name grow without bound while its inline twin had capped at the
    // same 220px since it shipped — the cap was declared in one of the two
    // renderers of one tab and not the other. The needle is the READ at the
    // style site, not the import: an unused import satisfies a bare name grep
    // while the value beside it is hand-spelled.
    for (const rel of [
      STRIP,
      "src/components/editor-layout/InlineTabLabel.tsx",
    ]) {
      const code = codeOnly(read(rel));
      expect(code, `${rel} does not read the cap at its style site`).toMatch(
        /maxWidth:\s*TAB_LABEL_MAX_PX/,
      );
    }
    // …and EVERY active-tab label span reads it, asked PER SPAN rather than
    // counted: `TabStrip` renders three (document, paper, library) and the
    // first cut capped one. A total is the wrong instrument — the rename
    // input carries the cap too, so three caps and three spans can be a set
    // that does not overlap. `tagsContaining` scans to each tag's REAL end
    // (arrow-function props and all), and `commentsStripped` rather than
    // `codeOnly` because the needle is a className STRING, which codeOnly
    // blanks — the trap `_source-scan`'s own header documents.
    const spans = tagsContaining(
      commentsStripped(read(STRIP)),
      /text-\[13px\] leading-4 truncate min-w-0/,
    );
    expect(spans.length, "no active-tab label spans found — the needle is stale").toBe(3);
    for (const tag of spans) {
      expect(
        tag,
        `an active-tab label span with no cap grows its tab with the name: ${tag.slice(0, 120)}`,
      ).toMatch(/TAB_LABEL_MAX_PX/);
    }
    // …and neither may spell the number, in either syntax.
    for (const rel of [
      STRIP,
      "src/components/editor-layout/InlineTabLabel.tsx",
    ]) {
      const code = commentsStripped(read(rel));
      expect(
        code,
        `${rel} hand-spells the cap instead of reading the SSOT`,
      ).not.toMatch(
        new RegExp(`max(?:Width|-w)[^\\n]*\\b${TAB_LABEL_MAX_PX}\\b`),
      );
    }
  });

  it("the ACTIVE tab's label carries the cap — the half that had none", () => {
    // jsdom has no layout, so the contract that CAN be measured is that the
    // active folder tab's label declares the same bound its inline twin does.
    // Before this the span had `truncate` with nothing to truncate against,
    // so `calc-size(max-content, …)` grew the whole tab with the name.
    mount();
    const label = screen
      .getByText("Coherence Intro: main.tex", { selector: "span" });
    expect(label.style.maxWidth).toBe(`${TAB_LABEL_MAX_PX}px`);
  });

  it("the measurement refs sync in a LAYOUT effect, not a passive one", () => {
    // Pinned structurally because the failure is a real-browser ordering race
    // jsdom cannot stage: a ResizeObserver is delivered at the end of the
    // layout step for the commit that just landed, BEFORE React flushes
    // passive effects — so a passive sync hands the callback the pre-collapse
    // `effective` with the post-collapse widths, which is exactly the
    // mismatched pair the state-independent predicate assumes cannot happen.
    const code = codeOnly(read("src/components/editor-layout/useBarOccupancy.ts"));
    expect(code).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]{0,200}effectiveRef\.current = effective/,
    );
  });

  it("a TIER-1 surface reads the user's PREFERENCE, never the auto verdict", () => {
    // Two things at once, and the second is the load-bearing one. (a) The save
    // pill is TIER 1 by this bar's own ladder, so a narrow window must not
    // carry it away. (b) The occupancy predicate is state-independent ONLY
    // because the protected width R does not depend on the verdict — feed the
    // verdict into a tier-1 element's width and R becomes a function of the
    // rule's own output, which re-opens the flip-flop the predicate closes.
    const cluster = commentsStripped(
      read("src/components/editor-layout/StatusCluster.tsx"),
    );
    expect(cluster).toMatch(
      /collapsed=\{\(collapsePreference \?\? topbarRightCollapsed\) \|\| zenModeOn\}/,
    );
    const topbar = commentsStripped(
      read("src/components/editor-layout/TopBar.tsx"),
    );
    expect(
      topbar,
      "TopBar must hand down the RAW pref beside the effective verdict",
    ).toMatch(/collapsePreference=\{statusCluster\.topbarRightCollapsed\}/);
  });

  it("the group clips only while collapsed", () => {
    // An unconditional `overflow: hidden` trims every button's focus ring
    // against the group's own edge in the EXPANDED state too — a keyboard
    // affordance lost to a rule that exists for the zero-width state.
    const cluster = commentsStripped(
      read("src/components/editor-layout/StatusCluster.tsx"),
    );
    expect(cluster).toMatch(
      /overflow: topbarRightCollapsed \? "hidden" : undefined/,
    );
    expect(
      cluster,
      "the tool group carries an unconditional overflow clip",
    ).not.toMatch(/data-bar-tier="collapsible"[\s\S]{0,200}overflow-hidden/);
  });

  it("the bar's occupancy verdict has ONE producer", () => {
    // The rule was never the part that could misbehave — a second surface
    // resolving its own collapse is, and that type-checks perfectly.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          if (entry === "__tests__") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry)) {
          const rel = path.relative(ROOT, full).split(path.sep).join("/");
          // The hook is the one legitimate caller; the module below it is
          // where the function is DECLARED.
          if (
            rel.endsWith("editor-layout/useBarOccupancy.ts") ||
            rel.endsWith("editor-layout/bar-occupancy.ts")
          ) {
            continue;
          }
          if (/\bresolveBarOccupancy\s*\(/.test(codeOnly(read(rel)))) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
