import { describe, it, expect, vi } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import {
  MORPH_DROP_FIELDS,
  describeDrops,
  morphDropsTone,
} from "../morph-drop-fields";
import {
  morphConfirmMessage,
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import type { CardKind, MorphDropField } from "../types";
// Registering the converters runs the boot assertions, so the registry sweeps
// below see the same declarations the app does.
import "../morphs";

/**
 * Task 303 — the morph-confirm dialog's two generated signals (the copy and the
 * tone) both read off `morph.drops` through the ONE `MORPH_DROP_FIELDS` table.
 *
 * The legs that catch the ORIGINAL shapes are the two registry sweeps: neither
 * defect lived in a function that could be tested in isolation. (a) was an
 * emergent collision between an atomic-part joiner and one part that carried
 * its own comma-list — `describeDrops` was "correct" for atomic parts and the
 * label was "correct" on its own. (b) was a literal at a call site, so the
 * copy-generating function it disagreed with couldn't see it. Both fail on the
 * pre-303 tree.
 */

function allMorphKinds(): CardKind[] {
  return (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
    (k) => (CARD_REGISTRY[k].morph?.drops.length ?? 0) > 0,
  );
}

describe("MORPH_DROP_FIELDS — the vocabulary invariants", () => {
  it("every noun is an ATOMIC noun phrase (no comma / semicolon / dash)", () => {
    // Invariant 2: `describeDrops` joins parts with "and" and serial commas, so
    // a part carrying its own punctuation garden-paths the reader. This is the
    // structural form of the (a) fix — a reworded string would leave the next
    // label free to reintroduce it.
    for (const [field, d] of Object.entries(MORPH_DROP_FIELDS)) {
      expect(d.noun, `${field}.noun`).not.toMatch(/[,;—–:]/);
      expect(d.noun.trim(), `${field}.noun`).not.toBe("");
    }
  });

  it("covers every MorphDropField the union declares", () => {
    // The compile-time half is the `Record<MorphDropField, …>` annotation; this
    // is its runtime canary (a `satisfies`-less widening, or a field deleted
    // from the table by hand, would still typecheck against `Record<string,…>`).
    const declared: MorphDropField[] = [
      "title",
      "byline",
      "aiRequest",
      "body",
      "keys",
      "formatting",
    ];
    expect(Object.keys(MORPH_DROP_FIELDS).sort()).toEqual([...declared].sort());
  });

  it("every drop field a real morph declares is in the table (no raw identifier can reach the dialog)", () => {
    for (const k of allMorphKinds()) {
      for (const field of CARD_REGISTRY[k].morph!.drops) {
        expect(MORPH_DROP_FIELDS[field], `${k}.morph.drops → ${field}`).toBeTruthy();
      }
    }
  });
});

describe("describeDrops — the join can't garden-path (303a)", () => {
  it("a two-field set reads as two top-level items, with NO stray comma", () => {
    // The reported shape: `["formatting","aiRequest"]` used to render
    // "the rich formatting — citations, math, and lists and the AI-request flag".
    expect(describeDrops(["formatting", "aiRequest"])).toBe(
      "the rich formatting and the AI-request flag",
    );
  });

  it("EVERY real morph's generated phrase carries only serial-list commas", () => {
    // The general statement of (a): for an n-part join the only commas the
    // phrase may contain are the n−2 serial ones. Any part smuggling its own
    // comma-list blows this for that morph, whichever label it is.
    for (const k of allMorphKinds()) {
      const drops = CARD_REGISTRY[k].morph!.drops;
      const phrase = describeDrops(drops);
      const commas = (phrase.match(/,/g) ?? []).length;
      expect(commas, `${k}: "${phrase}"`).toBe(Math.max(0, drops.length - 2));
    }
  });

  it("still renders one, two and three-field sets in plain English", () => {
    expect(describeDrops(["body"])).toBe("the body");
    expect(describeDrops(["body", "title"])).toBe("the body and the title");
    expect(describeDrops(["body", "title", "byline"])).toBe(
      "the body, the title, and the author byline",
    );
  });
});

describe("morphDropsTone — tone tracks drop severity (303b)", () => {
  it("a substance drop is danger; a metadata-only set stays calm", () => {
    expect(morphDropsTone(["body", "title"])).toBe("danger");
    expect(morphDropsTone(["formatting", "aiRequest"])).toBe("danger");
    expect(morphDropsTone(["keys"])).toBe("danger");
    expect(morphDropsTone(["title", "byline"])).toBe("default");
    expect(morphDropsTone(["aiRequest"])).toBe("default");
    // Never reaches a dialog (morphConfirmMessage returns null), but pinned so
    // the reduction can't invert on the empty set.
    expect(morphDropsTone([])).toBe("default");
  });

  it("every real morph's confirm carries the tone its drops earn", () => {
    for (const k of allMorphKinds()) {
      const copy = morphConfirmMessage(k)!;
      expect(copy.tone, k).toBe(morphDropsTone(CARD_REGISTRY[k].morph!.drops));
    }
  });

  it("the four user-triggerable lossy morphs land on the intended tones", () => {
    // note → highlight discards the ENTIRE rich note body; the comment →
    // suggestion pair flattens citations / math / lists away. Those are the same
    // loss a content-bearing DELETE already reddens.
    expect(morphConfirmMessage("note")!.tone).toBe("danger");
    expect(morphConfirmMessage("revision-comment")!.tone).toBe("danger");
    expect(morphConfirmMessage("cutter-comment")!.tone).toBe("danger");
    // report → report-request drops a title + byline; report-request → report
    // drops a flag. Metadata — blanket-reddening these would dull the signal.
    expect(morphConfirmMessage("report")!.tone).toBe("default");
    expect(morphConfirmMessage("report-request")!.tone).toBe("default");
  });
});

describe("the executor FORWARDS the tone (the guard that catches the original shape)", () => {
  function deps(): { d: CardLifecycleDeps; confirm: ReturnType<typeof vi.fn> } {
    const confirm = vi.fn(async () => true);
    return {
      d: {
        confirm,
        unbridgeAiRequest: vi.fn(async () => {}),
        mutate: vi.fn(() => {}),
      },
      confirm,
    };
  }

  it("a whole-body morph reaches the dialog as danger", async () => {
    const { d, confirm } = deps();
    await runCardLifecycleEvent({ type: "morph", fromKind: "note", id: "n1" }, d);
    // Fails on the pre-303 tree, where run-event hardcoded `tone: "default"` for
    // every morph — no copy-level test could have seen that literal.
    expect(confirm.mock.calls[0][0]).toMatchObject({ tone: "danger" });
  });

  it("a metadata-only morph reaches the dialog as default", async () => {
    const { d, confirm } = deps();
    await runCardLifecycleEvent({ type: "morph", fromKind: "report", id: "r1" }, d);
    expect(confirm.mock.calls[0][0]).toMatchObject({ tone: "default" });
  });

  it("a comment → suggestion morph shows the un-garden-pathed copy AND danger", async () => {
    const { d, confirm } = deps();
    await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-comment", id: "c1" },
      d,
    );
    const opts = confirm.mock.calls[0][0] as { message: string; tone: string };
    expect(opts.message).toContain(
      "This drops the rich formatting and the AI-request flag",
    );
    expect(opts.message).not.toContain("lists and the AI-request flag");
    expect(opts.tone).toBe("danger");
  });
});
