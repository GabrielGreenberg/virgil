import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { CitationsState } from "@/lib/types";

const DEFAULT: CitationsState = { citations: [], bibPath: "", citationStyle: "apa" };

function getDocId(request: Request): string | null {
  return new URL(request.url).searchParams.get("docId");
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const filepath = await getMetaPath(docId, "citations.json");
    const state = await readJsonFile<CitationsState>(filepath, DEFAULT);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading citations:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const state: CitationsState = await request.json();
    const filepath = await getMetaPath(docId, "citations.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving citations:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
