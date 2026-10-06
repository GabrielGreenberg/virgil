// @vitest-environment jsdom
//
// Task 2026-10-06-974 — every POPPABLE kind's delete reaches the `card-deleted`
// sink, or says why it doesn't need to.
//
// THE SHAPE THIS EXISTS TO CLOSE. Task 789 made `useCardLifecycleReconciler`
// the ONE sink that closes a deleted card's popped `float:card:<kind>:<id>` key
// (and prunes its `cardStore` refs). It fires on the `card-deleted` signal,
// which only `runCardLifecycleEvent` publishes — reached through the
// `makeUnbridgingDelete` wrappers in EditorPane. Archive is poppable, but every
// archive delete door called the raw `useArchive.deleteSnippet`, because
// `CARD_REGISTRY.archive.lifecycle.delete === false` (R18: archive survives its
// anchor paragraph's deletion) had been read as "archive never goes through the
// delete executor". R18 is about the CASCADE; a user deleting the card is a
// different event, and owes the float close like every sibling. So a popped
// archive card, deleted, left a dead key at the top of the Cmd-W stack.
//
// The sister census (`card-removal-door-census`) could not see it: its scope is
// "hooks that open an ai-requests row", and archive bridges nothing. THIS
// census's scope is the hazard it guards — a kind that can be POPPED OUT has a
// float key a delete must close — and it is DERIVED from the registry
// (`CARD_REGISTRY[kind].poppable`), so a kind that becomes poppable is swept in
// the moment it does.
//
// Every in-scope kind is declared either WIRED (its EditorPane wrapper, which
// must be a `makeUnbridgingDelete` composition, and the raw hook delete it
// consumes — which must appear NOWHERE else in EditorPane, so no consumer can
// reach past the wrapper) or EXEMPT (the other door that discharges the same
// obligation, or the reason none is owed).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_REGISTRY } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import type { CardKind } from "../types";

const EDITOR_PANE = join("src", "components", "EditorPane.tsx");

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

type Disposition =
  /** `wiredBy`: the EditorPane wrapper. `rawDelete`: the raw hook mutation it
   *  consumes, exactly as written after `rawDelete:`. */
  | { wiredBy: string; rawDelete: string }
  | { exempt: string };

const CENSUS: Partial<Record<CardKind, Disposition>> = {
  note: { wiredBy: "deleteNoteCard", rawDelete: "notesHookRaw.deleteNote" },
  highlight: { wiredBy: "deleteNoteCard", rawDelete: "notesHookRaw.deleteNote" },
  todo: { wiredBy: "deleteTodoItem", rawDelete: "todosHookRaw.deleteItem" },
  report: { wiredBy: "deleteReportCard", rawDelete: "reportsHookRaw.deleteCard" },
  "report-request": { wiredBy: "deleteReportCard", rawDelete: "reportsHookRaw.deleteCard" },
  "cutter-comment": { wiredBy: "deleteCutterCard", rawDelete: "cutterHookRaw.deleteCard" },
  "cutter-suggestion": { wiredBy: "deleteCutterCard", rawDelete: "cutterHookRaw.deleteCard" },
  "revision-comment": { wiredBy: "deleteRevisionCard", rawDelete: "revisionsHookRaw.deleteCard" },
  "revision-suggestion": { wiredBy: "deleteRevisionCard", rawDelete: "revisionsHookRaw.deleteCard" },
  // The kind this census was written for (task 974).
  archive: { wiredBy: "deleteArchiveSnippet", rawDelete: "archiveHookRaw.deleteSnippet" },

  // ── EXEMPT ──────────────────────────────────────────────────────────────
  footnote: {
    exempt:
      "inline atom: removed by a keystroke / code-view edit as often as by a delete control, " +
      "so its float close is the bus-diff close in inline-atom-lifecycle-policy §(c), not the executor",
  },
  citation: {
    exempt:
      "inline atom: same as footnote — the bus-diff close in inline-atom-lifecycle-policy §(c) " +
      "covers every removal door, keystrokes included",
  },
  example: {
    exempt:
      "a document BLOCK, not a sidecar record: it has no hook delete to wrap — it leaves the " +
      "document by editing, and its float builder resolves against the live doc's examples",
  },
  bib: {
    exempt:
      "a .bib entry keyed by citekey, not a pane sidecar card: its removal is a bib-file splice " +
      "with no card-store identity for the pane sink to prune",
  },
};

describe("every poppable kind's delete reaches the card-deleted sink (task 974)", () => {
  const pane = blankComments(readFileSync(EDITOR_PANE, "utf8"));
  const poppable = CARD_KINDS.filter((k) => CARD_REGISTRY[k].poppable);

  it("finds the poppable kinds (the guard is not silently dead)", () => {
    expect(poppable.length).toBeGreaterThanOrEqual(14);
    expect(poppable).toContain("archive");
  });

  it("every poppable kind has a declared disposition, and no entry is stale", () => {
    const undeclared = poppable.filter((k) => CENSUS[k] === undefined);
    expect(
      undeclared,
      "A poppable kind has a float key a delete must close. Wire its delete " +
        "through `makeUnbridgingDelete` in EditorPane (so the `card-deleted` " +
        "signal reaches the pane's sink) and declare it WIRED, or declare it " +
        "EXEMPT with the other door that closes its float.",
    ).toEqual([]);
    const stale = (Object.keys(CENSUS) as CardKind[]).filter((k) => !poppable.includes(k));
    expect(stale, "Declared kind is no longer poppable — prune its entry.").toEqual([]);
  });

  it("every WIRED wrapper is a makeUnbridgingDelete composition over its raw delete", () => {
    const broken: string[] = [];
    for (const [kind, d] of Object.entries(CENSUS)) {
      if (!d || !("wiredBy" in d)) continue;
      const at = pane.indexOf(`const ${d.wiredBy} =`);
      if (at === -1) {
        broken.push(`${kind} — EditorPane declares no \`${d.wiredBy}\``);
        continue;
      }
      const rest = pane.slice(at + 6);
      const next = rest.indexOf("\n  const ");
      const decl = next === -1 ? rest : rest.slice(0, next);
      if (!/makeUnbridgingDelete\(/.test(decl)) {
        broken.push(`${kind} — \`${d.wiredBy}\` is not built from makeUnbridgingDelete`);
      }
      if (!decl.includes(`rawDelete: ${d.rawDelete}`)) {
        broken.push(`${kind} — \`${d.wiredBy}\` does not consume \`${d.rawDelete}\``);
      }
    }
    expect(broken).toEqual([]);
  });

  it("no consumer reaches past a wrapper to the raw delete", () => {
    const leaks: string[] = [];
    const raws = new Set(
      Object.values(CENSUS).flatMap((d) => (d && "rawDelete" in d ? [d.rawDelete] : [])),
    );
    for (const raw of raws) {
      const wrapper = Object.values(CENSUS).find(
        (d) => d && "rawDelete" in d && d.rawDelete === raw,
      ) as { wiredBy: string };
      const at = pane.indexOf(`const ${wrapper.wiredBy} =`);
      const rest = pane.slice(at + 6);
      const next = rest.indexOf("\n  const ");
      const end = next === -1 ? pane.length : at + 6 + next;
      const re = new RegExp(raw.replace(/\./g, "\\.") + "\\b", "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(pane)) !== null) {
        if (m.index < at || m.index >= end) {
          leaks.push(`${raw} @ line ${pane.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(
      leaks,
      "The raw hook delete is referenced outside its wrapper — that door " +
        "removes the card without the `card-deleted` signal, so a popped float " +
        "key outlives the card (task 974). Thread the wrapped hook instead.",
    ).toEqual([]);
  });

  it("every EXEMPT entry states a reason", () => {
    const silent = Object.entries(CENSUS)
      .filter(([, d]) => d && "exempt" in d && d.exempt.trim().length < 40)
      .map(([k]) => k);
    expect(silent).toEqual([]);
  });
});
