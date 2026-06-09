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
import { isTextObjectKind } from "./text-object-registry";
import { buildFloatKey, migrateLegacyKeyToFloat } from "@/floats/float-key";
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
 * Doc-aware popout-key migration (the post-load leg of the AF flip). Resolves
 * ONE legacy `list:<uuid>` / `example:<uuid>` key to the unified
 * `float:<domain>:<kind>:<id>` grammar by walking the doc to infer the kind.
 * Returns the new key, or `null` to DROP it (an orphan). Applied in lockstep to
 * both `poppedOutCards` and `cardFloatPositions` via `migratePoppedOutCards`.
 *
 * Disambiguation:
 *  - `list:<uuid>` — `bulletList` or `orderedList` → `float:textobject:…`;
 *    missing node → orphan, dropped (`null`) with a warn.
 *  - `example:<uuid>` — a matching `exampleBlock` node → the in-editor block
 *    (`float:textobject:exampleBlock:…`); otherwise the Examples *panel card*
 *    (`float:card:example:…`).
 *  - anything else — already `float:` (read-time leg) or a straggler legacy key
 *    → normalized defensively (idempotent).
 */
export function migrateDocAwarePopoutKey(
  editor: Editor,
  key: string,
): string | null {
  if (key.startsWith("list:")) {
    const uuid = key.slice("list:".length);
    const kind = resolveUuidToKind(editor, uuid);
    if (kind === "bulletList" || kind === "orderedList") {
      return buildFloatKey({ domain: "textobject", kind, id: uuid });
    }
    console.warn(
      `[postLoadMigrations] dropped orphan list popout key with no matching doc node: ${key}`,
    );
    return null;
  }
  if (key.startsWith("example:")) {
    const uuid = key.slice("example:".length);
    const kind = resolveUuidToKind(editor, uuid);
    if (kind === "exampleBlock") {
      return buildFloatKey({ domain: "textobject", kind: "exampleBlock", id: uuid });
    }
    // Not an in-editor exampleBlock — the Examples panel card.
    return buildFloatKey({ domain: "card", kind: "example", id: uuid });
  }
  return migrateLegacyKeyToFloat(key);
}
