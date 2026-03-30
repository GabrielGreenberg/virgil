import { NextResponse } from "next/server";
import { readIndex, createDoc, migrateIfNeeded } from "@/lib/storage";

export async function GET() {
  try {
    await migrateIfNeeded();
    const index = await readIndex();
    return NextResponse.json(index);
  } catch (error) {
    console.error("Error listing files:", error);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    const meta = await createDoc(name || "Untitled");
    return NextResponse.json(meta);
  } catch (error) {
    console.error("Error creating file:", error);
    return NextResponse.json({ error: "Failed to create file" }, { status: 500 });
  }
}
