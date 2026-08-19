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
// Four legs, each pinning a different way the fork could come back:
//   A — no omni builder declares its own paragraph-position lookup;
//   B — no omni builder pulls a card's raw pids (the pid list IS the
//       authority's answer now);
//   C — the two hosts build the pass, and the margin reads it through the
//       shared reader rather than re-deriving;
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
    // The exemption must still be LIVE, or it is silently covering nothing.
    expect(builders.map((b) => b.name)).toEqual(
      expect.arrayContaining([...POSITION_LOOKUP_EXEMPT]),
    );
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
    // …and the six paragraph-anchored builders read the omni side of it.
    const readers = omniBuilders().filter((b) =>
      /\bbuildOmniAnchorRows\b/.test(b.source),
    );
    expect(readers.length).toBeGreaterThanOrEqual(6);
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
