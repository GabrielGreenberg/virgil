// @vitest-environment jsdom
/**
 * Task 1643 — the two doc-scoped write DOORS publish their in-flight write to
 * the unsaved-work channel.
 *
 * `useAiRequests.applyMutation` and `useCitations.runBibMutation` paint
 * optimistically and then write through `mutateAiRequests` /
 * `mutateProjectBib`. Until 1643 neither door (nor hook) published, so a
 * request the user just filed, or a bib edit, still in flight at a tab close
 * drew no leave prompt. The doors now hold a member of the document's
 * sidecar-writer set from entry to settle — whatever the outcome, because a
 * refusal is reconciled by the CALLER re-reading disk (the optimistic row goes),
 * so nothing unlanded remains in memory to guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let release: (() => void) | null = null;
let fail: Error | null = null;
const gate = () =>
  new Promise<void>((r) => {
    release = r;
  });

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_d: string, _f: string, dflt: unknown) => dflt),
  mutateSidecar: vi.fn(
    async (_h: unknown, _f: string, dflt: unknown, mutate: (c: unknown) => unknown) => {
      await gate();
      if (fail) throw fail;
      return mutate(dflt);
    },
  ),
  mutateBib: vi.fn(async (_h: unknown, mutate: (c: string) => string | null) => {
    await gate();
    if (fail) throw fail;
    return mutate("");
  }),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn((docId: string) => ({ docId })),
  isStalePipelineError: vi.fn(() => false),
}));

import { clearUnsavedWork, getUnsavedWork, hasUnlandedWork } from "@/lib/unsaved-work";
import { mutateAiRequests } from "@/lib/ai-requests-store";
import { mutateProjectBib } from "@/lib/project-bib";
import type { BibEntry } from "@/lib/types";

const DOC = "doc-1643";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearUnsavedWork();
  release = null;
  fail = null;
});

const ENTRY = {
  uid: "u1",
  key: "k1",
  type: "book",
  fields: { title: "T", author: "A, B", year: "2000" },
} as unknown as BibEntry;

const DOORS: [string, () => Promise<{ kind: string }>][] = [
  [
    "mutateAiRequests",
    () =>
      mutateAiRequests(DOC, (prev) => [
        ...prev,
        { id: "r1", kind: "note", status: "pending", text: "x", createdAt: "2026-11-15" } as never,
      ]),
  ],
  ["mutateProjectBib", () => mutateProjectBib(DOC, (prev) => [...prev, ENTRY])],
];

describe.each(DOORS)("%s publishes its in-flight write (task 1643)", (_name, write) => {
  it("DEFECT: the document holds unlanded work from entry until the write lands", async () => {
    expect(hasUnlandedWork(DOC)).toBe(false);
    const pending = write();
    // Synchronous on entry: an optimistic paint just before the call is
    // covered in the same tick.
    expect(hasUnlandedWork(DOC)).toBe(true);
    // It is SIDECAR work, never the model's.
    expect(getUnsavedWork(DOC)?.dirtySince).toBeNull();
    await flush();
    expect(hasUnlandedWork(DOC)).toBe(true);
    release!();
    const result = await pending;
    expect(result.kind).toBe("written");
    expect(hasUnlandedWork(DOC)).toBe(false);
  });

  it("a REFUSED write settles the door's membership (the caller reconciles from disk)", async () => {
    fail = new Error("permission lost");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = write();
    expect(hasUnlandedWork(DOC)).toBe(true);
    await flush();
    release!();
    const result = await pending;
    err.mockRestore();
    expect(result.kind).toBe("failed");
    expect(hasUnlandedWork(DOC)).toBe(false);
  });

  it("overlapping writes: the first landing does not clear the second", async () => {
    const releases: (() => void)[] = [];
    const a = write();
    await flush();
    releases.push(release!);
    const b = write();
    await flush();
    releases.push(release!);
    releases[0]();
    await a;
    expect(hasUnlandedWork(DOC)).toBe(true);
    releases[1]();
    await b;
    expect(hasUnlandedWork(DOC)).toBe(false);
  });
});

it("a null docId publishes nothing", async () => {
  expect((await mutateAiRequests(null, () => null)).kind).toBe("no-handle");
  expect((await mutateProjectBib(null, () => null)).kind).toBe("no-handle");
  expect(getUnsavedWork(DOC)).toBeNull();
});
