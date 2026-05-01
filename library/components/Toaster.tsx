"use client";

import { useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@library/lib/queue";

const VISIBLE_MS = 6000;

interface ToastEntry extends NotificationItem {
  uid: string;
}

export default function Toaster({ items }: { items: NotificationItem[] }) {
  const [visible, setVisible] = useState<ToastEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newOnes: ToastEntry[] = [];
    for (const item of items) {
      const uid = `${item.at}-${item.kind}-${item.citekey ?? ""}`;
      if (seenRef.current.has(uid)) continue;
      seenRef.current.add(uid);
      newOnes.push({ ...item, uid });
    }
    if (newOnes.length === 0) return;
    setVisible((prev) => [...prev, ...newOnes]);
    const timeouts = newOnes.map((toast) =>
      window.setTimeout(() => {
        setVisible((prev) => prev.filter((t) => t.uid !== toast.uid));
      }, VISIBLE_MS),
    );
    return () => timeouts.forEach((t) => window.clearTimeout(t));
  }, [items]);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 100,
      }}
    >
      {visible.map((t) => (
        <div
          key={t.uid}
          style={{
            background: "var(--surface)",
            border: "var(--pod-border)",
            borderRadius: 6,
            padding: "10px 14px",
            boxShadow: "var(--pod-shadow)",
            fontSize: 13,
            maxWidth: 360,
          }}
        >
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)" }}>
            {t.kind}{t.citekey ? ` · ${t.citekey}` : ""}
          </div>
          <div>{t.summary}</div>
        </div>
      ))}
    </div>
  );
}
