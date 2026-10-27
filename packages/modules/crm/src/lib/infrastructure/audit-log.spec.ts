import { writeAuditLog, type CrmSqlClient } from './audit-log.js';

function fakeClient() {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client: CrmSqlClient = {
    query: async <TRow>(text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ id: 'a1' } as TRow] };
    },
  };
  return { client, calls };
}

describe('writeAuditLog', () => {
  it('ghi một dòng bằng client của bên gọi, đủ cột theo thứ tự', async () => {
    const { client, calls } = fakeClient();
    const id = await writeAuditLog(client, {
      entityType: 'opportunity',
      entityId: 'o1',
      fromStatus: 'NEGOTIATION',
      toStatus: 'LOST',
      action: 'lose',
      actorId: 'u1',
      reason: '  Khách chọn đối thủ  ',
      metadata: { version: 2 },
    });
    expect(id).toBe('a1');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('INSERT INTO crm_schema.audit_log');
    expect(calls[0].text).not.toMatch(/BEGIN|COMMIT/);
    expect(calls[0].values).toEqual([
      'opportunity',
      'o1',
      'NEGOTIATION',
      'LOST',
      'lose',
      'u1',
      'Khách chọn đối thủ',
      '{"version":2}',
    ]);
  });

  it('trường tuỳ chọn bỏ trống thì ghi NULL, metadata rỗng; hệ thống tự làm thì không có actor', async () => {
    const { client, calls } = fakeClient();
    await writeAuditLog(client, { entityType: 'quote', entityId: 'q1', action: 'expire', reason: '   ' });
    expect(calls[0].values).toEqual(['quote', 'q1', null, null, 'expire', null, null, '{}']);
  });

  it('thiếu loại thực thể hoặc thao tác là lỗi lập trình, không ghi gì', async () => {
    const { client, calls } = fakeClient();
    await expect(writeAuditLog(client, { entityType: ' ', entityId: 'x', action: 'a' })).rejects.toThrow();
    await expect(writeAuditLog(client, { entityType: 'quote', entityId: 'x', action: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('lý do quá dài bị cắt ở 2000 ký tự', async () => {
    const { client, calls } = fakeClient();
    await writeAuditLog(client, { entityType: 'quote', entityId: 'q1', action: 'reject', reason: 'x'.repeat(2500) });
    expect((calls[0].values?.[6] as string).length).toBe(2000);
  });
});
