/**
 * Post-load migrations.
 *
 * Once the editor is mounted and the doc is parsed, run any migrations
 * that need to walk the doc to make decisions. These can't live in the
 * boot-time read-side migrators (`useViewPrefs.loadPrefs`,
 * `migrateCardLinks`) because those run before the editor has a doc to
 * walk.
 *
 * Today: `list:<uuid>` and the in-editor `example:<uuid>` legacy
 * popout keys (Phase D10 deferred them — they need a doc walk to
 * disambiguate bullet vs ordered, and to tell the in-editor
 * exampleBlock popout from the Examples panel-card prefix). After the
 * sweep, the `case "list"` dispatcher branch in `floating-cards.tsx`
 * can be deleted.
 */

import type { Editor } from "@tiptap/react";
import {
  isTextObjectKind,
  textObjectPopoutKey,
} from "./text-object-registry";
import type { TextObjectKind } from "./types";

/**
 * Walk the editor doc to resolve a uuid → TextObject kind. Returns
 * null if no UUID-bearing TextObject node matches. `linkedRange` is
 * skipped — it's mark-backed, not node-backed.
 */
function resolveUuidToKind(
  editor: Editor,
  uuid: string,
): TextObjectKind | null {
  let result: TextObjectKind | null = null;
  editor.state.doc.descendants((node) => {
    if (result) return false;
    if (
      isTextObjectKind(node.type.name) &&
      node.type.name !== "linkedRange" &&
      (node.attrs?.uuid as string | null) === uuid
    ) {
      result = node.type.name as TextObjectKind;
      return false;
    }
    return true;
  });
  return result;
}

/**
 * Migrate legacy `list:<uuid>` / `example:<uuid>` popout keys to the
 * unified `textobject:<kind>:<id>` shape, walking the doc to infer the
 * actual kind. Returns the new array if anything changed (allowing
 * `prev !== next` change detection), else the original reference.
 *
 * Disambiguation:
 *  - `list:<uuid>` — kind is `bulletList` or `orderedList`. Missing
 *    node → orphan, dropped with `console.warn`.
 *  - `example:<uuid>` — if a matching `exampleBlock` node exists, it's
 *    the in-editor popout; migrate. Otherwise it's the Examples
 *    *panel-card* prefix (a sibling of `note:`, `todo:`, `bib:`);
 *    pass through unchanged.
 */
export function migrateLegacyPopoutKeys(
  editor: Editor,
  poppedOutCards: readonly string[],
): readonly string[] {
  const next: string[] = [];
  let changed = false;
  const orphans: string[] = [];
  for (const key of poppedOutCards) {
    if (key.startsWith("list:")) {
      const uuid = key.slice("list:".length);
      const kind = resolveUuidToKind(editor, uuid);
      if (kind === "bulletList" || kind === "orderedList") {
        next.push(textObjectPopoutKey({ kind, id: uuid }));
        changed = true;
        continue;
      }
      orphans.push(key);
      changed = true;
      continue;
    }
    if (key.startsWith("example:")) {
      const uuid = key.slice("example:".length);
      const kind = resolveUuidToKind(editor, uuid);
      if (kind === "exampleBlock") {
        next.push(textObjectPopoutKey({ kind: "exampleBlock", id: uuid }));
        changed = true;
        continue;
      }
      // Not an in-editor exampleBlock — pass through as the Examples
      // panel-card prefix.
      next.push(key);
      continue;
    }
    next.push(key);
  }
  if (orphans.length > 0) {
    console.warn(
      `[postLoadMigrations] dropped ${orphans.length} orphan popout key(s) with no matching doc node: ${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? ", …" : ""}`,
    );
  }
  return changed ? next : poppedOutCards;
}
