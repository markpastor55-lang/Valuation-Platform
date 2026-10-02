import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  DEFAULT_CONNECTOR_POLICY,
  PLANNING_ADAPTER_PLAN,
  PermanentConnectorError,
  RateLimiter,
  callWithPolicy,
  createConnectorRuntime,
  lookupPlanning,
  manualPlanningResult,
  type Clock,
  type PlanningAdapter,
  type PlanningControlResult,
} from '../src/index.js';
import { NOW, planningSource } from './fixtures.js';

/**
 * Deterministic clock. Backoff sleeps advance time instantly and are recorded; timeout timers
 * (sleeps with an abort signal) fire on the next macrotask, after any already-settled call.
 */
function fakeClock(start = 0): Clock & { slept: number[] } {
  let t = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: (ms, signal) => {
      if (signal) return new Promise((resolve) => setTimeout(resolve, 0));
      slept.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

const ctx = { userId: 'valuer1', now: NOW };
const good: PlanningControlResult = {
  zone: { code: 'GRZ1', name: 'General Residential Zone – Schedule 1' },
  overlays: [{ code: 'SBO', name: 'Special Building Overlay' }],
  provenance: {
    origin: 'external_source',
    sourceId: 'ds-vicplan',
    retrievedAt: NOW,
    effectiveDate: '2026-10-02',
    licenceBasis: 'open_licence',
    verification: 'unverified',
    capturedBy: 'valuer1',
    capturedAt: NOW,
  },
};
const adapter = (impl: () => Promise<PlanningControlResult>): PlanningAdapter => ({
  id: 'vic-test',
  jurisdiction: 'VIC',
  dataSourceId: 'ds-vicplan',
  capabilities: ['zone', 'overlays'],
  lookup: impl,
});

describe('connector policy', () => {
  it('retries transient failures with exponential backoff', async () => {
    const clock = fakeClock();
    let calls = 0;
    const rt = createConnectorRuntime(
      { ...DEFAULT_CONNECTOR_POLICY, maxRetries: 2, backoffMs: 100, timeoutMs: 1e9 },
      clock,
    );
    const r = await callWithPolicy(async () => {
      calls++;
      if (calls < 3) throw new Error('503');
      return 'ok';
    }, rt);
    expect(r).toEqual({ ok: true, value: 'ok', attempts: 3 });
    expect(clock.slept).toEqual([100, 200]);
  });

  it('does not retry permanent errors and returns a manual fallback', async () => {
    const rt = createConnectorRuntime(DEFAULT_CONNECTOR_POLICY, fakeClock());
    const r = await callWithPolicy(
      () => Promise.reject(new PermanentConnectorError('licence refused')),
      rt,
    );
    expect(r).toMatchObject({ ok: false, error: 'failed', attempts: 1, fallback: 'manual_entry' });
  });

  it('times out slow calls', async () => {
    const rt = createConnectorRuntime(
      { ...DEFAULT_CONNECTOR_POLICY, maxRetries: 0, timeoutMs: 50 },
      fakeClock(),
    );
    const r = await callWithPolicy(() => new Promise<string>(() => undefined), rt);
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('opens the circuit after repeated failures and half-opens after the reset period', () => {
    const b = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 1000 });
    b.recordFailure(0);
    expect(b.canRequest(1)).toBe(true);
    b.recordFailure(2);
    expect(b.state(3)).toBe('open');
    expect(b.state(1002)).toBe('half_open');
    b.recordSuccess();
    expect(b.state(1003)).toBe('closed');
  });

  it('rate-limits within a sliding minute', () => {
    const l = new RateLimiter(2);
    expect([l.tryAcquire(0), l.tryAcquire(1), l.tryAcquire(2)]).toEqual([true, true, false]);
    expect(l.tryAcquire(60_001)).toBe(true);
  });
});

describe('planning lookup', () => {
  it('returns a provenance-complete result', async () => {
    const r = await lookupPlanning(
      adapter(() => Promise.resolve(good)),
      { jurisdiction: 'VIC', address: '10 Sample Road' },
      ctx,
      createConnectorRuntime(DEFAULT_CONNECTOR_POLICY, fakeClock()),
    );
    expect(r).toMatchObject({ status: 'found', result: { zone: { code: 'GRZ1' } } });
  });

  it('falls back to manual entry on outage or incomplete provenance', async () => {
    const rt = () =>
      createConnectorRuntime(
        { ...DEFAULT_CONNECTOR_POLICY, maxRetries: 1, backoffMs: 1 },
        fakeClock(),
      );
    const outage = await lookupPlanning(
      adapter(() => Promise.reject(new Error('ECONNRESET'))),
      { jurisdiction: 'VIC' },
      ctx,
      rt(),
    );
    expect(outage).toMatchObject({ status: 'manual_fallback', attempts: 2 });
    const { licenceBasis: _omit, ...noLicence } = good.provenance;
    const incomplete = await lookupPlanning(
      adapter(() => Promise.resolve({ ...good, provenance: noLicence })),
      { jurisdiction: 'VIC' },
      ctx,
      rt(),
    );
    expect(incomplete).toMatchObject({
      status: 'manual_fallback',
      reason: expect.stringContaining('licenceBasis'),
    });
  });

  it('refuses to use an adapter for another jurisdiction', async () => {
    await expect(
      lookupPlanning(
        adapter(() => Promise.resolve(good)),
        { jurisdiction: 'NSW' },
        ctx,
        createConnectorRuntime(),
      ),
    ).rejects.toThrow(/serves VIC/);
  });

  it('builds manual results from an uploaded planning document', () => {
    const r = manualPlanningResult(
      {
        zone: { code: 'R2', name: 'Low Density Residential' },
        documentRef: 'doc-cert',
        documentDate: '2026-09-01',
        source: planningSource,
      },
      ctx,
    );
    expect(r.provenance).toMatchObject({
      origin: 'client_supplied',
      sourceRef: 'doc-cert',
      effectiveDate: '2026-09-01',
    });
  });

  it('has a plan for every jurisdiction', () => {
    expect(Object.keys(PLANNING_ADAPTER_PLAN).sort()).toEqual([
      'ACT',
      'NSW',
      'NT',
      'QLD',
      'SA',
      'TAS',
      'VIC',
      'WA',
    ]);
  });
});
