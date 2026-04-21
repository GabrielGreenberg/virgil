"use client";

import { useCallback, useEffect } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type {
  CommentsState,
  GeneralRevision,
  RevisionTurn,
  RevisionUser,
  RevisionsState,
  TextRevision,
} from "@/lib/types";
import {
  clearTextAnchorLink,
  derivedLinksForCard,
  getTextAnchor,
  setTextAnchorLink,
} from "@/links/links";
import { usePersistentState } from "./usePersistentState";

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

/** Upgrade a legacy TextRevision record (with anchorId/anchorPos) to links[]. */
function migrateTextRevision(raw: TextRevision & { anchorPos?: number; anchorId?: string }): TextRevision {
  if (Array.isArray(raw.links) && raw.links.length > 0) {
    return {
      id: raw.id,
      authorId: raw.authorId,
      createdAt: raw.createdAt,
      resolved: raw.resolved,
      selectedText: raw.selectedText,
      text: raw.text,
      turns: raw.turns,
      links: raw.links,
    };
  }
  return {
    id: raw.id,
    authorId: raw.authorId,
    createdAt: raw.createdAt,
    resolved: raw.resolved,
    selectedText: raw.selectedText,
    text: raw.text,
    turns: raw.turns,
    links: derivedLinksForCard("comment", {
      id: raw.id,
      anchorId: raw.anchorId,
      anchorText: raw.selectedText,
    }),
  };
}

function migrateRevisions(raw: unknown): RevisionsState {
  const s = raw as Partial<RevisionsState>;
  if (!s || (!s.users && !s.generalRevisions && !s.textRevisions)) {
    return EMPTY_STATE;
  }
  return {
    users: s.users?.length ? s.users : [...DEFAULT_USERS],
    generalRevisions: s.generalRevisions ?? [],
    textRevisions: (s.textRevisions ?? []).map((r) =>
      migrateTextRevision(r as TextRevision & { anchorPos?: number; anchorId?: string }),
    ),
    activeUserId: s.activeUserId ?? "me",
  };
}

/** One-shot fallback: if revisions.json didn't exist, try comments.json. */
function migrateFromComments(comments: CommentsState | null): RevisionsState | null {
  if (!comments?.comments?.length) return null;
  const textRevisions: TextRevision[] = comments.comments.map((c) => ({
    id: c.id,
    authorId: "claude",
    createdAt: c.createdAt,
    resolved: c.resolved,
    selectedText: c.selectedText,
    text: c.comment,
    turns: [
      {
        id: generateEntityId(),
        authorId: "claude",
        createdAt: c.createdAt,
        text: c.comment,
      },
    ],
    links: [],
  }));
  return {
    users: [...DEFAULT_USERS],
    generalRevisions: [],
    textRevisions,
    activeUserId: "me",
  };
}

export function useRevisions(docId: string | null) {
  const { state, setState, update, persist } = usePersistentState<RevisionsState>(
    docId,
    "revisions.json",
    EMPTY_STATE,
    { migrate: migrateRevisions, errorLabel: "revisions" },
  );

  // One-shot fallback: if revisions.json was empty but comments.json has
  // data, migrate and persist so this path only runs once per document.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    (async () => {
      try {
        const existing = await readSidecar<RevisionsState | null>(docId, "revisions.json", null);
        if (cancelled || existing) return;
        const legacy = await readSidecar<CommentsState | null>(docId, "comments.json", null);
        const migrated = migrateFromComments(legacy);
        if (cancelled || !migrated) return;
        setState(migrated);
        await writeSidecar(docId, "revisions.json", migrated);
      } catch (err) {
        console.error("Failed to migrate comments:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [docId, setState]);

  /** Re-read the sidecar (used by window-focus refresh). */
  const reload = useCallback(() => {
    if (!docId) return;
    readSidecar<RevisionsState | null>(docId, "revisions.json", null)
      .then((data) => { if (data) setState(migrateRevisions(data)); })
      .catch(() => {});
  }, [docId, setState]);

  // Refresh on window focus so Claude-authored turns show up after the
  // agent writes them directly to revisions.json.
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const setActiveUser = useCallback(
    (userId: string) => {
      update((prev) => ({ ...prev, activeUserId: userId }));
    },
    [update],
  );

  const addUser = useCallback(
    (name: string, color: string): RevisionUser => {
      const u: RevisionUser = { id: generateEntityId(), name: name.trim(), color };
      update((prev) => ({ ...prev, users: [...prev.users, u], activeUserId: u.id }));
      return u;
    },
    [update],
  );

  const addGeneralRevision = useCallback(
    (text: string, authorIdOverride?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      let created: GeneralRevision | null = null;
      update((prev) => {
        const authorId = authorIdOverride ?? prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: generateEntityId(), authorId, createdAt: now, text: trimmed };
        const rev: GeneralRevision = {
          id: generateEntityId(),
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
    (selectedText: string, anchorId: string | null, text: string): TextRevision | null => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      let created: TextRevision | null = null;
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: generateEntityId(), authorId, createdAt: now, text: trimmed };
        let rev: TextRevision = {
          id: generateEntityId(),
          authorId,
          createdAt: now,
          resolved: false,
          selectedText,
          text: trimmed,
          turns: [turn],
          links: [],
        };
        if (anchorId) {
          rev = setTextAnchorLink(rev, "comment", anchorId, selectedText);
        }
        created = rev;
        return { ...prev, textRevisions: [...prev.textRevisions, rev] };
      });
      return created;
    },
    [update],
  );

  const setRevisionAnchor = useCallback(
    (id: string, anchorId: string | null) => {
      update((prev) => ({
        ...prev,
        textRevisions: prev.textRevisions.map((r) => {
          if (r.id !== id) return r;
          if (anchorId == null) return clearTextAnchorLink(r, "comment");
          return setTextAnchorLink(r, "comment", anchorId, r.selectedText);
        }),
      }));
    },
    [update],
  );

  // Orphan listener — clear the dead anchor id on the matching revision.
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (kind !== "revision" || !anchorId) return;
      update((prev) => ({
        ...prev,
        textRevisions: prev.textRevisions.map((r) =>
          getTextAnchor(r)?.anchorId === anchorId
            ? clearTextAnchorLink(r, "comment")
            : r,
        ),
      }));
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [update]);

  const addTurn = useCallback(
    (kind: RevisionKind, revisionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: generateEntityId(), authorId, createdAt: now, text: trimmed };
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

  // `persist` is exposed for callers that need imperative writes — currently
  // unused, but matches the shape of the other migrated hooks.
  void persist;

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
    setRevisionAnchor,
    addTurn,
    resolveRevision,
    reopenRevision,
    deleteRevision,
    refresh: reload,
  };
}
