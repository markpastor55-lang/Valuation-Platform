import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({
      version: Number(file.slice(0, 4)),
      name: file.replace(/\.sql$/, ''),
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length) throw new Error('duplicate migration version');
  return migrations;
}

export class MigrationDriftError extends Error {
  constructor(name: string) {
    super(
      `migration ${name} has changed since it was applied; add a new migration instead of editing it`,
    );
    this.name = 'MigrationDriftError';
  }
}

/**
 * Applies pending migrations in order, each in its own transaction, and refuses to run if an
 * applied migration's checksum no longer matches its file (schema drift).
 */
export async function migrate(
  db: Db,
  migrations?: readonly Migration[],
): Promise<{ applied: string[] }> {
  const all = migrations ?? (await loadMigrations());
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version integer PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migration ORDER BY version',
  );
  const appliedByVersion = new Map(rows.map((r) => [r.version, r]));
  for (const m of all) {
    const existing = appliedByVersion.get(m.version);
    if (existing && existing.checksum !== m.checksum) throw new MigrationDriftError(m.name);
  }
  const applied: string[] = [];
  for (const m of all) {
    if (appliedByVersion.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)', [
        m.version,
        m.name,
        m.checksum,
      ]);
    });
    applied.push(m.name);
  }
  return { applied };
}
