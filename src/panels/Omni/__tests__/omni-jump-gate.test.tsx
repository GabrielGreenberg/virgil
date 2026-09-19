// @vitest-environment jsdom
//
// Task 655 — **the omni surface's Jump gate, decided once.**
//
// `OmniAnchorRow` published two different facts and the six paragraph-anchored
// builders did not agree on which one gated the Jump button:
//
//   - `anchored` — the task-369 anchor authority's verdict PLUS a resolved
//     position ("this row sits on a live paragraph");
//   - `anchorUuid` — merely "the card STORES an anchor", which is equally true
//     of a card whose anchor is dead.
//
// Archive gated on the first. Notes, Todo, Revisions, Cutter and Reports gated
// on the second — each panel's own pre-369 rule, kept byte-for-byte when task
// 369 unified WHERE a card is anchored and deliberately declined to renegotiate
// the affordance inside a refactor. The two predicates differ for exactly one
// card: one whose stored anchor is UNRECOVERABLE. Those five painted a Jump
// that `jumpToCard` resolves to nothing — the user presses a control and the
// app does nothing, silently. The false-affordance class (task 136 for
// `citation`, 277 for `footnote`, 435 for the archive float).
//
// The fix is not five call sites: it is that a builder was handed a BOOLEAN at
// all. The row now carries `withJump`, so the builder hands over its callback
// and gets back either the callback or `undefined`; there is no predicate left
// to choose. The behavioural legs below drive the REAL builders, and the leg
// with TEETH is the CENSUS — the rule was never the part that could misbehave,
// a seventh builder picking its own predicate is.
//
// Why every leg is a MULTI-panel sweep: the defect was the DISAGREEMENT, so a
// leg that asserts one panel cannot see it. Pre-fix, the dead-anchor sweep
// fails on five panels and passes on Archive — that asymmetry IS the finding.

import { describe, it, expect, vi } from "vitest";

// The omni builders import card components whose barrel transitively pulls in
// `@/lib/storage`, which `require()`s `@/lib/storage-fsa` — a path vitest's
// resolver can't alias. (See memory: vitest_extension_barrel_storage_mock.md)
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import type { OmniItem } from "@/panels/_shared/types";
import type { Link } from "@/links/_shared/types";
import {
  resolveCardAnchorRows,
  type CardAnchorResolver,
} from "@/links/card-anchor-rows";
import type { ResolveIndex } from "@/links/resolve-card-anchor";
import { buildNoteOmniItems } from "@/panels/Notes/omni";
import { buildTodoOmniItems } from "@/panels/Todo/omni";
import { buildRevisionOmniItems } from "@/panels/Revisions/omni";
import { buildCutterOmniItems } from "@/panels/Cutter/omni";
import { buildReportsOmniItems } from "@/panels/Reports/omni";
import { buildArchiveOmniItems } from "@/panels/Archive/omni";
import { codeOnly, trackedFiles, REPO_ROOT } from "@/lib/__tests__/_source-scan";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const noop = () => {};
const noopId = (_id: string | null) => {};

/** The one live paragraph in every fixture below. */
const LIVE = "live-uuid";
/** A stored pid no paragraph carries and no snapshot recovers. */
const DEAD = "dead-uuid";

/** Adapt a synthetic live-uuid→pos map onto the REAL card-anchor authority —
 *  so a "dead" anchor here is dead by the four-rung ladder's own verdict, not
 *  by a stub that hard-codes the answer the test wants. */
function rowsFrom(live: Record<string, number>): CardAnchorResolver {
  const index: ResolveIndex = {
    uuidToParagraph: new Set(Object.keys(live)),
    uuidToPos: new Map(Object.entries(live)),
    anchorIdToParagraph: new Map(),
    snapshotToParagraph: () => null,
  };
  return (card) => resolveCardAnchorRows(card, null, index);
}

const RESOLVE = rowsFrom({ [LIVE]: 42 });

function paraLink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const AT = "2026-01-01T00:00:00.000Z";
const body = { type: "doc", content: [] };

/** The Jump handler the builder handed the card component, or `undefined`. */
function onJumpOf(item: OmniItem): unknown {
  return (item.content as ReactElement<{ onJump?: unknown }>).props.onJump;
}

// ─── the six REAL builders, each over one card anchored to `uuid` ────────────

type Build = (uuid: string) => OmniItem[];

const BUILDERS: Array<[label: string, build: Build]> = [
  [
    "Notes · note",
    (uuid) =>
      buildNoteOmniItems({
        cards: [
          {
            kind: "note",
            id: "n1",
            title: "",
            content: body,
            createdAt: AT,
            aiRequest: false,
            links: [paraLink(uuid)],
          },
        ],
        selectedNoteId: null,
        setSelectedNoteId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        updateNote: noop,
        updateNoteTitle: noop,
        setNoteAiRequest: noop,
        setHighlightAiRequest: noop,
        convertCard: noop,
        deleteNote: noop,
        setOverrideEditor: noop,
        getCitationDisplayText: () => "",
        onCitationCreated: () => null,
      }),
  ],
  [
    "Notes · highlight",
    (uuid) =>
      buildNoteOmniItems({
        cards: [
          {
            kind: "highlight",
            id: "h1",
            text: "hl",
            color: "yellow",
            createdAt: AT,
            aiRequest: false,
            links: [paraLink(uuid)],
          } as never,
        ],
        selectedNoteId: null,
        setSelectedNoteId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        updateNote: noop,
        updateNoteTitle: noop,
        setNoteAiRequest: noop,
        setHighlightAiRequest: noop,
        convertCard: noop,
        deleteNote: noop,
        setOverrideEditor: noop,
        getCitationDisplayText: () => "",
        onCitationCreated: () => null,
      }),
  ],
  [
    "Todo",
    (uuid) =>
      buildTodoOmniItems({
        todoItems: [
          {
            id: "t1",
            text: "do it",
            notes: "",
            done: false,
            aiRequest: false,
            createdAt: AT,
            links: [paraLink(uuid)],
          },
        ],
        selectedTodoId: null,
        setSelectedTodoId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        toggleTodo: noop,
        updateTodo: noop,
        updateTodoNotes: noop,
        setTodoAiRequest: noop,
        deleteTodo: noop,
      }),
  ],
  [
    "Revisions · comment",
    (uuid) =>
      buildRevisionOmniItems({
        cards: [
          {
            kind: "comment",
            id: "rc1",
            createdAt: AT,
            text: "",
            content: body,
            aiRequest: false,
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        editor: null,
        updateCommentContent: noop,
        setCommentAiRequest: noop,
        updateSuggestionField: noop,
        acceptSuggestion: noop,
        rejectSuggestion: noop,
        convertCard: noop,
        deleteCard: noop,
      }),
  ],
  [
    "Revisions · suggestion",
    (uuid) =>
      buildRevisionOmniItems({
        cards: [
          {
            kind: "suggestion",
            id: "rs1",
            createdAt: AT,
            author: "ai",
            original_text: "a",
            suggested_text: "b",
            explanation: "",
            user_text: "",
            instructions: "",
            status: "pending",
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        editor: null,
        updateCommentContent: noop,
        setCommentAiRequest: noop,
        updateSuggestionField: noop,
        acceptSuggestion: noop,
        rejectSuggestion: noop,
        convertCard: noop,
        deleteCard: noop,
      }),
  ],
  [
    "Cutter · comment",
    (uuid) =>
      buildCutterOmniItems({
        cards: [
          {
            kind: "comment",
            id: "cc1",
            createdAt: AT,
            text: "",
            content: body,
            aiRequest: false,
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        editor: null,
        updateCommentContent: noop,
        setCommentAiRequest: noop,
        updateSuggestionField: noop,
        acceptSuggestion: noop,
        rejectSuggestion: noop,
        convertCard: noop,
        deleteCard: noop,
      }),
  ],
  [
    "Cutter · suggestion",
    (uuid) =>
      buildCutterOmniItems({
        cards: [
          {
            kind: "suggestion",
            id: "cs1",
            createdAt: AT,
            author: "ai",
            original_text: "a",
            suggested_text: "b",
            explanation: "",
            user_text: "",
            instructions: "",
            status: "pending",
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        editor: null,
        updateCommentContent: noop,
        setCommentAiRequest: noop,
        updateSuggestionField: noop,
        acceptSuggestion: noop,
        rejectSuggestion: noop,
        convertCard: noop,
        deleteCard: noop,
      }),
  ],
  [
    "Reports · report",
    (uuid) =>
      buildReportsOmniItems({
        cards: [
          {
            kind: "report",
            id: "rp1",
            createdAt: AT,
            author: "ai",
            title: "",
            text: "",
            content: body,
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        updateReportContent: noop,
        updateReportTitle: noop,
        updateRequestContent: noop,
        setRequestAiRequest: noop,
        convertCard: noop,
        deleteCard: noop,
        setOverrideEditor: noop,
        getCitationDisplayText: () => "",
        onCitationCreated: () => null,
      }),
  ],
  [
    "Reports · request",
    (uuid) =>
      buildReportsOmniItems({
        cards: [
          {
            kind: "report-request",
            id: "rr1",
            createdAt: AT,
            text: "",
            content: body,
            aiRequest: false,
            links: [paraLink(uuid)],
          },
        ],
        selectedId: null,
        setSelectedId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        updateReportContent: noop,
        updateReportTitle: noop,
        updateRequestContent: noop,
        setRequestAiRequest: noop,
        convertCard: noop,
        deleteCard: noop,
        setOverrideEditor: noop,
        getCitationDisplayText: () => "",
        onCitationCreated: () => null,
      }),
  ],
  [
    "Archive",
    (uuid) =>
      buildArchiveOmniItems({
        archiveSnippets: [
          {
            id: "a1",
            title: "",
            content: body as never,
            createdAt: AT,
            links: [paraLink(uuid)],
          },
        ],
        selectedArchiveId: null,
        setSelectedArchiveId: noopId,
        jumpToCard: noop,
        resolveCardRows: RESOLVE,
        updateArchiveSnippet: noop,
        updateArchiveSnippetTitle: noop,
        handleDeleteArchive: noop,
        setOverrideEditor: noop,
        getCitationDisplayText: () => "",
        onCitationCreated: () => null,
      }),
  ],
];

describe("task 655 — an unrecoverable anchor offers no Jump, in every builder", () => {
  it.each(BUILDERS)(
    "%s: a DEAD stored anchor gets no Jump handler",
    (_label, build) => {
      const items = build(DEAD);
      expect(items).toHaveLength(1);
      // The row still SURFACES (task 369: surface, don't cull) …
      expect(items[0].anchorUuid).toBe(DEAD);
      expect(items[0].anchorState).toBe("orphaned");
      // … it just no longer offers a control that cannot work.
      expect(onJumpOf(items[0])).toBeUndefined();
    },
  );

  it.each(BUILDERS)(
    "%s: a LIVE anchor still gets one (the fix withdraws nothing real)",
    (_label, build) => {
      const items = build(LIVE);
      expect(items).toHaveLength(1);
      expect(items[0].anchorState).toBe("anchored");
      expect(typeof onJumpOf(items[0])).toBe("function");
    },
  );

  it("the sweep is non-vacuous: the two anchors really do classify apart", () => {
    // Guards the fixture, not the fix — if `rowsFrom` ever stopped making DEAD
    // dead, every leg above would pass for the wrong reason.
    const dead = resolveCardAnchorRows(
      { links: [paraLink(DEAD)] } as never,
      null,
      {
        uuidToParagraph: new Set([LIVE]),
        uuidToPos: new Map([[LIVE, 42]]),
        anchorIdToParagraph: new Map(),
        snapshotToParagraph: () => null,
      },
    );
    expect(dead.anchored).toBe(false);
    expect(dead.rows).toHaveLength(1);
    expect(dead.rows[0].pid).toBe(DEAD);
  });
});

describe("task 655 — census: the gate is decided in ONE file", () => {
  /** Every omni builder that reads the paragraph-anchor authority, DISCOVERED
   *  from the tree — so a seventh one cannot slip the census by not being
   *  listed here. */
  const GATED = trackedFiles("src/panels", /^omni\.tsx$/)
    .map((abs) => relative(REPO_ROOT, abs))
    .filter((rel) => read(rel).includes("buildOmniAnchorRows"));

  it("discovers exactly the six paragraph-anchored builders", () => {
    expect(new Set(GATED)).toEqual(
      new Set([
        "src/panels/Notes/omni.tsx",
        "src/panels/Todo/omni.tsx",
        "src/panels/Revisions/omni.tsx",
        "src/panels/Cutter/omni.tsx",
        "src/panels/Reports/omni.tsx",
        "src/panels/Archive/omni.tsx",
      ]),
    );
  });

  it.each(GATED)("%s routes every Jump through the row's gate", (rel) => {
    const src = codeOnly(read(rel));
    // The shared door is used …
    expect(src).toMatch(/row\.withJump\(/);
    // … and every `onJump` binding is either that call or the local it names.
    const bindings = [...src.matchAll(/onJump=\{([^}]*)/g)].map((m) =>
      m[1].trim(),
    );
    expect(bindings.length).toBeGreaterThan(0);
    for (const b of bindings) {
      expect(b === "onJump" || b.startsWith("row.withJump(")).toBe(true);
    }
  });

  it.each(GATED)("%s re-derives no Jump predicate of its own", (rel) => {
    const src = codeOnly(read(rel));
    // The two shapes the five wrong builders used, and the correct-but-restated
    // one Archive used. None of them may reappear: the answer is the row's.
    expect(src).not.toMatch(/anchorUuid\s*!=/);
    expect(src).not.toMatch(/rows\.some\(/);
    expect(src).not.toMatch(/row\.anchored\s*\?/);
  });

  it("the row module decides it, from the RESOLVED witness", () => {
    const src = codeOnly(read("src/panels/_shared/omni-anchor-rows.ts"));
    expect(src).toMatch(/withJump:\s*<H>\(handler: H\) => H \| undefined/);
    // Eligibility is the resolved witness — never the stored pid.
    expect(src).toMatch(/const canJump = witness != null;/);
    expect(src).toMatch(/withJump: canJump \? PASS_JUMP : NO_JUMP/);
    // A card with no stored anchor at all cannot jump either.
    expect(src).toMatch(/withJump: NO_JUMP/);
  });
});
