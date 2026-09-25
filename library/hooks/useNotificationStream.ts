"use client";

import { useEffect, useRef, useState } from "react";
import { readNotificationItems, type NotificationItem } from "@library/lib/queue";
import {
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";

const POLL_MS = 6000;
const SEEN_AT_KEY = "virgil-notification-seen-at";

export function useNotificationStream(handle: FileSystemDirectoryHandle | null) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  // undefined = not read from storage yet; null = NO mark exists (first run
  // or cleared storage); a string (possibly "" for an empty inbox) = the
  // newest `at` already surfaced.
  const seenAtRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!handle) return;
    let stopped = false;

    if (seenAtRef.current === undefined) {
      try {
        seenAtRef.current = localStorage.getItem(SEEN_AT_KEY);
      } catch {
        seenAtRef.current = null;
      }
    }

    // A peer window that already surfaced the newest notification advances
    // the mark here too, so this window does not re-show it (task 599).
    const offPeer = subscribeToStorageKey(SEEN_AT_KEY, () => {
      try {
        seenAtRef.current = localStorage.getItem(SEEN_AT_KEY);
      } catch {
        /* keep the cached mark */
      }
    });

    const tick = async () => {
      if (stopped) return;
      // Shape-checked reader: a malformed inbox (`{}`) is an empty one, not
      // an unhandled rejection every POLL_MS (task 764).
      const items = await readNotificationItems(handle);
      if (stopped) return;
      const newest = items[items.length - 1]?.at ?? "";
      if (newest === seenAtRef.current) return;
      const prev = seenAtRef.current;
      seenAtRef.current = newest;
      writeStorageIfChanged(SEEN_AT_KEY, newest);
      // No mark yet (first run / cleared storage): adopt the newest item as
      // the baseline WITHOUT toasting the whole history (task 764). Only
      // items newer than a real mark are news.
      if (prev == null) return;
      setItems(items.filter((i) => i.at > prev));
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      offPeer();
      window.clearInterval(interval);
    };
  }, [handle]);

  return items;
}
