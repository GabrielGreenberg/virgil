"use client";

/**
 * Mock File System Access handles backed by the dev API at
 * /api/dev-library/. Lets the library code (library-storage.ts and friends,
 * which only call FSA methods) run unchanged inside the Claude Preview
 * iframe — where `showDirectoryPicker` is unavailable.
 *
 * Only used when `isDevStorage` from `@/lib/storage-mode` is true. Production
 * builds never instantiate these classes (the API route they depend on is
 * compiled out by the .dev.ts pageExtensions guard).
 *
 * Implements just the subset of FSA the library code uses:
 *   - DirectoryHandle: getDirectoryHandle(create?), getFileHandle(create?),
 *     removeEntry(), entries(), queryPermission(), requestPermission(), kind, name
 *   - FileHandle: getFile(), createWritable(), kind, name
 *   - WritableStream: write(), close()
 */

const API = "/api/dev-library";

function joinPath(parts: readonly string[]): string {
  return parts.filter(Boolean).join("/");
}

class DevWritable {
  private chunks: (string | Blob)[] = [];
  constructor(private readonly path: string) {}

  async write(data: string | Blob): Promise<void> {
    this.chunks.push(data);
  }

  async close(): Promise<void> {
    // Concatenate everything written before closing. The library only ever
    // calls write() once per file, so this is straightforward — but we
    // support multi-write just in case.
    const isBinary = this.chunks.some((c) => c instanceof Blob);
    if (isBinary) {
      const blobs: BlobPart[] = this.chunks.map((c) =>
        typeof c === "string" ? c : c,
      );
      const blob = new Blob(blobs);
      await fetch(`${API}/${this.path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: await blob.arrayBuffer(),
      });
    } else {
      const body = this.chunks.join("");
      await fetch(`${API}/${this.path}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body,
      });
    }
  }

  async abort(): Promise<void> {
    this.chunks = [];
  }
}

class DevFileHandle {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    private readonly path: string,
  ) {}

  async getFile(): Promise<File> {
    const res = await fetch(`${API}/${this.path}`);
    if (!res.ok) {
      // Throw to mirror real FSA behavior — callers handle the catch.
      throw new DOMException(`File not found: ${this.path}`, "NotFoundError");
    }
    const buf = await res.arrayBuffer();
    return new File([buf], this.name);
  }

  async createWritable(): Promise<DevWritable> {
    return new DevWritable(this.path);
  }
}

class DevDirectoryHandle {
  readonly kind = "directory" as const;
  constructor(
    readonly name: string,
    private readonly pathParts: readonly string[],
  ) {}

  private childPath(name: string): string {
    return joinPath([...this.pathParts, name]);
  }

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<DevDirectoryHandle> {
    if (opts?.create) {
      // PUT to a sentinel inside the dir would create it on a real fs;
      // simpler: create-on-write is implicit in the PUT route, so we just
      // return a handle and let later writes materialize the directory.
      return new DevDirectoryHandle(name, [...this.pathParts, name]);
    }
    // Verify it exists.
    const res = await fetch(`${API}/_exists/${this.childPath(name)}`);
    if (!res.ok) {
      throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
    }
    const body = (await res.json()) as { kind?: string };
    if (body.kind !== "directory") {
      throw new DOMException(`Not a directory: ${name}`, "TypeMismatchError");
    }
    return new DevDirectoryHandle(name, [...this.pathParts, name]);
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<DevFileHandle> {
    const childPath = this.childPath(name);
    if (opts?.create) {
      return new DevFileHandle(name, childPath);
    }
    const res = await fetch(`${API}/_exists/${childPath}`);
    if (!res.ok) {
      throw new DOMException(`File not found: ${name}`, "NotFoundError");
    }
    return new DevFileHandle(name, childPath);
  }

  async removeEntry(name: string): Promise<void> {
    await fetch(`${API}/${this.childPath(name)}`, { method: "DELETE" });
  }

  async *entries(): AsyncIterableIterator<
    [string, DevDirectoryHandle | DevFileHandle]
  > {
    const listPath = this.pathParts.length > 0
      ? `_list/${joinPath(this.pathParts)}`
      : "_list";
    const res = await fetch(`${API}/${listPath}`);
    if (!res.ok) return;
    const body = (await res.json()) as {
      entries?: { name: string; kind: "file" | "directory" }[];
    };
    for (const entry of body.entries ?? []) {
      if (entry.kind === "directory") {
        yield [entry.name, new DevDirectoryHandle(entry.name, [...this.pathParts, entry.name])];
      } else {
        yield [entry.name, new DevFileHandle(entry.name, this.childPath(entry.name))];
      }
    }
  }

  // Permissions are always granted in dev mode — nothing to gate.
  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

/** The synthetic root handle used when isDevStorage is true. */
export function devLibraryRootHandle(): FileSystemDirectoryHandle {
  // Cast through unknown — DevDirectoryHandle implements the subset we use,
  // not the full FSA interface (e.g. no resolve(), no isSameEntry()).
  return new DevDirectoryHandle("library-data", []) as unknown as FileSystemDirectoryHandle;
}
