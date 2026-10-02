import type { Actor } from '../core/actor.js';
import type { Json } from '../core/canonical-json.js';
import type { Instant } from '../core/dates.js';
import { DomainError } from '../core/errors.js';
import type { Provenance } from '../core/provenance.js';

/**
 * What image models may suggest. Anything not on these allowlists is refused at the boundary,
 * including the prohibited categories in the brief: concealed construction, operational
 * condition, brand, compliance, dimensions and defects cannot be inferred from an image alone.
 */
export const ROOM_TYPES = [
  'kitchen',
  'bathroom',
  'ensuite',
  'laundry',
  'bedroom',
  'living',
  'dining',
  'study',
  'garage',
  'carport',
  'facade',
  'streetscape',
  'rear_yard',
  'pool_area',
  'balcony',
  'office',
  'warehouse',
  'amenities',
  'plant_room',
  'retail_floor',
  'roof_exterior',
] as const;

export const VISIBLE_ATTRIBUTES = [
  'induction_cooktop',
  'gas_cooktop',
  'electric_cooktop',
  'oven',
  'rangehood',
  'dishwasher',
  'stone_benchtop',
  'laminate_benchtop',
  'timber_benchtop',
  'island_bench',
  'timber_flooring',
  'carpet',
  'tiled_floor',
  'vinyl_flooring',
  'split_system_air_conditioner',
  'ceiling_fan',
  'ducted_vents_visible',
  'solar_panels_visible',
  'swimming_pool',
  'roller_door',
  'mezzanine_visible',
  'racking_visible',
  'built_in_wardrobe',
  'shower_over_bath',
  'separate_shower',
  'freestanding_bath',
  'double_vanity',
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];
export type VisibleAttribute = (typeof VISIBLE_ATTRIBUTES)[number];

export const PROHIBITED_INFERENCE_CATEGORIES = [
  'concealed_construction',
  'operational_condition',
  'brand',
  'compliance',
  'dimensions',
  'defects',
] as const;
export type ProhibitedInference = (typeof PROHIBITED_INFERENCE_CATEGORIES)[number];

/** Defence in depth: free-text labels that would imply a prohibited inference. */
const PROHIBITED_PATTERNS: readonly [ProhibitedInference, RegExp][] = [
  [
    'concealed_construction',
    /\b(frame|framing|insulat\w*|wiring|plumbing|footing|slab|stud|cavity|concealed)\b/i,
  ],
  [
    'operational_condition',
    /\b(working|functional|operational|operable|in good order|serviceable)\b/i,
  ],
  ['brand', /\b(brand|make|manufacturer|model\s*no)\b/i],
  ['compliance', /\b(complian\w*|complies|certified|approved|permit\w*|code|standard)\b/i],
  [
    'dimensions',
    /\b(\d+(\.\d+)?\s*(m|mm|cm|m2|m²|sqm|metres?|meters?|ft)|dimension\w*|width|length|height)\b/i,
  ],
  [
    'defects',
    /\b(defect\w*|crack\w*|leak\w*|damp|mould|mold|termite\w*|asbestos|rot|subsidence|structural)\b/i,
  ],
];

export type SuggestionKind =
  'room_classification' | 'visible_attribute' | 'sketch_outline' | 'room_label';

export interface AiModelRef {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface AiSuggestion {
  readonly id: string;
  readonly assetId: string;
  readonly kind: SuggestionKind;
  /** Source evidence: a photo for classifications, a source plan for sketch outlines. */
  readonly photoId?: string;
  readonly sourcePlanId?: string;
  /** Taxonomy id (room type or attribute) or a room label for sketches. */
  readonly label: string;
  /** Structured payload, e.g. outline points for `sketch_outline`. */
  readonly value?: Json;
  readonly confidence: number;
  readonly model: AiModelRef;
  readonly createdAt: Instant;
  readonly status: SuggestionStatus;
  readonly decision?: {
    readonly by: string;
    readonly at: Instant;
    readonly editedLabel?: string;
    readonly editedValue?: Json;
    readonly reason?: string;
  };
}

function prohibitedCategory(label: string): ProhibitedInference | undefined {
  return PROHIBITED_PATTERNS.find(([, re]) => re.test(label.replaceAll('_', ' ')))?.[0];
}

function assertAllowedLabel(kind: SuggestionKind, label: string): void {
  const prohibited = prohibitedCategory(label);
  if (prohibited) {
    throw new DomainError(
      'AI_INFERENCE_PROHIBITED',
      `"${label}" implies ${prohibited.replace('_', ' ')}, which cannot be inferred from an image`,
      {
        category: prohibited,
      },
    );
  }
  const allowed =
    kind === 'room_classification'
      ? (ROOM_TYPES as readonly string[]).includes(label)
      : kind === 'visible_attribute'
        ? (VISIBLE_ATTRIBUTES as readonly string[]).includes(label)
        : label.trim().length > 0 && label.length <= 60;
  if (!allowed) {
    throw new DomainError(
      'AI_INFERENCE_PROHIBITED',
      `"${label}" is not an allowed ${kind.replace('_', ' ')}`,
    );
  }
}

/** Validates and records a model suggestion. Suggestions are never facts. */
export function createAiSuggestion(input: Omit<AiSuggestion, 'status' | 'decision'>): AiSuggestion {
  if (!(input.confidence >= 0 && input.confidence <= 1)) {
    throw new DomainError('INVALID_ARGUMENT', 'confidence must be between 0 and 1');
  }
  if (
    (input.kind === 'room_classification' || input.kind === 'visible_attribute') &&
    !input.photoId
  ) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'photo suggestions must reference their source photo',
    );
  }
  if (input.kind === 'sketch_outline' && !input.sourcePlanId) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      'outline suggestions must reference their source plan',
    );
  }
  assertAllowedLabel(input.kind, input.label);
  return { ...input, status: 'pending' };
}

/** A fact accepted by a person from an AI suggestion, carrying author, time and photo provenance. */
export interface AcceptedFact {
  readonly id: string;
  readonly assetId: string;
  readonly kind: SuggestionKind;
  readonly label: string;
  readonly value?: Json;
  readonly suggestionId: string;
  readonly model: AiModelRef;
  readonly provenance: Provenance;
}

export interface SuggestionDecision {
  readonly decision: 'accept' | 'edit' | 'reject';
  readonly actor: Actor;
  readonly at: Instant;
  readonly factId?: string;
  readonly editedLabel?: string;
  readonly editedValue?: Json;
  readonly reason?: string;
}

/**
 * The only path from a suggestion to a fact. Requires a human decision; confidence never
 * auto-accepts. Rejections produce no fact.
 */
export function decideAiSuggestion(
  suggestion: AiSuggestion,
  d: SuggestionDecision,
): { suggestion: AiSuggestion; fact?: AcceptedFact } {
  if (d.actor.kind !== 'human') {
    throw new DomainError(
      'HUMAN_ACTOR_REQUIRED',
      'AI suggestions must be accepted, edited or rejected by a person',
    );
  }
  if (suggestion.status !== 'pending')
    throw new DomainError('GUARD_FAILED', `suggestion already ${suggestion.status}`);

  if (d.decision === 'reject') {
    return {
      suggestion: {
        ...suggestion,
        status: 'rejected',
        decision: { by: d.actor.userId, at: d.at, ...(d.reason ? { reason: d.reason } : {}) },
      },
    };
  }
  if (!d.factId) throw new DomainError('INVALID_ARGUMENT', 'a fact id is required when accepting');
  const label = d.decision === 'edit' ? (d.editedLabel ?? suggestion.label) : suggestion.label;
  const value =
    d.decision === 'edit' && d.editedValue !== undefined ? d.editedValue : suggestion.value;
  if (d.decision === 'edit') {
    if (d.editedLabel === undefined && d.editedValue === undefined) {
      throw new DomainError('INVALID_ARGUMENT', 'an edit must change the label or value');
    }
    assertAllowedLabel(suggestion.kind, label);
  }
  const status = d.decision === 'edit' ? 'edited' : 'accepted';
  const fact: AcceptedFact = {
    id: d.factId,
    assetId: suggestion.assetId,
    kind: suggestion.kind,
    label,
    ...(value !== undefined ? { value } : {}),
    suggestionId: suggestion.id,
    model: suggestion.model,
    provenance: {
      origin: d.decision === 'edit' ? 'ai_suggestion_edited' : 'ai_suggestion_accepted',
      sourceRef: suggestion.photoId
        ? `photo:${suggestion.photoId}`
        : `plan:${suggestion.sourcePlanId ?? ''}`,
      verification: 'verified',
      verifiedBy: d.actor.userId,
      verifiedAt: d.at,
      confidence: suggestion.confidence,
      capturedBy: d.actor.userId,
      capturedAt: d.at,
    },
  };
  return {
    suggestion: {
      ...suggestion,
      status,
      decision: {
        by: d.actor.userId,
        at: d.at,
        ...(d.editedLabel !== undefined ? { editedLabel: d.editedLabel } : {}),
        ...(d.editedValue !== undefined ? { editedValue: d.editedValue } : {}),
        ...(d.reason ? { reason: d.reason } : {}),
      },
    },
    fact,
  };
}
