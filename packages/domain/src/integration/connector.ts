import { DomainError } from '../core/errors.js';

/**
 * Resilience policy applied to every external connector (geocoding, title, planning, hazards,
 * sales/rental data, cost data, e-signature, email, accounting). Outages never block field work:
 * they produce a manual-fallback task.
 */
export interface ConnectorPolicy {
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Base delay for exponential backoff (delay = base × 2^attempt). */
  readonly backoffMs: number;
  readonly rateLimitPerMinute: number;
  readonly circuitBreaker: { readonly failureThreshold: number; readonly resetAfterMs: number };
  /** Data older than this is stale (VAL-STALE-002). */
  readonly freshnessDays: number;
  readonly manualFallback: true;
}

export const DEFAULT_CONNECTOR_POLICY: ConnectorPolicy = {
  timeoutMs: 10_000,
  maxRetries: 2,
  backoffMs: 500,
  rateLimitPerMinute: 60,
  circuitBreaker: { failureThreshold: 5, resetAfterMs: 60_000 },
  freshnessDays: 90,
  manualFallback: true,
};

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or early (without error) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    }),
};

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(private readonly config: ConnectorPolicy['circuitBreaker']) {}

  state(now: number): 'closed' | 'open' | 'half_open' {
    if (this.openedAt === null) return 'closed';
    return now - this.openedAt >= this.config.resetAfterMs ? 'half_open' : 'open';
  }

  canRequest(now: number): boolean {
    return this.state(now) !== 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(now: number): void {
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold || this.openedAt !== null)
      this.openedAt = now;
  }
}

/** Sliding one-minute window rate limiter. */
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(private readonly perMinute: number) {}

  tryAcquire(now: number): boolean {
    while (this.stamps.length && now - (this.stamps[0] as number) >= 60_000) this.stamps.shift();
    if (this.stamps.length >= this.perMinute) return false;
    this.stamps.push(now);
    return true;
  }
}

export type ConnectorFailure = 'timeout' | 'circuit_open' | 'rate_limited' | 'failed';

export type ConnectorResult<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number }
  | {
      readonly ok: false;
      readonly error: ConnectorFailure;
      readonly message: string;
      readonly attempts: number;
      readonly fallback: 'manual_entry';
    };

export class ConnectorTimeoutError extends Error {
  constructor(ms: number) {
    super(`connector timed out after ${ms} ms`);
    this.name = 'ConnectorTimeoutError';
  }
}

/** Errors a connector marks as permanent (bad request, licence refused) are not retried. */
export class PermanentConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentConnectorError';
  }
}

export interface ConnectorRuntime {
  readonly policy: ConnectorPolicy;
  readonly breaker: CircuitBreaker;
  readonly limiter: RateLimiter;
  readonly clock: Clock;
}

export function createConnectorRuntime(
  policy: ConnectorPolicy = DEFAULT_CONNECTOR_POLICY,
  clock: Clock = systemClock,
): ConnectorRuntime {
  if (policy.maxRetries < 0 || policy.timeoutMs <= 0)
    throw new DomainError('INVALID_ARGUMENT', 'invalid connector policy');
  return {
    policy,
    breaker: new CircuitBreaker(policy.circuitBreaker),
    limiter: new RateLimiter(policy.rateLimitPerMinute),
    clock,
  };
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  clock: Clock,
): Promise<T> {
  const call = new AbortController();
  const timer = new AbortController();
  const timeout = clock.sleep(ms, timer.signal).then((): never => {
    if (!timer.signal.aborted) call.abort();
    throw new ConnectorTimeoutError(ms);
  });
  try {
    return await Promise.race([fn(call.signal), timeout]);
  } finally {
    timer.abort();
    timeout.catch(() => undefined);
  }
}

/** Calls a connector with timeout, retries with exponential backoff, rate limiting and a circuit breaker. */
export async function callWithPolicy<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  rt: ConnectorRuntime,
): Promise<ConnectorResult<T>> {
  const { policy, breaker, limiter, clock } = rt;
  let attempts = 0;
  let lastError: ConnectorFailure = 'failed';
  let lastMessage = '';
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    const now = clock.now();
    if (!breaker.canRequest(now)) {
      return {
        ok: false,
        error: 'circuit_open',
        message: 'connector circuit is open',
        attempts,
        fallback: 'manual_entry',
      };
    }
    if (!limiter.tryAcquire(now)) {
      return {
        ok: false,
        error: 'rate_limited',
        message: 'connector rate limit reached',
        attempts,
        fallback: 'manual_entry',
      };
    }
    attempts++;
    try {
      const value = await withTimeout(fn, policy.timeoutMs, clock);
      breaker.recordSuccess();
      return { ok: true, value, attempts };
    } catch (err) {
      breaker.recordFailure(clock.now());
      lastError = err instanceof ConnectorTimeoutError ? 'timeout' : 'failed';
      lastMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof PermanentConnectorError) break;
      if (attempt < policy.maxRetries) await clock.sleep(policy.backoffMs * 2 ** attempt);
    }
  }
  return { ok: false, error: lastError, message: lastMessage, attempts, fallback: 'manual_entry' };
}
