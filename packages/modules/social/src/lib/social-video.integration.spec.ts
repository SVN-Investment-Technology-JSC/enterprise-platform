import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import { SOCIAL_VIDEO_EVENT_TYPES } from '@enterprise-platform/contracts-social';
import type { VideoReadyResult } from './application/social-video-store.port.js';
import { PostgresSocialVideoStore } from './infrastructure/postgres-social-video.store.js';

/**
 * Chạy với PostgreSQL dùng một lần ở máy, ví dụ
 * `SOCIAL_TEST_ADMIN_URL=postgresql://tenant:tenant@localhost:15436/postgres`. Tự tạo DB tạm, áp migration
 * tenant (integration + social 0001-0007) rồi xoá DB. Bỏ qua khi không đặt biến môi trường.
 */
// Tạo DB tạm và áp toàn bộ migration có thể quá 5 giây (mặc định của Jest) khi máy bận hoặc nhiều suite chạy song song.
jest.setTimeout(30_000);
const integration = process.env.SOCIAL_TEST_ADMIN_URL ? describe : describe.skip;

const MIGRATIONS = [
  'tenant/0001-integration.sql',
  'tenant/social/0001-social-feed.sql',
  'tenant/social/0002-social-groups.sql',
  'tenant/social/0003-social-post-p2.sql',
  'tenant/social/0004-social-visibility-groups-v2.sql',
  'tenant/social/0005-social-comment-reactions.sql',
  'tenant/social/0006-social-comment-attachments.sql',
  'tenant/social/0007-social-video-processing.sql',
  'tenant/social/0008-social-post-media-layout.sql',
  'tenant/social/0009-social-post-topics.sql',
  'tenant/social/0010-social-more-reactions.sql',
  'tenant/social/0011-social-bookmark-folders.sql',
];

integration('Xử lý video Mạng nội bộ trên PostgreSQL thật', () => {
  const databaseName = 'social_video_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: PostgresSocialVideoStore;

  const addRow = async (
    over: { uploadedBy?: string; status?: string; completed?: boolean; size?: number; purpose?: string; fileName?: string } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO social_schema.attachments
         (id, uploaded_by, file_name, content_type, size_bytes, storage_key, completed_at, purpose, processing_status)
       VALUES ($1, $2, $3, 'video/quicktime', $4, $5, $6, $7, $8)`,
      [
        id,
        over.uploadedBy ?? alice,
        over.fileName ?? 'Kỳ nghỉ.hè.MOV',
        over.size ?? 1000,
        `tenants/${tenantId}/social/${id}/original`,
        over.completed === false ? null : new Date(),
        over.purpose ?? 'comment',
        over.status ?? 'queued',
      ],
    );
    return id;
  };
  const rowOf = async (id: string) =>
    (await pool.query(`SELECT * FROM social_schema.attachments WHERE id = $1`, [id])).rows[0];
  const outboxCount = async (id: string) =>
    Number((await pool.query(`SELECT count(*) FROM integration_schema.outbox_events WHERE aggregate_id = $1`, [id])).rows[0].count);
  const expire = (id: string) =>
    pool.query(`UPDATE social_schema.attachments SET processing_lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
  const readyResult = (id: string): VideoReadyResult => ({
    storageKey: `tenants/${tenantId}/social/${id}/video.mp4`,
    sizeBytes: 555,
    contentType: 'video/mp4',
    posterKey: `tenants/${tenantId}/social/${id}/poster.jpg`,
    durationMs: 9000,
    width: 1280,
    height: 720,
  });

  beforeAll(async () => {
    const url = new URL(process.env.SOCIAL_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of MIGRATIONS) await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    store = new PostgresSocialVideoStore(
      { require: () => ({ tenantId }) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    );
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  describe('completeAndQueue', () => {
    it('đánh dấu đã tải xong, xếp hàng và ghi đúng một sự kiện outbox; gọi lại không ghi thêm', async () => {
      const id = await addRow({ completed: false, status: 'none', size: 1, purpose: 'post' });
      const event = {
        type: SOCIAL_VIDEO_EVENT_TYPES.post,
        aggregateType: 'social-attachment' as const,
        aggregateId: id,
        payload: { attachmentId: id, purpose: 'post' },
      };

      await store.completeAndQueue(tenantId, id, 4096, event);
      await store.completeAndQueue(tenantId, id, 4096, event);

      const row = await rowOf(id);
      expect(row.processing_status).toBe('queued');
      expect(row.completed_at).not.toBeNull();
      expect(Number(row.size_bytes)).toBe(4096);
      const events = await pool.query(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id = $1`,
        [id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].event_type).toBe('social.video.post_requested');
      expect(events.rows[0].payload.payload).toEqual({ attachmentId: id, purpose: 'post' });
      expect(events.rows[0].payload.tenantId).toBe(tenantId);
    });

    it('dòng không tồn tại thì không ghi sự kiện', async () => {
      const id = randomUUID();
      await store.completeAndQueue(tenantId, id, 10, {
        type: SOCIAL_VIDEO_EVENT_TYPES.comment,
        aggregateType: 'social-attachment',
        aggregateId: id,
        payload: {},
      });
      expect(await outboxCount(id)).toBe(0);
    });
  });

  describe('claim', () => {
    it('10 lệnh đồng thời cho cùng một dòng: đúng một thắng', async () => {
      const id = await addRow();
      const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(tenantId, id, 120, 3)));
      const winners = results.filter((result) => result !== undefined);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.attempt).toBe(1);
      expect(winners[0]?.attachment).toMatchObject({ id, purpose: 'comment', processingStatus: 'processing', completed: true });
      const row = await rowOf(id);
      expect(row.processing_status).toBe('processing');
      expect(row.processing_attempts).toBe(1);
      expect(new Date(row.processing_lease_until).getTime()).toBeGreaterThan(Date.now());
    });

    it('đang được thuê còn hạn, đã ready, failed, none hoặc không có: undefined', async () => {
      const leased = await addRow();
      await store.claim(tenantId, leased, 120, 3);
      await expect(store.claim(tenantId, leased, 120, 3)).resolves.toBeUndefined();
      for (const status of ['ready', 'failed', 'none']) {
        await expect(store.claim(tenantId, await addRow({ status }), 120, 3)).resolves.toBeUndefined();
      }
      await expect(store.claim(tenantId, randomUUID(), 120, 3)).resolves.toBeUndefined();
    });

    it('nhận lại sau khi hết hạn thuê và tăng số lần thử', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 120, 3);
      await expire(id);
      const again = await store.claim(tenantId, id, 120, 3);
      expect(again?.attempt).toBe(2);
    });

    it('hết số lần thử: đánh dấu failed kèm thông báo tiếng Việt và không trả việc', async () => {
      const id = await addRow();
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        expect((await store.claim(tenantId, id, 120, 2))?.attempt).toBe(attempt);
        await expire(id);
      }
      await expect(store.claim(tenantId, id, 120, 2)).resolves.toBeUndefined();
      const row = await rowOf(id);
      expect(row.processing_status).toBe('failed');
      expect(row.processing_error).toBe('Không xử lý được video sau nhiều lần thử.');
      expect(row.processing_lease_until).toBeNull();
    });

    it('queued đã hết lần thử (sau retry) cũng thành failed', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 120, 1);
      await store.markFailed(tenantId, id, 'x', true);
      expect((await rowOf(id)).processing_status).toBe('queued');
      await expect(store.claim(tenantId, id, 120, 1)).resolves.toBeUndefined();
      expect((await rowOf(id)).processing_status).toBe('failed');
    });
  });

  describe('extendLease, markReady, markFailed', () => {
    it('extendLease kéo dài hạn thuê', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 5, 3);
      await store.extendLease(tenantId, id, 600);
      const row = await rowOf(id);
      expect(new Date(row.processing_lease_until).getTime()).toBeGreaterThan(Date.now() + 300_000);
    });

    it('markReady đổi khoá, giữ khoá cũ ở source_key, đổi đuôi tệp và xoá hạn thuê', async () => {
      const id = await addRow({ fileName: 'Kỳ nghỉ.hè.MOV' });
      const original = `tenants/${tenantId}/social/${id}/original`;
      await store.claim(tenantId, id, 120, 3);

      await expect(store.markReady(tenantId, id, readyResult(id))).resolves.toBe(true);

      const row = await rowOf(id);
      expect(row).toMatchObject({
        processing_status: 'ready',
        storage_key: `tenants/${tenantId}/social/${id}/video.mp4`,
        source_key: original,
        poster_key: `tenants/${tenantId}/social/${id}/poster.jpg`,
        content_type: 'video/mp4',
        file_name: 'Kỳ nghỉ.hè.mp4',
        duration_ms: 9000,
        width: 1280,
        height: 720,
        processing_lease_until: null,
        processing_error: null,
      });
      expect(Number(row.size_bytes)).toBe(555);
      // Gọi lần hai (không còn processing) không ghi đè.
      await expect(store.markReady(tenantId, id, readyResult(id))).resolves.toBe(false);
    });

    it('tên tệp không có đuôi được thêm .mp4', async () => {
      const id = await addRow({ fileName: 'clip' });
      await store.claim(tenantId, id, 120, 3);
      await store.markReady(tenantId, id, readyResult(id));
      expect((await rowOf(id)).file_name).toBe('clip.mp4');
    });

    it('markReady trả false khi dòng đã bị xoá', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 120, 3);
      await pool.query(`DELETE FROM social_schema.attachments WHERE id = $1`, [id]);
      await expect(store.markReady(tenantId, id, readyResult(id))).resolves.toBe(false);
    });

    it('markFailed retry về queued; không retry là failed, cắt thông báo 500 ký tự', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 120, 3);
      await store.markFailed(tenantId, id, 'tạm thời', true);
      let row = await rowOf(id);
      expect(row.processing_status).toBe('queued');
      expect(row.processing_lease_until).toBeNull();

      await store.claim(tenantId, id, 120, 3);
      await store.markFailed(tenantId, id, 'á'.repeat(700), false);
      row = await rowOf(id);
      expect(row.processing_status).toBe('failed');
      expect(row.processing_error).toHaveLength(500);
      expect(row.processing_lease_until).toBeNull();
    });

    it('markFailed retry kèm refundAttempt trả lại lượt thử; thiếu cờ thì giữ nguyên', async () => {
      const id = await addRow();
      await store.claim(tenantId, id, 120, 3);
      expect((await rowOf(id)).processing_attempts).toBe(1);

      await store.markFailed(tenantId, id, 'đầy đĩa', true, { refundAttempt: true });
      let row = await rowOf(id);
      expect(row.processing_status).toBe('queued');
      expect(row.processing_attempts).toBe(0);

      await store.claim(tenantId, id, 120, 3);
      await store.markFailed(tenantId, id, 'tạm thời', true);
      row = await rowOf(id);
      expect(row.processing_attempts).toBe(1);
    });
  });

  describe('requeueStale', () => {
    const age = (id: string) =>
      pool.query(`UPDATE social_schema.attachments SET completed_at = now() - interval '2 hours' WHERE id = $1`, [id]);

    it('xếp lại video queued quá hạn đúng một lần rồi giữ; bỏ qua dòng mới và dòng đã xong', async () => {
      const stale = await addRow({ purpose: 'post' });
      await age(stale);
      const fresh = await addRow();
      const done = await addRow({ status: 'ready' });
      await age(done);

      expect(await store.requeueStale(tenantId, 1800, 50)).toBeGreaterThanOrEqual(1);
      expect(await outboxCount(stale)).toBe(1);
      const event = await pool.query(
        `SELECT event_type, payload FROM integration_schema.outbox_events WHERE aggregate_id = $1`,
        [stale],
      );
      expect(event.rows[0].event_type).toBe('social.video.post_requested');
      expect(event.rows[0].payload.payload).toEqual({ attachmentId: stale, purpose: 'post' });
      expect(await outboxCount(fresh)).toBe(0);
      expect(await outboxCount(done)).toBe(0);

      // Đang bị giữ: lần quét sau không xếp lại, nhưng worker vẫn nhận được việc (claim bỏ qua hạn giữ của `queued`).
      await store.requeueStale(tenantId, 1800, 50);
      expect(await outboxCount(stale)).toBe(1);
      await expect(store.claim(tenantId, stale, 120, 3)).resolves.toBeDefined();
    });

    it('video processing hết hạn thuê được xếp lại và nhận được ngay; còn hạn thuê thì không đụng', async () => {
      const dead = await addRow({ status: 'processing' });
      await age(dead);
      await expire(dead);
      const alive = await addRow({ status: 'processing' });
      await age(alive);
      await pool.query(
        `UPDATE social_schema.attachments SET processing_lease_until = now() + interval '10 minutes' WHERE id = $1`,
        [alive],
      );

      await store.requeueStale(tenantId, 1800, 50);
      expect(await outboxCount(dead)).toBe(1);
      expect(await outboxCount(alive)).toBe(0);
      await expect(store.claim(tenantId, dead, 120, 3)).resolves.toBeDefined();
    });
  });

  describe('failStuckQueued', () => {
    const age = (id: string, interval = '2 hours') =>
      pool.query(`UPDATE social_schema.attachments SET completed_at = now() - $2::interval WHERE id = $1`, [id, interval]);
    const MESSAGE = 'Hệ thống xử lý video chưa sẵn sàng. Hãy tải video lên lại sau.';

    it('chỉ báo lỗi dòng queued, chưa từng được nhận và đủ cũ; trả đúng id và storage_key', async () => {
      const stuck = await addRow();
      await age(stuck);
      await pool.query(`UPDATE social_schema.attachments SET processing_lease_until = now() + interval '5 minutes' WHERE id = $1`, [stuck]);
      const fresh = await addRow();
      await age(fresh, '5 minutes');
      const claimedBefore = await addRow();
      await age(claimedBefore);
      await pool.query(`UPDATE social_schema.attachments SET processing_attempts = 1 WHERE id = $1`, [claimedBefore]);
      const processing = await addRow({ status: 'processing' });
      await age(processing);
      const unfinished = await addRow({ completed: false, status: 'none' });
      const ready = await addRow({ status: 'ready' });
      await age(ready);

      const result = await store.failStuckQueued(tenantId, 1800, 50, MESSAGE);
      // Dòng còn sót từ các test trước (queued, chưa nhận, đã cũ) cũng bị báo lỗi, nên chỉ so phần của test này.
      const ids = result.map((item) => item.id);
      expect(result).toContainEqual({ id: stuck, storageKey: `tenants/${tenantId}/social/${stuck}/original` });
      for (const untouched of [fresh, claimedBefore, processing, unfinished, ready]) expect(ids).not.toContain(untouched);

      const row = await rowOf(stuck);
      expect(row.processing_status).toBe('failed');
      expect(row.processing_error).toBe(MESSAGE);
      expect(row.processing_lease_until).toBeNull();
      for (const [id, status] of [
        [fresh, 'queued'],
        [claimedBefore, 'queued'],
        [processing, 'processing'],
        [unfinished, 'none'],
        [ready, 'ready'],
      ] as const) {
        expect((await rowOf(id)).processing_status).toBe(status);
      }
      // Lần gọi sau không còn dòng nào để báo lỗi.
      expect(await store.failStuckQueued(tenantId, 1800, 50, MESSAGE)).toEqual([]);
    });

    it('cắt thông báo tối đa 500 ký tự và tôn trọng giới hạn lô', async () => {
      const first = await addRow();
      const second = await addRow();
      await age(first, '30 hours');
      await age(second, '2 hours');
      const result = await store.failStuckQueued(tenantId, 1800, 1, 'x'.repeat(800));
      expect(result.map((item) => item.id)).toEqual([first]);
      expect((await rowOf(first)).processing_error).toHaveLength(500);
      expect((await rowOf(second)).processing_status).toBe('queued');
      await store.failStuckQueued(tenantId, 1800, 50, MESSAGE);
    });
  });

  describe('đếm và dọn', () => {
    it('countInFlight và sumUnattachedBytes theo người dùng và tenant', async () => {
      const before = await store.countInFlight(tenantId, bob);
      const beforeBytes = await store.sumUnattachedBytes(tenantId, bob);
      await addRow({ uploadedBy: bob, status: 'queued', size: 100 });
      await addRow({ uploadedBy: bob, status: 'processing', size: 200 });
      await addRow({ uploadedBy: bob, status: 'ready', size: 400 });
      await addRow({ uploadedBy: bob, status: 'failed', size: 800 });
      await addRow({ uploadedBy: bob, status: 'none', completed: false, size: 1600 });
      await addRow({ uploadedBy: alice, status: 'queued', size: 3200 });

      const after = await store.countInFlight(tenantId, bob);
      expect(after.user - before.user).toBe(2);
      expect(after.tenant - before.tenant).toBe(3);
      expect((await store.sumUnattachedBytes(tenantId, bob)) - beforeBytes).toBe(3100);
      await expect(store.sumUnattachedBytes(tenantId, randomUUID())).resolves.toBe(0);
    });

    it('listSourceKeysToDelete chỉ trả dòng ready còn source_key; clearSourceKeys bỏ chúng', async () => {
      const done = await addRow();
      await store.claim(tenantId, done, 120, 3);
      await store.markReady(tenantId, done, readyResult(done));
      const queued = await addRow();

      const listed = await store.listSourceKeysToDelete(tenantId, 1000);
      expect(listed).toContainEqual({ id: done, sourceKey: `tenants/${tenantId}/social/${done}/original` });
      expect(listed.map((entry) => entry.id)).not.toContain(queued);
      await expect(store.listSourceKeysToDelete(tenantId, 0)).resolves.toEqual([]);

      await store.clearSourceKeys(tenantId, []);
      await store.clearSourceKeys(tenantId, [done]);
      expect((await rowOf(done)).source_key).toBeNull();
      expect((await store.listSourceKeysToDelete(tenantId, 1000)).map((entry) => entry.id)).not.toContain(done);
    });
  });
});
