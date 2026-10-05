// @vitest-environment jsdom
/**
 * Task 944 — the library auto-add acts on a key's TRANSITION into the
 * referenced set, never on the level "a cited key is missing from the bib".
 * The level form re-appended master.bib's copy the moment a still-cited key
 * was removed from the paper's references.bib, silently undoing the removal.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoAddLibraryEntriesForCitations } from "../useAutoAddLibraryEntriesForCitations";
import type { BibEntry, CitationRef } from "@/lib/types";

const entry = (key: string): BibEntry =>
  ({ uid: "", key, type: "article", fields: { title: key } }) as unknown as BibEntry;
const cite = (id: string, ...keys: string[]): CitationRef =>
  ({ id, command: `\\cite{${keys.join(",")}}`, keys, createdAt: "" }) as CitationRef;

type Args = Parameters<typeof useAutoAddLibraryEntriesForCitations>[0];

function mount(initial: Omit<Args, "addBibEntry">) {
  const addBibEntry = vi.fn();
  const hook = renderHook((p: Omit<Args, "addBibEntry">) =>
    useAutoAddLibraryEntriesForCitations({ ...p, addBibEntry }), { initialProps: initial });
  return { addBibEntry, rerender: hook.rerender };
}

describe("useAutoAddLibraryEntriesForCitations — edge, not level (task 944)", () => {
  it("removing a still-cited key from the paper bib does NOT re-add it", () => {
    const lib = [entry("k")];
    const { addBibEntry, rerender } = mount({
      citations: [cite("c1", "k")], bibEntries: [entry("k")], libraryEntries: lib,
    });
    expect(addBibEntry).not.toHaveBeenCalled();
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: lib });
    expect(addBibEntry).not.toHaveBeenCalled();
  });

  it("a NEW citation of a library-only key is added exactly once", () => {
    const lib = [entry("k"), entry("j")];
    const { addBibEntry, rerender } = mount({
      citations: [cite("c1", "k")], bibEntries: [entry("k")], libraryEntries: lib,
    });
    rerender({ citations: [cite("c1", "k"), cite("c2", "j")], bibEntries: [entry("k")], libraryEntries: lib });
    expect(addBibEntry).toHaveBeenCalledTimes(1);
    expect(addBibEntry.mock.calls[0][0].key).toBe("j");
    // the bib publish lands; further renders do not re-fire
    rerender({ citations: [cite("c1", "k"), cite("c2", "j")], bibEntries: [entry("k"), entry("j")], libraryEntries: lib });
    // …and removing j afterwards leaves it removed
    rerender({ citations: [cite("c1", "k"), cite("c2", "j")], bibEntries: [entry("k")], libraryEntries: lib });
    expect(addBibEntry).toHaveBeenCalledTimes(1);
  });

  it("open-time fill: a cited library-only key is added once after the sidecar loads", () => {
    const lib = [entry("k")];
    const { addBibEntry, rerender } = mount({ citations: [], bibEntries: [], libraryEntries: [] });
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: [] });
    expect(addBibEntry).not.toHaveBeenCalled();
    // master.bib parses late — the pending key still resolves
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: lib });
    expect(addBibEntry).toHaveBeenCalledTimes(1);
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: [...lib] });
    expect(addBibEntry).toHaveBeenCalledTimes(1);
  });

  it("a late paper-bib read that already holds the key settles it without an add", () => {
    const { addBibEntry, rerender } = mount({ citations: [cite("c1", "k")], bibEntries: [entry("k")], libraryEntries: [] });
    rerender({ citations: [cite("c1", "k")], bibEntries: [entry("k")], libraryEntries: [entry("k")] });
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: [entry("k")] });
    expect(addBibEntry).not.toHaveBeenCalled();
  });

  it("citing a key again after it stopped being cited is a fresh transition", () => {
    const lib = [entry("k")];
    const { addBibEntry, rerender } = mount({ citations: [cite("c1", "k")], bibEntries: [entry("k")], libraryEntries: lib });
    rerender({ citations: [cite("c1", "k")], bibEntries: [], libraryEntries: lib });
    rerender({ citations: [], bibEntries: [], libraryEntries: lib });
    rerender({ citations: [cite("c2", "k")], bibEntries: [], libraryEntries: lib });
    expect(addBibEntry).toHaveBeenCalledTimes(1);
  });
});
