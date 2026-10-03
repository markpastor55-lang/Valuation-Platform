import type { Instant, LocalDate } from '../core/dates.js';
import { compareDates, formatAustralianDate, isLocalDate, monthsBetween } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import type { Provenance } from '../core/provenance.js';
import { checkProvenance } from '../core/provenance.js';
import type { Jurisdiction, PropertyType } from '../config/codes.js';
import { JURISDICTION_LABELS, JURISDICTIONS, PROPERTY_TYPE_LABELS } from '../config/codes.js';
import type { MarketCommentary } from './market.js';

/**
 * The firm's market commentary library: short, dated paragraphs at national, state and local
 * level, each written for every property type (an overview) or for particular property types.
 * A job is offered the approved paragraphs that match its property type and location as at the
 * valuation date; the valuer reviews, edits and accepts them. Paragraphs are versioned, and an
 * approved version never changes: a new quarter's view is a new version. [REVIEW: API_STANDARDS]
 */

export type CommentaryLevel = MarketCommentary['level'];
export const COMMENTARY_LEVELS: readonly CommentaryLevel[] = ['national', 'state', 'local'];

/** The report field each level of commentary is written to. */
export const COMMENTARY_FIELDS: Readonly<Record<CommentaryLevel, string>> = {
  national: 'market.national',
  state: 'market.state',
  local: 'market.local',
};

export type CommentaryModuleStatus = 'draft' | 'approved' | 'retired';

export interface CommentaryModule {
  readonly moduleId: string;
  readonly version: number;
  readonly level: CommentaryLevel;
  /** What the paragraph is about, e.g. "Apartments and units" (shown to the valuer). */
  readonly title: string;
  /** State and local paragraphs belong to one state or territory. */
  readonly jurisdiction?: Jurisdiction;
  /** Local paragraphs: the suburbs, towns or council areas they cover. */
  readonly localities?: readonly string[];
  /** Property types the paragraph is written for; absent means an overview for every type. */
  readonly propertyTypes?: readonly PropertyType[];
  /** The date the commentary speaks to. */
  readonly asAtDate: LocalDate;
  readonly text: string;
  /** Where the facts in the paragraph come from. */
  readonly sources: readonly Provenance[];
  readonly status: CommentaryModuleStatus;
  readonly authoredBy: string;
  readonly authoredAt: Instant;
  readonly approvedBy?: string;
  readonly approvedAt?: Instant;
}

/** The firm's own library, registered like any other source so provenance can name it. */
export const COMMENTARY_LIBRARY_SOURCE: DataSource = {
  id: 'ds-commentary-library',
  name: 'Firm market commentary library',
  provider: 'The valuation firm (approved by the standards owner)',
  kind: 'market_commentary',
  licence: {
    basis: 'internal',
    permitsStorage: true,
    permitsReportReproduction: true,
    permitsBulkUse: true,
  },
  status: 'active',
};

/** Commentary dated more than this many months before the valuation date is flagged as dated. */
export const COMMENTARY_STALE_MONTHS: Readonly<Record<CommentaryLevel, number>> = {
  national: 6,
  state: 6,
  local: 4,
};

/** Shorter commentary is flagged for expansion (characters). [REVIEW: API_STANDARDS] */
export const COMMENTARY_MIN_CHARS = 300;

const LEVEL_TOPICS: Readonly<Record<CommentaryLevel, readonly string[]>> = {
  national: [
    'Interest rates and credit conditions',
    'Economic growth, employment and inflation',
    'Population growth and migration',
  ],
  state: [
    'State economy and employment',
    'Population and interstate migration',
    'State taxes, grants and planning policy',
    'Major infrastructure',
  ],
  local: [
    'Location, amenity and services',
    'Recent sales activity and price levels',
    'Supply: listings, new projects and land release',
    'Buyer profile, time on market and discounting',
  ],
};

const TYPE_TOPICS: Readonly<
  Record<PropertyType, Readonly<Record<CommentaryLevel, readonly string[]>>>
> = {
  VACANT_LAND: {
    national: ['Construction costs and builder capacity'],
    state: ['Land release, approvals and infrastructure charges'],
    local: ['Zoning, lot sizes and development feasibility'],
  },
  RESIDENTIAL: {
    national: ['House price and rent trends'],
    state: ['House prices in the capital city and regions'],
    local: ['Demand for houses: schools, transport and lot size'],
  },
  RESIDENTIAL_UNIT: {
    national: ['Investor lending, rents and new apartment supply'],
    state: ['Apartment pipeline, off-the-plan settlements and building defect regulation'],
    local: ['Competing unit stock, strata levies and owner-occupier versus investor demand'],
  },
  COMMERCIAL_OFFICE: {
    national: ['Office vacancy, incentives and investment yields'],
    state: ['CBD and suburban office demand'],
    local: ['Competing office space, vacancy and effective rents'],
  },
  COMMERCIAL_RETAIL: {
    national: ['Retail spending and investment yields'],
    state: ['Retail trade and centre performance'],
    local: ['Strip or centre vacancy, foot traffic and tenant mix'],
  },
  INDUSTRIAL: {
    national: ['Logistics demand, vacancy and rental growth'],
    state: ['Industrial land supply and precinct demand'],
    local: ['Freight access, site cover and competing supply'],
  },
  SPECIALISED_MIXED_USE: {
    national: ['Depth of the buyer market for the use'],
    state: ['Licensing, policy and operator demand'],
    local: ['Local demand for the use and alternative uses'],
  },
};

/** What commentary at this level should cover for this property type (guidance, not a form). */
export function commentaryTopics(level: CommentaryLevel, propertyType: PropertyType): string[] {
  return [...LEVEL_TOPICS[level], ...TYPE_TOPICS[propertyType][level]];
}

const STATE_POSTCODE = new RegExp(`\\s+(?:${JURISDICTIONS.join('|')})(?:\\s+\\d{4})?\\s*$`, 'i');

/** "Exampleton VIC 3000" → "exampleton": the form library localities are compared in. */
export function normaliseLocality(name: string): string {
  return name.replace(STATE_POSTCODE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The suburb (last part of the address, without state and postcode) and council, if known. */
export function commentaryLocalities(address: string, council?: string): string[] {
  const parts = address.split(',');
  const suburb = (parts[parts.length - 1] ?? '').replace(STATE_POSTCODE, '').trim();
  return [suburb, council?.trim() ?? ''].filter(Boolean);
}

/** The heading each level of commentary appears under in the report. */
export function commentaryHeading(
  level: CommentaryLevel,
  jurisdiction: Jurisdiction,
  locality?: string,
): string {
  if (level === 'national') return 'National market';
  if (level === 'state') return `State market — ${JURISDICTION_LABELS[jurisdiction]}`;
  return locality ? `Local market — ${locality}` : 'Local market';
}

export interface CommentaryQuery {
  readonly propertyType: PropertyType;
  readonly jurisdiction: Jurisdiction;
  /** Suburb first, then council (see `commentaryLocalities`). */
  readonly localities: readonly string[];
  /** Paragraphs dated after this are never offered (no hindsight). */
  readonly valuationDate: LocalDate;
}

export interface CommentarySuggestion {
  readonly level: CommentaryLevel;
  readonly fieldId: string;
  readonly heading: string;
  /** What this level should cover for the property type. */
  readonly topics: readonly string[];
  /** Overview first, then paragraphs written for the property type. Empty when nothing fits. */
  readonly modules: readonly CommentaryModule[];
  readonly text: string;
  /** The oldest as-at date of the paragraphs used. */
  readonly asAtDate?: LocalDate;
  /** Whole months between the commentary date and the valuation date. */
  readonly ageMonths?: number;
  readonly stale: boolean;
  /** Whether a paragraph written for this property type was found. */
  readonly coversPropertyType: boolean;
  /** Plain-language notes for the valuer (gaps, dated commentary). */
  readonly notes: readonly string[];
}

function matches(m: CommentaryModule, level: CommentaryLevel, q: CommentaryQuery): boolean {
  if (m.status !== 'approved' || m.level !== level) return false;
  if (compareDates(m.asAtDate, q.valuationDate) > 0) return false;
  if (m.propertyTypes && !m.propertyTypes.includes(q.propertyType)) return false;
  if (level === 'national') return true;
  if (m.jurisdiction !== q.jurisdiction) return false;
  if (level === 'state') return true;
  const wanted = new Set(q.localities.map(normaliseLocality));
  return (m.localities ?? []).some((l) => wanted.has(normaliseLocality(l)));
}

/** Most recent version of each paragraph as at the valuation date. */
function latestVersions(modules: readonly CommentaryModule[]): CommentaryModule[] {
  const best = new Map<string, CommentaryModule>();
  for (const m of modules) {
    const prev = best.get(m.moduleId);
    if (
      !prev ||
      compareDates(m.asAtDate, prev.asAtDate) > 0 ||
      (m.asAtDate === prev.asAtDate && m.version > prev.version)
    )
      best.set(m.moduleId, m);
  }
  return [...best.values()];
}

const order = (a: CommentaryModule, b: CommentaryModule): number =>
  Number(a.propertyTypes !== undefined) - Number(b.propertyTypes !== undefined) ||
  a.moduleId.localeCompare(b.moduleId);

/**
 * The approved library paragraphs that fit a job, by level. Only paragraphs dated on or before
 * the valuation date are offered, so a retrospective valuation gets the commentary of its day.
 */
export function selectCommentary(
  library: readonly CommentaryModule[],
  q: CommentaryQuery,
  staleMonths: Readonly<Record<CommentaryLevel, number>> = COMMENTARY_STALE_MONTHS,
): CommentarySuggestion[] {
  return COMMENTARY_LEVELS.map((level) => {
    const modules = latestVersions(library.filter((m) => matches(m, level, q))).sort(order);
    const heading = commentaryHeading(level, q.jurisdiction, q.localities[0]);
    const topics = commentaryTopics(level, q.propertyType);
    const base = { level, fieldId: COMMENTARY_FIELDS[level], heading, topics };
    const typeLabel = PROPERTY_TYPE_LABELS[q.propertyType].toLowerCase();
    if (!modules.length) {
      return {
        ...base,
        modules: [],
        text: '',
        stale: false,
        coversPropertyType: false,
        notes: [
          `The library has no approved ${level} commentary for this ${level === 'local' ? 'area' : 'job'} as at ${formatAustralianDate(q.valuationDate)}. Write it for the valuation date.`,
        ],
      };
    }
    const asAtDate = modules.map((m) => m.asAtDate).sort(compareDates)[0] as LocalDate;
    const ageMonths = monthsBetween(asAtDate, q.valuationDate);
    const stale = ageMonths > staleMonths[level];
    const coversPropertyType = modules.some((m) => m.propertyTypes !== undefined);
    const notes = [
      ...(stale
        ? [
            `The latest approved ${level} commentary is as at ${formatAustralianDate(asAtDate)}, ${ageMonths} months before the valuation date. Bring it up to date.`,
          ]
        : []),
      // a suburb paragraph already speaks to the local market for the property
      ...(!coversPropertyType && level !== 'local'
        ? [`No ${level} paragraph is written for ${typeLabel}: add one or cover it yourself.`]
        : []),
    ];
    return {
      ...base,
      modules,
      text: modules.map((m) => m.text.trim()).join('\n\n'),
      asAtDate,
      ageMonths,
      stale,
      coversPropertyType,
      notes,
    };
  });
}

/** Provenance for a field filled from the library (the valuer accepted it). */
export function commentaryProvenance(
  s: CommentarySuggestion,
  acceptedBy: string,
  at: Instant,
): Provenance {
  return {
    origin: 'external_source',
    sourceId: COMMENTARY_LIBRARY_SOURCE.id,
    sourceRef: s.modules.map((m) => `${m.moduleId}@${m.version}`).join('+'),
    retrievedAt: at,
    ...(s.asAtDate ? { effectiveDate: s.asAtDate } : {}),
    licenceBasis: COMMENTARY_LIBRARY_SOURCE.licence.basis,
    verification: 'verified',
    verifiedBy: acceptedBy,
    verifiedAt: at,
    capturedBy: acceptedBy,
    capturedAt: at,
  };
}

/** The job's dated commentary record for an accepted suggestion. */
export function commentaryRecord(
  s: CommentarySuggestion,
  ctx: {
    readonly id: string;
    readonly assetId?: string;
    readonly by: string;
    readonly at: Instant;
  },
): MarketCommentary {
  if (!s.asAtDate) throw new Error(`no library commentary to accept for ${s.level}`);
  const seen = new Set<string>();
  return {
    id: ctx.id,
    level: s.level,
    ...(s.level === 'local' && ctx.assetId ? { assetId: ctx.assetId } : {}),
    asAtDate: s.asAtDate,
    text: s.text,
    authoredBy: ctx.by,
    authoredAt: ctx.at,
    sources: s.modules
      .flatMap((m) => m.sources)
      .filter((p) => {
        const key = `${p.sourceId ?? ''}|${p.sourceRef ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    library: s.modules.map((m) => ({ moduleId: m.moduleId, version: m.version })),
  };
}

/** The dated note printed under commentary in the report. */
export function commentaryNote(c: MarketCommentary): string {
  const sources = [...new Set(c.sources.map((s) => s.sourceRef).filter(Boolean))];
  return `Commentary as at ${formatAustralianDate(c.asAtDate)}.${sources.length ? ` Sources: ${sources.join('; ')}.` : ''}`;
}

/** Problems that stop a library paragraph being saved or approved. */
export function commentaryModuleProblems(m: CommentaryModule): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(m.moduleId))
    problems.push('the paragraph id must be 3–64 lower-case letters, digits or hyphens');
  if (!Number.isInteger(m.version) || m.version < 1)
    problems.push('the version must be a whole number from 1');
  if (!m.title.trim()) problems.push('give the paragraph a title');
  if (!isLocalDate(m.asAtDate)) problems.push('the as-at date must be a calendar date');
  if (m.text.trim().length < 80) problems.push('the paragraph is too short to be useful');
  if (m.level === 'national' && m.jurisdiction)
    problems.push('national commentary is not tied to a state');
  if (m.level !== 'national' && !m.jurisdiction)
    problems.push(`${m.level} commentary needs a state or territory`);
  if (m.level === 'local' && !m.localities?.length)
    problems.push('local commentary needs at least one suburb, town or council');
  if (m.level !== 'local' && m.localities?.length)
    problems.push('only local commentary lists suburbs or councils');
  if (m.propertyTypes && !m.propertyTypes.length)
    problems.push('leave property types out for an overview, or list at least one');
  if (!m.sources.length) problems.push('name at least one source');
  for (const s of m.sources)
    for (const issue of checkProvenance(s)) problems.push(`source: ${issue.message}`);
  return problems;
}
