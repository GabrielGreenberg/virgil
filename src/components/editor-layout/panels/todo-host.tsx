"use client";

import { useEffect, useRef } from "react";
import TodoPanel from "@/panels/Todo";
import type { TodoItem } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useDockedJumpGate } from "../contexts/card-anchor";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface TodoHostProps {
  side: Side;
  panelSide: Side | null;
  todoItems: TodoItem[];
  addTodo: () => TodoItem;
  toggleTodo: (id: string) => void;
  updateTodo: (id: string, text: string) => void;
  updateTodoNotes: (id: string, notes: string) => void;
  setTodoAiRequest: (id: string, value: boolean) => void;
  deleteTodo: (id: string) => void;
  /** DELETES the done todos (restricted to `ids` when supplied). Named for
   *  what it does: the old name said "archive", which is the reversible
   *  set-aside flag sitting right beside it on the same card (task 681). */
  clearDoneTodos: (ids?: readonly string[]) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function TodoHost(p: TodoHostProps) {
  const { editorRef } = useEditorRefContext();
  const jumpGate = useDockedJumpGate();
  const { selectedTodoId, setSelectedTodoId } = useSelectionsContext();
  const { createTodo } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("todo");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);
  return (
    <TodoPanel
      items={p.todoItems}
      onAdd={() => createTodo({})}
      onToggle={p.toggleTodo}
      onUpdate={p.updateTodo}
      onUpdateNotes={p.updateTodoNotes}
      onSetAiRequest={p.setTodoAiRequest}
      onDelete={p.deleteTodo}
      onClearDone={p.clearDoneTodos}
      selectedTodoId={selectedTodoId}
      onSelectTodo={setSelectedTodoId}
      jumpGate={jumpGate}
      onJumpToCard={(item, sourceEl) => editorRef.current?.jumpToCard(item, sourceEl)}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
