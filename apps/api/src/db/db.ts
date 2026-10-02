import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface QueryResult<T> {
  readonly rows: T[];
}

/** Minimal database interface shared by PostgreSQL (production) and PGlite (tests, local dev). */
export interface Db {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  /** Runs a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgDb implements Db {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, ssl?: boolean) {
    this.pool = new pg.Pool({
      connectionString,
      ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    });
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx = new PgClientTx(client);
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type PgliteTx = Parameters<Parameters<PGlite['transaction']>[0]>[0];

/** A pooled client inside BEGIN … COMMIT; nested `transaction` calls join the outer one. */
class PgClientTx implements Db {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return { rows: (await this.client.query(sql, params as unknown[])).rows as T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class PgliteTxDb implements Db {
  constructor(private readonly tx: PgliteTx) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return { rows: (await this.tx.query<T>(sql, params as unknown[])).rows };
  }

  async exec(sql: string): Promise<void> {
    await this.tx.exec(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PgliteDb implements Db {
  private constructor(private readonly db: PGlite) {}

  static async create(dataDir?: string): Promise<PgliteDb> {
    const db = dataDir ? new PGlite(dataDir) : new PGlite();
    await db.waitReady;
    return new PgliteDb(db);
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.db.query<T>(sql, params as unknown[]);
    return { rows: r.rows };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction((t: PgliteTx) => fn(new PgliteTxDb(t)));
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/** `postgres://…` uses a pool; `pglite://memory` or `pglite:///path` runs embedded PostgreSQL. */
export async function openDb(url: string, ssl = false): Promise<Db> {
  if (url.startsWith('pglite://')) {
    const path = url.slice('pglite://'.length);
    return PgliteDb.create(path === 'memory' || path === '' ? undefined : path);
  }
  return new PgDb(url, ssl);
}
