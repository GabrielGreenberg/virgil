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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRef, useRef } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";
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
import type { StatusClusterProps } from "@/components/editor-layout/StatusCluster";
import type { FsaDocMeta } from "@/lib/doc-index";
import { TAB_LABEL_MAX_PX } from "@/components/chrome/folder-tab-geometry";

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

function Harness({
  userCollapsed,
  setUserCollapsed,
}: {
  userCollapsed: boolean;
  setUserCollapsed: (v: boolean) => void;
}) {
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const outerTabRefs = useRef(new Map<string, HTMLElement>());
  const tabStrip: TabStripProps = {
    docs: [DOC],
    openTabIds: [DOC.id],
    outerOrder: [DOC.id],
    activePane: "doc",
    currentDocId: DOC.id,
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
  const statusCluster: StatusClusterProps = {
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
  const props: TopBarProps = { zenModeOn: false, tabStrip, statusCluster };
  return <TopBar {...props} />;
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
    mount();
    const roles = observed
      .map((o) => o.el.getAttribute("data-bar-occupant"))
      .sort();
    expect(roles).toEqual(["status-tools", "tab-strip", "tabs"]);
    expect(new Set(observed.map((o) => o.cb)).size).toBe(1);
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
// 3. The census — the halves no render can see
// ───────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("census · the structural floor and the shared cap", () => {
  const STRIP = "src/components/editor-layout/TabStrip.tsx";

  it("the tab strip clips its OWN horizontal overflow, and only the horizontal", () => {
    // The floor that makes an overlap unrepresentable rather than merely
    // avoided. `clip` (not `hidden`) with `overflow-y` stated EXPLICITLY: per
    // CSS Overflow 3, `hidden` on one axis coerces a `visible` other axis to
    // `auto`, which would eat the active tab's 1px seam overhang below the
    // strip. The pair is the mechanism; the rule above is the policy.
    // `commentsStripped`, NOT `codeOnly`: the needle IS a string literal, and
    // codeOnly blanks those — the trap `_source-scan`'s own header documents.
    const code = commentsStripped(read(STRIP));
    expect(code).toMatch(/overflowX:\s*"clip"/);
    expect(code).toMatch(/overflowY:\s*"visible"/);
    expect(code, "`hidden` would coerce overflow-y to auto").not.toMatch(
      /overflowX:\s*"hidden"/,
    );
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
