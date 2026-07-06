/**
 * Task 069 — a bib entry's user-authored annotation lives in a separate
 * per-doc `annotations.json` sidecar, NOT on the `BibEntry`. The Stack
 * snapshot must therefore carry it explicitly, or a cross-doc pull drops it
 * silently. These tests pin the SNAPSHOT half of the fix: `snapshotCard`
 * resolves the annotation via `ctx.getAnnotation` and attaches it to the
 * bibliography card (and per-key to a citation's side-channelled entries).
 * The restore half (re-attach via `setAnnotation` on pull) is covered by
 * `components/drop-mode/__tests__/stack-pull-bib-annotation.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { snapshotCard } from "../snapshot";
import type { StackCardSnapshot } from "../types";
import type { BibEntry, CitationRef } from "@/lib/types";

const SOURCE = { docId: "docA", docTitle: "Doc A" };

function bibEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    uid: "uid-smith",
    key: "smith2020",
    type: "article",
    fields: { title: "On Annotation", author: "Smith" },
    raw: "@article{smith2020, title={On Annotation}}",
    ...overrides,
  };
}

/** Narrow a snapshot item to its card, failing loudly if it's not a card. */
function cardOf(item: ReturnType<typeof snapshotCard>): StackCardSnapshot {
  expect(item).not.toBeNull();
  expect(item!.payload.kind).toBe("card");
  if (item!.payload.kind !== "card") throw new Error("not a card payload");
  return item!.payload.card;
}

describe("snapshotCard — bibliography annotation (task 069)", () => {
  it("carries the entry's annotation when the ctx resolves one", () => {
    const html = "<p>Key source for §2.</p>";
    const card = cardOf(
      snapshotCard("bibliography", bibEntry(), SOURCE, {
        getAnnotation: (k) => (k === "smith2020" ? html : ""),
      }),
    );
    expect(card.cardKind).toBe("bibliography");
    if (card.cardKind !== "bibliography") throw new Error("kind");
    expect(card.annotation).toBe(html);
    // The BibEntry itself is unchanged (annotation lives beside it).
    expect(card.data.key).toBe("smith2020");
  });

  it("omits the annotation field when there is none (no spurious empty)", () => {
    const emptyCtx = cardOf(
      snapshotCard("bibliography", bibEntry(), SOURCE, {
        getAnnotation: () => "",
      }),
    );
    if (emptyCtx.cardKind !== "bibliography") throw new Error("kind");
    expect("annotation" in emptyCtx).toBe(false);

    // ...and when no ctx / resolver is supplied at all.
    const noCtx = cardOf(snapshotCard("bibliography", bibEntry(), SOURCE));
    if (noCtx.cardKind !== "bibliography") throw new Error("kind");
    expect("annotation" in noCtx).toBe(false);
  });
});

describe("snapshotCard — citation bib annotations (task 069 cluster)", () => {
  const cit: CitationRef = {
    id: "cit-1",
    command: "\\citep{smith2020,jones1990}",
    keys: ["smith2020", "jones1990"],
    createdAt: "2026-07-06T00:00:00.000Z",
  };
  const entries: Record<string, BibEntry> = {
    smith2020: bibEntry(),
    jones1990: bibEntry({ uid: "uid-jones", key: "jones1990" }),
  };

  it("carries a per-key annotation map for the referenced entries", () => {
    const smithNote = "<p>Smith note.</p>";
    const card = cardOf(
      snapshotCard("citation", cit, SOURCE, {
        getBibEntry: (k) => entries[k],
        // Only smith2020 has an annotation; jones1990 has none.
        getAnnotation: (k) => (k === "smith2020" ? smithNote : ""),
      }),
    );
    if (card.cardKind !== "citation") throw new Error("kind");
    expect(card.bibEntries?.map((e) => e.key)).toEqual([
      "smith2020",
      "jones1990",
    ]);
    expect(card.bibAnnotations).toEqual({ smith2020: smithNote });
    // The un-annotated key is absent, not an empty string.
    expect(card.bibAnnotations && "jones1990" in card.bibAnnotations).toBe(
      false,
    );
  });

  it("omits bibAnnotations entirely when no referenced entry has a note", () => {
    const card = cardOf(
      snapshotCard("citation", cit, SOURCE, {
        getBibEntry: (k) => entries[k],
        getAnnotation: () => "",
      }),
    );
    if (card.cardKind !== "citation") throw new Error("kind");
    expect("bibAnnotations" in card).toBe(false);
  });
});
