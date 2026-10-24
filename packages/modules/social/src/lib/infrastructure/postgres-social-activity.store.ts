import { PostgresPoolRegistry, TenantDatabaseRegistry, inTransaction } from '@enterprise-platform/adapter-database';
import { SOCIAL_EVENT_TYPES, type SocialPostPublishedPayload } from '@enterprise-platform/contracts-social';
import type { ActivityPostInsert, SocialActivityStore } from '../application/social-activity-store.port.js';
import { DiscoveryQueryRunner, writeOutboxEvent } from './discovery-sql.js';

/**
 * Tạo bài tự sinh. Khoá cố vấn theo (tác giả, loại) làm hai lần nhận trùng cùng lúc không cùng qua được
 * kiểm tra "đã có bài trong ngày"; kiểm tra và ghi nằm trong cùng một câu `INSERT ... WHERE NOT EXISTS`.
 *
 * Ngày tính theo múi giờ của công ty, kể cả bài đã bị tác giả xoá (xoá không mở lại hạn mức trong ngày).
 */
export class PostgresSocialActivityStore implements SocialActivityStore {
  private readonly runner: DiscoveryQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new DiscoveryQueryRunner(references, pools);
  }

  insertDaily(tenantId: string, input: ActivityPostInsert): Promise<boolean> {
    return this.runner.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `social.activity:${input.authorId}:${input.type}`,
        ]);
        const result = await client.query(
          `INSERT INTO social_schema.posts
             (id, author_id, kind, body_html, status, published_at, activity_type, activity_payload)
           SELECT $1::uuid, $2::uuid, 'activity', '', 'published', now(), $3::varchar, $4::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM social_schema.posts
               WHERE author_id = $2::uuid AND kind = 'activity' AND activity_type = $3::varchar
                 AND (published_at AT TIME ZONE $5::text)::date = (now() AT TIME ZONE $5::text)::date
            )`,
          [input.id, input.authorId, input.type, JSON.stringify(input.payload), input.timeZone],
        );
        if (result.rowCount === 0) return false;

        // Chỉ để realtime làm mới bảng tin: `kind: 'post'`, không @all, bài không có người nhận nên
        // danh mục thông báo không tạo thông báo nào.
        const payload: SocialPostPublishedPayload = {
          postId: input.id,
          authorId: input.authorId,
          authorName: input.authorName,
          kind: 'post',
          mentionsAll: false,
        };
        await writeOutboxEvent(client, tenantId, {
          type: SOCIAL_EVENT_TYPES.postPublished,
          aggregateType: 'social-post',
          aggregateId: input.id,
          payload: { ...payload },
        });
        return true;
      }),
    );
  }
}
