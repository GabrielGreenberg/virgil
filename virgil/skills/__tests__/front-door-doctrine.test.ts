// @vitest-environment node
//
// Doctrine guard for the FRONT DOOR (`virgil/skills/*.md`).
//
// `start.md` is the skill that fires whenever a user says "Virgil, …". It is
// the highest-visibility prompt in the tree — it ships to every managed folder
// — and until task 473 **nothing guarded it at all**: no doctrine test, no
// freshness row, and no vitest root for `virgil/**` for one to live in. That
// is the structural reason it was the last file in the repo still teaching a
// RETIRED write.
//
// What it taught (`start.md:91`, at `44888b24`):
//
//     | "add a footnote" … | Dispatch `/editor/draft-footnote <docPath>
//       <requestId>` (find or create the request) |
//
// "or create the request" is a door that does not exist. There is no
// subcommand anywhere that appends a *pending* `ai-requests.json` row, and
// that sidecar has ONE authority (`apply_response.py` — atomic,
// version-bumped, under the editing pen); a raw write races the app and every
// other skill. The rule is the editor silo's, stated once in
// `editor/skills/_ask-shape.md`, and `draft-footnote.md` records that an
// earlier draft of its own step told the model to append the row by hand and
// was retired for it. The front door never got the memo, and had no pointer to
// the doctrine to get it from (measured pre-473: `_ask-shape` occurred ZERO
// times in `start.md`).
//
// Three legs, and the ones with teeth are the POSITIVE obligations rather than
// the phrase sweep. A negative keyword census over prose can only ever be
// missing a phrasing; what cannot be missed is "you route a specialist that
// REQUIRES an inbox id, so you must state where the id comes from, what to do
// when there is none, and how to resolve the anchor that door needs."
//
// POPULATION IS DISCOVERED at both ends:
//   • the front-door skills are every non-`_` `*.md` in `virgil/skills/`;
//   • the Task-bound specialists are derived from the EDITOR silo's own
//     frontmatter `Args:` line — a bare `<requestId>` / `<bibKey>` is
//     required, a bracketed `[<requestId>]` is optional (that is exactly what
//     distinguishes `create-card`, the Workflow-B door, from the eight skills
//     that genuinely cannot run without a Task).
// So a new front-door skill, or a new Task-bound specialist the front door
// starts routing, inherits the rule with nothing to add to a list.
//
// There is deliberately NO allowlist on any leg. A front-door route that
// dispatches a Task-bound specialist without stating its id contract is
// FIX-it, never list-it.

import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
// The on-disk layout SSOT — the same table the app's per-folder sync and every
// build script write by. Used here so the synced-folder spelling the front
// door quotes for `_ask-shape.md` cannot drift from where the file lands.
import { commandsDirFor } from "../../../library/lib/skill-bundle-layout.mjs";

// virgil/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const FRONT_DOOR_DIR = "virgil/skills";
const EDITOR_SKILL_DIR = "editor/skills";

/** The doctrine include the front door must POINT at rather than paraphrase. */
const ASK_SHAPE = "_ask-shape.md";
/** The chat-initiated create door (Workflow B) — the answer to "no Task". */
const WORKFLOW_B = "/editor/create-card";
/** Helpers that turn a quoted passage into the `%!v:` uuid Workflow B needs. */
const ANCHOR_RESOLVERS = ["get_para_context.py", "cards_for_paragraph.py"];

/** Hard-wrapped prose re-wraps freely, so every PHRASE assertion runs against
 *  a whitespace-collapsed copy. A regex sensitive to where a line happens to
 *  break fails for a reason that has nothing to do with the rule it guards. */
const flat = (rel: string) => read(rel).replace(/\s+/g, " ");

/** Every front-door skill. `_`-prefixed files are includes, not skills — the
 *  same filter both bundle builders apply. */
function frontDoorSkills(): string[] {
  return readdirSync(join(repoRoot, FRONT_DOOR_DIR))
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
}

/** Editor skills whose frontmatter `Args:` declares a REQUIRED inbox id.
 *
 *  The `Args:` line lives in the `description:` block and is hard-wrapped, so
 *  it is read off a whitespace-collapsed copy. A BRACKETED `[<requestId>]` is
 *  the skill declaring the arg optional — that is `create-card`, whose whole
 *  Workflow B exists for the no-Task case — so brackets exclude it. `<bibKey>`
 *  joins `<requestId>`: it is a row of `bib-review-requests.json`, the same
 *  inbox `list_requests.py` lists, and the front door has no more of a cursor
 *  for one than for the other. */
function taskBoundEditorSkills(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(join(repoRoot, EDITOR_SKILL_DIR))) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    const argsLine = flat(`${EDITOR_SKILL_DIR}/${f}`).match(/Args:(.*?)(?:\.\s|---)/);
    if (!argsLine) continue;
    const args = argsLine[1];
    // Strip every bracketed (optional) group before looking for the id.
    const required = args.replace(/\[[^\]]*\]/g, "");
    if (/<requestId>|<bibKey>/.test(required)) out.push(f.replace(/\.md$/, ""));
  }
  return out.sort();
}

/** The Task-bound specialists a given front-door skill actually routes. */
function routedTaskBound(skillFile: string): string[] {
  const body = flat(`${FRONT_DOOR_DIR}/${skillFile}`);
  return taskBoundEditorSkills().filter((name) => body.includes(`/editor/${name}`));
}

/** The retired instruction, in the phrasings a drafter reaches for. EXACT
 *  strings rather than a fuzzy verb sweep: the file legitimately DISCUSSES
 *  request rows (it has to, to forbid writing one), so a loose needle would
 *  indict the fix itself. Measured against the pre-473 file, the first entry
 *  is the hit. */
const RETIRED_WRITE_PHRASES = [
  "create the request",
  "create a request",
  "creating the request",
  "creating a request",
  "append the request",
  "append a request",
  "write the request row",
  "invent a request",
  "make up a request",
];

describe("front door — no invented Tasks, and the id contract is stated", () => {
  it("finds a population at both ends (canary)", () => {
    // If either derivation silently returned nothing, every leg below would
    // pass vacuously — which is the failure mode this whole file exists to
    // close one level up.
    expect(frontDoorSkills()).toContain("start.md");
    const bound = taskBoundEditorSkills();
    expect(bound).toEqual(
      expect.arrayContaining([
        "answer-cutter-comment",
        "answer-note-request",
        "answer-report-request",
        "answer-revision-request",
        "answer-todo-request",
        "answer-bib-review",
        "draft-footnote",
        "draft-suggestion",
        "find-citation",
      ]),
    );
    // …and the Workflow-B door is NOT in it. `create-card` declares
    // `[<requestId>]` — bracketed, i.e. optional — and it is the answer to the
    // no-Task case, so classing it as Task-bound would make rule 3 circular.
    expect(bound).not.toContain("create-card");
  });

  for (const skill of frontDoorSkills()) {
    const rel = `${FRONT_DOOR_DIR}/${skill}`;

    it(`${skill} does not instruct a request-row write`, () => {
      const body = flat(rel).toLowerCase();
      const hits = RETIRED_WRITE_PHRASES.filter((p) => body.includes(p));
      expect(
        hits,
        `${rel} instructs the model to CREATE an ai-requests.json request ` +
          `(${hits.join(", ")}). There is no such door — see ` +
          `${EDITOR_SKILL_DIR}/${ASK_SHAPE}. Route the no-Task case through ` +
          `${WORKFLOW_B} instead.`,
      ).toEqual([]);
    });

    const routed = routedTaskBound(skill);
    if (routed.length === 0) continue;

    it(`${skill} points at the ${ASK_SHAPE} doctrine`, () => {
      expect(
        read(rel).includes(ASK_SHAPE),
        `${rel} routes Task-bound specialists (${routed.join(", ")}) but never ` +
          `points at ${EDITOR_SKILL_DIR}/${ASK_SHAPE}. State the rule by ` +
          `POINTER — that include's own header forbids paraphrasing it back ` +
          `into a skill.`,
      ).toBe(true);
    });

    it(`${skill} states where the id comes from`, () => {
      expect(
        read(rel).includes("list_requests.py"),
        `${rel} routes Task-bound specialists (${routed.join(", ")}) — each of ` +
          `which validates its id and refuses an unknown one — without naming ` +
          `list_requests.py, the one door that lists all three inboxes. An id ` +
          `with no stated source is an id the model will fabricate.`,
      ).toBe(true);
    });

    it(`${skill} routes the no-Task case through Workflow B`, () => {
      const body = read(rel);
      expect(
        body.includes(WORKFLOW_B) && body.includes("--anchor"),
        `${rel} routes Task-bound specialists (${routed.join(", ")}) but names ` +
          `no route for the ordinary case where the ask has NO Task. That is ` +
          `${WORKFLOW_B} with --anchor <paragraph-uuid>, which synthesizes and ` +
          `completes its own Task.`,
      ).toBe(true);
    });

    it(`${skill} says how to resolve the anchor Workflow B needs`, () => {
      // The failure this closes is replacing one unstated contract with
      // another: Workflow B requires a paragraph `%!v:` uuid, the front door
      // has no cursor, and `create_card.py` refuses an unknown anchor while a
      // WRONG one anchors the artifact to the wrong prose in silence.
      const body = read(rel);
      expect(
        ANCHOR_RESOLVERS.some((r) => body.includes(r)),
        `${rel} tells the model to pass --anchor <uuid> but names no way to ` +
          `resolve one (${ANCHOR_RESOLVERS.join(" / ")}).`,
      ).toBe(true);
    });
  }

  it("the doctrine pointer resolves in BOTH layouts", () => {
    // A cross-silo path contract: the repo spelling and the synced-folder
    // spelling are different strings for one file, and a rename would break
    // the link silently in a prompt nothing type-checks (task 204's shape).
    const ssot = `${EDITOR_SKILL_DIR}/${ASK_SHAPE}`;
    expect(existsSync(join(repoRoot, ssot)), `${ssot} is gone`).toBe(true);

    const body = read(`${FRONT_DOOR_DIR}/start.md`);
    // The repo-relative link, resolved from virgil/skills/.
    const linked = body.match(/\]\((\.\.\/\.\.\/[^)]*_ask-shape\.md)\)/);
    expect(linked, "start.md carries no repo-relative _ask-shape.md link").not.toBeNull();
    expect(
      existsSync(join(repoRoot, FRONT_DOOR_DIR, linked![1])),
      `start.md's _ask-shape.md link (${linked![1]}) does not resolve`,
    ).toBe(true);

    // …and the synced-folder spelling it quotes must match the layout SSOT.
    expect(
      body.includes(`${commandsDirFor("editor")}/${ASK_SHAPE}`),
      `start.md quotes a synced-folder path for ${ASK_SHAPE} that is not ` +
        `${commandsDirFor("editor")}/${ASK_SHAPE} — the layout SSOT's answer.`,
    ).toBe(true);
  });
});
