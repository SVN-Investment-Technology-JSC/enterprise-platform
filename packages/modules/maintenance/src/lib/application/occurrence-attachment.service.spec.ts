import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { ObjectStorageManagementPort, ObjectStorageMetadataPort } from '@enterprise-platform/adapter-storage';
import type { MaintenanceActor } from './maintenance-store.port.js';
import { OccurrenceAttachmentService } from './occurrence-attachment.service.js';

const actor = {
  tenantId: 't1',
  userId: 'u1',
  canManage: true,
  canHandleOccurrences: true,
} as unknown as MaintenanceActor;

/** Pool giả: ghi lại câu lệnh, trả dòng theo loại câu lệnh. */
function setup(rows: { select?: Record<string, unknown>[]; deleted?: Record<string, unknown>[] } = {}) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (/^\s*INSERT/i.test(sql)) {
        return {
          rows: [
            {
              id: values[0],
              occurrence_id: values[1],
              object_key: values[2],
              file_name: values[3],
              content_type: values[4],
              size_bytes: values[5],
              note: values[6],
              uploaded_by: values[7],
              created_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      }
      if (/^\s*DELETE/i.test(sql)) {
        const deleted = rows.deleted ?? [];
        return { rows: deleted, rowCount: deleted.length };
      }
      const selected = rows.select ?? [];
      return { rows: selected, rowCount: selected.length };
    },
  };
  const references = { require: () => ({ tenantId: 't1' }) } as unknown as TenantDatabaseRegistry;
  const pools = { forTenant: async () => pool } as unknown as PostgresPoolRegistry;
  const uploads: { key: string; contentType: string }[] = [];
  const downloads: { key: string; options?: unknown }[] = [];
  const removed: string[][] = [];
  const storage = {
    createUploadUrl: async (input: { key: string; contentType: string }) => {
      uploads.push(input);
      return 'https://s3.test/put';
    },
    createDownloadUrl: async (key: string, _ttl?: number, options?: unknown) => {
      downloads.push({ key, options });
      return `https://s3.test/${key}`;
    },
    putObject: async () => undefined,
    copyObject: async () => undefined,
    deleteObjects: async (keys: readonly string[]) => {
      removed.push([...keys]);
      return { failed: [] };
    },
    objectMetadata: async () => ({ sizeBytes: 1, contentType: 'application/pdf' }),
  } as ObjectStorageManagementPort & ObjectStorageMetadataPort;
  const service = new OccurrenceAttachmentService(references, pools, storage);
  return { service, queries, uploads, downloads, removed };
}

describe('OccurrenceAttachmentService — kiểm loại tệp (ISS-BE-017)', () => {
  // SEC-BE017-05
  it('PDF khai text/html bị từ chối 400, không ghi dòng, không ký URL', async () => {
    const { service, queries, uploads } = setup();
    await expect(
      service.create(actor, 'occ1', { fileName: 'bien-ban.pdf', contentType: 'text/html', sizeBytes: 100 }),
    ).rejects.toMatchObject({ code: 'validation', message: 'Loại tệp không được phép.' });
    expect(queries).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it.each([
    ['virus.exe', 'text/plain'],
    ['trang.html', 'text/plain'],
    ['hinh.svg', 'image/svg+xml'],
  ])('%s khai %s bị từ chối', async (fileName, contentType) => {
    const { service, queries } = setup();
    await expect(service.create(actor, 'occ1', { fileName, contentType, sizeBytes: 100 })).rejects.toMatchObject({
      code: 'validation',
    });
    expect(queries).toHaveLength(0);
  });

  it.each([[0], [-5], ['abc'], [undefined]])('sizeBytes %p bị từ chối', async (sizeBytes) => {
    const { service, queries } = setup();
    await expect(
      service.create(actor, 'occ1', { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: sizeBytes as never }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(queries).toHaveLength(0);
  });

  it('loại trình duyệt không nhận ra thì ký URL bằng loại chuẩn của đuôi', async () => {
    const { service, uploads } = setup();
    const created = await service.create(actor, 'occ1', {
      fileName: 'so-lieu.csv',
      contentType: 'application/octet-stream',
      sizeBytes: 10,
    });
    expect(created.attachment.contentType).toBe('text/csv');
    expect(uploads[0]?.contentType).toBe('text/csv');
  });

  it('ảnh đúng loại được nhận', async () => {
    const { service, uploads } = setup();
    await service.create(actor, 'occ1', { fileName: 'anh.PNG', contentType: 'image/png', sizeBytes: 10 });
    expect(uploads[0]?.contentType).toBe('image/png');
  });

  // SEC-BE017-06
  it('URL tải xuống ép attachment, loại do server quyết theo đuôi', async () => {
    const { service, downloads } = setup({ select: [{ object_key: 'k/1', file_name: 'bao-cao.pdf' }] });
    await service.downloadUrl(actor, 'occ1', 'a1');
    expect(downloads).toEqual([
      { key: 'k/1', options: { attachment: true, contentType: 'application/pdf', fileName: 'bao-cao.pdf' } },
    ]);
  });

  it('tệp cũ đuôi không được phép tải về dạng nhị phân', async () => {
    const { service, downloads } = setup({ select: [{ object_key: 'k/2', file_name: 'trang.html' }] });
    await service.downloadUrl(actor, 'occ1', 'a2');
    expect(downloads[0]?.options).toMatchObject({ attachment: true, contentType: 'application/octet-stream' });
  });
});

describe('OccurrenceAttachmentService — xoá đính kèm (ISS-BE-016)', () => {
  // SEC-BE016-05
  it('xoá đính kèm thì xoá cả object trong kho', async () => {
    const { service, removed } = setup({ deleted: [{ object_key: 'tenants/t1/maintenance/occ1/a1-x.pdf' }] });
    await service.remove(actor, 'occ1', 'a1');
    expect(removed).toEqual([['tenants/t1/maintenance/occ1/a1-x.pdf']]);
  });

  it('không có dòng nào thì 404, không gọi kho', async () => {
    const { service, removed } = setup({ deleted: [] });
    await expect(service.remove(actor, 'occ1', 'a1')).rejects.toMatchObject({ code: 'not_found' });
    expect(removed).toHaveLength(0);
  });

  it('kho lỗi khi xoá object thì vẫn xoá xong đính kèm', async () => {
    const context = setup({ deleted: [{ object_key: 'k/1' }] });
    const failing = new OccurrenceAttachmentService(
      { require: () => ({ tenantId: 't1' }) } as unknown as TenantDatabaseRegistry,
      {
        forTenant: async () => ({ query: async () => ({ rows: [{ object_key: 'k/1' }], rowCount: 1 }) }),
      } as unknown as PostgresPoolRegistry,
      {
        deleteObjects: async () => {
          throw new Error('kho không phản hồi');
        },
      } as unknown as ObjectStorageManagementPort & ObjectStorageMetadataPort,
    );
    expect(context.removed).toHaveLength(0);
    await expect(failing.remove(actor, 'occ1', 'a1')).resolves.toBeUndefined();
  });
});

/**
 * Pool và kho giả có trạng thái: dòng đính kèm sống trong bộ nhớ, kho chỉ có
 * các khoá đã "PUT" vào `objects`.
 */
function statefulSetup(options: { userId?: string; canManage?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, number>();
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (/^\s*INSERT/i.test(sql)) {
        const row = {
          id: values[0],
          occurrence_id: values[1],
          object_key: values[2],
          file_name: values[3],
          content_type: values[4],
          size_bytes: values[5],
          note: values[6],
          uploaded_by: values[7],
          upload_status: /'PENDING'/.test(sql) ? 'PENDING' : 'COMPLETED',
          created_at: new Date('2026-01-01T00:00:00Z'),
        };
        rows.set(String(row.id), row);
        return { rows: [row], rowCount: 1 };
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const row = rows.get(String(values[1]));
        if (!row || row.occurrence_id !== values[0] || row.upload_status !== 'PENDING') return { rows: [], rowCount: 0 };
        row.upload_status = 'COMPLETED';
        row.size_bytes = values[2];
        return { rows: [row], rowCount: 1 };
      }
      const onlyCompleted = /upload_status = 'COMPLETED'/.test(sql);
      const selected = [...rows.values()].filter(
        (row) =>
          row.occurrence_id === values[0] &&
          (values[1] === undefined || row.id === values[1]) &&
          (!onlyCompleted || row.upload_status === 'COMPLETED'),
      );
      return { rows: selected, rowCount: selected.length };
    },
  };
  const storage = {
    createUploadUrl: async () => 'https://s3.test/put',
    createDownloadUrl: async (key: string) => `https://s3.test/${key}`,
    putObject: async () => undefined,
    copyObject: async () => undefined,
    deleteObjects: async () => ({ failed: [] }),
    objectMetadata: async (key: string) => {
      const size = objects.get(key);
      if (size === undefined) throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
      return { sizeBytes: size, contentType: 'application/pdf' };
    },
  } as unknown as ObjectStorageManagementPort & ObjectStorageMetadataPort;
  const service = new OccurrenceAttachmentService(
    { require: () => ({ tenantId: 't1' }) } as unknown as TenantDatabaseRegistry,
    { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    storage,
  );
  const creator = { ...actor, canManage: false } as MaintenanceActor;
  const other = {
    ...actor,
    userId: options.userId ?? 'u2',
    canManage: options.canManage ?? false,
  } as MaintenanceActor;
  const createPending = () =>
    service.create(creator, 'occ1', { fileName: 'bien-ban.pdf', contentType: 'application/pdf', sizeBytes: 999 });
  return { service, rows, objects, creator, other, createPending };
}

describe('OccurrenceAttachmentService — bước đã tải tệp xong (ISS-BE-016)', () => {
  it('tạo đính kèm ở PENDING, danh sách và tải xuống ẩn dòng chưa xong', async () => {
    const { service, rows, creator, createPending } = statefulSetup();
    const created = await createPending();
    expect(rows.get(created.attachment.id)?.upload_status).toBe('PENDING');
    await expect(service.list(creator, 'occ1')).resolves.toEqual([]);
    await expect(service.downloadUrl(creator, 'occ1', created.attachment.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('chưa có tệp trên kho thì 409 UPLOAD_NOT_FOUND, dòng vẫn PENDING', async () => {
    const { service, rows, creator, createPending } = statefulSetup();
    const created = await createPending();
    await expect(service.complete(creator, 'occ1', created.attachment.id)).rejects.toMatchObject({
      code: 'conflict',
      responseCode: 'UPLOAD_NOT_FOUND',
      message: 'Chưa thấy tệp trên kho lưu trữ, hãy tải lên lại.',
    });
    expect(rows.get(created.attachment.id)?.upload_status).toBe('PENDING');
  });

  it('có tệp thì COMPLETED, lưu dung lượng thật, hiện trong danh sách; lần hai 409', async () => {
    const { service, objects, rows, creator, createPending } = statefulSetup();
    const created = await createPending();
    // Khai 999 byte lúc tạo, trên kho thật là 1234: lưu theo kho.
    objects.set(String(rows.get(created.attachment.id)?.object_key), 1234);
    const done = await service.complete(creator, 'occ1', created.attachment.id);
    expect(done.sizeBytes).toBe(1234);
    const listed = await service.list(creator, 'occ1');
    expect(listed.map((item) => [item.id, item.sizeBytes])).toEqual([[created.attachment.id, 1234]]);
    await expect(service.complete(creator, 'occ1', created.attachment.id)).rejects.toMatchObject({
      code: 'conflict',
      responseCode: 'UPLOAD_ALREADY_COMPLETED',
    });
  });

  it('người khác không phải quản lý không báo xong được tệp của người tạo', async () => {
    const { service, objects, rows, other, createPending } = statefulSetup();
    const created = await createPending();
    objects.set(String(rows.get(created.attachment.id)?.object_key), 10);
    await expect(service.complete(other, 'occ1', created.attachment.id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(rows.get(created.attachment.id)?.upload_status).toBe('PENDING');
  });

  it('người quản lý báo xong thay được', async () => {
    const { service, objects, rows, other, createPending } = statefulSetup({ canManage: true });
    const created = await createPending();
    objects.set(String(rows.get(created.attachment.id)?.object_key), 10);
    await expect(service.complete(other, 'occ1', created.attachment.id)).resolves.toMatchObject({ sizeBytes: 10 });
  });

  it('không có quyền xử lý phiếu thì 403', async () => {
    const { service, creator, createPending } = statefulSetup();
    const created = await createPending();
    await expect(
      service.complete({ ...creator, canHandleOccurrences: false } as MaintenanceActor, 'occ1', created.attachment.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('đính kèm không có thì 404', async () => {
    const { service, creator } = statefulSetup();
    await expect(service.complete(creator, 'occ1', 'khong-co')).rejects.toMatchObject({ code: 'not_found' });
  });
});
