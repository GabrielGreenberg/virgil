import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { AiRequestsState } from "@/lib/types";

const DEFAULT_STATE: AiRequestsState = { requests: [] };

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
    const filepath = await getMetaPath(docId, "ai-requests.json");
    const state = await readJsonFile<AiRequestsState>(filepath, DEFAULT_STATE);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading ai requests:", error);
    return NextResponse.json({ error: "Failed to load ai requests" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: AiRequestsState = await request.json();
    const filepath = await getMetaPath(docId, "ai-requests.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving ai requests:", error);
    return NextResponse.json({ error: "Failed to save ai requests" }, { status: 500 });
  }
}
