// @vitest-environment jsdom
/**
 * Task 1402 — commit-seam obligation 1 ("ask editability at the COMMIT, for
 * every surface the compound touches") is held by the COMMIT, not only by the
 * dispatch doors.
 *
 * A sidecar-only drop (a card re-anchor, a Stack card pull) dispatches nothing
 * through ProseMirror, so it never met `commitDocThenCards`' gate: a re-anchor
 * whose confirm dialog was open while the pen moved still rewrote the card's
 * links. `finishApply` — the one function every spec's `applyDrop` is reached
 * through, after any confirm — now asks `commitSurfacesWritable(placement
 * editor, main)` first. And the mint-at-commit (a WRITE: a uuid + an undo
 * step) moved from before `classifyDrop` to after that gate, so a `no-op` or a
 * Cancel leaves the doc untouched.
 *
 * Drives the REAL controller with `hit-test` mocked to a fixed placement and
 * the real notes re-anchor spec (the registry resolves it from the key). Since
 * task 1423 a re-anchor asks nothing, so the CONFIRM legs wrap that spec in the
 * one confirm a drop may raise — a `tone: "danger"` one — leaving its real
 * `applyDrop` behind the dialog (`withDangerConfirm`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

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

let mockPlacement: Placement | null = null;
const mintCalls: string[] = [];
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: (id: string) => id.startsWith("unminted@"),
  mintPlacementUuid: (_editor: unknown, id: string) => {
    mintCalls.push(id);
    return id.startsWith("unminted@") ? "MINTED" : id;
  },
}));

/** When set, the registry's spec raises a danger confirm where it would
 *  apply — the controller's confirm branch, with the real mutation behind it. */
let withDangerConfirm = false;
vi.mock("../registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../registry")>();
  return {
    ...real,
    lookupSpec: (key: string) => {
      const spec = real.lookupSpec(key);
      if (!spec || !withDangerConfirm) return spec;
      return {
        ...spec,
        classifyDrop: (...args: Parameters<typeof spec.classifyDrop>) => {
          const d = spec.classifyDrop(...args);
          return d.kind === "apply"
            ? { kind: "confirm", tone: "danger", message: "Destroy it?" }
            : d;
        },
      };
    },
  };
});

import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  setDropCtx,
} from "../controller";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";

/** A surface whose pen the test can flip (`view.editable`). */
function makeEditor(editable = true) {
  const view = { editable, dispatch() {} };
  return { editor: { state: {}, view, storage: {} } as unknown as Editor, view };
}

function makeApi(initial: string[]) {
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
    modeB: { policy: "release", release: () => null },
  };
  return { api, added, removed };
}

const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "n1" });

function setup(opts: {
  anchors: string[];
  editor: Editor;
  main?: Editor | null;
  confirm?: () => Promise<boolean>;
}) {
  const { api, added, removed } = makeApi(opts.anchors);
  const closePopout = vi.fn<(key: string) => void>();
  const requestAnchorFlush = vi.fn<(pid: string) => void>();
  setDropCtx({
    // Default null: `captureParagraphSnapshot(null, …)` degrades to a null
    // snapshot, so the stub editor's empty state is never walked.
    mainEditor: opts.main ?? null,
    closePopout,
    requestAnchorFlush,
    confirm: opts.confirm ?? (async () => true),
    notes: api,
  } as unknown as DropCtx);
  return { added, removed, requestAnchorFlush };
}

async function dragTo(editor: Editor, paragraphId: string) {
  mockPlacement = {
    kind: "paragraph-side",
    editor,
    paragraphId,
    side: "left",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  } as unknown as Placement;
  expect(
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 10 },
      externalCommit: true,
    }),
  ).toBe(true);
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
  );
  await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => {
  mockPlacement = null;
  mintCalls.length = 0;
  withDangerConfirm = false;
});
afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
});

describe("finishApply asks editability AT the commit (task 1402)", () => {
  it("the pen flips while a drop's confirm is open → links unchanged, no flush", async () => {
    withDangerConfirm = true;
    const { editor, view } = makeEditor(true);
    const { added, removed, requestAnchorFlush } = setup({
      anchors: ["P_old"],
      editor,
      confirm: async () => {
        view.editable = false; // the co-author takes the pen mid-dialog
        return true;
      },
    });
    await dragTo(editor, "P_new");
    await commitDropSession();
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
    expect(requestAnchorFlush).not.toHaveBeenCalled();
  });

  it("a read-only MAIN refuses a sidecar-only commit even when the landing surface is writable", async () => {
    const { editor } = makeEditor(true);
    const { editor: main } = makeEditor(false);
    const { added, removed } = setup({ anchors: ["P_old"], editor, main });
    await dragTo(editor, "P_new");
    await commitDropSession();
    expect(removed).toEqual([]);
    expect(added).toEqual([]);
  });

  it("control: a writable surface re-anchors as before", async () => {
    const { editor } = makeEditor(true);
    const { added, removed, requestAnchorFlush } = setup({
      anchors: ["P_old"],
      editor,
    });
    await dragTo(editor, "P_new");
    await commitDropSession();
    expect(added).toEqual(["P_new"]);
    expect(removed).toEqual(["P_old"]);
    expect(requestAnchorFlush).toHaveBeenCalledWith("P_new");
  });
});

describe("mint-at-commit writes only once the drop will land (task 1402)", () => {
  it("Cancel on the confirm → nothing minted", async () => {
    withDangerConfirm = true;
    const { editor } = makeEditor(true);
    const { added } = setup({
      anchors: ["P_old"],
      editor,
      confirm: async () => false,
    });
    await dragTo(editor, "unminted@4");
    await commitDropSession();
    expect(mintCalls).toEqual([]);
    expect(added).toEqual([]);
  });

  it("a read-only surface → nothing minted", async () => {
    const { editor } = makeEditor(false);
    setup({ anchors: [], editor });
    await dragTo(editor, "unminted@4");
    await commitDropSession();
    expect(mintCalls).toEqual([]);
  });

  it("accepted → minted once, and the card anchors to the MINTED uuid", async () => {
    const { editor } = makeEditor(true);
    const { added, requestAnchorFlush } = setup({ anchors: ["P_old"], editor });
    await dragTo(editor, "unminted@4");
    await commitDropSession();
    expect(mintCalls).toEqual(["unminted@4"]);
    expect(added).toEqual(["MINTED"]);
    expect(requestAnchorFlush).toHaveBeenCalledWith("MINTED");
  });
});

describe("CENSUS — the commit gate is the controller's, ahead of every spec", () => {
  const ctrl = codeOnly(
    readFileSync(join(process.cwd(), "src/components/drop-mode/controller.ts"), "utf8"),
  );

  it("applyDrop has ONE caller, and it sits behind commitSurfacesWritable + the mint", () => {
    const calls = ctrl.match(/\.applyDrop\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const gate = ctrl.indexOf("commitSurfacesWritable(");
    const mint = ctrl.indexOf("mintPlacementUuid(");
    const apply = ctrl.indexOf(".applyDrop(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(mint);
    expect(mint).toBeLessThan(apply);
  });

  it("the mint runs AFTER classifyDrop (nothing writes before the decision)", () => {
    expect(ctrl.indexOf("mintPlacementUuid(")).toBeGreaterThan(
      ctrl.indexOf(".classifyDrop("),
    );
  });
});
