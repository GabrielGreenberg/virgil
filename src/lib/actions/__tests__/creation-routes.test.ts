// @vitest-environment node
//
// CREATION ROUTES (task 2026-09-23-727) — the sentence a panel's empty state
// teaches is DERIVED from the action registry, so it cannot outlive the surface
// it names.
//
// The defect: "No examples. Click the (1) glyph in the formatting toolbar to
// insert one." The glyph was retired with the MenuBar's example controls; the
// sentence was not, because nothing connected the two. The two live ways to
// make an example are declared one file over — `surfaces: { slash, lightning }`
// with `slashName: "ex"` — and that declaration is reconciled against the live
// `VIRGIL_COMMANDS` list by `assertActionCoverage`. So a sentence built from
// the row is true by the same proof that makes the menus true.
//
// This suite pins the derivation. Its companion leg — that no panel writes such
// a sentence by hand instead — is in
// `src/__tests__/panel-empty-state-contract.test.ts` (PROVENANCE).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  creationRoutes,
  creationRoutesFor,
  creationSentence,
  panelAddRoute,
} from "../creation-routes";
import { VIRGIL_ACTION_REGISTRY, type ActionId } from "../action-registry";

/** The sentence a panel with no "+" of its own teaches. */
const sentenceFor = (id: ActionId, hasAdd = false) =>
  creationSentence(creationRoutes(id, hasAdd));

describe("the derived sentence names surfaces the registry declares", () => {
  it("teaches the example routes the registry actually holds", () => {
    // The reported defect, read forwards: the row says slash + lightning, so
    // the sentence says slash + lightning — and says nothing about a toolbar.
    expect(sentenceFor("example")).toBe(
      "Type \\ex in the editor, or pick Example from the ⚡ menu.",
    );
    expect(sentenceFor("example")).not.toMatch(/toolbar|glyph|\(1\)/i);
  });

  it("puts the panel's own + first, and keeps the sentence to two clauses", () => {
    expect(sentenceFor("footnote", true)).toBe(
      "Click + above, or type \\footnote in the editor.",
    );
    expect(sentenceFor("todo", true)).toBe(
      "Click + above, or pick Todo from the ⚡ menu.",
    );
  });

  it("names one menu, not the same menu twice", () => {
    // `todo` declares BOTH menu surfaces; they are two triggers for one
    // `ActionsMenuPanel` body, so "pick Todo from the ⚡ menu, or pick Todo from
    // a block's grab bar" would be one route counted twice.
    expect(VIRGIL_ACTION_REGISTRY.todo.surfaces.lightning).toBe(true);
    expect(VIRGIL_ACTION_REGISTRY.todo.surfaces.grab).toBe(true);
    const routes = creationRoutesFor("todo");
    expect(routes.map((r) => r.surface)).toEqual(["lightning"]);
  });

  it("drops a clause the moment its surface flag does", () => {
    // The whole point, stated as a measurement: the copy is a projection of the
    // row, so a surface a row stops declaring stops being taught. (`\ex` is the
    // one the retired MenuBar glyph should have taken with it.)
    const withSlash = creationRoutesFor("example").map((r) => r.surface);
    expect(withSlash).toContain("slash");
    const row = VIRGIL_ACTION_REGISTRY.example;
    const deslashed = { ...row, surfaces: { ...row.surfaces, slash: false } };
    // Re-derive against the mutated row through the same pure clause builder by
    // way of the registry lookup the module makes — proven here by stubbing the
    // registry entry for the duration of the call.
    const restore = VIRGIL_ACTION_REGISTRY.example;
    (VIRGIL_ACTION_REGISTRY as Record<string, unknown>).example = deslashed;
    try {
      expect(creationRoutesFor("example").map((r) => r.surface)).toEqual(["lightning"]);
      expect(sentenceFor("example")).toBe("Pick Example from the ⚡ menu.");
    } finally {
      (VIRGIL_ACTION_REGISTRY as Record<string, unknown>).example = restore;
    }
  });

  it("quotes a slash command that the live command list really carries", async () => {
    // The truth condition, followed all the way down: every `\name` the copy
    // can print is a `slashName`, and `assertActionCoverage` reconciles every
    // `slashName` against `VIRGIL_COMMAND_NAMES` in both directions. So this
    // asserts the join rather than re-listing the commands.
    const { VIRGIL_COMMAND_NAMES } = await import("@/lib/tiptap/commands");
    for (const id of ["example", "footnote", "citation"] as const) {
      const slash = creationRoutesFor(id, 5).find((r) => r.surface === "slash");
      expect(slash, `${id} should offer a slash route`).toBeTruthy();
      expect(VIRGIL_COMMAND_NAMES).toContain(slash!.token.replace(/^\\/, ""));
    }
  });
});

describe("the sentence builder", () => {
  it("capitalises only the first clause and ends the sentence once", () => {
    expect(creationSentence(creationRoutes("archive", false))).toMatch(/^Pick .+\.$/);
    expect(sentenceFor("note", true)).toBe(
      "Click + above, or pick Note from the ⚡ menu.",
    );
  });

  it("teaches nothing when there is nothing to teach", () => {
    // A kind with no reachable surface and no "+" gets an empty string, not an
    // invented instruction — inventing one is the defect this file is about.
    expect(creationSentence([])).toBe("");
  });

  it("offers the + only when the panel says it has one", () => {
    expect(creationRoutes("todo", false).some((r) => r.surface === "panel-add")).toBe(
      false,
    );
    expect(creationRoutes("todo", true)[0]).toEqual(panelAddRoute());
  });
});

describe("every action the panels name can be described", () => {
  // The population is DISCOVERED, not hand-listed: every `<CreationHint
  // action="…" />` the tree actually renders. A tenth panel inherits this leg
  // by shipping, and a hand-list could only ever be missing the panel that
  // drifted.
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.resolve(HERE, "../../.."); // src/

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const MOUNTED: { file: string; action: ActionId }[] = walk(SRC).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/<CreationHint\s+action="([a-z-]+)"/g)].map(
      (m) => ({
        file: path.relative(SRC, f).split(path.sep).join("/"),
        action: m[1] as ActionId,
      }),
    ),
  );

  it("finds the mounts (a census that finds nothing proves nothing)", () => {
    // Floor, not an exact count. Nine card panels + Outline's two sites today.
    expect(MOUNTED.length).toBeGreaterThanOrEqual(9);
    expect(MOUNTED.map((m) => m.action)).toContain("example");
  });

  it.each(MOUNTED.map((m) => [`${m.file} (${m.action})`, m] as const))(
    "%s has a describable way in",
    (name, mount) => {
      // A row that stops being describable — no slash name, no menu surface —
      // would render an empty state that names the absence and teaches nothing.
      // That fails HERE rather than on screen.
      const sentence = sentenceFor(mount.action);
      expect(sentence, `${name}: no surface the empty state can name`).not.toBe("");
      expect(sentence).toMatch(/\.$/);
    },
  );
});
