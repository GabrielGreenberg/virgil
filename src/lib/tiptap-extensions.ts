// Thin re-export shim. The implementations live in `./tiptap/` split by
// extension. This file exists to keep the public import path
// `@/lib/tiptap-extensions` stable for existing call sites.

export * from "./tiptap";
