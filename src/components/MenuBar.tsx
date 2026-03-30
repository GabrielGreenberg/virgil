"use client";

import { Editor } from "@tiptap/react";

interface MenuBarProps {
  editor: Editor | null;
  onAddComment?: () => void;
  onArchive?: () => void;
  onCreateFootnote?: () => void;
}

function Btn({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-sm transition-colors ${
        active
          ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
          : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

export default function MenuBar({ editor, onAddComment, onArchive, onCreateFootnote }: MenuBarProps) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)] bg-white flex-wrap">
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <strong>B</strong>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <em>I</em>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline (Cmd+U)"
      >
        <u>U</u>
      </Btn>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <select
        value={
          editor.isActive("heading", { level: 1 })
            ? "1"
            : editor.isActive("heading", { level: 2 })
              ? "2"
              : editor.isActive("heading", { level: 3 })
                ? "3"
                : "0"
        }
        onChange={(e) => {
          const val = e.target.value;
          if (val === "0") {
            if (editor.isActive("heading")) {
              editor.chain().focus().setParagraph().run();
            }
          } else {
            const level = parseInt(val) as 1 | 2 | 3;
            editor.chain().focus().toggleHeading({ level }).run();
          }
        }}
        className="px-2 py-1 rounded text-sm bg-transparent text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700 border-none outline-none cursor-pointer appearance-none pr-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a8580'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 4px center",
        }}
        title="Section level"
      >
        <option value="0">Body text</option>
        <option value="1">Section</option>
        <option value="2">Subsection</option>
        <option value="3">Subsubsection</option>
      </select>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet List"
      >
        &bull; List
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered List"
      >
        1. List
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        &ldquo; Quote
      </Btn>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <Btn
        onClick={() => {
          const latex = window.prompt("Enter LaTeX:", "x^2");
          if (latex) {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "inlineMath",
                attrs: { latex },
              })
              .run();
          }
        }}
        title="Insert inline math"
      >
        $x$
      </Btn>
      <Btn
        onClick={() => {
          const latex = window.prompt(
            "Enter display math LaTeX:",
            "\\int_0^1 f(x) dx"
          );
          if (latex) {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "displayMath",
                attrs: { latex },
              })
              .run();
          }
        }}
        title="Insert display math"
      >
        $$
      </Btn>

      {onAddComment && (
        <>
          <div className="w-px h-4 bg-[var(--border)] mx-1" />
          <Btn onClick={onAddComment} title="Add comment on selection (Cmd+Shift+M)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2.5h12a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H4.5L2 13.5V3a.5.5 0 0 1 .5-.5z" />
              <line x1="8" y1="5.5" x2="8" y2="9" />
              <line x1="6.25" y1="7.25" x2="9.75" y2="7.25" />
            </svg>
          </Btn>
        </>
      )}
      {onArchive && (
        <Btn onClick={onArchive} title="Archive selected text">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2.5" />
            <text x="8" y="11.2" textAnchor="middle" fontSize="9" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor" stroke="none">A</text>
          </svg>
        </Btn>
      )}
      {onCreateFootnote && (
        <Btn onClick={onCreateFootnote} title="Create footnote from selection">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <text x="3" y="12" fontSize="12" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor">fn</text>
          </svg>
        </Btn>
      )}
    </div>
  );
}
