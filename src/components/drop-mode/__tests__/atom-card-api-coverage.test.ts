// @vitest-environment jsdom
/**
 * Task 233 — the coverage contract for the inline-atom card accessors.
 *
 * The defect this pins: `footnoteDropSpec` was registered on `CARD_REGISTRY`
 * and fully reachable from `lookupSpec`, but the ctx accessor its create branch
 * needed was never added — so "anchor the unanchored" built a footnote atom
 * with a hard-coded EMPTY body and destroyed the card's text. Nothing failed.
 * The spec existed, the dispatch worked, the atom was well-formed; only the
 * CONTENT was gone. Its citation twin, written the same week, had the accessor
 * and worked.
 *
 * So "the spec is registered" is not the invariant worth asserting — "the spec
 * can actually GET what it needs" is. The type system now carries most of it
 * (`INLINE_ATOM_CARD_BUILDERS` is a `Record` over the kind union, so a kind
 * declared in `InlineAtomCardAttrs` and left unwired doesn't compile). This
 * test closes the one seam types can't see: the link from a REGISTERED
 * dropSpec's declared `requiresCardApi` to a real, callable builder.
 */

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
// Side-effect import: folds every card kind's DropSpec onto the registry.
import "@/cards/drop-specs";
import {
  INLINE_ATOM_CARD_KINDS,
  buildInlineAtomCardApis,
  type InlineAtomCardApiSources,
} from "../atom-card-apis";

/** Sources that record every call, so the built bag can be exercised. */
function recordingSources() {
  const calls: string[] = [];
  const sources: InlineAtomCardApiSources = {
    footnoteContentFor: (id) => {
      calls.push(`footnoteContentFor:${id}`);
      return { type: "doc", content: [{ type: "paragraph" }] };
    },
    markFootnoteAnchored: (id) => calls.push(`markFootnoteAnchored:${id}`),
    citationCommandFor: (id) => {
      calls.push(`citationCommandFor:${id}`);
      return "\\cite{smith2020}";
    },
    markCitationAnchored: (id) => calls.push(`markCitationAnchored:${id}`),
  };
  return { sources, calls };
}

describe("inline-atom card API coverage (task 233)", () => {
  it("every registered dropSpec that REBUILDS an atom declares where the card's half comes from", () => {
    // THE load-bearing assertion. The pre-233 footnote spec had a create branch
    // and declared nothing — so a guard keyed on "declared but unwired" would
    // have walked straight past it. Key it on the create branch instead.
    const rebuilders = (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
      (k) => CARD_REGISTRY[k].dropSpec?.createsAtom,
    );
    expect(rebuilders.length).toBeGreaterThanOrEqual(2);

    for (const kind of rebuilders) {
      expect(
        CARD_REGISTRY[kind].dropSpec?.requiresCardApi,
        `card kind "${kind}" rebuilds its inline atom ("anchor the unanchored") ` +
          `but declares no ctx accessor — so it can only fill the atom from ` +
          `hard-coded defaults, which is precisely how the footnote lost its ` +
          `body in task 233. Pass \`cardApiKind\` to inlineAtomMoveSpec.`,
      ).toBeTruthy();
    }
  });

  it("every registered dropSpec that DECLARES a ctx requirement has a wired builder", () => {
    const declared = (Object.keys(CARD_REGISTRY) as CardKind[])
      .map((k) => ({ kind: k, needs: CARD_REGISTRY[k].dropSpec?.requiresCardApi }))
      .filter((r): r is { kind: CardKind; needs: NonNullable<typeof r.needs> } => !!r.needs);

    // Non-vacuous: if this drops to zero the assertion below would pass while
    // proving nothing (e.g. a refactor that stopped setting `requiresCardApi`).
    expect(declared.length).toBeGreaterThanOrEqual(2);

    const wired = new Set(INLINE_ATOM_CARD_KINDS);
    for (const { kind, needs } of declared) {
      expect(
        wired.has(needs),
        `card kind "${kind}" declares requiresCardApi="${needs}" but no builder ` +
          `is wired for it — its create branch would silently degrade (this is ` +
          `exactly how the footnote lost its body in task 233).`,
      ).toBe(true);
    }
  });

  it("a spec's declared kind equals the kind it is registered under (no sibling's accessor)", () => {
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      const needs = CARD_REGISTRY[kind].dropSpec?.requiresCardApi;
      if (!needs) continue;
      expect(needs, `"${kind}" declares the "${needs}" accessor`).toBe(kind);
    }
    expect([...INLINE_ATOM_CARD_KINDS].sort()).toEqual(["citation", "footnote"]);
  });

  it("a spec with no create branch declares no requirement (no spurious wiring)", () => {
    // `note` re-anchors to a paragraph side; it has no atom to rebuild.
    expect(CARD_REGISTRY.note.dropSpec?.requiresCardApi).toBeUndefined();
    expect(CARD_REGISTRY.todo.dropSpec?.requiresCardApi).toBeUndefined();
  });

  it("the built bag exposes both halves of the contract for every wired kind", () => {
    const { sources, calls } = recordingSources();
    const apis = buildInlineAtomCardApis(sources);

    for (const kind of INLINE_ATOM_CARD_KINDS) {
      const api = apis[kind];
      expect(api, `no API built for "${kind}"`).toBeTruthy();
      // READ half — resolves without throwing and returns a payload.
      expect(api!.atomAttrsFor("card-1")).toBeTruthy();
      // RECONCILE half — present, so anchoring can clear the parked intent.
      expect(typeof api!.onAnchored).toBe("function");
      api!.onAnchored!("card-1");
    }

    expect(calls).toEqual([
      "footnoteContentFor:card-1",
      "markFootnoteAnchored:card-1",
      "citationCommandFor:card-1",
      "markCitationAnchored:card-1",
    ]);
  });

  it("the footnote accessor never declines — an empty body is a legal footnote", () => {
    // A missing ref (card deleted mid-gesture) must still yield a payload, so
    // the drop the user committed to anchors rather than silently vanishing.
    const apis = buildInlineAtomCardApis({
      footnoteContentFor: () => null,
      markFootnoteAnchored: () => {},
      citationCommandFor: () => null,
      markCitationAnchored: () => {},
    });
    expect(apis.footnote!.atomAttrsFor("missing")).toEqual({
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    // The citation twin DOES pass the null through — its spec declines on it.
    expect(apis.citation!.atomAttrsFor("missing")).toEqual({ command: null });
  });
});
