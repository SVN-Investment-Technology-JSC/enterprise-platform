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

describe('lưu trữ và bật lại lịch', () => {
  function pool(current: Record<string, unknown>[] = []) {
    // Hàng đủ cột để mapSchedule dựng được lịch trả về sau UPDATE.
    const rows = current.map((row) => ({
      id: 'sch-1', code: 'SCH-1', title: 'Bảo trì', asset_code: 'MBA-T1', priority: 'Normal', start_date: '2026-01-01',
      timezone: 'Asia/Ho_Chi_Minh', created_at: new Date(), updated_at: new Date(), ...row,
    }));
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows, rowCount: rows.length || 1 }));
    const store = new PostgresMaintenanceStore(
      { require: () => ({ tenantId: 'tenant' }) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => ({ query }) } as unknown as PostgresPoolRegistry,
      'http://procedure.test',
    );
    return { store, query };
  }

  it('gỡ thiết bị chỉ lưu trữ lịch, không xoá phiếu hay lịch', async () => {
    const { store, query } = pool();
    await store.removeSchedulesForAsset('tenant', 'MBA-T1');
    const sql = query.mock.calls.map(([text]) => String(text)).join('\n');
    expect(sql).toContain('archived_at = now()');
    expect(sql).not.toMatch(/DELETE/i);
  });

  it('bật lại lịch với ngày người dùng chọn: đặt hạn và ngày bắt đầu theo ngày đó', async () => {
    const { store, query } = pool([{ status: 'paused', frequency: 'week', next_due_at: '2026-03-01T00:00:00Z' }]);
    await store.updateSchedule('tenant', 'sch-1', { status: 'active' }, { nextDueAt: '2026-11-20' });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE maintenance_schema.schedules SET'));
    expect(update?.[1]?.[5]).toEqual(new Date('2026-11-20'));
    expect(update?.[1]?.[6]).toBe('2026-11-20');
  });

  it('bật lại lịch có hạn cũ đã qua và không có ngày chọn: dời sang kỳ kế tiếp trong tương lai', async () => {
    const { store, query } = pool([{ status: 'paused', frequency: 'week', next_due_at: '2026-03-01T00:00:00Z' }]);
    await store.updateSchedule('tenant', 'sch-1', { status: 'active' });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE maintenance_schema.schedules SET'));
    const nextDueAt = update?.[1]?.[5] as Date;
    expect(nextDueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('lịch đang chạy sửa ưu tiên thì không đổi hạn', async () => {
    const { store, query } = pool([{ status: 'active', frequency: 'week', next_due_at: '2026-12-01T00:00:00Z' }]);
    await store.updateSchedule('tenant', 'sch-1', { priority: 'High' });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE maintenance_schema.schedules SET'));
    expect(update?.[1]?.[5]).toBeNull();
  });
});

describe('lọc Lịch sử theo ngày', () => {
  function history() {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
    const store = new PostgresMaintenanceStore(
      { require: () => ({ tenantId: 'tenant' }) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => ({ query }) } as unknown as PostgresPoolRegistry,
      'http://procedure.test',
    );
    return { store, query };
  }

  it('ngày YYYY-MM-DD tính theo giờ địa phương; "đến ngày" gồm cả ngày được chọn', async () => {
    const { store, query } = history();
    await store.readHistory('tenant', { from: '2026-11-10', to: '2026-11-10' });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("o.due_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')");
    expect(String(sql)).toContain("o.due_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')");
    expect(params).toEqual(['2026-11-10', '2026-11-10']);
  });

  it('giá trị có kèm giờ giữ nguyên nghĩa cũ', async () => {
    const { store, query } = history();
    await store.readHistory('tenant', { from: '2026-11-10T03:00:00.000Z' });
    expect(String(query.mock.calls[0][0])).toContain('o.due_at >= $1');
    expect(query.mock.calls[0][1]?.[0]).toEqual(new Date('2026-11-10T03:00:00.000Z'));
  });
});

describe('người phụ trách của lịch', () => {
  function pool() {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [{ id: 'sch-1', code: 'SCH-1', title: 'Bảo trì', asset_code: 'MBA-T1', frequency: 'week', priority: 'Normal', status: 'active', start_date: '2026-01-01', timezone: 'Asia/Ho_Chi_Minh', created_at: new Date(), updated_at: new Date(), next_due_at: new Date(), assignee_id: '11111111-1111-4111-8111-111111111111', assignee_name: 'Tài' }],
      rowCount: 1,
    }));
    const store = new PostgresMaintenanceStore(
      { require: () => ({ tenantId: 'tenant' }) } as unknown as TenantDatabaseRegistry,
      { forTenant: async () => ({ query }) } as unknown as PostgresPoolRegistry,
      'http://procedure.test',
    );
    return { store, query };
  }

  it('tạo lịch ghi người phụ trách; id không phải uuid thì thành NULL', async () => {
    const { store, query } = pool();
    await store.createSchedule('tenant', { assetCode: 'MBA-T1', frequency: 'week', startDate: '2026-11-20', assigneeId: '11111111-1111-4111-8111-111111111111', assigneeName: ' Tài ' });
    expect(query.mock.calls[0][1]?.slice(-2)).toEqual(['11111111-1111-4111-8111-111111111111', 'Tài']);
    query.mockClear();
    await store.createSchedule('tenant', { assetCode: 'MBA-T1', frequency: 'week', startDate: '2026-11-20', assigneeId: 'khong-phai-uuid', assigneeName: 'X' });
    expect(query.mock.calls[0][1]?.slice(-2)).toEqual([null, null]);
  });

  it('cập nhật: không có khoá assigneeId thì giữ nguyên, có null thì bỏ', async () => {
    const { store, query } = pool();
    await store.updateSchedule('tenant', 'sch-1', { priority: 'High' });
    expect(query.mock.calls[0][1]?.[7]).toBe(false);
    query.mockClear();
    await store.updateSchedule('tenant', 'sch-1', { assigneeId: null });
    expect(query.mock.calls[0][1]?.slice(7)).toEqual([true, null, null]);
  });

  it('lịch đọc ra mang người phụ trách', async () => {
    const { store } = pool();
    const saved = await store.updateSchedule('tenant', 'sch-1', { priority: 'High' });
    expect(saved).toMatchObject({ assigneeId: '11111111-1111-4111-8111-111111111111', assigneeName: 'Tài' });
  });
});
