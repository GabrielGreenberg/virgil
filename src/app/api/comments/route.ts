import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { CommentsState } from "@/lib/types";

const DEFAULT_STATE: CommentsState = { comments: [] };

function getDocId(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("docId");
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const filepath = await getMetaPath(docId, "comments.json");
    const state = await readJsonFile<CommentsState>(filepath, DEFAULT_STATE);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading comments:", error);
    return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: CommentsState = await request.json();
    const filepath = await getMetaPath(docId, "comments.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving comments:", error);
    return NextResponse.json({ error: "Failed to save comments" }, { status: 500 });
  }
}
