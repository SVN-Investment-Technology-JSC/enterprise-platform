import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type {
  SocialVideoStore,
  VideoClaim,
  VideoReadyResult,
} from '../application/social-video-store.port.js';
import { SOCIAL_VIDEO_EVENT_TYPES, type SocialAttachmentPurpose } from '@enterprise-platform/contracts-social';
import type { SocialOutboxEvent } from '../application/social-store.port.js';
import { TenantQueryRunner } from './group-sql-support.js';
import { ATTACHMENT_COLUMNS, mapAttachment, writeOutbox, type AttachmentRecord } from './postgres-social-store.js';

const EXHAUSTED_MESSAGE = 'Không xử lý được video sau nhiều lần thử.';
const ERROR_MAX_LENGTH = 500;

/** Hàng đợi chuyển mã video nằm ngay trong `social_schema.attachments` (cột `processing_*`). */
export class PostgresSocialVideoStore implements SocialVideoStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  completeAndQueue(tenantId: string, attachmentId: string, sizeBytes: number, event: SocialOutboxEvent): Promise<void> {
    return this.runner.run(tenantId, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // `completed_at IS NULL`: gọi lại thì không khớp dòng nào, nên không có sự kiện thứ hai.
        const updated = await client.query(
          `UPDATE social_schema.attachments
              SET completed_at = now(), size_bytes = $2, processing_status = 'queued'
            WHERE id = $1 AND completed_at IS NULL`,
          [attachmentId, sizeBytes],
        );
        if (updated.rowCount === 1) await writeOutbox(client, tenantId, event);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  countInFlight(tenantId: string, uploaderId: string): Promise<{ readonly user: number; readonly tenant: number }> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<{ user_count: string; tenant_count: string }>(
        `SELECT count(*) FILTER (WHERE uploaded_by = $1) AS user_count, count(*) AS tenant_count
           FROM social_schema.attachments
          WHERE processing_status IN ('queued', 'processing')`,
        [uploaderId],
      );
      const row = result.rows[0];
      return { user: Number(row?.user_count ?? 0), tenant: Number(row?.tenant_count ?? 0) };
    });
  }

  sumUnattachedBytes(tenantId: string, uploaderId: string): Promise<number> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<{ total: string }>(
        `SELECT COALESCE(SUM(size_bytes), 0)::text AS total
           FROM social_schema.attachments
          WHERE uploaded_by = $1 AND post_id IS NULL AND comment_id IS NULL`,
        [uploaderId],
      );
      return Number(result.rows[0]?.total ?? 0);
    });
  }

  claim(
    tenantId: string,
    attachmentId: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<VideoClaim | undefined> {
    return this.runner.run(tenantId, async (pool) => {
      // Một câu UPDATE có điều kiện: Postgres khoá dòng và kiểm lại điều kiện, nên chỉ một lệnh đồng thời thắng.
      const claimed = await pool.query<AttachmentRecord & { processing_attempts: number }>(
        `UPDATE social_schema.attachments a
            SET processing_status = 'processing',
                processing_attempts = a.processing_attempts + 1,
                processing_lease_until = now() + make_interval(secs => $2::int)
          WHERE a.id = $1
            AND (a.processing_status = 'queued'
                 OR (a.processing_status = 'processing' AND a.processing_lease_until < now()))
            AND a.processing_attempts < $3
        RETURNING ${ATTACHMENT_COLUMNS}, a.processing_attempts`,
        [attachmentId, leaseSeconds, maxAttempts],
      );
      const row = claimed.rows[0];
      if (row) return { attachment: mapAttachment(row), attempt: row.processing_attempts };

      // Hết số lần thử mà vẫn chờ hoặc treo (worker chết nhiều lần): kết thúc ở `failed`, không quay vòng mãi.
      await pool.query(
        `UPDATE social_schema.attachments
            SET processing_status = 'failed', processing_lease_until = NULL, processing_error = $3
          WHERE id = $1
            AND (processing_status = 'queued'
                 OR (processing_status = 'processing' AND processing_lease_until < now()))
            AND processing_attempts >= $2`,
        [attachmentId, maxAttempts, EXHAUSTED_MESSAGE],
      );
      return undefined;
    });
  }

  extendLease(tenantId: string, attachmentId: string, leaseSeconds: number): Promise<void> {
    return this.runner.run(tenantId, async (pool) => {
      await pool.query(
        `UPDATE social_schema.attachments
            SET processing_lease_until = now() + make_interval(secs => $2::int)
          WHERE id = $1 AND processing_status = 'processing'`,
        [attachmentId, leaseSeconds],
      );
    });
  }

  markReady(tenantId: string, attachmentId: string, result: VideoReadyResult): Promise<boolean> {
    return this.runner.run(tenantId, async (pool) => {
      // Vế phải của SET đọc giá trị cũ, nên `source_key = storage_key` giữ khoá bản gốc.
      const updated = await pool.query(
        `UPDATE social_schema.attachments
            SET source_key = storage_key,
                storage_key = $2,
                size_bytes = $3,
                content_type = $4,
                file_name = left(regexp_replace(file_name, '\\.[^./\\\\]+$', ''), 250) || '.mp4',
                poster_key = $5,
                duration_ms = $6,
                width = $7,
                height = $8,
                processing_status = 'ready',
                processing_lease_until = NULL,
                processing_error = NULL
          WHERE id = $1 AND processing_status = 'processing'`,
        [
          attachmentId,
          result.storageKey,
          result.sizeBytes,
          result.contentType,
          result.posterKey,
          result.durationMs,
          result.width,
          result.height,
        ],
      );
      return updated.rowCount === 1;
    });
  }

  markFailed(
    tenantId: string,
    attachmentId: string,
    message: string,
    retry: boolean,
    options?: { readonly refundAttempt?: boolean },
  ): Promise<void> {
    return this.runner.run(tenantId, async (pool) => {
      if (retry) {
        await pool.query(
          `UPDATE social_schema.attachments
              SET processing_status = 'queued', processing_lease_until = NULL,
                  processing_attempts = CASE WHEN $2::boolean THEN GREATEST(processing_attempts - 1, 0)
                                             ELSE processing_attempts END
            WHERE id = $1 AND processing_status = 'processing'`,
          [attachmentId, options?.refundAttempt === true],
        );
        return;
      }
      await pool.query(
        `UPDATE social_schema.attachments
            SET processing_status = 'failed', processing_lease_until = NULL, processing_error = $2
          WHERE id = $1 AND processing_status IN ('queued', 'processing')`,
        [attachmentId, message.slice(0, ERROR_MAX_LENGTH)],
      );
    });
  }

  listSourceKeysToDelete(
    tenantId: string,
    limit: number,
  ): Promise<readonly { readonly id: string; readonly sourceKey: string }[]> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<{ id: string; source_key: string }>(
        `SELECT id, source_key
           FROM social_schema.attachments
          WHERE processing_status = 'ready' AND source_key IS NOT NULL
          ORDER BY id
          LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({ id: row.id, sourceKey: row.source_key }));
    });
  }

  requeueStale(tenantId: string, staleAfterSeconds: number, limit: number): Promise<number> {
    return this.runner.run(tenantId, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Dòng `queued` được giữ `staleAfterSeconds` qua `processing_lease_until` (`claim` bỏ qua cột này với
        // dòng `queued`). Dòng `processing` giữ nguyên hạn thuê để tin nhắn gửi lại nhận được ngay.
        const stale = await client.query<{ id: string; purpose: SocialAttachmentPurpose }>(
          `UPDATE social_schema.attachments
              SET processing_lease_until = CASE
                    WHEN processing_status = 'queued' THEN now() + make_interval(secs => $1::double precision)
                    ELSE processing_lease_until END
            WHERE id IN (
                    SELECT id FROM social_schema.attachments
                     WHERE processing_status IN ('queued', 'processing')
                       AND completed_at IS NOT NULL
                       AND completed_at < now() - make_interval(secs => $1::double precision)
                       AND (processing_lease_until IS NULL OR processing_lease_until < now())
                     ORDER BY completed_at
                     LIMIT $2
                       FOR UPDATE SKIP LOCKED)
            RETURNING id, purpose`,
          [staleAfterSeconds, limit],
        );
        for (const row of stale.rows) {
          await writeOutbox(client, tenantId, {
            type: SOCIAL_VIDEO_EVENT_TYPES[row.purpose],
            aggregateType: 'social-attachment',
            aggregateId: row.id,
            payload: { attachmentId: row.id, purpose: row.purpose },
          });
        }
        await client.query('COMMIT');
        return stale.rows.length;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }

  clearSourceKeys(tenantId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return this.runner.run(tenantId, async (pool) => {
      await pool.query(`UPDATE social_schema.attachments SET source_key = NULL WHERE id = ANY($1::uuid[])`, [ids]);
    });
  }
}
