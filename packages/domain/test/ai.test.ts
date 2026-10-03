import { describe, expect, it } from 'vitest';
import {
  createAiSuggestion,
  decideAiSuggestion,
  type Actor,
  type AiSuggestion,
} from '../src/index.js';

const at = '2026-10-02T00:00:00Z';
const model = { provider: 'example', model: 'room-classifier', version: '2026.09' };
const person: Actor = {
  kind: 'human',
  userId: 'inspector1',
  orgId: 'org1',
  roles: ['FIELD_INSPECTOR'],
};

const suggest = (label: string, over: Partial<AiSuggestion> = {}) =>
  createAiSuggestion({
    id: 's1',
    assetId: 'a1',
    kind: 'visible_attribute',
    photoId: 'p1',
    label,
    confidence: 0.93,
    model,
    createdAt: at,
    ...over,
  });

describe('AI suggestion boundary', () => {
  it('accepts allowlisted room types and visible attributes as pending suggestions', () => {
    expect(suggest('induction_cooktop').status).toBe('pending');
    expect(suggest('kitchen', { kind: 'room_classification' }).status).toBe('pending');
  });

  it.each([
    ['brand', 'Bosch brand oven'],
    ['compliance', 'compliant balustrade'],
    ['defects', 'cracked render'],
    ['defects', 'rising damp'],
    ['operational_condition', 'working dishwasher'],
    ['concealed_construction', 'timber frame'],
    ['dimensions', '3.6 m wide bedroom'],
  ])('refuses %s inferences (%s)', (category, label) => {
    expect(() => suggest(label)).toThrow(
      expect.objectContaining({ code: 'AI_INFERENCE_PROHIBITED', details: { category } }),
    );
  });

  it('refuses labels outside the allowlist', () => {
    expect(() => suggest('marble_palace')).toThrow(/not an allowed visible attribute/);
  });

  it('requires source evidence and a valid confidence', () => {
    expect(() => suggest('oven', { photoId: undefined as unknown as string })).toThrow(
      /source photo/,
    );
    expect(() => suggest('oven', { confidence: 1.2 })).toThrow(/confidence/);
    expect(() =>
      createAiSuggestion({
        id: 'x',
        assetId: 'a1',
        kind: 'sketch_outline',
        label: 'Living area',
        confidence: 0.5,
        model,
        createdAt: at,
      }),
    ).toThrow(/source plan/);
  });
});

describe('human decisions', () => {
  it('produces a fact with author, time, photo provenance and model only on acceptance', () => {
    const { suggestion, fact } = decideAiSuggestion(suggest('stone_benchtop'), {
      decision: 'accept',
      actor: person,
      at,
      factId: 'f1',
    });
    expect(suggestion.status).toBe('accepted');
    expect(fact).toMatchObject({
      label: 'stone_benchtop',
      suggestionId: 's1',
      model,
      provenance: {
        origin: 'ai_suggestion_accepted',
        sourceRef: 'photo:p1',
        capturedBy: 'inspector1',
        capturedAt: at,
        confidence: 0.93,
      },
    });
  });

  it('never accepts on confidence alone or by an AI/system actor', () => {
    for (const kind of ['ai', 'system'] as const) {
      expect(() =>
        decideAiSuggestion(suggest('oven', { confidence: 1 }), {
          decision: 'accept',
          actor: { ...person, kind },
          at,
          factId: 'f',
        }),
      ).toThrow(/by a person/);
    }
  });

  it('edits keep within the taxonomy and record the edit', () => {
    const { suggestion, fact } = decideAiSuggestion(suggest('gas_cooktop'), {
      decision: 'edit',
      actor: person,
      at,
      factId: 'f2',
      editedLabel: 'induction_cooktop',
    });
    expect(suggestion).toMatchObject({
      status: 'edited',
      decision: { editedLabel: 'induction_cooktop' },
    });
    expect(fact?.provenance.origin).toBe('ai_suggestion_edited');
    expect(() =>
      decideAiSuggestion(suggest('gas_cooktop'), {
        decision: 'edit',
        actor: person,
        at,
        factId: 'f3',
        editedLabel: 'Miele brand cooktop',
      }),
    ).toThrow(/brand/);
  });

  it('rejection produces no fact and decisions are final', () => {
    const r = decideAiSuggestion(suggest('oven'), {
      decision: 'reject',
      actor: person,
      at,
      reason: 'It is a microwave',
    });
    expect(r.fact).toBeUndefined();
    expect(r.suggestion.status).toBe('rejected');
    expect(() =>
      decideAiSuggestion(r.suggestion, { decision: 'accept', actor: person, at, factId: 'f' }),
    ).toThrow(/already rejected/);
  });
});
