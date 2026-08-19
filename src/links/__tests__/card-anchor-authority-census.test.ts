// @vitest-environment node
//
// TASK 369 — the CENSUS half. The authority was never the part that could
// misbehave; a call site that never ASKS it is, and that call site type-checks
// perfectly. `findParagraphPos(pid)` was a valid function returning a valid
// number for a valid uuid — it simply answered a question (is THIS stored uuid
// live?) that is not the question the margin answers (where is this CARD
// anchored NOW?), and no behavioural test of either surface can see the
// difference, because each drives one surface at a time.
//
// THE LAW
//
//   Where one fact is drawn by two surfaces, it is RESOLVED once, by one
//   authority, and both surfaces read the resolution. Neither may re-derive it.
//
// Six legs, each pinning a different way the fork could come back:
//   A — no omni builder declares its own paragraph-position lookup;
//   B — no omni builder pulls a card's raw pids (the pid list IS the
//       authority's answer now);
//   B2 — and no builder reaches AROUND those two names for the same answer.
//       Legs A and B grep the two symbols the pre-369 builders HAPPENED to
//       use, which is a census of the last defect rather than of the question:
//       a builder reading `card.links[0].anchor.textObjectIds[0]` and walking
//       `editor.state.doc.descendants` itself spells neither, and would pass.
//       So the anchor VOCABULARY is forbidden in an omni builder outright.
//   C — the two hosts build the pass, the margin reads it through the shared
//       reader, and the omni readers are an EXACT SET (a count floor lets one
//       drifting builder be excused by an adopting sibling — the per-file-vs-
//       per-handle failure the pane-drag census records, one level up);
//   C2 — the docked/float `anchoredArchiveIds` fold, the THIRD copy of the
//       bare gate, goes through the pass too. Nothing else pins it: it lives
//       inline in `EditorPane` and no suite mounts it.
//   D — nothing outside the authority and the load-time reconcile pass calls
//       the recovery ladder directly.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const SRC = path.resolve(__dirname, "../..");
const PANELS = path.join(SRC, "panels");

/**
 * `src/panels/<Panel>/omni.tsx` is the only surface that carried a copy of the
 * rule, so membership is DISCOVERED from the tree — a new panel is covered by
 * existing, not by remembering to extend a list.
 */
function omniBuilders(): Array<{ name: string; source: string }> {
  const out: Array<{ name: string; source: string }> = [];
  for (const entry of readdirSync(PANELS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PANELS, entry.name, "omni.tsx");
    try {
      out.push({ name: `${entry.name}/omni.tsx`, source: codeOnly(readFileSync(file, "utf8")) });
    } catch {
      /* no omni.tsx in this panel folder */
    }
  }
  return out;
}

/**
 * The ONE exemption, and it is scoped to the shape it justifies: the Errors
 * builder's paragraph id comes from the diagnostics pass (`paragraphByErrorId`),
 * not from a card's links, so it has no recovery ladder to run and no second
 * renderer to agree with. It takes the bare `posOf` lookup off the SAME index.
 */
const POSITION_LOOKUP_EXEMPT = new Set(["Errors/omni.tsx"]);

describe("card-anchor authority census (task 369)", () => {
  it("A — no omni builder declares its own paragraph-position lookup", () => {
    const builders = omniBuilders();
    expect(builders.length).toBeGreaterThanOrEqual(10);
    const offenders = builders
      .filter((b) => /\bfindParagraphPos\b/.test(b.source))
      .map((b) => b.name)
      .filter((n) => !POSITION_LOOKUP_EXEMPT.has(n));
    expect(
      offenders,
      "A paragraph-anchored omni builder must take `resolveCardRows` (the ONE " +
        "card-anchor authority) — a private uuid→pos lookup is the pre-369 fork " +
        "that binned snapshot-recovered cards into the orphan strip while the " +
        "margin painted an ordinary marker for them.",
    ).toEqual([]);
    // The exemption must still cover a REAL offender. Asserting the file
    // merely exists is satisfied by every panel folder — an exemption that
    // has stopped excusing anything is a standing licence for the next
    // private lookup to reappear under the exempted name.
    const flagged = new Set(
      builders.filter((b) => /\bfindParagraphPos\b/.test(b.source)).map((b) => b.name),
    );
    for (const name of POSITION_LOOKUP_EXEMPT) {
      expect(flagged, `${name} is exempted but no longer offends — drop it`).toContain(
        name,
      );
    }
  });

  it("B2 — no omni builder reaches around those names for the same answer", () => {
    // The anchor VOCABULARY, not the two retired spellings: reading a card's
    // links directly, or walking the document for a uuid, IS re-deriving the
    // authority's answer whatever the local helper is called. Measured: this
    // drains to EMPTY on the current tree.
    const NEEDLES: Array<[string, RegExp]> = [
      ["textObjectIds", /\btextObjectIds\b/],
      ["card links", /\.links\b/],
      ["doc walk", /\bstate\.doc\b/],
      ["descendants", /\bdescendants\s*\(/],
    ];
    const offenders: string[] = [];
    for (const b of omniBuilders()) {
      for (const [label, re] of NEEDLES) {
        if (re.test(b.source)) offenders.push(`${b.name} → ${label}`);
      }
    }
    expect(
      offenders,
      "An omni builder that resolves its own anchor — by reading the card's " +
        "links or walking the doc — reproduces the pre-369 fork under a name " +
        "legs A and B cannot see.",
    ).toEqual([]);
  });

  it("B — no omni builder pulls a card's raw stored pids", () => {
    const offenders = omniBuilders()
      .filter((b) => /\bgetLinkedTextObjectIds\b/.test(b.source))
      .map((b) => b.name);
    expect(
      offenders,
      "The pid list a card renders on IS the authority's answer. Re-reading " +
        "`getLinkedTextObjectIds` in a builder re-opens the fork one field over " +
        "(the `@N` keying, the jump gate, the free/orphan branch).",
    ).toEqual([]);
  });

  it("C — both hosts build the pass; the margin reads it through the shared reader", () => {
    const editorPane = codeOnly(
      readFileSync(path.join(SRC, "components", "EditorPane.tsx"), "utf8"),
    );
    const omniHost = codeOnly(
      readFileSync(
        path.join(SRC, "components", "editor-layout", "panels", "omni-host.tsx"),
        "utf8",
      ),
    );
    for (const [name, source] of [
      ["EditorPane.tsx", editorPane],
      ["omni-host.tsx", omniHost],
    ] as const) {
      expect(source, `${name} must build the shared anchor pass`).toContain(
        "buildCardAnchorPass(",
      );
    }
    // The margin's adapter is production code (`buildMarginMarkerRows` /
    // `marginAnchorIndex`) precisely so the contract test can drive BOTH
    // readers. An inline re-derivation here is the pre-369 shape.
    expect(editorPane).toContain("buildMarginMarkerRows(");
    expect(editorPane).toContain("marginAnchorIndex(");
    // …and the omni readers are an EXACT SET, discovered from both sides:
    // every builder that TAKES the authority must READ it, and vice versa. A
    // count floor would let a 7th adopter mask a builder that regressed to a
    // private lookup under a different name.
    const takers = omniBuilders()
      .filter((b) => /\bresolveCardRows\b/.test(b.source))
      .map((b) => b.name)
      .sort();
    const readers = omniBuilders()
      .filter((b) => /\bbuildOmniAnchorRows\s*\(/.test(b.source))
      .map((b) => b.name)
      .sort();
    expect(readers).toEqual(takers);
    expect(readers.length).toBeGreaterThanOrEqual(6);
  });

  it("C1b — the margin memo keeps no private pid gate in front of the authority", () => {
    // Leg B is scoped to `src/panels/*/omni.tsx` and structurally cannot see
    // EditorPane, where the margin's own copy of the question lived: five of
    // the six marker loops opened with `if (getLinkedTextObjectIds(card).length
    // === 0) continue;`, in FRONT of the authority. That gate is why a card
    // with empty stored pids but a live mark (task 107's shipped Mode-B shape)
    // got an anchored omni row and no marker — 369's own defect, mirrored.
    const source = codeOnly(
      readFileSync(path.join(SRC, "components", "EditorPane.tsx"), "utf8"),
    );
    const start = source.indexOf("const marginaliaMarkers = useMemo");
    expect(start, "marginaliaMarkers memo not found — rename? re-point this leg")
      .toBeGreaterThan(-1);
    const end = source.indexOf("\n  ]);", start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(
      body,
      "The margin must let the AUTHORITY decide whether a card has an anchor — " +
        "a pid pre-check in front of it is a second answer to the same question.",
    ).not.toMatch(/\bgetLinkedTextObjectIds\b/);
  });

  it("C2 — the docked/float anchored-id fold goes through the pass too", () => {
    const source = codeOnly(
      readFileSync(path.join(SRC, "components", "EditorPane.tsx"), "utf8"),
    );
    const m = /const anchoredArchiveIds = useMemo[\s\S]*?\n  \}, \[[^\]]*\]\);/.exec(
      source,
    );
    expect(m, "anchoredArchiveIds memo not found — rename? re-point this leg").toBeTruthy();
    const body = m![0];
    expect(
      body,
      "`anchoredArchiveIds` badges the DOCKED Archive panel + its float. It was " +
        "the third copy of the bare `pids.some(live)` gate, so a recovered clip " +
        "read orphaned there while its omni card read anchored. It must fold the " +
        "SAME authority.",
    ).toContain("anchorPass.resolve(");
    expect(body).not.toMatch(/\bgetLinkedTextObjectIds\b|\bdescendants\s*\(/);
  });

  it("D — only the authority and the load-time reconcile call the recovery ladder", () => {
    const LADDER = /\b(buildResolveIndex|resolveCardAnchor)\s*\(/;
    /** The reconcile pass asks a DIFFERENT question: it MUTATES the stored
     *  card (re-writing its links to the recovered paragraph) at load time,
     *  where these two readers only render. */
    const ALLOWED = new Set([
      "links/card-anchor-rows.ts",
      "links/resolve-card-anchor.ts",
      "hooks/useReconcileModeAAnchors.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const rel = path.relative(SRC, full);
        if (ALLOWED.has(rel)) continue;
        if (LADDER.test(codeOnly(readFileSync(full, "utf8")))) offenders.push(rel);
      }
    };
    walk(SRC);
    expect(
      offenders,
      "A render surface must ask `buildCardAnchorPass`, not the ladder — two " +
        "callers of the ladder is how the margin and the omni came to run it " +
        "against two different tables in the first place.",
    ).toEqual([]);
  });
});
