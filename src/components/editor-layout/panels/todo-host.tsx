"use client";

import TodoPanel from "@/panels/Todo";
import type { TodoItem } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { getLinkedParagraphIds } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";

export interface TodoHostProps {
  side: Side;
  panelSide: Side | null;
  todoItems: TodoItem[];
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  updateTodo: (id: string, text: string) => void;
  updateTodoNotes: (id: string, notes: string) => void;
  deleteTodo: (id: string) => void;
  archiveTodos: () => void;
}

export function TodoHost(p: TodoHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedTodoId, setSelectedTodoId } = useSelectionsContext();
  const { aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  return (
    <TodoPanel
      items={p.todoItems}
      onAdd={p.addTodo}
      onToggle={p.toggleTodo}
      onUpdate={p.updateTodo}
      onUpdateNotes={p.updateTodoNotes}
      onDelete={p.deleteTodo}
      onArchiveDone={p.archiveTodos}
      selectedTodoId={selectedTodoId}
      onSelectTodo={setSelectedTodoId}
      onScrollToMarker={(id) => {
        const item = p.todoItems.find((t) => t.id === id);
        const pid = item ? getLinkedParagraphIds(item)[0] : undefined;
        if (pid) editorRef.current?.scrollToParagraphId(pid);
      }}
      aiRequests={aiRequests}
      onAddAiRequest={() => addAiRequest("todo")}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      editor={editorInstance}
      panelSide={p.panelSide ?? p.side}
      viewMode={getPanelViewMode("todo")}
      onViewModeChange={(m) => setPanelViewMode("todo", m)}
    />
  );
}
