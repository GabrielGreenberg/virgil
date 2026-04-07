import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { v4 as uuid } from "uuid";
import { writeJsonFile, getMetaPath } from "@/lib/storage";
import type {
  CommentsState,
  RevisionsState,
  RevisionUser,
  TextRevision,
} from "@/lib/types";

const DEFAULT_USERS: RevisionUser[] = [
  { id: "claude", name: "Claude", color: "#a855f7", isDefault: true },
  { id: "me", name: "Me", color: "#3b82f6", isDefault: true },
];

function emptyState(): RevisionsState {
  return {
    users: [...DEFAULT_USERS],
    generalRevisions: [],
    textRevisions: [],
    activeUserId: "me",
  };
}

function getDocId(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("docId");
}

/**
 * One-shot migration from comments.json. The original file is left in
 * place as a backup; this only ever runs when revisions.json is missing.
 */
async function migrateFromComments(commentsPath: string): Promise<RevisionsState | null> {
  let comments: CommentsState;
  try {
    const raw = await fs.readFile(commentsPath, "utf-8");
    comments = JSON.parse(raw) as CommentsState;
  } catch {
    return null;
  }
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

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const filepath = await getMetaPath(docId, "revisions.json");

    // Has revisions.json already? Return as-is (with default users patched in
    // if a previously-saved file is missing them).
    try {
      const raw = await fs.readFile(filepath, "utf-8");
      const state = JSON.parse(raw) as RevisionsState;
      const users = state.users?.length ? state.users : [...DEFAULT_USERS];
      return NextResponse.json({
        users,
        generalRevisions: state.generalRevisions ?? [],
        textRevisions: state.textRevisions ?? [],
        activeUserId: state.activeUserId ?? "me",
      } satisfies RevisionsState);
    } catch {
      // File doesn't exist yet — fall through to migration / empty state.
    }

    // Try migrating from comments.json (kept as backup, never deleted).
    const commentsPath = await getMetaPath(docId, "comments.json");
    const migrated = await migrateFromComments(commentsPath);
    const state = migrated ?? emptyState();

    // Persist so subsequent loads skip the migration.
    await writeJsonFile(filepath, state);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading revisions:", error);
    return NextResponse.json({ error: "Failed to load revisions" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: RevisionsState = await request.json();
    const filepath = await getMetaPath(docId, "revisions.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving revisions:", error);
    return NextResponse.json({ error: "Failed to save revisions" }, { status: 500 });
  }
}
