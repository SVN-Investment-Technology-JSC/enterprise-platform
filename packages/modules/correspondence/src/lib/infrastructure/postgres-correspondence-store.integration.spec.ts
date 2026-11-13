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
const MIGRATION = resolve(process.cwd(), '../../../migrations/tenant/correspondence/0001-correspondence.sql');

integration('Sổ công văn (PostgreSQL)', () => {
  const databaseName = 'correspondence_test_' + randomUUID().replace(/-/g, '');
  const clerk = randomUUID();
  const leader = randomUUID();
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
    await pool.query(await readFile(MIGRATION, 'utf8'));
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

  it('migration chạy lại được và có sẵn danh mục, quy trình mặc định', async () => {
    await pool.query(await readFile(MIGRATION, 'utf8'));
    expect(await store.tablesReady(TENANT)).toBe(true);
    const catalog = await store.catalog(TENANT);
    expect(catalog.filter((item) => item.kind === 'urgency').map((item) => item.code)).toEqual(['normal', 'urgent', 'flash']);
    const [workflow] = await store.workflows(TENANT);
    expect(workflow).toMatchObject({ isDefault: true, steps: [expect.objectContaining({ kind: 'direct' }), expect.anything(), expect.anything()] });
    expect(await store.leaders(TENANT)).toEqual([{ userId: leader, name: 'Lãnh đạo' }]);
  });

  it('vào sổ cấp số theo năm, chạy các bước, giao phòng ban, ghi outbox, lọc theo quyền xem', async () => {
    const insert = {
      receivedOn: '2026-11-12',
      senderOrg: 'Sở Tài chính',
      subject: 'Giải trình',
      kind: 'finance',
      urgency: 'normal',
      confidentiality: 'confidential',
      receivedBy: clerk,
    };
    const first = await store.createLetter(TENANT, insert, 'CVĐ', async (tx) => tx.history({ action: 'receive', summary: 'Vào sổ' }));
    const second = await store.createLetter(TENANT, insert, 'CVĐ', async () => undefined);
    expect([first.incomingNo, second.incomingNo]).toEqual(['1/CVĐ', '2/CVĐ']);

    const [workflow] = await store.workflows(TENANT);
    const unitId = randomUUID();
    await store.withLetter(TENANT, first.id, async (tx) => {
      await tx.replaceSteps(workflow.steps);
      const step = tx.steps[0];
      await tx.updateStep(step.id, { status: 'active', activate: true, assigneeUserIds: [leader], chosenUserId: leader });
      await tx.update({ stage: 'directing', workflowId: workflow.id, workflowName: workflow.name });
      await tx.outbox({ type: 'correspondence.letter.step-assigned', payload: { recipientUserIds: [leader] } });
    });
    const steps = await store.steps(TENANT, first.id);
    expect(steps.map((step) => step.status)).toEqual(['active', 'waiting', 'waiting']);
    expect(steps[0]).toMatchObject({ assigneeUserIds: [leader], chosenUserId: leader });

    // Mật: người ngoài không thấy, lãnh đạo được giao bước thì thấy; người xem mọi công văn cần quyền xem mật.
    const outsider = { userId: randomUUID(), unitIds: [], readAll: true, readConfidential: false };
    expect(await store.listLetters(TENANT, { visibleTo: outsider, limit: 10 })).toEqual([]);
    const forLeader = await store.listLetters(TENANT, { visibleTo: { ...outsider, userId: leader }, limit: 10 });
    expect(forLeader.map((row) => row.id)).toEqual([first.id]);
    expect(forLeader[0].steps[0]).toMatchObject({ status: 'active', assigneeUserIds: [leader] });

    await store.withLetter(TENANT, first.id, async (tx) => {
      await tx.updateStep(tx.steps[0].id, { status: 'done', actedBy: leader, decision: 'directed', note: 'Giao' });
      await tx.assign([{ unitId, unitName: 'Phòng Kế toán' }]);
      await tx.submitAssignment(tx.assignments[0].id, { note: 'Xong', userId: clerk });
      const year = 2026;
      const no = await tx.nextNumber('outgoing', year);
      await tx.update({ stage: 'closing', directorUserId: leader, outgoingNo: `${no}/CV`, publishedOn: '2026-11-12', recipient: 'Sở' });
    });
    const unitMember = { userId: randomUUID(), unitIds: [unitId], readAll: false, readConfidential: false };
    expect((await store.listLetters(TENANT, { visibleTo: unitMember, onlyPublished: true, limit: 10 })).map((row) => row.outgoingNo)).toEqual([
      '1/CV',
    ]);
    const events = await pool.query(`SELECT event_type FROM integration_schema.outbox_events`);
    expect(events.rows).toEqual([{ event_type: 'correspondence.letter.step-assigned' }]);
    expect((await store.history(TENANT, first.id)).map((item) => item.action)).toEqual(['receive']);
  });

  it('danh mục: không trùng mã, mục đã dùng không xoá được', async () => {
    const created = await store.saveCatalogItem(TENANT, clerk, undefined, {
      kind: 'urgency',
      code: 'top',
      name: 'Thượng khẩn',
      sortOrder: 40,
      isActive: true,
      defaultDueDays: null,
      workflowId: null,
      highlight: true,
      restricted: false,
    });
    expect(created).toMatchObject({ code: 'top', highlight: true, inUse: false });
    await expect(store.saveCatalogItem(TENANT, clerk, undefined, { ...created, defaultDueDays: null, workflowId: null, highlight: true, restricted: false })).rejects.toThrow('đã có');
    expect(await store.deleteCatalogItem(TENANT, created.id)).toBe(true);
    const finance = (await store.catalog(TENANT)).find((item) => item.code === 'finance');
    expect(finance?.inUse).toBe(true);
    expect(await store.deleteCatalogItem(TENANT, finance?.id as string)).toBe(false);
  });
});
