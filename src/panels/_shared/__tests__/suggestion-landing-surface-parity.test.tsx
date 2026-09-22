// @vitest-environment jsdom
/**
 * Task 684 — **one pending suggestion, one primary action, every surface.**
 *
 * `virgil:pending-changes` is declared `default: true`, so the in-browser
 * propose→apply loop is the LIVE behaviour. But the card's Apply was wired as a
 * per-mount PROP (`onApply`) that only the docked host passed, while the flag
 * authorising it is GLOBAL. So the same card, same flag, same document did
 * three different things:
 *
 *   docked  → spliced the prose in-browser (`applySuggestion`)
 *   omni    → wrote a bare `accepted` status
 *   float   → wrote a bare `accepted` status, and nothing anywhere acted on it
 *
 * and `accepted` is a status the flag-ON card has NO rendering for, so the card
 * went blank while the prose still showed the un-applied text.
 *
 * The fix inverts it the way Keep/Revert were already inverted: every landing
 * verb resolves from the `PendingChangeController` context, and the props are
 * GONE from the card contract. These legs drive the REAL producers — the omni
 * builders and the float registry's own `toFloatable` closures — not a
 * hand-assembled prop bag, because a hand-assembled bag is precisely what could
 * not have caught this.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// panel-primitives / the card-float graph transitively pull `@/lib/storage`
// (the known barrel/storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
// The human 4-field grid mounts real TipTap editors per field. Their presence
// is not what these legs are about — the ACTION ROW under them is.
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/StaticBorrowedText", () => ({
  StaticBorrowedText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
// Registers every poppable kind's `toFloatable` builder (side effect).
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { buildRevisionOmniItems } from "@/panels/Revisions";
import { buildCutterOmniItems } from "@/panels/Cutter";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { CutterSuggestionCard } from "@/panels/Cutter/CutterSuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import {
  resolveCardAnchorRows,
  type CardAnchorResolver,
} from "@/links/card-anchor-rows";
import type { ResolveIndex } from "@/links/resolve-card-anchor";
import type { Link } from "@/links/_shared/types";
import type {
  RevisionSuggestionCard as RevisionSuggestionCardData,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";

const REPO_SRC = join(process.cwd(), "src");

/** The chrome bag `renderBody()` receives. Card bodies ignore both members
 *  (their title is static / a `chromeSlots.title` morph control), so a pair of
 *  inert stand-ins is the faithful card-side call. */
const FLOAT_BODY_CTX = { setTitle: () => {}, windowKey: "float:card:test" };

// ── Fixtures ───────────────────────────────────────────────────────────────

function paraLink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The REAL card-anchor authority over a synthetic live-uuid set (same adapter
 *  the float-jump census uses). */
function resolverWithLive(live: Record<string, number>): CardAnchorResolver {
  const index: ResolveIndex = {
    uuidToParagraph: new Set(Object.keys(live)),
    uuidToPos: new Map(Object.entries(live)),
    anchorIdToParagraph: new Map(),
    snapshotToParagraph: () => null,
  };
  return (card) => resolveCardAnchorRows(card, null, index);
}

/** A HUMAN-authored PENDING suggestion — the one status/author combination that
 *  renders the landing action row (an AI-authored pending card renders the
 *  minimal Insert-below body instead). */
/** TASK 695 — the fixtures are overridable so the SAME real producers (docked
 *  panel / omni builder / float registry) can be driven with a card that cannot
 *  answer Apply. A hand-assembled prop bag would not prove anything about the
 *  surfaces; this drives each one exactly as it ships. */
let cardOverride: Partial<RevisionSuggestionCardData & CutterSuggestionCardData> = {};

function pendingRevision(): RevisionSuggestionCardData {
  return {
    ...pendingRevisionBase(),
    ...cardOverride,
  };
}
function pendingRevisionBase(): RevisionSuggestionCardData {
  return {
    kind: "suggestion",
    id: "rs1",
    createdAt: "2026-07-01T00:00:00.000Z",
    author: "human",
    original_text: "The original sentence.",
    suggested_text: "The revised sentence.",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [paraLink("p1")],
  };
}
function pendingCut(): CutterSuggestionCardData {
  return {
    ...pendingCutBase(),
    ...cardOverride,
  };
}
function pendingCutBase(): CutterSuggestionCardData {
  return {
    kind: "suggestion",
    id: "cs1",
    createdAt: "2026-07-01T00:00:00.000Z",
    author: "human",
    original_text: "The original sentence.",
    suggested_text: "The trimmed sentence.",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [paraLink("p1")],
  };
}

/** A controller with all eight verbs spied. */
function makeController(isOn = true) {
  return {
    isOn,
    apply: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
    insertBelow: vi.fn(),
  };
}

// ── The three REAL surfaces, per family ────────────────────────────────────
//
// `bareStatus` is the spy the omni/float hosts used to hand the card in place of
// a real landing verb. It must stay at zero on every surface under both flag
// positions: the whole defect was a surface quietly writing a status instead of
// doing what the docked panel did.

interface Surface {
  label: string;
  /** The card element as the surface's own producer builds it. */
  el: (bareStatus: () => void) => ReactElement;
  /** Popped-out surfaces render the full body already; docked/omni need the
   *  card expanded for the action row to be in the body at all. */
  expandRef?: { kind: string; id: string };
}

const FAMILIES = [
  {
    family: "revision-suggestion" as const,
    id: "rs1",
    surfaces: [
      {
        label: "docked",
        // What `RevisionsPanel` renders per suggestion row, verbatim — the panel
        // has no landing props left to pass.
        el: () => (
          <RevisionSuggestionCard
            card={pendingRevision()}
            selected={false}
            onUpdateField={() => {}}
            onConvert={() => {}}
            onDelete={() => {}}
            onSelect={() => {}}
          />
        ),
        expandRef: { kind: "revision-suggestion", id: "rs1" },
      },
      {
        label: "omni",
        el: () =>
          buildRevisionOmniItems({
            cards: [pendingRevision()],
            selectedId: null,
            setSelectedId: () => {},
            jumpToCard: () => {},
            resolveCardRows: resolverWithLive({ p1: 3 }),
            editor: null,
            updateCommentContent: () => {},
            setCommentAiRequest: () => {},
            updateSuggestionField: () => {},
            convertCard: () => {},
            deleteCard: () => {},
          })[0].content as ReactElement,
        expandRef: { kind: "revision-suggestion", id: "rs1" },
      },
      {
        label: "float",
        el: (bareStatus: () => void) =>
          CARD_REGISTRY["revision-suggestion"].toFloatable("rs1", {
            comments: [pendingRevision()],
            resolveCardRows: resolverWithLive({ p1: 3 }),
            selectedCommentId: null,
            setSelectedCommentId: () => {},
            updateRevisionSuggestionField: () => {},
            convertRevisionCard: () => {},
            deleteRevisionCard: () => {},
            // The bare status write the float host used to wire onAccept to.
            setRevisionSuggestionStatus: bareStatus,
            editorRef: { current: { jumpToCard: () => {} } },
          } as unknown as CardFloatCtx)!.renderBody(FLOAT_BODY_CTX) as ReactElement,
      },
    ] satisfies Surface[],
  },
  {
    family: "cutter-suggestion" as const,
    id: "cs1",
    surfaces: [
      {
        label: "docked",
        el: () => (
          <CutterSuggestionCard
            card={pendingCut()}
            selected={false}
            onUpdateField={() => {}}
            onConvert={() => {}}
            onDelete={() => {}}
            onSelect={() => {}}
          />
        ),
        expandRef: { kind: "cutter-suggestion", id: "cs1" },
      },
      {
        label: "omni",
        el: () =>
          buildCutterOmniItems({
            cards: [pendingCut()],
            selectedId: null,
            setSelectedId: () => {},
            jumpToCard: () => {},
            resolveCardRows: resolverWithLive({ p1: 3 }),
            editor: null,
            updateCommentContent: () => {},
            setCommentAiRequest: () => {},
            updateSuggestionField: () => {},
            convertCard: () => {},
            deleteCard: () => {},
          })[0].content as ReactElement,
        expandRef: { kind: "cutter-suggestion", id: "cs1" },
      },
      {
        label: "float",
        el: (bareStatus: () => void) =>
          CARD_REGISTRY["cutter-suggestion"].toFloatable("cs1", {
            cutterCards: [pendingCut()],
            resolveCardRows: resolverWithLive({ p1: 3 }),
            selectedCutterCardId: null,
            setSelectedCutterCardId: () => {},
            updateCutterSuggestionField: () => {},
            convertCutterCard: () => {},
            deleteCutterCard: () => {},
            setCutterSuggestionStatus: bareStatus,
            editorRef: { current: { jumpToCard: () => {} } },
          } as unknown as CardFloatCtx)!.renderBody(FLOAT_BODY_CTX) as ReactElement,
      },
    ] satisfies Surface[],
  },
];

afterEach(() => {
  cleanup();
  cardOverride = {};
  setPendingChangesFlag(undefined);
  for (const f of FAMILIES)
    cardStore.collapse({ kind: f.family, id: f.id } as never);
});

for (const { family, id, surfaces } of FAMILIES) {
  describe(`${family} — the pending card's primary action, on every surface`, () => {
    for (const s of surfaces) {
      const mount = (controller: ReturnType<typeof makeController>, bare: () => void) => {
        if (s.expandRef) cardStore.expand(s.expandRef as never);
        return render(
          <PendingChangeControllerProvider value={controller}>
            {s.el(bare)}
          </PendingChangeControllerProvider>,
        );
      };

      describe(`${s.label}`, () => {
        beforeEach(() => setPendingChangesFlag(true));

        it("FLAG ON — offers Apply (not Accept/Reject) and routes it to the controller", () => {
          const controller = makeController();
          const bare = vi.fn();
          mount(controller, bare);

          expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
          expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
          expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();

          fireEvent.click(screen.getByRole("button", { name: "Apply" }));
          expect(controller.apply).toHaveBeenCalledWith(family, id);
          // Not the out-of-band AI-request path, and not a bare status write.
          expect(controller.accept).not.toHaveBeenCalled();
          expect(bare).not.toHaveBeenCalled();
        });

        // ── TASK 695 — the row asks whether THIS CARD can answer Apply ────
        // The row used to gate only on `!controller || !controller.isOn` — "is
        // the machinery on?" — so a suggestion with no Mode-A anchor (every
        // card either panel's own "+" makes) rendered a live Apply that
        // returned `skipped` before touching the doc or the card: no splice, no
        // status, no notice, forever. Both legs drive the REAL surface
        // producers, because the defect was that a surface could differ.
        it("TASK 695 — an UNANCHORED suggestion disables Apply and says why", () => {
          cardOverride = { links: [] };
          const controller = makeController();
          const bare = vi.fn();
          mount(controller, bare);

          const apply = screen.getByRole("button", { name: "Apply" });
          expect((apply as HTMLButtonElement).disabled).toBe(true);
          expect(screen.getByTestId("pending-apply-blocked").textContent).toMatch(
            /not anchored to a paragraph/i,
          );
          fireEvent.click(apply);
          expect(controller.apply).not.toHaveBeenCalled();
          expect(bare).not.toHaveBeenCalled();
        });

        it("TASK 695 — an anchored suggestion that captured NOTHING disables Apply and says why", () => {
          // `locateSpan` treats an empty needle as an automatic miss, so this
          // card could never apply either — and calling it `stale` would blame
          // a document that did not change.
          cardOverride = { original_text: "" };
          const controller = makeController();
          const bare = vi.fn();
          mount(controller, bare);

          const apply = screen.getByRole("button", { name: "Apply" });
          expect((apply as HTMLButtonElement).disabled).toBe(true);
          expect(screen.getByTestId("pending-apply-blocked").textContent).toMatch(
            /no original passage captured/i,
          );
          fireEvent.click(apply);
          expect(controller.apply).not.toHaveBeenCalled();
        });

        it("TASK 695 — an appliable suggestion says nothing and stays enabled", () => {
          const controller = makeController();
          mount(controller, vi.fn());

          expect(
            (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
              .disabled,
          ).toBe(false);
          expect(screen.queryByTestId("pending-apply-blocked")).toBeNull();
        });

        // ── TASK 713 — and whether it has anything to PUT IN the paper ───
        // The predicate asked about the anchor and the capture but never about
        // the replacement, so a human revision draft (seeded
        // `suggested_text: ""`, inviting the author to type into "Your text")
        // rendered a live Apply whose press took the mode:"delete" branch and
        // staged the author's own paragraph for removal. The family
        // discriminates: in Cutter an empty replacement IS the cut.
        it("TASK 713 — an empty replacement is refused in Revisions, still a cut in Cutter", () => {
          cardOverride = { suggested_text: "", user_text: "" };
          const controller = makeController();
          mount(controller, vi.fn());

          const apply = screen.getByRole("button", {
            name: "Apply",
          }) as HTMLButtonElement;
          if (family === "revision-suggestion") {
            expect(apply.disabled).toBe(true);
            expect(
              screen.getByTestId("pending-apply-blocked").textContent,
            ).toMatch(/nothing to put in the paper/i);
            fireEvent.click(apply);
            expect(controller.apply).not.toHaveBeenCalled();
          } else {
            expect(apply.disabled).toBe(false);
            expect(screen.queryByTestId("pending-apply-blocked")).toBeNull();
          }
        });

        it("TASK 713 — the human's user_text alone keeps Apply live", () => {
          cardOverride = { suggested_text: "", user_text: "My own wording." };
          const controller = makeController();
          mount(controller, vi.fn());

          expect(
            (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
              .disabled,
          ).toBe(false);
          expect(screen.queryByTestId("pending-apply-blocked")).toBeNull();
        });

        it("FLAG OFF — offers the legacy Accept/Reject pair, routed to the controller", () => {
          setPendingChangesFlag(false);
          const controller = makeController();
          const bare = vi.fn();
          mount(controller, bare);

          expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
          fireEvent.click(screen.getByRole("button", { name: "Accept" }));
          expect(controller.accept).toHaveBeenCalledWith(family, id);
          fireEvent.click(screen.getByRole("button", { name: "Reject" }));
          expect(controller.reject).toHaveBeenCalledWith(family, id);
          expect(controller.apply).not.toHaveBeenCalled();
          expect(bare).not.toHaveBeenCalled();
        });
      });
    }
  });
}

// ── The census — the leg with teeth ────────────────────────────────────────
//
// The behavioural legs above pass the moment the three surfaces agree. They say
// nothing about the FOURTH surface someone adds next month. What made this a bug
// rather than an oversight is that the capability was a PROP: a mount site could
// omit it, type-check perfectly, and silently degrade the card. So census the
// mount sites from the dangerous side — a landing verb passed per-mount at all.

const LANDING_PROPS = ["onApply", "onAccept", "onReject", "onKeep", "onRevert"];

/** Every non-test source file that MOUNTS either suggestion card. Discovered
 *  from the tree, so a new surface is censused by shipping. */
function mountSites(): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        walk(p);
        continue;
      }
      if (!/\.tsx$/.test(e.name)) continue;
      const src = readFileSync(p, "utf8");
      if (!/<(Revision|Cutter)SuggestionCard\b/.test(src)) continue;
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/<(Revision|Cutter)SuggestionCard\b/.test(lines[i])) continue;
        // The JSX element: from the tag to its closing `/>`.
        let j = i;
        const buf: string[] = [];
        while (j < lines.length && j < i + 60) {
          buf.push(lines[j]);
          if (/\/>\s*$/.test(lines[j])) break;
          j++;
        }
        out.push({
          file: p.slice(REPO_SRC.length + 1),
          line: i + 1,
          text: buf.join("\n"),
        });
      }
    }
  };
  walk(REPO_SRC);
  return out;
}

describe("task 684 census — no suggestion landing verb is wired per MOUNT SITE", () => {
  it("finds every mount site (the census is not vacuous)", () => {
    const sites = mountSites();
    // docked panel ×2, omni builder ×2, float registry ×2.
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it("no mount site passes Apply / Accept / Reject / Keep / Revert", () => {
    const offenders = mountSites()
      .filter((s) => LANDING_PROPS.some((p) => new RegExp(`\\b${p}=`).test(s.text)))
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  it("the card body resolves the action row from the shared controller", () => {
    // TASK 714 — there is now ONE body. The two panel files were hand
    // transcriptions of each other and kept diverging (this is the third such
    // divergence filed on the pair), so `SuggestionCard` is the single
    // component both families render, and it is where the action row lives.
    const body = readFileSync(
      join(REPO_SRC, "panels/_shared/SuggestionCard.tsx"),
      "utf8",
    );
    expect(body).toContain("PendingActionRow");
    // And the two panel files are pure DELEGATIONS — which is a stronger
    // statement than "each one mentions the row": a file with no body of its
    // own has no branch that can forget one.
    for (const [f, family] of [
      ["panels/Revisions/RevisionSuggestionCard.tsx", "revision-suggestion"],
      ["panels/Cutter/CutterSuggestionCard.tsx", "cutter-suggestion"],
    ] as const) {
      const src = readFileSync(join(REPO_SRC, f), "utf8");
      expect(src, f).toMatch(
        new RegExp(`<SuggestionCard\\s+\\{\\.\\.\\.props\\}\\s+family="${family}"`),
      );
      // No second body: the branch keywords the old transcription carried.
      expect(src, f).not.toContain("PendingActionRow");
      expect(src, f).not.toContain("AppliedRecordBody");
      expect(src, f).not.toContain("FIELD_ORDER");
    }
    const row = readFileSync(
      join(REPO_SRC, "panels/_shared/suggestion-fields.tsx"),
      "utf8",
    );
    // The row reads the verb from context, and owns BOTH sides of the flag fork
    // (so neither side can be reintroduced as a prop at a mount site).
    expect(row).toContain("usePendingChangeController");
    expect(row).toMatch(/controller\?\.apply\(family, id\)/);
    expect(row).toMatch(/controller\?\.accept\(family, id\)/);
    expect(row).toMatch(/controller\?\.reject\(family, id\)/);
  });

  it("task 695 — the row derives Apply's gate from the shared predicate, not a second condition", () => {
    const row = readFileSync(
      join(REPO_SRC, "panels/_shared/suggestion-fields.tsx"),
      "utf8",
    );
    // The ONE predicate `applySuggestion` bails on. A hand-written second
    // condition here is exactly how the button and the action came apart.
    expect(row).toContain("suggestionApplicability");
    expect(row).toContain("SUGGESTION_BLOCK_TEXT");
    // And it takes the CARD, so no mount site can render the button without the
    // facts it is gated on.
    expect(row).toMatch(/card: SuggestionLike/);
  });

  it("task 713 — the second landing verb is gated on the same reason vocabulary", () => {
    const row = readFileSync(
      join(REPO_SRC, "panels/_shared/suggestion-fields.tsx"),
      "utf8",
    );
    // `PendingAiRecordBody`'s "Insert below" used to carry its own
    // `suggestedText.trim().length > 0` — a second, hand-written condition that
    // knew nothing about the anchor `insertSuggestionBelow` silently bails on.
    expect(row).toContain("suggestionInsertability");
    // (the old condition survives only in the prose that explains it)
    expect(row).not.toMatch(/const canInsert\s*=/);
    // Apply's predicate takes the FAMILY — an empty replacement means a cut in
    // Cutter and an unfinished draft in Revisions.
    expect(row).toMatch(/suggestionApplicability\(card, family\)/);
  });
});
