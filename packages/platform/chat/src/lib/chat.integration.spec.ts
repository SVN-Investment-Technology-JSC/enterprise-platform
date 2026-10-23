import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TENANT_CORE_MIGRATIONS } from '@enterprise-platform/platform-entitlement/migrations';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { Pool, type PoolClient } from 'pg';
import { ChatService, type ChatDatabases, type ChatStorage } from './chat.service.js';

const integration = process.env.CORE_CHAT_TEST_ADMIN_URL ? describe : describe.skip;
const TENANT = '11111111-1111-4111-8111-111111111111';

class TestDatabases {
  constructor(private readonly testPool: Pool) {}
  async pool() {
    return this.testPool;
  }
  async transaction<T>(_tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.testPool.connect();
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
  }
}

class FakeStorage implements ChatStorage {
  readonly objects = new Map<string, { sizeBytes: number; contentType: string }>();
  readonly deleted: string[] = [];
  async createUploadUrl(input: { key: string }) {
    return `https://storage.test/upload/${input.key}`;
  }
  async createDownloadUrl(key: string, _ttl?: number, options?: { inline?: boolean }) {
    return `https://storage.test/download/${key}?inline=${options?.inline ? 1 : 0}`;
  }
  async objectMetadata(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('NotFound');
    return object;
  }
  async deleteObjects(keys: readonly string[]) {
    this.deleted.push(...keys);
    return { failed: [] };
  }
}

function principal(userId: string, displayName: string): TenantUserPrincipal {
  return {
    kind: 'tenant-user',
    userId,
    sessionId: randomUUID(),
    email: `${displayName}@test.local`,
    displayName,
    roles: [],
    permissions: [],
    tenantId: TENANT,
    tenantSlug: 'test',
    membershipId: userId,
  };
}

integration('Chat nội bộ của core (PostgreSQL)', () => {
  const databaseName = `core_chat_test_${randomUUID().replace(/-/g, '')}`;
  let admin: Pool;
  let pool: Pool;
  let storage: FakeStorage;
  let chat: ChatService;
  let clock = new Date();

  const ids = { an: randomUUID(), binh: randomUUID(), chi: randomUUID(), dung: randomUUID(), off: randomUUID() };
  const an = principal(ids.an, 'Nguyễn Văn An');
  const binh = principal(ids.binh, 'Trần Thị Bình');
  const chi = principal(ids.chi, 'Lê Chi');
  const dung = principal(ids.dung, 'Phạm Dũng');

  const outbox = async (type: string) =>
    (await pool.query<{ payload: { payload: Record<string, unknown> } }>(
      `SELECT payload FROM integration_schema.outbox_events WHERE event_type = $1 ORDER BY occurred_at, id`,
      [type],
    )).rows.map((row) => row.payload.payload);
  const clearOutbox = () => pool.query('DELETE FROM integration_schema.outbox_events');
  const rejects = async (promise: Promise<unknown>, status: number, message?: RegExp) => {
    const error = await promise.then(() => null, (e: { getStatus?: () => number; message?: string }) => e);
    expect(error).not.toBeNull();
    expect(error?.getStatus?.()).toBe(status);
    if (message) expect(error?.message).toMatch(message);
  };

  beforeAll(async () => {
    const url = new URL(process.env.CORE_CHAT_TEST_ADMIN_URL as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    const root = resolve(process.cwd(), '../../../migrations');
    await pool.query(await readFile(resolve(root, 'tenant/0001-integration.sql'), 'utf8'));
    for (const migration of TENANT_CORE_MIGRATIONS) await pool.query(await readFile(resolve(root, migration.path), 'utf8'));
    for (const [key, id] of Object.entries(ids)) {
      await pool.query(
        `INSERT INTO core_schema.users (id, username, full_name, email, password_hash, status, is_active)
         VALUES ($1, $2, $3, $2, 'x', $4, $5)`,
        [id, `${key}@test.local`, key === 'off' ? 'Người đã nghỉ' : [an, binh, chi, dung].find((p) => p.userId === id)?.displayName, key === 'off' ? 'disabled' : 'active', key !== 'off'],
      );
    }
    storage = new FakeStorage();
    chat = new ChatService(new TestDatabases(pool) as unknown as ChatDatabases, storage, () => clock);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  beforeEach(async () => {
    clock = new Date();
    await clearOutbox();
  });

  it('cuộc chung toàn công ty có sẵn cho mọi người, đứng đầu danh sách, đếm cả người đang hoạt động', async () => {
    const list = await chat.conversations(an);
    expect(list.items[0]).toMatchObject({ kind: 'company', title: 'Tất cả nội bộ', memberCount: 4, myRole: null, unreadCount: 0 });
    const again = await chat.company(binh);
    expect(again.id).toBe(list.items[0].id);
  });

  it('chat 1-1: mỗi cặp một cuộc, mở hai chiều ra cùng một cuộc; không nhắn được cho mình hay người đã nghỉ', async () => {
    const first = await chat.openDirect(an, ids.binh);
    const second = await chat.openDirect(binh, ids.an);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ kind: 'direct', peerUserId: ids.binh, memberCount: 2, title: null });
    await rejects(chat.openDirect(an, ids.an), 400);
    await rejects(chat.openDirect(an, ids.off), 404);
  });

  it('gửi tin: tin chưa đọc của người nhận, tín hiệu cho người nhận, gửi lại cùng clientId không tạo tin trùng', async () => {
    const direct = await chat.openDirect(an, ids.binh);
    const sent = await chat.send(an, direct.id, { body: '  Chào Bình  ', clientId: 'c-1' });
    expect(sent.message).toMatchObject({ body: 'Chào Bình', senderId: ids.an, kind: 'text', isEdited: false });
    const retry = await chat.send(an, direct.id, { body: 'Chào Bình', clientId: 'c-1' });
    expect(retry.message.id).toBe(sent.message.id);

    const signals = await outbox('core.chat.changed');
    expect(signals).toEqual([
      expect.objectContaining({ conversationId: direct.id, messageId: sent.message.id, change: 'message.created', audience: 'members', recipientUserIds: [ids.binh] }),
    ]);
    const forBinh = (await chat.unread(binh)).unreadTotal;
    expect(forBinh).toBe(1);
    const forAn = (await chat.conversations(an)).items.find((c) => c.id === direct.id);
    expect(forAn).toMatchObject({ unreadCount: 0, lastMessage: expect.objectContaining({ excerpt: 'Chào Bình', senderId: ids.an }) });
  });

  it('đã nhận khi người nhận tải danh sách, đã xem khi người nhận đọc; tín hiệu báo về người gửi', async () => {
    const direct = await chat.openDirect(an, ids.chi);
    const sent = await chat.send(an, direct.id, { body: 'Có ở đó không?' });
    await clearOutbox();
    await chat.conversations(chi);
    expect(await outbox('core.chat.changed')).toEqual([expect.objectContaining({ change: 'delivered', recipientUserIds: [ids.an] })]);
    let page = await chat.messages(an, direct.id);
    const chiMark = page.members.find((m) => m.userId === ids.chi);
    expect(chiMark?.lastDeliveredAt).toBe(sent.message.createdAt);
    expect(chiMark?.lastReadAt).toBeNull();

    await clearOutbox();
    const read = await chat.markRead(chi, direct.id, sent.message.id);
    expect(read.unreadCount).toBe(0);
    expect(await outbox('core.chat.changed')).toEqual([expect.objectContaining({ change: 'read', messageId: sent.message.id, recipientUserIds: [ids.an] })]);
    page = await chat.messages(an, direct.id);
    expect(page.members.find((m) => m.userId === ids.chi)?.lastReadAt).toBe(sent.message.createdAt);
    // Đọc lại cùng tin: mốc không đổi, không phát tín hiệu nữa.
    await clearOutbox();
    await chat.markRead(chi, direct.id, sent.message.id);
    expect(await outbox('core.chat.changed')).toEqual([]);
  });

  it('nhóm: tạo, thêm người, mời ra, rời nhóm (chuyển trưởng nhóm), có tin hệ thống; người ngoài không xem được', async () => {
    const group = await chat.createGroup(an, { title: '  Dự án   A ', memberIds: [ids.binh, ids.off] });
    expect(group).toMatchObject({ kind: 'group', title: 'Dự án A', memberCount: 2, myRole: 'owner' });
    expect(group.memberIds).toEqual([ids.an, ids.binh]);
    await rejects(chat.messages(chi, group.id), 404);

    await chat.addMembers(binh, group.id, [ids.chi, ids.dung]);
    await rejects(chat.removeMember(binh, group.id, ids.chi), 403);
    await chat.removeMember(an, group.id, ids.dung);
    await rejects(chat.messages(dung, group.id), 404);

    await chat.leave(an, group.id);
    const afterLeave = await chat.conversation(binh, group.id);
    expect(afterLeave.memberIds).toEqual([ids.binh, ids.chi]);
    expect(afterLeave.myRole).toBe('owner');

    const page = await chat.messages(binh, group.id);
    expect(page.messages.map((m) => m.systemEvent?.type)).toEqual(['group.created', 'members.added', 'member.removed', 'member.left']);
    await rejects(chat.createGroup(an, { title: '', memberIds: [ids.binh] }), 400);
    await rejects(chat.createGroup(an, { title: 'Một mình', memberIds: [] }), 400);
  });

  it('nhắc tên: chỉ người trong cuộc, có sự kiện thông báo; số tin chưa đọc có nhắc tên', async () => {
    const group = await chat.createGroup(an, { title: 'Nhắc tên', memberIds: [ids.binh] });
    await clearOutbox();
    const sent = await chat.send(an, group.id, { body: '@Trần Thị Bình xem giúp', mentions: [ids.binh, ids.chi] });
    expect(sent.droppedMentions).toEqual([ids.chi]);
    expect(sent.message.mentions).toEqual([ids.binh]);
    expect(await outbox('core.chat.mention')).toEqual([
      expect.objectContaining({
        conversationId: group.id,
        messageId: sent.message.id,
        mentionedUserIds: [ids.binh],
        actorName: 'Nguyễn Văn An',
        conversationTitle: 'Nhắc tên',
        deepLink: `/chat/${group.id}`,
      }),
    ]);
    const mine = (await chat.conversations(binh)).items.find((c) => c.id === group.id);
    expect(mine).toMatchObject({ unreadCount: 1, unreadMentionCount: 1 });
  });

  it('trả lời, sửa trong 15 phút (nhắc tên mới thì báo), thu hồi xoá nội dung và tệp; chỉ người gửi', async () => {
    const direct = await chat.openDirect(an, ids.dung);
    const first = await chat.send(an, direct.id, { body: 'Tin gốc' });
    const reply = await chat.send(dung, direct.id, { body: 'Trả lời', replyToId: first.message.id });
    expect(reply.message.replyTo).toMatchObject({ id: first.message.id, senderId: ids.an, excerpt: 'Tin gốc' });

    await rejects(chat.edit(dung, first.message.id, { body: 'Sửa trộm' }), 403);
    await clearOutbox();
    const edited = await chat.edit(an, first.message.id, { body: 'Tin gốc đã sửa @Phạm Dũng', mentions: [ids.dung] });
    expect(edited).toMatchObject({ body: 'Tin gốc đã sửa @Phạm Dũng', isEdited: true });
    expect((await outbox('core.chat.mention')).length).toBe(1);
    clock = new Date(Date.now() + 16 * 60_000);
    await rejects(chat.edit(an, first.message.id, { body: 'Quá giờ' }), 409);

    const upload = await chat.initiateAttachment(an, { conversationId: direct.id, fileName: 'C:\\tmp\\bao cao.pdf', contentType: 'application/pdf', sizeBytes: 10 });
    expect(upload.attachment.fileName).toBe('bao cao.pdf');
    storage.objects.set(upload.uploadUrl.replace('https://storage.test/upload/', ''), { sizeBytes: 10, contentType: 'application/pdf' });
    await chat.completeAttachment(an, upload.attachment.id);
    const withFile = await chat.send(an, direct.id, { body: '', attachmentIds: [upload.attachment.id] });
    expect(withFile.message.attachments).toEqual([expect.objectContaining({ fileName: 'bao cao.pdf', isImage: false })]);
    const url = await chat.attachmentUrl(dung, upload.attachment.id);
    expect(url.url).toContain('inline=1');

    const recalled = await chat.recall(an, withFile.message.id);
    expect(recalled).toMatchObject({ isDeleted: true, body: '', attachments: [] });
    expect(storage.deleted.some((key) => key.includes(upload.attachment.id))).toBe(true);
    await rejects(chat.attachmentUrl(dung, upload.attachment.id), 404);
    await rejects(chat.recall(an, withFile.message.id), 409);
  });

  it('tệp đính kèm: chặn loại lạ, quá dung lượng, chưa tải xong, của người khác', async () => {
    const direct = await chat.openDirect(binh, ids.chi);
    await rejects(chat.initiateAttachment(binh, { conversationId: direct.id, fileName: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 5 }), 400);
    await rejects(chat.initiateAttachment(binh, { conversationId: direct.id, fileName: 'x.zip', contentType: 'application/zip', sizeBytes: 26 * 1024 * 1024 }), 400);
    await rejects(chat.initiateAttachment(an, { conversationId: direct.id, fileName: 'a.png', contentType: 'image/png', sizeBytes: 5 }), 404);
    const upload = await chat.initiateAttachment(binh, { conversationId: direct.id, fileName: 'anh.png', contentType: 'image/png', sizeBytes: 5 });
    await rejects(chat.completeAttachment(binh, upload.attachment.id), 409);
    await rejects(chat.send(binh, direct.id, { body: 'kèm ảnh', attachmentIds: [upload.attachment.id] }), 400);
    await rejects(chat.completeAttachment(chi, upload.attachment.id), 404);
  });

  it('cảm xúc: thả, đổi, bỏ; mỗi người một cảm xúc mỗi tin', async () => {
    const direct = await chat.openDirect(an, ids.binh);
    const sent = await chat.send(an, direct.id, { body: 'Thả tim đi' });
    await chat.react(binh, sent.message.id, 'love');
    let view = await chat.react(an, sent.message.id, 'love');
    expect(view.reactions).toEqual([{ reaction: 'love', userIds: [ids.binh, ids.an] }]);
    view = await chat.react(binh, sent.message.id, 'haha');
    expect(view.reactions).toEqual(expect.arrayContaining([{ reaction: 'love', userIds: [ids.an] }, { reaction: 'haha', userIds: [ids.binh] }]));
    view = await chat.react(an, sent.message.id, null);
    expect(view.reactions).toEqual([{ reaction: 'haha', userIds: [ids.binh] }]);
    await rejects(chat.react(an, sent.message.id, 'party'), 400);
  });

  it('cuộc chung: tin gửi cho mọi phiên của công ty, ai cũng đọc được; người nhận "đang nhập" theo loại cuộc', async () => {
    const company = await chat.company(an);
    await clearOutbox();
    const sent = await chat.send(chi, company.id, { body: 'Chào cả nhà', mentions: [ids.an, ids.off] });
    expect(sent.droppedMentions).toEqual([ids.off]);
    expect(await outbox('core.chat.changed')).toEqual([expect.objectContaining({ audience: 'company', recipientUserIds: [] })]);
    expect((await chat.conversations(dung)).items[0].unreadCount).toBeGreaterThanOrEqual(1);
    await chat.markRead(dung, company.id, sent.message.id);
    expect((await chat.conversations(dung)).items[0].unreadCount).toBe(0);
    expect(await chat.typingRecipients(an, company.id)).toEqual({ audience: 'company' });
    const direct = await chat.openDirect(an, ids.binh);
    expect(await chat.typingRecipients(an, direct.id)).toEqual({ audience: 'members', userIds: [ids.binh] });
    await rejects(chat.typingRecipients(chi, direct.id), 404);
  });

  it('tắt thông báo một cuộc: không tính vào tổng chưa đọc', async () => {
    const direct = await chat.openDirect(dung, ids.chi);
    await chat.send(dung, direct.id, { body: 'Tin 1' });
    const before = (await chat.unread(chi)).unreadTotal;
    await chat.updateConversation(chi, direct.id, { muted: true });
    expect((await chat.unread(chi)).unreadTotal).toBe(before - 1);
    await rejects(chat.updateConversation(chi, direct.id, { title: 'Đổi tên 1-1' }), 400);
  });

  it('phân trang: trang mới nhất trước, lấy tiếp các tin cũ hơn theo mốc', async () => {
    const group = await chat.createGroup(binh, { title: 'Phân trang', memberIds: [ids.chi] });
    for (let index = 1; index <= 5; index += 1) await chat.send(binh, group.id, { body: `Tin ${index}` });
    const latest = await chat.messages(chi, group.id, { limit: 3 });
    expect(latest.messages.map((m) => m.body)).toEqual(['Tin 3', 'Tin 4', 'Tin 5']);
    expect(latest.hasMore).toBe(true);
    const older = await chat.messages(chi, group.id, { limit: 3, before: latest.messages[0].id });
    expect(older.messages.map((m) => m.body || m.systemEvent?.type)).toEqual(['group.created', 'Tin 1', 'Tin 2']);
    expect(older.hasMore).toBe(false);
  });
});
