// @vitest-environment jsdom
//
// Task 721 — the duplicate/delete cascade reaches EVERY Mode-B kind, not the
// six somebody remembered.
//
// The walkers contain zero per-kind branches: `duplicateSlice` reads a
// `linkedAnchor` mark's `linkCard` and calls `lifecycle.get(kind).clone(id)`;
// `cleanupLinksInRange` does the same with `.delete(id)`. So "is this kind in
// the cascade?" is decided entirely by whether the per-doc registry has an
// entry for it — and for todo / report / report-request it did not, because
// their `CARD_REGISTRY` rows declared the cascade permanently off on the
// premise that they carry no text-range anchor. They do: `carriesModeBAnchor`
// is true for all three, derived from `anchored` + the crosswalk's
// `legacyDataKind`, and it is the MARK the walker finds, never the flag.
//
// The visible defect: duplicating a passage carried its note and dropped its
// todo/report — the clone's mark was STRIPPED (`missing-card-on-mark`), so the
// copy had no apparatus and no anchor at all.
//
// This suite drives the real `duplicateSlice` over a mark-bearing paragraph for
// every Mode-B kind, through a registry built from the DECLARATIONS — so it is
// the declaration, not a hand-list, that decides whether each kind passes. It
// failed for exactly the three kinds before the flags flipped.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  duplicateSlice,
  createDuplicateDiagnostics,
} from "@/text-objects/duplicate-slice";
import type {
  CardLifecycleApi,
  CardLifecycleRegistry,
} from "@/panels/card-lifecycle-registry";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";
import { MODE_B_CARD_KINDS } from "@/cards/mode-b-collections";
import { linkCardKey, parseLinkCardKey } from "@/links/link-dom-contract";
import type { CardKind } from "@/cards/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const mounted: Editor[] = [];
function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

/** A registry that serves EXACTLY what `CARD_REGISTRY` declares — the same
 *  shape `assertLifecycleCoverage` demands of the live one. Clones mint
 *  `<id>-copy` and record the call. */
function declaredRegistry(): {
  api: CardLifecycleApi;
  cloned: { kind: CardKind; id: string }[];
} {
  const cloned: { kind: CardKind; id: string }[] = [];
  const reg: CardLifecycleRegistry = {};
  for (const k of CARD_KINDS) {
    const d = CARD_REGISTRY[k].lifecycle;
    if (!d.clone && !d.delete && !d.bindAnchor) continue;
    reg[k] = {
      ...(d.clone
        ? {
            clone: (id: string) => {
              cloned.push({ kind: k, id });
              return `${id}-copy`;
            },
          }
        : { clone: () => null }),
      delete: () => {},
      ...(d.bindAnchor ? { bindAnchor: () => {} } : {}),
    } as CardLifecycleRegistry[CardKind];
  }
  return { api: { get: (k) => reg[k] ?? null }, cloned };
}

/** One paragraph whose whole text carries a `linkedAnchor` mark naming
 *  `kind:<id>` — the shape every Mode-B card stamps on its anchored span. */
function anchoredParagraph(kind: CardKind, id: string): JSONContent {
  return {
    type: "paragraph",
    attrs: { uuid: "aaaa" },
    content: [
      {
        type: "text",
        text: "the anchored span",
        marks: [
          {
            type: "linkedAnchor",
            attrs: {
              anchorId: "anc-1",
              linkId: "anc-1",
              linkKind: "anchor",
              linkCard: linkCardKey(kind, id),
            },
          },
        ],
      },
    ],
  };
}

/** Duplicate the single paragraph and report the clone's mark, if it survived. */
function duplicateAndReadMark(
  kind: CardKind,
  id: string,
): { linkCard: string | null; warnings: string[] } {
  const editor = mountDoc([anchoredParagraph(kind, id)]);
  const { api } = declaredRegistry();
  const diag = createDuplicateDiagnostics();
  const doc = editor.state.doc;
  const outer = { from: 0, to: doc.child(0).nodeSize };
  const cloned = duplicateSlice(doc.slice(outer.from, outer.to), api, diag);
  const tr = editor.state.tr.replace(outer.to, outer.to, cloned);
  tr.doc.check();
  editor.view.dispatch(tr);

  let linkCard: string | null = null;
  const copy = editor.state.doc.child(1);
  copy.descendants((n) => {
    const m = n.marks.find((mk) => mk.type.name === "linkedAnchor");
    if (m) linkCard = String(m.attrs.linkCard ?? "");
    return true;
  });
  return {
    linkCard,
    warnings: [...diag.codes],
  };
}

describe("duplicate cascade reaches every Mode-B kind (task 721)", () => {
  it.each([...MODE_B_CARD_KINDS])(
    "%s: the clone keeps its anchor and points at a CLONED card",
    (kind) => {
      const { linkCard, warnings } = duplicateAndReadMark(kind, "card-1");
      expect(
        warnings,
        `${kind}: the walker could not clone the card, so it stripped the ` +
          "clone's anchor — the copy lands with no apparatus at all.",
      ).toEqual([]);
      expect(linkCard, `${kind}: the clone lost its linkedAnchor mark`).toBeTruthy();
      const parsed = parseLinkCardKey(linkCard!);
      expect(parsed?.kind).toBe(kind);
      // A FRESH card id — never the source's, which would make two anchors
      // compete for one card.
      expect(parsed?.id).toBe("card-1-copy");
    },
  );

  it("the three kinds this task added are genuinely in the set", () => {
    // Guards the leg above against becoming vacuous if the derivation shrinks.
    for (const k of ["todo", "report", "report-request"] as const) {
      expect(MODE_B_CARD_KINDS).toContain(k);
    }
  });
});
