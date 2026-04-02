import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { NotesState } from "@/lib/types";

const DEFAULT_STATE: NotesState = { notes: [] };

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
    const filepath = await getMetaPath(docId, "notes.json");
    const state = await readJsonFile<NotesState>(filepath, DEFAULT_STATE);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading notes:", error);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: NotesState = await request.json();
    const filepath = await getMetaPath(docId, "notes.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving notes:", error);
    return NextResponse.json({ error: "Failed to save notes" }, { status: 500 });
  }
}
