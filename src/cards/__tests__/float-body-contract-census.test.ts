import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { selectMirror } from "../floats/body-contract";

/**
 * Task 724 — the CENSUS over the two contracts a card body hands its host.
 *
 * A card knows whether it was activated and where it is on screen. Its host's
 * job is to FORWARD those two facts, not to recompute them. Five of the fifteen
 * float registrations recomputed:
 *
 *     onSelect={() => ctx.setSelectedFootnoteId(isSelected ? null : fn.footnoteId)}
 *     onJump={() => ctx.editorRef.current?.scrollToExample(ex.exampleId)}
 *
 * The first is the C15 toggle `body-activate-composition.test.tsx` already
 * forbids — but that test only ever saw a SYNTHETIC host, which is exactly how
 * four violations sat under it while it stayed green. The second drops the
 * element `ExampleCard` resolved, which sends `scrollToExample` down its
 * no-source branch: focus into the main editor, caret inside the block, an
 * unconditional scroll. `omni.tsx` documents that same drop as a defect it
 * already fixed (EX-F3-03) — the float is the surface the fix never reached,
 * which is the argument for a census rather than a sixth careful edit.
 *
 * Two rules, both read off the REAL sources:
 *
 *   1. No card-body `onSelect` can resolve to `null`. The composition that
 *      invokes it (`useAnchoredCard.onBodyActivate`) selects in the store
 *      FIRST and mirrors the host slot after, so a select that can say `null`
 *      reaches into the one selection authority and undoes it.
 *   2. Every card-body `onJump` forwards the element. A handler that binds a
 *      parameter must USE it in the body AFTER the arrow (so the declaration
 *      alone cannot satisfy the rule), and a handler that binds none may not
 *      CALL anything — `() => {}` is the inert stand-in a draft/unanchored card
 *      legitimately passes, `() => jump(id)` is a dropped element.
 *
 * Both rules were planted against the real tree in both directions before this
 * file was trusted.
 */

const ROOT = join(__dirname, "..", "..");

/** Every `.tsx` on the card/panel/host surfaces — where a card body is mounted. */
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

/** Every `<prop>={…}` expression in a file, as source text. */
function handlers(text: string, prop: "onSelect" | "onJump"): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${prop}=\\{`, "g"))) {
    out.push(braceSlice(text, m.index + prop.length + 1));
  }
  return out;
}

const rel = (f: string): string => f.slice(ROOT.length + 1);

/**
 * The ONE exemption to rule 2, and it is DERIVED rather than granted.
 *
 * An Errors card resolves its element like every other card, and both of its
 * visual mounts drop it — but not because they re-derived anything: the
 * capability they forward (`ErrorJump.jump`) has no element parameter to put it
 * in, and neither does the door beneath it (`scrollToParagraphId(uuid)`). That
 * is a missing CHANNEL in another authority, not a host recomputing what its
 * card already decided, and giving errors an element-aligned jump is its own
 * piece of work with its own semantics (the `"line"` mount scrolls CodeMirror
 * and has no element channel even in principle).
 *
 * So the exemption holds only while the channel is genuinely absent: the moment
 * `ErrorJump.jump` learns to take an element, this returns false and the two
 * sites below must thread it like everyone else.
 */
function errorJumpHasNoElementChannel(): boolean {
  const src = readFileSync(join(ROOT, "panels", "Errors", "error-jump.ts"), "utf8");
  const m = src.match(/\bjump:\s*\(([^)]*)\)\s*=>/);
  return !!m && !/HTMLElement/.test(m[1]);
}

/** The sites that exemption covers — pinned, so a THIRD element-less jump
 *  cannot hide behind a reason that was written for these two. */
const ELEMENT_LESS_BY_CAPABILITY = [
  "panels/Errors/ErrorsPanel.tsx",
  "panels/Errors/omni.tsx",
];

describe("the select slot's TYPE (the half a census cannot reach)", () => {
  it("cannot be handed a null id", () => {
    const seen: string[] = [];
    const slot = (id: string): void => {
      seen.push(id);
    };
    // @ts-expect-error — `null` is not a selectable id. This IS the guard: the
    // retired toggle's whole shape is a select that can resolve to null, and
    // `SelectSlot` makes writing one a compile error rather than a convention.
    selectMirror(slot, null);
    selectMirror(slot, "id")();
    expect(seen).toEqual(["id"]);
  });
});

describe("card-body contract census (task 724)", () => {
  const files = sources();

  it("sees the real registration table (a census over nothing is vacuous)", () => {
    const floats = readFileSync(join(ROOT, "cards", "floats", "index.tsx"), "utf8");
    // 14 poppable kinds mount a body with a select slot; 11 of them offer a jump.
    expect(handlers(floats, "onSelect").length).toBeGreaterThanOrEqual(14);
    expect(handlers(floats, "onJump").length).toBeGreaterThanOrEqual(10);
    // …and the wider population the same two rules govern.
    const all = files.flatMap((f) => handlers(readFileSync(f, "utf8"), "onSelect"));
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  it("no card-body select can resolve to null (the C15 toggle)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of handlers(readFileSync(f, "utf8"), "onSelect")) {
        if (/\bnull\b/.test(h)) offenders.push(`${rel(f)}: ${h.replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every card-body jump forwards the element it was handed", () => {
    const offenders: string[] = [];
    const exempt: string[] = [];
    const channelless = errorJumpHasNoElementChannel();
    for (const f of files) {
      for (const h of handlers(readFileSync(f, "utf8"), "onJump")) {
        const arrow = h.indexOf("=>");
        if (arrow === -1) continue; // a forwarded reference / built door — nothing to drop
        const param = h.slice(0, arrow).match(/\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*$/);
        const body = h.slice(arrow + 2);
        if (!param) {
          // No parameter bound. Permitted only for the inert stand-in, which
          // calls nothing; anything else jumped WITHOUT the element.
          if (!/[A-Za-z_$][\w$]*\s*\(/.test(body)) continue;
          if (channelless && /\bjump\.jump\(/.test(body)) {
            exempt.push(rel(f));
            continue;
          }
          offenders.push(`${rel(f)}: jumps with no source element — ${h.replace(/\s+/g, " ")}`);
          continue;
        }
        const p = param[1].replace(/[$]/g, "\\$");
        if (!new RegExp(`\\b${p}\\b`).test(body)) {
          offenders.push(`${rel(f)}: binds "${param[1]}" but never forwards it`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The derived exemption covers exactly the two sites it was written for.
    expect([...new Set(exempt)].sort()).toEqual(ELEMENT_LESS_BY_CAPABILITY);
  });
});
