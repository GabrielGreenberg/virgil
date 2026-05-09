"use client";

interface Props {
  onPick: () => void;
}

export default function LibraryFolderPicker({ onPick }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 16,
        padding: 32,
      }}
    >
      <h1 style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 500 }}>
        Virgil Library
      </h1>
      <p style={{ color: "var(--muted)", maxWidth: 480, textAlign: "center" }}>
        Pick a folder to use as your library root. The recommended location is{" "}
        <code style={{ fontFamily: "var(--mono)" }}>~/Virgil-Library/</code>.
        Virgil Library will create <code>master.bib</code>, the <code>papers/</code> and
        {" "}<code>unsorted/</code> folders, plus hidden <code>.claude/</code> and
        {" "}<code>.virgil/</code> folders for skill commands and runtime state.
      </p>
      <button
        onClick={onPick}
        style={{
          background: "var(--accent)",
          color: "white",
          padding: "10px 18px",
          borderRadius: 6,
          border: "none",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        Choose library folder…
      </button>
    </div>
  );
}
