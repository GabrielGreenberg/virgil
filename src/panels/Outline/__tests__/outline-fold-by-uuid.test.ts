// @vitest-environment jsdom
//
// OUT-A2-01 — the outline keys a heading's stable address (the fold/collapse
// Set membership, the pods parent-chain) on its durable block `uuid`, NOT its
// positional `heading-${idx}`.
//
// The bug: an index-based id DRIFTS the moment a block is inserted above a
// collapsed section — the heading formerly `heading-3` becomes `heading-4`, so
// the persisted fold key no longer matches and the section silently
// un-collapses (and an unrelated section may collapse onto the stale key). The
// block uuid is insert-stable, so the fold survives.

import { describe, it, expect, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";

// OutlinePanel transitively imports `@/lib/storage`, whose `require("@/...")`
// backend select can't be resolved by vitest's aliaser (the storage-mock
// gotcha). Stub it — `extractHeadings` is a pure function that touches none of
// these, so empty stubs are sufficient.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  writeBib: vi.fn(async () => undefined),
}));

import { extractHeadings } from "../OutlinePanel";

function heading(level: number, text: string, uuid: string | null): JSONContent {
  return {
    type: "heading",
    attrs: { level, uuid },
    content: [{ type: "text", text }],
  };
}

function para(text: string, uuid: string | null = "p-uuid"): JSONContent {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: [{ type: "text", text }],
  };
}

describe("extractHeadings — id keyed on uuid (OUT-A2-01)", () => {
  it("uses the heading block uuid as the stable id", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(1, "Intro", "uuid-intro"),
        para("body"),
        heading(1, "Methods", "uuid-methods"),
      ],
    };
    const { headings } = extractHeadings(doc);
    expect(headings.map((h) => h.id)).toEqual(["uuid-intro", "uuid-methods"]);
    // The positional `index` is still tracked separately for focus/position.
    expect(headings.map((h) => h.index)).toEqual([0, 2]);
  });

  it("the heading id is INSERT-STABLE: a block added above does not change it", () => {
    const before: JSONContent = {
      type: "doc",
      content: [
        heading(1, "Intro", "uuid-intro"),
        heading(1, "Methods", "uuid-methods"),
      ],
    };
    const idsBefore = extractHeadings(before).headings.map((h) => h.id);

    // Insert a paragraph ABOVE everything — every heading's index shifts by 1.
    const after: JSONContent = {
      type: "doc",
      content: [
        para("new first block", "uuid-new"),
        heading(1, "Intro", "uuid-intro"),
        heading(1, "Methods", "uuid-methods"),
      ],
    };
    const headingsAfter = extractHeadings(after).headings;

    // The ids are unchanged (would have been heading-0/heading-1 →
    // heading-1/heading-2 under the old positional scheme).
    expect(headingsAfter.map((h) => h.id)).toEqual(idsBefore);
    // ...even though the indices DID shift.
    expect(headingsAfter.map((h) => h.index)).toEqual([1, 2]);
  });

  it("a fold set keyed on uuid still matches the same section after an insert", () => {
    // Simulate the persisted collapse set holding the SECOND heading's uuid.
    const folded = new Set<string>(["uuid-methods"]);

    const after: JSONContent = {
      type: "doc",
      content: [
        para("inserted above"),
        heading(1, "Intro", "uuid-intro"),
        heading(1, "Methods", "uuid-methods"),
      ],
    };
    const headingsAfter = extractHeadings(after).headings;
    const methods = headingsAfter.find((h) => h.text === "Methods")!;
    // The fold key still resolves to the Methods heading (insert-stable).
    expect(folded.has(methods.id)).toBe(true);
    // The Intro heading is NOT mistakenly considered folded.
    const intro = headingsAfter.find((h) => h.text === "Intro")!;
    expect(folded.has(intro.id)).toBe(false);
  });

  it("falls back to the positional id for an un-hydrated heading (null uuid)", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "Lazy", null), heading(2, "Sub", null)],
    };
    const { headings } = extractHeadings(doc);
    expect(headings.map((h) => h.id)).toEqual(["heading-0", "heading-1"]);
  });
});
