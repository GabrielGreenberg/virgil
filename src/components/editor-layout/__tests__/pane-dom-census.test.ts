// Task 438 — the leg with TEETH for the per-pane DOM resolver.
//
// `pane-dom.ts` was never the part that could misbehave. A CALL SITE that never
// asks it is — and every one of the four that shipped the bug type-checked
// perfectly, because `document.querySelector('[data-dock-slot="left-0"]')` is a
// correct expression that simply answers about the wrong pane. No type, and no
// behavioural test of the resolver, can see that; only a source census can.
//
// The needle is a DOCUMENT-GLOBAL resolution of one of the three per-pane
// markers. A RELATIVE resolution — `closest("[data-panel-column-side]")` from an
// element already inside the pane, or `root.querySelector(…)` off a
// `containerRef` — needs no ladder and stays legal, so the needle asks for
// `document.querySelector` / `document.querySelectorAll` specifically.
//
// Allowlist: EMPTY. A hit is MIGRATE-it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  DocumentQueryScanner,
  HOLE,
  makeResolver,
  type DocumentQuery,
} from "./_document-query-scan";

const SRC = path.resolve(__dirname, "../../..");
const LIBRARY = path.resolve(SRC, "../library");

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules") continue;
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isTest = (f: string) =>
  f.includes(`${path.sep}__tests__${path.sep}`) || /\.test\.tsx?$/.test(f);

const PRODUCTION = [...walk(SRC), ...walk(LIBRARY)].filter((f) => !isTest(f));

/** Comments stripped, string literals KEPT — the marker names live inside
 *  quoted selectors, so `codeOnly` (which blanks literals) would erase the
 *  needle itself and every leg here would pass vacuously. Measured: it did,
 *  in this file's own first draft, and the canary below is what caught it.
 *  The COMMENT strip is what keeps the door's header — which names all three
 *  markers in prose — from indicting the door for describing itself. */
const CODE = new Map(
  PRODUCTION.map((f) => [f, commentsStripped(readFileSync(f, "utf8"))]),
);

const RAW = new Map(PRODUCTION.map((f) => [f, readFileSync(f, "utf8")]));
const SCANNER = new DocumentQueryScanner(RAW, makeResolver(SRC, RAW));

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

const DOOR = "components/editor-layout/pane-dom.ts";

/** Every per-PANE marker with a named door in `pane-dom.ts`.
 *  `data-virgil-row-scroll` is a sixth, censused separately below because its
 *  door is `layout-scroll.ts` (`findRowScroll`, whose ~dozen callers already
 *  import it by name). */
const PANE_MARKERS = [
  "data-panel-column-side",
  "data-flex-col",
  "data-stack-frame",
  "data-dock-slot",
  "data-strip-side",
  // Task 597. This one is the reason the derived leg at the bottom of this file
  // exists: it was a per-pane marker from the day `EditorPane` stamped it, and
  // nothing forced it onto this literal. It sat unlisted for the life of the
  // census while `print.ts` resolved it off `document`.
  "data-editor-page",
] as const;

/**
 * A DOCUMENT-GLOBAL DOM query whose folded selector mentions the marker. The
 * receiver and the argument are both RESOLVED on the parsed file (task 600):
 * `document.body.…`, `window.document.…`, `el.ownerDocument.…`, a `const d =
 * document` alias and a `root ?? document` fallback all count as global, and
 * `` `[${DATA_STACK_FRAME}]` `` counts as naming `data-stack-frame`. Stated
 * limits live in `_document-query-scan.ts`'s header.
 */
function hitsFor(queries: DocumentQuery[], marker: string): string[] {
  return queries.filter((q) => q.selector.includes(marker)).map((q) => q.hit);
}

/** A synthetic production file, scanned by a scanner that also sees the real
 *  tree — so a canary can import a real exported constant. */
function scanSynthetic(code: string, at = "components/editor-layout/__canary__.tsx") {
  const file = path.join(SRC, ...at.split("/"));
  const sources = new Map(RAW);
  sources.set(file, code);
  return new DocumentQueryScanner(sources, makeResolver(SRC, sources)).documentQueries(file);
}

describe("pane-dom census — no document-global resolution of a per-pane marker", () => {
  for (const marker of PANE_MARKERS) {
    it(`nothing outside the door resolves [${marker}] off document`, () => {
      const offenders: string[] = [];
      for (const [file, code] of CODE) {
        if (rel(file) === DOOR) continue;
        for (const hit of hitsFor(SCANNER.documentQueries(file), marker)) {
          offenders.push(`${rel(file)} → ${hit}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the row-scroll marker is resolved only by findRowScroll's door", () => {
    const SCROLL_DOOR = "components/editor-layout/layout-scroll.ts";
    const offenders: string[] = [];
    for (const [file, code] of CODE) {
      if (rel(file) === DOOR || rel(file) === SCROLL_DOOR) continue;
      for (const hit of hitsFor(SCANNER.documentQueries(file), "data-virgil-row-scroll")) {
        offenders.push(`${rel(file)} → ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the bare visible-pane ladder is called only inside its own door (task 584)", () => {
    // `findRowScroll()` answers "whichever pane is VISIBLE" — the right question
    // only for a caller with NO element in hand. Every production caller holds
    // one (an editor view, an entry), and must ask `findEditorScrollFor` /
    // `findRowScrollFor`, which resolve the element's OWN row and fall back to
    // the ladder only when it has none. The geometry service's IO root read
    // the bare ladder and was captured once per prime, so a pane primed while
    // hidden observed against another pane's scroller for its whole life.
    // Allowlist EMPTY outside the door.
    const SCROLL_DOOR = "components/editor-layout/layout-scroll.ts";
    const offenders: string[] = [];
    for (const [file, code] of CODE) {
      if (rel(file) === SCROLL_DOOR) continue;
      if (/\bfindRowScroll\s*\(/.test(code)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
    // Can-see canary: the needle matches the door's own definition.
    expect(/\bfindRowScroll\s*\(/.test(CODE.get(path.join(SRC, SCROLL_DOOR)) ?? "")).toBe(true);
  });

  it("only the two doors spell a marker inside the generic resolver", () => {
    // A caller could hold the generic resolver and re-derive a named door with
    // the wrong miss policy. One named door per marker: the three column/dock
    // ones in `pane-dom.ts`, the row-scroll one in `layout-scroll.ts` (whose
    // ~dozen callers already import `findRowScroll` by name).
    const ALLOWED = new Set([DOOR, "components/editor-layout/layout-scroll.ts"]);
    const offenders: string[] = [];
    for (const file of CODE.keys()) {
      const r = rel(file);
      if (ALLOWED.has(r)) continue;
      for (const call of SCANNER.callsTo(file, /^resolvePaneMarkers?$/)) {
        for (const marker of [...PANE_MARKERS, "data-virgil-row-scroll"]) {
          if (call.args.includes(marker)) offenders.push(`${r} → ${call.hit}  [${marker}]`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every converted call site reads the door", () => {
    const expected: Array<[string, string]> = [
      ["components/editor-layout/panel-column.tsx", "paneColumn("],
      ["components/editor-layout/dock-drag.ts", "paneColumns("],
      ["components/editor-layout/spawn-position.ts", "paneColumn("],
      ["components/FloatingPanel.tsx", "paneDockSlot("],
      ["components/editor-layout/layout-scroll.ts", "resolvePaneMarker("],
      ["components/EditorLayout.tsx", "paneFlexColumns("],
      ["components/editor-layout/drag-drop.tsx", "paneStrip("],
      ["lib/print.ts", "panePrintPage("],
    ];
    for (const [file, needle] of expected) {
      const code = CODE.get(path.join(SRC, ...file.split("/")));
      expect(code, `${file} not scanned`).toBeTruthy();
      expect(code!.includes(needle), `${file} must call ${needle}`).toBe(true);
    }
  });

  it("the miss policy is stated by every named door (no defaulted argument)", () => {
    // Read the CODE view, not the raw file: both policy literals appear in the
    // door's own HEADER PROSE, so a raw `toContain` passes even if every named
    // door dropped its argument — measured, in this file's first draft.
    const doorCode = CODE.get(path.join(SRC, ...DOOR.split("/")))!;

    // A default would be a decision nobody made: the two policies are opposite
    // fail-safes and the callers genuinely want different ones.
    expect(doorCode).not.toMatch(/onNoneVisible\s*:\s*PaneMarkerMiss\s*=/);

    // Every single-element door names its own policy inside its own call.
    const singleDoors: Array<[string, string]> = [
      ["paneColumn", "fail-open"],
      ["paneStrip", "fail-open"],
      ["paneDockSlot", "fail-closed"],
      ["panePrintPage", "fail-closed"],
    ];
    for (const [door, policy] of singleDoors) {
      const body = doorCode.slice(doorCode.indexOf(`export function ${door}`));
      // `indexOf("}")` would stop at a `${side}` interpolation inside the
      // selector; the function's own closer is a `}` at column 0.
      const call = body.slice(0, body.indexOf("\n}"));
      expect(call, `${door} must call resolvePaneMarker`).toContain(
        "resolvePaneMarker(",
      );
      expect(call, `${door} must state "${policy}"`).toContain(`"${policy}"`);
    }
    // …and the SET form is fail-open by construction, so it takes no argument.
    const setBody = doorCode.slice(doorCode.indexOf("export function resolvePaneMarkers"));
    expect(setBody.slice(0, setBody.indexOf("\n}"))).not.toContain("onNoneVisible");
  });

  it("the census can see a hit (canary)", () => {
    const synthetic = scanSynthetic(
      'export const x = (k: string) => document.querySelector<HTMLElement>(`[data-dock-slot="${k}"]`);',
    );
    expect(hitsFor(synthetic, "data-dock-slot")).toHaveLength(1);
    // …and does NOT fire on the relative form, which is legal.
    const relative = scanSynthetic(
      'export const f = (root: Element, el: Element) => { root.querySelector("[data-dock-slot]"); el.closest("[data-panel-column-side]"); };',
    );
    expect(hitsFor(relative, "data-dock-slot")).toEqual([]);
    expect(hitsFor(relative, "data-panel-column-side")).toEqual([]);
    // A comment that NAMES the violation is not one (the AST sees no call).
    expect(scanSynthetic('// document.querySelector("[data-dock-slot]")\nexport {};')).toEqual([]);
  });

  // Task 600 — one canary per spelling the regex needle could not see. Each is
  // a fixture written the missed way; each must be FLAGGED.
  describe("the needle sees every spelling of the same violation (task 600 canaries)", () => {
    const flags = (code: string, marker: string) =>
      expect(hitsFor(scanSynthetic(code), marker), code).toHaveLength(1);

    it("a selector built from a LOCAL constant", () => {
      flags(
        'const ATTR = "data-stack-frame"; export const f = () => document.querySelector(`[${ATTR}]`);',
        "data-stack-frame",
      );
    });

    it("a selector built from an IMPORTED constant (the real DATA_STACK_FRAME)", () => {
      // `omni-bin-slot.ts` exports it; `panel-column.tsx` interpolates it off
      // `col.` today, which is legal only because of the receiver.
      flags(
        'import { DATA_STACK_FRAME as F } from "./omni-bin-slot";\nexport const f = () => document.querySelector<HTMLElement>(`[${F}]`);',
        "data-stack-frame",
      );
      flags(
        'import { DATA_STACK_FRAME } from "@/components/editor-layout/omni-bin-slot";\nexport const f = () => document.querySelectorAll(`[${DATA_STACK_FRAME}]`);',
        "data-stack-frame",
      );
    });

    it("string concatenation", () => {
      flags(
        'export const f = (k: string) => document.querySelector("[data-" + "dock-slot=\\"" + k + "\\"]");',
        "data-dock-slot",
      );
    });

    it("getElementById", () => {
      flags('export const f = () => document.getElementById("data-flex-col");', "data-flex-col");
    });

    it("an ALIASED document receiver", () => {
      flags(
        'const d = document; export const f = () => d.querySelector("[data-flex-col]");',
        "data-flex-col",
      );
      flags(
        'export const f = () => { const doc = window.document; return doc.body.querySelector("[data-flex-col]"); };',
        "data-flex-col",
      );
    });

    it("an ownerDocument receiver", () => {
      flags(
        'export const f = (el: Element) => el.ownerDocument.querySelector("[data-strip-side]");',
        "data-strip-side",
      );
      flags(
        'export const f = (el: Element) => el.ownerDocument?.querySelector("[data-strip-side]");',
        "data-strip-side",
      );
    });

    it("a `?? document` fallback receiver", () => {
      flags(
        'export const f = (root?: Element) => (root ?? document).querySelector("[data-panel-column-side]");',
        "data-panel-column-side",
      );
    });

    it("a nested `)` inside the argument does not truncate it", () => {
      // The regex's `[^)]*` stopped at `attrOf(x)`'s closer and never saw the
      // literal marker after it.
      flags(
        'declare function attrOf(x: unknown): string;\nexport const f = (x: unknown, k: string) => document.querySelector(`[${attrOf(x)}="1"][data-dock-slot="${k}"]`);',
        "data-dock-slot",
      );
    });

    it("a marker name reached through a `const` object literal (task 645)", () => {
      // The move this fold exists for: a selector stops spelling its marker
      // and reads it off an SSOT row instead. Before the fold, that turned a
      // SEEN global read into a HOLE — the census went quiet about a read that
      // had not gone anywhere, and the exemption that named it rotted. Dotted
      // and string-keyed, and through the `as const satisfies …` an SSOT table
      // is declared with.
      flags(
        'const R = { footnote: { domIdAttr: "data-dock-slot" } } as const satisfies Record<string, { domIdAttr: string }>;\n' +
          "export const f = (id: string) => document.querySelector(`[${R.footnote.domIdAttr}=\"${id}\"]`);",
        "data-dock-slot",
      );
      flags(
        'const R = { "inline-math": { a: "data-strip-side" } } as const;\n' +
          'export const f = () => document.querySelector(`[${R["inline-math"].a}]`);',
        "data-strip-side",
      );
      // …and it must still be a HOLE where the path is NOT a const object
      // literal, so the fold cannot invent coverage it does not have.
      const [q] = scanSynthetic(
        "declare const R: { a: { b: string } };\n" +
          "export const f = () => document.querySelector(`[${R.a.b}]`);",
      );
      expect(q.selector).toBe(`[${HOLE}]`);
    });

    it("the real registry path folds — the two atom markers stay SEEN", () => {
      // Not synthetic: `marker-clicks.ts` reads `ATOM_REGISTRY.<kind>.domIdAttr`
      // across a module boundary (task 645), and the two `data-*-id` entries in
      // EXEMPT_GLOBAL_MARKERS below are earned by exactly those two calls. If
      // this fold regresses, the rot leg fails rather than the coverage going
      // silent — which is the whole point.
      const file = path.join(SRC, "components/editor-layout/event-bridges/marker-clicks.ts");
      const selectors = SCANNER.documentQueries(file).map((q) => q.selector);
      expect(selectors.some((sel) => sel.includes("data-footnote-id"))).toBe(true);
      expect(selectors.some((sel) => sel.includes("data-citation-id"))).toBe(true);
    });

    it("an unfoldable part becomes a HOLE, never a false marker", () => {
      const [q] = scanSynthetic(
        'declare function attrOf(x: unknown): string;\nexport const f = (x: unknown) => document.querySelector(`[${attrOf(x)}]`);',
      );
      expect(q.selector).toBe(`[${HOLE}]`);
    });
  });

  it("the comment strip does not swallow the file (self-check)", () => {
    const doorCode = CODE.get(path.join(SRC, ...DOOR.split("/")))!;
    // The door's own header names all three markers in PROSE; the strip is what
    // keeps this census from indicting the door for describing itself.
    expect(doorCode).toContain("export function resolvePaneMarker");
    expect(doorCode).toContain("export function paneDockSlot");
  });
});

/**
 * THE DERIVED LEG — task 597. The census above asks its question once per name
 * in a HAND-KEPT list, and that is exactly how `[data-editor-page]` walked
 * through it: it was a per-pane marker from the day `EditorPane` stamped it,
 * `print.ts` resolved it off `document`, and no line of this file mentioned it.
 * A guard whose coverage is a literal ages out silently while its allowlist
 * stays proudly empty.
 *
 * So the question is INVERTED. The needle is no longer "is one of these five
 * names resolved globally" but **"is ANY `data-*` attribute resolved off
 * `document` in production"** — and the answer must be listed below WITH A
 * REASON or the leg fails. A newly stamped per-pane marker read globally now
 * fails on its first commit, with no list to remember to grow.
 *
 * STATED LIMIT (the same one every leg above carries — see
 * `_document-query-scan.ts`): this sees the marker names a selector FOLDS to.
 * Since task 600 that includes names reached through `const` bindings (local or
 * imported) and concatenation; a selector computed at runtime is still unseen.
 */
const EXEMPT_GLOBAL_MARKERS: Record<string, string> = {
  // ── per-CARD, not per-PANE. The door's header scopes these OUT by name and
  //    states why (`omni-card-placement.ts` already answers this question for
  //    the card family; widening the pane door to every `data-*` in the app is
  //    the broadest-blast-radius mistake). They are a real hazard one level
  //    down — a card key can exist in two mounted panes — but they are a
  //    DIFFERENT door's business, and moving them here would hide that.
  "data-card-key": "per-CARD lookup — owned by the card-placement door, not this one",
  "data-pristine-card-id": "per-CARD sweep (drop-mode) — same family as data-card-key",
  // Task 645: these two are no longer spelled as literals — `marker-clicks.ts`
  // reads them off `ATOM_REGISTRY.<kind>.domIdAttr`. They stay VISIBLE here
  // because the scanner now folds a path into a `const` object literal; the leg
  // above pins that, so an SSOT read can never quietly become a blind spot.
  "data-footnote-id":
    "per-ATOM id inside a document — a marker-click jump, not pane chrome (registry-templated since task 645)",
  "data-citation-id":
    "per-ATOM id inside a document — a marker-click jump, not pane chrome (registry-templated since task 645)",
  "data-contains-active-card":
    "per-CARD state flag, read only alongside [data-floating-panel]",
  // Task 600: these two were always read off `document` (the reconciler's
  // panel-card sweep, through DATA_CARD_SELECTED / DATA_CARD_HOVERED); the
  // regex needle never saw them because the selector spells only constants.
  "data-card-selected":
    "per-CARD state flag, swept alongside [data-card-key] in the anchor-highlight reconciler",
  "data-card-hovered":
    "per-CARD state flag, swept alongside [data-card-key] in the anchor-highlight reconciler",

  // ── genuinely DOCUMENT-level: one instance per window, by construction.
  "data-floating-panel":
    "floats portal to <body>, so the float layer is document-level — there is no per-pane set to pick from",
  "data-swiftlatex":
    "the <script> tag in the app shell — one per window, above every pane",
  "data-virgil-drag-ghost":
    "the drag ghost is appended to <body> — one live gesture per window, above every pane (task 600: GHOST_ATTR-built, invisible to the regex needle)",
};

/** Every `data-*` name a document-global selector folds to. */
function globalMarkerNames(queries: DocumentQuery[]): Array<{ name: string; hit: string }> {
  const out: Array<{ name: string; hit: string }> = [];
  for (const q of queries) {
    for (const n of q.selector.match(/data-[a-z0-9-]+/g) ?? []) {
      out.push({ name: n, hit: q.hit });
    }
  }
  return out;
}

describe("pane-dom census, derived — any document-global data-* read is listed or it fails", () => {
  const DOORS = new Set([DOOR, "components/editor-layout/layout-scroll.ts"]);

  /** Every production hit, once, with the file that spells it. */
  function survey() {
    const hits: Array<{ file: string; name: string; hit: string }> = [];
    for (const file of CODE.keys()) {
      const r = rel(file);
      if (DOORS.has(r)) continue;
      for (const { name, hit } of globalMarkerNames(SCANNER.documentQueries(file))) {
        hits.push({ file: r, name, hit });
      }
    }
    return hits;
  }

  it("no unlisted marker is resolved off document anywhere in production", () => {
    const offenders = survey()
      .filter((h) => !(h.name in EXEMPT_GLOBAL_MARKERS))
      .map((h) => `${h.file} → ${h.hit}  [${h.name}]`);
    // Pre-597 this listed `lib/print.ts → document.querySelector<HTMLElement>
    // ('[data-editor-page]')`, which no leg above could see.
    expect(offenders).toEqual([]);
  });

  it("every exemption is still earned by a real call site (no rotting reasons)", () => {
    // A registry earns its name by being read: an exemption whose call site is
    // gone is a standing permission nobody asked for. Delete it instead.
    const seen = new Set(survey().map((h) => h.name));
    const stale = Object.keys(EXEMPT_GLOBAL_MARKERS).filter((k) => !seen.has(k));
    expect(stale).toEqual([]);
  });

  it("every exemption states a reason", () => {
    for (const [k, why] of Object.entries(EXEMPT_GLOBAL_MARKERS)) {
      expect(why.length, `${k} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("the derived census can see a NEW marker nobody listed (canary)", () => {
    const synthetic = scanSynthetic(
      'export const el = document.querySelector<HTMLElement>("[data-brand-new-pane-thing]");',
    );
    const names = globalMarkerNames(synthetic).map((h) => h.name);
    expect(names).toEqual(["data-brand-new-pane-thing"]);
    expect(names.every((n) => n in EXEMPT_GLOBAL_MARKERS)).toBe(false);
    // …and the relative form, which is legal, is still invisible to it.
    expect(
      globalMarkerNames(
        scanSynthetic('export const f = (root: Element) => root.querySelector("[data-brand-new-pane-thing]");'),
      ),
    ).toEqual([]);
  });

  it("the derived census would have caught task 597's actual line", () => {
    const synthetic = scanSynthetic(
      "export const editorPage = document.querySelector<HTMLElement>('[data-editor-page]');",
    );
    const names = globalMarkerNames(synthetic).map((h) => h.name);
    expect(names).toEqual(["data-editor-page"]);
    expect(names[0] in EXEMPT_GLOBAL_MARKERS).toBe(false);
  });
});
