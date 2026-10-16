// @vitest-environment jsdom
//
// Task 1142 — "did the bib write LAND" is ONE positive question
// (`didBibWriteLand`), not a blacklist of the refusals known at the time.
//
// `saveBibEntry` gated a rename's fan-out on `failed || not-found`, so the
// three other refusal kinds `mutateProjectBib` answers — `read-only` (a library
// paper's `.bib`), `no-handle`, `stale` — fell through: every `\cite{oldKey}`
// in the paper was rewritten to `newKey` while `references.bib` still said
// `oldKey`. And `runBibMutation` re-read the file only on those same two
// kinds, so the optimistic preview of an edit that landed nowhere stood as
// truth (task 685's phantom by another road).
//
// Pins:
//  - a rename answered read-only / no-handle / stale fans out to NOTHING (no
//    cascade migrator, no sidecar-ref rewrite) and the view reconciles to the
//    file; answered `written`, it fans out;
//  - an add answered read-only leaves the view equal to the file.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", async () => {
  const { mockStorageModule } = await import("@/lib/__tests__/_mock-storage");
  const { bibDisk } = await import("@/lib/__tests__/_bib-disk");
  const { vi: v } = await import("vitest");
  return mockStorageModule({
    readSidecar: v.fn(async () => ({})),
    readSidecarIfExists: v.fn(async () => ({})),
    ...bibDisk("@article{foo,\n  title = {A}\n}\n"),
  });
});

/** What the next `mutateProjectBib` answers; `null` = the real door. */
const answer: { kind: "read-only" | "no-handle" | "stale" | null } = { kind: null };

vi.mock("@/lib/project-bib", async () => {
  const actual = await vi.importActual<typeof import("@/lib/project-bib")>(
    "@/lib/project-bib",
  );
  return {
    ...actual,
    mutateProjectBib: vi.fn(
      async (...args: Parameters<typeof actual.mutateProjectBib>) =>
        answer.kind ? { kind: answer.kind } : actual.mutateProjectBib(...args),
    ),
  };
});

import { useCitations } from "../useCitations";
import { isRenameCitekey } from "@/lib/identity/identity-cascade";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { namedBibEntry } from "@/lib/bib-test-entry";
import { resetBibDisk } from "@/lib/__tests__/_bib-disk";
import type { BibEntry } from "@/lib/types";

const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  __resetForTests();
  resetBibDisk();
  answer.kind = null;
});

async function mountCiting(docId: string) {
  beginDocPipeline(docId);
  const { result } = renderHook(() => useCitations(docId));
  await waitFor(() => {
    expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
  });
  const fanned: string[] = [];
  let id = "";
  act(() => {
    result.current.identityCascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) {
        fanned.push(`${c.renameCitekey.oldKey}->${c.renameCitekey.newKey}`);
      }
    });
    id = result.current.addCitation("\\cite{foo}").id;
  });
  await waitFor(() => {
    expect(result.current.citations.some((c) => c.id === id)).toBe(true);
  });
  return { result, fanned, id };
}

describe("a citekey rename fans out ONLY over a write that landed", () => {
  it.each(["read-only", "no-handle", "stale"] as const)(
    "answered `%s`: no \\cite{} rewrite, no cascade, the view reconciles to the file",
    async (kind) => {
      const { result, fanned, id } = await mountCiting(`doc-1142-${kind}`);
      answer.kind = kind;
      act(() => {
        result.current.updateBibKeyAndType(
          namedBibEntry(result.current.bibEntries, "foo"),
          "newfoo",
          "article",
        );
      });
      await act(settle);
      expect(fanned).toEqual([]);
      expect(result.current.citations.find((c) => c.id === id)?.keys).toEqual(["foo"]);
      // The optimistic `newfoo` preview is corrected: the file never had it.
      await waitFor(() => {
        expect(result.current.bibEntries.map((e) => e.key)).toEqual(["foo"]);
      });
    },
  );

  it("answered `written`: the rename fans out", async () => {
    const { result, fanned, id } = await mountCiting("doc-1142-written");
    act(() => {
      result.current.updateBibKeyAndType(
        namedBibEntry(result.current.bibEntries, "foo"),
        "newfoo",
        "article",
      );
    });
    await waitFor(() => {
      expect(fanned).toEqual(["foo->newfoo"]);
      expect(result.current.citations.find((c) => c.id === id)?.keys).toEqual(["newfoo"]);
    });
  });
});

describe("an add that did not land leaves no phantom", () => {
  it("an addBibEntry answered `read-only` leaves the view equal to the file", async () => {
    beginDocPipeline("doc-1142-add");
    const { result } = renderHook(() => useCitations("doc-1142-add"));
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
    });
    answer.kind = "read-only";
    act(() => {
      result.current.addBibEntry({
        uid: "",
        key: "bar",
        type: "article",
        fields: { title: "Never written" },
        raw: "",
      } as BibEntry);
    });
    await act(settle);
    await waitFor(() => {
      expect(result.current.bibEntries.map((e) => e.key)).toEqual(["foo"]);
    });
  });
});
