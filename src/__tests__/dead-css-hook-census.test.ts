import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssCommentsStripped, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";
import {
  LEGACY_TOKEN_CROSSWALK,
  cssTokenForCardKind,
  normalizeLegacyCardKind,
} from "@/cards/legacy-token-crosswalk";

/** The two columns, read off the crosswalk itself — a `Record<CardKind, …>`,
 *  so the compiler already keeps it total. Reading the table rather than a
 *  separate kind list keeps this leg's import to the SSOT it is about. */
const column = (k: "cssToken" | "legacyDataKind"): Set<string> =>
  new Set(
    Object.values(LEGACY_TOKEN_CROSSWALK)
      .map((row) => row[k])
      .filter((t): t is string => t !== null),
  );

/**
 * DEAD CSS HOOK CENSUS — does this selector's hook have a PRODUCER?
 * (task 2026-09-01-525.)
 *
 * The repo already runs the two adjacent halves of this question and NEITHER
 * can see the shape this file exists for:
 *
 *   • `phantom-css-var.test.ts`      — does a `var()` READ resolve to a definition?
 *   • `inert-preference-controls.ts` — does a declared token have a READER?
 *
 * Both are about CUSTOM PROPERTIES. The missing third is about the SELECTOR:
 * a class or attribute value the stylesheet matches on that nothing in either
 * silo can ever stamp on an element. That is task 202's dead-SSOT law in its
 * CSS medium — **a dead rule is worse than no rule, because the next reader
 * reaches for the declared path believing it is the enforced one.**
 *
 * That is not hypothetical here. `.footnote-highlight-marker` had ZERO
 * producers and had nonetheless been migrated onto `var(--footnote-200)` by
 * §8's rust consumer sweep, with a comment reasoning about the change; so had
 * `.footnote-card-drop-target` (onto `--footnote-50`). Two maintenance passes
 * read dead rules and treated them as live. `.paper-render-pod`'s own comment
 * described a wiring (`wraps <EditorContent>` inside RightDetail) that no
 * longer exists, next to a `PaperRender.tsx` that writes the same pod tokens
 * inline. Ten class hooks and one attribute value were retired in 525; this
 * census is what keeps them retired and catches the eleventh.
 *
 * ── Two questions, two shapes ───────────────────────────────────────────
 *
 * 1. CLASS hooks (leg 1) — an open vocabulary, so the census is a grep with a
 *    small STATED allowlist: a class is produced by a string in production
 *    TS/TSX, or by a dependency, or it is a declared affordance whose wiring
 *    is a routed decision. Fail-open in the permissive direction (see
 *    `isProduced`): a census whose hits are DELETIONS must not over-report.
 *
 * 2. ATTRIBUTE-VALUE hooks (legs 2–3) — a CLOSED vocabulary, so the census is
 *    a DERIVATION with an EMPTY allowlist. `data-paragraph-kind`'s only writer
 *    is `cssTokenForCardKind`, so the legal value set IS the crosswalk's
 *    `cssToken` column; `data-link-card`'s is `createLinkedAnchor`, so its
 *    legal prefix set is the `legacyDataKind` column plus the legacy on-disk
 *    tokens the load funnel normalizes. This is the leg with teeth: it is how
 *    `[data-paragraph-kind="report-request"]` was dead *by derivation* rather
 *    than by deletion — `report-request`'s `cssToken` is `"report"`, the fork
 *    `legacy-token-crosswalk.ts` exists to declare, so the rule was a Mode-A
 *    restatement of the Mode-B vocabulary, where `report-request:` IS live.
 */

const SHEETS = ["src/app/globals.css", "library/styles/library.css"] as const;
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** Comment-stripped stylesheet text. A class merely NAMED in prose — which is
 *  exactly what every 525 retirement note does — is not a selector. */
const sheet = (rel: string) => cssCommentsStripped(read(rel));

/* ── Leg 1: class hooks ─────────────────────────────────────────────────── */

/**
 * Classes the stylesheets are entitled to match on although no production
 * string in `src/` or `library/` spells them.
 *
 * TWO reasons, and they are different claims — an exemption is scoped to the
 * shape it justifies (task 204), never to a file or a convenient prefix:
 *
 *  • `dependency` — a third party stamps it on DOM it owns. `pkg` names the
 *    package, and the corroboration leg below re-checks that the package still
 *    produces the string, so an upgrade that renames it fails here instead of
 *    leaving a standing licence.
 *
 *  • `routed` — a DECLARED affordance whose producer is unwired. Deleting it
 *    silently retires a design; wiring it changes what the app looks like.
 *    Either way that is Gabriel's call, not a cleanup's, so it is parked here
 *    with the question stated rather than decided unattended.
 */
type Unproduced =
  | { kind: "dependency"; pkg: string; why: string }
  | { kind: "routed"; why: string };

const PERMITTED_UNPRODUCED_CLASSES: Record<string, Unproduced> = {
  "cm-editor": {
    kind: "dependency",
    pkg: "@codemirror/view",
    why: "CodeMirror 6's own editor root class (the code view / preamble editor).",
  },
  "csl-bib-body": {
    kind: "dependency",
    pkg: "citeproc",
    why: "citeproc's CSL bibliography HTML, rendered into the Bibliography panel.",
  },
  "csl-entry": {
    kind: "dependency",
    pkg: "citeproc",
    why: "citeproc's per-entry CSL wrapper — sibling of csl-bib-body.",
  },
  "is-editor-empty": {
    kind: "dependency",
    pkg: "@tiptap/extensions",
    why: "TipTap Placeholder's default `emptyEditorClass`; configured in editor-extensions.ts.",
  },
  "katex-display": {
    kind: "dependency",
    pkg: "katex",
    why: "KaTeX's own wrapper for `displayMode: true` output.",
  },
  "iconbtn-lg": {
    kind: "routed",
    why:
      "The 32x32 step of the documented `iconbtn-*` size scale (STYLE_GUIDE 'Buttons'). " +
      "Its siblings -xs/-sm/-md are all consumed; only -lg has no current caller. " +
      "Dropping a documented step out of a size scale is a design-system decision.",
  },
  "iconbtn-on-dark": {
    kind: "routed",
    why:
      "A documented `iconbtn-*` variant (dark-overlay hover) that " +
      "docs/virgil-design-system/questions-for-gabriel.md records as adopted by " +
      "TargetIcon/TargetFileIcon — a claim that is no longer true. Same call as -lg.",
  },
  "is-menu-open": {
    kind: "routed",
    why:
      "A DESIGNED grab-handle state (`.text-object-grab-handle.is-menu-open`, documented in " +
      "STYLE_GUIDE beside the live `.is-pressed`) whose producer was never wired: the handle " +
      "gets no open-state chrome while its DragHandleMenu is up. Deleting it retires the " +
      "design; wiring it is a visible UI change. Both are Gabriel's, so it is parked, not cut.",
  },
};

/** Every class name either stylesheet matches on, with the sheets that do. */
function declaredClasses(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const rel of SHEETS) {
    for (const m of sheet(rel).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      const set = out.get(m[1]) ?? new Set<string>();
      set.add(rel);
      out.set(m[1], set);
    }
  }
  return out;
}

/** Production TS/TSX in both silos — the only thing that stamps a class on an
 *  element. CSS cross-references are declarations, not producers. */
function productionSource(): string {
  const files = [...trackedFiles("src", /\.(ts|tsx)$/), ...trackedFiles("library", /\.(ts|tsx)$/)]
    .filter((p) => !/__tests__|\.test\.[tj]sx?$/.test(p))
    .filter((p) => !p.endsWith(path.join("src", "__tests__", "dead-css-hook-census.test.ts")));
  return files.map((p) => readFileSync(p, "utf8")).join("\n");
}

const MIN_FRAGMENT = 3;

/**
 * Is this class stamped by production code?
 *
 * Three readings, because a class name is routinely ASSEMBLED and a census
 * that only knew the literal form would flag every template family
 * (`heading-wrapper-l${n}`, `show-dividers-${n}`, `rtf-content-${variant}`).
 * Measured on the pre-525 tree: literal-only reports 43 hits, of which 26 are
 * template families — a census nobody would read. With both interpolation
 * directions it reports 17, of which 10 were genuinely dead.
 *
 * The `MIN_FRAGMENT` floor keeps a two-character tail from matching the whole
 * repo. It is deliberately PERMISSIVE at the margin: a missed producer costs a
 * spurious allowlist entry, while an over-report costs a deletion of live
 * chrome. A census whose hits are deletions fails open.
 */
function isProduced(cls: string, blob: string): boolean {
  if (blob.includes(cls)) return true;
  // `class-${suffix}` — a literal PREFIX followed by an interpolation.
  for (let i = cls.length - 1; i >= MIN_FRAGMENT; i--) {
    if (blob.includes(cls.slice(0, i) + "${")) return true;
  }
  // `${prefix}-class` — an interpolation followed by a literal SUFFIX.
  for (let i = 0; i + MIN_FRAGMENT <= cls.length; i++) {
    if (blob.includes("}" + cls.slice(i))) return true;
  }
  return false;
}

/** Does `pkg` still ship the string? Bounded walk of the installed package. */
function dependencyShips(pkg: string, needle: string): boolean | null {
  const dir = path.join(REPO_ROOT, "node_modules", ...pkg.split("/"));
  if (!existsSync(dir)) return null; // no install — corroboration unavailable
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".")) stack.push(p);
        continue;
      }
      if (!/\.(js|mjs|cjs|css|ts)$/.test(e.name)) continue;
      try {
        if (statSync(p).size > 8_000_000) continue;
        if (readFileSync(p, "utf8").includes(needle)) return true;
      } catch {
        /* unreadable — keep walking */
      }
    }
  }
  return false;
}

describe("dead CSS hook census — class selectors", () => {
  it("every class the stylesheets match on has a producer, or a stated reason", () => {
    const blob = productionSource();
    const unproduced: string[] = [];
    for (const [cls, sheets] of [...declaredClasses()].sort()) {
      if (isProduced(cls, blob)) continue;
      if (cls in PERMITTED_UNPRODUCED_CLASSES) continue;
      unproduced.push(`${cls}  [${[...sheets].join(", ")}]`);
    }
    expect(
      unproduced,
      "These class selectors can never match an element — nothing in src/ or " +
        "library/ stamps them. A hit is DELETE-it, not an allowlist entry, " +
        "unless it is a dependency's own class or a routed design decision.",
    ).toEqual([]);
  });

  it("CANARY: the census can see a class nothing produces", () => {
    const blob = productionSource();
    expect(isProduced("virgil-nonexistent-hook-canary", blob)).toBe(false);
    // …and it does NOT over-report the two assembled forms it exists to allow.
    expect(isProduced("rtf-content-footnote", blob)).toBe(true); // `rtf-content-${variant}`
    expect(isProduced("hide-par-titles", blob)).toBe(true); // literal
  });

  it("every allowlist entry still names a class the stylesheets declare", () => {
    const declared = declaredClasses();
    const stale = Object.keys(PERMITTED_UNPRODUCED_CLASSES).filter((c) => !declared.has(c));
    expect(
      stale,
      "An exemption that has stopped excusing anything is a standing licence " +
        "for the next dead hook to land under that name.",
    ).toEqual([]);
  });

  it("every allowlist entry still needs its exemption (none has gained a producer)", () => {
    const blob = productionSource();
    const nowProduced = Object.keys(PERMITTED_UNPRODUCED_CLASSES).filter((c) =>
      isProduced(c, blob),
    );
    expect(
      nowProduced,
      "These classes now have producers — drop them from the allowlist so the " +
        "census speaks for them again.",
    ).toEqual([]);
  });

  it("each `dependency` exemption's package still ships the class", () => {
    const drifted: string[] = [];
    for (const [cls, entry] of Object.entries(PERMITTED_UNPRODUCED_CLASSES)) {
      if (entry.kind !== "dependency") continue;
      const ships = dependencyShips(entry.pkg, cls);
      if (ships === null) continue; // no node_modules — corroboration unavailable
      if (!ships) drifted.push(`${cls} (${entry.pkg})`);
    }
    expect(
      drifted,
      "The named dependency no longer produces this class — the rule is now " +
        "dead and the exemption is a standing licence.",
    ).toEqual([]);
  });
});

/* ── Legs 2–3: attribute-value hooks (derived, allowlist EMPTY) ─────────── */

describe("dead CSS hook census — attribute values are DERIVED, not hand-listed", () => {
  const globals = sheet("src/app/globals.css");

  it("every [data-paragraph-kind=…] value is in the crosswalk's cssToken column", () => {
    const legal = column("cssToken");
    const used = new Set(
      [...globals.matchAll(/\[data-paragraph-kind="([^"]+)"\]/g)].map((m) => m[1]),
    );
    // Guard against a vacuous pass: the selector shape must still exist.
    expect(used.size).toBeGreaterThan(0);
    expect(
      [...used].filter((v) => !legal.has(v)).sort(),
      "`cssTokenForCardKind` is the attribute's ONLY writer, so its codomain " +
        "is the complete legal value set. A rule for anything else matches " +
        "nothing, ever — `report-request` (cssToken `report`) was exactly that.",
    ).toEqual([]);
  });

  it("every .linked-anchor[data-link-card^=…] prefix is a legacyDataKind or a legacy on-disk token", () => {
    const legal = column("legacyDataKind");
    // Pre-spine sidecars persisted `comment` / `cut`; the load funnel
    // normalizes them, and the CSS keeps the aliases. `normalizeLegacyCardKind`
    // is what says a token is one of those, so the leg asks IT rather than
    // re-listing the pair.
    const used = new Set(
      [...globals.matchAll(/\[data-link-card\^="([^":]+):"\]/g)].map((m) => m[1]),
    );
    expect(used.size).toBeGreaterThan(0);
    expect(
      [...used]
        .filter((v) => !legal.has(v) && normalizeLegacyCardKind(v) === null)
        .sort(),
      "`createLinkedAnchor` stamps only `legacyDataKind` tokens, and the load " +
        "funnel normalizes only the legacy pair. Anything else is a dead prefix.",
    ).toEqual([]);
  });

  it("NON-REGRESSION: a report-request card still paints its Mode-A rail, through `report`", () => {
    // The one way this cleanup could be wrong: deleting the Mode-A
    // `report-request` rule must not leave the kind unpainted.
    expect(cssTokenForCardKind("report-request")).toBe("report");
    expect(globals).toMatch(/\[data-paragraph-kind="report"\]\s*\{/);
    // …and its Mode-B span keeps its OWN token, which is live and distinct.
    expect(LEGACY_TOKEN_CROSSWALK["report-request"].legacyDataKind).toBe("report-request");
    expect(globals).toContain('[data-link-card^="report-request:"]');
  });
});

/* ── Leg 4: the retirement pins ─────────────────────────────────────────── */

describe("the hooks retired in task 525 stay retired", () => {
  /**
   * COMMENT-STRIPPED, deliberately. Every deletion here left a note at the
   * site naming what it removed and why — this repo renegotiates a retired
   * claim in place — so a raw-source needle would outlaw the very prose the
   * fix is made of.
   */
  const RETIRED: Record<string, (typeof SHEETS)[number]> = {
    "citation-node-bar": "src/app/globals.css",
    "citation-node-text": "src/app/globals.css",
    "footnote-highlight-marker": "src/app/globals.css",
    "footnote-card-drop-target": "src/app/globals.css",
    "footnote-content-editor": "src/app/globals.css",
    "hide-scrollbar": "src/app/globals.css",
    "note-editor": "src/app/globals.css",
    "note-marker-selected": "src/app/globals.css",
    "toolbar-scroll": "src/app/globals.css",
    "paper-render-pod": "library/styles/library.css",
  };

  it("none of the ten retired classes is a selector again", () => {
    const bySheet = new Map(SHEETS.map((rel) => [rel, sheet(rel)]));
    const back = Object.entries(RETIRED).filter(([cls, rel]) =>
      new RegExp(`\\.${cls}\\b`).test(bySheet.get(rel)!),
    );
    expect(back.map(([c]) => c)).toEqual([]);
  });

  it("the retirement NOTES survive (the stripper is what makes that legal)", () => {
    // A canary for the leg above: the names ARE still in the file, in prose.
    // If this fails, the notes were deleted and the leg above is passing for
    // the wrong reason.
    const raw = read("src/app/globals.css");
    expect(raw).toContain("footnote-highlight-marker");
    expect(raw).toContain("citation-node-bar");
    expect(read("library/styles/library.css")).toContain("paper-render-pod");
  });
});
