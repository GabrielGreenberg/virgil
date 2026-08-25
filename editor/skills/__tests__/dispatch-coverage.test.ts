// @vitest-environment node
//
// The THIRD leg of the create → inbox → drain → DISPATCH contract loop.
//
// `editor/scripts/ai_request_routing.json` is the frozen projection of
// `CARD_REGISTRY[kind].aiRequest` — the SSOT for which wire `kind` and which
// `linkPanel` each flag-bearing card kind maps to. Two legs already pin it:
//   • registry → manifest  — `src/cards/__tests__/ai-request-routing-manifest.test.ts`
//   • manifest → drain     — `editor/scripts/tests/test_unbridged_flag_fallback.py`
// The third — manifest → **skill dispatch** — did not exist, and that is
// exactly where the SSOT was re-spelled by hand and read half.
//
// `/editor/review` is the only automated dispatcher in the editor skill set.
// Its step-3 table was keyed on `kind` alone, while the manifest maps TWO card
// kinds onto one wire kind and separates them by `linkPanel`:
//
//     "cutter-comment":   { "kind": "suggestion", "linkPanel": "cutter"    }
//     "revision-comment": { "kind": "suggestion", "linkPanel": "revisions" }
//
// So every `suggestion` Task went to `/editor/draft-suggestion`, whose op is
// unconditionally `"panel": "revisions"` — a user's Cutter comment answered
// into `revisions.json`, in a panel they were not working in, with the Cutter
// thread left empty and the Task marked answered. Nothing threw. Two complete
// responders (`answer-cutter-comment`, `answer-revision-request`) were
// unreachable from the umbrella as a result.
//
// The responders were never the part that could misbehave. A dispatcher that
// reads half the SSOT is — and it type-checks, renders and reads perfectly.
// So this file censuses the DISPATCH TABLE against the manifest, and derives
// its population from the manifest rather than restating it. Allowlist EMPTY.
//
// The sharpest evidence that the rule was already KNOWN and merely unread at
// the dispatch site: `apply_response.py`'s `_write_skill` has disambiguated
// `kind: "suggestion"` by `linkedTo.panel` all along — its `_PANEL_SKILL` names
// `answer-cutter-comment` / `answer-revision-request` as the two owners, so the
// REFLECTION layer could name the skill that should have answered while the
// dispatcher sent the Task somewhere else. The last leg below pins the umbrella
// against that third, independent statement of the same rule.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// editor/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const REVIEW = "editor/skills/review.md";
const MANIFEST = "editor/scripts/ai_request_routing.json";

const manifest = JSON.parse(read(MANIFEST)) as {
  routing: Record<string, { kind: string; linkPanel: string }>;
};

/** A parsed route from the umbrella's step-3 dispatch list. */
interface Route {
  kind: string;
  /** null ⇒ the kind-only fallback (matches any panel, and the unbridged row). */
  panel: string | null;
  /** The skill file the route names, repo-relative. */
  file: string;
}

// A route line looks like one of
//   `kind: "todo"` → `/editor/answer-todo-request <docPath> <id>`
//   `kind: "suggestion"` + `panel: "cutter"` →
//      `/editor/answer-cutter-comment <docPath> <id>`
// The arrow may end the line (the skill wraps onto the next one), so parse the
// two halves independently rather than requiring them on one physical line —
// this prose is hard-wrapped and future edits will re-wrap it freely.
function parseRoutes(md: string): Route[] {
  // Collapse only NEWLINES (not all whitespace) so a wrapped route still reads
  // as one logical line while list items stay separated by their leading digit.
  const flat = md.replace(/\n\s*/g, " ");
  const re =
    /`kind:\s*"([a-z-]+)"`(?:\s*\+\s*`panel:\s*"([a-z-]+)"`)?\s*→\s*`\/editor\/([a-z-]+)/g;
  const out: Route[] = [];
  for (const m of flat.matchAll(re)) {
    out.push({
      kind: m[1],
      panel: m[2] ?? null,
      file: `editor/skills/${m[3]}.md`,
    });
  }
  return out;
}

const routes = parseRoutes(read(REVIEW));

/** The wire kinds the manifest declares, and every panel each is produced from. */
const panelsByKind = new Map<string, Set<string>>();
for (const route of Object.values(manifest.routing)) {
  const set = panelsByKind.get(route.kind) ?? new Set<string>();
  set.add(route.linkPanel);
  panelsByKind.set(route.kind, set);
}

/** Manifest rows flattened to the (kind, panel) pairs a dispatcher must answer. */
const manifestPairs = Object.entries(manifest.routing).map(([cardKind, r]) => ({
  cardKind,
  kind: r.kind,
  panel: r.linkPanel,
}));

describe("/editor/review dispatch table ↔ ai_request_routing.json", () => {
  it("parses a non-trivial dispatch table (the canary)", () => {
    // Every leg below is satisfied vacuously by a regex that matches nothing.
    expect(routes.length).toBeGreaterThanOrEqual(11);
    expect(routes.some((r) => r.panel !== null)).toBe(true);
  });

  it.each(manifestPairs)(
    "routes the manifest pair $cardKind → (kind $kind, panel $panel)",
    ({ kind, panel }) => {
      const exact = routes.find((r) => r.kind === kind && r.panel === panel);
      const fallback = routes.find((r) => r.kind === kind && r.panel === null);
      // An exact (kind, panel) route always answers. A kind-only route answers
      // ONLY where that kind has a single producer panel — see the next leg.
      expect(exact ?? fallback).toBeTruthy();
    },
  );

  // The leg with teeth. This is the one that fails on the pre-fix table.
  it.each([...panelsByKind].filter(([, panels]) => panels.size > 1))(
    "wire kind %s has >1 producer panel, so it may not be routed by kind alone",
    (kind, panels) => {
      for (const panel of panels) {
        const exact = routes.find((r) => r.kind === kind && r.panel === panel);
        expect(
          exact,
          `\`kind: "${kind}"\` is produced from ${[...panels].sort().join(" and ")}; ` +
            `panel "${panel}" has no (kind, panel) route in ${REVIEW}, so its Tasks ` +
            `fall to the kind-only fallback and are answered into the wrong panel`,
        ).toBeTruthy();
      }
    },
  );

  it.each([...panelsByKind.keys()])(
    "wire kind %s keeps a kind-only fallback for the UNBRIDGED case",
    (kind) => {
      // `AiRequest.linkedTo` is optional (`src/lib/types.ts`), so a row with no
      // panel at all is representable for every kind. Without a fallback the
      // agent has no route for it.
      expect(routes.some((r) => r.kind === kind && r.panel === null)).toBe(true);
    },
  );

  it("names no skill file that does not exist", () => {
    const missing = [...new Set(routes.map((r) => r.file))].filter(
      (f) => !existsSync(join(repoRoot, f)),
    );
    expect(missing).toEqual([]);
  });

  it("agrees with apply_response.py's `_PANEL_SKILL` about who owns each panel", () => {
    // A THIRD statement of the same rule, and one this task did not author:
    // `_write_skill(kind, panel)` returns `_PANEL_SKILL[panel]` for a
    // `suggestion` whose source panel is cutter/revisions, so the reflection
    // memo has always been filed under the owner. Deriving the expected route
    // from it means the dispatch table is pinned against something independent
    // of this file's own edit.
    const py = read("editor/scripts/apply_response.py");
    const block = /_PANEL_SKILL\s*=\s*\{([\s\S]*?)\}/.exec(py);
    expect(block, "_PANEL_SKILL not found in apply_response.py").toBeTruthy();
    const owners = new Map<string, string>();
    for (const m of block![1].matchAll(/"([a-z-]+)":\s*"([a-z-]+)"/g)) {
      owners.set(m[1], m[2]);
    }
    // Sanity: the two panels the disambiguation names must be in the table.
    expect(owners.get("cutter")).toBe("answer-cutter-comment");
    expect(owners.get("revisions")).toBe("answer-revision-request");
    for (const panel of panelsByKind.get("suggestion") ?? []) {
      const route = routes.find((r) => r.kind === "suggestion" && r.panel === panel);
      expect(route?.file).toBe(`editor/skills/${owners.get(panel)}.md`);
    }
  });

  it("states that the route key is the PAIR, not the kind", () => {
    const flat = read(REVIEW).replace(/\s+/g, " ");
    expect(flat).toMatch(/keyed on the PAIR/i);
    expect(flat).toContain("ai_request_routing.json");
  });
});

describe("the `suggestion` responders agree about clearSourceFlag", () => {
  // Population DERIVED from the dispatch table, not hand-listed: every skill
  // the umbrella can send a `suggestion` Task to.
  const suggestionResponders = [
    ...new Set(routes.filter((r) => r.kind === "suggestion").map((r) => r.file)),
  ];

  it("the dispatch table names three of them", () => {
    expect(suggestionResponders.length).toBe(3);
  });

  it.each(suggestionResponders)("%s passes clearSourceFlag: true", (file) => {
    const doc = read(file);
    expect(doc).toMatch(/"clearSourceFlag":\s*true/);
    expect(doc).not.toMatch(/"clearSourceFlag":\s*false/);
  });

  it("no other skill states a bare `false` — the exact-set pin", () => {
    // `apply_response.py`'s contract: clearing the source card's `aiRequest`
    // flag is DEFAULT-ON, and every linked-completion path lowers it. A skill
    // that answers `false` for a Task-bearing op reinstates the recycling leg
    // the default exists to close. The one exemption is exempt by SHAPE — a
    // writes-only `complete-only` op with no `requestId`, where the contract's
    // flag block cannot run — and it must SAY so at the site, or an exemption
    // that has stopped excusing anything becomes a standing licence.
    const EXEMPT: Record<string, RegExp> = {
      "editor/skills/answer-bib-review.md": /one sanctioned exception/i,
    };
    const skills = [
      "answer-bib-review", "answer-cutter-comment", "answer-note-request",
      "answer-report-request", "answer-revision-request", "answer-todo-request",
      "accept-suggestion", "archive-card", "create-card", "draft-footnote",
      "draft-suggestion", "edit-card", "find-citation", "link-cards",
      "move-card", "reject-suggestion", "restore-card", "review",
      "style-merge", "sync-bib-to-library",
    ].map((n) => `editor/skills/${n}.md`);
    const offenders = skills.filter(
      (f) => /"clearSourceFlag":\s*false/.test(read(f)) && !(f in EXEMPT),
    );
    expect(offenders).toEqual([]);
    for (const [file, phrase] of Object.entries(EXEMPT)) {
      // Both halves: the exemption still excuses something, and it states why.
      expect(read(file)).toMatch(/"clearSourceFlag":\s*false/);
      expect(read(file).replace(/\s+/g, " ")).toMatch(phrase);
    }
  });
});

describe("draft-suggestion owns the UNBRIDGED case only", () => {
  const DS = "editor/skills/draft-suggestion.md";

  it("gates on linkedTo.panel before it composes anything", () => {
    const flat = read(DS).replace(/\s+/g, " ");
    expect(flat).toMatch(/Check ownership FIRST/i);
    expect(flat).toMatch(/linkedTo/);
    // Both owners named, so the hand-off has somewhere to go.
    expect(flat).toContain("/editor/answer-cutter-comment");
    expect(flat).toContain("/editor/answer-revision-request");
  });

  it("says why proceeding on a cutter request is wrong, not just that it is", () => {
    // The op writes `"panel": "revisions"` unconditionally, and `panel` selects
    // the SIDECAR FILE — a different store, not a cosmetic label.
    const flat = read(DS).replace(/\s+/g, " ");
    expect(flat).toMatch(/SIDECAR FILE|different store/i);
  });

  it("no longer claims to cover the cutter panel", () => {
    // Its ask-shape note used to read "the user commented in the revisions or
    // cutter panel" and then hard-code one panel for the rest of the file.
    // Strip blockquote markers first — the sentence lived inside a `>` block,
    // so a bare whitespace collapse leaves a `>` mid-phrase and the needle
    // matches nothing (measured: this leg passed on the pre-fix tree until the
    // markers were stripped, which is a leg that cannot see its own defect).
    const flat = read(DS).replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ");
    expect(flat).not.toMatch(/commented in the revisions or cutter panel/i);
  });
});
