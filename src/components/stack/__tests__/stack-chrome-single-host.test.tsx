// @vitest-environment jsdom
/**
 * Task 589 — THE STACK'S CHROME IS APP-GLOBAL, SO IT IS MOUNTED ONCE.
 *
 * The icon + strip used to be rendered by every `EditorPane` and portaled to
 * `document.body`. A portal escapes its React parent's DOM, so the keep-alive
 * wrapper's `display:none` hid none of them: N warm panes painted N identical
 * buttons at the same fixed spot, the icon toggled the LAST-mounted pane's
 * strip rather than the visible one's, and — the member that made a visible
 * feature silently do nothing — an evicted pane's cleanup set the ONE
 * module-level `iconRect` to `null`, so `isOverStackIcon` answered `false` from
 * then on and neither a float drag nor a content lift could capture until a
 * window resize happened to re-publish.
 *
 * Three legs, one per member.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { StackChromeHost } from "@/components/stack/StackChromeHost";
import {
  isOverStackIcon,
  setStackIconRect,
  __resetStackIconRect,
} from "@/lib/stack/stack-drop-target";
import {
  registerStackTerminal,
  getStackTerminal,
  someTerminalWantsChrome,
  openStackStrip,
  isStackStripOpen,
  __resetStackTerminals,
  __resetStackStripOpen,
  type StackTerminal,
} from "@/lib/stack/stack-terminal";

const ICON = { left: 12, top: 700, right: 68, bottom: 756 };
const ICON_CENTER = { x: 40, y: 728 };

function terminal(over: Partial<StackTerminal> = {}): StackTerminal {
  return {
    getEditor: () => null,
    getSource: () => ({ docId: "d1" }),
    getBibCtx: () => ({
      getBibEntry: () => undefined,
      getAnnotation: () => undefined,
    }),
    wantsChrome: true,
    ...over,
  };
}

beforeEach(() => {
  __resetStackTerminals();
  __resetStackStripOpen();
  __resetStackIconRect();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  __resetStackTerminals();
  __resetStackStripOpen();
  __resetStackIconRect();
});

describe("MEMBER 1 — a departing owner cannot erase the live icon rect", () => {
  it("a stale owner's null is a no-op, so capture survives an eviction", () => {
    const evicted = {};
    const live = {};
    setStackIconRect(evicted, ICON);
    setStackIconRect(live, ICON);

    // The evicted pane's cleanup runs AFTER the survivor published. Before this
    // fix that call nulled the one slot and every hit-test answered false.
    setStackIconRect(evicted, null);

    expect(isOverStackIcon(ICON_CENTER.x, ICON_CENTER.y)).toBe(true);
  });

  it("the CURRENT owner's null still clears — the slot is keyed, not frozen", () => {
    const live = {};
    setStackIconRect(live, ICON);
    setStackIconRect(live, null);
    expect(isOverStackIcon(ICON_CENTER.x, ICON_CENTER.y)).toBe(false);
  });

  it("a SUPERSEDED registration's disposer removes nothing", () => {
    // The re-registration path: a pane re-publishes under the same token when
    // its chrome gate flips (zen on/off). React runs the OLD effect's cleanup
    // after the new one in a few orderings; an unchecked `delete` there would
    // drop the live entry and the chrome would vanish with panes still mounted.
    const token = {};
    const stale = terminal({ wantsChrome: false });
    const fresh = terminal({ wantsChrome: true });
    const disposeStale = registerStackTerminal(token, stale);
    registerStackTerminal(token, fresh);

    disposeStale();

    expect(getStackTerminal()).toBe(fresh);
    expect(someTerminalWantsChrome()).toBe(true);
  });

  it("an evicted pane leaves the survivor's entry alone", () => {
    const visible = terminal({ wantsChrome: true });
    const warm = terminal({ wantsChrome: true });
    registerStackTerminal({}, visible);
    const disposeWarm = registerStackTerminal({}, warm);

    disposeWarm();
    expect(someTerminalWantsChrome()).toBe(true);
    expect(getStackTerminal()).toBe(visible);
  });
});

describe("MEMBER 2 — one icon, one strip, however many panes are warm", () => {
  it("three registered panes still yield exactly one icon and one strip", () => {
    registerStackTerminal({}, terminal());
    registerStackTerminal({}, terminal());
    registerStackTerminal({}, terminal());

    render(<StackChromeHost />);
    act(() => {
      openStackStrip();
    });

    expect(
      document.querySelectorAll('[data-stack-icon-hit="true"]'),
    ).toHaveLength(1);
    expect(document.querySelectorAll('[data-stack-strip="true"]')).toHaveLength(
      1,
    );
  });

  it("the strip's open state is GLOBAL, so a capture in any pane opens the one the user sees", () => {
    registerStackTerminal({}, terminal());
    render(<StackChromeHost />);
    expect(document.querySelector('[data-stack-strip="true"]')).toBe(null);

    // What `captureKeyToStack` calls, from whichever pane the gesture landed in.
    act(() => {
      openStackStrip();
    });
    expect(isStackStripOpen()).toBe(true);
    expect(document.querySelector('[data-stack-strip="true"]')).not.toBe(null);
  });

  it("no pane wanting chrome renders nothing at all (zen mode / no doc open)", () => {
    registerStackTerminal({}, terminal({ wantsChrome: false }));
    render(<StackChromeHost />);
    expect(document.querySelector('[data-stack-icon-hit="true"]')).toBe(null);
  });

  it("ANY non-zen pane is enough — the gate is an ANY over the registry", () => {
    registerStackTerminal({}, terminal({ wantsChrome: false }));
    registerStackTerminal({}, terminal({ wantsChrome: true }));
    render(<StackChromeHost />);
    expect(document.querySelector('[data-stack-icon-hit="true"]')).not.toBe(
      null,
    );
  });
});

describe("MEMBER 3 — the structural floor", () => {
  it("EditorPane renders no Stack chrome of its own", () => {
    const src = codeOnly(
      readFileSync(
        resolve(__dirname, "../../../components/EditorPane.tsx"),
        "utf8",
      ),
    );
    // A per-pane mount is what put N portals on <body>; the ban is on the
    // ELEMENT, not the import (EditorPane no longer imports either component).
    expect(src).not.toMatch(/<StackIcon\b/);
    expect(src).not.toMatch(/<StackStrip\b/);
  });

  it("the chrome has exactly one mount site in the app", () => {
    const layout = codeOnly(
      readFileSync(
        resolve(__dirname, "../../../components/EditorLayout.tsx"),
        "utf8",
      ),
    );
    expect(layout.match(/<StackChromeHost\b/g) ?? []).toHaveLength(1);
  });
});
