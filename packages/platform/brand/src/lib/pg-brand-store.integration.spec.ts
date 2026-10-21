/**
 * Chạy với Postgres thật khi đặt `BRAND_TEST_DATABASE_URL` (một database trống dùng riêng cho test, ví dụ
 * `postgresql://user:pass@127.0.0.1:55432/brand_test`). Không có biến này thì cả file được bỏ qua.
 * Test chạy migration thật `migrations/platform/0010-brand-icon-storage.sql` và dọn các hàng nó tạo (mã `it-*`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  DEFAULT_PALETTE,
  DEFAULT_RULES,
} from '@enterprise-platform/shared-brand-icon';
import { BrandError } from './brand.errors.js';
import { BrandIconService } from './brand-icon.service.js';
import { PgBrandStore, slugCandidates } from './pg-brand-store.js';
import { FakeObjectStore } from './testing/brand-fakes.js';
import { sampleDocument } from './testing/sample-documents.js';

const databaseUrl = process.env.BRAND_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const ADMIN = { userId: '00000000-0000-4000-8000-000000000001' };
const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'migrations',
  'platform',
  '0010-brand-icon-storage.sql',
);

const doc = (id: string, name = `Icon ${id}`) => sampleDocument({ id, name });

async function rejection(promise: Promise<unknown>): Promise<BrandError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BrandError);
    return error as BrandError;
  }
  throw new Error('Expected the promise to reject');
}

integration('PgBrandStore trên Postgres thật', () => {
  const pool = createPostgresPool(databaseUrl ?? 'postgresql://unused', {
    max: 6,
  });
  const store = new PgBrandStore(pool);
  const objects = new FakeObjectStore();
  const service = new BrandIconService(store, objects, {
    publicRead: () => true,
  });

  async function applyMigration(): Promise<void> {
    const sql = readFileSync(MIGRATION, 'utf8');
    const client = await pool.connect();
    try {
      // Giống migrator: mỗi file chạy trong một giao dịch.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    Logger.overrideLogger(false);
    // Bảng nhật ký kiểm toán của Platform (migration 0001); tạo bản tối thiểu nếu DB test còn trống.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS audit_schema;
      CREATE TABLE IF NOT EXISTS audit_schema.audit_logs (
        id uuid PRIMARY KEY, actor_id uuid, tenant_id uuid, action varchar(160) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await applyMigration();
  });

  afterAll(async () => {
    await pool.query("DELETE FROM brand_schema.icons WHERE id LIKE 'it-%'");
    await pool.query(
      'UPDATE brand_schema.standards SET current_version = 0, spec_key = NULL, spec_sha256 = NULL, size_bytes = 0, updated_by = NULL WHERE id = 1',
    );
    await pool.query(
      "DELETE FROM audit_schema.audit_logs WHERE action LIKE 'platform.brand-%' AND actor_id = $1",
      [ADMIN.userId],
    );
    await pool.end();
    Logger.overrideLogger(['log', 'error', 'warn']);
  });

  it('migration chạy lại được và tạo dòng quy chuẩn mặc định', async () => {
    await expect(applyMigration()).resolves.toBeUndefined();
    const { rows } = await pool.query(
      'SELECT id, current_version FROM brand_schema.standards',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('ràng buộc DB chặn dữ liệu sai: mã, slug, trạng thái, khoá ngoài tiền tố platform/brand', async () => {
    const insert = (
      id: string,
      slug: string,
      status = 'draft',
      published: number | null = null,
    ) =>
      pool.query(
        `INSERT INTO brand_schema.icons (id, slug, name, category, status, current_version, published_version)
         VALUES ($1, $2, 'Tên', 'custom', $3, 1, $4)`,
        [id, slug, status, published],
      );
    await expect(insert('../x', 'it-slug-1')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insert('it-ok-1', 'Slug Hoa')).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      insert('it-ok-2', 'it-slug-2', 'published', null),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('it-ok-3', 'it-slug-3', 'draft', 1),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('it-ok-4', 'it-slug-4', 'published', 2),
    ).rejects.toMatchObject({ code: '23514' });
    await insert('it-ok-5', 'it-slug-5');
    await expect(insert('it-ok-5', 'it-slug-6')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(insert('it-ok-6', 'it-slug-5')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      pool.query(
        `INSERT INTO brand_schema.icon_versions (icon_id, version, spec_key, svg_key, mono_svg_key, spec_sha256, size_bytes)
         VALUES ('it-ok-5', 1, 'tenants/t1/x', 'platform/brand/icons/a', 'platform/brand/icons/b', repeat('a', 64), 1)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query("DELETE FROM brand_schema.icons WHERE id = 'it-ok-5'");
  });

  it('tạo icon: dòng icon + phiên bản + nhật ký kiểm toán, slug có hậu tố khi trùng', async () => {
    const first = await service.create(ADMIN, {
      document: doc('it-a', 'Trùng tên IT'),
    });
    const second = await service.create(ADMIN, {
      document: doc('it-b', 'Trùng tên IT'),
    });
    expect([first.icon.slug, second.icon.slug]).toEqual([
      'trung-ten-it',
      'trung-ten-it-2',
    ]);
    expect(first.icon).toMatchObject({
      status: 'draft',
      currentVersion: 1,
      publishedVersion: null,
      createdBy: ADMIN.userId,
    });
    expect(first.icon.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const versions = await pool.query(
      'SELECT spec_key, spec_sha256, standards_version FROM brand_schema.icon_versions WHERE icon_id = $1',
      ['it-a'],
    );
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0].spec_key).toBe(
      'platform/brand/icons/it-a/v1/spec.json',
    );
    expect(versions.rows[0].spec_sha256).toMatch(/^[0-9a-f]{64}$/);
    const audit = await pool.query(
      "SELECT action, metadata FROM audit_schema.audit_logs WHERE action = 'platform.brand-icon.created' AND metadata->>'iconId' = 'it-a'",
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('từ chối mã trùng bằng 409 mà không ghi object nào', async () => {
    const puts = objects.puts.length;
    const error = await rejection(
      service.create(ADMIN, { document: doc('it-a', 'Tên khác') }),
    );
    expect([error.status, error.code]).toEqual([409, 'BRAND_ICON_EXISTS']);
    expect(objects.puts).toHaveLength(puts);
  });

  it('hai người tạo cùng một mã đồng thời: một thắng, một nhận 409, object của người thắng còn nguyên', async () => {
    const results = await Promise.allSettled([
      service.create(ADMIN, { document: doc('it-race', 'Đua tạo') }),
      service.create(ADMIN, { document: doc('it-race', 'Đua tạo') }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect((loser?.reason as BrandError).code).toBe('BRAND_ICON_EXISTS');
    expect(objects.keys().filter((key) => key.includes('/it-race/'))).toEqual([
      'platform/brand/icons/it-race/v1/icon.mono.svg',
      'platform/brand/icons/it-race/v1/icon.svg',
      'platform/brand/icons/it-race/v1/spec.json',
    ]);
  });

  it('hai người tạo hai icon cùng tên đồng thời đều thành công với slug khác nhau', async () => {
    const results = await Promise.all([
      service.create(ADMIN, { document: doc('it-s1', 'Đua slug IT') }),
      service.create(ADMIN, { document: doc('it-s2', 'Đua slug IT') }),
    ]);
    expect(new Set(results.map((r) => r.icon.slug)).size).toBe(2);
  });

  it('lưu phiên bản mới, không đổi khi trùng nội dung, và báo xung đột khi lệch baseVersion', async () => {
    const saved = await service.update(ADMIN, 'it-a', {
      document: doc('it-a', 'Tên mới IT'),
      baseVersion: 1,
      note: 'Đổi tên',
    });
    expect(saved).toMatchObject({
      unchanged: false,
      icon: { name: 'Tên mới IT', currentVersion: 2, slug: 'trung-ten-it' },
      version: { version: 2, note: 'Đổi tên' },
    });
    const same = await service.update(ADMIN, 'it-a', {
      document: doc('it-a', 'Tên mới IT'),
      baseVersion: 2,
    });
    expect(same.unchanged).toBe(true);
    const conflict = await rejection(
      service.update(ADMIN, 'it-a', {
        document: doc('it-a', 'Khác nữa'),
        baseVersion: 1,
      }),
    );
    expect([conflict.status, conflict.code, conflict.extra]).toEqual([
      409,
      'BRAND_ICON_VERSION_CONFLICT',
      { currentVersion: 2 },
    ]);
    const detail = await service.detail('it-a');
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('hai lần lưu đồng thời cùng baseVersion: khoá hàng bảo đảm một thắng, một xung đột, không object nào bị ghi đè', async () => {
    const edit = (name: string) =>
      service.update(ADMIN, 'it-a', {
        document: doc('it-a', name),
        baseVersion: 2,
      });
    const results = await Promise.allSettled([
      edit('Đua A'),
      edit('Đua B'),
      edit('Đua C'),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected')
        expect((result.reason as BrandError).code).toBe(
          'BRAND_ICON_VERSION_CONFLICT',
        );
    }
    const detail = await service.detail('it-a');
    expect(detail.currentVersion).toBe(3);
    const stored = JSON.parse(
      objects.objects.get('platform/brand/icons/it-a/v3/spec.json')?.body ??
        '{}',
    ) as { name: string };
    expect(stored.name).toBe(detail.name);
    // Phiên bản 2 vẫn là bản cũ, không bị người thua ghi đè.
    expect(
      JSON.parse(
        objects.objects.get('platform/brand/icons/it-a/v2/spec.json')?.body ??
          '{}',
      ),
    ).toMatchObject({ name: 'Tên mới IT' });
  });

  it('lỗi kho giữa chừng: giao dịch hoàn tác, DB không còn dấu vết và object được dọn', async () => {
    objects.failPut = (key) => key.endsWith('/icon.mono.svg');
    const error = await rejection(
      service.create(ADMIN, { document: doc('it-fail', 'Lỗi kho') }),
    );
    objects.failPut = null;
    expect(error.code).toBe('BRAND_STORAGE_UNAVAILABLE');
    const rows = await pool.query(
      "SELECT 1 FROM brand_schema.icons WHERE id = 'it-fail'",
    );
    expect(rows.rowCount).toBe(0);
    expect(objects.keys().filter((key) => key.includes('/it-fail/'))).toEqual(
      [],
    );
  });

  it('phát hành, gỡ, lưu trữ, khôi phục khớp ràng buộc trạng thái của DB', async () => {
    const published = await service.publish(ADMIN, 'it-a');
    expect(published).toMatchObject({
      status: 'published',
      publishedVersion: 3,
    });
    const saved = await service.update(ADMIN, 'it-a', {
      document: doc('it-a', 'Sau phát hành'),
      baseVersion: 3,
    });
    expect(saved.icon).toMatchObject({
      currentVersion: 4,
      publishedVersion: 3,
      hasUnpublishedChanges: true,
    });
    expect(await service.unpublish(ADMIN, 'it-a')).toMatchObject({
      status: 'draft',
      publishedVersion: null,
    });
    await service.publish(ADMIN, 'it-a');
    expect(await service.archive(ADMIN, 'it-a')).toMatchObject({
      status: 'archived',
      publishedVersion: null,
    });
    expect((await rejection(service.publish(ADMIN, 'it-a'))).code).toBe(
      'BRAND_ICON_ARCHIVED',
    );
    expect(await service.restore(ADMIN, 'it-a')).toMatchObject({
      status: 'draft',
    });
    expect(
      (await service.list(['archived'])).icons.some(
        (icon) => icon.id === 'it-a',
      ),
    ).toBe(false);
    expect(
      (await service.list(['draft'])).icons.some((icon) => icon.id === 'it-a'),
    ).toBe(true);
  });

  it('đọc SVG công khai theo trạng thái phát hành', async () => {
    await service.publish(ADMIN, 'it-a');
    const viewer = async () => 'anonymous' as const;
    const live = await service.readSvg(
      'it-a',
      { version: 4, mode: 'brand' },
      viewer,
    );
    expect(live.notModified).toBe(false);
    await service.unpublish(ADMIN, 'it-a');
    expect(
      (
        await rejection(
          service.readSvg('it-a', { version: 4, mode: 'brand' }, viewer),
        )
      ).code,
    ).toBe('BRAND_ICON_NOT_FOUND');
  });

  it('bảng màu và quy chuẩn: lưu, xung đột phiên bản, chạy đồng thời', async () => {
    const palette = {
      tokens: DEFAULT_PALETTE.tokens.map((token) =>
        token.key === 'sapphire' ? { ...token, hex: '#123456' } : token,
      ),
    };
    const saved = await service.saveStandards(ADMIN, {
      palette,
      rules: DEFAULT_RULES,
      baseVersion: 0,
    });
    expect(saved).toMatchObject({ version: 1, unchanged: false });
    expect(await service.standards()).toMatchObject({
      version: 1,
      updatedBy: ADMIN.userId,
    });
    const stale = await rejection(
      service.saveStandards(ADMIN, {
        palette: DEFAULT_PALETTE,
        rules: DEFAULT_RULES,
        baseVersion: 0,
      }),
    );
    expect(stale.code).toBe('BRAND_STANDARDS_VERSION_CONFLICT');

    const results = await Promise.allSettled([
      service.saveStandards(ADMIN, {
        palette: DEFAULT_PALETTE,
        rules: DEFAULT_RULES,
        baseVersion: 1,
      }),
      service.saveStandards(ADMIN, {
        palette,
        rules: { ...DEFAULT_RULES, maxShapes: 5 },
        baseVersion: 1,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.standards()).version).toBe(2);
    expect(objects.keys().filter((key) => key.includes('/standards/'))).toEqual(
      ['platform/brand/standards/v1.json', 'platform/brand/standards/v2.json'],
    );

    const created = await service.create(ADMIN, {
      document: doc('it-pal', 'Màu mới IT'),
    });
    expect(created.version.standardsVersion).toBe(2);
  });
});

describe('slugCandidates', () => {
  it('thêm hậu tố số và không vượt 64 ký tự, không để gạch nối thừa', () => {
    expect(slugCandidates('icon').slice(0, 3)).toEqual([
      'icon',
      'icon-2',
      'icon-3',
    ]);
    const long = `${'a'.repeat(62)}-b`;
    for (const candidate of slugCandidates(long)) {
      expect(candidate.length).toBeLessThanOrEqual(64);
      expect(candidate).not.toMatch(/--|-$/);
    }
    expect(new Set(slugCandidates('icon')).size).toBe(50);
  });
});
