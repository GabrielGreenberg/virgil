"use client";

import type { TodoItem } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { TodoRow } from "./TodoRow";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";

interface BuildArgs {
  todoItems: TodoItem[];
  selectedTodoId: string | null;
  setSelectedTodoId: (id: string | null) => void;
  jumpToCard: (card: TodoItem, sourceEl?: HTMLElement | null) => void;
  resolveCardRows: CardAnchorResolver;
  toggleTodo: (id: string) => void;
  updateTodo: (id: string, text: string) => void;
  updateTodoNotes: (id: string, notes: string) => void;
  setTodoAiRequest: (id: string, value: boolean) => void;
  deleteTodo: (id: string) => void;
}

export function buildTodoOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const item of a.todoItems) {
    const isSelected = a.selectedTodoId === item.id;
    const baseId = popKey("todo", item.id);

    // ONE authority for "where is this card anchored?" — the same rows the
    // margin marker builder draws from (task 369). An unlinked todo is
    // deliberately FREE by this panel's own rule.
    for (const row of buildOmniAnchorRows(item, baseId, a.resolveCardRows, {
      unanchored: true,
    })) {
      // The row's own gate (task 655) — never `row.anchorUuid != null`, which
      // is true of a card whose anchor is DEAD. `isAnchored` is the same
      // question by another name (TodoRow reads it only alongside `onJump`),
      // so it is derived from the gate's answer rather than asked twice.
      const onJump = row.withJump((sourceEl?: HTMLElement | null) =>
        a.jumpToCard(item, sourceEl),
      );
      items.push({
        id: row.omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: (
          <TodoRow
            key={row.omniId}
            item={item}
            selected={isSelected}
            onToggle={a.toggleTodo}
            onUpdate={a.updateTodo}
            onUpdateNotes={a.updateTodoNotes}
            onSetAiRequest={a.setTodoAiRequest}
            onDelete={a.deleteTodo}
            onSelect={a.setSelectedTodoId}
            isAnchored={onJump != null}
            onJump={onJump}
            extraDataAttrs={{ "data-omni-entry": row.omniId }}
          />
        ),
      });
    }
  }

  return items;
}
