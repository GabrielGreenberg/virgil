// Escape-means-cancel CENSUS — the guard that makes task 687's fix a rule
// rather than a repair.
//
// The law, already settled by task 555 ("Escape MEANS cancel everywhere"):
// *a key the user presses to abandon must never be the key that saves.*
// Task 555 closed the field-level members (the citation card's Code box). This
// census closes the SURFACE-level one, which has a different shape and is why
// it outlived that sweep.
//
// ── What went wrong, and why nothing could see it ──────────────────────────
// A floating surface ends through three exits — a DISMISS (click-outside), a
// CANCEL (Escape, and any × whose label names Escape), and a COMMIT (a button,
// Return). `useMenuDismiss` routed the first two through ONE `onClose` prop,
// which is harmless for every menu that stages nothing: with no draft in hand,
// dismissing and cancelling are the same act. So the conflation was invisible
// for ~20 call sites and correct for all of them.
//
// Then a DEFERRED-COMMIT surface arrived. `CitationCreatePopover` stages
// citekeys and materializes the `\cite` only on commit — and committing on
// click-away is a deliberate, good design there. It therefore bound the commit
// chokepoint to the one close channel it was given:
//
//     onClose={commitAndClose}
//
// and Escape, sharing that channel, INSERTED the citation the user pressed it
// to abandon. There was no abandon path short of removing every staged chip by
// hand. Nothing decided this; a prop was reused.
//
// ── The census ─────────────────────────────────────────────────────────────
// The population is discovered by the QUESTION, not by a mechanism: *which JSX
// element hands its close channel a function that COMMITS?* Any such element
// must also hand over a distinct `onCancel`, so Escape has a door that does not
// pass through the commit. A future staging popover reproduces the defect only
// by failing this leg.
//
// Deliberately NOT "every element with an onClose" — that is the whole menu
// system, and an allowlist of surfaces that stage nothing is a filing cabinet,
// not a guard. The signal is the COMMIT VERB in the bound identifier, which is
// exactly what distinguishes a close channel that can lose work from one that
// cannot. Residual, stated rather than implied: a commit bound through an
// identifier named for its subject rather than its verb (`onClose={finish}`)
// is invisible here, as is one wrapped inline (`onClose={() => { … }}`); both
// are caught by leg 3's MECHANISM instead, which pins that the cancel door
// exists at the primitive at all.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SRC, LIBRARY, walkSource, stripComments } from "./_menu-census";

/** A bound identifier whose NAME says it commits. */
const COMMIT_VERB =
  /\b(?:commit|save|apply|insert|confirm|accept|submit|publish)[A-Za-z0-9_$]*\b/i;

/** `onClose={someIdentifier}` — the binding form this census can read. */
const ON_CLOSE_BINDING = /\bonClose=\{\s*([A-Za-z0-9_$.]+)\s*\}/g;

/**
 * The JSX element a match sits inside, as source text: back up to the nearest
 * opening `<Component`, then forward to the `>` that ends the opening tag,
 * ignoring any `>` nested inside a brace expression. Good enough for the prop
 * lists this repo writes, and it never spans two elements.
 */
function enclosingOpeningTag(source: string, at: number): string {
  const before = source.slice(0, at);
  const start = before.search(/<[A-Z][A-Za-z0-9_.]*(?![\s\S]*<[A-Z][A-Za-z0-9_.]*)/);
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

interface Hit {
  key: string;
  bound: string;
  tag: string;
}

function censusCommittingCloseChannels(): Hit[] {
  const hits: Hit[] = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const file of walkSource(root)) {
      if (!file.endsWith(".tsx")) continue;
      const rel = `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`;
      const source = stripComments(readFileSync(file, "utf8"));
      for (const m of source.matchAll(ON_CLOSE_BINDING)) {
        const bound = m[1];
        if (!COMMIT_VERB.test(bound)) continue;
        hits.push({
          key: `${rel}::onClose={${bound}}`,
          bound,
          tag: enclosingOpeningTag(source, m.index ?? 0),
        });
      }
    }
  }
  return hits;
}

describe("Escape means cancel — the surface census", () => {
  it("every close channel bound to a COMMIT also hands over a cancel door", () => {
    const offenders = censusCommittingCloseChannels()
      .filter((h) => !/\bonCancel=/.test(h.tag))
      .map((h) => h.key);
    expect(
      offenders,
      offenders.length
        ? `These surfaces route dismissal into a COMMIT and give Escape no other ` +
          `door, so the key that abandons is the key that saves (task 687 / 555). ` +
          `Pass a distinct \`onCancel\` that tears down without committing:\n  ` +
          offenders.join("\n  ")
        : "",
    ).toEqual([]);
  });

  it("the census is not vacuous — it finds the live member it was written for", () => {
    const keys = censusCommittingCloseChannels().map((h) => h.key);
    expect(keys).toContain(
      "src/panels/Citations/CitationCreatePopover.tsx::onClose={commitAndClose}",
    );
  });

  it("MECHANISM — the primitive HAS a cancel door, defaulting to onClose", () => {
    // Without this leg the census above could be satisfied by passing an
    // `onCancel` the dismissal hook ignores.
    const dismiss = readFileSync(
      path.join(SRC, "components/menu/useMenuDismiss.ts"),
      "utf8",
    );
    const code = stripComments(dismiss);
    // Escape ends through the cancel door…
    expect(code).toMatch(/const\s+endOnEscape\s*=\s*onCancel\s*\?\?\s*onClose/);
    expect(code).toMatch(/endOnEscape\(\)/);
    // …and the dismiss door is still onClose (click-outside is unchanged) —
    // read through a ref since task 746, so the subscription never keys on it.
    expect(code).toMatch(/isInside\([\s\S]{0,120}?onCloseRef\.current\(\)/);
    expect(code).toMatch(/onCloseRef\.current\s*=\s*onClose/);
    // Escape must NOT still reach onClose directly.
    const escapeEffect = code.slice(code.indexOf('e.key !== "Escape"'));
    expect(escapeEffect).not.toMatch(/\bonClose\(\)/);
  });

  it("MECHANISM — the citation popover's cancel is NOT its commit chokepoint", () => {
    const src = stripComments(
      readFileSync(
        path.join(SRC, "panels/Citations/CitationCreatePopover.tsx"),
        "utf8",
      ),
    );
    expect(src).toMatch(/onCancel=\{discardAndClose\}/);
    expect(src).toMatch(/const\s+discardAndClose\s*=\s*onClose/);
    // The cancel door may never be the commit wrapper.
    expect(src).not.toMatch(/onCancel=\{commitAndClose\}/);
  });
});
