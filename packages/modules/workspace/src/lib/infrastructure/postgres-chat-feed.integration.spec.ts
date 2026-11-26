import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { ChatService } from '../application/chat.service.js';
import { ProjectService } from '../application/project.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import { PostgresWorkspaceStore } from './postgres-workspace-store.js';

const adminUrl = process.env.WORKSPACE_TEST_ADMIN_URL;
const integration = adminUrl ? describe : describe.skip;

/** Migration của tenant theo thứ tự đăng ký: core, integration, rồi workspace (như khi bật phân hệ). */
async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const pathsBetween = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...pathsBetween('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...pathsBetween('  workspace: [', '  shared: ['),
  ];
}

/** Trao đổi công việc theo trang: SQL thật (PostgreSQL). */
integration('Workspace: trao đổi công việc theo trang (PostgreSQL)', () => {
  const databaseName = 'ws_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const owner = randomUUID();
  const actor: WorkspaceActor = {
    tenantId,
    userId: owner,
    displayName: 'Chủ nhiệm',
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: true,
    canDeleteDocuments: true,
  };
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let store: PostgresWorkspaceStore;
  let items: WorkItemService;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    store = new PostgresWorkspaceStore(
      { require: () => ({}) } as never,
      { forTenant: async () => pool } as never,
    );
    items = new WorkItemService(store, new ProjectService(store));
    projectId = (await store.project.create(tenantId, owner, { code: 'QA-CF', name: 'Dự án chat' } as never)).id;
    otherProjectId = (await store.project.create(tenantId, owner, { code: 'QA-CG', name: 'Dự án khác' } as never)).id;
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  const item = (project: string, title: string, parentId?: string) =>
    items.create(actor, { projectId: project, title, parentId, assigneeUserId: owner } as never);
  const say = async (
    entityType: 'project' | 'work_item',
    entityId: string,
    project: string,
    body: string,
  ) => {
    const channel = await store.chat.ensureChannel(tenantId, owner, { entityType, entityId, projectId: project });
    return store.chat.sendMessage(tenantId, owner, { channelId: channel.id, body, mentions: [] });
  };
  const feed = (page: number, pageSize = 10, query: { search?: string; onlyWithChat?: boolean } = {}) =>
    store.chat.listProjectFeedPage(tenantId, projectId, page, pageSize, query);

  it('công việc có tin mới nhất đứng trước, kèm tin xem trước và số tin; việc chưa có tin xuống cuối', async () => {
    const root = await item(projectId, 'Gốc');
    const child = await item(projectId, 'Con', root.id);
    const grandchild = await item(projectId, 'Cháu', child.id);
    const silent = await item(projectId, 'Chưa ai nói');
    await say('work_item', root.id, projectId, 'gốc 1');
    await say('work_item', grandchild.id, projectId, 'cháu 1');
    await say('work_item', root.id, projectId, 'gốc 2 ' + 'x'.repeat(300));

    const page = await feed(1);
    expect(page.total).toBe(4);
    expect(page.items.slice(0, 2).map((entry) => entry.workItemId)).toEqual([root.id, grandchild.id]);
    expect(page.items[0].messageCount).toBe(2);
    expect(page.items[0].latestBody?.startsWith('gốc 2 ')).toBe(true);
    expect(page.items[0].latestBody?.length).toBe(160);
    expect(page.items[0].latestBy).toBe(owner);
    expect(page.items[1].messageCount).toBe(1);
    expect(page.items[1].latestBody).toBe('cháu 1');
    // Danh sách chỉ tóm tắt, không kèm tin nhắn.
    expect('messages' in page.items[0]).toBe(false);
    // Hai việc cuối chưa có tin.
    const rest = page.items.slice(2);
    expect(rest.map((entry) => entry.workItemId).sort()).toEqual([child.id, silent.id].sort());
    expect(rest.every((entry) => entry.messageCount === 0 && entry.latestAt === undefined && entry.latestBody === undefined)).toBe(true);
  });

  it('không tính chat chung của dự án, chat của dự án khác, tin thu hồi và kênh việc đã xoá', async () => {
    const live = await item(projectId, 'Còn sống');
    await say('project', projectId, projectId, 'tin chung dự án');
    const foreign = await item(otherProjectId, 'Việc dự án khác');
    await say('work_item', foreign.id, otherProjectId, 'dự án khác');
    const recalled = await say('work_item', live.id, projectId, 'sẽ thu hồi');
    await store.chat.softDeleteMessage(tenantId, owner, recalled.id);
    const gone = await item(projectId, 'Sắp xoá');
    await say('work_item', gone.id, projectId, 'tin mồ côi');
    await pool.query('DELETE FROM workspace_schema.work_items WHERE id = $1', [gone.id]);

    const all = await feed(1, 100);
    const previews = all.items.map((entry) => entry.latestBody);
    expect(previews).not.toContain('tin chung dự án');
    expect(previews).not.toContain('dự án khác');
    expect(previews).not.toContain('sẽ thu hồi');
    expect(previews).not.toContain('tin mồ côi');
    expect(all.items.some((entry) => entry.workItemId === gone.id)).toBe(false);
    expect(all.items.find((entry) => entry.workItemId === live.id)?.messageCount).toBe(0);
  });

  it('phân trang theo công việc với cỡ trang tuỳ chọn: trang sau không lặp trang trước và tổng đúng', async () => {
    for (let index = 1; index <= 12; index += 1) {
      const entry = await item(projectId, `Phân trang ${index}`);
      await say('work_item', entry.id, projectId, `pt${index}`);
    }
    const first = await feed(1, 5);
    const second = await feed(2, 5);
    const total = first.total;
    expect(second.total).toBe(total);
    expect(first.items).toHaveLength(5);
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((entry) => entry.workItemId)).size).toBe(10);
    const beyond = await feed(Math.ceil(total / 5) + 1, 5);
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(total);
    // Cỡ trang lớn hơn lấy một lượt nhiều công việc hơn.
    expect((await feed(1, 20)).items).toHaveLength(Math.min(20, total));
  });

  it('lọc chỉ công việc có trao đổi: tổng và phân trang tính theo bộ lọc, không tính tin thu hồi', async () => {
    const withChat = await item(projectId, 'Có chat lọc');
    const recalledOnly = await item(projectId, 'Chỉ có tin thu hồi');
    await item(projectId, 'Im lặng lọc');
    await say('work_item', withChat.id, projectId, 'có chat');
    const gone = await say('work_item', recalledOnly.id, projectId, 'rồi thu hồi');
    await store.chat.softDeleteMessage(tenantId, owner, gone.id);

    const filtered = await feed(1, 100, { onlyWithChat: true });
    const ids = filtered.items.map((entry) => entry.workItemId);
    expect(ids).toContain(withChat.id);
    expect(ids).not.toContain(recalledOnly.id);
    expect(filtered.items.every((entry) => entry.messageCount > 0)).toBe(true);
    expect(filtered.total).toBe(filtered.items.length);
    const unfiltered = await feed(1, 100);
    expect(unfiltered.total).toBeGreaterThan(filtered.total);
    // Phân trang trong kết quả đã lọc.
    const small = await feed(1, 2, { onlyWithChat: true });
    expect(small.items).toHaveLength(2);
    expect(small.total).toBe(filtered.total);
  });

  it('tìm theo mã, tiêu đề hoặc nội dung tin; ký tự đặc biệt của LIKE được coi là chữ thường', async () => {
    const byTitle = await item(projectId, 'Hợp đồng Ánh Dương');
    const byChat = await item(projectId, 'Việc bình thường tìm');
    const percent = await item(projectId, 'Giảm 50% chi phí');
    const underscore = await item(projectId, 'Việc a_b tìm');
    await item(projectId, 'Việc axb tìm');
    await say('work_item', byChat.id, projectId, 'Nhớ gửi BÁO GIÁ cho khách');
    const a = await feed(1, 100, { search: 'ÁNH dương' });
    expect(a.items.map((entry) => entry.workItemId)).toEqual([byTitle.id]);
    expect(a.total).toBe(1);
    const b = await feed(1, 100, { search: 'báo giá' });
    expect(b.items.map((entry) => entry.workItemId)).toEqual([byChat.id]);
    const c = await feed(1, 100, { search: '50%' });
    expect(c.items.map((entry) => entry.workItemId)).toEqual([percent.id]);
    const d = await feed(1, 100, { search: 'a_b' });
    expect(d.items.map((entry) => entry.workItemId)).toEqual([underscore.id]);
    const byCode = await feed(1, 100, { search: byTitle.code });
    expect(byCode.items.map((entry) => entry.workItemId)).toContain(byTitle.id);
    // Tìm và lọc kết hợp: việc chỉ khớp theo tiêu đề nhưng không có chat thì bị loại.
    expect((await feed(1, 100, { search: 'ánh dương', onlyWithChat: true })).items).toEqual([]);
    expect((await feed(1, 100, { search: 'báo giá', onlyWithChat: true })).items).toHaveLength(1);
    // Tin đã thu hồi không còn được tìm thấy.
    const secret = await item(projectId, 'Việc bí mật tìm');
    const recalled = await say('work_item', secret.id, projectId, 'mã-bí-mật-xyz');
    expect((await feed(1, 100, { search: 'mã-bí-mật-xyz' })).items).toHaveLength(1);
    await store.chat.softDeleteMessage(tenantId, owner, recalled.id);
    expect((await feed(1, 100, { search: 'mã-bí-mật-xyz' })).items).toEqual([]);
  });

  it('đọc danh sách và đọc trao đổi một công việc không đổi mốc đã đọc, không ghi tín hiệu', async () => {
    const readItem = await item(projectId, 'Đọc không đánh dấu');
    await say('work_item', readItem.id, projectId, 'tin để đọc');
    // Một mốc đã đọc có sẵn để so nội dung (không chỉ đếm dòng).
    const channel = await store.chat.findChannel(tenantId, 'work_item', readItem.id);
    const newest = (await store.chat.listMessages(tenantId, channel?.id as string, 1)).messages[0];
    await store.chat.markRead(tenantId, channel?.id as string, owner, newest.id, { announce: false });
    const snapshot = async () => ({
      reads: (await pool.query('SELECT * FROM workspace_schema.chat_reads ORDER BY channel_id, user_id')).rows,
      outbox: (await pool.query('SELECT count(*)::int AS n FROM integration_schema.outbox_events')).rows[0].n,
    });
    const before = await snapshot();
    await feed(1, 100);
    await feed(1, 100, { search: 'tin để đọc', onlyWithChat: true });
    const chat = new ChatService(store, new ProjectService(store));
    const thread = await chat.projectFeedThread(actor, projectId, readItem.id);
    expect(thread.messages.map((m) => m.body)).toEqual(['tin để đọc']);
    expect(await snapshot()).toEqual(before);
  });

  it('listMessagesFrom: từ tin đích tới mới nhất trong một truy vấn, đúng biên hasMore và trần, không lấy tin kênh khác', async () => {
    const node = await item(projectId, 'Mở từ tin được nhắc');
    const sent = [];
    for (let index = 0; index < 8; index += 1) sent.push(await say('work_item', node.id, projectId, `tin ${index}`));
    const channelId = sent[0].channelId;

    const bodies = (page: { messages: readonly { body: string }[] } | undefined) => page?.messages.map((m) => m.body);

    // Tin giữa luồng: 2 tin ngữ cảnh phía trên, rồi chính nó tới tin mới nhất (cũ → mới); còn tin cũ hơn nữa.
    const middle = await store.chat.listMessagesFrom(tenantId, channelId, sent[3].id, 100, 2);
    expect(bodies(middle)).toEqual(['tin 1', 'tin 2', 'tin 3', 'tin 4', 'tin 5', 'tin 6', 'tin 7']);
    expect(middle?.hasMore).toBe(true);

    // Ngữ cảnh vừa chạm tin đầu tiên của kênh: không còn tin cũ hơn.
    const exact = await store.chat.listMessagesFrom(tenantId, channelId, sent[3].id, 100, 3);
    expect(exact?.messages).toHaveLength(8);
    expect(exact?.hasMore).toBe(false);
    // Ngữ cảnh rộng hơn số tin sẵn có cũng không lỗi.
    expect((await store.chat.listMessagesFrom(tenantId, channelId, sent[3].id, 100, 50))?.hasMore).toBe(false);

    // Tin cũ nhất: không có ngữ cảnh, không còn tin cũ hơn. Tin mới nhất: ngữ cảnh + chính nó.
    const oldest = await store.chat.listMessagesFrom(tenantId, channelId, sent[0].id, 100, 2);
    expect(oldest?.messages).toHaveLength(8);
    expect(oldest?.hasMore).toBe(false);
    const newest = await store.chat.listMessagesFrom(tenantId, channelId, sent[7].id, 100, 2);
    expect(bodies(newest)).toEqual(['tin 5', 'tin 6', 'tin 7']);
    expect(newest?.hasMore).toBe(true);

    // Trần chỉ tính phần từ tin đích tới mới nhất (5 tin), không tính ngữ cảnh: 5 dùng được, 4 vượt trần nên bỏ.
    expect((await store.chat.listMessagesFrom(tenantId, channelId, sent[3].id, 5, 2))?.messages).toHaveLength(7);
    expect(await store.chat.listMessagesFrom(tenantId, channelId, sent[3].id, 4, 2)).toBeUndefined();

    // Tin của kênh khác, hay id không tồn tại: không dùng được.
    const other = await item(projectId, 'Kênh khác');
    const stray = await say('work_item', other.id, projectId, 'tin lạc kênh');
    expect(await store.chat.listMessagesFrom(tenantId, channelId, stray.id, 100, 2)).toBeUndefined();
    expect(await store.chat.listMessagesFrom(tenantId, channelId, randomUUID(), 100, 2)).toBeUndefined();

    // Cả đường service: định vị tin, rồi mở luồng từ tin đó.
    const chat = new ChatService(store, new ProjectService(store));
    expect(await chat.locate(actor, sent[3].id)).toEqual({
      messageId: sent[3].id,
      channelId,
      entityType: 'work_item',
      entityId: node.id,
      projectId,
    });
    const thread = await chat.thread(actor, 'work_item', node.id, undefined, sent[3].id);
    expect(thread.focusFound).toBe(true);
    // Có ngữ cảnh phía trên (tối đa CHAT_JUMP_CONTEXT_MESSAGES tin; kênh này chỉ có 3 tin cũ hơn tin đích).
    expect(thread.messages.map((m) => m.body)).toEqual([
      'tin 0', 'tin 1', 'tin 2', 'tin 3', 'tin 4', 'tin 5', 'tin 6', 'tin 7',
    ]);
    expect(thread.hasMore).toBe(false);
  });

  it('tin mới ghi sự kiện báo đúng người: việc → người phụ trách + người cùng thực hiện, dự án → mọi thành viên; trừ người gửi và người được nhắc', async () => {
    const [assignee, coWorker, bystander] = [randomUUID(), randomUUID(), randomUUID()];
    const project = (await store.project.create(tenantId, owner, { code: 'QA-NT', name: 'Thông báo tin' } as never)).id;
    await store.member.replaceAll(tenantId, project, owner, [
      { userId: owner, role: 'owner' },
      { userId: assignee, role: 'member' },
      { userId: coWorker, role: 'member' },
      { userId: bystander, role: 'member' },
    ]);
    const node = await items.create(actor, {
      projectId: project,
      title: 'Việc có người thực hiện cùng',
      assigneeUserId: assignee,
      participantUserIds: [coWorker],
    } as never);
    const send = async (
      entityType: 'project' | 'work_item',
      entityId: string,
      sender: string,
      body: string,
      mentions: string[] = [],
    ) => {
      const channel = await store.chat.ensureChannel(tenantId, sender, { entityType, entityId, projectId: project });
      return store.chat.sendMessage(tenantId, sender, { channelId: channel.id, body, mentions });
    };
    const notice = async (messageId: string) => {
      const rows = (
        await pool.query(
          `SELECT payload FROM integration_schema.outbox_events
            WHERE event_type = 'workspace.chat.message.created' AND aggregate_id = $1`,
          [messageId],
        )
      ).rows;
      // Cột `payload` giữ cả phong bì sự kiện; nội dung nghiệp vụ nằm ở `payload.payload`.
      return rows.length === 0
        ? undefined
        : (rows[0].payload.payload as { recipientUserIds: string[]; entityLabel: string });
    };
    const sorted = (ids: string[] | undefined) => [...(ids ?? [])].sort();

    // Người ngoài việc (chủ dự án) nhắn trong việc: báo người phụ trách và người cùng thực hiện, không báo người chỉ là thành viên dự án.
    const first = await send('work_item', node.id, owner, 'Nhờ hai bạn xem việc này');
    const firstNotice = await notice(first.id);
    expect(sorted(firstNotice?.recipientUserIds)).toEqual(sorted([assignee, coWorker]));
    expect(firstNotice?.entityLabel).toContain('Việc có người thực hiện cùng');

    // Người phụ trách nhắn: không tự báo cho mình, người cùng thực hiện vẫn nhận.
    const second = await send('work_item', node.id, assignee, 'Mình đã nhận');
    expect((await notice(second.id))?.recipientUserIds).toEqual([coWorker]);

    // Nhắc tên người cùng thực hiện: họ đã có thông báo nhắc tên nên không nhận thêm thông báo tin mới.
    const third = await send('work_item', node.id, owner, 'Nhờ @coWorker', [coWorker]);
    expect((await notice(third.id))?.recipientUserIds).toEqual([assignee]);

    // Chỉ còn người được nhắc để báo: không ghi sự kiện tin mới.
    const fourth = await send('work_item', node.id, owner, 'Riêng @assignee', [assignee, coWorker]);
    expect(await notice(fourth.id)).toBeUndefined();

    // Trao đổi chung của dự án: mọi thành viên trừ người gửi.
    const general = await send('project', project, owner, 'Thông báo chung cho cả nhóm');
    expect(sorted((await notice(general.id))?.recipientUserIds)).toEqual(sorted([assignee, coWorker, bystander]));
    const reply = await send('project', project, bystander, 'Đã rõ');
    expect(sorted((await notice(reply.id))?.recipientUserIds)).toEqual(sorted([owner, assignee, coWorker]));
  });

  describe('dòng thời gian và trả lời', () => {
    it('xếp tin của mọi công việc (và chat chung) theo giờ, bỏ tin thu hồi và tin dự án khác, kèm tin gốc của trả lời', async () => {
      const timelineProject = (await store.project.create(tenantId, owner, { code: 'QA-TL', name: 'Dòng thời gian' } as never)).id;
      const a = await item(timelineProject, 'Việc A');
      const b = await item(timelineProject, 'Việc B');
      const talk = async (type: 'project' | 'work_item', id: string, body: string, parentId?: string) => {
        const channel = await store.chat.ensureChannel(tenantId, owner, { entityType: type, entityId: id, projectId: timelineProject });
        return store.chat.sendMessage(tenantId, owner, { channelId: channel.id, body, mentions: [], parentId });
      };
      const a1 = await talk('work_item', a.id, 'A 13h');
      await talk('work_item', b.id, 'B 14h');
      await talk('work_item', a.id, 'A 15h', a1.id);
      const gone = await talk('work_item', b.id, 'B bị thu hồi');
      await talk('project', timelineProject, 'Chung 20h');
      await store.chat.softDeleteMessage(tenantId, owner, gone.id);
      const elsewhere = await item(otherProjectId, 'Việc ở dự án khác');
      await say('work_item', elsewhere.id, otherProjectId, 'tin dự án khác');

      const page = await store.chat.listProjectTimeline(tenantId, timelineProject, 30);
      expect(page.items.map((entry) => entry.message.body)).toEqual(['A 13h', 'B 14h', 'A 15h', 'Chung 20h']);
      expect(page.hasMore).toBe(false);
      expect(page.items.map((entry) => [entry.entityType, entry.entityId])).toEqual([
        ['work_item', a.id],
        ['work_item', b.id],
        ['work_item', a.id],
        ['project', timelineProject],
      ]);
      expect(page.items[2].parent).toMatchObject({ id: a1.id, body: 'A 13h', isDeleted: false });
      expect(page.items[0].parent).toBeUndefined();

      // Phân trang bằng mốc: trang mới nhất 2 tin, rồi trang liền trước, không lặp không sót.
      const newest = await store.chat.listProjectTimeline(tenantId, timelineProject, 2);
      expect(newest.items.map((entry) => entry.message.body)).toEqual(['A 15h', 'Chung 20h']);
      expect(newest.hasMore).toBe(true);
      const older = await store.chat.listProjectTimeline(tenantId, timelineProject, 2, newest.items[0].message.id);
      expect(older.items.map((entry) => entry.message.body)).toEqual(['A 13h', 'B 14h']);
      expect(older.hasMore).toBe(false);

      // Mốc là tin của dự án khác thì không dùng được để dò thời điểm: trang rỗng.
      const foreign = await store.chat.listProjectTimeline(tenantId, projectId, 30, page.items[0].message.id);
      expect(foreign.items).toEqual([]);
    });

    it('lọc theo từ khoá, người gửi, công việc, nhắc tôi, đính kèm và khoảng thời gian; phân trang vẫn đúng', async () => {
      const filterProject = (await store.project.create(tenantId, owner, { code: 'QA-FL', name: 'Bộ lọc' } as never)).id;
      const a = await item(filterProject, 'Lọc A');
      const b = await item(filterProject, 'Lọc B');
      const other = '99999999-9999-4999-8999-999999999999';
      const talk = async (type: 'project' | 'work_item', id: string, who: string, body: string, mentions: string[] = []) => {
        const channel = await store.chat.ensureChannel(tenantId, who, { entityType: type, entityId: id, projectId: filterProject });
        return store.chat.sendMessage(tenantId, who, { channelId: channel.id, body, mentions });
      };
      await talk('work_item', a.id, owner, 'Báo giá thiết bị 100%');
      await talk('work_item', a.id, other, 'Đã gửi báo giá', [owner]);
      await talk('work_item', b.id, other, 'Hợp đồng_mới xong');
      await talk('project', filterProject, owner, 'Chào cả nhà');
      const list = async (filter: object, limit = 30) =>
        (await store.chat.listProjectTimeline(tenantId, filterProject, limit, undefined, filter)).items.map(
          (entry) => entry.message.body,
        );

      expect(await list({ q: 'BÁO GIÁ' })).toEqual(['Báo giá thiết bị 100%', 'Đã gửi báo giá']);
      // Ký tự đặc biệt của LIKE được hiểu theo nghĩa đen: "%" và "_" không phải ký tự đại diện.
      expect(await list({ q: '100%' })).toEqual(['Báo giá thiết bị 100%']);
      expect(await list({ q: 'Hợp đồng_' })).toEqual(['Hợp đồng_mới xong']);
      expect(await list({ q: 'Hợp đồng%' })).toEqual([]);
      expect(await list({ authors: [other] })).toEqual(['Đã gửi báo giá', 'Hợp đồng_mới xong']);
      expect(await list({ authors: [other, owner] })).toHaveLength(4);
      expect(await list({ nodes: [a.id] })).toEqual(['Báo giá thiết bị 100%', 'Đã gửi báo giá']);
      expect(await list({ nodes: ['project'] })).toEqual(['Chào cả nhà']);
      // Chọn nhiều: công việc A, công việc B và chat chung = tất cả; A + chat chung bỏ tin của B.
      expect(await list({ nodes: [a.id, b.id, 'project'] })).toHaveLength(4);
      expect(await list({ nodes: [a.id, 'project'] })).toEqual(['Báo giá thiết bị 100%', 'Đã gửi báo giá', 'Chào cả nhà']);
      expect(await list({ nodes: [b.id] })).toEqual(['Hợp đồng_mới xong']);
      expect(await list({ mentionUserId: owner })).toEqual(['Đã gửi báo giá']);
      expect(await list({ q: 'báo giá', authors: [other], nodes: [a.id] })).toEqual(['Đã gửi báo giá']);
      expect(await list({ from: '2999-01-01T00:00:00.000Z' })).toEqual([]);
      expect(await list({ to: '2000-01-01T00:00:00.000Z' })).toEqual([]);
      expect(await list({ from: '2000-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z', hasAttachment: false })).toHaveLength(4);

      // Phân trang trên kết quả đã lọc: không lặp, không sót.
      const first = await store.chat.listProjectTimeline(tenantId, filterProject, 1, undefined, { authors: [other] });
      expect(first.items.map((entry) => entry.message.body)).toEqual(['Hợp đồng_mới xong']);
      expect(first.hasMore).toBe(true);
      const second = await store.chat.listProjectTimeline(tenantId, filterProject, 1, first.items[0].message.id, {
        authors: [other],
      });
      expect(second.items.map((entry) => entry.message.body)).toEqual(['Đã gửi báo giá']);
      expect(second.hasMore).toBe(false);
    });

    it('tin đính kèm nhiều tài liệu: cột cũ giữ tệp đầu, tin cũ chỉ có một tệp vẫn đọc ra mảng, bộ lọc đính kèm đúng', async () => {
      const attachProject = (await store.project.create(tenantId, owner, { code: 'QA-AT', name: 'Đính kèm' } as never)).id;
      const folder = await store.document.createFolder(tenantId, owner, { projectId: attachProject, name: 'Tệp', depth: 1 });
      const doc = async (name: string) =>
        (
          await pool.query<{ id: string }>(
            `INSERT INTO workspace_schema.documents (folder_id, project_id, name, created_by)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [folder.id, attachProject, name, owner],
          )
        ).rows[0]?.id as string;
      const [d1, d2, d3] = [await doc('a.pdf'), await doc('b.png'), await doc('c.csv')];
      const channel = await store.chat.ensureChannel(tenantId, owner, {
        entityType: 'project',
        entityId: attachProject,
        projectId: attachProject,
      });
      const send = (body: string, ids?: readonly string[]) =>
        store.chat.sendMessage(tenantId, owner, {
          channelId: channel.id,
          body,
          mentions: [],
          attachmentDocumentId: ids?.[0] ?? null,
          attachmentDocumentIds: ids,
        });

      const many = await send('ba tệp', [d1, d2, d3]);
      expect(many.attachmentDocumentIds).toEqual([d1, d2, d3]);
      expect(many.attachmentDocumentId).toBe(d1);

      // Tin cũ (trước khi có cột mảng): chỉ cột cũ có giá trị.
      const legacy = await send('tin cũ');
      await pool.query(
        `UPDATE workspace_schema.chat_messages
            SET attachment_document_id = $2, attachment_document_ids = '{}'
          WHERE id = $1`,
        [legacy.id, d2],
      );
      await send('không tệp');

      const read = (await store.chat.listProjectTimeline(tenantId, attachProject, 30, undefined, {})).items;
      const byBody = new Map(read.map((entry) => [entry.message.body, entry.message]));
      expect(byBody.get('ba tệp')?.attachmentDocumentIds).toEqual([d1, d2, d3]);
      expect(byBody.get('tin cũ')?.attachmentDocumentIds).toEqual([d2]);
      expect(byBody.get('không tệp')?.attachmentDocumentIds).toEqual([]);

      const withFile = await store.chat.listProjectTimeline(tenantId, attachProject, 30, undefined, { hasAttachment: true });
      expect(withFile.items.map((entry) => entry.message.body).sort()).toEqual(['ba tệp', 'tin cũ']);
    });

    it('trả lời một tin đi vào ĐÚNG kênh của công việc đó và hiện trong trao đổi của nó', async () => {
      const a = await item(projectId, 'Trả lời A');
      const b = await item(projectId, 'Trả lời B');
      const first = await say('work_item', a.id, projectId, 'hỏi ở A');
      await say('work_item', b.id, projectId, 'nói ở B');
      const chat = new ChatService(store, new ProjectService(store));

      const { message } = await chat.reply(actor, first.id, { body: 'đáp ở A' });
      const replyToReply = (await chat.reply(actor, message.id, { body: 'đáp tiếp' })).message;

      const channelA = await store.chat.findChannel(tenantId, 'work_item', a.id);
      expect(message.channelId).toBe(channelA?.id);
      expect(message.parentId).toBe(first.id);
      // Trả lời một câu trả lời thì gắn vào tin gốc, vẫn cùng kênh A.
      expect(replyToReply.parentId).toBe(first.id);
      expect(replyToReply.channelId).toBe(channelA?.id);

      const threadA = await chat.projectFeedThread(actor, projectId, a.id);
      expect(threadA.messages.map((m) => m.body)).toEqual(['hỏi ở A', 'đáp ở A', 'đáp tiếp']);
      const threadB = await chat.projectFeedThread(actor, projectId, b.id);
      expect(threadB.messages.map((m) => m.body)).toEqual(['nói ở B']);
    });
  });
});
