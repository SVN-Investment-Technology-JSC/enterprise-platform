import { BadRequestException } from '@nestjs/common';
import { ensureCoreEmployeeLink, refreshCoreEmployeeIdentity } from './hrm-core-link';

const TENANT = 't1';
const USER = '00000000-0000-4000-8000-0000000000c1';

function db(handler: (sql: string, params: unknown[]) => unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = handler(sql, params);
      return { rows, rowCount: rows.length };
    }),
  };
}

describe('liên kết nhân sự Core cho hồ sơ HRM', () => {
  it('tài khoản đã có nhân sự thì dùng lại, không ghi gì', async () => {
    const client = db((sql) => (sql.startsWith('SELECT id FROM core_schema.employees') ? [{ id: 'emp-1' }] : []));
    await expect(ensureCoreEmployeeLink(client, TENANT, USER)).resolves.toBe('emp-1');
    expect(client.calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('chưa có thì tạo một dòng, họ tên và email lấy từ tài khoản Core, chỉ nhận id tenant và id tài khoản', async () => {
    const client = db((sql) => (sql.includes('INSERT INTO core_schema.employees') ? [{ id: USER }] : []));
    await expect(ensureCoreEmployeeLink(client, TENANT, USER)).resolves.toBe(USER);
    const insert = client.calls.find((c) => c.sql.includes('INSERT INTO core_schema.employees'));
    expect(insert?.params).toEqual([TENANT, USER]);
    expect(insert?.sql).toMatch(/u\.full_name/);
    expect(insert?.sql).toMatch(/u\.email/);
    expect(insert?.sql).toMatch(/status = 'active'/);
  });

  it('tài khoản không hoạt động hoặc không tồn tại thì từ chối', async () => {
    await expect(ensureCoreEmployeeLink(db(() => []), TENANT, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cập nhật từ Core: chỉ sửa nhân sự có tài khoản và khác với tài khoản, đọc từ users', async () => {
    const client = db(() => [{ id: 'a' }, { id: 'b' }]);
    await expect(refreshCoreEmployeeIdentity(client, TENANT)).resolves.toEqual(['a', 'b']);
    const sql = client.calls[0].sql;
    expect(sql).toContain('FROM core_schema.users u');
    expect(sql).toContain('e.user_id = u.id');
    expect(sql).toContain('IS DISTINCT FROM');
    expect(client.calls[0].params).toEqual([TENANT]);
  });
});
