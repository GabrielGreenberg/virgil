"use client";

import { useEffect, useRef } from "react";
import TodoPanel from "@/panels/Todo";
import type { TodoItem } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
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
  archiveTodos: () => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function TodoHost(p: TodoHostProps) {
  const { editorRef } = useEditorRefContext();
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
      onArchiveDone={p.archiveTodos}
      selectedTodoId={selectedTodoId}
      onSelectTodo={setSelectedTodoId}
      onJumpToCard={(item, sourceEl) => editorRef.current?.jumpToCard(item, sourceEl)}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
