import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { SocialCommentAttachmentStore } from '../application/social-comment-attachment-store.port.js';
import type { AttachmentRow } from '../application/social-store.port.js';
import { TenantQueryRunner } from './group-sql-support.js';
import { ATTACHMENT_COLUMNS, mapAttachment, type AttachmentRecord } from './postgres-social-store.js';

export class PostgresSocialCommentAttachmentStore implements SocialCommentAttachmentStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  forComments(
    tenantId: string,
    commentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly AttachmentRow[]>> {
    const map = new Map<string, AttachmentRow[]>();
    if (commentIds.length === 0) return Promise.resolve(map);
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<AttachmentRecord>(
        `SELECT ${ATTACHMENT_COLUMNS}
           FROM social_schema.attachments a
          WHERE a.comment_id = ANY($1::uuid[]) AND a.completed_at IS NOT NULL
          ORDER BY a.created_at, a.id`,
        [commentIds],
      );
      for (const row of result.rows) {
        const key = row.comment_id as string;
        map.set(key, [...(map.get(key) ?? []), mapAttachment(row)]);
      }
      return map;
    });
  }

  detach(tenantId: string, commentId: string, keepIds: readonly string[]): Promise<AttachmentRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<AttachmentRecord>(
        `UPDATE social_schema.attachments a
            SET comment_id = NULL
          WHERE a.comment_id = $1 AND NOT (a.id = ANY($2::uuid[]))
        RETURNING ${ATTACHMENT_COLUMNS}`,
        [commentId, keepIds],
      );
      return result.rows.map(mapAttachment);
    });
  }
}
