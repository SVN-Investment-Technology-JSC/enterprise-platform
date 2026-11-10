import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { PostgresMaintenanceStore } from './postgres-maintenance-store.js';

/**
 * Pool giả: trả lời theo nội dung câu SQL. Đủ để kiểm tra luồng gửi phiếu sang Quy trình (claim lượt gửi, thử lại lỗi
 * tạm thời, báo lỗi vĩnh viễn, không đè phiếu đã đóng) mà không cần DB thật.
 */
function setup(options: { claim: number | null; reconcileRows?: number }) {
  const statements: string[] = [];
  const clientQuery = jest.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("status='failed'")) {
      return { rows: [{ id: 'occ-1', code: null, title: 'Phiếu', assignee_id: null, created_by: null }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const connect = jest.fn(async () => ({ query: clientQuery, release: jest.fn() }));
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    statements.push(sql);
    if (sql.includes('FROM maintenance_schema.occurrences o') && sql.includes("o.status = 'dispatch_pending'")) {
      return {
        rows: Array.from({ length: options.reconcileRows ?? 1 }, () => ({
          id: 'occ-1',
          idempotency_key: 'maintenance:sch:2026-11-10',
          title: 'Phiếu',
          procedure_definition_id: 'def-1',
          asset_code: 'MBA-T1',
        })),
        rowCount: 1,
      };
    }
    if (sql.includes('dispatch_attempts = dispatch_attempts + 1')) {
      return options.claim === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ dispatch_attempts: options.claim }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect };
  const store = new PostgresMaintenanceStore(
    { require: () => ({ tenantId: 'tenant' }) } as unknown as TenantDatabaseRegistry,
    { forTenant: async () => pool } as unknown as PostgresPoolRegistry,
    'http://procedure.test',
  );
  return { store, query, connect, statements };
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function respondWith(status: number, body: unknown = {}) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('gửi phiếu bảo trì sang Quy trình', () => {
  it('lỗi 5xx còn lượt thử: giữ dispatch_pending, ghi lý do, không báo lỗi', async () => {
    const { store, query, connect } = setup({ claim: 2 });
    respondWith(503);
    await store.reconcileStuckDispatches('tenant', new Date());
    expect(connect).not.toHaveBeenCalled();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('SET failure_reason = $2'));
    expect(update?.[1]?.[1]).toContain('Đang thử lại (2/5)');
  });

  it('hết lượt thử: chuyển failed và phát thông báo lỗi', async () => {
    const { store, connect, statements } = setup({ claim: 5 });
    respondWith(502);
    await store.reconcileStuckDispatches('tenant', new Date());
    expect(connect).toHaveBeenCalledTimes(1);
    expect(statements.some((sql) => sql.includes("SET status='failed'") && sql.includes("status='dispatch_pending'"))).toBe(true);
  });

  it('lỗi 4xx: failed ngay, không thử lại', async () => {
    const { store, connect } = setup({ claim: 1 });
    respondWith(422);
    await store.reconcileStuckDispatches('tenant', new Date());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('lỗi mạng được coi là tạm thời', async () => {
    const { store, connect, query } = setup({ claim: 1 });
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
    await store.reconcileStuckDispatches('tenant', new Date());
    expect(connect).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SET failure_reason = $2'))).toBe(true);
  });

  it('phiếu đã bị đóng hoặc đã có hồ sơ (không claim được) thì không gọi Quy trình', async () => {
    const { store } = setup({ claim: null });
    respondWith(200, { id: 'inst', code: 'PR-1' });
    await store.reconcileStuckDispatches('tenant', new Date());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('thành công chỉ ghi generated khi phiếu còn dispatch_pending', async () => {
    const { store, statements } = setup({ claim: 1 });
    respondWith(200, { id: 'inst', code: 'PR-1' });
    await store.reconcileStuckDispatches('tenant', new Date());
    const update = statements.find((sql) => sql.includes("status='generated'"));
    expect(update).toContain("status='dispatch_pending'");
  });

  it('retryDispatch từ chối phiếu không ở trạng thái failed', async () => {
    const { store } = setup({ claim: 1 });
    // reset không trúng dòng nào và phiếu không tồn tại -> not_found
    await expect(store.retryDispatch('tenant', 'occ-x')).rejects.toMatchObject({ name: 'MaintenanceError' });
  });
});
