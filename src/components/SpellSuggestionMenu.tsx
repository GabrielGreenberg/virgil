"use client";

/**
 * The spelling suggestion menu (task 518).
 *
 * Mounted ONCE, at the app root: the open menu is a gesture-scoped singleton
 * (`spell-menu-store.ts`) and its REQUEST carries the document's own port, so
 * this renderer needs no per-document context even though N keep-alive panes
 * each have a dictionary of their own. It is the `MenuProvider` family's
 * rect-anchored form — the same primitive the grab-bar menu uses, so it
 * inherits placement, click-outside dismissal, Escape and arrow-key navigation
 * rather than hand-rolling a fifth popover.
 *
 * ## Three kinds of row, and the difference between the last two matters
 *
 *   - a SUGGESTION replaces the word. An ordinary undoable edit through
 *     `tr.insertText`, so Cmd+Z puts the misspelling back and the replacement
 *     inherits the marks at that position (a corrected word inside a bold run
 *     stays bold).
 *   - "Add to this paper's dictionary" writes `dictionary.json` — a term that
 *     belongs to THIS argument, travelling with the paper.
 *   - "Add to my dictionary" writes the global list — a word that follows the
 *     WRITER. The two are a real choice, which is why both are offered rather
 *     than one being guessed at.
 *
 * Suggestions are fetched when the menu OPENS and never before: the search is
 * an edit-distance walk of the whole dictionary, which is exactly the cost the
 * checking path is designed never to pay.
 */

import { useEffect, useState } from "react";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "@/components/menu/MenuProvider";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { MenuSectionLabel, MenuSeparator } from "@/components/menu/MenuChrome";
import { closeSpellMenu, useSpellMenuRequest } from "@/lib/spell/spell-menu-store";

const PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

/** How many alternatives to show. Beyond a handful the list stops being a
 *  choice and becomes a search — and the ones past the first few are rarely
 *  what was meant. */
export const MAX_SPELL_SUGGESTIONS = 6;

export function SpellSuggestionMenu() {
  const request = useSpellMenuRequest();
  // The result is stored WITH the word it belongs to, and the render derives
  // "still loading" from a mismatch. That is what lets the effect avoid a
  // synchronous `setState` reset when the word changes (a cascading render, and
  // what React's own lint flags): a stale result for the previous word simply
  // does not match the current one.
  const [result, setResult] = useState<{ word: string; list: string[] } | null>(null);

  const word = request?.word ?? null;
  const port = request?.port ?? null;
  useEffect(() => {
    if (!word || !port) return;
    let live = true;
    void port.suggest(word).then((s) => {
      if (live) setResult({ word, list: s.slice(0, MAX_SPELL_SUGGESTIONS) });
    });
    return () => {
      live = false;
    };
  }, [word, port]);
  const suggestions = result && result.word === word ? result.list : null;

  if (!request || typeof document === "undefined") return null;

  const close = () => closeSpellMenu();

  const replaceWith = (replacement: string) => {
    const { view, from, to } = request;
    // An ordinary undoable edit. `insertText` carries the marks at `from`, so
    // a corrected word inside a bold run stays bold.
    view.dispatch(view.state.tr.insertText(replacement, from, to));
    view.focus();
    close();
  };

  return (
    <MenuProvider
      id="spell"
      layout="list"
      role="menu"
      portal
      anchorRect={request.rect}
      placements={PLACEMENTS}
      onClose={close}
      ariaLabel={`Spelling suggestions for “${request.word}”`}
      containerStyle={{ minWidth: 200, padding: "4px 0" }}
    >
      {suggestions === null ? (
        <MenuSectionLabel>Checking…</MenuSectionLabel>
      ) : suggestions.length === 0 ? (
        <MenuSectionLabel>No suggestions</MenuSectionLabel>
      ) : (
        suggestions.map((s) => (
          <MenuActionRow
            key={s}
            id={`spell-suggest-${s}`}
            label={s}
            onSelect={() => replaceWith(s)}
          />
        ))
      )}
      <MenuSeparator />
      <MenuActionRow
        id="spell-add-paper"
        label="Add to this paper’s dictionary"
        onSelect={() => {
          request.port.acceptInPaper(request.word);
          close();
        }}
      />
      <MenuActionRow
        id="spell-add-global"
        label="Add to my dictionary"
        onSelect={() => {
          request.port.acceptGlobally(request.word);
          close();
        }}
      />
    </MenuProvider>
  );
}
