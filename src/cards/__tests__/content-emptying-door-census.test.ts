// Task 2026-09-21-683 — the CENSUS of doors that can EMPTY a card's declared
// content out of the user's prose.
//
// THE SHAPE THIS EXISTS TO CLOSE. `CARD_REGISTRY[kind].content` declares, once
// per kind, what counts as that card's user content. `cardHasContent` reads it,
// and the DELETE doors all consume that read — `EditableCard.tryDelete`,
// `deleteMarginItem`, `usePanelCardTryDelete`. But deleting the card is not the
// only way its content leaves the document: for a kind whose content lives IN
// THE PROSE, emptying the card of that content destroys exactly the same bytes.
// Nothing read the declaration on that side. So the per-key "×" on a citation's
// LAST key blanked the in-text `\cite{}` in one click, with no dialog and no
// undo affordance, two inches from a trash that asks (`usePanelCardTryDelete`
// with the citation's own "referenced in the document" prompt).
//
// That is the third member of a family: task 240 (the docked suggestion delete
// bypassed the `hasContent` confirm) and task 637 (a Reader card showed a live
// trash that wrote nothing). Each time a kind-level obligation was declared once
// and re-implemented per door, and the door that forgot it was invisible to
// every guard — because the guards enumerate from the SAFE side, walking the
// doors that already route through the executor. This one enumerates from the
// DANGEROUS side: it derives the content-write doors of every in-prose card
// surface and requires each to declare itself.
//
// SCOPE IS DERIVED, NOT LISTED. A kind is in scope iff its registry entry says
// `dropPlacement: "in-text"` AND it declares a `content` model — i.e. iff its
// declared content IS the prose. That is the exact hazard, so the scope cannot
// drift from it: a new in-text content kind is swept in the moment it declares
// itself, and must name its card surface here before it can ship.
//
// WHAT IT CANNOT SEE, stated so nobody mistakes a pass for more than it is: it
// reads source shapes, not reachability. It proves every content-write door of
// an in-prose surface is accounted for, and that each one's stated protection is
// really in its body. It does not prove the guard's ANSWER is right — that is
// `citation-last-key-remove-confirm.test.tsx` (the behavioural legs) and
// `content-coverage.test.ts` (the predicate itself).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_REGISTRY } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import type { CardKind } from "../types";

/** BLANK (don't remove) comments, so prose ABOUT a write — this repo documents
 *  the shapes it forbids, at length — is never mistaken for one. Newlines are
 *  preserved so reported line numbers still point at real code. */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** THE SCOPE, derived from the registry: kinds whose declared content is IN the
 *  document. Both of today's members are in-text atoms (`markerType: null`) — a
 *  citation's `\cite{}` and a footnote's `\footnote{}`. */
const IN_PROSE_KINDS: CardKind[] = CARD_KINDS.filter(
  (k) =>
    CARD_REGISTRY[k].dropPlacement === "in-text" && CARD_REGISTRY[k].content !== null,
);

/** Each in-prose kind's card surface and the props through which that surface
 *  writes its content. Pinned (a prop name is not derivable), but every entry is
 *  checked against the file, so a renamed or deleted prop fails here. */
const SURFACES: Record<string, { file: string; contentProps: string[] }> = {
  citation: {
    file: join("src", "panels", "Citations", "CitationCard.tsx"),
    contentProps: ["onUpdateCitation"],
  },
  footnote: {
    file: join("src", "panels", "Footnotes", "FootnoteCard.tsx"),
    contentProps: ["onEdit", "onEditTitle"],
  },
};

type Disposition =
  /** Routes through the registry-reading guard — `usePanelCardTryEmptyContent`,
   *  whose `tryEmptyContent` asks whether THIS transition takes declared content
   *  out of the prose. `via` must appear in the door's own body. */
  | { guarded: string }
  /** Cannot empty the prose AT ALL, by construction — the door refuses the
   *  emptying write rather than asking about it, and hands the transition to a
   *  door that is guarded. `via` is the refusal, and must be in the body. */
  | { cannotEmpty: string; via: string }
  /** In-place editing of the field the user is looking at. The emptying IS the
   *  edit: it arrives one character at a time, in front of the user, and the
   *  field owns its own revert. A dialog here would fire on a keystroke. The
   *  reason is the whole value of the entry — it is the claim a future reader
   *  gets to check. */
  | { exempt: string };

/** THE CENSUS. Keyed `<kind>#<enclosing function>#<prop>`. Every door
 *  `collectDoors` finds must appear here, and every entry here must still be
 *  found — both directions, so the table can neither miss a new door nor rot
 *  around a deleted one. */
const CENSUS: Record<string, Disposition> = {
  // ── citation — NOTHING EXEMPT ───────────────────────────────────────────
  // The kind whose content is a discrete, clickable list. Every write of the
  // command crosses one door, and that door reads the declaration.
  "citation#emitCommand#onUpdateCitation": {
    guarded: "tryEmptyContent(",
  },
  // The Code field's 250 ms live preview. It does not ASK about an emptying
  // write, it declines to perform one: the session's END (`commitCodeDraft`)
  // routes the transition through `emitCommand`, which is guarded. So a
  // mid-typing keystroke can never blank the in-text `\cite{}` behind a dialog
  // the user was never shown.
  "citation#updateCodeDraft#onUpdateCitation": {
    cannotEmpty:
      "the debounce holds the last non-emptying value; the emptying transition waits for the session end, which crosses emitCommand",
    via: "commandKeys(v)?.length === 0",
  },

  // ── footnote — in-place editing only ────────────────────────────────────
  // One `handleEdit` per body variant (full card / popped / compressed); the
  // three share a name and therefore one entry, because they share one reason.
  "footnote#handleEdit#onEdit": {
    exempt:
      "the footnote body's own rich-text editor: emptying it is the user typing in the field they are looking at, one character at a time, with the editor's own undo",
  },
  "footnote#card#onEditTitle": {
    exempt: "the `\\thanks` title input, edited in place — same reason as the body",
  },
  "footnote#compressedSummary#onEditTitle": {
    exempt: "the compressed body's title input, edited in place — same reason",
  },
};

interface Door {
  kind: string;
  fn: string;
  prop: string;
  file: string;
  /** The door's own source slice, for checking its stated protection. */
  body: string;
}

/**
 * Every place an in-prose surface writes its content prop — a CALL (`onX(…)`)
 * or a HANDLER PASSED to a child (`onSomething={onX}`), because a prop handed
 * straight to an input is as much a door as one wrapped in a callback.
 *
 * The enclosing function is the nearest preceding declaration at module or
 * component-body indentation (0 or 2 spaces), so a `const` inside a callback
 * cannot stand in for the callback that owns it.
 */
function collectDoors(): Door[] {
  const doors = new Map<string, Door>();
  for (const kind of IN_PROSE_KINDS) {
    const surface = SURFACES[kind];
    if (!surface) continue; // reported by its own test below
    const src = blankComments(readFileSync(surface.file, "utf8"));
    const lines = src.split("\n");
    const enclosing: string[] = [];
    const bodyStart: number[] = [];
    let cur = "<module>";
    let curStart = 0;
    lines.forEach((l, i) => {
      const m = /^( {0,2})(?:export\s+)?(?:const|function)\s+([A-Za-z0-9_]+)/.exec(l);
      if (m && (m[1].length === 0 || m[1].length === 2)) {
        cur = m[2];
        curStart = i;
      }
      enclosing.push(cur);
      bodyStart.push(curStart);
    });
    for (const prop of surface.contentProps) {
      const re = new RegExp(`\\b${prop}\\s*\\(|=\\{\\s*${prop}\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const ln = src.slice(0, m.index).split("\n").length - 1;
        const fn = enclosing[ln];
        const start = bodyStart[ln];
        // The declaration's own slice: up to the next declaration at the same
        // level, so a neighbouring door cannot vouch for this one.
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
          const d = /^( {0,2})(?:export\s+)?(?:const|function)\s+[A-Za-z0-9_]+/.exec(
            lines[i],
          );
          if (d && (d[1].length === 0 || d[1].length === 2)) {
            end = i;
            break;
          }
        }
        doors.set(`${kind}#${fn}#${prop}`, {
          kind,
          fn,
          prop,
          file: surface.file,
          body: lines.slice(start, end).join("\n"),
        });
      }
    }
  }
  return [...doors.values()];
}

describe("every in-prose content-emptying door is guarded or exempted (task 683)", () => {
  const doors = collectDoors();

  it("the scope is the registry's, and every in-prose kind names its surface", () => {
    // Today: citation + footnote. If this ever empties, the derivation stopped
    // matching and the census would "pass" while checking nothing.
    expect(IN_PROSE_KINDS.length).toBeGreaterThanOrEqual(2);
    const unnamed = IN_PROSE_KINDS.filter((k) => !SURFACES[k]);
    expect(
      unnamed,
      "A card kind declares content that lives IN the document but names no " +
        "card surface here. Add it to SURFACES with the props through which " +
        "that surface writes its content — otherwise its emptying doors are " +
        "invisible to this census, which is the whole bug.",
    ).toEqual([]);
    expect(Object.keys(SURFACES).sort()).toEqual([...IN_PROSE_KINDS].sort());
  });

  it("every declared content prop really exists on its surface", () => {
    const missing: string[] = [];
    for (const [kind, s] of Object.entries(SURFACES)) {
      const src = readFileSync(s.file, "utf8");
      for (const p of s.contentProps) {
        if (!new RegExp(`\\b${p}\\??:`).test(src)) missing.push(`${kind} — ${p}`);
      }
    }
    expect(
      missing,
      "A pinned content prop is not declared on its surface any more. Renaming " +
        "it without updating this table would silently empty the census.",
    ).toEqual([]);
  });

  it("finds the known doors (the detector is not silently dead)", () => {
    expect(doors.length).toBeGreaterThanOrEqual(5);
  });

  it("no door writes card content without a declared disposition", () => {
    const undeclared = doors
      .filter((d) => CENSUS[`${d.kind}#${d.fn}#${d.prop}`] === undefined)
      .map((d) => `${d.file} — ${d.fn}() → ${d.prop}`);
    expect(
      undeclared,
      "A card whose content lives in the user's prose has grown a new way to " +
        "write that content. If the write can EMPTY it, route it through " +
        "`usePanelCardTryEmptyContent` (the registry reads `content` and " +
        "decides) and declare it `{ guarded }`; if the door refuses the " +
        "emptying write outright, declare it `{ cannotEmpty, via }`; if it is " +
        "in-place text editing the user is watching, declare it `{ exempt }` " +
        "with the reason. Do not delete this entry to make the test pass — " +
        "that is the bug this guard was written for (the citation row's `×`, " +
        "task 683).",
    ).toEqual([]);
  });

  it("no census entry has gone stale", () => {
    const found = new Set(doors.map((d) => `${d.kind}#${d.fn}#${d.prop}`));
    const orphaned = Object.keys(CENSUS).filter((k) => !found.has(k));
    expect(
      orphaned,
      "A declared door no longer exists. Remove its entry — a table nobody " +
        "prunes stops being evidence about the code.",
    ).toEqual([]);
  });

  it("every GUARDED / cannotEmpty door really carries its stated protection", () => {
    const broken: string[] = [];
    for (const d of doors) {
      const disp = CENSUS[`${d.kind}#${d.fn}#${d.prop}`];
      if (!disp) continue;
      if ("guarded" in disp && !d.body.includes(disp.guarded)) {
        broken.push(`${d.kind}#${d.fn} — no \`${disp.guarded}\` in its body`);
      }
      if ("cannotEmpty" in disp && !d.body.includes(disp.via)) {
        broken.push(`${d.kind}#${d.fn} — no \`${disp.via}\` in its body`);
      }
    }
    expect(
      broken,
      "A door declared protected must really carry the protection it names. A " +
        "door that stops doing so is the bug re-opening under a name the " +
        "census still trusts.",
    ).toEqual([]);
  });

  it("the citation surface has NO exempt doors", () => {
    // Its content is a discrete, clickable list of keys, not a text field the
    // user is typing into — so there is no door here for which a confirm would
    // be a nag, and every write goes through the one guarded chokepoint.
    const exempt = doors
      .filter((d) => d.kind === "citation")
      .filter((d) => "exempt" in (CENSUS[`${d.kind}#${d.fn}#${d.prop}`] ?? {}))
      .map((d) => `${d.fn}() → ${d.prop}`);
    expect(exempt).toEqual([]);
  });

  it("the guard itself reads the registry declaration, not a per-kind list", () => {
    const src = readFileSync(
      join("src", "components", "panel-primitives.tsx"),
      "utf8",
    );
    const at = src.indexOf("export function usePanelCardTryEmptyContent");
    expect(at, "the shared guard is gone").toBeGreaterThan(-1);
    const body = src.slice(at, at + 1800);
    // The decision is `cardHasContent(before) && !cardHasContent(after)` — the
    // same registry-driven SSOT the delete doors read, so a new kind inherits
    // the guard by declaring its content model and nothing else.
    expect(body).toContain("cardHasContent(kind, before)");
    expect(body).toContain("!cardHasContent(kind, after)");
  });
});
