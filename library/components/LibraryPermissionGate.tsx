"use client";

interface Props {
  onGrant: () => void;
  onReset: () => void;
}

export default function LibraryPermissionGate({ onGrant, onReset }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 12,
        padding: 32,
      }}
    >
      <h2 style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 500 }}>
        Permission needed
      </h2>
      <p style={{ color: "var(--muted)", maxWidth: 460, textAlign: "center" }}>
        Browsers reset File System Access permissions on every reload. Click below
        to re-grant access to your library folder.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onGrant}
          style={{
            background: "var(--accent)",
            color: "white",
            padding: "8px 16px",
            borderRadius: 6,
            border: "none",
          }}
        >
          Grant access
        </button>
        <button
          onClick={onReset}
          style={{
            background: "transparent",
            color: "var(--muted)",
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid var(--border-light)",
          }}
        >
          Pick a different folder
        </button>
      </div>
    </div>
  );
}
