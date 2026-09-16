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
 * A DOCUMENT-GLOBAL `querySelector` / `querySelectorAll` whose argument mentions
 * the marker — the generic-typed `document.querySelector<HTMLElement>(…)` form
 * and a template literal included, and `document.body.…` as well as `document.…`
 * (the `body` receiver resolves exactly the same set and reads like the relative
 * form).
 *
 * STATED LIMITS, because a census that overstates its reach is the failure mode
 * this whole family is about: the needle sees a literal `document` receiver, so
 * an ALIASED one (`const d = document; d.querySelector(…)`), a `getElementById`,
 * or a selector assembled from string parts would pass. None is an idiom this
 * repo uses; the `?? document` fallback that DID read as relative was retired in
 * `panel-primitives.tsx` rather than exempted.
 */
function globalHits(code: string, marker: string): string[] {
  // `querySelectorAll?` would mean "querySelectorAl" + an optional "l" and
  // miss the singular form entirely — measured, in this file's first draft.
  const re =
    /document(?:\s*\.\s*body)?\s*\.\s*querySelector(?:All)?\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m[1].includes(marker)) out.push(m[0]);
  }
  return out;
}

describe("pane-dom census — no document-global resolution of a per-pane marker", () => {
  for (const marker of PANE_MARKERS) {
    it(`nothing outside the door resolves [${marker}] off document`, () => {
      const offenders: string[] = [];
      for (const [file, code] of CODE) {
        if (rel(file) === DOOR) continue;
        for (const hit of globalHits(code, marker)) {
          offenders.push(`${rel(file)} → ${hit.trim()}`);
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
      for (const hit of globalHits(code, "data-virgil-row-scroll")) {
        offenders.push(`${rel(file)} → ${hit.trim()}`);
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
    for (const [file, code] of CODE) {
      const r = rel(file);
      if (ALLOWED.has(r)) continue;
      for (const marker of [...PANE_MARKERS, "data-virgil-row-scroll"]) {
        const re = new RegExp(`resolvePaneMarkers?\\s*\\(\\s*[^)]*${marker}`);
        if (re.test(code)) offenders.push(`${r} → resolvePaneMarker(… ${marker} …)`);
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
    const synthetic = commentsStripped(
      'const x = document.querySelector<HTMLElement>(`[data-dock-slot="${k}"]`);',
    );
    expect(globalHits(synthetic, "data-dock-slot")).toHaveLength(1);
    // …and does NOT fire on the relative form, which is legal.
    const relative = commentsStripped(
      'const y = root.querySelector("[data-dock-slot]"); const z = el.closest("[data-panel-column-side]");',
    );
    expect(globalHits(relative, "data-dock-slot")).toEqual([]);
    expect(globalHits(relative, "data-panel-column-side")).toEqual([]);
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
 * STATED LIMIT (the same one `globalHits` carries): this sees the marker NAMES
 * a call spells literally. A selector assembled entirely from interpolated
 * constants (`` `[${ATTR}]` ``) mentions no literal `data-` and is invisible
 * here, as it is to every leg above. The idiom the repo actually uses spells
 * at least one name literally — measured: all eleven current hits do.
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
  "data-footnote-id": "per-ATOM id inside a document — a marker-click jump, not pane chrome",
  "data-citation-id": "per-ATOM id inside a document — a marker-click jump, not pane chrome",
  "data-contains-active-card":
    "per-CARD state flag, read only alongside [data-floating-panel]",

  // ── genuinely DOCUMENT-level: one instance per window, by construction.
  "data-floating-panel":
    "floats portal to <body>, so the float layer is document-level — there is no per-pane set to pick from",
  "data-swiftlatex":
    "the <script> tag in the app shell — one per window, above every pane",
};

/** Every `data-*` name a document-global selector spells literally. */
function globalMarkerNames(code: string): Array<{ name: string; hit: string }> {
  const re =
    /document(?:\s*\.\s*body)?\s*\.\s*querySelector(?:All)?\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  const out: Array<{ name: string; hit: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    for (const n of m[1].match(/data-[a-z0-9-]+/g) ?? []) {
      out.push({ name: n, hit: m[0].trim().replace(/\s+/g, " ") });
    }
  }
  return out;
}

describe("pane-dom census, derived — any document-global data-* read is listed or it fails", () => {
  const DOORS = new Set([DOOR, "components/editor-layout/layout-scroll.ts"]);

  /** Every production hit, once, with the file that spells it. */
  function survey() {
    const hits: Array<{ file: string; name: string; hit: string }> = [];
    for (const [file, code] of CODE) {
      const r = rel(file);
      if (DOORS.has(r)) continue;
      for (const { name, hit } of globalMarkerNames(code)) {
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
    const synthetic = commentsStripped(
      'const el = document.querySelector<HTMLElement>("[data-brand-new-pane-thing]");',
    );
    const names = globalMarkerNames(synthetic).map((h) => h.name);
    expect(names).toEqual(["data-brand-new-pane-thing"]);
    expect(names.every((n) => n in EXEMPT_GLOBAL_MARKERS)).toBe(false);
    // …and the relative form, which is legal, is still invisible to it.
    expect(
      globalMarkerNames(
        commentsStripped('root.querySelector("[data-brand-new-pane-thing]");'),
      ),
    ).toEqual([]);
  });

  it("the derived census would have caught task 597's actual line", () => {
    const synthetic = commentsStripped(
      "const editorPage = document.querySelector<HTMLElement>('[data-editor-page]');",
    );
    const names = globalMarkerNames(synthetic).map((h) => h.name);
    expect(names).toEqual(["data-editor-page"]);
    expect(names[0] in EXEMPT_GLOBAL_MARKERS).toBe(false);
  });
});
