"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AiRequest, AiRequestKind } from "@/lib/types";

/**
 * AI request list + mutators. Consumed by the five panels that host AI
 * request cards (notes, footnotes, todo, quotations, citations). The
 * shell owns the hook call; panels read through this context rather
 * than taking four props each.
 */
export interface AiRequestsContextValue {
  aiRequests: AiRequest[];
  addAiRequest: (kind: AiRequestKind) => void;
  updateAiRequestText: (id: string, text: string) => void;
  deleteAiRequest: (id: string) => void;
}

const AiRequestsCtx = createContext<AiRequestsContextValue | null>(null);

export function AiRequestsProvider({
  value,
  children,
}: {
  value: AiRequestsContextValue;
  children: ReactNode;
}) {
  return <AiRequestsCtx.Provider value={value}>{children}</AiRequestsCtx.Provider>;
}

export function useAiRequestsContext(): AiRequestsContextValue {
  const v = useContext(AiRequestsCtx);
  if (!v) throw new Error("useAiRequestsContext must be used inside AiRequestsProvider");
  return v;
}
