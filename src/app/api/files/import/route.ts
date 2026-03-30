import { NextResponse } from "next/server";
import { createDoc, getTexPath, writeTextFile } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { name, texContent, sourcePath } = await request.json();

    if (sourcePath) {
      // Importing an existing .tex file — register it in place.
      // The sourcePath points to the actual .tex file on disk.
      // createDoc will create the virgil/ metadata folder next to it.
      const meta = await createDoc(name || "Untitled", sourcePath);
      return NextResponse.json(meta);
    } else {
      // No sourcePath — create a new doc with the provided content
      const meta = await createDoc(name || "Untitled");
      const texPath = await getTexPath(meta.id);
      await writeTextFile(texPath, texContent);
      return NextResponse.json(meta);
    }
  } catch (error) {
    console.error("Error importing file:", error);
    return NextResponse.json({ error: "Failed to import file" }, { status: 500 });
  }
}
