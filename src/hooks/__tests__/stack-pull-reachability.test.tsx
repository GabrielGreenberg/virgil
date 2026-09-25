// @vitest-environment jsdom
/**
 * Task 754 — a pulled card must be REACHABLE, not merely saved.
 *
 * `stack-pull-seed-doors.test.tsx` proves what TRAVELS. This proves the record
 * that lands can be SEEN: a footnote pulled into a gap used to reach
 * `footnotes.json` and no list at all — the pull is `GAP_ONLY`, synthesizes no
 * `\footnote` atom, and every reader of atomless refs goes through
 * `selectAtomlessFootnoteRefs`, which keeps only refs declaring
 * `archived || unanchored`. The door set neither flag, so the Footnotes panel,
 * Omni and the float all filtered the user's text out, with no way to pop,
 * re-place or delete it from the UI.
 *
 * The census is TOTAL over `StackCardKind`: every stackable kind states how a
 * gap-landed pull is found by its own list, or why the question is not this
 * suite's. Each row drives the REAL hook door the way `EditorPane`'s
 * `dropStackApi` wires it, with the placement a gap landing produces
 * (`paragraphId: null`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(
    {},
    { stub: () => vi.fn().mockResolvedValue(null) },
  ),
);
vi.mock("@/lib/ai-request-bridge", () => ({
  bridgeCardAiRequestFlag: vi.fn().mockResolvedValue(undefined),
  bridgeFlagForCard: vi.fn(),
}));

import { STACK_CARD_KINDS, type StackCardKind } from "@/lib/stack/card-kinds";
import { pullSeed } from "@/lib/stack/pull-seed";
import { POPULATED_SNAPSHOT_DATA } from "@/lib/stack/__tests__/_pull-fixtures";
import { CARD_PLACEMENTS } from "@/components/drop-mode/specs/stack-pull";
import { selectAtomlessFootnoteRefs } from "@/panels/Footnotes/atomless-refs";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { useNotes } from "../useNotes";
import { useTodos } from "../useTodos";
import { useArchive } from "../useArchive";
import { useRevisions } from "../useRevisions";
import { useCutter } from "../useCutter";
import { useFootnotes } from "../useFootnotes";
import { useCitations } from "../useCitations";

const DOC = "doc-b";

function seedFor<K extends StackCardKind>(kind: K) {
  return pullSeed(kind, POPULATED_SNAPSHOT_DATA[kind] as never);
}

type Rec = { id: string; archived?: boolean };
type Api = Record<string, unknown>;

/**
 * Land through a margin-card door and assert the record is in the hook's own
 * collection (the list its panel renders) and not filed as archived. A
 * gap-landed margin card may read free OR orphaned — both render — so the
 * collection, not an anchor flag, is the reachability question for these.
 */
function margin(
  useHook: (docId: string) => unknown,
  land: (api: Api) => unknown,
  list: string,
): Row {
  return {
    land: () => {
      const { result } = renderHook(() => useHook(DOC) as Api);
      let rec!: Rec;
      act(() => {
        rec = land(result.current) as Rec;
      });
      expect(rec.archived, "a pulled card must not land archived").toBeFalsy();
      const rows = result.current[list] as Rec[];
      expect(rows.map((r) => r.id), `not in ${list}`).toContain(rec.id);
    },
  };
}

type Door = (...a: unknown[]) => unknown;
const call = (api: Api, door: string, ...a: unknown[]) => (api[door] as Door)(...a);

type Row =
  | { land: () => void }
  | { exempt: string };

const CENSUS: Record<StackCardKind, Row> = {
  note: margin(useNotes, (a) => call(a, "addNoteFromSeed", null, seedFor("note")), "notes"),
  highlight: margin(
    useNotes,
    (a) => call(a, "addHighlightFromSeed", null, seedFor("highlight")),
    "highlights",
  ),
  todo: margin(useTodos, (a) => call(a, "addItemFromSeed", seedFor("todo")), "items"),
  archive: margin(
    useArchive,
    (a) => call(a, "archiveFromSeed", null, seedFor("archive")),
    "snippets",
  ),
  "revision-comment": margin(
    useRevisions,
    (a) => call(a, "addCommentFromSeed", null, seedFor("revision-comment")),
    "cards",
  ),
  "revision-suggestion": margin(
    useRevisions,
    (a) => call(a, "addSuggestionFromSeed", null, seedFor("revision-suggestion")),
    "cards",
  ),
  "cutter-comment": margin(
    useCutter,
    (a) => call(a, "addCommentFromSeed", null, seedFor("cutter-comment")),
    "cards",
  ),
  "cutter-suggestion": margin(
    useCutter,
    (a) => call(a, "addSuggestionFromSeed", null, seedFor("cutter-suggestion")),
    "cards",
  ),
  // The bug this suite exists for. The pull lands no atom, so the ref is found
  // only by `selectAtomlessFootnoteRefs` — the ONE selector behind the panel's
  // unanchored cards, Omni and the float fallback.
  footnote: {
    land: () => {
      const { result } = renderHook(() => useFootnotes(DOC));
      let rec!: Rec;
      act(() => {
        rec = result.current.addFootnoteFromSeed(seedFor("footnote")) as Rec;
      });
      const listed = selectAtomlessFootnoteRefs(result.current.footnoteRefs, []);
      expect(
        listed.map((f) => f.id),
        "a pulled footnote is saved but no footnote list selects it",
      ).toContain(rec.id);
    },
  },
  // The twin atom kind: its list is what survives the destination's own
  // reconcile against its live atoms (`syncFromEditor`), which keeps only
  // atomless refs that read unanchored. Driven exactly as `dropStackApi` wires
  // it (`addCitation(command, undefined, true)`).
  citation: {
    land: () => {
      const { result } = renderHook(() => useCitations(DOC));
      let rec!: Rec;
      act(() => {
        rec = result.current.addCitation(
          seedFor("citation").command ?? "",
          undefined,
          true,
        ) as Rec;
      });
      act(() => {
        result.current.syncFromEditor([]);
      });
      expect(result.current.citations.map((c) => c.id)).toContain(rec.id);
      expect(
        result.current.citations.find((c) => c.id === rec.id)?.unanchored,
      ).toBe(true);
    },
  },
  bibliography: {
    exempt:
      "lands a .bib ENTRY, not a card record — its reachability is the bib list, pinned by stack-pull-bib-annotation / stack-content-bib-carry",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  beginDocPipeline(DOC);
});

describe("a gap-landed Stack pull is reachable from its own list (task 754)", () => {
  it("the census covers every stackable kind", () => {
    expect(Object.keys(CENSUS).sort()).toEqual([...STACK_CARD_KINDS].sort());
  });

  it("every GAP_ONLY card-record kind is censused, not exempted", () => {
    // A GAP_ONLY kind can ONLY land atomless/unanchored, so it is exactly the
    // kind this failure hides in; it may not buy its way out with a reason.
    for (const kind of STACK_CARD_KINDS) {
      if (CARD_PLACEMENTS[kind].includes("paragraph-side")) continue;
      if (kind === "bibliography") continue;
      expect("land" in CENSUS[kind], `${kind} is GAP_ONLY and must be censused`).toBe(true);
    }
  });

  for (const kind of STACK_CARD_KINDS) {
    const row = CENSUS[kind];
    if ("exempt" in row) continue;
    it(`${kind}: the pulled record is listed`, () => {
      row.land();
    });
  }
});
