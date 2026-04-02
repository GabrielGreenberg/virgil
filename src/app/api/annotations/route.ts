import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { AnnotationsState } from "@/lib/types";

const DEFAULT: AnnotationsState = {};

function getDocId(request: Request): string | null {
  return new URL(request.url).searchParams.get("docId");
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const filepath = await getMetaPath(docId, "annotations.json");
    const state = await readJsonFile<AnnotationsState>(filepath, DEFAULT);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading annotations:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const state: AnnotationsState = await request.json();
    const filepath = await getMetaPath(docId, "annotations.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving annotations:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
