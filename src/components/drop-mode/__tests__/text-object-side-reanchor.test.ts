// @vitest-environment jsdom
/**
 * Chip H — FOLD 2: the load-bearing MUTATION proof for the paragraph-side
 * re-anchor spec.
 *
 * `textObjectSideReanchorSpec` is the ONE spec behind every attachment-card
 * pin / drop-button re-anchor — note, todo, archive, cutter, report, AND (newly
 * functional after the fold) revision/revision-suggestion. The existing
 * `marginalia-pin-gesture.test.tsx` mocks the controller and only asserts the
 * `float:card:<kind>:<id>` string that the gesture HANDS to the controller; it
 * never invokes the spec's real `classifyDrop`/`applyDrop`. So nothing proved
 * the actual re-anchor mutation.
 *
 * This file drives the REAL spec returned by the factory against a hand-rolled
 * `ParagraphAnchorApi` that records its calls. It proves:
 *
 *   classifyDrop:
 *     (a) unanchored card (getAnchorTextObjectIds → [])        → { kind: "apply" }
 *     (b) already on the target paragraph                       → { kind: "no-op" }
 *     (c) anchored to a DIFFERENT paragraph                     → { kind: "confirm" }
 *
 *   applyDrop:
 *     (d) MULTI-anchor card ({P1,P2}, drop target P3) collapses to the target —
 *         removes BOTH P1 and P2, adds P3 ("move" semantics, not "also-link").
 *     (e) the mutation bottoms out by calling removeTextObjectLink(old) +
 *         addTextObjectLink(target) on the api.
 *
 * The spec reads `placement.kind` / `placement.paragraphId` and the api
 * sub-bag off `ctx`; `editor`/`rect`/`side` are untouched. `mainEditor` is
 * read only to capture a Mode-A self-healing snapshot for the new anchor —
 * absent here, so the snapshot arg comes through as null (the re-anchor
 * still lands). preserveModeBAnchor returns null, so the Placement/DropCtx
 * are minimal `as unknown as` casts, matching `real-drop-specs-create.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { textObjectSideReanchorSpec } from "../util/text-object-side-reanchor";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";

/** A recording `ParagraphAnchorApi` whose anchor set is seeded per-test. The
 *  add/remove handlers mutate the live set so a follow-up `getAnchorTextObjectIds`
 *  reads the post-mutation state (matches the real hook). */
function makeApi(
  initial: string[],
  opts: { withClearModeB?: boolean } = {},
): {
  api: ParagraphAnchorApi;
  anchors: () => string[];
  added: string[];
  removed: string[];
  clearModeBCalls: string[];
} {
  const set = new Set(initial);
  const added: string[] = [];
  const removed: string[] = [];
  const clearModeBCalls: string[] = [];
  const api: ParagraphAnchorApi = {
    exists: () => true,
    getAnchorTextObjectIds: () => [...set],
    addTextObjectLink: (_id, pid, _targetKind, _snapshot) => {
      added.push(pid);
      set.add(pid);
    },
    removeTextObjectLink: (_id, pid) => {
      removed.push(pid);
      set.delete(pid);
    },
    // Mode A on this path → null (no Mode-B preservation, no mainEditor touch).
    preserveModeBAnchor: () => null,
    // Notes carry `clearModeB` (Mode-B → Mode-A conversion); highlights
    // deliberately omit it. The `opts` flag mirrors that bag-level gate.
    ...(opts.withClearModeB
      ? {
          clearModeB: (id: string) => {
            clearModeBCalls.push(id);
          },
        }
      : {}),
  };
  return { api, anchors: () => [...set], added, removed, clearModeBCalls };
}

/** Minimal paragraph-side placement — the spec only reads `kind` + `paragraphId`. */
function paragraphSide(paragraphId: string): Placement {
  return { kind: "paragraph-side", paragraphId } as unknown as Placement;
}

/** A DropCtx carrying the api in the `revisions` sub-bag (the spec under test is
 *  built with `getApi: (ctx) => ctx.revisions`, exactly as the Revisions panel
 *  wires it). */
function ctxWith(api: ParagraphAnchorApi): DropCtx {
  return { revisions: api } as unknown as DropCtx;
}

/** A DropCtx carrying the api in the `notes` sub-bag — the notes panel wires
 *  `clearModeB` (Mode-B → Mode-A conversion) here. */
function ctxWithNotes(api: ParagraphAnchorApi): DropCtx {
  return { notes: api } as unknown as DropCtx;
}

/** A DropCtx carrying the api in the `highlights` sub-bag — highlights are
 *  intrinsically Mode-B and the panel omits `clearModeB`. */
function ctxWithHighlights(api: ParagraphAnchorApi): DropCtx {
  return { highlights: api } as unknown as DropCtx;
}

const CARD_KEY = buildFloatKey({
  domain: "card",
  kind: "revision-suggestion",
  id: "rvs1",
});

/** The spec exactly as the Revisions panel registers it. */
function makeSpec() {
  return textObjectSideReanchorSpec({
    kindLabel: "revision",
    getApi: (ctx) => ctx.revisions,
  });
}

describe("textObjectSideReanchorSpec — classifyDrop", () => {
  it("(a) unanchored card → { kind: 'apply' }", () => {
    const spec = makeSpec();
    const { api } = makeApi([]); // getAnchorTextObjectIds → []
    const decision = spec.classifyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));
    expect(decision).toEqual({ kind: "apply" });
  });

  it("(b) already on the target paragraph → { kind: 'no-op' }", () => {
    const spec = makeSpec();
    const { api } = makeApi(["P3"]); // single anchor === drop target
    const decision = spec.classifyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));
    expect(decision).toEqual({ kind: "no-op" });
  });

  it("(c) anchored to a different paragraph → { kind: 'confirm' }", () => {
    const spec = makeSpec();
    const { api } = makeApi(["P1"]); // anchored elsewhere
    const decision = spec.classifyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));
    expect(decision.kind).toBe("confirm");
  });
});

describe("textObjectSideReanchorSpec — applyDrop (the mutation)", () => {
  it("(d) MULTI-anchor card {P1,P2} dropped on P3 collapses to the target", () => {
    const spec = makeSpec();
    const { api, anchors, added, removed } = makeApi(["P1", "P2"]);

    spec.applyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));

    // Move semantics: BOTH stale anchors removed, target added — NOT also-link.
    expect(removed.sort()).toEqual(["P1", "P2"]);
    expect(added).toEqual(["P3"]);
    // Net live state: the card now points at exactly the target.
    expect(anchors()).toEqual(["P3"]);
  });

  it("(e) bottoms out via removeTextObjectLink(old) + addTextObjectLink(target)", () => {
    const spec = makeSpec();
    const { api, added, removed } = makeApi(["P1"]);
    const removeSpy = vi.spyOn(api, "removeTextObjectLink");
    const addSpy = vi.spyOn(api, "addTextObjectLink");

    spec.applyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));

    expect(removeSpy).toHaveBeenCalledWith("rvs1", "P1");
    // The re-anchor now passes the targetKind ("paragraph", drop is always
    // paragraph-side) plus a Mode-A self-healing snapshot captured from
    // ctx.mainEditor. This ctx has no mainEditor, so captureParagraphSnapshot
    // returns null — snapshot arg is null but the anchor still lands.
    expect(addSpy).toHaveBeenCalledWith("rvs1", "P3", "paragraph", null);
    expect(removed).toEqual(["P1"]);
    expect(added).toEqual(["P3"]);
  });

  it("dropping on the SAME single anchor is inert (no remove, no add)", () => {
    const spec = makeSpec();
    const { api, added, removed } = makeApi(["P3"]);
    spec.applyDrop(paragraphSide("P3"), CARD_KEY, ctxWith(api));
    expect(removed).toEqual([]);
    expect(added).toEqual([]);
  });
});

// CHIP-A: a paragraph-side re-anchor of a SELECTION-origin (Mode-B) NOTE must
// convert the surviving `linkedRange` link to a clean Mode-A `paragraph` link
// BEFORE the fresh anchor lands — driven by the note bag's `clearModeB`.
// Highlights are intrinsically Mode-B and omit `clearModeB`, so the conversion
// must NOT fire for them.
describe("textObjectSideReanchorSpec — Mode-B → Mode-A conversion (CHIP-A)", () => {
  const NOTE_KEY = buildFloatKey({ domain: "card", kind: "note", id: "note1" });
  const HL_KEY = buildFloatKey({ domain: "card", kind: "highlight", id: "hl1" });

  function noteSpec() {
    return textObjectSideReanchorSpec({
      kindLabel: "note",
      getApi: (ctx) => ctx.notes,
    });
  }
  function highlightSpec() {
    return textObjectSideReanchorSpec({
      kindLabel: "highlight",
      getApi: (ctx) => ctx.highlights,
    });
  }

  it("a NOTE re-anchor calls clearModeB(id) before adding the fresh paragraph anchor", () => {
    const spec = noteSpec();
    const { api, clearModeBCalls, added } = makeApi(["P1"], {
      withClearModeB: true,
    });
    expect(api.clearModeB).toBeDefined();
    const clearSpy = vi.spyOn(api, "clearModeB");
    const addSpy = vi.spyOn(api, "addTextObjectLink");

    spec.applyDrop(paragraphSide("P3"), NOTE_KEY, ctxWithNotes(api));

    // Conversion fires for the note id.
    expect(clearModeBCalls).toEqual(["note1"]);
    expect(clearSpy).toHaveBeenCalledWith("note1");
    // And it fires BEFORE the fresh paragraph anchor is written.
    expect(clearSpy.mock.invocationCallOrder[0]).toBeLessThan(
      addSpy.mock.invocationCallOrder[0],
    );
    // Fresh anchor lands as a paragraph (snapshot null — no mainEditor here).
    expect(addSpy).toHaveBeenCalledWith("note1", "P3", "paragraph", null);
    expect(added).toEqual(["P3"]);
  });

  it("a HIGHLIGHT re-anchor does NOT call clearModeB (highlights stay Mode-B)", () => {
    const spec = highlightSpec();
    // The highlight bag omits clearModeB entirely (withClearModeB: false).
    const { api, clearModeBCalls, added } = makeApi(["P1"], {
      withClearModeB: false,
    });
    expect(api.clearModeB).toBeUndefined();

    spec.applyDrop(paragraphSide("P3"), HL_KEY, ctxWithHighlights(api));

    // No conversion — the optional call no-ops because the bag omits it.
    expect(clearModeBCalls).toEqual([]);
    // The re-anchor itself still lands.
    expect(added).toEqual(["P3"]);
  });
});
