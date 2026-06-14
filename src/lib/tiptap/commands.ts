import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { generateShortId } from "@/lib/uuid";
// CHIP 4a-ii: the PM→React bridge the slash `\cite` uses to register the
// citation CARD (the atom is still inserted synchronously below). Replaces the
// `virgil-citation-create` CustomEvent — one typed entrypoint into the
// registry's `citation.run`.
import { getEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";

export interface VirgilCommand {
  /** The command name without backslash (e.g. "section") */
  name: string;
  /** Action to run. The typed text has already been deleted from the doc. */
  action: (view: EditorView, cmdText: string) => void;
}

/**
 * Title-field command factory. Used by `\title`, `\author`, and `\date`.
 *
 * Behavior:
 *   - If a titleField of the requested kind already exists in the doc,
 *     place the cursor at the end of its content and scroll into view.
 *     No node mutation, no duplicate.
 *   - Otherwise, insert a fresh titleField at the canonical position
 *     (title=0, author=1, date=2; always BEFORE any non-titleField,
 *     including `\maketitle`, since `\maketitle` reads `\title` at
 *     expansion time and `\title` after `\maketitle` compiles to an
 *     empty title block).
 *
 * For `\date`, the default is `\today` — matches the article templates
 * and the parser's pretty-print behavior, so the lozenge shows today's
 * date the moment it appears.
 */
function titleFieldCommand(field: "title" | "author" | "date") {
  return (view: EditorView) => {
    const { state } = view;
    const titleFieldType = state.schema.nodes.titleField;
    if (!titleFieldType) return;

    // 1. Find an existing titleField of this kind. We only look at
    //    top-level doc children — that's where the parser puts them and
    //    where `hoistTitleFieldsToTop` keeps them.
    let foundPos: number | null = null;
    let foundNode: PMNode | null = null;
    let offset = 0;
    state.doc.forEach((child) => {
      if (
        foundPos === null &&
        child.type.name === "titleField" &&
        child.attrs?.field === field
      ) {
        foundPos = offset;
        foundNode = child;
      }
      offset += child.nodeSize;
    });
    if (foundPos !== null && foundNode !== null) {
      // Cursor at end of the field's content. nodeSize = 2 (open+close)
      // + content size; +1 is the opening token, then we add the
      // content size to land just before the closing token.
      const node: PMNode = foundNode;
      const endOfContent = foundPos + 1 + node.content.size;
      const tr = state.tr.setSelection(
        TextSelection.create(state.doc, endOfContent),
      );
      view.dispatch(tr.scrollIntoView());
      return;
    }

    // 2. Insert at canonical position. Order: title=0, author=1, date=2.
    //    Anything else (including `maketitleMarker`) sorts after all
    //    titles, so the new node lands before the first non-title and
    //    before any titleField with a larger field order.
    const order: Record<string, number> = { title: 0, author: 1, date: 2 };
    const insertOrder = order[field];
    let insertPos = 0;
    let walkOffset = 0;
    state.doc.forEach((child) => {
      const childOrder =
        child.type.name === "titleField"
          ? order[child.attrs?.field as string] ?? 99
          : 99;
      if (childOrder < insertOrder) {
        walkOffset += child.nodeSize;
        insertPos = walkOffset;
      }
    });

    // Build the new node. Pre-stamp a UUID so the in-memory id matches
    // what will land on disk (matches the `cite` / `tex` pattern).
    const existingUuids = new Set<string>();
    state.doc.descendants((n) => {
      if (n.attrs?.uuid) existingUuids.add(n.attrs.uuid as string);
    });
    const attrs = {
      field,
      rawPrefix: null,
      isToday: field === "date",
      uuid: generateShortId(existingUuids),
    };
    let nodeContent = null;
    if (field === "date") {
      // Mirror the parser's pretty-printed `\today` rendering so the
      // lozenge shows the date immediately. The `isToday: true` flag
      // tells the serializer to emit `\date{\today}` rather than the
      // expanded string.
      const now = new Date();
      const pretty = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      nodeContent = state.schema.text(pretty);
    }
    const node = titleFieldType.create(attrs, nodeContent);

    const tr = state.tr.insert(insertPos, node);
    // Cursor at end of inserted content (or just inside, for empty).
    const cursorPos = insertPos + 1 + node.content.size;
    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    view.dispatch(tr.scrollIntoView());
  };
}

export const VIRGIL_COMMANDS: VirgilCommand[] = [
  { name: "title", action: titleFieldCommand("title") },
  { name: "author", action: titleFieldCommand("author") },
  { name: "date", action: titleFieldCommand("date") },
  {
    name: "chapter",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 1, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "section",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 2, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 3, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsubsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 4, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "ref",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-ref-create"));
    },
  },
  {
    name: "ex",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-ex-create"));
    },
  },
  {
    name: "cite",
    action: (view) => {
      const { state } = view;
      const citationNodeType = state.schema.nodes.citation;
      if (!citationNodeType) return;
      const existing = new Set<string>();
      state.doc.descendants((node) => {
        if (node.type.name === "citation" && node.attrs.citationId) {
          existing.add(node.attrs.citationId as string);
        }
        return true;
      });
      const citationId = generateShortId(existing);
      const command = "\\cite{}";
      // Insert the atom SYNCHRONOUSLY — it must land even if React is
      // unmounted (durability decision). Only the CARD registration routes
      // through the bridge.
      const tr = state.tr.replaceSelectionWith(
        citationNodeType.create({ citationId, command, displayText: "" }),
      );
      view.dispatch(tr);
      // Register the panel card via the registry's `citation.run` (surface
      // "slash"). The bridge synthesizes the CursorRef + supplies cardCreation
      // + the soft-route wiring; `run` calls `createCitation({ ...unanchored:
      // false })` and soft-routes into omni (backlog #2 — never force-opens
      // the Citations panel). Replaces the retired `virgil-citation-create`
      // event + its two listeners (command-input.ts + citations-host.tsx).
      getEditorActionsHandle()?.runAction("citation", {
        surface: "slash",
        payload: { citationId, command },
      });
    },
  },
  {
    name: "footnote",
    action: (view) => {
      const { state } = view;
      const footnoteNodeType = state.schema.nodes.footnote;
      if (!footnoteNodeType) return;
      const existing = new Set<string>();
      state.doc.descendants((node) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId) {
          existing.add(node.attrs.footnoteId as string);
        }
        return true;
      });
      const footnoteId = generateShortId(existing);
      // Empty body — the panel card hosts the editable footnote text.
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      // Insert the atom SYNCHRONOUSLY — it must land even if React is
      // unmounted (durability decision, matching `\cite`). Only the CARD
      // registration routes through the bridge.
      const tr = state.tr.replaceSelectionWith(
        footnoteNodeType.create({ footnoteId, content, number: 0 }),
      );
      view.dispatch(tr);
      // Register the panel card via the registry's `footnote.run` (surface
      // "slash"). The bridge synthesizes the CursorRef + supplies cardCreation
      // + the soft-route wiring; `footnote.run` ADOPTS the just-inserted atom
      // via `createFootnote({ existingFootnoteId })` (pristine + pinned, NO
      // re-insert) and soft-routes into omni (backlog #2 — never force-opens
      // the Footnotes panel). Replaces the retired `virgil-footnote-input`
      // event + its command-input.ts listener (and the dead
      // `virgil-footnote-created` it used to broadcast).
      getEditorActionsHandle()?.runAction("footnote", {
        surface: "slash",
        payload: { footnoteId },
      });
    },
  },
  {
    name: "tex",
    action: (view) => {
      const { state } = view;
      const texBlockType = state.schema.nodes.texBlock;
      if (!texBlockType) return;
      const existing = new Set<string>();
      state.doc.descendants((node) => {
        if (node.type.name === "texBlock" && node.attrs.uuid) {
          existing.add(node.attrs.uuid as string);
        }
        return true;
      });
      const uuid = generateShortId(existing);
      const tr = state.tr.replaceSelectionWith(
        texBlockType.create({ uuid, code: "" }),
      );
      view.dispatch(tr);
    },
  },
];

/** Fast lookup by command name (without backslash). */
export const COMMAND_MAP = new Map(VIRGIL_COMMANDS.map((c) => [c.name, c]));

/** Names of all native Virgil commands (without the leading backslash). */
export const VIRGIL_COMMAND_NAMES: readonly string[] = VIRGIL_COMMANDS.map((c) => c.name);
