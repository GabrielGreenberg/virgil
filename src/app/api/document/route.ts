import { NextResponse } from "next/server";
import {
  readTextFile,
  writeTextFile,
  readJsonFile,
  writeJsonFile,
  getTexPath,
  getMetaPath,
  updateDocTimestamp,
} from "@/lib/storage";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import type { EditorStateData } from "@/lib/types";

const DEFAULT_LATEX = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

Start writing here...

\\end{document}
`;

const DEFAULT_EDITOR_STATE: EditorStateData = {
  cursorPosition: 0,
  selection: null,
  lastModified: new Date().toISOString(),
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

    const texPath = await getTexPath(docId);
    const statePath = await getMetaPath(docId, "editor-state.json");

    const latex = await readTextFile(texPath, DEFAULT_LATEX);
    const doc = parseLatex(latex);
    const editorState = await readJsonFile<EditorStateData>(statePath, DEFAULT_EDITOR_STATE);

    return NextResponse.json({ content: doc, editorState });
  } catch (error) {
    console.error("Error loading document:", error);
    return NextResponse.json({ error: "Failed to load document" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }

    const body = await request.json();
    const { content, editorState } = body;

    const texPath = await getTexPath(docId);
    const statePath = await getMetaPath(docId, "editor-state.json");

    const latex = serializeToLatex(content);
    await writeTextFile(texPath, latex);
    await writeJsonFile(statePath, {
      ...editorState,
      lastModified: new Date().toISOString(),
    });
    await updateDocTimestamp(docId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving document:", error);
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 });
  }
}
