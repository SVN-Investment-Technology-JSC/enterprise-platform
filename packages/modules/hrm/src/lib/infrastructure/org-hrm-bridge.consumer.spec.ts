import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OrgHrmBridgeConsumer } from './org-hrm-bridge.consumer.js';

// Chỉ cần kiểu để Nest tiêm; không nạp cả platform-identity (jose là ESM).
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));

describe('SEC-BE020-01: HRM không ghi tài khoản, bổ nhiệm của Core khi nhân viên nghỉ việc (ISS-BE-020)', () => {
  const source = readFileSync(resolve(__dirname, 'org-hrm-bridge.consumer.ts'), 'utf8');

  it('không còn câu lệnh ghi core_schema.users hay tự đóng bổ nhiệm', () => {
    expect(source).not.toMatch(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+core_schema\.users/i);
    expect(source).not.toMatch(/SET\s+status\s*=\s*'inactive'/i);
    expect(source).not.toMatch(/'hrm\.employee\.offboarded'/);
  });

  it('không đọc sự kiện nghỉ việc từ outbox (để relay phát cho Core)', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      }),
    };
    const consumer = new OrgHrmBridgeConsumer(
      { serviceDatabase: async () => ({ tenantId: 't' }) } as never,
      { forTenant: async () => pool } as never,
    );
    await consumer.processTenantEvents('t');
    const select = queries.find((q) => q.sql.includes('FROM integration_schema.outbox_events'));
    expect(select?.sql).toBeDefined();
    expect(select?.sql).not.toContain('hrm.employee.offboarded');
    expect(queries.some((q) => /core_schema\.users/i.test(q.sql))).toBe(false);
  });
});

describe('E-01: HRM không ghi core_schema; Core tự gắn employee_id cho bổ nhiệm', () => {
  const source = readFileSync(resolve(__dirname, 'org-hrm-bridge.consumer.ts'), 'utf8');
  const coreMigration = readFileSync(
    resolve(__dirname, '../../../../../../migrations/tenant/core/0021-assignment-employee-link.sql'),
    'utf8',
  );

  it('org-hrm-bridge không còn câu lệnh ghi bảng nào của core_schema', () => {
    expect(source).not.toMatch(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+core_schema\./i);
    expect(source).not.toContain("'core.org.assignment.created'");
  });

  it('không đọc core.org.assignment.created từ outbox (relay phát như core.org.assignment.updated)', async () => {
    const queries: string[] = [];
    const pool = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    };
    const consumer = new OrgHrmBridgeConsumer(
      { serviceDatabase: async () => ({ tenantId: 't' }) } as never,
      { forTenant: async () => pool } as never,
    );
    await consumer.processTenantEvents('t');
    const select = queries.find((sql) => sql.includes('FROM integration_schema.outbox_events'));
    expect(select).toBeDefined();
    expect(select).not.toContain('core.org.assignment.created');
    expect(select).toContain('core.org.assignment.ended');
  });

  it('migration Core 0021 điền employee_id khi bổ nhiệm mới và khi dòng liên kết được gắn tài khoản', () => {
    expect(coreMigration).toMatch(
      /CREATE TRIGGER trg_core_assignment_fill_employee\s+BEFORE INSERT OR UPDATE OF user_id, employee_id\s+ON core_schema\.organization_node_assignments/,
    );
    expect(coreMigration).toMatch(
      /CREATE TRIGGER trg_core_employee_link_assignments\s+AFTER INSERT OR UPDATE OF user_id, deleted_at\s+ON core_schema\.employees/,
    );
    // Chỉ điền chỗ trống, không ghi đè employee_id đã có (ví dụ do quyết định nhân sự đặt).
    expect(coreMigration).toMatch(/IF NEW\.employee_id IS NULL AND NEW\.user_id IS NOT NULL/);
    expect(coreMigration).toMatch(/a\.employee_id IS NULL/);
    expect(coreMigration).not.toMatch(/hrm_schema/);
  });
});
