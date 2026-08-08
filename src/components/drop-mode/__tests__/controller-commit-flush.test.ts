// @vitest-environment jsdom
/**
 * CHIP-C teeth — the controller fires ONE `.tex` durability flush per
 * successful paragraph re-anchor COMMIT, decoupled from whether a UUID mint
 * happened.
 *
 * RC3 (MEMO_CARD_DROP_MARGIN_FIX.md): a clean Mode-A card re-anchored onto a
 * paragraph that ALREADY carries a UUID dispatches NO mint tx (`anchor-uuid.ts`
 * early-returns), so the anchor-mint flush never fires and the paragraph's
 * `%!v:<uuid>` may never reach the `.tex`. A reload re-mints the paragraph a
 * fresh UUID → the card's anchor dies. CHIP-C closes the gap: `finishApply`
 * (the single mouseup commit per gesture) calls `ctx.requestAnchorFlush?.(pid)`
 * on every successful re-anchor commit.
 *
 * These tests drive the REAL controller commit path (`commitDropSession` →
 * `finishApply`) with `hit-test` mocked to a fixed paragraph-side placement,
 * so the spec's real `classifyDrop`/`applyDrop` run. They assert:
 *   - a re-anchor commit calls `requestAnchorFlush` ONCE with the target pid;
 *   - a `no-op` commit (same-paragraph) does NOT call it;
 *   - the throttled pointermove path NEVER calls it (commit-only).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The controller's module graph reaches `@/lib/storage` (via the registry →
// card drop-specs). Nothing in storage is exercised here, so a no-op proxy mock
// lets the graph load (same precedent as drop-session-survives-rerender).
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

// Mock the hit-test so we control the placement the controller resolves on
// mousemove — without a real editor. The controlled value is swapped per test.
let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  // Mint-at-commit exports the controller consults on commit; these fixtures
  // always carry real (non-sentinel) paragraph ids.
  isUnmintedParagraphId: (id: string) => id.startsWith("unminted@"),
  mintPlacementUuid: (_editor: unknown, id: string) => id,
}));

import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import { textObjectSideReanchorSpec } from "../util/text-object-side-reanchor";
import { lookupSpec } from "../registry";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";

const fakeEditor = { state: {}, view: { dispatch() {} } } as unknown as Editor;

/** Recording paragraph-anchor API seeded with the card's current anchors. */
function makeApi(initial: string[]): {
  api: ParagraphAnchorApi;
  added: string[];
  removed: string[];
} {
  const set = new Set(initial);
  const added: string[] = [];
  const removed: string[] = [];
  const api: ParagraphAnchorApi = {
    exists: () => true,
    getAnchorTextObjectIds: () => [...set],
    addTextObjectLink: (_id, pid) => {
      added.push(pid);
      set.add(pid);
    },
    removeTextObjectLink: (_id, pid) => {
      removed.push(pid);
      set.delete(pid);
    },
    preserveModeBAnchor: () => null,
  };
  return { api, added, removed };
}

/** The notes re-anchor spec, exactly as the Notes panel registers it. */
const spec = textObjectSideReanchorSpec({
  kindLabel: "note",
  getApi: (ctx) => ctx.notes,
});

const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "n1" });

function paragraphSide(pid: string): Placement {
  return {
    kind: "paragraph-side",
    editor: fakeEditor,
    paragraphId: pid,
    side: "left",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  } as unknown as Placement;
}

/** Build + register a DropCtx whose notes spec is wired and whose
 *  requestAnchorFlush is a spy. The real `lookupSpec` resolves the registered
 *  card spec, so we register OUR recording api in `ctx.notes`. */
function setup(initialAnchors: string[]) {
  const { api, added, removed } = makeApi(initialAnchors);
  const requestAnchorFlush = vi.fn<(pid: string) => void>();
  // mainEditor=null: `captureParagraphSnapshot(null, …)` degrades gracefully to
  // a null snapshot (UUID-only durability) — the re-anchor mutation + the
  // commit-flush still land. The real editor's snapshot capture is proven
  // end-to-end in text-object-side-reanchor-e2e.test.ts (CHIP-A); here we
  // isolate the controller's commit-flush contract.
  const ctx: DropCtx = {
    mainEditor: null,
    closePopout: () => {},
    requestAnchorFlush,
    confirm: async () => true,
    notes: api,
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { requestAnchorFlush, added, removed };
}

/** Drive a session to the mousemove placement. Returns whether begin took.
 *  `handleMove` throttles to ~16ms via setTimeout (module-level `lastMoveTs`
 *  persists across tests), so a move issued soon after a previous test's move
 *  is DEFERRED, not run synchronously. We dispatch then await past the throttle
 *  window so the deferred hit-test runs and `session.placement` is set. */
async function startAndMove(pid: string): Promise<boolean> {
  mockPlacement = paragraphSide(pid);
  const started = beginDropSession({
    cardKey: CARD_KEY,
    origin: { x: 10, y: 10 },
    externalCommit: true, // we drive commit ourselves
  });
  window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20 }));
  // Wait past the 16ms throttle so any deferred run fires.
  await new Promise((r) => setTimeout(r, 30));
  return started;
}

beforeEach(() => {
  mockPlacement = null;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  vi.restoreAllMocks();
});

describe("CHIP-C — controller commit-flush", () => {
  it("the registered note spec IS the paragraph-side re-anchor spec (lookup sanity)", () => {
    // Guards the test against the controller silently no-opping for a missing
    // spec: the commit teeth below depend on the real spec running.
    expect(lookupSpec(CARD_KEY)).toBeTruthy();
  });

  it("fires requestAnchorFlush ONCE with the target paragraphId on a re-anchor commit", async () => {
    // Card currently anchored to P_old; re-anchor onto P_new. classifyDrop →
    // 'confirm' (different paragraph); our ctx.confirm resolves true.
    const { requestAnchorFlush, added, removed } = setup(["P_old"]);
    expect(await startAndMove("P_new")).toBe(true);
    expect(getDropSession()?.placement?.kind).toBe("paragraph-side");

    await commitDropSession();

    // The mutation landed (proves applyDrop ran, so the flush is post-success).
    expect(added).toEqual(["P_new"]);
    expect(removed).toEqual(["P_old"]);
    // The durability flush fired exactly once, with the target pid.
    expect(requestAnchorFlush).toHaveBeenCalledTimes(1);
    expect(requestAnchorFlush).toHaveBeenCalledWith("P_new");
  });

  it("fires requestAnchorFlush on an UNANCHORED card re-anchor (classifyDrop apply)", async () => {
    const { requestAnchorFlush, added } = setup([]); // → { kind: 'apply' }
    expect(await startAndMove("P_new")).toBe(true);

    await commitDropSession();

    expect(added).toEqual(["P_new"]);
    expect(requestAnchorFlush).toHaveBeenCalledTimes(1);
    expect(requestAnchorFlush).toHaveBeenCalledWith("P_new");
  });

  it("does NOT fire requestAnchorFlush on a no-op drop (same paragraph)", async () => {
    // Card already on P_same → classifyDrop returns 'no-op' → commit short-
    // circuits before finishApply, so no flush.
    const { requestAnchorFlush, added, removed } = setup(["P_same"]);
    expect(await startAndMove("P_same")).toBe(true);

    await commitDropSession();

    expect(added).toEqual([]);
    expect(removed).toEqual([]);
    expect(requestAnchorFlush).not.toHaveBeenCalled();
  });

  it("does NOT fire requestAnchorFlush on a throttled pointermove (commit-only, keystroke sanctity)", async () => {
    // Several mousemoves resolve placements but must NEVER flush — only the
    // mouseup commit may. (handleMove stays read-only/hit-test-only.)
    const { requestAnchorFlush } = setup(["P_old"]);
    mockPlacement = paragraphSide("P_new");
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 10 },
      externalCommit: true,
    });
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 20 + i, clientY: 20 + i }),
      );
    }
    // Let the throttle's deferred run fire — the placement resolves, but still
    // NO flush: only a commit may flush.
    await new Promise((r) => setTimeout(r, 30));
    expect(getDropSession()?.placement?.kind).toBe("paragraph-side");
    expect(requestAnchorFlush).not.toHaveBeenCalled();
  });
});
