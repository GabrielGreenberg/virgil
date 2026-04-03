import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { BibReviewState } from "@/lib/types";

const DEFAULT: BibReviewState = { requests: [] };

function getDocId(request: Request): string | null {
  return new URL(request.url).searchParams.get("docId");
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const filepath = await getMetaPath(docId, "bib-review-requests.json");
    const state = await readJsonFile<BibReviewState>(filepath, DEFAULT);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading bib review requests:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) return NextResponse.json({ error: "docId required" }, { status: 400 });
    const state: BibReviewState = await request.json();
    const filepath = await getMetaPath(docId, "bib-review-requests.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving bib review requests:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
