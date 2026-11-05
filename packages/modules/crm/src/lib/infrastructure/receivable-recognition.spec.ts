import type { CrmSqlClient } from './audit-log.js';
import { contractFullyDelivered, FULL_DELIVERY_IGNORED_ORDER_STATUSES } from './receivable-recognition.js';

function fakeClient(row: { total: number; open: number } | undefined) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const client: CrmSqlClient = {
    query: async <TRow>(text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: (row ? [row] : []) as TRow[] };
    },
  };
  return { client, calls };
}

describe('contractFullyDelivered (T8-08)', () => {
  it('bỏ qua đơn Nháp và đơn đã huỷ; đơn Chờ duyệt hạn mức vẫn tính', async () => {
    expect(FULL_DELIVERY_IGNORED_ORDER_STATUSES).toEqual(['DRAFT', 'CANCELLED']);
    expect(FULL_DELIVERY_IGNORED_ORDER_STATUSES).not.toContain('CREDIT_PENDING');
    const { client, calls } = fakeClient({ total: 2, open: 0 });
    await contractFullyDelivered(client, 'k1');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('o.status <> ALL($2::text[])');
    expect(calls[0].values).toEqual(['k1', ['DRAFT', 'CANCELLED']]);
  });

  it('giao đủ khi có dòng đơn đã cam kết và không còn dòng chưa giao đủ', async () => {
    await expect(contractFullyDelivered(fakeClient({ total: 2, open: 0 }).client, 'k1')).resolves.toBe(true);
    await expect(contractFullyDelivered(fakeClient({ total: 2, open: 1 }).client, 'k1')).resolves.toBe(false);
    await expect(contractFullyDelivered(fakeClient({ total: 0, open: 0 }).client, 'k1')).resolves.toBe(false);
    await expect(contractFullyDelivered(fakeClient(undefined).client, 'k1')).resolves.toBe(false);
  });
});
