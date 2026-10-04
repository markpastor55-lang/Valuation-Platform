import type { CommentaryModule } from '@vp/domain';
import type { Db } from '../db/db.js';

/** Stores a version of a library paragraph; the columns repeat what lookups filter on. */
export async function insertCommentaryModule(
  db: Db,
  orgId: string,
  id: string,
  m: CommentaryModule,
): Promise<void> {
  await db.query(
    `INSERT INTO commentary_module (id, org_id, module_id, version, level, jurisdiction, as_at_date, status, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      orgId,
      m.moduleId,
      m.version,
      m.level,
      m.jurisdiction ?? null,
      m.asAtDate,
      m.status,
      JSON.stringify(m),
    ],
  );
}
