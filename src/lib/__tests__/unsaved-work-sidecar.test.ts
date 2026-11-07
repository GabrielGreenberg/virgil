/**
 * Task 1503 — every writer of a document's content publishes to the ONE
 * unsaved-work channel, the card sidecars included, as members of a
 * per-document SET distinct from the model's dirt.
 *
 * Pre-1503 only `useDocument` published, so a card body in its sidecar
 * debounce (or in flight) was invisible to the leave prompt, the save badge
 * and the reload door. The legs here pin the channel half: the set semantics
 * (no writer's landing — the bundle's or another card's — clears another's
 * dirt), edge-only notification (keystroke sanctity), and the reader split
 * (`hasUnlandedWork` = either kind; `hasUnlandedModelWork` = the bundle's).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearUnsavedWork,
  createSidecarWorkPublisher,
  docsWithUnlandedWork,
  getUnsavedWork,
  hasUnlandedModelWork,
  hasUnlandedWork,
  noteSaveLanded,
  noteSidecarWork,
  noteUnsavedEdit,
  subscribeUnsavedWork,
  unlandedSince,
  unsavedAgeMs,
} from "@/lib/unsaved-work";
import { deriveSaveState } from "@/lib/save-state";
import { shouldMirror } from "@/lib/emergency-mirror";

const DOC = "doc-1503";

beforeEach(() => clearUnsavedWork());

describe("sidecar writers on the unsaved-work channel (task 1503)", () => {
  it("a pending card write makes the DOCUMENT dirty, but not its model", () => {
    noteSidecarWork(DOC, {}, true, 1000);
    expect(hasUnlandedWork(DOC)).toBe(true);
    expect(hasUnlandedModelWork(DOC)).toBe(false);
    expect(docsWithUnlandedWork().map((s) => s.docId)).toEqual([DOC]);
    expect(unsavedAgeMs(DOC, 1500)).toBe(500);
  });

  it("DEFECT: the bundle landing does NOT clear a card's dirt", () => {
    const card = {};
    noteUnsavedEdit(DOC, 1000);
    noteSidecarWork(DOC, card, true, 1100);
    noteSaveLanded(DOC, 1200);
    expect(hasUnlandedModelWork(DOC)).toBe(false);
    expect(hasUnlandedWork(DOC)).toBe(true);
    noteSidecarWork(DOC, card, false);
    expect(hasUnlandedWork(DOC)).toBe(false);
  });

  it("one card's landing does not clear another's; the clock is the EARLIEST pending writer's", () => {
    const a = {};
    const b = {};
    noteSidecarWork(DOC, a, true, 1000);
    noteSidecarWork(DOC, b, true, 2000);
    expect(getUnsavedWork(DOC)?.sidecarDirtySince).toBe(1000);
    noteSidecarWork(DOC, a, false);
    expect(hasUnlandedWork(DOC)).toBe(true);
    expect(getUnsavedWork(DOC)?.sidecarDirtySince).toBe(2000);
    noteSidecarWork(DOC, b, false);
    expect(getUnsavedWork(DOC)?.sidecarDirtySince).toBeNull();
  });

  it("notifies on the EDGE only — a keystroke burst from a dirty writer costs no emits", () => {
    let emits = 0;
    const off = subscribeUnsavedWork(() => emits++);
    const card = {};
    noteSidecarWork(DOC, card, true, 1);
    for (let i = 0; i < 50; i++) noteSidecarWork(DOC, card, true, 2 + i);
    expect(emits).toBe(1);
    // A second writer joining an already-dirty document changes nothing shown.
    noteSidecarWork(DOC, {}, true, 100);
    expect(emits).toBe(1);
    off();
  });

  it("settling a writer that never went dirty (or whose doc was cleared) creates nothing", () => {
    noteSidecarWork(DOC, {}, false);
    expect(getUnsavedWork(DOC)).toBeNull();
    const card = {};
    noteSidecarWork(DOC, card, true);
    clearUnsavedWork(DOC);
    noteSidecarWork(DOC, card, false);
    expect(getUnsavedWork(DOC)).toBeNull();
  });

  it("the save badge reads card dirt (young = pending), the MIRROR does not arm on it", () => {
    noteSidecarWork(DOC, {}, true, 1000);
    const s = getUnsavedWork(DOC);
    expect(unlandedSince(s)).toBe(1000);
    expect(deriveSaveState(s, 1200).tier).toBe("pending");
    expect(deriveSaveState(s, 1000 + 25_000).tier).toBe("unsaved");
    // The mirror stores the MODEL; a card body is not in it.
    expect(shouldMirror(s, 1000 + 999_999, true)).toBe(false);
  });

  it("the publisher moves its dirt with the document and settles the one it left", () => {
    const p = createSidecarWorkPublisher();
    p.sync("A", true);
    expect(hasUnlandedWork("A")).toBe(true);
    p.sync("B", true);
    expect(hasUnlandedWork("A")).toBe(false);
    expect(hasUnlandedWork("B")).toBe(true);
    p.sync("B", false);
    expect(hasUnlandedWork("B")).toBe(false);
    p.sync(null, true); // no document: nothing to publish under
    expect(docsWithUnlandedWork()).toEqual([]);
  });

  it("DEFECT (task 1516): after clearUnsavedWork the publisher re-registers — the channel is its only memory", () => {
    // A failed write leaves the writer published for A …
    const p = createSidecarWorkPublisher();
    p.sync("A", true);
    // … an external-change Reload forgets A while the doc (and writer) stay mounted …
    clearUnsavedWork("A");
    expect(hasUnlandedWork("A")).toBe(false);
    // … and the next write's dirt must reach the channel again.
    p.sync("A", true);
    expect(hasUnlandedWork("A")).toBe(true);
    // A repeat is still silent (edge-only — keystroke sanctity).
    let emits = 0;
    const off = subscribeUnsavedWork(() => emits++);
    p.sync("A", true);
    off();
    expect(emits).toBe(0);
    // And it settles normally.
    p.sync("A", false);
    expect(hasUnlandedWork("A")).toBe(false);
  });

  it("task 1516: an app-wide clear is recovered from the same way", () => {
    const p = createSidecarWorkPublisher();
    p.sync("A", true);
    clearUnsavedWork();
    p.sync("A", true);
    expect(hasUnlandedWork("A")).toBe(true);
  });
});
