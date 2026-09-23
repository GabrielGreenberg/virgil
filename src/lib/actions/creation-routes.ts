/**
 * CREATION ROUTES — "how does a user MAKE one of these?", answered once, from
 * the table that owns the answer (task 2026-09-23-727).
 *
 * The defect this exists to retire: a panel's empty state is the first thing a
 * user reads about a card kind, and it was the one place in the app that
 * restated the registry's surfaces from MEMORY. The Examples panel told every
 * reader to "click the `(1)` glyph in the formatting toolbar" — a control that
 * was retired with the MenuBar's example buttons and now exists nowhere; a
 * repo-wide search for the literal found the sentence, the style guide quoting
 * the sentence, and nothing else. Following it exactly produced nothing. The
 * Outline panel had already shipped the same defect once ("use the Section
 * dropdown in the toolbar"), and `panel-empty-state-contract.test.ts` says in
 * its own header why neither was caught: a regex pins the SHAPE of a how-to,
 * only a reader pins whether it is HONEST.
 *
 * So stop asking a reader. `VIRGIL_ACTION_REGISTRY` already declares, per
 * action, exactly which surfaces can reach it (`surfaces`), what the slash
 * command is called (`slashName`) and what the menus label it (`label`) — and
 * `assertActionCoverage` reconciles `slashName` against the live
 * `VIRGIL_COMMAND_NAMES` in both directions. A sentence DERIVED from that row
 * is therefore true by the same proof that makes the surfaces true, and a
 * retired surface takes the sentence with it instead of leaving it behind.
 *
 * This is task 306's rule one column over. There, a panel's add-menu had to
 * derive its card-type LABELS from the registry rather than re-hardcode them
 * (`add-menu-labels-from-registry.test.ts`). Here it is the ROUTE. Same class:
 * panel copy may not restate a fact a registry owns.
 *
 * What this module is NOT: a phrasebook for every surface a user might reach an
 * action through. It answers the empty state's question — the one or two
 * shortest ways in — and deliberately caps at `MAX_ROUTES`, because a
 * sentence listing four routes teaches nothing.
 */

import {
  VIRGIL_ACTION_REGISTRY,
  type ActionId,
  type ActionSpec,
  type ActionSurface,
} from "./action-registry";

/**
 * One way in, in the three pieces every clause is built from: an imperative
 * VERB, the TOKEN the user looks for on screen, and the TAIL that says where.
 *
 * Splitting the clause this way is what lets the plain-text form
 * (`creationSentence`, which the guard and the unit suite read) and the painted
 * form (`CreationHint`) be the SAME sentence rather than two that agree today —
 * the renderer decides only how the token is painted, never what it says.
 */
export interface CreationRoute {
  /** The registry surface this route came from, or the panel's own "+". */
  surface: ActionSurface | "panel-add";
  /** Lowercase imperative — capitalised by the sentence builder when first. */
  verb: string;
  /** What the user looks for: `\ex`, `Example`, `+`. */
  token: string;
  /** How the token is painted: a LaTeX-ish literal vs. an on-screen control. */
  tokenStyle: "code" | "control";
  /** The rest of the clause, e.g. " in the editor". Leading space included. */
  tail: string;
}

/**
 * Preference order — shortest path first. Slash beats the menus because it is
 * the one route a user can follow without hunting for a control; `typed` and
 * `keyboard` come last because for every row that has them they restate a
 * command the slash clause already named.
 */
const SURFACE_PREFERENCE: readonly ActionSurface[] = [
  "slash",
  "lightning",
  "grab",
  "typed",
  "keyboard",
];

/** A sentence that lists more than two ways in is a list, not an instruction. */
const MAX_ROUTES = 2;

/**
 * The two MENU surfaces are one route wearing two triggers: the margin ⚡
 * button (`SelectionActionsMenu`) and a block's grab bar (`DragHandleMenu`)
 * open the SAME `ActionsMenuPanel` body, off the same `cardActionRows()` view
 * of this registry. Naming both would be naming one way in twice ("pick Todo
 * from the ⚡ menu, or pick Todo from a block's grab bar"), so the first one a
 * row declares wins and the other is skipped.
 */
const MENU_SURFACES: readonly ActionSurface[] = ["lightning", "grab"];

/**
 * The clause for one surface, or null when the row declares the surface but not
 * the scalar the clause needs to NAME it (a `slash` row with no `slashName`
 * cannot be described, and `assertActionCoverage` already refuses that shape).
 *
 * Total over `ActionSurface` by construction: a sixth surface fails to compile
 * here rather than silently dropping out of every empty state in the app.
 */
function routeFor(spec: ActionSpec, surface: ActionSurface): CreationRoute | null {
  switch (surface) {
    case "slash":
      return spec.slashName
        ? {
            surface,
            verb: "type",
            token: `\\${spec.slashName}`,
            tokenStyle: "code",
            tail: " in the editor",
          }
        : null;
    case "lightning":
      return {
        surface,
        verb: "pick",
        token: spec.label,
        tokenStyle: "control",
        tail: " from the ⚡ menu",
      };
    case "grab":
      return {
        surface,
        verb: "pick",
        token: spec.label,
        tokenStyle: "control",
        tail: " from a block’s grab bar",
      };
    case "typed":
      // The input-rule trigger is a RegExp, which no sentence can quote. What a
      // user types to fire it is the slash name in LaTeX form, so a row with no
      // slash name has no describable typed route either.
      return spec.slashName
        ? {
            surface,
            verb: "type",
            token: `\\${spec.slashName}{…}`,
            tokenStyle: "code",
            tail: " in the document",
          }
        : null;
    case "keyboard":
      return spec.keybinding
        ? {
            surface,
            verb: "press",
            token: spec.keybinding,
            tokenStyle: "control",
            tail: "",
          }
        : null;
  }
}

/**
 * The ways in to `id` that the registry declares, best first, capped at two.
 *
 * Reads the row's `surfaces` flags — the same declaration the live menus and
 * the slash popup are built from — so a surface a row drops disappears from the
 * copy in the same commit it disappears from the app.
 */
export function creationRoutesFor(id: ActionId, limit = MAX_ROUTES): CreationRoute[] {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  const out: CreationRoute[] = [];
  let menuTaken = false;
  for (const surface of SURFACE_PREFERENCE) {
    if (out.length >= limit) break;
    if (!spec.surfaces[surface]) continue;
    const isMenu = MENU_SURFACES.includes(surface);
    if (isMenu && menuTaken) continue;
    const route = routeFor(spec, surface);
    if (!route) continue;
    if (isMenu) menuTaken = true;
    out.push(route);
  }
  return out;
}

/**
 * The panel's OWN "+" — the one route the registry does not own, because it is
 * not an editor surface at all.
 *
 * It is never asserted by a panel's copy. `CardListPanel` provides it from the
 * button it is actually about to render (`PanelAddProvider`), so an empty state
 * structurally cannot promise a "+" that no host wired — which is the same
 * defect as the `(1)` glyph, one control over. The Examples panel declared an
 * `onAdd` prop no host ever passed for exactly as long as its sentence named a
 * missing glyph.
 */
export function panelAddRoute(): CreationRoute {
  return {
    surface: "panel-add",
    verb: "click",
    token: "+",
    tokenStyle: "control",
    tail: " above",
  };
}

/**
 * The routes a panel's empty state should offer for `id`: its own "+" first
 * (nearest to the eye that is reading the empty body), then the registry's.
 */
export function creationRoutes(id: ActionId, hasPanelAdd: boolean): CreationRoute[] {
  // Two clauses, whatever the mix: a "+" the user is looking straight at plus
  // the one best route through the editor, or — with no "+" — the best two.
  return hasPanelAdd
    ? [panelAddRoute(), ...creationRoutesFor(id, MAX_ROUTES - 1)]
    : creationRoutesFor(id, MAX_ROUTES);
}

/**
 * The sentence, as plain text. `CreationHint` paints exactly this; the unit
 * suite and the empty-state guard read exactly this. Empty routes ⇒ empty
 * string (a kind with no reachable surface teaches nothing, and inventing a
 * clause for it would be the original defect again).
 */
export function creationSentence(routes: readonly CreationRoute[]): string {
  if (routes.length === 0) return "";
  const clauses = routes.map(
    (r, i) => `${i === 0 ? capitalise(r.verb) : r.verb} ${r.token}${r.tail}`,
  );
  const last = clauses.pop() as string;
  return clauses.length === 0 ? `${last}.` : `${clauses.join(", ")}, or ${last}.`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
