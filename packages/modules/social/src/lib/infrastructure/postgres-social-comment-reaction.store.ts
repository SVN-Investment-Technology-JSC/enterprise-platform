import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { SocialReactionType } from '@enterprise-platform/contracts-social';
import type { SocialCommentReactionStore } from '../application/social-comment-reaction-store.port.js';
import type { ReactionSummaryRow, ReactorRow } from '../application/social-store.port.js';
import { TenantQueryRunner, isoColumn } from './group-sql-support.js';

export class PostgresSocialCommentReactionStore implements SocialCommentReactionStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  set(tenantId: string, commentId: string, userId: string, type: SocialReactionType): Promise<void> {
    return this.runner.run(tenantId, async (pool) => {
      await pool.query(
        `INSERT INTO social_schema.comment_reactions (comment_id, user_id, type)
         VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, user_id)
         DO UPDATE SET type = EXCLUDED.type, reacted_at = now()`,
        [commentId, userId, type],
      );
    });
  }

  remove(tenantId: string, commentId: string, userId: string): Promise<void> {
    return this.runner.run(tenantId, async (pool) => {
      await pool.query(`DELETE FROM social_schema.comment_reactions WHERE comment_id = $1 AND user_id = $2`, [
        commentId,
        userId,
      ]);
    });
  }

  list(tenantId: string, commentId: string, limit: number): Promise<ReactorRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<{ user_id: string; type: SocialReactionType; reacted_at: string }>(
        `SELECT user_id, type, ${isoColumn('reacted_at')} AS reacted_at
           FROM social_schema.comment_reactions
          WHERE comment_id = $1
          ORDER BY reacted_at DESC, user_id
          LIMIT $2`,
        [commentId, limit],
      );
      return result.rows.map((row) => ({ userId: row.user_id, type: row.type, reactedAt: row.reacted_at }));
    });
  }

  summaries(
    tenantId: string,
    commentIds: readonly string[],
    viewerId: string,
  ): Promise<ReadonlyMap<string, ReactionSummaryRow>> {
    const result = new Map<string, ReactionSummaryRow>();
    if (commentIds.length === 0) return Promise.resolve(result);
    return this.runner.run(tenantId, async (pool) => {
      const [counts, mine] = await Promise.all([
        pool.query<{ comment_id: string; type: SocialReactionType; n: number }>(
          `SELECT comment_id, type, count(*)::int AS n
             FROM social_schema.comment_reactions
            WHERE comment_id = ANY($1::uuid[])
            GROUP BY comment_id, type`,
          [commentIds],
        ),
        pool.query<{ comment_id: string; type: SocialReactionType }>(
          `SELECT comment_id, type FROM social_schema.comment_reactions
            WHERE comment_id = ANY($1::uuid[]) AND user_id = $2`,
          [commentIds, viewerId],
        ),
      ]);
      const grouped = new Map<string, Partial<Record<SocialReactionType, number>>>();
      for (const row of counts.rows) {
        grouped.set(row.comment_id, { ...(grouped.get(row.comment_id) ?? {}), [row.type]: row.n });
      }
      const own = new Map(mine.rows.map((row) => [row.comment_id, row.type]));
      for (const id of commentIds) {
        const byType = grouped.get(id) ?? {};
        const total = Object.values(byType).reduce((sum, value) => sum + (value ?? 0), 0);
        const mineType = own.get(id);
        result.set(id, { counts: byType, total, ...(mineType ? { mine: mineType } : {}) });
      }
      return result;
    });
  }
}
