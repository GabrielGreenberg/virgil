// Task 397 — THE census with teeth: **every lightning-grid cell asks ITS OWN
// row.**
//
// The probes were never the part that could misbehave. `blockInsertApplies` is a
// per-NodeType FACTORY and says so in its own docstring; `wrapperApplies` became
// one in this task; `formatApplies` became a per-MARK factory in it. What
// misbehaved is a CONSUMER that asks ONE row for SIX types — and that
// type-checks perfectly, renders perfectly, and is invisible to every
// behavioural test of every row, because each row was answering correctly the
// whole time. Nothing but source can see it.
//
// So: no `disabled=` on a grid cell may read anything but `gridCellDisabled`,
// called with that cell's OWN action id. The allowlist is EMPTY, and a hit is
// WIRE-IT, never an entry — a shared `*Disabled` const is exactly what this
// retires.
//
// Membership is DISCOVERED from the file's own JSX (every `<FmtBtn>` under the
// grid, plus the two bespoke cell components), never hand-listed: a hand list
// can only be missing the cell that drifted. The two bespoke cells carry an
// explicit STATED answer rather than an exemption — `ColorGridCell` renders no
// `id` prop (it registers `"text-color"` internally), and `BlockTypeGridCell` is
// a nested-menu trigger with no action row at all — because "no id prop" must
// never be readable as "this cell is excused".
//
// Reads `commentsStripped`, NOT `codeOnly`: every needle here lives inside a
// quoted attribute (`id="bold"`, `gridCellDisabled("bold")`) and `codeOnly`
// blanks string literals, which would make every leg unfalsifiable — the exact
// trap `_source-scan`'s own header documents.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { commentsStripped, elementsNamed, type JsxElementHit } from "@/lib/__tests__/_source-scan";

const REPO = resolve(__dirname, "../../..");
const PANEL = "src/components/ActionsMenuPanel.tsx";
const SRC = commentsStripped(readFileSync(join(REPO, PANEL), "utf8"));

/** The ONE door. Every cell's `disabled` must be exactly this, with a literal
 *  id — a computed id (`gridCellDisabled(someVar)`) would let a shared value
 *  back in through the door's own signature. */
const OWN_ID = (id: string) =>
  new RegExp(`disabled=\\{gridCellDisabled\\("${id}"\\)\\}`);

/** Any `disabled=` prop, whatever it reads. */
const ANY_DISABLED = /disabled=\{([^}]*(?:\{[^}]*\})?[^}]*)\}/;

/** The bespoke cell components, each with the id it registers and WHY it
 *  renders no `id` prop. A stated answer, not an exemption: this list may only
 *  SHRINK, and a new bespoke cell must state its own. */
const BESPOKE_CELLS: Record<string, { id: string | null; why: string }> = {
  ColorGridCell: {
    id: "text-color",
    why: "a nested-menu trigger that registers its own menu id internally; it still takes the door, because the mark it ultimately applies (`textColor`) is as schema-gated as the four toggles",
  },
  BlockTypeGridCell: {
    id: null,
    why: "a nested-menu trigger for the BlockType dropdown — it dispatches no action row of its own, so there is no row to ask; its ITEMS carry their own per-level gating",
  },
};

describe("task 397 — every grid cell asks its own row", () => {
  const fmtBtns: JsxElementHit[] = elementsNamed(SRC, "FmtBtn").filter(
    // The component DECLARATION is `function FmtBtn(` — only call sites are
    // JSX elements, and only those carry an `id=` prop.
    (h) => /\bid="/.test(h.tag),
  );

  it("population self-check — the needle still finds the grid", () => {
    // Fifteen `FmtBtn` cells shipped at 397. A floor rather than an equality so
    // a NEW cell doesn't fail this leg instead of its own; if this ever drops,
    // the needle is stale and every leg below is passing vacuously.
    expect(fmtBtns.length).toBeGreaterThanOrEqual(15);
    // …and both bespoke cells are still rendered.
    for (const name of Object.keys(BESPOKE_CELLS)) {
      expect(elementsNamed(SRC, name).length, `${name} is no longer rendered`).toBeGreaterThan(0);
    }
  });

  it("every FmtBtn cell's `disabled` reads gridCellDisabled with its OWN id", () => {
    const offenders: string[] = [];
    for (const hit of fmtBtns) {
      const idm = /\bid="([a-z-]+)"/.exec(hit.tag);
      // An unreadable id is a HOLE, not a pass — the census must never fail
      // toward silence about a cell it could not parse.
      if (!idm) {
        offenders.push(`a FmtBtn with no literal id= prop: ${hit.tag.slice(0, 80)}`);
        continue;
      }
      const id = idm[1]!;
      if (!ANY_DISABLED.test(hit.tag)) {
        offenders.push(`${id}: no disabled= prop at all`);
        continue;
      }
      if (!OWN_ID(id).test(hit.tag)) {
        const read = ANY_DISABLED.exec(hit.tag)![1]!.trim();
        offenders.push(`${id}: disabled reads \`${read}\`, not gridCellDisabled("${id}")`);
      }
    }
    expect(
      offenders,
      `A grid cell must ask its OWN row. Fix the cell — do NOT add an allowlist:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the two bespoke cells give the STATED answer", () => {
    for (const [name, { id }] of Object.entries(BESPOKE_CELLS)) {
      for (const hit of elementsNamed(SRC, name)) {
        if (!/\brow=\{/.test(hit.tag)) continue; // the declaration, not a call site
        if (id === null) {
          expect(ANY_DISABLED.test(hit.tag), `${name} declares no action row, so it must render no disabled= prop`).toBe(false);
        } else {
          expect(hit.tag, `${name} must ask the ${id} row`).toMatch(OWN_ID(id));
        }
      }
    }
  });

  it("no SHARED probe survives — every applies() in this file is PER ROW", () => {
    // The general form, so a probe built under a NEW name is caught too. Two
    // shapes are legitimate and they are legitimate for the SAME reason — each
    // asks one row about one id:
    //   • the grid's door, `VIRGIL_ACTION_REGISTRY[id]!.applies(…)`, whose `id`
    //     is the caller's own (pinned per cell by the legs above);
    //   • the CARD-LIST probe, `entry.applies(…)`, evaluated inside the per-entry
    //     `.map` so each card row answers for itself (task 061).
    // Anything else is a probe of one row rendered on another cell — the defect.
    const receivers = [...SRC.matchAll(/([A-Za-z_$][\w$]*(?:\[[^\]]*\])?!?)\.applies\s*\(/g)]
      .map((m) => m[1]!);
    expect(receivers.length, "the applies() needle is stale").toBeGreaterThanOrEqual(2);
    for (const r of receivers) {
      expect(
        r === "entry" || /^VIRGIL_ACTION_REGISTRY\[id\]!?$/.test(r),
        `\`${r}.applies(…)\` — a probe of one row. Every cell must ask its own id.`,
      ).toBe(true);
    }
    // The two retired consts stay retired (they are what the door replaced).
    expect(SRC).not.toMatch(/\bblockAtomsDisabled\b/);
    expect(SRC).not.toMatch(/\bwrappersDisabled\b/);
  });

  it("canary — the census can SEE a shared probe (synthetic, not the drained line)", () => {
    // A canary must not stand on the defect: this fixture is written here, never
    // read from the file the allowlist drains.
    const fixture = `
      <FmtBtn id="example" row={2} col={0} disabled={blockAtomsDisabled} run={() => x()}>
      </FmtBtn>
      <FmtBtn id="display-math" row={2} col={2} disabled={blockAtomsDisabled} run={() => y()}>
      </FmtBtn>
    `;
    const hits = elementsNamed(fixture, "FmtBtn").filter((h) => /\bid="/.test(h.tag));
    expect(hits.length).toBe(2);
    for (const h of hits) {
      const id = /\bid="([a-z-]+)"/.exec(h.tag)![1]!;
      expect(OWN_ID(id).test(h.tag), `the canary's ${id} cell should be flagged`).toBe(false);
      expect(ANY_DISABLED.test(h.tag)).toBe(true);
    }
    // …and that a CORRECT cell is not flagged (an accepting control — without it
    // a needle that matches nothing would pass this leg too).
    const good = `<FmtBtn id="figure" row={3} col={1} disabled={gridCellDisabled("figure")} run={() => z()}>\n</FmtBtn>`;
    const goodHit = elementsNamed(good, "FmtBtn")[0]!;
    expect(OWN_ID("figure").test(goodHit.tag)).toBe(true);
  });

  it("the arrow-function trap — tagEnd must not truncate at a `run={() => …}`", () => {
    // Every cell in this grid carries `run={() => …}`, and a `[^>]*` tag scan
    // ends the tag at the arrow — which is how four margin guides once sat
    // unflagged under a guard written to indict them (AGENTS.md, "Pane-drag
    // stability"). Pin that the shared scanner reads past it, or every leg above
    // is measuring a truncated tag.
    const withArrow = `<FmtBtn id="tex" run={() => insertTexBlock(editor)} disabled={gridCellDisabled("tex")}>\n</FmtBtn>`;
    const hit = elementsNamed(withArrow, "FmtBtn")[0]!;
    expect(hit.tag).toContain('disabled={gridCellDisabled("tex")}');
  });
});
