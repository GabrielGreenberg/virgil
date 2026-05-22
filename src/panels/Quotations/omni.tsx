"use client";

import type { BibEntry, Quote, QuotationGroup } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { QuotationGroupCard } from "./QuotationGroupCard";
import { getLinkedTextObjectIds } from "@/links/links";

interface BuildArgs {
  quotationGroups: QuotationGroup[];
  selectedQuotationGroupId: string | null;
  setSelectedQuotationGroupId: (id: string | null) => void;
  jumpToCard: (card: QuotationGroup, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  bibEntries: BibEntry[];
  bibPackage: string;
  deleteQuotationGroup: (id: string) => void;
  updateQuotationGroupTitle: (id: string, title: string) => void;
  addQuotationReference: (groupId: string) => string;
  deleteQuotationReference: (groupId: string, referenceId: string) => void;
  updateQuotationReferenceCiteKey: (
    groupId: string,
    referenceId: string,
    key: string,
  ) => void;
  addQuotationQuote: (groupId: string, referenceId: string) => string;
  updateQuotationQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  deleteQuotationQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
  ) => void;
  updateQuotationNotes: (groupId: string, notes: string) => void;
}

export function buildQuotationOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const group of a.quotationGroups) {
    const pids = getLinkedTextObjectIds(group);
    const isSelected = a.selectedQuotationGroupId === group.id;
    const baseId = popKey("quotations", group.id);

    if (pids.length === 0) {
      items.push({
        id: baseId,
        pos: null,
        content: (
          <QuotationGroupCard
            key={baseId}
            group={group}
            bibEntries={a.bibEntries}
            bibPackage={a.bibPackage}
            selected={isSelected}
            onSelect={() => a.setSelectedQuotationGroupId(group.id)}
            onDelete={() => a.deleteQuotationGroup(group.id)}
            onUpdateGroupTitle={a.updateQuotationGroupTitle}
            onAddReference={a.addQuotationReference}
            onDeleteReference={a.deleteQuotationReference}
            onUpdateReferenceCiteKey={a.updateQuotationReferenceCiteKey}
            onAddQuote={a.addQuotationQuote}
            onUpdateQuote={a.updateQuotationQuote}
            onDeleteQuote={a.deleteQuotationQuote}
            onUpdateNotes={a.updateQuotationNotes}
            extraDataAttrs={{ "data-omni-entry": baseId }}
          />
        ),
      });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({
          id: omniId,
          pos,
          content: (
            <QuotationGroupCard
              key={omniId}
              group={group}
              bibEntries={a.bibEntries}
              bibPackage={a.bibPackage}
              selected={isSelected}
              onSelect={() => a.setSelectedQuotationGroupId(group.id)}
              onDelete={() => a.deleteQuotationGroup(group.id)}
              onJump={(sourceEl) => a.jumpToCard(group, sourceEl)}
              onUpdateGroupTitle={a.updateQuotationGroupTitle}
              onAddReference={a.addQuotationReference}
              onDeleteReference={a.deleteQuotationReference}
              onUpdateReferenceCiteKey={a.updateQuotationReferenceCiteKey}
              onAddQuote={a.addQuotationQuote}
              onUpdateQuote={a.updateQuotationQuote}
              onDeleteQuote={a.deleteQuotationQuote}
              onUpdateNotes={a.updateQuotationNotes}
              extraDataAttrs={{ "data-omni-entry": omniId }}
            />
          ),
        });
      }
    }
  }

  return items;
}
