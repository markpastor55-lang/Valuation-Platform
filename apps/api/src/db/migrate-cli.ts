import { loadConfig } from '../config.js';
import { openDb } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig(process.env);
const db = await openDb(config.databaseUrl, config.databaseSsl);
try {
  const { applied } = await migrate(db);
  process.stdout.write(applied.length ? `applied: ${applied.join(', ')}\n` : 'schema up to date\n');
} finally {
  await db.close();
}
