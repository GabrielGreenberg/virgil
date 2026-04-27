"use client";

import { useCallback, useEffect } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type {
  Comment,
  CommentsState,
  RevisionTurn,
  RevisionUser,
  RevisionsState,
} from "@/lib/types";
import {
  clearTextAnchorLink,
  derivedLinksForCard,
  getTextAnchor,
  setTextAnchorLink,
} from "@/links/links";
import {
  emptyRichContent,
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { usePersistentState } from "./usePersistentState";

/** Build a JSONContent doc from whatever shape the record has today.
 *  Prefer existing `content`; fall back to the legacy `text` plaintext. */
function deriveContent(raw: { content?: unknown; text?: string }): JSONContent {
  if (raw.content) return normalizeRichContent(raw.content);
  if (typeof raw.text === "string" && raw.text.length > 0) {
    return normalizeRichContent(raw.text);
  }
  return emptyRichContent();
}

const DEFAULT_USERS: RevisionUser[] = [
  { id: "claude", name: "Claude", color: "#a855f7", isDefault: true },
  { id: "me", name: "Me", color: "#3b82f6", isDefault: true },
];

const EMPTY_STATE: RevisionsState = {
  users: [...DEFAULT_USERS],
  comments: [],
  activeUserId: "me",
};

function migrateComment(raw: Partial<Comment> & { anchorPos?: number; anchorId?: string }): Comment {
  const content = deriveContent(raw);
  const base: Comment = {
    id: raw.id!,
    authorId: raw.authorId ?? "me",
    createdAt: raw.createdAt ?? new Date().toISOString(),
    resolved: raw.resolved ?? false,
    text: raw.text ?? richJsonToPlainText(content),
    content,
    turns: raw.turns ?? [],
    links: Array.isArray(raw.links) ? raw.links : [],
  };
  if (typeof raw.selectedText === "string" && raw.selectedText.length > 0) {
    base.selectedText = raw.selectedText;
  }
  // Legacy TextRevision records carried anchorId/anchorPos at top-level
  // before the unified links[] migration. Fold them in now.
  if (base.links.length === 0 && (raw.anchorId || base.selectedText)) {
    base.links = derivedLinksForCard("comment", {
      id: base.id,
      anchorId: raw.anchorId,
      anchorText: base.selectedText,
    });
  }
  return base;
}

interface LegacyRevisionsState {
  users?: RevisionUser[];
  generalRevisions?: Array<Partial<Comment>>;
  textRevisions?: Array<Partial<Comment> & { anchorPos?: number; anchorId?: string }>;
  comments?: Array<Partial<Comment>>;
  activeUserId?: string;
}

function migrateRevisions(raw: unknown): RevisionsState {
  const s = raw as LegacyRevisionsState | null;
  if (!s || (!s.users && !s.comments && !s.generalRevisions && !s.textRevisions)) {
    return EMPTY_STATE;
  }
  const fromComments = (s.comments ?? []).map((r) => migrateComment(r));
  // Legacy general/text arrays — fold them into the unified comments list.
  const fromGeneral = (s.generalRevisions ?? []).map((r) => migrateComment(r));
  const fromText = (s.textRevisions ?? []).map((r) =>
    migrateComment(r as Partial<Comment> & { anchorPos?: number; anchorId?: string }),
  );
  const merged = [...fromComments, ...fromGeneral, ...fromText];
  // De-dup by id (in case the same id appeared in both legacy + new shape).
  const seen = new Set<string>();
  const comments: Comment[] = [];
  for (const c of merged) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    comments.push(c);
  }
  // Preserve creation order across the merged sources.
  comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return {
    users: s.users?.length ? s.users : [...DEFAULT_USERS],
    comments,
    activeUserId: s.activeUserId ?? "me",
  };
}

/** One-shot fallback: if revisions.json didn't exist, try comments.json. */
function migrateFromComments(comments: CommentsState | null): RevisionsState | null {
  if (!comments?.comments?.length) return null;
  const out: Comment[] = comments.comments.map((c) => ({
    id: c.id,
    authorId: "claude",
    createdAt: c.createdAt,
    resolved: c.resolved,
    selectedText: c.selectedText,
    text: c.comment,
    content: normalizeRichContent(c.comment),
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
    comments: out,
    activeUserId: "me",
  };
}

export function useRevisions(docId: string | null) {
  const { state, setState, update, persist, stateRef } = usePersistentState<RevisionsState>(
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

  const addComment = useCallback(
    (
      opts: {
        text?: string;
        selectedText?: string;
        anchorId?: string | null;
        authorId?: string;
      } = {},
    ): Comment => {
      const now = new Date().toISOString();
      const body = (opts.text ?? "").trim();
      const content = body ? normalizeRichContent(body) : emptyRichContent();
      const authorId =
        opts.authorId ?? stateRef.current.activeUserId ?? "me";
      const turns: RevisionTurn[] = body
        ? [{ id: generateEntityId(), authorId, createdAt: now, text: body }]
        : [];
      let comment: Comment = {
        id: generateEntityId(),
        authorId,
        createdAt: now,
        text: body,
        content,
        turns,
        resolved: false,
        links: [],
      };
      if (opts.selectedText) comment.selectedText = opts.selectedText;
      if (opts.anchorId) {
        comment = setTextAnchorLink(
          comment,
          "comment",
          opts.anchorId,
          opts.selectedText ?? "",
        );
      }
      update((prev) => ({ ...prev, comments: [...prev.comments, comment] }));
      return comment;
    },
    [update, stateRef],
  );

  const updateCommentContent = useCallback(
    (id: string, content: JSONContent) => {
      const normalized = normalizeRichContent(content);
      const text = richJsonToPlainText(normalized);
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === id ? { ...c, content: normalized, text } : c,
        ),
      }));
    },
    [update],
  );

  const setCommentAuthor = useCallback(
    (id: string, authorId: string) => {
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === id ? { ...c, authorId } : c,
        ),
      }));
    },
    [update],
  );

  const setCommentAnchor = useCallback(
    (id: string, anchorId: string | null) => {
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => {
          if (c.id !== id) return c;
          if (anchorId == null) return clearTextAnchorLink(c, "comment");
          return setTextAnchorLink(c, "comment", anchorId, c.selectedText ?? "");
        }),
      }));
    },
    [update],
  );

  // Orphan listener — clear the dead anchor id on the matching comment.
  useEffect(() => {
    const handler = (e: Event) => {
      const { anchorId, kind } = (e as CustomEvent).detail || {};
      if (kind !== "revision" || !anchorId) return;
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          getTextAnchor(c)?.anchorId === anchorId
            ? clearTextAnchorLink(c, "comment")
            : c,
        ),
      }));
    };
    window.addEventListener("virgil-anchor-orphaned", handler);
    return () => window.removeEventListener("virgil-anchor-orphaned", handler);
  }, [update]);

  const addTurn = useCallback(
    (id: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      update((prev) => {
        const authorId = prev.activeUserId ?? "me";
        const turn: RevisionTurn = { id: generateEntityId(), authorId, createdAt: now, text: trimmed };
        return {
          ...prev,
          comments: prev.comments.map((c) =>
            c.id === id ? { ...c, turns: [...c.turns, turn] } : c,
          ),
        };
      });
    },
    [update],
  );

  const resolveComment = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === id ? { ...c, resolved: true } : c,
        ),
      }));
    },
    [update],
  );

  const reopenComment = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        comments: prev.comments.map((c) =>
          c.id === id ? { ...c, resolved: false } : c,
        ),
      }));
    },
    [update],
  );

  const deleteComment = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        comments: prev.comments.filter((c) => c.id !== id),
      }));
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
    comments: state.comments,
    setActiveUser,
    addUser,
    addComment,
    updateCommentContent,
    setCommentAuthor,
    setCommentAnchor,
    addTurn,
    resolveComment,
    reopenComment,
    deleteComment,
    refresh: reload,
  };
}
