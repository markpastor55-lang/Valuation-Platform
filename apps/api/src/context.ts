import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import type { Authenticator } from './auth/auth.js';
import type { Db } from './db/db.js';
import type { EmailTransport } from './services/email.js';

export interface Clock {
  /** Current instant as ISO-8601 UTC. */
  now(): string;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };

export interface AppContext {
  readonly config: AppConfig;
  readonly db: Db;
  readonly auth: Authenticator;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly email: EmailTransport;
}

export const uuid = (): string => randomUUID();
