import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CARD_KINDS } from "../predicates";

/**
 * Task 722 — the CENSUS that keeps the retired dialect retired.
 *
 * Every kind-chevron used to read
 *
 *     onKindChange={(k) => { if (k !== "report") onConvert(id, "report-request"); }}
 *
 * — the user's selection tested against the site's own kind and then thrown
 * away, the target written out as a literal. Fifteen copies (seven docked
 * cards, eight float-chrome twins), all invisible to TypeScript because the
 * parameter was never passed anywhere. The shape is a bug CLASS, not a typo:
 * a chooser whose OPTIONS are derived and whose ACTION is hand-written (task
 * 717's `setHoverFor` is the same defect wearing different names).
 *
 * So the ban is on the SHAPE. Two rules, both read off the source:
 *
 *   1. No chevron handler compares its parameter to a card-kind literal
 *      (`if (k !== "report")`) — the not-me test that made the selection
 *      look consulted while the dispatch ignored it.
 *   2. Every chevron handler PASSES its parameter on. A handler that binds
 *      `k` and never uses it as an argument has thrown the selection away,
 *      whatever it does instead.
 *
 * A handler may still name its OWN kind as a literal — that is the FROM
 * argument, the same kind the component writes two lines above in `kind="…"`.
 * What it may not do is decide the TARGET.
 */

const ROOT = join(__dirname, "..", "..");
const KIND_LITERALS = new Set<string>(CARD_KINDS);

/** Every `.tsx` under the card/panel surfaces — where a chevron can live. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".tsx")) out.push(p);
    }
  };
  walk(join(ROOT, "panels"));
  walk(join(ROOT, "cards"));
  walk(join(ROOT, "components", "editor-layout"));
  return out;
}

/** Slice the balanced `{…}` expression that starts at `from` (the `{`). */
function braceSlice(text: string, from: number): string {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return text.slice(from);
}

/** Every chevron handler in a file: the `onKindChange={…}` prop of a card, and
 *  the `onChange={…}` of a `<CardKindHeader>` in the float chrome. */
function chevronHandlers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/onKindChange=\{/g)) {
    out.push(braceSlice(text, m.index + "onKindChange=".length));
  }
  for (const m of text.matchAll(/<CardKindHeader\b/g)) {
    // The header's own JSX tag, up to its self-close.
    const end = text.indexOf("/>", m.index);
    const tag = text.slice(m.index, end === -1 ? undefined : end);
    const oc = tag.indexOf("onChange={");
    if (oc !== -1) out.push(braceSlice(tag, oc + "onChange=".length));
  }
  return out;
}

describe("kind-chevron dispatch census (task 722)", () => {
  const files = sources();

  it("finds the chevron sites at all (a census over nothing is vacuous)", () => {
    const handlers = files.flatMap((f) => chevronHandlers(readFileSync(f, "utf8")));
    // 7 docked cards + 8 float-chrome twins was the pre-fix population; the
    // census must keep SEEING them, or it stops proving anything.
    expect(handlers.length).toBeGreaterThanOrEqual(15);
  });

  it("no handler tests its selection against a card-kind literal (the retired `if (k !== \"note\")` dialect)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of chevronHandlers(readFileSync(f, "utf8"))) {
        const m = h.match(/!==\s*"([a-z-]+)"/);
        if (m && KIND_LITERALS.has(m[1])) {
          offenders.push(`${f.slice(ROOT.length + 1)}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every handler passes the SELECTED kind on (never binds it and drops it)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of chevronHandlers(readFileSync(f, "utf8"))) {
        // The bound parameter, e.g. `(k) =>`.
        const param = h.match(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/);
        if (!param) {
          offenders.push(`${f.slice(ROOT.length + 1)}: handler binds no selection`);
          continue;
        }
        const p = param[1].replace(/[$]/g, "\\$");
        // …used as a call argument somewhere in the BODY — the slice after the
        // arrow, so the parameter's own declaration `(k) =>` can't satisfy it
        // (it matched, and a handler that dropped the selection passed).
        const body = h.slice(param.index! + param[0].length);
        const passed = new RegExp(`[(,]\\s*${p}\\s*[),]`).test(body);
        if (!passed) {
          offenders.push(
            `${f.slice(ROOT.length + 1)}: binds "${param[1]}" but never passes it`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
