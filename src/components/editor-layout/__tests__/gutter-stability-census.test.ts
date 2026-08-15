// Task 328 — the leg with TEETH for the gutter-stability doctrine.
//
// The necessity predicate was never the part that could misbehave. A
// reposition call site that never asks it is — and that is exactly the shape
// that shipped: SIX paths could move a card or scroll the document to
// re-place one, five of them unconditionally, and the sixth (`usePlacement`)
// carrying a private `Math.abs(anchorY - cardY) < 8` copy of a rule nothing
// else knew existed. No type can see that; only a source census can.
//
// Two needles, one per axis of movement:
//
//   • `omniPinStore.requestPin(`  — moves the CARD (and re-cascades the deck
//     around it). Legal only inside `omni-card-placement.ts`, the door that
//     asks the rule and pins at the card's current top when the answer is no.
//
//   • `alignEntryToY(`            — moves the DOCUMENT (it scrolls the shared
//     row, so an unconditional align drags the whole paper to re-place a card
//     the user can already see). Legal only inside `layout-scroll.ts`, which
//     defines it and offers `alignEntryToYIfNeeded`.
//
// The second needle is asked PER LINE inside its own defining file, not just
// per file: `layout-scroll.ts` is precisely where a seventh bypass would be
// most convenient to write, and a file-scoped exemption would wave it through.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

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

/** Comments stripped, string literals stripped — a needle inside either is a
 *  mention, not a call. (Every one of the doc-comments this task wrote names
 *  `alignEntryToY`; without the strip the census would indict its own prose.) */
const CODE = new Map(
  PRODUCTION.map((f) => [f, codeOnly(readFileSync(f, "utf8"))]),
);

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

const PIN_DOOR = "components/editor-layout/omni-card-placement.ts";
const SCROLL_DOOR = "components/editor-layout/layout-scroll.ts";

describe("card axis — omniPinStore.requestPin has exactly one caller", () => {
  it("no production file outside the placement door writes a pin", () => {
    const offenders = [...CODE.entries()]
      .filter(([, code]) => /\brequestPin\s*\(/.test(code))
      .map(([f]) => rel(f))
      // The store DECLARES the method; the door CALLS it.
      .filter((f) => f !== "components/editor-layout/omni-pin-store.ts")
      .filter((f) => f !== PIN_DOOR);
    // A hit is MIGRATE-it (call `requestOmniCardPlacement` / `holdOmniCard`),
    // never an allowlist entry: a second publisher asks no necessity question
    // at all, which is the whole of the defect.
    expect(offenders).toEqual([]);
  });

  it("the door itself is present and asks the rule", () => {
    const door = CODE.get(path.join(SRC, PIN_DOOR));
    expect(door, `${PIN_DOOR} must exist`).toBeTruthy();
    expect(door).toMatch(/mayReposition\s*\(/);
    expect(door).toMatch(/requestPin\s*\(/);
  });
});

describe("document axis — alignEntryToY has one home", () => {
  it("no production file outside layout-scroll scrolls the row unconditionally", () => {
    // `alignEntryToYIfNeeded(` does not match: the needle ends at the paren.
    const offenders = [...CODE.entries()]
      .filter(([, code]) => /\balignEntryToY\s*\(/.test(code))
      .map(([f]) => rel(f))
      .filter((f) => f !== SCROLL_DOOR);
    expect(offenders).toEqual([]);
  });

  it("layout-scroll uses it in exactly the two sanctioned places", () => {
    const src = CODE.get(path.join(SRC, SCROLL_DOOR))!;
    // The declaration is not a call.
    const calls =
      src.replace(/function\s+alignEntryToY\s*\(/g, " ").match(/\balignEntryToY\s*\(/g) ??
      [];
    // 1. `alignEntryToYIfNeeded`'s own move branch — the gated door.
    // 2. `scrollHeadingToActiveLine` — the Outline's click-to-jump, a
    //    deliberate "take me there" NAVIGATION rather than an incidental
    //    reposition, and the one exemption in this doctrine. Asked per LINE
    //    rather than per file precisely because this file is where a third,
    //    ungated call would be most convenient to add.
    expect(calls.length).toBe(2);
    expect(src).toMatch(/mayReposition\s*\(/);
  });

  it("the gated door and the visible-only scroll door are both exported", () => {
    const src = readFileSync(path.join(SRC, SCROLL_DOOR), "utf8");
    expect(src).toMatch(/export function alignEntryToYIfNeeded/);
    expect(src).toMatch(/export function scrollEntryIntoViewIfNeeded/);
  });
});

describe("no call site keeps a private copy of the rule", () => {
  it("the pre-328 `< 8` alignment skip is gone from usePlacement", () => {
    const src = CODE.get(path.join(SRC, "links/_shared/usePlacement.ts"))!;
    expect(src).not.toMatch(/anchorY/);
    expect(src).toMatch(/alignEntryToYIfNeeded\s*\(/);
  });

  it("the four named publishers all enter a door", () => {
    // The two pin publishers (marker click, `virgil-card-jumped`) …
    const layout = CODE.get(path.join(SRC, "components/EditorLayout.tsx"))!;
    expect(
      (layout.match(/requestOmniCardPlacement\s*\(/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    // … and the two jump paths, whose pin rides the scroll's verdict: the
    // `virgil-card-jumped` dispatch must sit behind the align door's report,
    // because the pin exists only to compensate for a scroll that happened.
    const links = CODE.get(path.join(SRC, "links/links.ts"))!;
    const dispatches = links.match(/moved\s*&&\s*omniKey/g) ?? [];
    expect(dispatches.length).toBe(2);
  });
});

describe("census self-check", () => {
  it("sees a synthetic offender in each channel", () => {
    // A canary must not stand on the defect (nor on a live production line),
    // so both fixtures are synthetic.
    const fixture = codeOnly(
      [
        "// omniPinStore.requestPin(side, id, y) — prose, must not count",
        'const s = "alignEntryToY(el, y)"; // literal, must not count',
        "omniPinStore.requestPin(side, id, y);",
        "alignEntryToY(el, y);",
      ].join("\n"),
    );
    expect((fixture.match(/\brequestPin\s*\(/g) ?? []).length).toBe(1);
    expect((fixture.match(/\balignEntryToY\s*\(/g) ?? []).length).toBe(1);
  });

  it("scanned a plausible number of production files", () => {
    expect(PRODUCTION.length).toBeGreaterThan(500);
  });
});
