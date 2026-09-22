// Task 717 — ONE door for "clear the hover, but only if it is still mine".
//
// THE DEFECT this pins: `CardStore` published exactly one hover mutator,
// `setHover(ref | null)`, and NO consumer ever wanted its null leg. Every card
// wanted the same thing — release the slot only if it is still holding *me* —
// and with no door for it, 14 call sites re-derived it in three dialects:
//
//   A (6 sites, byte-identical)  const h = cardStore.getState().hover;
//                                if (h && h.kind === ac.ref.kind && h.id === ac.ref.id)
//                                  cardStore.setHover(null);
//   B (1 site)                   `pruneCardStoreFor`'s named `matches(s.hover)`
//   C (8 sites, UNGUARDED)       cardStore.setHover(h ? ac.ref : null)
//
// The split ran *inside* single panels — in Revisions the suggestion card
// guarded and the comment card did not; likewise Cutter; in Notes,
// `HighlightCard` guarded and `NoteCard` did not. That is the signature of a
// missing door, not of a per-card decision.
//
// HONESTY ABOUT SEVERITY (carried from the audit, task 717 filed at `low`):
// no user-visible failure was demonstrable. Both dialects hang off plain
// `mouseenter`/`mouseleave`, and the browser fires `mouseleave` on the old
// element BEFORE `mouseenter` on the new, so the obvious adjacent-card clobber
// does not occur today. The value is SSOT and prevention: if an ordering ever
// does invert (a portal, a delayed hover channel, a synthetic re-dispatch),
// dialect C is already wrong at eight sites.
//
// The leg with teeth is the CENSUS at the bottom. The store behaviour was never
// the part that could misbehave — a fifteenth surface picking a dialect by coin
// flip is, and `setHover(h ? ref : null)` type-checks perfectly.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";
import { createCardStore } from "../anchored-card-store";

const REPO = path.resolve(__dirname, "../../../..");

/** The one module allowed to spell the null leg's implementation. */
const STORE_FILE = "src/links/_shared/anchored-card-store.ts";

/**
 * The whole-doc hover AUTHORITY. `useTextHoverBridge` /
 * `usePanelCardHoverBridge` read the pointer against the editor, so this site
 * genuinely speaks for the slot: "the text says hover is now X, or nothing."
 * A card never can — it knows only its own pointer state.
 */
const AUTHORITY_FILE = "src/components/EditorPane.tsx";

/**
 * The two RE-KEYS. `rekeyCardStoreForMorph` moves every ref from `{fromKind,
 * id}` to `{toKind, id}` after a kind-change; the `regenIds` handler re-points
 * a ref onto a remapped atom id. Both are TRANSFERS, not clears, so neither
 * can be spelled with the card door — whose `true` leg takes the slot
 * unconditionally rather than "only if it was already mine".
 *
 * Deliberately NOT given store doors of their own: they are two call sites
 * with one copy each, in the module that is already the SSOT for both
 * operations — not the cluster this task retires. (Same verdict on the
 * SELECTION axis, which the task asked about: `clearSelection` has exactly one
 * identity-guarded caller, `pruneCardStoreFor` in this same file, and every
 * other caller is an authoritative click-away or kind filter. One instance is
 * not two dialects, so no `clearSelectionIf` is owed.)
 */
const REKEY_FILE = "src/links/_shared/inline-atom-lifecycle-policy.ts";

describe("CardStore.setHoverFor — the card door", () => {
  it("true takes the slot", () => {
    const store = createCardStore();
    store.setHoverFor({ kind: "note", id: "a" }, true);
    expect(store.getState().hover).toEqual({ kind: "note", id: "a" });
  });

  it("false clears when the hover is still mine, and notifies ONCE", () => {
    const store = createCardStore();
    store.setHover({ kind: "note", id: "a" });
    let notified = 0;
    store.subscribe(() => notified++);
    store.setHoverFor({ kind: "note", id: "a" }, false);
    expect(store.getState().hover).toBeNull();
    expect(notified).toBe(1);
  });

  it("false is a NO-OP when another surface now owns the hover — and notifies nobody", () => {
    const store = createCardStore();
    store.setHover({ kind: "note", id: "b" });
    let notified = 0;
    store.subscribe(() => notified++);
    store.setHoverFor({ kind: "note", id: "a" }, false);
    expect(store.getState().hover).toEqual({ kind: "note", id: "b" });
    expect(notified).toBe(0);
  });

  it("matches on BOTH kind and id — a same-id card of another kind is not me", () => {
    const store = createCardStore();
    store.setHover({ kind: "todo", id: "x" });
    store.setHoverFor({ kind: "note", id: "x" }, false);
    expect(store.getState().hover).toEqual({ kind: "todo", id: "x" });
  });

  it("false on an already-empty slot notifies nobody", () => {
    const store = createCardStore();
    let notified = 0;
    store.subscribe(() => notified++);
    store.setHoverFor({ kind: "note", id: "a" }, false);
    expect(notified).toBe(0);
  });

  it("true is equality-bailed like setHover — re-entering the same card is silent", () => {
    const store = createCardStore();
    store.setHoverFor({ kind: "note", id: "a" }, true);
    let notified = 0;
    store.subscribe(() => notified++);
    store.setHoverFor({ kind: "note", id: "a" }, true);
    expect(notified).toBe(0);
  });

  it("does not disturb the other two axes", () => {
    const store = createCardStore();
    store.select({ kind: "note", id: "a" });
    store.expand({ kind: "note", id: "a" });
    store.setHoverFor({ kind: "note", id: "a" }, true);
    store.setHoverFor({ kind: "note", id: "a" }, false);
    expect(store.getState().selected).toEqual({ kind: "note", id: "a" });
    expect(store.isExpanded({ kind: "note", id: "a" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — the door is an SSOT only if nothing else spells the operation.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const PROD = walk(path.join(REPO, "src"))
  .map((p) => path.relative(REPO, p))
  .filter((r) => !r.endsWith(".test.ts") && !r.endsWith(".test.tsx"))
  .sort();

/** Every `file:line` at which `setHover(` is called on something. */
function setHoverCallSites(): string[] {
  const out: string[] = [];
  for (const rel of PROD) {
    const src = codeOnlyLines(fs.readFileSync(path.join(REPO, rel), "utf8"));
    const re = /\.setHover\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      out.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return out;
}

describe("census — the null leg of setHover is unspellable outside its owners", () => {
  it("the population is non-empty (the scan actually reads source)", () => {
    expect(PROD.length).toBeGreaterThan(200);
    expect(PROD).toContain(STORE_FILE);
    expect(PROD).toContain(AUTHORITY_FILE);
  });

  it("only the AUTHORITY and the two re-keys call setHover — every card uses setHoverFor", () => {
    const callers = new Set(setHoverCallSites().map((s) => s.split(":")[0]));
    expect([...callers].sort()).toEqual([AUTHORITY_FILE, REKEY_FILE].sort());
  });

  it("both of the re-key file's setHover calls pass a MOVED ref, never a clear", () => {
    const sites = setHoverCallSites().filter((s) => s.startsWith(REKEY_FILE));
    expect(sites).toHaveLength(2);
    const src = fs.readFileSync(path.join(REPO, REKEY_FILE), "utf8").split("\n");
    const args = sites.map((s) => src[Number(s.split(":")[1]) - 1].trim());
    // A transfer names its destination; a clear would read `setHover(null)` —
    // which the null-able leg below also refuses, this file NOT being exempt.
    expect(args.every((a) => /setHover\(\s*(?:moved|\{)/.test(a))).toBe(true);
  });

  it("no shipped file outside the store passes a null-able expression to setHover", () => {
    // The authority's own call is the ternary's ONE legitimate home, so the
    // needle is scoped to the rest of the tree. A `setHover(null)` or
    // `setHover(x ? y : null)` anywhere else is the retired dialect.
    const offenders: string[] = [];
    for (const rel of PROD) {
      if (rel === STORE_FILE || rel === AUTHORITY_FILE) continue;
      // REKEY_FILE is deliberately NOT exempt: a re-key may pass a ref, never
      // a null — a `setHover(null)` there is the retired dialect like anywhere.
      const src = codeOnlyLines(fs.readFileSync(path.join(REPO, rel), "utf8"));
      const re = /\.setHover\s*\(\s*(?:null|[^)]*\?\s*[^)]*:\s*null)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file re-derives the identity guard inline (the retired dialect A)", () => {
    // `getState().hover` read, then compared field-by-field against a local ref
    // — the exact chained form all six dialect-A sites used. The store reads its
    // own `state.hover` directly, so it is not a hit. STATED LIMIT: a caller
    // that binds `const s = store.getState()` first and reads `s.hover` is
    // invisible here; `pruneCardStoreFor` does exactly that and is legitimate
    // (it reads all three axes at once). This leg retires the idiom, not every
    // conceivable spelling of it.
    const offenders: string[] = [];
    for (const rel of PROD) {
      const src = codeOnlyLines(fs.readFileSync(path.join(REPO, rel), "utf8"));
      const re = /getState\(\)\s*\.\s*hover/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
