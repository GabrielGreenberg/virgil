// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";
import type { FocusBand } from "@/lib/focus-view";

// OutlinePanel pulls the storage barrel (`@/lib/storage` → `@/lib/storage-fsa`)
// transitively; stub it so the pure resolver under test imports cleanly — the
// same preamble the sibling `outline-fold-by-uuid` / `extractHeadings` tests use.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  writeBib: vi.fn(async () => undefined),
}));

import { resolveFocusStateFromSnapshot } from "@/panels/Outline/OutlinePanel";

/**
 * Task 307 — the outline focus cull must resolve its boundary from the SAME
 * `content` snapshot that supplies the heading indices, so the two operands of
 * `heading.index </> focusState.{start,end}BlockIndex` can never describe two
 * different doc revisions (the "mirror drifts from source on structural change"
 * class, task 126). `resolveFocusStateFromSnapshot` is that in-snapshot resolver;
 * these tests pin its semantics against the live-doc twin `resolveFocusBand`.
 */

/** Build a minimal outline `content` snapshot: one top-level block per uuid. */
function snapshot(uuids: (string | null)[]): JSONContent {
  return {
    type: "doc",
    content: uuids.map((uuid) => ({
      type: "heading",
      attrs: { uuid },
    })),
  };
}

const band = (over: Partial<FocusBand>): FocusBand => ({
  active: true,
  locked: false,
  startUuid: null,
  endUuid: null,
  ...over,
});

describe("resolveFocusStateFromSnapshot (task 307)", () => {
  it("resolves a named band to inclusive indices IN THE SNAPSHOT", () => {
    const content = snapshot(["a", "b", "c", "d", "e"]);
    const fs = resolveFocusStateFromSnapshot(
      band({ startUuid: "b", endUuid: "c" }),
      content,
    );
    expect(fs).toEqual({
      active: true,
      locked: false,
      startBlockIndex: 1,
      endBlockIndex: 2,
    });
  });

  it("THE DRIFT REGRESSION: an edit above the band shifts indices, but boundary + headings stay in one revision so the next section is culled", () => {
    // Pre-edit: focused section = block "sec1" (index 2), its last block "sec1-end"
    // is index 4; the NEXT section "sec2" is index 5.
    //   [intro, gap, sec1, sec1-sub, sec1-end, sec2, ...]
    // A block is INSERTED above the focused section. In the buggy world the
    // outline snapshot refreshed (sec2 now at a lower index) while a STALE
    // index-projected focusState still said endBlockIndex = 4, so the inclusive
    // `sec2.index > 4` test went false and sec2 leaked in.
    //
    // Resolving the boundary from the SAME snapshot makes that impossible: the
    // band's endUuid ("sec1-end") resolves to WHATEVER index it now holds, so
    // the next section is always strictly outside.
    const preEdit = snapshot([
      "intro",
      "gap",
      "sec1",
      "sec1-sub",
      "sec1-end",
      "sec2",
    ]);
    const fsPre = resolveFocusStateFromSnapshot(
      band({ startUuid: "sec1", endUuid: "sec1-end" }),
      preEdit,
    );
    // sec2 (index 5) is above the inclusive end (4) → culled.
    expect(fsPre.endBlockIndex).toBe(4);
    expect(5 > fsPre.endBlockIndex).toBe(true);

    // A new block "new" is inserted above the focused section → every later
    // index shifts +1. The band anchors are UUIDs, so the SAME snapshot yields
    // the shifted boundary; sec2 (now index 6) is STILL strictly outside.
    const postEdit = snapshot([
      "intro",
      "gap",
      "new",
      "sec1",
      "sec1-sub",
      "sec1-end",
      "sec2",
    ]);
    const fsPost = resolveFocusStateFromSnapshot(
      band({ startUuid: "sec1", endUuid: "sec1-end" }),
      postEdit,
    );
    expect(fsPost).toEqual({
      active: true,
      locked: false,
      startBlockIndex: 3,
      endBlockIndex: 5,
    });
    // The next section can never leak: its snapshot index (6) is compared
    // against the boundary resolved from THAT SAME snapshot (5).
    expect(6 > fsPost.endBlockIndex).toBe(true);
  });

  it("null anchors are doc-start / doc-end sentinels", () => {
    const content = snapshot(["a", "b", "c"]);
    expect(
      resolveFocusStateFromSnapshot(band({ startUuid: null, endUuid: "b" }), content),
    ).toMatchObject({ startBlockIndex: 0, endBlockIndex: 1 });
    expect(
      resolveFocusStateFromSnapshot(band({ startUuid: "b", endUuid: null }), content),
    ).toMatchObject({ startBlockIndex: 1, endBlockIndex: 2 });
  });

  it("a named anchor missing from the snapshot degrades to inactive (no phantom range)", () => {
    const content = snapshot(["a", "b", "c"]);
    const fs = resolveFocusStateFromSnapshot(
      band({ startUuid: "a", endUuid: "gone" }),
      content,
    );
    expect(fs.active).toBe(false);
  });

  it("crossed anchors swap rather than producing an inverted range", () => {
    const content = snapshot(["a", "b", "c", "d"]);
    const fs = resolveFocusStateFromSnapshot(
      band({ startUuid: "d", endUuid: "b" }),
      content,
    );
    expect(fs).toMatchObject({ startBlockIndex: 1, endBlockIndex: 3 });
  });

  it("an inactive band or empty snapshot → inactive", () => {
    const content = snapshot(["a", "b"]);
    expect(
      resolveFocusStateFromSnapshot(band({ active: false }), content).active,
    ).toBe(false);
    expect(resolveFocusStateFromSnapshot(band({}), null).active).toBe(false);
    expect(
      resolveFocusStateFromSnapshot(band({}), snapshot([])).active,
    ).toBe(false);
  });

  it("blocks with a null uuid are skipped, not matched as sentinels", () => {
    // A freshly split block carries a null uuid until the backfill tx — it must
    // not accidentally match a named anchor lookup.
    const content = snapshot(["a", null, "b", null, "c"]);
    const fs = resolveFocusStateFromSnapshot(
      band({ startUuid: "b", endUuid: "c" }),
      content,
    );
    expect(fs).toMatchObject({ startBlockIndex: 2, endBlockIndex: 4 });
  });
});
