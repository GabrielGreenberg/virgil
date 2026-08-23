// Decorates `\pgmark{N}` runs in the editor with a margin-chip styling
// AND a red horizontal rule below each chip representing the page break.
//
// Semantics: in the LaTeX source, `\pgmark{N}` marks the START of page N
// (content after the mark is on page N). Visually, however, we want the
// chip to label the page whose content is ABOVE the rule (= the page
// that just ended). So for `\pgmark{N}` we render the chip with the
// PREVIOUS pgmark's label (page N-1), then the rule, then content of N.
//
// First pgmark in the document opens the first printed page (e.g.
// `\pgmark{525}`). It has no preceding page to label, so its chip is
// hidden entirely. A synthetic top-of-document rule (no chip) is
// inserted at position 0 of the doc, marking the document's opening
// boundary above the title.
//
// Last page in the doc has no following `\pgmark`, so it doesn't get
// a labeled chip. (If we wanted one, we'd need explicit end-of-doc
// signaling — out of scope for now.)
//
// Accepts both forms:
//   \pgmark{N}        — high-confidence (regex-detected page label)
//   \pgmark[low]{N}   — low-confidence (extrapolated or fallback)
// The low-confidence variant gets an extra `.pgmark-chip-low` class
// for faded styling and a tooltip explaining the reason.
//
// This extension is harmless on documents without any \pgmark text —
// the regex finds zero matches and no decorations are emitted. So it's
// safe to include in the main editor's default extension list.

import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Capture group 1: optional confidence ("low" or absent).
// Capture group 2: page label.
const PGMARK_RE = /\\pgmark(?:\[([a-zA-Z]+)\])?\{([^}]*)\}/g;

function makeRuleWidget(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pgmark-rule";
  const tag = document.createElement("span");
  tag.className = "pgmark-rule-tag";
  tag.textContent = "page break";
  wrap.appendChild(tag);
  return wrap;
}

function makeTopRuleWidget(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "pgmark-rule pgmark-rule-top";
  const tag = document.createElement("span");
  tag.className = "pgmark-rule-tag";
  tag.textContent = "page break";
  wrap.appendChild(tag);
  return wrap;
}

function buildDecorations(doc: PMNode): DecorationSet {
  // Collect every pgmark match in document order, then process: the
  // first one is suppressed (no chip, no rule at-position), all
  // subsequent ones get a chip + a block-level rule widget directly
  // after the chip. A synthetic top-of-doc rule is always emitted
  // (representing the start of the first printed page).
  type Match = { start: number; end: number; confidence: string; label: string };
  const matches: Match[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    PGMARK_RE.lastIndex = 0;
    let m;
    while ((m = PGMARK_RE.exec(text)) !== null) {
      matches.push({
        start: pos + m.index,
        end: pos + m.index + m[0].length,
        confidence: m[1]?.toLowerCase() || "high",
        label: m[2] || "?",
      });
    }
  });

  const decos: Decoration[] = [];

  // Common case for docs without any pgmark anchors (most non-library
  // docs): no matches → no decorations. Return the singleton so PM sees
  // an unchanged decoration reference between docChanged transactions
  // and skips reconciliation entirely. Without this, every keystroke
  // allocated a fresh empty DecorationSet via `DecorationSet.create(doc, [])`.
  if (matches.length === 0) return DecorationSet.empty;

  // Top-of-document synthetic rule (represents the start of the first
  // printed page). Always present whenever there's at least one pgmark
  // anywhere in the doc.
  decos.push(
    Decoration.widget(0, makeTopRuleWidget, {
      side: -1,
      key: "pgmark-rule-top",
    }),
  );

  matches.forEach((mt, idx) => {
    const isFirst = idx === 0;
    const isLow = mt.confidence === "low" || mt.confidence === "missing";

    // The chip's DISPLAYED label is the PREVIOUS pgmark's value (the
    // page whose content is immediately above the chip). The current
    // pgmark's label IS the page about to start below the rule. The
    // first match has no preceding page, so its chip stays hidden.
    const displayedLabel = isFirst ? "" : matches[idx - 1].label;

    // Inline chip decoration over the LaTeX command text. CSS hides
    // the underlying `\pgmark{N}` text and renders the displayed label
    // via a ::before pseudo-element reading data-label. All DOM attrs
    // (class + data-* + title) must be in the *third* argument of
    // Decoration.inline — the fourth argument is for plugin spec
    // options (key, side) and DOM attrs there are silently ignored.
    const cls = ["pgmark-chip"];
    if (isLow) cls.push("pgmark-chip-low");
    if (isFirst) cls.push("pgmark-chip-first");
    const domAttrs: Record<string, string> = {
      class: cls.join(" "),
      "data-label": displayedLabel,
    };
    if (isLow) {
      domAttrs["data-confidence"] = "low";
      domAttrs["title"] = "Page label inferred from neighbors (not directly detected)";
    }
    decos.push(Decoration.inline(mt.start, mt.end, domAttrs));

    // Block-level rule widget after the chip — one per pgmark except
    // the first (the top synthetic rule stands in for that one).
    if (!isFirst) {
      decos.push(
        Decoration.widget(mt.end, makeRuleWidget, {
          side: 1,
          key: `pgmark-rule-${mt.start}`,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decos);
}

/**
 * Returns true iff any region touched by `tr.mapping` contains
 * "\pgmark" text (slightly expanded so a split match like "\pgmar" +
 * "k" still trips). Used to gate the expensive full-doc rebuild.
 *
 * O(changed-region-size) — for typing in a paragraph that has no
 * `\pgmark` text, the inspection returns false and the apply() exits
 * via the cheap mapped-set path.
 */
function changedRegionTouchesPgmark(
  tr: import("@tiptap/pm/state").Transaction,
): boolean {
  let found = false;
  tr.mapping.maps.forEach((stepMap) => {
    if (found) return;
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      if (found) return;
      // Expand the window by 8 chars on each side so partial matches
      // straddling the edit boundary aren't missed.
      const expandedFrom = Math.max(0, newFrom - 8);
      const expandedTo = Math.min(tr.doc.content.size, newTo + 8);
      if (expandedTo <= expandedFrom) return;
      const text = tr.doc.textBetween(expandedFrom, expandedTo, "\n", "\n");
      if (text.includes("\\pgmark")) found = true;
    });
  });
  return found;
}

export const PgMarkChip = Extension.create({
  name: "pgmarkChip",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pgmarkChip"),
        state: {
          init: (_c, state) => buildDecorations(state.doc),
          // [cost: O(changed region)/tx — DecorationSet.map + a textBetween probe over the step maps (±8 chars); O(doc) buildDecorations + DecorationSet.create only when the edit touched a `\pgmark` run] (task 433 census)
          apply: (tr, old) => {
            // Cheap forward-map first — keeps existing decorations
            // anchored to their new positions for any docChanged tx
            // that didn't touch a `\pgmark` region.
            const mapped = old.map(tr.mapping, tr.doc);
            if (!tr.docChanged) return mapped;
            // Full rebuild only when the user actually edited near a
            // `\pgmark`. Most keystrokes elsewhere skip it entirely.
            if (changedRegionTouchesPgmark(tr)) {
              return buildDecorations(tr.doc);
            }
            return mapped;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state) as DecorationSet | undefined;
          },
        },
      }),
    ];
  },
});
