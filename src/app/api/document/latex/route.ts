import { NextResponse } from "next/server";
import { readTextFile, writeTextFile, getTexPath, updateDocTimestamp } from "@/lib/storage";

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
    const texPath = await getTexPath(docId);
    const latex = await readTextFile(texPath, "");
    return NextResponse.json({ latex });
  } catch (error) {
    console.error("Error loading LaTeX:", error);
    return NextResponse.json({ error: "Failed to load LaTeX" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const { latex } = await request.json();
    const texPath = await getTexPath(docId);
    await writeTextFile(texPath, latex);
    await updateDocTimestamp(docId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving LaTeX:", error);
    return NextResponse.json({ error: "Failed to save LaTeX" }, { status: 500 });
  }
}
