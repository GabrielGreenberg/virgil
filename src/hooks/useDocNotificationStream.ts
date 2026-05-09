"use client";

import { useEffect, useRef, useState } from "react";
import { readSidecar } from "@/lib/storage";
import type { DocNotification, DocNotificationsInbox } from "@/lib/types";

const POLL_MS = 6000;
const SEEN_AT_KEY_PREFIX = "virgil-doc-notification-seen-at:";
const EMPTY: DocNotificationsInbox = { items: [] };

/**
 * Polls `<doc>/virgil/notifications.json` for completion entries written by
 * editor-side skills (`/editor/review` and friends). Returns the items
 * appended since the last seen timestamp; consumers toast them.
 *
 * Each doc tracks its own "last seen" timestamp in localStorage so a tab
 * reopen doesn't re-toast every prior completion.
 */
export function useDocNotificationStream(docId: string | null): DocNotification[] {
  const [items, setItems] = useState<DocNotification[]>([]);
  const seenAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!docId) return;
    let stopped = false;
    const seenKey = `${SEEN_AT_KEY_PREFIX}${docId}`;

    if (seenAtRef.current === null) {
      try {
        seenAtRef.current = localStorage.getItem(seenKey) ?? "";
      } catch {
        seenAtRef.current = "";
      }
    }

    const tick = async () => {
      if (stopped) return;
      let inbox: DocNotificationsInbox;
      try {
        inbox = await readSidecar<DocNotificationsInbox>(
          docId,
          "notifications.json",
          EMPTY,
        );
      } catch {
        return;
      }
      if (!Array.isArray(inbox.items) || inbox.items.length === 0) return;
      const newest = inbox.items[inbox.items.length - 1]?.at ?? "";
      if (newest !== seenAtRef.current) {
        const prev = seenAtRef.current!;
        seenAtRef.current = newest;
        try { localStorage.setItem(seenKey, newest); } catch {}
        setItems(inbox.items.filter((i) => i.at > prev));
      }
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [docId]);

  return items;
}
