import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { seedDemo } from './db/seed.js';

const config = loadConfig(process.env);
const db = await openDb(config.databaseUrl, config.databaseSsl);
await migrate(db);
if (config.env !== 'production' && config.databaseUrl.startsWith('pglite://memory')) {
  // Ephemeral local database: load the demo organisation so the API is explorable.
  await seedDemo(db);
}
const { app } = await buildApp({ config, db, logger: true });
const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await app.listen({ host: config.host, port: config.port });
