// @vitest-environment jsdom
//
// Task 703 — the footnotes.json mirror's ONE upsert door.
//
// A footnote made in the app (toolbar / slash) or parsed from the `.tex` has
// NO `footnotes.json` ref: only the stack-pull factory ever called
// `addFootnote`. Every setter that writes INTO a ref used to be map-only, so
// for such a footnote archive / AI-request / body-edit were silent no-ops —
// and archive, which splices the atom out right after, destroyed the body.
//
// The door: `withRef` seeds a missing ref from the LIVE atom (owner-supplied
// `resolveBody`), refuses before the sidecar has loaded (a ref minted over the
// pre-load EMPTY would persist a one-entry file over the real sidecar), and
// `ensureRef` lets the archive path capture BEFORE it deletes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { FootnotesState } from "@/lib/types";

const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];
let releaseRead: (() => void) | null = null;
let gateReads = false;

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) => {
    if (gateReads) await new Promise<void>((r) => { releaseRead = r; });
    return file in DISK ? DISK[file] : dflt;
  }),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
  /**
   * The hook's write door since task 719: the read runs INSIDE the write's
   * critical section, the caller's merge is applied to it, then the write.
   * `DISK` is this suite's file, so the merge sees the same bytes a reader
   * would — and `writes` still records what actually lands.
   */
  mutateSidecar: vi.fn(
    async (
      _handle: unknown,
      file: string,
      defaultValue: unknown,
      mutate: (current: unknown) => unknown,
    ) => {
      const current = file in DISK ? DISK[file] : defaultValue;
      const next = mutate(current);
      if (next === null) return null;
      DISK[file] = next as never;
      writes.push({ file, data: next });
      return next;
    },
  ),
}));

const bridgeCalls: unknown[][] = [];
vi.mock("@/lib/ai-request-bridge", () => ({
  bridgeFlagForCard: vi.fn((...args: unknown[]) => { bridgeCalls.push(args); }),
}));

import { useFootnotes } from "../useFootnotes";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-fn-upsert";
const BODY = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "A toolbar footnote" }] },
  ],
};

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
  bridgeCalls.length = 0;
  gateReads = false;
  releaseRead = null;
});

async function flushLoad() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function lastFootnotes(): FootnotesState | undefined {
  return [...writes].reverse().find((w) => w.file === "footnotes.json")?.data as
    | FootnotesState
    | undefined;
}

/** The live doc holds `fn-live` (no sidecar ref); anything else is absent. */
const liveBody = (id: string) => (id === "fn-live" ? BODY : null);

describe("useFootnotes — the upsert door (task 703)", () => {
  it("archiving a ref-less footnote captures its live body, flagged archived + unanchored", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    let landed = false;
    act(() => { landed = result.current.setArchived("fn-live", true); });

    expect(landed).toBe(true);
    const ref = lastFootnotes()?.footnotes.find((f) => f.id === "fn-live");
    expect(ref).toMatchObject({ id: "fn-live", archived: true, unanchored: true });
    expect(ref?.content).toEqual(BODY);
    // Deep copy — never aliases the live node's attr JSON.
    expect(ref?.content).not.toBe(BODY);
    expect(result.current.footnoteRefs.map((f) => f.id)).toEqual(["fn-live"]);
  });

  it("unarchive after archive leaves a parked ref WITH the body", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    act(() => { result.current.ensureRef("fn-live"); });
    act(() => { result.current.setArchived("fn-live", true); });
    act(() => { result.current.setArchived("fn-live", false); });

    const ref = lastFootnotes()?.footnotes.find((f) => f.id === "fn-live");
    expect(ref).toMatchObject({ archived: false, unanchored: true });
    expect(ref?.content).toEqual(BODY);
  });

  it("ensureRef captures before the atom is gone; it is idempotent and flag-free", async () => {
    beginDocPipeline(DOC);
    let atomPresent = true;
    const resolve = (id: string) => (atomPresent ? liveBody(id) : null);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, resolve));
    await flushLoad();

    let ok = false;
    act(() => { ok = result.current.ensureRef("fn-live"); });
    expect(ok).toBe(true);
    const nWrites = writes.length;
    const ref = lastFootnotes()?.footnotes[0];
    expect(ref?.archived).toBeUndefined();
    expect(ref?.unanchored).toBeUndefined();

    // The atom is spliced out — the ref already holds the body, so a second
    // ensure (and the archive flag after it) still lands, with no extra mint.
    atomPresent = false;
    act(() => { ok = result.current.ensureRef("fn-live"); });
    expect(ok).toBe(true);
    expect(writes.length).toBe(nWrites);
    act(() => { result.current.setArchived("fn-live", true); });
    expect(lastFootnotes()?.footnotes[0]).toMatchObject({ archived: true, content: BODY });
  });

  it("refuses (no write) when there is no atom to capture from", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    let ok = true;
    act(() => { ok = result.current.ensureRef("fn-missing"); });
    expect(ok).toBe(false);
    act(() => { ok = result.current.setArchived("fn-missing", true); });
    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("refuses with no resolver", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC));
    await flushLoad();
    let ok = true;
    act(() => { ok = result.current.ensureRef("fn-live"); });
    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("refuses BEFORE the sidecar has loaded — never mints over the pre-load EMPTY", async () => {
    beginDocPipeline(DOC);
    gateReads = true;
    DISK["footnotes.json"] = {
      footnotes: [{ id: "fn-disk", content: BODY, createdAt: "2026-01-01T00:00:00.000Z" }],
    } satisfies FootnotesState;
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    let ok = true;
    act(() => { ok = result.current.ensureRef("fn-live"); });
    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);

    // Once the read lands, the same capture succeeds and KEEPS the disk ref.
    await act(async () => { releaseRead?.(); });
    await flushLoad();
    act(() => { ok = result.current.ensureRef("fn-live"); });
    expect(ok).toBe(true);
    expect(lastFootnotes()?.footnotes.map((f) => f.id)).toEqual(["fn-disk", "fn-live"]);
  });

  it("the AI-request flag lands on a ref-less footnote (the checkbox can show it) and clears", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    act(() => { result.current.setFootnoteAiRequest("fn-live", true); });
    expect(result.current.footnoteRefs.find((f) => f.id === "fn-live")?.aiRequest).toBe(true);
    // The bridge received the captured ref (legible summary, not "<footnote>").
    expect(bridgeCalls.at(-1)?.[5]).toMatchObject({ id: "fn-live", content: BODY });

    act(() => { result.current.setFootnoteAiRequest("fn-live", false); });
    expect(result.current.footnoteRefs.find((f) => f.id === "fn-live")?.aiRequest).toBe(false);
  });

  it("a body edit on a ref-less footnote seeds the ref from the edit itself", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC));
    await flushLoad();

    const edited = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }],
    };
    act(() => { result.current.updateFootnoteContent("fn-new", edited); });
    expect(lastFootnotes()?.footnotes).toEqual([
      expect.objectContaining({ id: "fn-new", content: edited }),
    ]);
  });
});

// Census leg: the archive door in EditorPane CAPTURES before it DELETES, and
// refuses (returns before any splice) when the capture fails. The hook-level
// legs above prove `ensureRef` answers honestly; this pins that the one
// production splice-and-archive path asks it first.
import { readFileSync } from "node:fs";
import path from "node:path";

describe("census · spliceAndArchiveAtom captures before it deletes (task 703)", () => {
  it("ensureRef gates the footnote branch ahead of the orphan suppression and the delete", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../components/EditorPane.tsx"),
      "utf8",
    );
    const start = src.indexOf("const spliceAndArchiveAtom = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n  );\n", start));
    const branch = body.slice(body.indexOf('if (kind === "footnote")'));
    const iEnsure = branch.indexOf("footnotesHook.ensureRef(id)");
    const iReturn = branch.indexOf("return;", iEnsure);
    const iSuppress = branch.indexOf("archivedSuppressRef.current.add(id)");
    const iDelete = branch.indexOf("innerRef.current?.deleteFootnote(id)");
    expect(iEnsure).toBeGreaterThan(-1);
    expect(branch.slice(iEnsure - 20, iEnsure)).toContain("!");
    expect(iReturn).toBeGreaterThan(iEnsure);
    expect(iReturn).toBeLessThan(iSuppress);
    expect(iSuppress).toBeLessThan(iDelete);
  });
});
