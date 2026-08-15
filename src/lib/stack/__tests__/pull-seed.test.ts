/**
 * Task 330 — what a Stack pull carries, stated as a SUBTRACTION.
 *
 * The pre-330 pull was a hand-picked copy: the host started each card from an
 * empty record and forwarded a few named fields, so every kind lost at least one
 * field the user had typed (a note's `title`, a todo's `notes`, a suggestion's
 * `user_text` + `instructions`), and the omissions were invisible — an omitted
 * field looks exactly like a field that does not exist.
 *
 * `pullSeed` inverts the direction, and this suite pins the two halves of that
 * inversion:
 *
 *   • the FLOOR — every field the registry declares as content survives the
 *     strip, derived from `CARD_REGISTRY` rather than restated here, so a new
 *     content field on an existing kind is covered by declaration alone;
 *   • the CEILING — identity, per-doc bindings and doc-bound lifecycle are gone,
 *     because a pulled suggestion claiming `applied` would offer Keep/Revert
 *     over a splice that lives in ANOTHER document.
 *
 * The table's own two rot modes (a name that is not a field of the record; a
 * vocabulary member with no entry) are COMPILE errors by construction — see
 * `NON_TRAVELLING_FIELDS`'s mapped type — so they are deliberately not tested
 * here. A runtime leg restating them would be the tautology task 260 is about.
 */
import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import {
  CARD_KIND_BY_STACK_CARD_KIND,
  STACK_CARD_KINDS,
  type StackCardKind,
} from "../card-kinds";
import { NON_TRAVELLING_FIELDS, pullSeed } from "../pull-seed";
import {
  POPULATED_SNAPSHOT_DATA,
  UNCARRIABLE_CONTENT_FIELDS,
  asRecord,
  declaredContentFields,
} from "./_pull-fixtures";

/** The seed a pull of `kind` produces from the fully-populated fixture. */
function seedFor(kind: StackCardKind): Record<string, unknown> {
  return asRecord(pullSeed(kind, POPULATED_SNAPSHOT_DATA[kind] as never));
}

function contentFieldsFor(kind: StackCardKind): string[] {
  const exempt = new Set(UNCARRIABLE_CONTENT_FIELDS[kind] ?? []);
  return declaredContentFields(
    CARD_REGISTRY[CARD_KIND_BY_STACK_CARD_KIND[kind]].content,
  ).filter((f) => !exempt.has(f));
}

describe("the floor — declared content survives the strip", () => {
  it.each([...STACK_CARD_KINDS])(
    "%s: every field CARD_REGISTRY calls content is on the seed",
    (kind) => {
      const seed = seedFor(kind);
      const fields = contentFieldsFor(kind);
      for (const field of fields) {
        expect(
          Object.prototype.hasOwnProperty.call(seed, field),
          `${kind}: the pull would not carry "${field}", a declared content field`,
        ).toBe(true);
        expect(seed[field], `${kind}.${field}`).toEqual(
          asRecord(POPULATED_SNAPSHOT_DATA[kind])[field],
        );
      }
    },
  );

  it("the fixtures actually populate what the registry declares", () => {
    // A vacuous floor is the failure mode this leg exists against: if a fixture
    // silently stopped carrying `notes`, the sweep above would still pass
    // (`hasOwnProperty` on a field the STRIP never touches) only because the
    // source had it. Assert the fixture is the adversarial input it claims to be.
    for (const kind of STACK_CARD_KINDS) {
      const data = asRecord(POPULATED_SNAPSHOT_DATA[kind]);
      for (const field of contentFieldsFor(kind)) {
        expect(
          data[field],
          `${kind}: the fixture leaves "${field}" empty, so the floor proves nothing`,
        ).toBeTruthy();
      }
    }
  });

  it("the named losses are the four the report opened with", () => {
    // The report's own table, re-run through the real strip. Each of these was
    // absent from the card the user got back.
    expect(seedFor("note").title).toBe("a title the user typed");
    expect(seedFor("note").titleAuto).toBe(false);
    expect(seedFor("todo").notes).toBe("notes the user typed");
    expect(seedFor("revision-suggestion").user_text).toBe(
      "the human's own rewrite",
    );
    expect(seedFor("revision-suggestion").instructions).toBe("make it punchier");
    expect(seedFor("cutter-suggestion").user_text).toBe("the human's own rewrite");
    expect(seedFor("cutter-suggestion").instructions).toBe(
      "preserve the citation",
    );
  });

  it("provenance travels WITH the content it describes", () => {
    // A pull that delivers the words and drops the flag saying who wrote them
    // has delivered a record that lies about itself.
    expect(seedFor("archive").titleAuto).toBe(false);
    expect(seedFor("todo").titleAuto).toBe(false);
    expect(seedFor("revision-suggestion").author).toBe("ai");
    expect(seedFor("cutter-suggestion").author).toBe("ai");
  });
});

describe("the ceiling — what a pull leaves behind", () => {
  it.each([...STACK_CARD_KINDS])("%s: no identity travels", (kind) => {
    const seed = seedFor(kind);
    expect(seed.id, `${kind}.id`).toBeUndefined();
    expect(seed.createdAt, `${kind}.createdAt`).toBeUndefined();
  });

  it.each([...STACK_CARD_KINDS])(
    "%s: no per-doc binding or doc-bound lifecycle travels",
    (kind) => {
      const seed = seedFor(kind);
      expect(seed.links, `${kind}.links`).toBeUndefined();
      expect(seed.selectedText, `${kind}.selectedText`).toBeUndefined();
      expect(seed.archived, `${kind}.archived`).toBeUndefined();
      expect(seed.unanchored, `${kind}.unanchored`).toBeUndefined();
    },
  );

  it("an APPLIED suggestion is not carried as applied", () => {
    // The splice `appliedChange` describes lives in the SOURCE paper's `.tex`.
    // A copy claiming `applied` would advertise Keep/Revert over a range this
    // document has never had (AGENTS.md, "The lifecycle half").
    for (const kind of ["revision-suggestion", "cutter-suggestion"] as const) {
      expect(seedFor(kind).status, kind).toBeUndefined();
      expect(seedFor(kind).appliedChange, kind).toBeUndefined();
    }
  });

  it("a bib entry travels WHOLE — the strip has nothing to do there", () => {
    // The one kind whose entry is deliberately empty. Its pull runs through
    // `upsertBibEntry`, the same sink `applyBibCarry` feeds: insert-if-absent on
    // the citekey, with `addBibEntry` as the documented uid mint point. Shedding
    // the `key` would defeat the whole bib carry (task 235), and shedding the
    // `uid` here while the carry path keeps it would be a fork, not a fix.
    const seed = seedFor("bibliography");
    expect(seed).toEqual(POPULATED_SNAPSHOT_DATA.bibliography);
  });
});

describe("the strip is exactly the declared table", () => {
  it.each([...STACK_CARD_KINDS])("%s removes its listed fields and no others", (kind) => {
    const data = asRecord(POPULATED_SNAPSHOT_DATA[kind]);
    const seed = seedFor(kind);
    const removed = Object.keys(data).filter(
      (k) => !Object.prototype.hasOwnProperty.call(seed, k),
    );
    expect(new Set(removed)).toEqual(
      new Set(NON_TRAVELLING_FIELDS[kind] as readonly string[]),
    );
  });

  it("pullSeed does not mutate the snapshot it reads", () => {
    // The plan runs TWICE per gesture (once per `DropSpec` door), so a mutating
    // strip would hand the second pass a record the first had already emptied.
    const before = JSON.stringify(POPULATED_SNAPSHOT_DATA.note);
    seedFor("note");
    seedFor("note");
    expect(JSON.stringify(POPULATED_SNAPSHOT_DATA.note)).toBe(before);
  });
});
