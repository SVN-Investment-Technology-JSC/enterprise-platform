import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';
import { PostgresCorrespondenceStore } from './postgres-correspondence-store.js';

const integration = process.env.CORRESPONDENCE_TEST_ADMIN_URL ? describe : describe.skip;

const TENANT = 'tenant-1';
const MIGRATIONS = [
  '0001-correspondence.sql',
  '0002-incoming-outgoing-flows.sql',
  '0003-revoke-and-delete.sql',
  '0004-dynamic-workflow-steps.sql',
  '0005-directive-intake-tracking.sql',
].map((file) =>
  resolve(process.cwd(), '../../../migrations/tenant/correspondence', file),
);

/** Migrator chạy mỗi file một lần, trong một transaction (SET LOCAL cần transaction). */
async function migrate(pool: Pool, files: readonly string[] = MIGRATIONS): Promise<void> {
  for (const file of files) {
    await pool.query(`BEGIN; ${await readFile(file, 'utf8')}; COMMIT;`);
  }
}

integration('Sổ công văn (PostgreSQL)', () => {
  const databaseName = 'correspondence_test_' + randomUUID().replace(/-/g, '');
  const clerk = randomUUID();
  const leader = randomUUID();
  const author = randomUUID();
  const handler = randomUUID();
  const mentioned = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let store: PostgresCorrespondenceStore;

  beforeAll(async () => {
    const url = new URL(process.env.CORRESPONDENCE_TEST_ADMIN_URL as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    // Phần của migration lõi mà kho đọc: người dùng, quyền, outbox.
    await pool.query(`
      CREATE SCHEMA core_schema;
      CREATE TABLE core_schema.users (id UUID PRIMARY KEY, full_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        is_active BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE core_schema.user_roles (user_id UUID, role_id UUID);
      CREATE TABLE core_schema.role_permissions (role_id UUID, permission_id UUID);
      CREATE TABLE core_schema.permission_actions (permission_id UUID, action_key TEXT);
      CREATE TABLE core_schema.user_permission_grants (user_id UUID, action_key TEXT);
      CREATE SCHEMA integration_schema;
      CREATE TABLE integration_schema.outbox_events (id uuid PRIMARY KEY, aggregate_type varchar(100) NOT NULL,
        aggregate_id varchar(160) NOT NULL, event_type varchar(160) NOT NULL, event_version integer NOT NULL,
        payload jsonb NOT NULL, occurred_at timestamptz NOT NULL);`);
    await pool.query(`INSERT INTO core_schema.users (id, full_name) VALUES ($1, 'Văn thư'), ($2, 'Lãnh đạo')`, [clerk, leader]);
    await pool.query(`INSERT INTO core_schema.user_permission_grants VALUES ($1, 'correspondence.letter.direct')`, [leader]);
    await migrate(pool);
    store = new PostgresCorrespondenceStore(
      { require: () => ({}) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    );
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^correspondence_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it('migration 0002 tới 0005 chạy lại được; mỗi luồng một quy trình mặc định, bước cứng cũ thành bước đầu', async () => {
    // Lỗi giữa chừng lúc deploy thì migrator chạy lại đúng file đó.
    await migrate(pool, MIGRATIONS.slice(1));
    expect(await store.tablesReady(TENANT)).toBe(true);
    const catalog = await store.catalog(TENANT);
    expect(catalog.filter((item) => item.kind === 'urgency').map((item) => item.code)).toEqual(['normal', 'urgent', 'top_urgent', 'flash']);
    const workflows = await store.workflows(TENANT);
    expect(workflows.filter((item) => item.isDefault).map((item) => item.direction)).toEqual(['incoming', 'outgoing']);
    const incoming = workflows.find((item) => item.isDefault && item.direction === 'incoming');
    expect(incoming?.steps.map((step) => [step.type, step.approver?.type])).toEqual([
      ['process', undefined],
      ['approve', 'handling_unit_heads'],
      ['approve', 'choose'],
    ]);
    expect(incoming?.steps[1]).not.toHaveProperty('kind');
    const outgoing = workflows.find((item) => item.isDefault && item.direction === 'outgoing');
    expect(outgoing?.steps.map((step) => step.type)).toEqual(['check', 'approve', 'approve']);
    expect(await store.leaders(TENANT)).toEqual([{ userId: leader, name: 'Lãnh đạo' }]);
  });

  it('số đến và số dự thảo đếm riêng; bước, phòng ban, người xử lý, trao đổi, outbox; lọc theo quyền xem', async () => {
    const base = {
      receivedOn: '2026-11-12',
      senderOrg: 'Sở Tài chính',
      subject: 'Giải trình',
      kind: 'finance',
      urgency: 'normal',
      confidentiality: 'confidential',
      receivedBy: clerk,
    };
    const first = await store.createLetter(TENANT, { ...base, direction: 'incoming', stage: 'received' }, { counter: 'incoming', suffix: 'CVĐ' }, async (tx) =>
      tx.history({ action: 'receive', summary: 'Vào sổ' }),
    );
    const second = await store.createLetter(TENANT, { ...base, direction: 'incoming', stage: 'received' }, { counter: 'incoming', suffix: 'CVĐ' }, async () => undefined);
    const authorUnit = randomUUID();
    const draft = await store.createLetter(
      TENANT,
      { ...base, confidentiality: 'normal', direction: 'outgoing', stage: 'drafting', authorUserId: author, authorUnitId: authorUnit, authorUnitName: 'Phòng Kế toán', recipient: 'Sở', relatedLetterId: first.id, receivedBy: author },
      { counter: 'draft', suffix: 'DT' },
      async () => undefined,
    );
    expect([first.incomingNo, second.incomingNo, draft.incomingNo]).toEqual(['1/CVĐ', '2/CVĐ', '1/DT']);
    expect(draft).toMatchObject({ direction: 'outgoing', stage: 'drafting', authorUnitName: 'Phòng Kế toán', relatedLetterId: first.id });

    const workflow = (await store.workflows(TENANT)).find((item) => item.isDefault && item.direction === 'incoming');
    const unitId = randomUUID();
    await store.withLetter(TENANT, first.id, async (tx) => {
      await tx.replaceSteps([{ ...(workflow?.steps[0] ?? { key: 'a', name: 'A', approver: { type: 'handling_unit_heads' } }), rejectTo: 'handlers' }]);
      await tx.assign([{ unitId, unitName: 'Phòng Kế toán', handlerUserId: handler }]);
      expect(tx.assignments[0]).toMatchObject({ handlerUserId: handler, status: 'pending' });
      await tx.update({ stage: 'processing', workflowId: workflow?.id, workflowName: workflow?.name });
      await tx.submitAssignment(tx.assignments[0].id, { note: 'Xong', userId: handler });
      await tx.updateStep(tx.steps[0].id, { status: 'active', activate: true, assigneeUserIds: [leader] });
      await tx.update({ stage: 'reviewing' });
      await tx.addComment({ stage: 'reviewing', stepName: tx.steps[0].name, body: 'Nhờ xem giúp', mentionedUserIds: [mentioned], authorId: leader });
      expect(tx.mentionedUserIds).toEqual([mentioned]);
      await tx.outbox({ type: 'correspondence.letter.step-assigned', payload: { recipientUserIds: [leader] } });
    });
    const steps = await store.steps(TENANT, first.id);
    expect(steps).toEqual([expect.objectContaining({ status: 'active', assigneeUserIds: [leader], rejectTo: 'handlers' })]);
    expect(await store.comments(TENANT, first.id)).toEqual([expect.objectContaining({ body: 'Nhờ xem giúp', mentionedUserIds: [mentioned] })]);

    // Mật: người ngoài không thấy; người được giao bước, người xử lý, người được nhắc tên thì thấy.
    const outsider = { userId: randomUUID(), unitIds: [], readAll: true, readConfidential: false };
    expect((await store.listLetters(TENANT, { visibleTo: outsider, limit: 10 })).map((row) => row.id)).toEqual([draft.id]);
    for (const userId of [leader, handler, mentioned]) {
      const rows = await store.listLetters(TENANT, { visibleTo: { ...outsider, userId }, direction: 'incoming', limit: 10 });
      expect(rows.map((row) => row.id)).toEqual([first.id]);
    }
    const [row] = await store.listLetters(TENANT, { visibleTo: { ...outsider, userId: mentioned }, direction: 'incoming', limit: 10 });
    expect(row).toMatchObject({ mentionedUserIds: [mentioned], assignments: [expect.objectContaining({ unitName: 'Phòng Kế toán', handlerUserId: handler })] });
    // Cùng phòng soạn thấy công văn đi; lọc năm, luồng.
    const colleague = { userId: randomUUID(), unitIds: [authorUnit], readAll: false, readConfidential: false };
    expect((await store.listLetters(TENANT, { visibleTo: colleague, limit: 10 })).map((item) => item.id)).toEqual([draft.id]);
    expect(await store.listLetters(TENANT, { year: 2025, limit: 10 })).toEqual([]);

    // Ban hành: số đi, số hồ sơ, tình trạng gửi.
    await store.withLetter(TENANT, draft.id, async (tx) => {
      const no = await tx.nextNumber('outgoing', 2026);
      const archive = await tx.nextNumber('archive', 2026);
      await tx.update({ stage: 'archived', outgoingNo: `${no}/CV`, archiveCode: `HS-2026-${archive}`, deliveryStatus: 'sent', deliveryMethod: 'Bưu điện', publishedOn: '2026-11-12' });
    });
    expect(await store.findLetter(TENANT, draft.id)).toMatchObject({ outgoingNo: '1/CV', deliveryStatus: 'sent', deliveryMethod: 'Bưu điện' });

    // Phòng ban: giao lại không người xử lý, đổi người xử lý, bỏ phòng.
    await store.withLetter(TENANT, second.id, async (tx) => {
      await tx.assign([{ unitId, unitName: 'Phòng Kế toán' }]);
      await tx.setHandler(tx.assignments[0].id, handler);
      expect(tx.assignments[0].handlerUserId).toBe(handler);
      await tx.removeAssignments([tx.assignments[0].id]);
      expect(tx.assignments).toEqual([]);
    });

    const events = await pool.query(`SELECT event_type FROM integration_schema.outbox_events`);
    expect(events.rows).toEqual([{ event_type: 'correspondence.letter.step-assigned' }]);
    expect((await store.history(TENANT, first.id)).map((item) => item.action)).toEqual(['receive']);
  });

  it('đề nghị huỷ: người xác nhận thấy công văn, vẫn đếm là đã lưu trữ; công văn đã xoá không còn đọc được', async () => {
    const letter = await store.createLetter(
      TENANT,
      { direction: 'outgoing', stage: 'drafting', receivedOn: '2026-11-13', senderOrg: 'P', subject: 'Thông báo', kind: 'finance', urgency: 'normal', confidentiality: 'normal', receivedBy: author, authorUserId: author },
      { counter: 'draft', suffix: 'DT' },
      async () => undefined,
    );
    const approver = randomUUID();
    const nobody = { userId: approver, unitIds: [], readAll: false, readConfidential: false };
    await store.withLetter(TENANT, letter.id, (tx) => tx.update({ stage: 'archived' }));
    const archivedBefore = await store.countArchived(TENANT);
    expect(await store.listLetters(TENANT, { visibleTo: nobody, limit: 10 })).toEqual([]);

    const requestedAt = new Date().toISOString();
    await store.withLetter(TENANT, letter.id, (tx) =>
      tx.update({ stage: 'revoking', revokeKind: 'recall', revokeReason: 'Sai số liệu', revokeRequestedBy: clerk, revokeRequestedAt: requestedAt, revokeApproverIds: [approver] }),
    );
    expect(await store.findLetter(TENANT, letter.id)).toMatchObject({
      stage: 'revoking',
      revokeKind: 'recall',
      revokeReason: 'Sai số liệu',
      revokeRequestedBy: clerk,
      revokeApproverIds: [approver],
    });
    expect((await store.listLetters(TENANT, { visibleTo: nobody, limit: 10 })).map((row) => row.id)).toEqual([letter.id]);
    expect(await store.countArchived(TENANT)).toBe(archivedBefore);
    await expect(
      store.withLetter(TENANT, letter.id, (tx) => tx.update({ revokeKind: 'burn' as never })),
    ).rejects.toMatchObject({ code: '23514' });

    // Rút đề nghị: xoá dấu đề nghị, người xác nhận không còn thấy.
    await store.withLetter(TENANT, letter.id, (tx) =>
      tx.update({ stage: 'archived', revokeKind: undefined, revokeReason: undefined, revokeRequestedBy: undefined, revokeRequestedAt: undefined, revokeApproverIds: [] }),
    );
    expect(await store.findLetter(TENANT, letter.id)).toMatchObject({ stage: 'archived', revokeKind: undefined, revokeApproverIds: [] });
    expect(await store.listLetters(TENANT, { visibleTo: nobody, limit: 10 })).toEqual([]);

    await store.withLetter(TENANT, letter.id, (tx) => tx.update({ stage: 'cancelled', deletedAt: new Date().toISOString(), deletedBy: clerk }));
    expect(await store.findLetter(TENANT, letter.id)).toBeUndefined();
    expect((await store.listLetters(TENANT, { limit: 100 })).map((row) => row.id)).not.toContain(letter.id);
    await expect(store.withLetter(TENANT, letter.id, async () => undefined)).rejects.toThrow();
    expect(await store.countArchived(TENANT)).toBe(archivedBefore - 1);
  });

  it('bút phê, vai trò chủ trì / phối hợp, phân loại sơ bộ; người nhận đích danh thấy công văn', async () => {
    const letter = await store.createLetter(
      TENANT,
      { direction: 'incoming', stage: 'received', receivedOn: '2026-11-14', senderOrg: 'Sở', subject: 'Đích danh', kind: 'finance', urgency: 'top_urgent', confidentiality: 'secret', receivedBy: clerk },
      { counter: 'incoming', suffix: 'CVĐ' },
      async () => undefined,
    );
    const addressee = randomUUID();
    const [lead, support] = [randomUUID(), randomUUID()];
    await store.withLetter(TENANT, letter.id, async (tx) => {
      await tx.update({
        envelopeStatus: 'damaged',
        sealed: true,
        pageCount: 12,
        copyCount: 2,
        addressedTo: 'Công đoàn',
        addressedUserId: addressee,
        closerIds: [author],
        directive: {
          note: 'Kế toán chủ trì',
          dueOn: '2026-11-20',
          units: [
            { unitId: lead, unitName: 'Phòng Kế toán', role: 'lead' },
            { unitId: support, unitName: 'Phòng Pháp chế', role: 'support', handlerUserId: author },
          ],
          stepName: 'Lãnh đạo bút phê',
          by: leader,
          at: '2026-11-14T02:00:00.000Z',
        },
      });
      await tx.assign([
        { unitId: lead, unitName: 'Phòng Kế toán', role: 'lead' },
        { unitId: support, unitName: 'Phòng Pháp chế', role: 'support', handlerUserId: author },
      ]);
      expect(tx.assignments.map((item) => [item.unitName, item.role])).toEqual([
        ['Phòng Kế toán', 'lead'],
        ['Phòng Pháp chế', 'support'],
      ]);
    });
    expect(await store.findLetter(TENANT, letter.id)).toMatchObject({
      envelopeStatus: 'damaged',
      sealed: true,
      pageCount: 12,
      copyCount: 2,
      addressedTo: 'Công đoàn',
      addressedUserId: addressee,
      closerIds: [author],
      directive: { note: 'Kế toán chủ trì', dueOn: '2026-11-20', units: [{ role: 'lead' }, { role: 'support', handlerUserId: author }] },
    });
    // Văn bản tối mật gửi đích danh: người nhận đích danh thấy, người ngoài không.
    const outsider = { userId: randomUUID(), unitIds: [], readAll: true, readConfidential: false };
    expect((await store.listLetters(TENANT, { visibleTo: outsider, limit: 50 })).map((row) => row.id)).not.toContain(letter.id);
    const [row] = await store.listLetters(TENANT, { visibleTo: { ...outsider, userId: addressee }, limit: 50 });
    expect(row).toMatchObject({ id: letter.id, replied: false, assignments: [{ role: 'lead' }, { role: 'support' }] });
    await expect(store.withLetter(TENANT, letter.id, (tx) => tx.update({ envelopeStatus: 'lost' as never }))).rejects.toMatchObject({ code: '23514' });
    const catalog = await store.catalog(TENANT);
    expect(catalog.filter((item) => item.kind === 'urgency').map((item) => item.name)).toEqual(['Thường', 'Khẩn', 'Thượng khẩn', 'Hỏa tốc']);
    expect(catalog.filter((item) => item.kind === 'confidentiality').map((item) => item.name)).toEqual(['Thường', 'Mật', 'Tối mật', 'Tuyệt mật']);
  });

  it('tệp: phiên bản mới về chưa tải xong, người tải là người tải phiên bản', async () => {
    const letter = await store.createLetter(
      TENANT,
      { direction: 'incoming', stage: 'received', receivedOn: '2026-11-12', senderOrg: 'A', subject: 'B', kind: 'finance', urgency: 'normal', confidentiality: 'normal', receivedBy: clerk },
      { counter: 'incoming', suffix: 'CVĐ' },
      async () => undefined,
    );
    const [documentId, versionId, nextVersion] = [randomUUID(), randomUUID(), randomUUID()];
    const attachment = await store.withLetter(TENANT, letter.id, (tx) =>
      tx.addAttachment({ kind: 'incoming', sharedDocumentId: documentId, sharedVersionId: versionId, fileName: 'a.pdf', contentType: 'application/pdf', uploadedBy: clerk }),
    );
    await store.completeAttachment(TENANT, attachment.id, 10);
    await store.withLetter(TENANT, letter.id, (tx) =>
      tx.setAttachmentVersion(attachment.id, { sharedVersionId: nextVersion, versionNo: 2, fileName: 'a-v2.pdf', contentType: 'application/pdf', uploadedBy: author }),
    );
    expect(await store.findAttachment(TENANT, attachment.id)).toMatchObject({
      versionNo: 2,
      sharedVersionId: nextVersion,
      fileName: 'a-v2.pdf',
      sizeBytes: undefined,
      uploadedBy: author,
    });
  });

  it('danh mục, quy trình theo luồng: không trùng mã, mục đã dùng không xoá được, mặc định riêng từng luồng', async () => {
    const created = await store.saveCatalogItem(TENANT, clerk, undefined, {
      kind: 'letter_type',
      code: 'contract',
      name: 'Hợp đồng',
      sortOrder: 40,
      isActive: true,
      defaultDueDays: 3,
      workflowId: null,
      outgoingWorkflowId: 'c0000000-0000-4000-8000-000000000002',
      defaultUnitIds: [randomUUID()],
      highlight: false,
      restricted: false,
    });
    expect(created).toMatchObject({ code: 'contract', outgoingWorkflowId: 'c0000000-0000-4000-8000-000000000002', inUse: false });
    expect(created.defaultUnitIds).toHaveLength(1);
    await expect(
      store.saveCatalogItem(TENANT, clerk, undefined, { ...created, defaultDueDays: null, workflowId: null, outgoingWorkflowId: null, defaultUnitIds: [], highlight: false, restricted: false }),
    ).rejects.toThrow('đã có');
    // Quy trình đi đang gắn với loại văn bản: không xoá được.
    expect(await store.deleteWorkflow(TENANT, 'c0000000-0000-4000-8000-000000000002')).toBe(false);
    expect(await store.deleteCatalogItem(TENANT, created.id)).toBe(true);
    const finance = (await store.catalog(TENANT)).find((item) => item.code === 'finance');
    expect(finance?.inUse).toBe(true);
    expect(await store.deleteCatalogItem(TENANT, finance?.id as string)).toBe(false);

    const outgoing = await store.saveWorkflow(TENANT, clerk, undefined, {
      name: 'Đi nhanh',
      description: null,
      startName: null,
      endName: 'Ban hành ngay',
      autoStart: false,
      endActor: { type: 'users', userIds: [clerk] },
      autoEnd: true,
      archive: false,
      direction: 'outgoing',
      isActive: true,
      isDefault: true,
      steps: [{ key: 'a', name: 'TGĐ', approver: { type: 'users', userIds: [leader] }, rejectTo: 'clerk' }],
    });
    const defaults = (await store.workflows(TENANT)).filter((item) => item.isDefault);
    expect(defaults.map((item) => [item.direction, item.id])).toEqual([
      ['incoming', 'c0000000-0000-4000-8000-000000000001'],
      ['outgoing', outgoing.id],
    ]);
    expect(outgoing).toMatchObject({ startName: undefined, endName: 'Ban hành ngay', autoStart: false, endActor: { type: 'users', userIds: [clerk] }, autoEnd: true, archive: false });
    expect(outgoing.steps[0]).toMatchObject({ type: 'approve', rejectTo: 'clerk' });
  });
});

/**
 * Nâng cấp lên quy trình động trên dữ liệu thật của luồng cũ: quy trình chỉ có bước duyệt, công văn
 * đến đang chờ phòng ban, công văn đi đang chờ văn thư kiểm tra (chưa chép bước), công văn đi đã
 * ban hành. Sau 0004 chúng chạy tiếp được theo luồng mới, chạy lại 0004 không đổi gì thêm.
 */
integration('Nâng cấp quy trình động (migration 0004)', () => {
  const databaseName = 'correspondence_test_' + randomUUID().replace(/-/g, '');
  const clerk = randomUUID();
  const leader = randomUUID();
  const author = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: Pool;
  let store: PostgresCorrespondenceStore;

  beforeAll(async () => {
    const url = new URL(process.env.CORRESPONDENCE_TEST_ADMIN_URL as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString()) as unknown as Pool;
    await pool.query(`
      CREATE SCHEMA core_schema;
      CREATE TABLE core_schema.users (id UUID PRIMARY KEY, full_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        is_active BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE core_schema.user_roles (user_id UUID, role_id UUID);
      CREATE TABLE core_schema.role_permissions (role_id UUID, permission_id UUID);
      CREATE TABLE core_schema.permission_actions (permission_id UUID, action_key TEXT);
      CREATE TABLE core_schema.user_permission_grants (user_id UUID, action_key TEXT);
      CREATE SCHEMA integration_schema;
      CREATE TABLE integration_schema.outbox_events (id uuid PRIMARY KEY, aggregate_type varchar(100) NOT NULL,
        aggregate_id varchar(160) NOT NULL, event_type varchar(160) NOT NULL, event_version integer NOT NULL,
        payload jsonb NOT NULL, occurred_at timestamptz NOT NULL);`);
    await migrate(pool, MIGRATIONS.slice(0, 3));
    store = new PostgresCorrespondenceStore(
      { require: () => ({}) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    );
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^correspondence_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  async function legacyLetter(direction: 'incoming' | 'outgoing', stage: string, seq: number): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO correspondence_schema.letters (direction, year, seq, incoming_no, received_on, sender_org, subject, kind,
                                                  urgency, confidentiality, stage, received_by, author_user_id)
       VALUES ($1, 2026, $2, $3, '2026-11-10', 'Sở', 'Công văn cũ', 'finance', 'normal', 'normal', $4, $5, $6) RETURNING id`,
      [direction, seq, `${seq}/X`, stage, clerk, direction === 'outgoing' ? author : null],
    );
    return result.rows[0].id;
  }
  async function legacySteps(letterId: string, statuses: readonly string[]): Promise<void> {
    for (const [index, status] of statuses.entries()) {
      await pool.query(
        `INSERT INTO correspondence_schema.letter_steps (letter_id, seq, name, kind, approver, status, acted_by)
         VALUES ($1, $2, $3, 'approve', '{"type": "handling_unit_heads"}', $4, $5)`,
        [letterId, index + 1, `Duyệt ${index + 1}`, status, status === 'done' ? leader : null],
      );
    }
  }
  async function history(letterId: string, action: string): Promise<void> {
    await pool.query(
      `INSERT INTO correspondence_schema.history (letter_id, action, summary, actor_user_id) VALUES ($1, $2, $2, $3)`,
      [letterId, action, clerk],
    );
  }

  it('công văn đang chạy dở có thêm bước cứng cũ đúng vị trí, chạy tiếp được; chạy lại không đổi', async () => {
    // Công văn đến đang chờ phòng ban (đã chép hai bước duyệt lúc giao).
    const processing = await legacyLetter('incoming', 'processing', 1);
    await legacySteps(processing, ['waiting', 'waiting']);
    await history(processing, 'dispatch');
    await pool.query(
      `INSERT INTO correspondence_schema.assignments (letter_id, unit_id, unit_name, status) VALUES ($1, $2, 'Phòng Kế toán', 'pending')`,
      [processing, randomUUID()],
    );
    // Công văn đến đang ở bước duyệt thứ hai.
    const reviewing = await legacyLetter('incoming', 'reviewing', 2);
    await legacySteps(reviewing, ['done', 'active']);
    await history(reviewing, 'dispatch');
    // Công văn đi đang chờ văn thư kiểm tra: luồng cũ chưa chép bước.
    const checking = await legacyLetter('outgoing', 'checking', 1);
    // Công văn đi đã ban hành.
    const archived = await legacyLetter('outgoing', 'archived', 2);
    await legacySteps(archived, ['done', 'done']);
    await history(archived, 'submit');
    // Công văn đến mới tiếp nhận: chưa chuyển bước, không đụng tới.
    const received = await legacyLetter('incoming', 'received', 3);

    // 0004 chuyển dữ liệu; 0005 thêm cột mà kho đọc.
    await migrate(pool, MIGRATIONS.slice(3));
    const snapshot = async () => ({
      processing: (await store.steps(TENANT, processing)).map((step) => [step.seq, step.kind, step.status]),
      reviewing: (await store.steps(TENANT, reviewing)).map((step) => [step.seq, step.kind, step.status]),
      checking: (await store.steps(TENANT, checking)).map((step) => [step.seq, step.kind, step.status, step.name]),
      archived: (await store.steps(TENANT, archived)).map((step) => [step.seq, step.kind, step.status]),
      received: (await store.steps(TENANT, received)).length,
    });
    const after = await snapshot();
    expect(after).toEqual({
      processing: [
        [1, 'process', 'active'],
        [2, 'approve', 'waiting'],
        [3, 'approve', 'waiting'],
      ],
      reviewing: [
        [1, 'process', 'done'],
        [2, 'approve', 'done'],
        [3, 'approve', 'active'],
      ],
      checking: [
        [1, 'check', 'active', 'Văn thư kiểm tra'],
        [2, 'approve', 'waiting', 'Trưởng phòng soạn thảo duyệt'],
        [3, 'approve', 'waiting', 'Lãnh đạo duyệt ban hành'],
      ],
      archived: [
        [1, 'check', 'done'],
        [2, 'approve', 'done'],
        [3, 'approve', 'done'],
      ],
      received: 0,
    });
    expect(await store.findLetter(TENANT, checking)).toMatchObject({ workflowName: 'Duyệt công văn đi' });
    // Bước cứng không có luật người duyệt; bước duyệt giữ luật cũ.
    const [processStep, approveStep] = await store.steps(TENANT, processing);
    expect(processStep.approver).toBeUndefined();
    expect(approveStep.approver).toEqual({ type: 'handling_unit_heads' });

    // Chạy lại (lỗi giữa chừng lúc deploy): không thêm bước lần nữa.
    await migrate(pool, MIGRATIONS.slice(3, 4));
    expect(await snapshot()).toEqual(after);
    const workflows = await store.workflows(TENANT);
    expect(workflows.find((item) => item.direction === 'incoming' && item.isDefault)?.steps.map((step) => step.type)).toEqual([
      'process',
      'approve',
      'approve',
    ]);
  });
});
