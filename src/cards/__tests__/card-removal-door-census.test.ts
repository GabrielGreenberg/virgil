// @vitest-environment node
//
// Task 2026-09-20-681 — the CENSUS of destructive card-removal doors.
//
// THE SHAPE THIS EXISTS TO CLOSE. Task 219 gave every panel hook's delete ONE
// composition that discharges what a departing card owes — `makeUnbridgingDelete`
// (plus `makeUnbridgingFootnoteDelete` for the one inline-atom kind). It was
// applied at the EditorPane seam, per exported door, by NAME: `deleteItem`,
// `deleteCard`, `deleteNote`, `deleteFootnote`. That attaches the obligation to
// a FUNCTION NAME rather than to the TRANSITION it guards — a card leaving the
// document — so any second door that removed cards under a different name
// inherited nothing.
//
// There was one, and it went unnoticed for four months. `useTodos.archiveDone`
// backed the Todo panel's "clear done" control with a plain
// `prev.items.filter(...)`: a hard delete of N cards wearing the name of the
// reversible set-aside flag (`setArchived`) declared twenty lines above it.
// Every done todo whose AI box had been ticked left its `ai-requests.json` row
// open forever — the inbox count inflated, the `/editor/review` drain re-serving
// a card that no longer exists, and no self-heal possible, because a deleted
// card can never toggle again (`unbridging-delete.ts` says exactly this).
//
// THE SISTER GUARDS ASK ABOUT DOORS THEY CAN SEE; THIS ONE ASKS WHETHER THEY ARE
// ALL THERE. `applied-splice-wiring-guardrail` asks whether each lifecycle door
// PASSES the SETTLE obligation. `unbridge-mode-wiring-guardrail` asks whether
// each bridge writer FORWARDS its mode. Both enumerate from the safe side — they
// walk the calls that already route through the executor, so a removal that
// never reaches it is invisible to both, which is precisely how `archiveDone`
// stayed green. This one enumerates from the DANGEROUS side: it derives every
// place a card-owning hook drops entries from its own collection, and requires
// each to be declared below as either WIRED (naming the EditorPane wrapper that
// carries the obligations) or EXEMPT (with the reason it cannot strand a row).
// Derive-or-pin, the same discipline `ai-request-routing-contract` applies to
// routing.
//
// SCOPE IS DERIVED, NOT LISTED. A hook is in scope iff its CODE calls
// `bridgeCardAiRequestFlag(` — i.e. iff it can open a row that a removal could
// strand. That is the exact hazard, so the scope cannot drift from it: a new
// panel hook that bridges is swept in the moment it does, and a hook that stops
// bridging drops out on its own. (`useAiRequests` mentions the bridge only in
// prose and is therefore out of scope for the right reason — it owns the ROWS,
// not cards, so removing one of its entries cannot strand one.)
//
// WHAT IT CANNOT SEE, stated so nobody mistakes a pass for more than it is: it
// reads declarations, not reachability. It proves every removal door is
// accounted for and that each WIRED one's stated wiring is really in the source;
// it does not prove no consumer reaches past the wrapper to the raw hook. That
// second question is the behavioural suites' (`unbridging-delete.test.ts`,
// `todo-clear-done-unbridge.test.tsx`).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = join("src", "hooks");
const EDITOR_PANE = join("src", "components", "EditorPane.tsx");

/**
 * BLANK (don't remove) comments, so prose ABOUT a removal — this repo documents
 * the shapes it forbids, at length — is never mistaken for one. Newlines are
 * preserved so reported line numbers still point at real code.
 */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** The balanced source slice of a call, from its opening paren. */
function balanced(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen);
}

interface Door {
  /** Hook file basename, e.g. `useTodos.ts`. */
  file: string;
  /** The exported mutator's name. */
  name: string;
  line: number;
}

/**
 * Every `useCallback` in an in-scope hook whose body BOTH filters and writes
 * state — the source shape of "drop entries from my own collection". Every
 * known removal door in the repo is written this way; a future one written
 * some other way is caught by the floor assertion going stale, not silently
 * admitted (`it("finds the known doors")`).
 */
function collectDoors(): Door[] {
  const doors: Door[] = [];
  for (const entry of readdirSync(HOOKS_DIR)) {
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.")) continue;
    const src = blankComments(readFileSync(join(HOOKS_DIR, entry), "utf8"));
    if (!src.includes("bridgeCardAiRequestFlag(")) continue; // out of scope
    const re = /\bconst ([A-Za-z0-9_]+) = useCallback\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const body = balanced(src, re.lastIndex - 1);
      const removes = /\.filter\(/.test(body);
      const writes = /\b(update|updateWhenLoaded|setState|applyMutation)\(/.test(body);
      if (removes && writes) {
        doors.push({
          file: entry,
          name: m[1],
          line: src.slice(0, m.index).split("\n").length,
        });
      }
    }
  }
  return doors;
}

type Disposition =
  /** Wrapped at the EditorPane seam by an unbridging composition. `wiredBy` is
   *  the wrapper identifier; `via` is the exact wiring text that must appear in
   *  `EditorPane.tsx` — so a wrapper that stops consuming THIS door (or starts
   *  consuming a different one) fails here rather than passing on its name. */
  | { wiredBy: string; via: string }
  /** Cannot strand a row. The reason is the whole value of the entry — it is
   *  the claim a future reader gets to check. */
  | { exempt: string };

/**
 * THE CENSUS. Keyed `<hook file>#<door>`. Every door `collectDoors` finds must
 * appear here and every entry here must still be found — both directions, so
 * the table can neither miss a new door nor rot around a deleted one.
 */
const CENSUS: Record<string, Disposition> = {
  "useNotes.ts#deleteNote": {
    wiredBy: "deleteNoteCard",
    via: "rawDelete: notesHookRaw.deleteNote",
  },
  "useTodos.ts#deleteItem": {
    wiredBy: "deleteTodoItem",
    via: "rawDelete: todosHookRaw.deleteItem",
  },
  "useReports.ts#deleteCard": {
    wiredBy: "deleteReportCard",
    via: "rawDelete: reportsHookRaw.deleteCard",
  },
  "useCutter.ts#deleteCard": {
    wiredBy: "deleteCutterCard",
    via: "rawDelete: cutterHookRaw.deleteCard",
  },
  "useRevisions.ts#deleteCard": {
    wiredBy: "deleteRevisionCard",
    via: "rawDelete: revisionsHookRaw.deleteCard",
  },
  // The one flag-bearing kind NOT on `makeUnbridgingDelete` (an inline atom: no
  // D6 signal, and its removal mechanism varies — editor-handle splice vs
  // sidecar ref delete). Its factory takes the raw remover per call instead of
  // wrapping the hook, so the wiring text is the CALL, not a `rawDelete:` field.
  "useFootnotes.ts#deleteFootnote": {
    wiredBy: "deleteFootnoteUnbridged",
    via: "deleteFootnoteUnbridged(id, footnotesHook.deleteFootnote)",
  },

  // ── EXEMPT ──────────────────────────────────────────────────────────────
  // The five pristine-discard doors. A PRISTINE card is one created by "+" and
  // never touched; every hook's `setAiRequest` calls `pristine.markDirty(id)`
  // FIRST, so ticking the AI box is itself what ends a card's pristine life.
  // A card these doors can reach therefore never bridged a row, and there is
  // none to strand. (The path that actually runs in the app is narrower still:
  // when the shared `usePristineCardManager` is in use — it is, in every
  // EditorPane — `discardAll()` dispatches the registered per-kind discard,
  // which EditorPane registers as the WIRED delete. These raw bodies are the
  // hook-local fallback for a host without the manager.)
  "useNotes.ts#discardPristineNotes": {
    exempt: "pristine-only: setNoteAiRequest/setHighlightAiRequest markDirty first, so a reachable card never bridged a row",
  },
  "useTodos.ts#discardPristineTodos": {
    exempt: "pristine-only: setAiRequest markDirty first, so a reachable card never bridged a row",
  },
  "useReports.ts#discardPristineCards": {
    exempt: "pristine-only: setRequestAiRequest markDirty first, so a reachable card never bridged a row",
  },
  "useCutter.ts#discardPristineCards": {
    exempt: "pristine-only: setCommentAiRequest markDirty first, so a reachable card never bridged a row",
  },
  "useRevisions.ts#discardPristineCards": {
    exempt: "pristine-only: setCommentAiRequest markDirty first, so a reachable card never bridged a row",
  },
};

describe("every card-removal door is wired or exempted (task 681)", () => {
  const doors = collectDoors();
  const pane = readFileSync(EDITOR_PANE, "utf8");

  it("finds the known doors (the guard itself is not silently dead)", () => {
    // Six card-owning hooks × (one delete + one pristine discard), minus
    // useFootnotes' absent pristine door. If this collapses the detector
    // stopped matching and the census would "pass" while checking nothing.
    expect(doors.length).toBeGreaterThanOrEqual(11);
  });

  it("no door removes cards without a declared disposition", () => {
    const undeclared = doors
      .filter((d) => CENSUS[`${d.file}#${d.name}`] === undefined)
      .map((d) => `${d.file}:${d.line} — ${d.name}`);
    expect(
      undeclared,
      "A hook that can open an `ai-requests.json` row has grown a new way to " +
        "remove cards from its own collection. A removal must discharge what " +
        "the departing card owes — the linked row (in `terminate` mode) and the " +
        "SETTLE step — and the ONE place that happens is the EditorPane seam, " +
        "through `makeUnbridgingDelete` / `makeUnbridgingBulkDelete` / " +
        "`makeUnbridgingFootnoteDelete`. Wire it there and add it to CENSUS as " +
        "`{ wiredBy, via }`; or, if it genuinely cannot reach a row-bearing " +
        "card, add it as `{ exempt: <the reason> }`. Do not delete this entry " +
        "to make the test pass — that is the bug this guard was written for " +
        "(`useTodos.archiveDone`, task 681).",
    ).toEqual([]);
  });

  it("no census entry has gone stale", () => {
    const found = new Set(doors.map((d) => `${d.file}#${d.name}`));
    const orphaned = Object.keys(CENSUS).filter((k) => !found.has(k));
    expect(
      orphaned,
      "A declared door no longer exists. Remove its CENSUS entry — a table " +
        "nobody prunes stops being evidence about the code.",
    ).toEqual([]);
  });

  it("every WIRED door's wrapper really is an unbridging composition", () => {
    const broken: string[] = [];
    for (const [key, d] of Object.entries(CENSUS)) {
      if (!("wiredBy" in d)) continue;
      const at = pane.indexOf(`const ${d.wiredBy} =`);
      if (at === -1) {
        broken.push(`${key} — EditorPane declares no \`${d.wiredBy}\``);
        continue;
      }
      // The declaration's own slice: up to the next top-level `const` in the
      // component body, so a neighbouring wrapper can't vouch for this one.
      const rest = pane.slice(at + 6);
      const nextDecl = rest.indexOf("\n  const ");
      const decl = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
      if (!/makeUnbridging[A-Za-z]*\(/.test(decl)) {
        broken.push(`${key} — \`${d.wiredBy}\` is not built from a makeUnbridging* factory`);
      }
    }
    expect(
      broken,
      "A door declared WIRED must name a wrapper that really composes the " +
        "obligations. A wrapper that stops doing so is the task-219 leak " +
        "re-opening under a name the census still trusts.",
    ).toEqual([]);
  });

  it("every WIRED door's stated wiring text is present in EditorPane", () => {
    const missing = Object.entries(CENSUS)
      .filter(([, d]) => "via" in d && !pane.includes(d.via))
      .map(([key, d]) => `${key} — expected \`${(d as { via: string }).via}\``);
    expect(
      missing,
      "The census names the exact wiring each door has. If it moved, update " +
        "the entry to the new text — the point is that the claim stays checkable, " +
        "not that it stays frozen.",
    ).toEqual([]);
  });

  it("every EXEMPT door states a reason", () => {
    const silent = Object.entries(CENSUS)
      .filter(([, d]) => "exempt" in d && (d as { exempt: string }).exempt.trim().length < 20)
      .map(([key]) => key);
    expect(silent, "An exemption without a reason is an unchecked claim.").toEqual([]);
  });
});
