import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { TodoState } from "@/lib/types";

const DEFAULT_STATE: TodoState = { items: [] };

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
    const filepath = await getMetaPath(docId, "todos.json");
    const state = await readJsonFile<TodoState>(filepath, DEFAULT_STATE);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading todos:", error);
    return NextResponse.json({ error: "Failed to load todos" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: TodoState = await request.json();
    const filepath = await getMetaPath(docId, "todos.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving todos:", error);
    return NextResponse.json({ error: "Failed to save todos" }, { status: 500 });
  }
}
