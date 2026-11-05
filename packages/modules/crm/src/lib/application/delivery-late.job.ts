import type { SalesOrderStore } from './sales-order-store.port.js';

/**
 * Theo dõi giao trễ (ORD-06, T4-14): đợt giao Kế hoạch hoặc Đã yêu cầu xuất mà
 * quá ngày dự kiến được báo `crm.delivery.late` cho người phụ trách đơn, một
 * lần cho mỗi ngày dự kiến (dời ngày thì báo lại khi trễ ngày mới). Danh sách
 * đơn lọc "giao trễ" đọc thẳng theo ngày nên đợt đã xuất kho tự ra khỏi bộ lọc.
 * Worker chạy mỗi phút; mỗi lượt tối đa `limit` đợt, lượt sau làm tiếp.
 */
export async function notifyLateDeliveries(
  orders: Pick<SalesOrderStore, 'notifyLateDeliveries'>,
  tenantId: string,
  today: string,
  limit: number,
): Promise<number> {
  let total = 0;
  // Gom tới khi hết đợt trễ hoặc chạm trần một lượt, để tenant nhiều đơn trễ không dồn sang phút sau.
  for (let round = 0; round < 5; round += 1) {
    const sent = await orders.notifyLateDeliveries(tenantId, today, limit);
    total += sent;
    if (sent < limit) break;
  }
  return total;
}
