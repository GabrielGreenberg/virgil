"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationItem } from "@library/lib/queue";
import { notificationSeverity, notificationTtlMs } from "@library/lib/queue";

interface ToastEntry extends NotificationItem {
  uid: string;
}

export default function Toaster({ items }: { items: NotificationItem[] }) {
  const [visible, setVisible] = useState<ToastEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  // Ingest only NEW items (dedupe by stable uid). Crucially there are NO
  // timers in this effect — each <Toast> owns its own lifecycle. The old
  // single-effect-clears-all-timers pattern cancelled (and never re-armed)
  // a still-visible toast's timer whenever a sibling arrived, so toasts
  // stuck forever; per-toast timers make that impossible.
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
  }, [items]);

  const removeToast = useCallback((uid: string) => {
    setVisible((prev) => prev.filter((t) => t.uid !== uid));
  }, []);

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
        <Toast key={t.uid} toast={t} onClose={() => removeToast(t.uid)} />
      ))}
    </div>
  );
}

function Toast({ toast, onClose }: { toast: ToastEntry; onClose: () => void }) {
  const ttl = notificationTtlMs(toast.kind);
  const severity = notificationSeverity(toast.kind);
  const accent = severity === "attention" ? "var(--danger)" : "var(--accent)";

  // Each toast owns one timer. Hovering pauses the countdown (we bank the
  // remaining time); leaving resumes it. A sibling arriving/leaving cannot
  // touch this timer — it lives entirely in this component instance.
  const remainingRef = useRef(ttl);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(
    (ms: number) => {
      clearTimer();
      startedAtRef.current = Date.now();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        onCloseRef.current();
      }, ms);
    },
    [clearTimer],
  );

  useEffect(() => {
    armTimer(ttl);
    return clearTimer;
  }, [armTimer, clearTimer, ttl]);

  const pause = useCallback(() => {
    if (timerRef.current === null) return;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    if (timerRef.current !== null) return;
    if (remainingRef.current <= 0) {
      onCloseRef.current();
      return;
    }
    armTimer(remainingRef.current);
  }, [armTimer]);

  return (
    <div
      role="status"
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={{
        background: "var(--surface)",
        border: "var(--pod-border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
        padding: "8px 12px 10px 14px",
        boxShadow: "var(--pod-shadow)",
        fontSize: 13,
        maxWidth: 360,
        minWidth: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: accent,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {toast.kind}
          {toast.citekey ? ` · ${toast.citekey}` : ""}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onClose}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            marginTop: -2,
            marginRight: -4,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1,
            cursor: "pointer",
            borderRadius: 3,
          }}
        >
          ×
        </button>
      </div>
      <div>{toast.summary}</div>
    </div>
  );
}
