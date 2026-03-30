import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { SuggestionsState } from "@/lib/types";

const DEFAULT_STATE: SuggestionsState = {
  suggestions: [],
  currentIndex: 0,
  reviewedAt: "",
  documentHash: "",
};

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
    const filepath = await getMetaPath(docId, "suggestions.json");
    const state = await readJsonFile<SuggestionsState>(filepath, DEFAULT_STATE);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading suggestions:", error);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: SuggestionsState = await request.json();
    const filepath = await getMetaPath(docId, "suggestions.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving suggestions:", error);
    return NextResponse.json({ error: "Failed to save suggestions" }, { status: 500 });
  }
}
