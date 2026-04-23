"use client";

import { useEffect, useRef } from "react";
import TodoPanel from "@/panels/Todo";
import type { TodoItem } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCardCreationContext } from "../contexts/card-creation";

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
  onDropSelection: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph: (paragraphId: string) => void;
}

export function TodoHost(p: TodoHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedTodoId, setSelectedTodoId } = useSelectionsContext();
  const { aiRequests, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { createTodo } = useCardCreationContext();
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
      onJumpToCard={(item) => editorRef.current?.jumpToCard(item)}
      aiRequests={aiRequests}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      onDropSelection={p.onDropSelection}
      onDropParagraph={p.onDropParagraph}
      editor={editorInstance}
      panelSide={p.panelSide ?? p.side}
      viewMode={getPanelViewMode("todo")}
      onViewModeChange={(m) => setPanelViewMode("todo", m)}
    />
  );
}
