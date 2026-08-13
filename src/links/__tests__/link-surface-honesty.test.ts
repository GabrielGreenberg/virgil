// The Link surface exports nothing that nothing calls (task 202).
//
// THE LAW
//
//   A value exported from `src/links/**` is alive only if something CALLS it.
//   A re-export is not a caller.
//
// The second sentence is the whole finding. `src/links/` was introduced as a
// phased migration; its READ half (`resolveLink` / `jumpToLink` / `jumpToCard`
// / `deleteLink` / `collectLinksFromEditor`) landed and is genuinely live, and
// its WRITE half never did. `createLink` + `createFootnoteLink` +
// `createCitationLink` + `createAnchorLink` had zero callers for three months
// while real footnote/citation creation went through the atom commands and real
// anchors through `createLinkedAnchor`. `LINK_REGISTRY` presented as "the single
// source of truth for the Link taxonomy" and no component or hook read it: its
// `connectorStroke` styled a `<LinkConnector>` hard-deleted in 96675ca1, its
// `multiplicity` was enforced by an `enforceMultiplicity` nobody invoked (the
// invariant held structurally, by id minting), and its `cardKind` column was
// decided in `collectLinksFromEditor`. A dead SSOT is worse than none: the next
// contributor reaches for `createLink` believing it is the enforced path.
//
// And the reason none of it looked dead: `links.ts` re-exported the lot.
// `enforceMultiplicity` had a "reference" in `src/`; so did `LINK_REGISTRY`,
// `resolveCardKind`, `resolveLinkPanel`, `LinkMultiplicityError`. Every grep a
// reviewer would run came back green. So the census below STRIPS
// `export { … } from "…"` clauses before counting — a barrel entry proves the
// symbol was published, never that it was wanted.
//
// Scope, stated honestly. This censuses VALUE exports (function / class / const)
// in `src/links/**`, not the whole repo — the phenomenon is this surface's
// stalled migration, and a repo-wide version would need a much larger allowlist
// to say the same thing. Type exports are excluded: a `…Args` interface that
// only names its own function's signature is normal, not dead. In-file use
// COUNTS as alive, so a dead mutually-recursive cluster is caught at its entry
// point (which is where deleting it starts anyway).
//
// The DOM contract half is the same law read forwards: what survived the cut is
// `link-dom-contract.ts`, and it only stays honest if the call sites actually go
// through it rather than hand-writing the attribute names beside it.
//
// TASK 204 — the half task 202 left open, and WHY it left it open. 202 closed
// the PRODUCERS and wrote "READS stay free" into the leg below, on the stated
// ground that `[data-link-card="citation:${id}"]` reads better than
// `` `[${DATA_LINK_CARD}="${key}"]` ``. That reason was correct and the
// conclusion drawn from it was not: the module owned two rungs of a three-rung
// ladder — the attribute NAMES and the token GRAMMAR — and not the SELECTOR,
// which is the only form either is ever used in at a query site. With no third
// rung the only alternative to the literal really was the ugly one, so the
// missing rung made the wrong answer the better-reading one. The sibling
// grammar had all three the whole time (`cardPopKey` / `parseAnyKey` /
// `cardDomSelector`, the last pinned byte-exact by
// `card-key-seams-contract.test.ts`).
//
// Two live consequences it left behind, neither visible to the 202 legs:
//   - a COMPOSITE address hand-copied — `marker-clicks.ts` and
//     `panel-selection.ts` each spelled the footnote and citation entry
//     selectors, byte for byte, in two files with no shared owner;
//   - the PARSER half of the grammar with a second speller —
//     `useTextHoverBridge` read `getAttribute("data-link-card")` and then did
//     `indexOf(":")` + two slices, which is `parseLinkCardKey` re-typed. The
//     token leg below matches BUILD shapes only, so a hand parse was
//     structurally invisible to it. Both failure modes are the same one: the
//     query stops MATCHING rather than stops compiling.
// So the name census is now TOTAL over both silos (writes AND reads AND bare
// `getAttribute` names), and a parse leg sits beside the build leg.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  DATA_LINK_KIND,
  linkCardIdSelector,
  linkCardKey,
  linkCardSelector,
  linkIdSelector,
  linkKindSelector,
  parseLinkCardKey,
} from "../link-dom-contract";

const SRC = path.resolve(__dirname, "../..");
const LINKS = path.join(SRC, "links");
const LIBRARY = path.resolve(SRC, "../library");

/** Every `.ts`/`.tsx` under `root`, excluding `node_modules`. */
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

/** Source with the two things that FALSELY look like references removed:
 *  comments (a doc-comment naming a symbol is a mention, not a call) and
 *  re-export clauses (`export { X } from "…"` / `export * from "…"` — the
 *  exact mechanism that hid this whole surface for three months). Import
 *  clauses are deliberately KEPT: an unused import is a lint error, so an
 *  import really does imply a use in that file. */
function callableText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g, " ")
    .replace(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*["'][^"']+["']\s*;?/g, " ")
    // The SPLIT barrel: `import { X } from "…"` on one line, `export { X };` on
    // another. Semantically identical to the one-statement form and already the
    // idiom in this very directory (`usePlacement.ts`, `resolve-card-anchor.ts`),
    // so stripping only the one-liner closed ONE SPELLING of the blind spot —
    // the two lines then counted as two references and any dead export
    // re-published this way read alive. Only the `export` half is stripped; the
    // `import` half stays, because an unused import is a lint error and so does
    // imply a use.
    .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*;/g, " ");
}

/** `callableText`, minus STRING content — the form the call census counts in.
 *  A symbol named inside a string literal is not a caller, and this is not
 *  hypothetical: the dead `createLink` threw
 *  `` `createLink: kind "${…}" not supported.` ``, so its own error message was
 *  its only "reference" and the first draft of this census cleared it. Template
 *  literals keep their `${…}` expressions (those ARE code); quoted strings go
 *  entirely. Import paths are strings too, which is fine — no path is a symbol.
 *
 *  The attribute-literal legs below deliberately read `callableText` instead:
 *  there, finding `"data-link-id"` in a string IS the violation. */
function referenceText(src: string): string {
  return callableText(src)
    // Regex literals FIRST. A char class like `["\'`]` — the idiom this very
    // file uses to match quoted attribute names — leaves a stray backtick in
    // the code, and the template pass below would then open a pseudo-literal
    // and swallow everything to the next backtick, newlines included. Measured
    // before this line existed: 22 files lost >400 chars each, worst 7 KB of a
    // LIVE source file, and three lost real `export` declarations — so the
    // census silently stopped seeing anything below them. The lookbehind-ish
    // guard (not preceded by an identifier char, `)`, `]` or a digit) keeps
    // division out of it.
    .replace(/(^|[^A-Za-z0-9_$)\]])\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, "$1 ")
    .replace(/`(?:\\.|\$\{[^{}]*\}|[^`\\])*`/g, (lit) =>
      (lit.match(/\$\{[^{}]*\}/g) ?? []).join(" "),
    )
    .replace(/"(?:\\.|[^"\\\n])*"/g, " ")
    .replace(/'(?:\\.|[^'\\\n])*'/g, " ");
}

const ALL_FILES = [...walk(SRC), ...walk(LIBRARY)];
const CALLABLE = new Map(ALL_FILES.map((f) => [f, callableText(readFileSync(f, "utf8"))]));
const REFERENCES = new Map(ALL_FILES.map((f) => [f, referenceText(readFileSync(f, "utf8"))]));
const LINK_FILES = ALL_FILES.filter(
  (f) => f.startsWith(LINKS + path.sep) && !f.includes("__tests__"),
);

const VALUE_EXPORT = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/gm;

/** Uses of `name` across both silos, not counting its own declaration, split by
 *  whether the caller is a TEST.
 *
 *  The split is the whole point, and this task's own deletion is the proof: run
 *  the census against the pre-fix tree and `cardKindToLegacyAnchorKind` — which
 *  that commit deleted as dead and whose suite it had to rewrite — reported
 *  FOURTEEN callers, all of them in `anchor-kind-maps.test.ts`. A guard that
 *  counts a suite as a consumer says "alive" about every dead export that was
 *  ever tested, which in this repo is most of them.
 *
 *  Scope, stated plainly: this is a bare-name grep with no module resolution, so
 *  a dead export whose name collides with a live symbol anywhere in either silo
 *  reads alive. `cardPopKey` would. That is a real hole and it is not closed
 *  here; the honest mitigation is that a scaffold usually gets a distinctive
 *  name, and the alternative is a type-aware pass this suite cannot afford. */
function callSites(name: string, declaredIn: string): { real: number; testOnly: number } {
  const re = new RegExp(`\\b${name}\\b`, "g");
  let real = 0;
  let testOnly = 0;
  for (const [file, text] of REFERENCES) {
    let hits = (text.match(re) ?? []).length;
    if (file === declaredIn) hits = Math.max(0, hits - 1);
    if (!hits) continue;
    if (file.includes("__tests__") || /\.test\.tsx?$/.test(file)) testOnly += hits;
    else real += hits;
  }
  return { real, testOnly };
}

/** Uncalled value exports that are deliberately kept, each with its reason.
 *  An entry here is a claim that the export earns its keep WITHOUT a caller —
 *  which is a high bar, since the whole finding is that "published" reads like
 *  "used". WIRE it or DELETE it; do not list it to make CI quiet.
 *
 *  EMPTY, and it took a correction to get there. The first draft allowlisted
 *  `DATA_LINK_KIND` on the story that its readers are external parsers and
 *  `globals.css`, neither of which this census can see — a plausible sentence
 *  that was simply FALSE once the producers adopted the constant: it has eight
 *  call sites. An allowlist entry justifying a symbol that needs no
 *  justification is this task's own bug in miniature, so the stale-entry leg
 *  below checks BOTH halves — still declared, and still genuinely uncalled. */
const PERMITTED_UNCALLED_LINK_EXPORTS: Record<string, string> = {
  "links.ts::reconcileModeAAnchors":
    "SUPERSEDED, not forgotten. `resolve-card-anchor.ts:26-30` states in code that it 'Subsumes (and will let the load pass replace) the legacy reconcileModeAAnchors / findParagraphIdBySnapshot / isModeAOrphaned helpers in links.ts, all kept exported for their own tests until those tests migrate' — a deliberate, written, in-progress migration whose suite is the parity record. NAMED follow-up: migrate mode-a-reconcile.test.ts onto resolveCardAnchor and delete both. Renew this entry only against that plan, never to quiet CI.",
  "links.ts::isModeAOrphaned":
    "Same subsumption, same follow-up — and links.ts:1150 has said 'a test-only predicate for the un-resolvable residue … no production orphan-surfacing UI consumes it yet' since it was written. It is honest scaffolding with a stated owner, which is the one thing that distinguishes it from what task 202 deleted.",
};

describe("the Link surface exports nothing that nothing calls (task 202)", () => {
  it("censuses a real file set", () => {
    // A census that silently scans nothing is compliance-shaped and worthless.
    expect(LINK_FILES.length).toBeGreaterThan(20);
    expect(ALL_FILES.length).toBeGreaterThan(500);
  });

  it("the strippers never swallow a declaration", () => {
    // The guard's own guard. `referenceText` is regex-based, and a regex-based
    // stripper can run away: before the regex-literal pass was added, one stray
    // backtick inside a char class opened a pseudo-template that ate the rest of
    // the file, and three files lost real `export` declarations that way — which
    // does not FAIL this suite, it silently shrinks what it looks at. So compare
    // declaration counts before and after stripping, over every file censused.
    const swallowed: string[] = [];
    for (const file of LINK_FILES) {
      const raw = (callableText(readFileSync(file, "utf8")).match(VALUE_EXPORT) ?? []).length;
      const kept = (REFERENCES.get(file)!.match(VALUE_EXPORT) ?? []).length;
      if (kept < raw) {
        swallowed.push(`${path.relative(LINKS, file)}: ${raw} declarations → ${kept} after stripping`);
      }
    }
    expect(swallowed, "referenceText ate part of a censused file").toEqual([]);
  });

  it("every value export in src/links/** has a caller", () => {
    const dead: string[] = [];
    for (const file of LINK_FILES) {
      const rel = path.relative(LINKS, file).split(path.sep).join("/");
      for (const m of REFERENCES.get(file)!.matchAll(VALUE_EXPORT)) {
        const name = m[1];
        const { real, testOnly } = callSites(name, file);
        if (real > 0) continue;
        const key = `${rel}::${name}`;
        if (PERMITTED_UNCALLED_LINK_EXPORTS[key]) continue;
        dead.push(
          testOnly > 0
            ? `${key} is called ONLY by tests (${testOnly} hit(s)) — a suite is not a ` +
              `consumer. This is the exact shape of cardKindToLegacyAnchorKind, which ` +
              `read alive on 14 test hits while being dead in the app.`
            : `${key} is exported and never called. Wire it at the call sites in the ` +
              `same commit, or delete it. A re-export does not count as a caller — ` +
              `that is exactly how the Phase-0/1 write half survived for three months.`,
        );
      }
    }
    expect(dead).toEqual([]);
  });

  it("the allowlist has no stale entries — still declared, still uncalled", () => {
    // The leg that rots, in both directions. A key naming a symbol that no
    // longer exists justifies nothing and reads as if the dead thing were still
    // sanctioned; a key naming a symbol that has SINCE acquired callers is an
    // exemption granted to code that no longer needs one, which is exactly the
    // "declared but unread" shape this whole file exists to kill.
    const declared = new Map<string, string>();
    for (const file of LINK_FILES) {
      const rel = path.relative(LINKS, file).split(path.sep).join("/");
      for (const m of REFERENCES.get(file)!.matchAll(VALUE_EXPORT)) {
        declared.set(`${rel}::${m[1]}`, file);
      }
    }
    for (const key of Object.keys(PERMITTED_UNCALLED_LINK_EXPORTS)) {
      const file = declared.get(key);
      expect(file, `${key} is allowlisted but no longer declared`).toBeTruthy();
      expect(
        callSites(key.split("::")[1], file!).real,
        `${key} is allowlisted as uncalled but now has callers — drop the entry`,
      ).toBe(0);
    }
  });

  it("the retired scaffold is gone, not renamed", () => {
    // Read backwards: these are the names a future reader would reach for
    // believing they are the enforced path. Their reappearance is only wrong if
    // it is another scaffold — which the census above already fails — so this
    // leg pins the two whole-FILE deletions the census structurally cannot see.
    // Recursively, not `path.join(LINKS, name)` — the first draft checked one
    // directory level, so `_shared/link-registry.ts` would have passed.
    const basenames = new Set(LINK_FILES.map((f) => path.basename(f)));
    for (const gone of ["link-registry.ts", "link-guard.ts", "link-highlight.ts"]) {
      expect([...basenames].filter((b) => b === gone), `${gone} is back`).toEqual([]);
    }
  });

  it("no file in src/links/** promises an unbuilt phase", () => {
    // The other half of the dishonesty, and the one the census cannot see:
    // three modules described work that did not exist, in the present tense —
    // "Phase 0: stub", "Phase 2 wires this up", "Enforced at runtime in
    // `createLink`". A note about what a phase DID (`Phase 4, Part A`, on
    // shipped code) is fine and common here; a note about what a phase WILL DO
    // is a promise nobody is keeping, and it is what sent a reader to
    // `createLink`. Like every copy check, this pins the SHAPE of the promise —
    // the forms that actually mislead. Only a reader pins honesty.
    const promises: string[] = [];
    const PROMISE =
      /\buntil\s+Phase\s+[A-Z]?\d|\bPhase\s+[A-Z]?\d[^.\n]*\b(?:will|wires?|absorbs?|is a stub|not yet)\b|\bPhase\s+[A-Z]?\d\s*:\s*stub|\bnot yet wired\b/i;
    // Lettered phases count. This subsystem numbers its phases with a LETTER as
    // often as a digit (`Phase D8 collapsed…`, `Phase G`, `after D9`), so a
    // digit-only pattern would have exempted the very migration it censuses.
    // ("in Phase 1" is deliberately NOT a promise — this file's own header says
    //  the write door "was scaffolded in Phase 0/1 and never adopted", which is
    //  history. The first draft of this regex failed on that sentence.)
    for (const file of LINK_FILES) {
      const raw = readFileSync(file, "utf8");
      for (const [i, line] of raw.split("\n").entries()) {
        if (PROMISE.test(line)) {
          promises.push(`${path.relative(LINKS, file)}:${i + 1} — ${line.trim()}`);
        }
      }
    }
    expect(promises).toEqual([]);
  });
});

/** A `<cardKind>:<cardId>` token written by hand. Two dialects, because the
 *  first draft knew only one and the anchor WRITE path used the other:
 *
 *   - LITERAL kind — `` `citation:${id}` ``. Anchored tight on purpose:
 *     `example-card:${id}` and `example-body:${id}` are unrelated float and
 *     instance keys that a looser pattern flagged, and a guard that fails a
 *     correct file trains people to distrust it. The kind list is deliberately
 *     wider than `CardKind`: `cut:` and `revision:` are LEGACY tokens the DOM
 *     still carries (`globals.css` keys off `[data-link-card^="cut:"]`).
 *   - VARIABLE kind — `` `${cardKind}:${cardId}` ``. This is how
 *     `createLinkedAnchor`, the morph re-stamp, the pending-mark stamp and the
 *     reload restore all spelled it while the law claimed nothing did, so it is
 *     the dialect that mattered most and the one a census keyed on kind NAMES
 *     structurally cannot see. */
const LITERAL_KIND_TOKEN =
  /["'`\s(]?(?:footnote|citation|example|note|highlight|todo|archive|cut|revision|report|report-request|revision-comment|revision-suggestion|cutter-comment|cutter-suggestion):\$\{/;
const VARIABLE_KIND_TOKEN = /\$\{[^{}]*\}\s*:\s*\$\{|`\s*\$\{[^{}]*\}:/;
const HAND_BUILT_TOKEN = {
  test: (line: string) => LITERAL_KIND_TOKEN.test(line) || VARIABLE_KIND_TOKEN.test(line),
};

describe("the link DOM contract has ONE speller", () => {
  /** The producers: everything that WRITES the attributes (or, for the ghost,
   *  strips them by name — a list that must mirror the producers exactly).
   *  Hand-kept, but not load-bearing on being complete: the derived census
   *  below fails any WRITER that is missing from it. */
  const PRODUCERS = [
    "lib/tiptap/linked-anchor-attrs.ts",
    "lib/tiptap/footnote.ts",
    "lib/tiptap/citation.ts",
    "components/drop-mode/inline-atom-ghost.ts",
  ];

  /** Files that WRITE a contract attribute whose name may stay a literal, with
   *  the reason. JSX has no computed-attribute syntax — `[DATA_LINK_CARD]={…}`
   *  is not a thing and a spread would read worse — so the card side spells the
   *  name and single-sources the VALUE instead, which the token leg pins. */
  const PERMITTED_LITERAL_ATTR_WRITERS: Record<string, string> = {
    "panels/Examples/ExampleCard.tsx":
      "JSX `data-link-card={linkCardKey(\"example\", …)}` on the panel card's outer element — name inline (no computed JSX attribute), token through the one builder.",
    "panels/Citations/CitationCard.tsx":
      "JSX `data-link-card={linkCardKey(\"citation\", …)}` — same reason.",
  };

  /** Occurrences that MENTION an attribute name inside a message string —
   *  prose that happens not to be a comment, so the census (which strips
   *  comments and keeps strings, deliberately, because the drift lives in
   *  strings) still sees it. An entry is a claim that the occurrence is not
   *  OPERATIVE: nothing queries or writes with it, so a rename makes the
   *  sentence stale rather than wrong.
   *
   *  Keyed by a distinctive FRAGMENT of the prose, not by the file — and that
   *  is the whole design. `PERMITTED_LITERAL_ATTR_WRITERS` above is file-scoped
   *  because it exempts a file for the same shape it justifies (a JSX write).
   *  These entries justify a READ mention, so a file-scoped exemption would
   *  hand back the WRITE coverage the file already had — and one of the two
   *  files is `links.ts`, the module whose four query sites task 204 converted
   *  and therefore the likeliest place for a fifth to appear. The stale-entry
   *  leg cannot see that drift either: it re-tests the same needle, which an
   *  operative selector satisfies exactly as well as prose does. So the
   *  exemption is per-LINE. Reformatting a message costs a one-line update
   *  here, which is the loud failure, not the silent one. */
  const PERMITTED_ATTR_NAME_MENTIONS: Record<string, ReadonlyArray<{ fragment: string; why: string }>> = {
    "cards/legacy-token-crosswalk.ts": [
      {
        fragment: "rule reads",
        why: "A dev-only `console.error` naming the CSS rule the crosswalk feeds ([data-link-card^=\"revision-comment:\"]). Diagnostic prose, queried by nothing.",
      },
    ],
    "links/links.ts": [
      {
        fragment: "may match no CSS rule",
        why: "A dev-only `console.error` in the legacy-kind fallback. Same: prose in a message.",
      },
    ],
  };

  it("NOTHING in TypeScript spells a contract attribute name — write, query or read", () => {
    // Widened from the 202 shape (writes only) to the whole surface, because
    // the reads were where both silent failure modes actually met. A file that
    // needs the name interpolates the constant (`[${DATA_LINK_ID}]`, a presence
    // test that reads fine); a file that needs a name PLUS a value calls a
    // selector builder, which is what the module was missing.
    //
    // The message still distinguishes writes from reads, because the remedy
    // differs: a WRITER emits through the contract and joins PRODUCERS, a
    // READER takes a selector builder.
    const WRITE_SHAPES = [
      /["'`]data-link-(?:id|kind|card)["'`]\s*:/, //            { "data-link-id": x }
      /(^|[^[])\bdata-link-(?:id|kind|card)\s*=\s*[{]/, //      <El data-link-id={x}
      /setAttribute\(\s*["'`]data-link-(?:id|kind|card)/, //    el.setAttribute("data-link-id", x)
    ];
    const NAME = /data-link-(?:id|kind|card|ids)/;
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (file.includes("__tests__") || /\.test\.tsx?$/.test(file)) continue;
      if (file === path.join(LINKS, "link-dom-contract.ts")) continue; // the declaration
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (PERMITTED_LITERAL_ATTR_WRITERS[rel]) continue; // whole-file: see above
      const mentions = PERMITTED_ATTR_NAME_MENTIONS[rel] ?? [];
      const text = callableText(readFileSync(file, "utf8"));
      for (const line of text.split("\n")) {
        if (!NAME.test(line)) continue;
        const isWrite = WRITE_SHAPES.some((re) => re.test(line));
        // A mention exemption is per-LINE and never excuses a WRITE: the
        // justification is "nothing queries or writes with it".
        if (!isWrite && mentions.some((m) => line.includes(m.fragment))) continue;
        offenders.push(`${rel} [${isWrite ? "WRITE" : "READ"}]: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "spells a data-link-* attribute name in TypeScript. A [WRITE] emits it " +
        "from @/links/link-dom-contract (and joins PRODUCERS) — or, if it is JSX, " +
        "which has no computed-attribute syntax, justifies itself in " +
        "PERMITTED_LITERAL_ATTR_WRITERS. A [READ] takes a selector builder " +
        "(linkIdSelector / linkKindSelector / linkCardSelector / " +
        "linkCardIdSelector), or interpolates the bare " +
        "constant where there is no value to interleave. globals.css is the one " +
        "boundary that cannot participate, and it is not censused here.",
    ).toEqual([]);
  });

  it("the attribute-name allowlists have no stale entries", () => {
    for (const rel of Object.keys(PERMITTED_LITERAL_ATTR_WRITERS)) {
      const full = path.join(SRC, rel);
      expect(existsSync(full), `${rel} is allowlisted but does not exist`).toBe(true);
      expect(
        /data-link-(?:id|kind|card)/.test(callableText(readFileSync(full, "utf8"))),
        `${rel} is allowlisted but no longer writes a contract attribute`,
      ).toBe(true);
    }
    // The mention list rots the same way, and being per-LINE is what makes
    // checking it meaningful: the fragment must still be present AND the line
    // carrying it must still be the prose the entry describes. A file-scoped
    // version could only re-test the same needle the census uses, which an
    // operative selector satisfies exactly as well as a sentence does — so it
    // would keep reading fresh after the justification had become a query.
    for (const [rel, mentions] of Object.entries(PERMITTED_ATTR_NAME_MENTIONS)) {
      const full = path.join(SRC, rel);
      expect(existsSync(full), `${rel} is allowlisted but does not exist`).toBe(true);
      const lines = callableText(readFileSync(full, "utf8")).split("\n");
      for (const { fragment } of mentions) {
        const hit = lines.find((l) => l.includes(fragment));
        expect(
          hit,
          `${rel} is allowlisted for a mention fragment ("${fragment}") it no longer contains — drop or update the entry`,
        ).toBeTruthy();
        expect(
          /data-link-(?:id|kind|card)/.test(hit ?? ""),
          `${rel}: the line holding "${fragment}" no longer names a contract attribute — the exemption is doing nothing`,
        ).toBe(true);
      }
    }
  });

  it("every producer emits through link-dom-contract, never a literal", () => {
    // Readers that build a CSS selector may still write the attribute inline —
    // `[data-link-card="citation:${id}"]` reads better than the interpolated
    // constant, and `globals.css` has no other choice. Producers may not: they
    // are the definition, and three of the four agreeing is how a rename ships
    // half-applied.
    for (const rel of PRODUCERS) {
      const text = callableText(readFileSync(path.join(SRC, rel), "utf8"));
      expect(
        text.match(/["'`]data-link-(?:id|kind|card)["'`]/g) ?? [],
        `${rel} hand-writes a data-link-* attribute name; import it from @/links/link-dom-contract`,
      ).toEqual([]);
      expect(text, `${rel} does not import the DOM contract`).toMatch(
        /from "@\/links\/link-dom-contract"/,
      );
    }
  });

  it("the `<cardKind>:<cardId>` grammar has one builder too — marker AND card side", () => {
    // `footnote.ts` and `citation.ts` each hand-built `${kind}:${id}` beside a
    // `linkCardKey` that exists for exactly that. Same class as the attribute
    // names: a second speller of a grammar the parser side (`parseLinkCardKey`)
    // has to keep agreeing with.
    //
    // The CARD side counts too, and was the half this task nearly missed:
    // `data-link-card` lives on the panel card's outer element as well as on the
    // in-editor marker (that is what makes it the address `panel-selection.ts`
    // and `open-for-card.ts` query), and two cards were building the token by
    // hand. They keep the attribute NAME inline — JSX has no computed-attribute
    // syntax and a spread would read worse — but the VALUE goes through the one
    // builder. The census below is what keeps this list honest as cards are added.
    for (const rel of [
      "lib/tiptap/footnote.ts",
      "lib/tiptap/citation.ts",
      "panels/Examples/ExampleCard.tsx",
      "panels/Citations/CitationCard.tsx",
    ]) {
      const text = callableText(readFileSync(path.join(SRC, rel), "utf8"));
      expect(text, `${rel} hand-builds a linkCard token`).not.toMatch(LITERAL_KIND_TOKEN);
      expect(text, `${rel} should build it with linkCardKey`).toMatch(/linkCardKey/);
    }
  });

  it("nothing anywhere spells a linkCard token by hand", () => {
    // The leg with teeth: the list above is hand-kept, so this one finds the
    // sites for itself, across both silos. It caught five this task had missed
    // — not emitters but QUERIES (`[data-link-card="citation:${id}"]` in
    // panel-selection / marker-clicks / CitationsPanel), which are a second
    // speller in the way that actually bites: change the grammar and they stop
    // MATCHING, silently, with no type error and nothing to grep for. The
    // attribute NAME may still be written inline in a selector (globals.css
    // keys off it and cannot import anything); the token may not.
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (file.includes("__tests__")) continue;
      const text = callableText(readFileSync(file, "utf8"));
      for (const line of text.split("\n")) {
        // `linkCard` as well as the attribute: the anchor write path builds the
        // token into a MARK ATTR (`linkCard: …`) that only later becomes
        // `data-link-card`, so an attribute-only gate missed every write site.
        if (!/data-link-card|\blinkCard\b/.test(line)) continue;
        if (!HAND_BUILT_TOKEN.test(line)) continue;
        offenders.push(`${path.relative(SRC, file).split(path.sep).join("/")}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "spells a `<cardKind>:<cardId>` token beside data-link-card by hand — " +
        "build it with linkCardKey (@/links/link-dom-contract), emit or query alike",
    ).toEqual([]);
  });

  it("nothing hand-PARSES the grammar either — the leg the build census cannot be", () => {
    // `HAND_BUILT_TOKEN` above matches interpolation shapes, so it sees a token
    // being CONSTRUCTED and is blind to one being TAKEN APART. That blindness
    // was live: `useTextHoverBridge` read the attribute and then ran
    // `card.indexOf(":")` + `slice(0, idx)` + `slice(idx + 1)` — `parseLinkCardKey`
    // re-typed, four lines from a module that exports it, with every 202 leg
    // green (task 204).
    //
    // Shape, and its stated limit: a colon-split whose PRECEDING window names
    // the card attribute or a `linkCard` value. A window is coarser than a
    // scope, and deliberately so — the alternative is parsing declarations to
    // find the enclosing function, which buys precision this needle does not
    // need. The window is anchored BEHIND the split because that is the order
    // the defect reads in (get the attribute, then take it apart).
    const SPLIT = /\.(?:indexOf|lastIndexOf|split)\(\s*["'`]:["'`]\s*\)/;
    const CARD_VALUE = /data-link-card|DATA_LINK_CARD|\blinkCard\b/;
    const WINDOW = 10;
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (file.includes("__tests__") || /\.test\.tsx?$/.test(file)) continue;
      if (file === path.join(LINKS, "link-dom-contract.ts")) continue; // the parser
      const lines = callableText(readFileSync(file, "utf8")).split("\n");
      for (const [i, line] of lines.entries()) {
        if (!SPLIT.test(line)) continue;
        const before = lines.slice(Math.max(0, i - WINDOW), i + 1).join("\n");
        if (!CARD_VALUE.test(before)) continue;
        offenders.push(
          `${path.relative(SRC, file).split(path.sep).join("/")}:${i + 1}: ${line.trim()}`,
        );
      }
    }
    expect(
      offenders,
      "takes a `<cardKind>:<cardId>` token apart by hand — read it with " +
        "parseLinkCardKey (@/links/link-dom-contract). A second parser drifts " +
        "exactly like a second builder: silently, by no longer matching.",
    ).toEqual([]);
  });

  it("the selector builders ARE the name and the grammar, composed", () => {
    // The third rung, pinned byte-exact against the two rungs it composes —
    // the same contract `card-key-seams-contract.test.ts` holds `cardDomSelector`
    // to. Byte-exactness is the whole point of the refactor that introduced
    // them: every call site they replaced produced these strings, so a
    // divergence here is a behaviour change wearing a cleanup's clothes.
    expect(linkIdSelector("abc")).toBe(`[${DATA_LINK_ID}="abc"]`);
    expect(linkKindSelector("anchor")).toBe(`[${DATA_LINK_KIND}="anchor"]`);
    expect(linkCardSelector("citation", "c1")).toBe(
      `[${DATA_LINK_CARD}="${linkCardKey("citation", "c1")}"]`,
    );
    // The suffix form restates the SEPARATOR as well as the name, which is why
    // it lives in the module rather than at its one call site.
    expect(linkCardIdSelector("x9")).toBe(`[${DATA_LINK_CARD}$=":x9"]`);

    // And the literal strings they replaced, spelled out once here so a rename
    // of the constants cannot quietly move the DOM contract: these are the
    // bytes that shipped before task 204.
    expect(linkIdSelector("q")).toBe('[data-link-id="q"]');
    expect(linkKindSelector("citation")).toBe('[data-link-kind="citation"]');
    expect(linkCardSelector("footnote", "q")).toBe('[data-link-card="footnote:q"]');
    expect(linkCardIdSelector("q")).toBe('[data-link-card$=":q"]');
  });

  it("the two ends of one address stay in lockstep — marker query, card query", () => {
    // `data-link-card` is an address precisely because the marker and the panel
    // card carry the SAME token, and the two JSX card writers are allowlisted
    // above to spell the attribute name inline. So pin that the value they
    // build is the value the query looks for. (This is what the duplicated
    // composite entry selector in marker-clicks/panel-selection was silently
    // betting on, from two files.)
    for (const [kind, id] of [
      ["citation", "cit-1"],
      ["example", "ex-1"],
      ["footnote", "fn-1"],
    ] as const) {
      const written = linkCardKey(kind, id);
      expect(linkCardSelector(kind, id)).toContain(`"${written}"`);
      expect(parseLinkCardKey(written)).toEqual({ kind, id });
    }
  });

  it("the contract module declares only what ships", () => {
    // `DATA_LINK_IDS` ("data-link-ids", "on panel cards with multiple incoming
    // links") was declared and never emitted by anything, in either silo — a
    // documented attribute the DOM never carried, which is the same fiction as
    // the registry table, one line long.
    const contract = readFileSync(path.join(LINKS, "link-dom-contract.ts"), "utf8");
    expect(contract).not.toMatch(/DATA_LINK_IDS/);
    const emitted = ALL_FILES.filter((f) =>
      /["'`]data-link-ids["'`]/.test(CALLABLE.get(f)!),
    );
    expect(emitted, "something emits data-link-ids — then declare it").toEqual([]);
  });
});
