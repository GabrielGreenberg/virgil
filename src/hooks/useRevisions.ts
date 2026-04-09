"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import { readSidecar, writeSidecar } from "@/lib/storage-fsa";
import type {
  CommentsState,
  GeneralRevision,
  RevisionTurn,
  RevisionUser,
  RevisionsState,
  TextRevision,
} from "@/lib/types";

const DEFAULT_USERS: RevisionUser[] = [
  { id: "claude", name: "Claude", color: "#a855f7", isDefault: true },
  { id: "me", name: "Me", color: "#3b82f6", isDefault: true },
];

const EMPTY_STATE: RevisionsState = {
  users: [...DEFAULT_USERS],
  generalRevisions: [],
  textRevisions: [],
  activeUserId: "me",
};

export type RevisionKind = "general" | "text";

/**
 * One-shot migration from comments.json (only used when revisions.json
 * doesn't exist yet — the original comments.json is left untouched as a
 * backup).
 */
function migrateFromComments(comments: CommentsState | null): RevisionsState | null {
  if (!comments?.comments?.length) return null;
  const textRevisions: TextRevision[] = comments.comments.map((c) => ({
    id: c.id,
    authorId: "claude",
    createdAt: c.createdAt,
    resolved: c.resolved,
    selectedText: c.selectedText,
    anchorPos: 0,
    text: c.comment,
    turns: [
      {
        id: uuid(),
        authorId: "claude",
        createdAt: c.createdAt,
        text: c.comment,
      },
    ],
  }));
  return {
    users: [...DEFAULT_USERS],
    generalRevisions: [],
    textRevisions,
    activeUserId: "me",
  };
}

export function useRevisions(docId: string | null) {
  const [state, setState] = useState<RevisionsState>(EMPTY_STATE);
  const currentDocIdRef = useRef(docId);

  const load = useCallback((id: string | null) => {
    if (!id) {
      setState(EMPTY_STATE);
      return;
    }
    (async () => {
      try {
        // Read with a null sentinel so we can distinguish "missing" from
        // "found and explicitly empty" — the migration only runs in the
        // missing case.
        const existing = await readSidecar<RevisionsState | null>(
          id,
          "revisions.json",
          null,
        );
        if (currentDocIdRef.current !== id) return;
        if (existing) {
          setState({
            users: existing.users?.length ? existing.users : [...DEFAULT_USERS],
            generalRevisions: existing.generalRevisions ?? [],
            textRevisions: existing.textRevisions ?? [],
            activeUserId: existing.activeUserId ?? "me",
          });
          return;
        }
        // No revisions.json — try one-shot migration from comments.json.
        const legacy = await readSidecar<CommentsState | null>(
          id,
          "comments.json",
          null,
        );
        const migrated = migrateFromComments(legacy) ?? EMPTY_STATE;
        if (currentDocIdRef.current !== id) return;
        setState(migrated);
        // Persist so subsequent loads skip the migration.
        await writeSidecar(id, "revisions.json", migrated);
      } catch (err) {
        console.error("Failed to load revisions:", err);
      }
    })();
  }, []);

  useEffect(() => {
    currentDocIdRef.current = docId;
    load(docId);
  }, [docId, load]);

  // Refresh on window focus so Claude-authored turns show up after the
  // agent writes them directly to revisions.json.
  useEffect(() => {
    const onFocus = () => load(currentDocIdRef.current);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const persist = useCallback(async (newState: RevisionsState) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    try {
      await writeSidecar(id, "revisions.json", newState);
    } catch (err) {
      console.error("Failed to save revisions:", err);
    }
  }, []);

  const update = useCallback(
    (mut: (prev: RevisionsState) => RevisionsState) => {
      setState((prev) => {
        const next = mut(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setActiveUser = useCallback(
    (userId: string) => {
      update((prev) => ({ ...prev, activeUserId: userId }));
    },
    [update],
  );

  const addUser = useCallback(
    (name: string, color: string): RevisionUser => {
      const u: RevisionUser = { id: uuid(), name: name.trim(), color };
      update((prev) => ({ ...prev, users: [...prev.users, u], activeUserId: u.id }));
      return u;
    },
    [update],
  );

  const addGeneralRevision = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      let created: GeneralRevision | null = null;
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: uuid(), authorId, createdAt: now, text: trimmed };
        const rev: GeneralRevision = {
          id: uuid(),
          authorId,
          createdAt: now,
          text: trimmed,
          turns: [turn],
          resolved: false,
        };
        created = rev;
        return { ...prev, generalRevisions: [...prev.generalRevisions, rev] };
      });
      return created;
    },
    [update],
  );

  const addTextRevision = useCallback(
    (selectedText: string, anchorPos: number, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      let created: TextRevision | null = null;
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: uuid(), authorId, createdAt: now, text: trimmed };
        const rev: TextRevision = {
          id: uuid(),
          authorId,
          createdAt: now,
          resolved: false,
          selectedText,
          anchorPos,
          text: trimmed,
          turns: [turn],
        };
        created = rev;
        return { ...prev, textRevisions: [...prev.textRevisions, rev] };
      });
      return created;
    },
    [update],
  );

  const addTurn = useCallback(
    (kind: RevisionKind, revisionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: uuid(), authorId, createdAt: now, text: trimmed };
        if (kind === "general") {
          return {
            ...prev,
            generalRevisions: prev.generalRevisions.map((r) =>
              r.id === revisionId ? { ...r, turns: [...r.turns, turn] } : r,
            ),
          };
        }
        return {
          ...prev,
          textRevisions: prev.textRevisions.map((r) =>
            r.id === revisionId ? { ...r, turns: [...r.turns, turn] } : r,
          ),
        };
      });
    },
    [update],
  );

  const resolveRevision = useCallback(
    (kind: RevisionKind, revisionId: string) => {
      update((prev) => {
        if (kind === "general") {
          return {
            ...prev,
            generalRevisions: prev.generalRevisions.map((r) =>
              r.id === revisionId ? { ...r, resolved: true } : r,
            ),
          };
        }
        return {
          ...prev,
          textRevisions: prev.textRevisions.map((r) =>
            r.id === revisionId ? { ...r, resolved: true } : r,
          ),
        };
      });
    },
    [update],
  );

  const reopenRevision = useCallback(
    (kind: RevisionKind, revisionId: string) => {
      update((prev) => {
        if (kind === "general") {
          return {
            ...prev,
            generalRevisions: prev.generalRevisions.map((r) =>
              r.id === revisionId ? { ...r, resolved: false } : r,
            ),
          };
        }
        return {
          ...prev,
          textRevisions: prev.textRevisions.map((r) =>
            r.id === revisionId ? { ...r, resolved: false } : r,
          ),
        };
      });
    },
    [update],
  );

  const deleteRevision = useCallback(
    (kind: RevisionKind, revisionId: string) => {
      update((prev) => {
        if (kind === "general") {
          return {
            ...prev,
            generalRevisions: prev.generalRevisions.filter((r) => r.id !== revisionId),
          };
        }
        return {
          ...prev,
          textRevisions: prev.textRevisions.filter((r) => r.id !== revisionId),
        };
      });
    },
    [update],
  );

  return {
    state,
    users: state.users,
    activeUserId: state.activeUserId ?? "me",
    generalRevisions: state.generalRevisions,
    textRevisions: state.textRevisions,
    setActiveUser,
    addUser,
    addGeneralRevision,
    addTextRevision,
    addTurn,
    resolveRevision,
    reopenRevision,
    deleteRevision,
    refresh: () => load(currentDocIdRef.current),
  };
}
