import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createDoc, readIndex } from "@/lib/storage";

/**
 * POST /api/files/open
 * Open a .tex file by its absolute path on disk.
 * Creates a virgil/ metadata folder next to it.
 * If the file is already registered, returns the existing doc.
 */
export async function POST(request: Request) {
  try {
    const { filePath } = await request.json();

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ error: "filePath required" }, { status: 400 });
    }

    const resolved = path.resolve(filePath);

    // Verify the file exists
    try {
      await fs.access(resolved);
    } catch {
      return NextResponse.json({ error: `File not found: ${resolved}` }, { status: 404 });
    }

    // Check if already registered
    const index = await readIndex();
    const existing = index.docs.find((d) => d.sourcePath === resolved);
    if (existing) {
      return NextResponse.json(existing);
    }

    // Register the file — use the filename (without .tex) as the document name
    const name = path.basename(resolved, ".tex");
    const meta = await createDoc(name, resolved);
    return NextResponse.json(meta);
  } catch (error) {
    console.error("Error opening file:", error);
    return NextResponse.json({ error: "Failed to open file" }, { status: 500 });
  }
}
