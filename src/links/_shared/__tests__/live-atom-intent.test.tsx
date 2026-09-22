// @vitest-environment jsdom
//
// Task 704 — "a live marker wins over declared intent", at the SOURCE.
//
// Archiving a footnote/citation splices its atom out with an undoable
// transaction and flags the ref `archived` + `unanchored`. Cmd+Z (or a code-view
// retype, or a paste) brings the atom back; nothing used to rewrite the sidecar,
// so `archivedIds` kept the LIVE footnote archived — dropped from Omni and the
// margin, its archive toggle inverted. The reconcile clears the flags of every
// ref whose atom is live, through the kind's idempotent `markAnchored`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { FootnotesState } from "@/lib/types";

const DISK: Record<string, unknown> = {};

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
  }),
}));

import { staleAtomIntentIds } from "../live-atom-intent";
import { archivedCardIds } from "../archived-anchor-chrome";
import { useFootnotes } from "@/hooks/useFootnotes";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-704";

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
});

describe("staleAtomIntentIds", () => {
  it("returns flagged refs whose atom is live — and only those", () => {
    const refs = [
      { id: "a", archived: true, unanchored: true }, // undone archive → stale
      { id: "b", unanchored: true }, // parked draft, atom live → stale
      { id: "c", archived: true, unanchored: true }, // genuinely archived
      { id: "d" }, // ordinary live, no flag
    ];
    expect(staleAtomIntentIds(refs, new Set(["a", "b", "d"]))).toEqual(["a", "b"]);
  });

  it("is empty when nothing is flagged (the common case)", () => {
    expect(staleAtomIntentIds([{ id: "x" }], new Set(["x"]))).toEqual([]);
  });
});

describe("footnote: archive → undo → reconcile", () => {
  it("clears both flags and drops the id from archivedIds", async () => {
    beginDocPipeline(DOC);
    // The post-archive sidecar: ref flagged, atom spliced out.
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-1",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          createdAt: "2026-01-01T00:00:00.000Z",
          archived: true,
          unanchored: true,
        },
      ],
    } satisfies FootnotesState;
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(archivedCardIds([result.current.footnoteRefs]).has("fn-1")).toBe(true);

    // Cmd+Z restored the atom: fn-1 is live again.
    const live = new Set(["fn-1"]);
    act(() => {
      for (const id of staleAtomIntentIds(result.current.footnoteRefs, live)) {
        result.current.markAnchored(id);
      }
    });
    const ref = result.current.footnoteRefs.find((f) => f.id === "fn-1")!;
    expect(ref.archived).toBeUndefined();
    expect(ref.unanchored).toBeUndefined();
    expect(archivedCardIds([result.current.footnoteRefs]).has("fn-1")).toBe(false);
    // Converged: a second pass finds nothing (no write loop).
    expect(staleAtomIntentIds(result.current.footnoteRefs, live)).toEqual([]);
  });
});

describe("EditorPane wiring (source guard)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../components/EditorPane.tsx"),
    "utf8",
  );
  const start = src.indexOf("const atomIntentRefsRef = useRef(");
  const block = src.slice(start, src.indexOf("]);", src.indexOf("staleAtomIntentIds(citations")) + 3);

  it("reconciles both kinds through markAnchored", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/staleAtomIntentIds\(footnotes, liveFootnotes\)/);
    expect(block).toMatch(/footnotesHook\.markAnchored\(id\)/);
    expect(block).toMatch(/staleAtomIntentIds\(citations, liveCitations\)/);
    expect(block).toMatch(/citationsHook\.markAnchored\(id\)/);
  });

  it("is keyed on the STRUCTURAL lists, never on the refs (the archive race) nor per keystroke", () => {
    const deps = block.slice(block.lastIndexOf("}, ["));
    expect(deps).toMatch(/footnoteInfos/);
    expect(deps).toMatch(/citationOrder/);
    expect(deps).toMatch(/footnotesHook\.loaded/);
    expect(deps).not.toMatch(/footnoteRefs/);
    expect(deps).not.toMatch(/citationsHook\.citations/);
    expect(deps).not.toMatch(/editorDocVersion|docVersion/);
  });
});
