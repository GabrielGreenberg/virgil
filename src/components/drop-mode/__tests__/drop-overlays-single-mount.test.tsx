// @vitest-environment jsdom
/**
 * Task 1027 — the app-global drop overlays mount ONCE, not once per pane.
 *
 * `DropModeIndicator` (the blue placement bar) and `InlineAtomGhost` (the
 * inline-atom drag ghost) render from APP-GLOBAL state — the one drop session
 * and the one ghost module store — and portal to `document.body`. They used to
 * be rendered by `DropModeProvider`, one per `EditorPane` (keep-alive mounts N),
 * so the DOM held N stacked bars and N ghost hosts. The ghost store has ONE node
 * slot: each host's ref overwrote it (last mount won), and a non-last pane
 * unmounting mid-drag nulled it — the ghost froze while the drag went on.
 *
 *   1. CENSUS — the two overlays are rendered in exactly one file
 *      (`DropModeOverlays.tsx`), and that component has exactly one mount site
 *      (`src/app/page.tsx`). `DropModeProvider` renders neither.
 *   2. BEHAVIOUR — two pane providers + the one overlay host, an atom-grab
 *      session in the second pane, the FIRST-mounted pane unmounts mid-drag:
 *      exactly one ghost in the DOM, and the motion channel still writes to it.
 *   3. FLOOR — `detachGhostNode` from a host that no longer owns the slot is a
 *      no-op (a departing owner removes only its own entry).
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { codeOnly, elementsNamed, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

// Rendering the provider pulls the spec registry, whose module graph reaches
// `@/lib/storage` (see `dropctx-multipane-registry.test.tsx`).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { DropModeProvider, type DropModeProviderProps } from "../DropModeProvider";
import { DropModeOverlays } from "../DropModeOverlays";
import {
  __resetDropCtxRegistry,
  beginDropSession,
  cancelDropSession,
  getDropSession,
} from "../controller";
import {
  __getGhostNode,
  attachGhostNode,
  clearGhost,
  detachGhostNode,
  setGhost,
} from "../inline-atom-ghost";

afterEach(() => {
  act(() => {
    clearGhost();
    cancelDropSession();
  });
  cleanup();
  __resetDropCtxRegistry();
});

const noop = () => {};

function makeEditor(visible: boolean): Editor {
  const dom = document.createElement("div");
  Object.defineProperty(dom, "offsetHeight", { get: () => (visible ? 400 : 0) });
  return {
    isDestroyed: false,
    isFocused: false,
    state: {},
    view: { dom, dispatch() {} },
  } as unknown as Editor;
}

function props(mainEditor: Editor): DropModeProviderProps {
  return { mainEditor, closePopout: noop };
}

// ── 1. Census ───────────────────────────────────────────────────────────────

describe("drop overlays — one mount site (census)", () => {
  const sources = trackedFiles("src", /\.tsx$/).filter(
    (f) => !f.includes(`${path.sep}__tests__${path.sep}`),
  );
  const rel = (f: string) => path.relative(REPO_ROOT, f);
  const sitesOf = (name: string) =>
    sources.flatMap((f) =>
      elementsNamed(codeOnly(fs.readFileSync(f, "utf8")), name).map(() => rel(f)),
    );

  it("the bar and the ghost are rendered only by DropModeOverlays", () => {
    expect(sitesOf("DropModeIndicator")).toEqual([
      "src/components/drop-mode/DropModeOverlays.tsx",
    ]);
    expect(sitesOf("InlineAtomGhost")).toEqual([
      "src/components/drop-mode/DropModeOverlays.tsx",
    ]);
  });

  it("DropModeOverlays has exactly one mount site, at app level", () => {
    expect(sitesOf("DropModeOverlays")).toEqual(["src/app/page.tsx"]);
  });
});

// ── 2. Behaviour ────────────────────────────────────────────────────────────

describe("drop overlays — N panes mounted", () => {
  it("one ghost; it survives the first-mounted pane unmounting mid-drag", () => {
    const a = makeEditor(false);
    const b = makeEditor(true);
    render(<DropModeOverlays />);
    const paneA = render(<DropModeProvider {...props(a)} />);
    render(<DropModeProvider {...props(b)} />);

    const atom = document.createElement("span");
    atom.textContent = "x";
    act(() => {
      beginDropSession({
        cardKey: "atom-grab:test-1027",
        origin: { x: 10, y: 10 },
        inPlace: true,
        externalCommit: true,
        editor: b,
      });
      setGhost({ el: atom, grabOffsetX: 2, grabOffsetY: 2, cursorX: 100, cursorY: 200 });
    });

    const ghosts = () => document.querySelectorAll(".inline-atom-ghost");
    expect(ghosts()).toHaveLength(1);
    const host = ghosts()[0] as HTMLElement;
    expect(__getGhostNode()).toBe(host);

    paneA.unmount();

    // The drag is pane B's, so evicting pane A leaves it alive…
    expect(getDropSession()).not.toBeNull();
    // …and the ghost is still the one host, still the channel's target.
    expect(ghosts()).toHaveLength(1);
    expect(__getGhostNode()).toBe(host);
    expect(host.isConnected).toBe(true);
    expect(host.firstChild).not.toBeNull();
  });
});

// ── 3. Floor ────────────────────────────────────────────────────────────────

describe("ghost node slot — owner-guarded release", () => {
  it("a non-owner's detach leaves the live node attached; the owner's clears it", () => {
    const stale = document.createElement("div");
    const live = document.createElement("div");
    attachGhostNode(stale);
    attachGhostNode(live);
    detachGhostNode(stale);
    expect(__getGhostNode()).toBe(live);
    detachGhostNode(live);
    expect(__getGhostNode()).toBeNull();
  });
});
