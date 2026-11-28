import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { DocumentService } from '../application/document.service.js';
import { FinanceService } from '../application/finance.service.js';
import { WorkspaceProcedureEvents } from '../application/procedure-link-events.js';
import { ProjectService } from '../application/project.service.js';
import { WorkItemDeletionService } from '../application/work-item-deletion.service.js';
import { WorkItemService } from '../application/work-item.service.js';
import type { WorkspaceActor } from '../application/workspace.application.js';
import {
  PROCEDURE_ATTACHMENT_ADDED,
  PROCEDURE_STARTED_FOR_WORK_ITEM,
  PROCEDURE_WORKSPACE_RELINK_REQUESTED,
  WORK_ITEM_PROCEDURE_LINKED,
  WORK_ITEM_PROCEDURE_LINK_REJECTED,
} from '../domain/workspace-procedure-link.js';
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

/**
 * Đổi dự án / công việc cho hồ sơ mở từ một công việc "Theo quy trình" (PostgreSQL thật): công việc bị thay là
 * công việc nguồn của hồ sơ, đã có yêu cầu mở quy trình và con trỏ tới hồ sơ. Workspace tạo công việc mới ở dự
 * án mới, chuyển tài liệu, xoá công việc nguồn (yêu cầu mở quy trình đi theo), con trỏ hồ sơ chuyển sang công
 * việc mới rồi báo `procedure_linked`.
 */
integration('Workspace: đổi dự án cho hồ sơ mở từ công việc "Theo quy trình" (PostgreSQL)', () => {
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
  let events: WorkspaceProcedureEvents;
  let documents: DocumentService;
  let projectA: { id: string; code: string };
  let projectB: { id: string; code: string };

  beforeAll(async () => {
    const url = new URL(adminUrl as string);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations()) {
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    }
    store = new PostgresWorkspaceStore(
      { require: () => ({}) } as never,
      { forTenant: async () => pool } as never,
    );
    const projects = new ProjectService(store);
    items = new WorkItemService(store, projects);
    // Chỉ dựng thư mục và chuyển tài liệu giữa công việc; không đụng kho tệp.
    documents = new DocumentService(store, projects, {} as never);
    // Cùng cách nối như `createWorkspaceProcedureEvents` của worker.
    events = new WorkspaceProcedureEvents(
      store,
      items,
      new FinanceService(store, projects),
      documents,
      new WorkItemDeletionService(store, projects),
      projects,
    );
    projectA = await store.project.create(tenantId, owner, { code: 'EVN', name: 'Cải tạo trạm EVN' } as never);
    projectB = await store.project.create(tenantId, owner, { code: 'HN', name: 'Trạm Hà Nội' } as never);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^ws_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  /** Công việc "Theo quy trình" mà Quy trình đã mở hồ sơ cho (sự kiện started_for_work_item đã về). */
  async function sourcedWorkItem(title: string) {
    const item = await items.create(actor, {
      projectId: projectA.id,
      title,
      executionType: 'procedure',
      procedureDefinitionId: randomUUID(),
      assigneeUserId: owner,
    } as never);
    const instanceId = randomUUID();
    const instanceCode = `HS-${instanceId.slice(0, 4)}`;
    await events.handle(tenantId, PROCEDURE_STARTED_FOR_WORK_ITEM, {
      workItemId: item.id,
      instanceId,
      instanceCode,
      title: `EVN-${item.code.replace(/-/g, '')}-${title}`,
      status: 'running',
    });
    return { item, instanceId, instanceCode };
  }

  const relinkRequest = (
    source: { item: { id: string }; instanceId: string; instanceCode: string },
    requestedBy = owner,
  ) => ({
    instanceId: source.instanceId,
    instanceCode: source.instanceCode,
    instanceStatus: 'running',
    projectId: projectB.id,
    title: 'Mua cáp Anten',
    requestedBy,
    requestedByIsTenantAdmin: false,
    workItem: {},
    replacesWorkItemId: source.item.id,
  });

  const outbox = async (type: string, instanceId: string) =>
    (
      await pool.query<{ payload: { payload: Record<string, unknown> } }>(
        `SELECT payload FROM integration_schema.outbox_events
          WHERE event_type = $1 AND payload->'payload'->>'instanceId' = $2
          ORDER BY occurred_at`,
        [type, instanceId],
      )
    ).rows.map((row) => row.payload.payload);

  it('chuyển hồ sơ sang công việc mới ở dự án mới, mang theo tài liệu, xoá công việc nguồn', async () => {
    const source = await sourcedWorkItem('Mua cáp Anten');
    expect(
      (await store.procedureRequest.listByProject(tenantId, projectA.id)).find(
        (row) => row.workItemId === source.item.id,
      ),
    ).toMatchObject({ status: 'started', instanceId: source.instanceId });
    // Tệp của hồ sơ đã được đưa vào thư mục công việc nguồn.
    await events.handle(tenantId, PROCEDURE_ATTACHMENT_ADDED, {
      instanceId: source.instanceId,
      instanceCode: source.instanceCode,
      attachmentId: randomUUID(),
      objectKey: `tenants/${tenantId}/procedure/${source.instanceId}/bao-gia.pdf`,
      fileName: 'Báo giá.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      uploadedBy: owner,
      originLabel: 'Bước 1',
    });
    const [oldDocumentId] = await store.document.idsForWorkItem(tenantId, source.item.id);
    expect(oldDocumentId).toBeDefined();

    await events.handle(tenantId, PROCEDURE_WORKSPACE_RELINK_REQUESTED, relinkRequest(source));

    // Công việc nguồn đã xoá, yêu cầu mở quy trình của nó đi theo (khoá ngoại xoá dây chuyền).
    expect(await store.workItem.findById(tenantId, source.item.id)).toBeUndefined();
    const leftover = await pool.query(
      `SELECT 1 FROM workspace_schema.work_item_procedure_requests WHERE work_item_id = $1`,
      [source.item.id],
    );
    expect(leftover.rowCount).toBe(0);

    // Con trỏ hồ sơ giờ chỉ trỏ công việc mới ở dự án HN.
    const reference = await store.externalRef.findByExternalId(tenantId, 'procedure-engine', source.instanceId);
    expect(reference).toMatchObject({ entityType: 'work_item', projectId: projectB.id });
    const refs = await pool.query(
      `SELECT entity_id FROM workspace_schema.external_references
        WHERE module_key = 'procedure-engine' AND external_id = $1`,
      [source.instanceId],
    );
    expect(refs.rows.map((row) => row.entity_id)).toEqual([reference?.entityId]);
    const created = await store.workItem.findById(tenantId, reference?.entityId as string);
    expect(created).toMatchObject({
      projectId: projectB.id,
      title: 'Mua cáp Anten',
      executionType: 'procedure',
      assigneeUserId: owner,
    });

    // Tài liệu đi theo sang công việc mới.
    expect(await store.document.idsForWorkItem(tenantId, created?.id as string)).toEqual([oldDocumentId]);

    const linked = await outbox(WORK_ITEM_PROCEDURE_LINKED, source.instanceId);
    expect(linked.at(-1)).toMatchObject({
      workItemId: created?.id,
      workItemCode: created?.code,
      projectId: projectB.id,
      projectCode: 'HN',
      projectName: 'Trạm Hà Nội',
    });

    // Worker giao lại cùng sự kiện: không tạo thêm công việc, chỉ báo lại mã.
    const countB = (await store.workItem.listByProject(tenantId, projectB.id)).length;
    await events.handle(tenantId, PROCEDURE_WORKSPACE_RELINK_REQUESTED, relinkRequest(source));
    expect((await store.workItem.listByProject(tenantId, projectB.id)).length).toBe(countB);
    const again = await outbox(WORK_ITEM_PROCEDURE_LINKED, source.instanceId);
    expect(again.length).toBeGreaterThan(linked.length);
    expect(again.at(-1)).toMatchObject({ workItemId: created?.id });

    // Sự kiện "đã mở" của công việc nguồn đến muộn: công việc không còn, không gắn lại gì.
    await events.handle(tenantId, PROCEDURE_STARTED_FOR_WORK_ITEM, {
      workItemId: source.item.id,
      instanceId: source.instanceId,
      instanceCode: source.instanceCode,
      title: 'EVN-CV-Mua cáp Anten',
      status: 'running',
    });
    expect(
      (await store.externalRef.findByExternalId(tenantId, 'procedure-engine', source.instanceId))?.entityId,
    ).toBe(created?.id);
  });

  it('người yêu cầu không thuộc dự án mới: từ chối, công việc nguồn và yêu cầu mở quy trình giữ nguyên', async () => {
    const source = await sourcedWorkItem('Thay cầu dao');
    await events.handle(tenantId, PROCEDURE_WORKSPACE_RELINK_REQUESTED, relinkRequest(source, randomUUID()));

    expect(await store.workItem.findById(tenantId, source.item.id)).toMatchObject({ projectId: projectA.id });
    expect(
      (await store.externalRef.findByExternalId(tenantId, 'procedure-engine', source.instanceId))?.entityId,
    ).toBe(source.item.id);
    expect(
      (await store.procedureRequest.listByProject(tenantId, projectA.id)).find(
        (row) => row.workItemId === source.item.id,
      ),
    ).toMatchObject({ status: 'started', instanceId: source.instanceId });
    expect(await outbox(WORK_ITEM_PROCEDURE_LINK_REJECTED, source.instanceId)).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('không phải thành viên dự án HN') }),
    ]);
  });

  it('công việc cũ còn việc con: từ chối đổi để không xoá mất việc con; công việc và việc con giữ nguyên', async () => {
    const source = await sourcedWorkItem('Lắp tủ RMU');
    const child = await items.create(actor, { projectId: projectA.id, parentId: source.item.id, title: 'Khảo sát' } as never);
    await events.handle(tenantId, PROCEDURE_WORKSPACE_RELINK_REQUESTED, relinkRequest(source));

    expect(await store.workItem.findById(tenantId, source.item.id)).toMatchObject({ projectId: projectA.id });
    expect(await store.workItem.findById(tenantId, child.id)).toMatchObject({ parentId: source.item.id });
    expect(
      (await store.externalRef.findByExternalId(tenantId, 'procedure-engine', source.instanceId))?.entityId,
    ).toBe(source.item.id);
    expect(await outbox(WORK_ITEM_PROCEDURE_LINK_REJECTED, source.instanceId)).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('đang có 1 việc con') }),
    ]);
  });
});
