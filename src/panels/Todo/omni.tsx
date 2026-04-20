"use client";

import type { TodoItem } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { TodoRow } from "./TodoRow";

interface BuildArgs {
  todoItems: TodoItem[];
  selectedTodoId: string | null;
  setSelectedTodoId: (id: string | null) => void;
  scrollToParagraphId: (uuid: string) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  toggleTodo: (id: string) => void;
  updateTodo: (id: string, text: string) => void;
  updateTodoNotes: (id: string, notes: string) => void;
  deleteTodo: (id: string) => void;
}

export function buildTodoOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const item of a.todoItems) {
    const pids = item.paragraphIds;
    const isAnchored = pids.length > 0;
    const isSelected = a.selectedTodoId === item.id;
    const baseId = popKey("todo", item.id);

    if (!isAnchored) {
      items.push({
        id: baseId,
        pos: null,
        content: (
          <TodoRow
            key={baseId}
            item={item}
            selected={isSelected}
            onToggle={a.toggleTodo}
            onUpdate={a.updateTodo}
            onUpdateNotes={a.updateTodoNotes}
            onDelete={a.deleteTodo}
            onSelect={a.setSelectedTodoId}
            isAnchored={false}
            extraDataAttrs={{ "data-omni-entry": baseId }}
          />
        ),
      });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({
          id: omniId,
          pos,
          content: (
            <TodoRow
              key={omniId}
              item={item}
              selected={isSelected}
              onToggle={a.toggleTodo}
              onUpdate={a.updateTodo}
              onUpdateNotes={a.updateTodoNotes}
              onDelete={a.deleteTodo}
              onSelect={a.setSelectedTodoId}
              isAnchored={true}
              onJump={() => a.scrollToParagraphId(pid)}
              extraDataAttrs={{ "data-omni-entry": omniId }}
            />
          ),
        });
      }
    }
  }

  return items;
}
