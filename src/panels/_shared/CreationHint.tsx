"use client";

/**
 * The TEACHING half of a panel's empty state, painted from the registry
 * (task 2026-09-23-727).
 *
 * `CardListPanel`'s `emptyState` docstring used to say the panel authors this
 * "because only it knows how its cards are made." That sentence was the bug:
 * the panel does NOT know. `VIRGIL_ACTION_REGISTRY` knows, and when the
 * MenuBar's example buttons were retired the Examples panel went on telling
 * users to click a glyph that no longer existed — for as long as anyone cared
 * to read it. A panel knows the NOUN ("No examples yet."); the registry owns
 * the ROUTE; the HOST owns whether there is a "+" to click.
 *
 * So the split here is three-way and each fact is stated by whoever holds it:
 *
 *   noun   the panel, as ordinary copy before this element;
 *   route  `creationRoutesFor(action)` — see `@/lib/actions/creation-routes`;
 *   "+"    `PanelAddProvider`, which `CardListPanel` feeds from the button it
 *          is ACTUALLY about to render.
 *
 * That last one is not decoration. The Examples panel also declared an `onAdd`
 * prop that no host has ever passed — a second promise nobody could keep, of
 * the same shape as the glyph. A panel now cannot claim a "+" at all: it asks.
 *
 * `action` is an `ActionId`, so the link to the registry is a COMPILE-TIME one.
 * Retire the `example` row and this stops building; there is no spelling of a
 * surface here for a stale string to survive in.
 */

import { Fragment, createContext, useContext } from "react";
import type { ActionId } from "@/lib/actions/action-registry";
import { creationRoutes, type CreationRoute } from "@/lib/actions/creation-routes";

/**
 * Does the panel around this empty state actually render a "+"? Defaults to
 * `false`: an empty state rendered outside a `CardListPanel` promises nothing.
 */
const PanelAddContext = createContext(false);

/** Fed by `CardListPanel` from its own `handleAdd`. */
export const PanelAddProvider = PanelAddContext.Provider;

function Token({ route }: { route: CreationRoute }) {
  return route.tokenStyle === "code" ? (
    <code className="text-xs bg-surface-muted-strong px-1 rounded">{route.token}</code>
  ) : (
    <span className="font-medium">{route.token}</span>
  );
}

/**
 * Renders the same sentence `creationSentence()` produces in plain text, with
 * each token painted — a LaTeX literal as a code chip (matching the `\cite`
 * chip the Citations panel already shipped), an on-screen control in medium.
 *
 * Renders nothing when the registry declares no reachable surface and the panel
 * has no "+": a kind with no way in teaches nothing, and inventing a clause for
 * it is the defect this component exists to retire.
 */
export function CreationHint({ action }: { action: ActionId }) {
  const hasPanelAdd = useContext(PanelAddContext);
  const routes = creationRoutes(action, hasPanelAdd);
  if (routes.length === 0) return null;
  return (
    <>
      {" "}
      {routes.map((route, i) => (
        <Fragment key={route.surface}>
          {i === 0 ? "" : i === routes.length - 1 ? ", or " : ", "}
          {i === 0 ? capitalise(route.verb) : route.verb}{" "}
          <Token route={route} />
          {route.tail}
        </Fragment>
      ))}
      .
    </>
  );
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
