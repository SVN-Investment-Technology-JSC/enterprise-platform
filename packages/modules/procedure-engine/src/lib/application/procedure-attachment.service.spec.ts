import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { ObjectStorageMetadataPort, ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { ProcedureAttachmentService } from './procedure-attachment.service.js';

const actor = {
  tenantId: 't1',
  userId: 'u1',
  membershipId: 'm1',
  displayName: 'U1',
  canDesign: false,
  canPublish: false,
  canCreateInstances: true,
  isOverride: false,
  organizationUnitIds: [],
} as unknown as ProcedureActor;

const instance = {
  id: 'i1',
  code: 'QT-1',
  status: 'running',
  initiatedBy: 'u1',
  steps: [],
  subtasks: [],
  // Gắn dự án Workspace để `complete` phát sự kiện sang Workspace.
  workspaceLink: { status: 'linked' },
} as unknown as ProcedureInstance;

interface Row {
  id: string;
  instance_id: string;
  step_instance_id: string | null;
  subtask_id: string | null;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: string | null;
  uploaded_by: string;
  created_at: Date;
  upload_status: 'PENDING' | 'COMPLETED';
}

/**
 * Bảng `attachments` trong bộ nhớ: đủ cho các câu lệnh service dùng. `objects`
 * là kho lưu trữ giả (khoá → dung lượng thật).
 */
function setup() {
  const rows: Row[] = [];
  const outbox: unknown[][] = [];
  const objects = new Map<string, number>();
  const query = async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [], rowCount: 0 };
    if (text.startsWith('SELECT snapshot')) return { rows: [{ snapshot: instance }], rowCount: 1 };
    if (text.startsWith('INSERT INTO procedure_schema.attachments')) {
      const [id, instanceId, stepInstanceId, objectKey, fileName, contentType, uploadedBy, subtaskId] = values as string[];
      const row: Row = {
        id,
        instance_id: instanceId,
        step_instance_id: stepInstanceId ?? null,
        subtask_id: subtaskId ?? null,
        object_key: objectKey,
        file_name: fileName,
        content_type: contentType,
        size_bytes: null,
        uploaded_by: uploadedBy,
        created_at: new Date('2026-01-01T00:00:00Z'),
        upload_status: text.includes("'PENDING'") ? 'PENDING' : 'COMPLETED',
      };
      rows.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO integration_schema.outbox_events')) {
      outbox.push(values);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('UPDATE procedure_schema.attachments')) {
      const [id, instanceId, size] = values as [string, string, number];
      const row = rows.find(
        (item) => item.id === id && item.instance_id === instanceId && item.upload_status === 'PENDING',
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.upload_status = 'COMPLETED';
      row.size_bytes = String(size);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (text.startsWith('SELECT * FROM procedure_schema.attachments WHERE id=$1')) {
      const found = rows.filter((item) => item.id === values[0] && item.instance_id === values[1]);
      return { rows: found.map((item) => ({ ...item })), rowCount: found.length };
    }
    if (text.startsWith('SELECT * FROM procedure_schema.attachments WHERE instance_id=$1')) {
      const onlyCompleted = text.includes("upload_status='COMPLETED'");
      const found = rows.filter(
        (item) => item.instance_id === values[0] && (!onlyCompleted || item.upload_status === 'COMPLETED'),
      );
      return { rows: found, rowCount: found.length };
    }
    if (text.startsWith('SELECT count(*)')) {
      const onlyCompleted = text.includes("upload_status='COMPLETED'");
      const count = rows.filter(
        (item) =>
          item.instance_id === values[0] &&
          item.subtask_id === values[1] &&
          (!onlyCompleted || item.upload_status === 'COMPLETED'),
      ).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }
    throw new Error(`Câu lệnh chưa giả lập: ${text}`);
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const references = { require: () => ({ tenantId: 't1' }) } as unknown as TenantDatabaseRegistry;
  const pools = { forTenant: async () => pool } as unknown as PostgresPoolRegistry;
  const storage = {
    createUploadUrl: async ({ key }: { key: string }) => `https://s3.test/put/${key}`,
    createDownloadUrl: async (key: string) => `https://s3.test/get/${key}`,
    putObject: async () => undefined,
    objectMetadata: async (key: string) => {
      const sizeBytes = objects.get(key);
      if (sizeBytes === undefined) throw Object.assign(new Error('not found'), { name: 'NotFound' });
      return { sizeBytes, contentType: 'application/pdf' };
    },
  } as unknown as ObjectStoragePort & ObjectStorageMetadataPort;
  const service = new ProcedureAttachmentService(references, pools, storage);

  const upload = async (sizeBytes = 100) => {
    const created = await service.create(actor, 'i1', {
      fileName: 'bien-ban.pdf',
      contentType: 'application/pdf',
      sizeBytes,
      supplement: true,
    });
    const row = rows.find((item) => item.id === created.attachment.id) as Row;
    return { created, row };
  };
  return { service, rows, outbox, objects, upload };
}

describe('ProcedureAttachmentService — chỉ ghi nhận tệp đã tải lên xong (ISS-BE-016)', () => {
  it('đính kèm mới ở trạng thái chờ, không hiện trong danh sách', async () => {
    // SEC-BE016-04
    const { service, upload, rows } = setup();
    const { row } = await upload();
    expect(row.upload_status).toBe('PENDING');
    expect(row.size_bytes).toBeNull();
    expect(rows).toHaveLength(1);
    await expect(service.list(actor, 'i1')).resolves.toEqual([]);
  });

  it('tệp chưa có trên kho thì 409, không phát sự kiện', async () => {
    // SEC-BE016-01
    const { service, upload, outbox } = setup();
    const { created } = await upload();
    await expect(service.complete(actor, 'i1', created.attachment.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(outbox).toHaveLength(0);
    await expect(service.list(actor, 'i1')).resolves.toEqual([]);
  });

  it('hoàn tất lưu dung lượng thật, hiện trong danh sách và phát sự kiện một lần', async () => {
    // SEC-BE016-03
    const { service, upload, objects, outbox } = setup();
    const { created, row } = await upload(1);
    objects.set(row.object_key, 10_240);
    const completed = await service.complete(actor, 'i1', created.attachment.id);
    expect(completed.sizeBytes).toBe(10_240);
    expect(outbox).toHaveLength(1);
    const listed = await service.list(actor, 'i1');
    expect(listed.map((item) => item.id)).toEqual([created.attachment.id]);
    expect(listed[0]?.sizeBytes).toBe(10_240);
  });

  it('báo xong lần hai thì 409, không phát sự kiện lần nữa', async () => {
    // SEC-BE016-02
    const { service, upload, objects, outbox } = setup();
    const { created, row } = await upload();
    objects.set(row.object_key, 100);
    await service.complete(actor, 'i1', created.attachment.id);
    await expect(service.complete(actor, 'i1', created.attachment.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(outbox).toHaveLength(1);
  });

  it('người khác không báo xong được tệp của mình', async () => {
    const { service, upload, objects } = setup();
    const { created, row } = await upload();
    objects.set(row.object_key, 100);
    await expect(
      service.complete({ ...actor, userId: 'u2' } as ProcedureActor, 'i1', created.attachment.id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('bằng chứng đầu việc chỉ đếm tệp đã tải lên xong', async () => {
    const { service, rows } = setup();
    const base = {
      instance_id: 'i1',
      step_instance_id: null,
      object_key: 'k',
      file_name: 'a.pdf',
      content_type: 'application/pdf',
      size_bytes: null,
      uploaded_by: 'u1',
      created_at: new Date(),
    };
    rows.push({ ...base, id: 'a', subtask_id: 's1', upload_status: 'PENDING' });
    rows.push({ ...base, id: 'b', subtask_id: 's1', upload_status: 'COMPLETED' });
    await expect(service.countForSubtask('t1', 'i1', 's1')).resolves.toBe(1);
  });
});
