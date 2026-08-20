// @vitest-environment jsdom
/**
 * THE BAR TIMER'S RESIDENCY AND ITS PERF CLAIM (task 354).
 *
 * The feature's load-bearing claim is not that the timer works — it is that a
 * timer running for twenty-five minutes costs the Virgil bar NOTHING. `TopBar`
 * / `TabStrip` / `StatusCluster` are each `memo`ized deliberately so that
 * background ticks do not repaint the bar, and the obvious implementation
 * (state in the bar's owner, threaded down as `StatusClusterProps` members)
 * would have undone exactly that: a new prop every second, and the whole bar
 * tree re-rendered 1500 times per interval.
 *
 * So the design is PROP-LESS residents reading a module store, and this suite
 * measures that rather than restating it.
 *
 * ## How the cluster's own re-renders are counted
 *
 * A `<Profiler>` around the cluster would NOT answer the question: React fires
 * `onRender` for any commit anywhere in the profiled tree, so a leaf-only tick
 * — the healthy case — is indistinguishable from a whole-cluster repaint. What
 * distinguishes them is whether `StatusClusterImpl`'s own body re-executed, so
 * the probe is one of its UNCONDITIONAL children (`SkillSyncControls`) mocked
 * as a plain, un-memoized counter: React re-renders a plain function child
 * exactly when its parent re-renders. The cluster itself is the REAL one —
 * which is the point, since the part that could misbehave is the call site,
 * not the widget.
 *
 * ## And a census beside it
 *
 * The behavioural leg passes for as long as the residents take no props. A
 * census is what keeps it that way: a `timerRunning` prop added to
 * `StatusClusterProps` next year type-checks perfectly, repaints the bar every
 * second, and is invisible to every behavioural test above — so the source is
 * asked directly whether either resident is rendered with a prop, and whether
 * the three bar components are still memoized.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRef } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { codeOnly, strip } from "@/lib/__tests__/_source-scan";

// The cluster mounts the preservation badge, which reaches the storage
// barrel; the barrel `require`s its backend at module scope and cannot
// resolve under vitest (the standing gotcha).
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

/** The cluster-body probe: an unconditional child, deliberately NOT memoized,
 *  so its render count IS the number of times the cluster's JSX re-ran. */
const clusterRenders = { count: 0 };
vi.mock("@/components/SkillSyncControls", () => ({
  default: function SkillSyncControlsProbe() {
    clusterRenders.count += 1;
    return null;
  },
}));

import { playPomodoroChime } from "@/lib/pomodoro-chime";
import { StatusCluster, type StatusClusterProps } from "@/components/editor-layout/StatusCluster";
import {
  __resetPomodoroForTest,
  getPomodoroState,
  openPomodoro,
  setPomodoroDuration,
} from "@/lib/pomodoro-timer";

function props(over: Partial<StatusClusterProps> = {}): StatusClusterProps {
  const noop = () => {};
  return {
    vbar: { aiDot: null, compilePdf: noop, isCompiling: false, pdfStale: false },
    collabEnabled: false,
    zenModeOn: false,
    topbarRightCollapsed: false,
    setTopbarRightCollapsed: noop,
    hasDoc: true,
    skillSyncError: null,
    skillSyncNotice: null,
    onResyncSkills: noop,
    onDismissSkillSyncError: noop,
    onDismissSkillSyncNotice: noop,
    externalChangeActive: false,
    setExternalChangeActive: noop,
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

const clock = () => screen.getByTestId("bar").querySelector("[data-pomodoro-clock]")?.textContent;

function mountCluster(over: Partial<StatusClusterProps> = {}) {
  render(
    <div data-testid="bar">
      <StatusCluster {...props(over)} />
    </div>,
  );
  clusterRenders.count = 0; // the mount itself is not the thing being counted
}

beforeEach(() => {
  __resetPomodoroForTest();
  clusterRenders.count = 0;
  vi.mocked(playPomodoroChime).mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  __resetPomodoroForTest();
});

describe("a running timer does not repaint the Virgil bar", () => {
  it("ticks the WIDGET every second and re-renders the cluster ZERO times", () => {
    mountCluster();

    // Opening is itself a store transition — and the cluster must not notice
    // that either, since it holds no state for the widget.
    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });
    act(() => { fireEvent.click(screen.getByLabelText("Start timer")); });
    expect(clock()).toBe("0:00 / 25:00");
    expect(clusterRenders.count).toBe(0);

    act(() => { vi.advanceTimersByTime(3000); });

    // The tick really happened (so the zero below is not the zero of a dead
    // widget) …
    expect(clock()).toBe("0:03 / 25:00");
    // … and it happened in the leaf alone.
    expect(clusterRenders.count).toBe(0);

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(clock()).toBe("1:03 / 25:00");
    expect(clusterRenders.count).toBe(0);
  });

  it("schedules nothing per second while the widget is CLOSED — and still completes", () => {
    mountCluster();
    act(() => { setPomodoroDuration(3000); });
    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });
    act(() => { fireEvent.click(screen.getByLabelText("Start timer")); });
    // Close the widget with the bar ICON: that hides it and keeps counting
    // (the × is the gesture that stops it).
    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });
    expect(screen.getByTestId("bar").querySelector("[data-pomodoro-clock]")).toBeNull();

    act(() => { vi.advanceTimersByTime(4000); });

    // The store's watchdog landed the completion with no widget mounted …
    expect(getPomodoroState().status).toBe("done");
    expect(playPomodoroChime).toHaveBeenCalledTimes(1);
    // … and the cluster still never re-rendered.
    expect(clusterRenders.count).toBe(0);
  });
});

describe("the clock is truthful on the frame the widget appears", () => {
  it("re-opening over a timer that ran UNSEEN for ten minutes paints the truth immediately", () => {
    // The mount-boundary property. A single component that returned null while
    // closed and snapped `now` from an effect would show the stale readout for
    // one frame — and, before the widget was ever opened, `now` is seeded at
    // the BAR's mount, which can be hours off. Fake timers make "one frame
    // later" unobservable in a test, so the leg is written against what IS
    // observable: the first render after the open.
    mountCluster();
    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });
    act(() => { fireEvent.click(screen.getByLabelText("Start timer")); });
    // Close the widget with the bar ICON — the timer keeps counting.
    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });

    act(() => { vi.advanceTimersByTime(10 * 60_000); });

    act(() => { fireEvent.click(screen.getByLabelText("Timer")); });
    expect(clock()).toBe("10:00 / 25:00");
    // Re-opening is a store transition and still not the cluster's business.
    expect(clusterRenders.count).toBe(0);
  });
});

describe("residency on the bar", () => {
  it("the WIDGET survives a collapsed toolbar; the ICON does not", () => {
    // The widget is rendered BEFORE the collapse gate and the icon inside it:
    // a running timer must stay legible when the user collapses the toolbar,
    // which is the whole point of the request.
    act(() => { openPomodoro(); });
    mountCluster({ topbarRightCollapsed: true });
    expect(clock()).toBe("0:00 / 25:00");
    expect(screen.queryByLabelText("Timer")).toBeNull();
  });

  it("the WIDGET survives zen mode; the icon is an ordinary tool and does not", () => {
    // Stated rather than assumed: zen hides the whole tool group, and the timer
    // icon takes that rule with every other tool rather than minting an
    // exception. What zen must NOT do is hide a timer the user already has
    // running — a timed sitting is exactly when zen is on.
    act(() => { openPomodoro(); });
    mountCluster({ zenModeOn: true });
    expect(clock()).toBe("0:00 / 25:00");
    expect(screen.queryByLabelText("Timer")).toBeNull();
  });
});

describe("census — the perf claim is STRUCTURAL, not careful", () => {
  const read = (p: string) =>
    codeOnly(fs.readFileSync(path.join(process.cwd(), p), "utf8"));
  const CLUSTER = "src/components/editor-layout/StatusCluster.tsx";
  const BAR = "src/components/editor-layout/TopBar.tsx";
  const TABS = "src/components/editor-layout/TabStrip.tsx";

  it("both residents are rendered with NO props at all", () => {
    const src = read(CLUSTER);
    const hits = [...src.matchAll(/<(PomodoroTimer|PomodoroToggleButton)([^>]*)\/>/g)];
    expect(hits.map((h) => h[1]).sort()).toEqual(["PomodoroTimer", "PomodoroToggleButton"]);
    for (const h of hits) expect(h[2].trim()).toBe("");
  });

  it("no bar component's props carry the timer", () => {
    for (const f of [CLUSTER, BAR, TABS]) {
      const propsBlock = read(f).match(/(?:type|interface)\s+\w*Props[^{]*\{[\s\S]*?\n\};?/)?.[0] ?? "";
      expect(propsBlock.toLowerCase()).not.toContain("pomodoro");
      expect(propsBlock.toLowerCase()).not.toContain("timer");
    }
  });

  it("the three bar components are still memoized", () => {
    expect(read(CLUSTER)).toContain("memo(StatusClusterImpl)");
    expect(read(BAR)).toContain("memo(TopBarImpl)");
    expect(read(TABS)).toContain("memo(TabStripImpl)");
  });

  /**
   * The pill SHAPE, censused rather than left as prose.
   *
   * The timer is the bar's first non-button resident (STYLE_GUIDE "Compact bar
   * widgets"), and four pills now share one vocabulary — the whole bar row
   * shares ONE seam anchor (task 289), so a resident that mints its own type
   * size or vertical padding reintroduces the two-baseline drift that task
   * removed. A shared component would NOT catch this: every one of these pills
   * legitimately differs in background, border source and padding, so a
   * primitive over them buys a `className` passthrough — and a passthrough is
   * exactly how a caller re-mints the geometry. What holds them together is the
   * vocabulary, so the vocabulary is what gets a leg.
   *
   * Membership is DISCOVERED from `StatusCluster`'s own resident imports, never
   * hand-listed: a sixth resident is covered by being rendered, not by someone
   * remembering to add it here.
   */
  it("every bar-resident pill fits the 24px seam row and the bar's type scale", () => {
    // Comments stripped, STRINGS KEPT and lines preserved: this leg's needles
    // ARE literals (an import path, a `className`), so `codeOnly` — which
    // blanks them — would make it unfalsifiable, and an unaligned strip would
    // report drifting `file:line` (the dishonesty task 326 repaired in
    // `phantom-css-var`).
    const withStrings = (rel: string) =>
      strip(fs.readFileSync(path.join(process.cwd(), rel), "utf8"), true, true);

    const residents = [...withStrings(CLUSTER).matchAll(/from\s+"\.\.\/(\w+)"/g)].map((m) => m[1]);
    // Self-check: a discovery that silently stopped matching would make the
    // sweep below pass vacuously.
    expect(residents).toContain("PomodoroTimer");
    expect(residents.length).toBeGreaterThan(3);

    const SHAPE = ["inline-flex", "items-center", "py-0.5", "rounded-full", "text-[11px]"];
    let pills = 0;
    for (const name of residents) {
      const src = withStrings(`src/components/${name}.tsx`);
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = (m[1] ?? m[2] ?? "").split(/\s+/);
        // A pill is the bar's own resident chrome: a rounded-full box that is
        // also a flex ROW. The timer's progress track is rounded-full and is
        // not one, which is why the conjunction is the classifier.
        if (!cls.includes("rounded-full") || !cls.includes("inline-flex")) continue;
        pills += 1;
        const at = `${name}:${src.slice(0, m.index).split("\n").length}`;
        for (const need of SHAPE) {
          expect(cls, `${at} — a bar pill must spell ${need}`).toContain(need);
        }
      }
    }
    expect(pills).toBeGreaterThan(3);
  });

  it("the timer store subscribes to no editor and touches no localStorage", () => {
    const store = read("src/lib/pomodoro-timer.ts");
    expect(store).not.toContain("localStorage");
    expect(store).not.toContain("editor.on(");
    // One wall-clock interval (the completion watchdog) and no other.
    expect([...store.matchAll(/setInterval\(/g)]).toHaveLength(1);
  });
});
