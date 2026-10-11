import { assertOpenDate, assertOpenRange } from './hrm-time';

/** Chốt đơn từ (timesheet_periods.requests_closed_at) chặn tạo/sửa/duyệt đơn có ngày thuộc tháng, như kỳ đã khóa. */
function dbWith(periods: Record<string, unknown>[]) {
  const calls: string[] = [];
  return {
    calls,
    db: {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: sql.includes('SELECT id,status') ? periods : [], rowCount: 0 };
      }),
    },
  };
}

const period = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  status: 'OPEN',
  from_date: '2026-10-01',
  to_date: '2026-10-31',
  requests_closed_at: null,
  ...over,
});

describe('assertOpenDate / assertOpenRange với tháng đã chốt đơn từ', () => {
  it('tháng đã chốt đơn từ: từ chối với thông báo tiếng Việt', async () => {
    const { db, calls } = dbWith([period({ requests_closed_at: '2026-11-01T00:00:00.000Z' })]);
    await expect(assertOpenDate(db as never, 't', '2026-10-15')).rejects.toMatchObject({
      status: 409,
      message: 'Tháng 10/2026 đã chốt đơn từ',
    });
    // không đánh dấu "cần tính lại" khi bị từ chối
    expect(calls.some((s) => s.includes('calculated_at=NULL'))).toBe(false);
  });

  it('khoảng ngày chạm tháng đã chốt: thông báo theo tháng của ngày chạm', async () => {
    const { db } = dbWith([period({ requests_closed_at: '2026-11-01T00:00:00.000Z' })]);
    await expect(assertOpenRange(db as never, 't', '2026-09-28', '2026-10-02')).rejects.toMatchObject({
      message: 'Tháng 10/2026 đã chốt đơn từ',
    });
    await expect(assertOpenRange(db as never, 't', '2026-10-20', '2026-11-05')).rejects.toMatchObject({
      message: 'Tháng 10/2026 đã chốt đơn từ',
    });
  });

  it('kỳ đã khóa vẫn bị chặn như cũ', async () => {
    const { db } = dbWith([period({ status: 'LOCKED' })]);
    await expect(assertOpenDate(db as never, 't', '2026-10-15')).rejects.toMatchObject({
      message: 'Kỳ công đã khóa; cần mở lại kỳ trước khi thay đổi dữ liệu',
    });
  });

  it('tháng chưa chốt hoặc chưa có kỳ: cho phép và đánh dấu cần tính lại', async () => {
    const open = dbWith([period()]);
    await expect(assertOpenDate(open.db as never, 't', '2026-10-15')).resolves.toBeUndefined();
    expect(open.calls.some((s) => s.includes('calculated_at=NULL'))).toBe(true);
    const none = dbWith([]);
    await expect(assertOpenDate(none.db as never, 't', '2026-10-15')).resolves.toBeUndefined();
  });

  it('truy vấn đọc requests_closed_at qua to_jsonb nên không lỗi trên tenant chưa chạy migration 0046', async () => {
    const { db } = dbWith([]);
    await assertOpenDate(db as never, 't', '2026-10-15');
    const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain("to_jsonb(p)->>'requests_closed_at'");
  });
});
