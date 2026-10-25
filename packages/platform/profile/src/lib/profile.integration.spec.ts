import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TENANT_CORE_MIGRATIONS } from '@enterprise-platform/platform-entitlement/migrations';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { Pool, type PoolClient } from 'pg';
import { ProfileService, type AvatarStorage, type ProfileDatabases } from './profile.service.js';

const integration = process.env.CORE_CHAT_TEST_ADMIN_URL ? describe : describe.skip;
const TENANT = '22222222-2222-4222-8222-222222222222';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5]);

class FakeStorage implements AvatarStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  async putObject(input: { key: string; contentType: string; body: Uint8Array }) {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
  }
  async getObject(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('NotFound');
    return object;
  }
  async deleteObjects(keys: readonly string[]) {
    for (const key of keys) this.objects.delete(key);
    return { failed: [] };
  }
}

integration('Ảnh đại diện và danh bạ (PostgreSQL)', () => {
  const databaseName = `core_profile_test_${randomUUID().replace(/-/g, '')}`;
  let admin: Pool;
  let pool: Pool;
  let storage: FakeStorage;
  let profiles: ProfileService;
  const me = randomUUID();
  const other = randomUUID();
  const gone = randomUUID();
  const principal: TenantUserPrincipal = {
    kind: 'tenant-user',
    userId: me,
    sessionId: randomUUID(),
    email: 'an@test.local',
    displayName: 'Nguyễn Văn An',
    roles: [],
    permissions: [],
    tenantId: TENANT,
    tenantSlug: 'test',
    membershipId: me,
  };

  beforeAll(async () => {
    const url = new URL(process.env.CORE_CHAT_TEST_ADMIN_URL as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString(), max: 3 });
    const root = resolve(process.cwd(), '../../../migrations');
    await pool.query(await readFile(resolve(root, 'tenant/0001-integration.sql'), 'utf8'));
    for (const migration of TENANT_CORE_MIGRATIONS) await pool.query(await readFile(resolve(root, migration.path), 'utf8'));
    await pool.query(
      `INSERT INTO core_schema.users (id, username, full_name, email, password_hash, status, is_active) VALUES
         ($1, 'an@test.local', 'Nguyễn Văn An', 'an@test.local', 'x', 'active', true),
         ($2, 'binh@test.local', 'Trần Bình', 'binh@test.local', 'x', 'active', true),
         ($3, 'nghi@test.local', 'Người đã nghỉ', 'nghi@test.local', 'x', 'disabled', false)`,
      [me, other, gone],
    );
    storage = new FakeStorage();
    const databases = {
      pool: async () => pool,
      transaction: async <T,>(_tenantId: string, work: (client: PoolClient) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    profiles = new ProfileService(databases as unknown as ProfileDatabases, storage);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it('danh bạ chỉ có người đang hoạt động, chưa có ảnh thì avatarVersion là null', async () => {
    const { people } = await profiles.people(principal);
    expect(people.map((p) => p.id).sort()).toEqual([me, other].sort());
    expect(people.every((p) => p.avatarVersion === null)).toBe(true);
  });

  it('đổi ảnh: lưu vào kho dưới thư mục của tenant, tăng phiên bản, xoá ảnh cũ, phát sự kiện', async () => {
    const first = await profiles.setAvatar(principal, PNG);
    expect(first.avatarVersion).toBe(1);
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^tenants/${TENANT}/core/avatars/${me}/[0-9a-f-]+\\.png$`));

    const second = await profiles.setAvatar(principal, JPEG);
    expect(second.avatarVersion).toBe(2);
    expect([...storage.objects.keys()]).toHaveLength(1);
    const avatar = await profiles.avatar(principal, me);
    expect(avatar).toMatchObject({ contentType: 'image/jpeg', version: 2 });

    const events = await pool.query<{ event_type: string; payload: { payload: { userId: string } } }>(
      `SELECT event_type, payload FROM integration_schema.outbox_events WHERE event_type = 'core.user.avatar-updated'`,
    );
    expect(events.rows.map((row) => row.payload.payload.userId)).toEqual([me, me]);
    // Đổi ảnh không đụng core_schema.users nên không làm tăng revision phân quyền.
    const revision = await pool.query(`SELECT count(*)::int AS n FROM integration_schema.outbox_events WHERE event_type = 'core.authorization.changed'`);
    const before = revision.rows[0].n;
    await profiles.setAvatar(principal, PNG);
    const after = await pool.query(`SELECT count(*)::int AS n FROM integration_schema.outbox_events WHERE event_type = 'core.authorization.changed'`);
    expect(after.rows[0].n).toBe(before);
  });

  it('gỡ ảnh: xoá khỏi kho, phiên bản vẫn tăng, người khác thấy không còn ảnh', async () => {
    const removed = await profiles.removeAvatar(principal);
    expect(removed.avatarVersion).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(await profiles.avatar({ ...principal, userId: other }, me)).toBeNull();
    const again = await profiles.removeAvatar(principal);
    expect(again.avatarVersion).toBeNull();
  });

  it('từ chối tệp không phải ảnh mà không ghi gì vào kho', async () => {
    await expect(profiles.setAvatar(principal, new TextEncoder().encode('<svg/>'))).rejects.toMatchObject({ status: 400 });
    expect(storage.objects.size).toBe(0);
  });
});
