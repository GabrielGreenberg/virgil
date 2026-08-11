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
// `link-dom-contract.ts`, and it only stays honest if the producers actually
// emit through it rather than hand-writing the attribute names beside it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

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

  it("the producer list is DERIVED — nothing writes a contract attribute off-list", () => {
    // The leg the first draft of this file lacked, and the one that catches the
    // shape that actually recurs: PRODUCERS below is hand-kept, so a NEW inline
    // atom shipping `renderHTML` with `"data-link-id": id, "data-link-kind":
    // "figure"` would simply not be read by the legs after it — CI green, two
    // spellers, exactly the drift the law exists to prevent. So the census finds
    // its own subjects: any file that WRITES one of these attribute names as a
    // literal (object key, JSX attribute, or setAttribute) must be a known
    // producer or carry a justification. READS stay free — a `[data-link-card=…]`
    // selector may spell the name, and `globals.css` cannot do otherwise.
    const WRITE_SHAPES = [
      /["'`]data-link-(?:id|kind|card)["'`]\s*:/, //            { "data-link-id": x }
      /(^|[^[])\bdata-link-(?:id|kind|card)\s*=\s*[{]/, //      <El data-link-id={x}
      /setAttribute\(\s*["'`]data-link-(?:id|kind|card)/, //    el.setAttribute("data-link-id", x)
    ];
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      if (file.includes("__tests__")) continue;
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (PRODUCERS.includes(rel) || PERMITTED_LITERAL_ATTR_WRITERS[rel]) continue;
      const text = callableText(readFileSync(file, "utf8"));
      for (const line of text.split("\n")) {
        if (WRITE_SHAPES.some((re) => re.test(line))) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      "writes a data-link-* attribute name as a literal. Emit it from " +
        "@/links/link-dom-contract (and add the file to PRODUCERS), or — if it is " +
        "JSX, which has no computed-attribute syntax — justify it in " +
        "PERMITTED_LITERAL_ATTR_WRITERS.",
    ).toEqual([]);
  });

  it("the literal-writer allowlist has no stale entries", () => {
    for (const rel of Object.keys(PERMITTED_LITERAL_ATTR_WRITERS)) {
      const full = path.join(SRC, rel);
      expect(existsSync(full), `${rel} is allowlisted but does not exist`).toBe(true);
      expect(
        /data-link-(?:id|kind|card)/.test(callableText(readFileSync(full, "utf8"))),
        `${rel} is allowlisted but no longer writes a contract attribute`,
      ).toBe(true);
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
