import type { Instant, LocalDate } from '../core/dates.js';
import type { Provenance } from '../core/provenance.js';

/** National, state or local commentary module with its own date, source and author. */
export interface MarketCommentary {
  readonly id: string;
  readonly level: 'national' | 'state' | 'local';
  readonly assetId?: string;
  /** The date the commentary speaks to. Must not post-date a retrospective cut-off. */
  readonly asAtDate: LocalDate;
  readonly text: string;
  readonly authoredBy: string;
  readonly authoredAt: Instant;
  readonly sources: readonly Provenance[];
  /** Library paragraphs the text was taken from, when it came from the firm's library. */
  readonly library?: readonly { readonly moduleId: string; readonly version: number }[];
}

/**
 * The commentary the job relies on: the latest record for each level (and asset, for local
 * commentary). Earlier records stay on file but are superseded.
 */
export function currentCommentary(records: readonly MarketCommentary[]): MarketCommentary[] {
  const latest = new Map<string, MarketCommentary>();
  for (const c of records) {
    const key = `${c.level}|${c.assetId ?? ''}`;
    const prev = latest.get(key);
    // Latest record wins; records made in the same instant prefer the later as-at date.
    if (
      !prev ||
      c.authoredAt > prev.authoredAt ||
      (c.authoredAt === prev.authoredAt &&
        (c.asAtDate > prev.asAtDate || (c.asAtDate === prev.asAtDate && c.id > prev.id)))
    )
      latest.set(key, c);
  }
  return [...latest.values()];
}

export interface RiskFlag {
  readonly id: string;
  readonly assetId?: string;
  readonly category:
    | 'environmental'
    | 'structural_observation'
    | 'title'
    | 'planning'
    | 'market'
    | 'data_quality'
    | 'access'
    | 'other';
  readonly description: string;
  readonly severity: 'low' | 'medium' | 'high';
  /** Requires escalation (e.g. from desktop to full inspection, or to a specialist). */
  readonly requiresEscalation: boolean;
  readonly status: 'open' | 'resolved' | 'accepted';
  readonly resolutionNote?: string;
}
