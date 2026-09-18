/**
 * Lifecycle WRONG-FLAG assertion (test-hardening chip, Session-17 handoff).
 *
 * `assertLifecycleCoverage` (src/panels/card-lifecycle-registry.tsx) is the
 * only check that a per-doc lifecycle registry provides EXACTLY the ops
 * `CARD_REGISTRY[kind].lifecycle` declares — but it's a dev-only
 * console.error fired at runtime from EditorPane, invisible to CI. This
 * suite arms it: it fails `npx vitest run` (the coherence.yml typecheck job)
 * if the checker ever stops catching a wrong flag, and pins each mismatch
 * direction:
 *
 *   - a WIRED-but-UNDECLARED op (silently granting clone/delete to an
 *     all-false kind, e.g. "filling" the R18/R19 permanent gaps),
 *   - a DECLARED-but-UNWIRED op (capability silently dropped),
 *   - a bindAnchor mismatch (the Mode-B re-bind the duplicate cascade needs),
 *   - and that a registry built EXACTLY per the declarations is silent.
 *
 * AND THE SECOND HALF (task 635): the leg that reads the REAL registry.
 *
 * Everything above verifies the CHECKER against a synthetic registry derived
 * from `CARD_REGISTRY` itself. That is worth having and it is not the whole
 * job: the thing being checked is a `useMemo` literal inside `EditorPane`, and
 * for months nothing in CI ever looked at it. The type system did not cover the
 * gap either — `CardLifecycleRegistry` is `Partial<Record<CardKind, …>>`, so
 * dropping `bindAnchor` from `cutter-suggestion` typechecks and ships — and
 * `assertLifecycleCoverage` returns early in production, so the one
 * machine-checkable statement about lifecycle capability was not machine-checked
 * where it is made.
 *
 * This suite's second describe closes that. It SLICES the `cardLifecycleRegistry`
 * memo out of `EditorPane.tsx` and runs the same both-directions comparison at
 * build time. The precedent is `card-anchor-authority-census.test.ts`'s
 * `marginaliaMarkers` leg (and `confirm-suppression`, `stack-pull-content-fidelity`,
 * `marginalia-lane-regime`): a source-reading guardrail that names its anchor and
 * fails with "re-point this leg" when the binding is renamed.
 *
 * WHY NOT export the builder so a test can call it. Cleaner in principle, and it
 * drags eight per-doc hooks into a fixture surface and changes production
 * structure to suit a test. The slice is cheap, precedented, and loud on a
 * rename — and this registry has ONE construction site by design (task 635 also
 * deleted the unread React-context door), so there is exactly one literal to
 * point at.
 *
 * WHAT THIS LEG MUST NOT DO: widen the assertion's semantics. The seven
 * all-false kinds are CORRECT — the flags gate the anchor-text CASCADE, not a
 * card's own UI delete (`src/cards/types.ts`, pinned by
 * `lifecycle-cascade-criterion.test.ts`). The leg asserts conformance to the
 * declaration, never that more kinds ought to be wired.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { REPO_ROOT, strip, swallowedLines } from "@/lib/__tests__/_source-scan";
import {
  assertLifecycleCoverage,
  type CardLifecycle,
  type CardLifecycleRegistry,
} from "@/panels/card-lifecycle-registry";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

/** Build a registry that wires EXACTLY what each kind declares. */
function conformingRegistry(): CardLifecycleRegistry {
  const reg: CardLifecycleRegistry = {};
  for (const k of CARD_KINDS) {
    const d = CARD_REGISTRY[k].lifecycle;
    if (!d.clone && !d.delete && !d.bindAnchor) continue; // nothing to wire
    const entry: Partial<CardLifecycle> = {};
    if (d.clone) entry.clone = () => null;
    if (d.delete) entry.delete = () => {};
    if (d.bindAnchor) entry.bindAnchor = () => {};
    reg[k] = entry as CardLifecycle;
  }
  return reg;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertLifecycleCoverage (the lifecycle wrong-flag check, CI-armed)", () => {
  it("a registry wired exactly per CARD_REGISTRY declarations is SILENT", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    assertLifecycleCoverage(conformingRegistry());
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("catches a WIRED-but-UNDECLARED op (filling a permanent gap, e.g. example.clone)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // R19: example is a PERMANENT all-false gap — wiring a clone is exactly
    // the "wrong flag" a future chip might ship.
    reg.example = { clone: () => null, delete: () => {} } as CardLifecycle;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"example"');
  });

  it("catches a DECLARED-but-UNWIRED op (capability silently dropped, e.g. note)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // note declares { clone:true, delete:true, bindAnchor:true } — drop it
    // from the provider entirely.
    delete reg.note;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"note"');
  });

  it("catches a bindAnchor mismatch in either direction", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // footnote declares bindAnchor: false — wiring one is a wrong flag…
    reg.footnote = {
      ...(reg.footnote as CardLifecycle),
      bindAnchor: () => {},
    };
    // …and cutter-comment declares bindAnchor: true — unwiring it is too.
    const cc = { ...(reg["cutter-comment"] as CardLifecycle) };
    delete (cc as Partial<CardLifecycle>).bindAnchor;
    reg["cutter-comment"] = cc;
    assertLifecycleCoverage(reg);
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"footnote"');
    expect(msg).toContain('"cutter-comment"');
  });

  it("one error per mismatched kind, none for conforming kinds", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    reg.example = { clone: () => null, delete: () => {} } as CardLifecycle;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The REAL registry (task 635)
// ───────────────────────────────────────────────────────────────────────────

const EDITOR_PANE = path.join(REPO_ROOT, "src", "components", "EditorPane.tsx");

/** The binding the leg is pointed at. Renaming it in `EditorPane.tsx` must fail
 *  here with a message saying so, not silently stop checking anything. */
const ANCHOR = "const cardLifecycleRegistry = useMemo";

/** The op vocabulary `CardLifecycle` publishes. Kept as a literal list rather
 *  than derived from the interface (types are erased at runtime) — but the
 *  parser asserts the literal supplies NOTHING outside it, so a new op added to
 *  the interface and wired in `EditorPane` fails this file until it is named
 *  here and given a `CardMeta.lifecycle` column. That is the intended cost: a
 *  fourth lifecycle op is a spine change, not a quiet one. */
const OPS = ["clone", "delete", "bindAnchor"] as const;
type OpName = (typeof OPS)[number];

interface ParsedRegistry {
  /** kind key → the op keys that kind's entry supplies. */
  entries: Map<string, Set<string>>;
  /** 1-based line range of the sliced memo, for the swallow self-check. */
  lines: { from: number; to: number };
}

/**
 * Slice the `cardLifecycleRegistry` memo out of `EditorPane.tsx` and read which
 * ops each kind entry supplies.
 *
 * Brace/paren depth tracking rather than indentation, so a reformat cannot
 * quietly empty the result: entry keys are the `key: {` at depth 1, op keys the
 * `name:` at depth 2 outside any parens — which is what excludes the `id:` in
 * `delete: (id: string) => …` from reading as an op named "id".
 *
 * Comments are blanked (`strip`) so a comment mentioning `bindAnchor:` cannot
 * fabricate a wiring; string literals are KEPT, because the hyphenated kinds
 * (`"revision-comment"`) are quoted keys and stripping them would erase the
 * entries this leg exists to count.
 */
function parseLiveRegistry(): ParsedRegistry {
  const raw = readFileSync(EDITOR_PANE, "utf8");
  // keepStrings: true (quoted kind keys must survive), keepLines: true (so
  // offsets in the stripped view map to raw line numbers for the self-check).
  const src = strip(raw, true, true);

  const start = src.indexOf(ANCHOR);
  expect(
    start,
    `\`${ANCHOR}\` not found in EditorPane.tsx — renamed? re-point this leg. ` +
      "Do NOT delete it: it is the only build-time check that the live " +
      "lifecycle registry matches CARD_REGISTRY's declarations.",
  ).toBeGreaterThan(-1);

  const braceOpen = src.indexOf("=> ({", start);
  expect(
    braceOpen,
    "the cardLifecycleRegistry memo no longer returns a plain object literal " +
      "(`=> ({`) — this leg reads that literal; re-point it rather than " +
      "loosening it.",
  ).toBeGreaterThan(start);

  const entries = new Map<string, Set<string>>();
  // Walk from the `{` of `=> ({`.
  let i = braceOpen + "=> (".length + 1;
  let depth = 1;
  let paren = 0;
  /** Text seen at depth 1 — where entry keys live. */
  let atDepth1 = "";
  /** Text seen at depth 2 outside parens — where op keys live. */
  let atDepth2 = "";
  let currentKind: string | null = null;
  const n = src.length;

  while (i < n && depth > 0) {
    const c = src[i];
    // Skip whole string/template literals so a brace inside one can't move depth.
    if (c === '"' || c === "'" || c === "`") {
      const from = i;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      const lit = src.slice(from, Math.min(i, n));
      if (depth === 1) atDepth1 += lit;
      else if (depth === 2 && paren === 0) atDepth2 += lit;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "{") {
      if (depth === 1) {
        // The key immediately before this brace names the kind.
        const m = /(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))\s*:\s*$/.exec(atDepth1);
        currentKind = m ? (m[1] ?? m[2] ?? m[3]) : null;
        atDepth2 = "";
      }
      depth++;
      i++;
      continue;
    } else if (c === "}") {
      depth--;
      if (depth === 1 && currentKind != null) {
        const ops = new Set<string>();
        for (const m of atDepth2.matchAll(
          /(?:^|[^.\w$])(?:"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/g,
        )) {
          ops.add(m[1] ?? m[2]);
        }
        entries.set(currentKind, ops);
        currentKind = null;
      }
      i++;
      continue;
    }
    if (depth === 1) atDepth1 += c;
    else if (depth === 2 && paren === 0) atDepth2 += c;
    i++;
  }

  // `keepLines` kept the stripped view line-aligned with `raw`, so the slice's
  // newline count is the raw line span the swallow self-check must cover.
  const from = raw.slice(0, raw.indexOf(ANCHOR)).split("\n").length;
  const to = from + src.slice(start, i).split("\n").length - 1;
  return { entries, lines: { from, to } };
}

/** Parsed once, but INSIDE a leg: a `parseLiveRegistry()` in the describe body
 *  throws at collection time on a rename, and vitest then reports "no tests"
 *  with the message buried — a guardrail should name the leg it broke. */
let memo: ParsedRegistry | null = null;
const live = (): ParsedRegistry => (memo ??= parseLiveRegistry());

describe("the REAL lifecycle registry EditorPane builds conforms to CARD_REGISTRY (task 635)", () => {
  it("the slice is the live literal, not a stale or empty read", () => {
    // A source-reading leg that silently parses nothing is compliance-shaped
    // and worthless — the same failure mode `card-spine-export-census`'s
    // "censuses real files" leg guards. Pin both ends: some kinds were parsed,
    // and every key parsed is a real CardKind (a garbled parse yields junk
    // keys, not an empty map).
    const parsed = live();
    expect(parsed.entries.size).toBeGreaterThan(5);
    const kinds = [...parsed.entries.keys()];
    expect(
      kinds.filter((k) => !(CARD_KINDS as readonly string[]).includes(k)),
      "parsed a key that is not a CardKind — the slice or the depth walk drifted",
    ).toEqual([]);
  });

  it("every op the literal supplies is one this leg knows about", () => {
    // Fails OPEN rather than all-false (task 634's rule 4): a fourth lifecycle
    // op wired in EditorPane must not be silently ignored by the comparison
    // below — it must stop this file until it is declared on CardMeta too.
    const unknown = new Set<string>();
    for (const ops of live().entries.values()) {
      for (const op of ops) if (!(OPS as readonly string[]).includes(op)) unknown.add(op);
    }
    expect(
      [...unknown].sort(),
      "the live registry supplies an op outside `clone`/`delete`/`bindAnchor`. " +
        "Add it to OPS here AND to `CardLifecycleCapability` + every " +
        "`CARD_REGISTRY[kind].lifecycle` row, so the declaration still covers it.",
    ).toEqual([]);
  });

  it("the sliced region is whole — the scanner swallowed no line inside it", () => {
    // `strip` terminates a quoted string at a newline, so a stray quote
    // corrupts at most its own line. That is survivable everywhere EXCEPT
    // inside the slice, where a swallowed line could eat an entry and this
    // leg would report a capability gap that does not exist.
    const { from, to } = live().lines;
    const inside = swallowedLines(readFileSync(EDITOR_PANE, "utf8")).filter(
      (l) => l >= from && l <= to,
    );
    expect(inside, "an unterminated quoted string shrank the slice's view").toEqual([]);
  });

  it("declares what it wires and wires what it declares, for EVERY kind", () => {
    const parsed = live();
    const mismatches: string[] = [];
    for (const k of CARD_KINDS) {
      const declared = CARD_REGISTRY[k].lifecycle;
      const wired = parsed.entries.get(k) ?? new Set<string>();
      const has: Record<OpName, boolean> = {
        clone: wired.has("clone"),
        delete: wired.has("delete"),
        bindAnchor: wired.has("bindAnchor"),
      };
      for (const op of OPS) {
        if (declared[op] !== has[op]) {
          mismatches.push(
            `${k}.${op}: CARD_REGISTRY declares ${declared[op]}, ` +
              `EditorPane's cardLifecycleRegistry ${has[op] ? "wires" : "does not wire"} it`,
          );
        }
      }
    }
    expect(
      mismatches,
      "EditorPane's live lifecycle registry has drifted from CARD_REGISTRY's " +
        "declarations. These flags gate the anchor-text duplicate/delete " +
        "CASCADE, not a card's own UI delete — so fix whichever side is wrong, " +
        "and do not 'fill' a declared gap without reading the criterion in " +
        "`CardLifecycleCapability` (the all-false kinds are deliberate).",
    ).toEqual([]);
  });

  it("the parsed literal is the value actually handed to the API and the assertion", () => {
    // Without this, the leg above could be checking a literal nothing reads —
    // the "a registry earns its name by being read" failure, one level up.
    const src = strip(readFileSync(EDITOR_PANE, "utf8"), false);
    expect(
      src,
      "the sliced registry is no longer what builds the lifecycle API — the " +
        "leg above would be checking a dead literal",
    ).toContain("useCardLifecycleApi(cardLifecycleRegistry)");
    expect(
      src,
      "the dev-runtime half of this check (assertLifecycleCoverage) must still " +
        "run against the SAME literal CI reads",
    ).toContain("assertLifecycleCoverage(cardLifecycleRegistry)");
  });
});
