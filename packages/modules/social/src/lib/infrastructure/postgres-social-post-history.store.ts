import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { PostEditRecord, SocialPostHistoryStore } from '../application/social-post-history-store.port.js';
import { TenantQueryRunner, isoColumn } from './group-sql-support.js';

interface EditRecord {
  version: number;
  title: string | null;
  body_html: string;
  edited_by: string;
  edited_at: string;
}

/** Đọc lịch sử sửa bài (`post_edits`) trên DB của tenant. Ghi nằm trong `PostgresSocialPublishingStore.update`. */
export class PostgresSocialPostHistoryStore implements SocialPostHistoryStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  list(tenantId: string, postId: string): Promise<PostEditRecord[]> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<EditRecord>(
        `SELECT version, title, body_html, edited_by, ${isoColumn('edited_at')} AS edited_at
           FROM social_schema.post_edits
          WHERE post_id = $1
          ORDER BY version DESC
          LIMIT 50`,
        [postId],
      );
      return result.rows.map((row) => ({
        version: row.version,
        ...(row.title ? { title: row.title } : {}),
        bodyHtml: row.body_html,
        editedBy: row.edited_by,
        editedAt: row.edited_at,
      }));
    });
  }
}
