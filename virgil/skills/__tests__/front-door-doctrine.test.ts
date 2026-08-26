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
// POPULATION WIDENED (task 474). The id-contract legs originally fired only
// for a front-door skill that SPELLED a Task-bound specialist's name — which
// was true while `start.md` carried a hand-typed row per route. 474 retired
// that table: the skills' own `description:` frontmatter is the routing
// vocabulary now, so the front door dispatches every editor specialist and
// names almost none of them. Stated honestly rather than dramatically: at
// 474 exactly ONE Task-bound name survives in `start.md`'s prose
// (`/editor/find-citation`, named as the owner of citation sourcing), so the
// old gate still fires today — it is one prose edit away from not, and a
// guard whose population depends on an incidental mention is a guard that can
// go silent without anyone touching it. The gate is therefore "does this
// skill dispatch editor specialists AT ALL", which no route table can narrow.
//
// TASK 474 also adds three legs of its own, and the first two are the ones
// with teeth — the table was never the part that could misbehave, a table
// that has fallen behind the skill set is:
//   • every slash ROUTE a front-door skill spells must resolve to a real
//     skill file (`start.md:100` routed `"deep research <topic>"` to a skill
//     that has never existed in any silo, and survived task 160's fix of the
//     identical class on this same file);
//   • Step 4's TRIGGER CONDITION — the heavy-library mode gate — must read
//     each skill's own weight DECLARATION and name no per-skill list (the
//     pre-474 list had already lost `/library/merge-bibs`, the one op that
//     rewrites `master.bib` library-wide);
//   • the derived heavy set is pinned against the near-miss that makes the
//     phrase criterion non-obvious (`/library/setup` says "the heavy
//     extraction tools" — an adjective on a noun, not a weight declaration).
//
// A COVERAGE leg — "every skill is routable from `start.md`" — is deliberately
// absent, and its absence is the point of 474's fix rather than a gap: with
// the descriptions as the vocabulary there is no route list to count against.
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

/** The Task-bound specialists a given front-door skill names OUTRIGHT. Used
 *  only to make a failure message concrete — never as the gate, see below. */
function routedTaskBound(skillFile: string): string[] {
  const body = flat(`${FRONT_DOOR_DIR}/${skillFile}`);
  return taskBoundEditorSkills().filter((name) => body.includes(`/editor/${name}`));
}

/** Does this front-door skill dispatch editor specialists at all?
 *
 *  This is the GATE for the id-contract legs. Asking "does it spell one of the
 *  nine Task-bound names?" was the pre-474 gate and it is unsound in the
 *  direction that matters: a front door that routes by the skills' own
 *  declared triggers dispatches all of them and names almost none, so the
 *  legs would skip on precisely the file that routes the most. */
function dispatchesEditorSpecialists(skillFile: string): boolean {
  const body = read(`${FRONT_DOOR_DIR}/${skillFile}`);
  return body.includes("/editor/") || body.includes("editor:*");
}

/** Every slash route a front-door skill spells, as `<silo>/<name>`.
 *
 *  The needle is the ROUTE form, not prose: task 474's phantom entry was a
 *  quoted user phrase ("deep research <topic>") in a table cell whose Branch
 *  column pointed at a mode gate, so a prose sweep could not have caught it
 *  and this leg is not claimed to. What it pins is the direction a phantom
 *  can still arrive from — a Branch cell naming `/editor/<x>` or
 *  `/library/<x>` that resolves to nothing — which is task 160's defect and
 *  the one this file survived.
 *
 *  Two path segments are excluded because they are DIRECTORIES this file
 *  legitimately names (`editor/skills/_ask-shape.md`, `editor/scripts/`), and
 *  a name carrying `_` or `.` is a FILE reference (`library_path.py`), not a
 *  route. A trailing `-` is the `answer-*` wildcard shorthand. */
const NON_ROUTE_SEGMENTS = new Set(["skills", "scripts"]);
function slashRoutes(skillFile: string): { silo: string; name: string }[] {
  const body = read(`${FRONT_DOOR_DIR}/${skillFile}`);
  const out: { silo: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\/(editor|library)\/([A-Za-z0-9_.*-]+)/g)) {
    const silo = m[1];
    const raw = m[2];
    // Order matters: a WILDCARD shorthand (`/editor/answer-*`) is a real
    // family reference, not a dead route, and stripping its tail first turns
    // it into `answer` — a name no silo has. Classify the RAW capture, then
    // trim only trailing markdown punctuation.
    if (/[_.*]/.test(raw)) continue;
    const name = raw.replace(/[-.]+$/, "");
    if (!name || NON_ROUTE_SEGMENTS.has(name)) continue;
    const key = `${silo}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ silo, name });
  }
  return out;
}

/** Library skills whose OWN description declares them a heavy operation.
 *
 *  This is the derivation Step 4's gate reads, restated here so the guard and
 *  the prompt cannot come to disagree about who is heavy. The phrase is
 *  `Heavy operation` (case-insensitive) and not a bare "heavy": `setup.md`
 *  says "the heavy extraction tools" and "the heavy indexing tools", which is
 *  an adjective on a noun and not a weight declaration — a looser needle
 *  would gate the one library skill that explicitly cd's into the library
 *  root from any managed folder. */
function heavyLibrarySkills(): string[] {
  const dir = join(repoRoot, "library", "skills");
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    const desc = readFileSync(join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
    if (!desc) continue;
    if (/heavy operation/i.test(desc[1].replace(/\s+/g, " "))) out.push(f.replace(/\.md$/, ""));
  }
  return out.sort();
}

/** Step 4's TRIGGER CONDITION — the first paragraph after its heading.
 *  Scoped to the condition rather than the whole section on purpose: the
 *  section's later Queue branch legitimately names `/library/deep-index` and
 *  `/library/index-pending` as the shapes it can write a queue entry for. */
function stepFourTrigger(): string {
  const body = read(`${FRONT_DOOR_DIR}/start.md`);
  const at = body.indexOf("### Step 4");
  expect(at, "start.md has no Step 4").toBeGreaterThan(-1);
  const after = body.slice(body.indexOf("\n", at) + 1).replace(/^\s*\n/, "");
  return after.slice(0, after.indexOf("\n\n"));
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

    if (!dispatchesEditorSpecialists(skill)) continue;
    // Named outright, else "every Task-bound specialist" — post-474 the front
    // door routes by declared triggers and spells almost no names.
    const named = routedTaskBound(skill);
    const routed = named.length ? named.join(", ") : taskBoundEditorSkills().join(", ");

    it(`${skill} points at the ${ASK_SHAPE} doctrine`, () => {
      expect(
        read(rel).includes(ASK_SHAPE),
        `${rel} routes Task-bound specialists (${routed}) but never ` +
          `points at ${EDITOR_SKILL_DIR}/${ASK_SHAPE}. State the rule by ` +
          `POINTER — that include's own header forbids paraphrasing it back ` +
          `into a skill.`,
      ).toBe(true);
    });

    it(`${skill} states where the id comes from`, () => {
      expect(
        read(rel).includes("list_requests.py"),
        `${rel} routes Task-bound specialists (${routed}) — each of ` +
          `which validates its id and refuses an unknown one — without naming ` +
          `list_requests.py, the one door that lists all three inboxes. An id ` +
          `with no stated source is an id the model will fabricate.`,
      ).toBe(true);
    });

    it(`${skill} routes the no-Task case through Workflow B`, () => {
      const body = read(rel);
      expect(
        body.includes(WORKFLOW_B) && body.includes("--anchor"),
        `${rel} routes Task-bound specialists (${routed}) but names ` +
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

describe("front door — the descriptions are the vocabulary, not a hand list", () => {
  for (const skill of frontDoorSkills()) {
    const rel = `${FRONT_DOOR_DIR}/${skill}`;

    it(`${skill}: every slash route resolves to a real skill`, () => {
      const routes = slashRoutes(skill);
      // Canary: an extractor that silently matched nothing would make this
      // leg — and the phantom-route class it closes — pass vacuously.
      expect(routes.length, `${rel} spells no /editor|/library route at all`).toBeGreaterThan(0);
      const dead = routes.filter(
        (r) => !existsSync(join(repoRoot, r.silo, "skills", `${r.name}.md`)),
      );
      expect(
        dead.map((r) => `/${r.silo}/${r.name}`),
        `${rel} routes to a skill that does not exist. A front-door route is ` +
          `a promise the model will try to keep — task 160 retired one dead ` +
          `route on this file and ${"task 474"} found the next one still ` +
          `standing. Delete the route or ship the skill.`,
      ).toEqual([]);
    });

    it(`${skill}: names the trigger declaration it routes by`, () => {
      // The positive obligation behind retiring the hand list. A front door
      // that dispatches specialists without naming WHERE its vocabulary comes
      // from is one clarifying-question away from re-typing the table.
      if (!dispatchesEditorSpecialists(skill)) return;
      const body = read(rel);
      expect(
        body.includes("Triggers on:"),
        `${rel} dispatches specialists but never names \`Triggers on:\` — the ` +
          `phrase every skill's own description declares its routes with. ` +
          `State that the descriptions ARE the vocabulary; a table that ` +
          `restates them is a snapshot of a skill set that moves.`,
      ).toBe(true);
      expect(
        body.includes("Args:"),
        `${rel} dispatches specialists but states no derivable rule for which ` +
          `of them are Task-bound. The criterion is each skill's own \`Args:\` ` +
          `line (a required, unbracketed <requestId>/<bibKey>) — the same ` +
          `derivation taskBoundEditorSkills() runs above.`,
      ).toBe(true);
    });
  }

  it("the heavy set is DERIVED from each library skill's own declaration", () => {
    const heavy = heavyLibrarySkills();
    // Canary + the M3 pin in one: merge-bibs is the op the pre-474 hand list
    // had lost, and it is the single most consequential one to run in the
    // wrong place (it folds every paper's references.bib into master.bib).
    expect(heavy).toEqual(
      expect.arrayContaining([
        "ai-requests",
        "deep-index",
        "index-pending",
        "iterate-skill",
        "merge-bibs",
        "triage-pending",
      ]),
    );
    // …and the near-miss that makes the phrase criterion non-obvious. `setup`
    // says "the heavy extraction tools" / "the heavy indexing tools" — an
    // adjective on a noun. It resolves the library root and cd's into it from
    // any managed folder, which is exactly what a heavy op cannot do, so a
    // bare /heavy/ needle would gate the one skill that must not be gated.
    expect(heavy).not.toContain("setup");
    // Light skills declare themselves too; none of them may be heavy.
    for (const light of ["index-paper", "triage-pdf", "authenticate-bib", "apply-bib-edit"]) {
      expect(heavy).not.toContain(light);
    }
  });

  it("Step 4's trigger condition reads the declaration, not a list", () => {
    const trigger = stepFourTrigger();
    expect(
      /heavy operation/i.test(trigger),
      `start.md's Step-4 trigger condition does not name the weight ` +
        `DECLARATION a library skill makes about itself. Without it the gate ` +
        `is whatever list happens to be typed there — and the pre-474 list ` +
        `had already lost /library/merge-bibs.\n\n${trigger}`,
    ).toBe(true);
    const listed = [...trigger.matchAll(/\/library\/([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(
      listed,
      `start.md's Step-4 trigger condition enumerates library skills by name. ` +
        `That is the hand list this leg exists to keep retired: a heavy op ` +
        `that ships without being typed here is dispatched inline in ` +
        `a paper session, which is how merge-bibs — a library-wide write — ` +
        `was reachable from one.\n\n${trigger}`,
    ).toEqual([]);
  });
});
