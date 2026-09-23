import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";
import { CARD_REGISTRY } from "../card-registry";
import { CARD_KINDS, isInlineAtomCardKind, isAnchoredCardKind } from "../predicates";
import { carriesModeBAnchor, MODE_B_CARD_KINDS } from "../mode-b-collections";
import type { CardKind } from "../types";

/**
 * A3 Commit G (WS3) criterion pin-test, REBUILT ON THE DERIVATION (task 721).
 *
 * The `CardMeta.lifecycle` booleans drive the anchor-text duplicate/delete
 * CASCADE — the Mode-B `linkedAnchor` text-range walker (`duplicate-slice` /
 * `delete-range`) + the inline-atom kinds whose markers ride the slice — NOT
 * the card's own UI delete.
 *
 * WHAT WAS WRONG WITH THE OLD CRITERION. It defined walker-reachability as
 * `isInlineAtomCardKind(k) || CARD_REGISTRY[k].lifecycle.bindAnchor` — the
 * flag under test. So the suite asked whether the declaration agreed with
 * ITSELF, which it always does, and three kinds (todo / report /
 * report-request) sat all-false for months behind a comment asserting they were
 * "Mode-A paragraph-anchored, no text-range anchor for the cascade to reach."
 * They carry the mark. `carriesModeBAnchor` said so all along, derived from
 * `anchored` + the crosswalk's `legacyDataKind`, and the walkers key on the
 * MARK, not on the flag — so the flag never described reachability, it only
 * decided whether a reachable kind was served. The criterion now reads the
 * derivation, and the declaration answers to it:
 *
 *   • REACHABLE ≝ the kind rides an inline atom (footnote / citation) OR it
 *     carries a Mode-B `linkedAnchor` mark (`carriesModeBAnchor`). Both halves
 *     are facts about what the walkers encounter in the document.
 *   • `clone` / `delete` / `bindAnchor` are declared, but they are NOT free:
 *     a reachable kind is served (all three true), an unreachable one is not
 *     (all three false). `bindAnchor` in particular is exactly
 *     `carriesModeBAnchor` — an inline atom has no range to re-bind.
 *   • The registry cannot compute this itself (`carriesModeBAnchor` is derived
 *     FROM the registry — deriving the field there is a cycle), which is why
 *     the value stays declared and this suite is the tie.
 *
 * To take a reachable kind OUT of the cascade deliberately, the exception has
 * to be argued HERE, in `RATIFIED_EXCEPTIONS` — not asserted in a row comment
 * nobody re-derives.
 */

/** Reachable by the duplicate/delete walkers — DERIVED from what the walkers
 *  actually encounter, never from the flag they gate. */
const walkerReachable = (k: CardKind): boolean =>
  isInlineAtomCardKind(k) || carriesModeBAnchor(k);

const cascadeCapable = (k: CardKind): boolean =>
  CARD_REGISTRY[k].lifecycle.clone || CARD_REGISTRY[k].lifecycle.delete;

/** Reachable kinds deliberately kept OUT of the cascade. Empty today: every
 *  exception that ever lived here turned out to be unreachable anyway
 *  (`archive` carries no mark; `example` is an origin:derived mirror). A new
 *  entry is a product decision and must carry its reason in a comment. */
const RATIFIED_EXCEPTIONS: readonly CardKind[] = [];

describe("lifecycle cascade criterion (A3/WS3, derived — task 721)", () => {
  it("cascade capability IS walker reachability, in both directions", () => {
    for (const k of CARD_KINDS) {
      if (RATIFIED_EXCEPTIONS.includes(k)) continue;
      expect(
        cascadeCapable(k),
        `${k}: reachable=${walkerReachable(k)} but cascadeCapable=${cascadeCapable(k)}. ` +
          "The walkers key on the MARK/atom, not on this flag — so a reachable " +
          "kind declared cascade-less is a capability silently withheld, and an " +
          "unreachable one declared capable is a dead wiring. Fix the flag, or " +
          "argue the exception in RATIFIED_EXCEPTIONS.",
      ).toBe(walkerReachable(k));
    }
  });

  it("clone and delete move together — no half-cascade", () => {
    for (const k of CARD_KINDS) {
      const l = CARD_REGISTRY[k].lifecycle;
      expect(l.clone, `${k}: clone/delete disagree`).toBe(l.delete);
    }
  });

  it("`bindAnchor` is exactly `carriesModeBAnchor` — it is not a free flag", () => {
    for (const k of CARD_KINDS) {
      expect(
        CARD_REGISTRY[k].lifecycle.bindAnchor,
        `${k}: bindAnchor must equal carriesModeBAnchor(${k})=${carriesModeBAnchor(k)}. ` +
          "An inline atom has no range to re-bind; a Mode-B kind always does.",
      ).toBe(carriesModeBAnchor(k));
    }
  });

  it("every all-false kind is genuinely unreachable (not merely declared so)", () => {
    for (const k of CARD_KINDS) {
      if (cascadeCapable(k) || RATIFIED_EXCEPTIONS.includes(k)) continue;
      expect(walkerReachable(k), `${k}: all-false but the walkers reach it`).toBe(false);
      if (isAnchoredCardKind(k)) {
        // An all-false ANCHORED kind is anchored WITHOUT a text-range mark —
        // Mode-A/atom-less (`archive`, R18) or an origin:derived mirror
        // (`example`, R19). Derived, not asserted: `carriesModeBAnchor` is
        // already false here, so the only extra fact worth pinning is that it
        // is not an inline atom either.
        expect(isInlineAtomCardKind(k), `${k}: all-false yet atom-borne`).toBe(false);
      }
    }
  });

  it("pins the cascade-capable set (inline atoms + every Mode-B kind)", () => {
    const capable = CARD_KINDS.filter(cascadeCapable).sort();
    expect(capable).toEqual(
      [
        "citation",
        "footnote",
        ...MODE_B_CARD_KINDS,
      ].sort(),
    );
    // …and the Mode-B nine, spelled out once so a change to the derivation
    // itself is visible here rather than silently re-pinning.
    expect([...MODE_B_CARD_KINDS].sort()).toEqual(
      [
        "note",
        "highlight",
        "todo",
        "report",
        "report-request",
        "revision-comment",
        "revision-suggestion",
        "cutter-comment",
        "cutter-suggestion",
      ].sort(),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The PROSE half — the rationale, not just the value (task 721)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The flags above are now tied to the derivation, but the defect this suite was
 * rebuilt for lived in a COMMENT: three rows asserted "Mode-A paragraph-anchored,
 * no text-range anchor for the cascade to reach", the word "permanent" closed
 * the question, and nothing ever checked the sentence against anything. A
 * correct flag under a false rationale is one refactor away from being wrong
 * again, because the next author reads the sentence.
 *
 * So: a Mode-B kind's own registry row may not contain a phrase denying it has
 * a text-range anchor. Scoped to the kind's own row (brace-depth sliced), so a
 * comment ELSEWHERE in the file contrasting the two modes is unaffected.
 *
 * It is a ban on the SENTENCE, so it also refuses a row that QUOTES the old
 * rationale while correcting it — deliberately, and confirmed the first time
 * this suite ran: describe what the row used to declare, don't reprint it.
 */
const REGISTRY_SRC = path.join(REPO_ROOT, "src", "cards", "card-registry.tsx");

/** Phrases that deny a text-range anchor. Kept as prose because that is what
 *  they are — the point is that a Mode-B row cannot say them. */
const DENIALS: readonly { re: RegExp; what: string }[] = [
  { re: /Mode[- ]A\b/, what: "calls the kind Mode-A" },
  { re: /no text-range anchor/i, what: '"no text-range anchor"' },
  { re: /no cascade reaches it/i, what: '"no cascade reaches it"' },
];

/** Slice `CARD_REGISTRY`'s per-kind rows out of the source by brace depth.
 *  Returns kind → the row's raw text (its comments included — they are the
 *  subject). */
function registryRows(): Map<string, string> {
  const src = readFileSync(REGISTRY_SRC, "utf8");
  const start = src.indexOf("export const CARD_REGISTRY");
  expect(
    start,
    "`export const CARD_REGISTRY` not found in card-registry.tsx — renamed? " +
      "re-point this leg rather than deleting it.",
  ).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  const rows = new Map<string, string>();
  let depth = 0;
  let key: string | null = null;
  let from = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      depth++;
      if (depth === 2) {
        // Walk back to the `key:` that opened this row.
        const head = src.slice(src.lastIndexOf("\n", i - 1) + 1, i);
        const m = /^\s*"?([a-z-]+)"?\s*:\s*$/.exec(head.replace(/\{\s*$/, ""));
        key = m ? m[1] : null;
        from = i;
      }
    } else if (ch === "}") {
      if (depth === 2 && key) {
        rows.set(key, src.slice(from, i + 1));
        key = null;
      }
      depth--;
      if (depth === 0) break;
    }
  }
  return rows;
}

describe("registry rationale: a Mode-B row may not deny its own anchor", () => {
  it("slices every declared kind's row (guard is not vacuous)", () => {
    const rows = registryRows();
    for (const k of CARD_KINDS) {
      expect(rows.has(k), `no row sliced for "${k}" — re-point the slicer`).toBe(true);
    }
  });

  it("no Mode-B kind's row claims it has no text-range anchor", () => {
    const rows = registryRows();
    for (const k of MODE_B_CARD_KINDS) {
      const row = rows.get(k) ?? "";
      for (const d of DENIALS) {
        expect(
          d.re.test(row),
          `CARD_REGISTRY["${k}"] ${d.what}, but carriesModeBAnchor("${k}") is true ` +
            "— the row is denying the mark the walkers actually find on it. " +
            "That sentence is how todo/report/report-request stayed out of the " +
            "cascade for months (task 721).",
        ).toBe(false);
      }
    }
  });
});
