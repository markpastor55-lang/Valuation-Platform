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
