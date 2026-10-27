import type { Reservation } from '@enterprise-platform/contracts-inventory';
import type { InventoryStore } from './inventory-store.port.js';

/** Số giữ hàng tối đa nhả trong một lượt, để một tenant không giữ tick của worker quá lâu. */
export const RESERVATION_EXPIRY_BATCH_SIZE = 100;

/**
 * Nhả giữ hàng hết hạn (T1-10, Q12).
 *
 * Giữ hàng RESERVED hoặc PARTIALLY_ISSUED có `expires_at` đã qua: phần chưa xuất
 * trả về khả dụng, trạng thái thành EXPIRED, sự kiện `inventory.reservation.expired`
 * vào outbox cùng transaction. Giữ hàng không có hạn không bao giờ bị động tới.
 * Chạy lại an toàn: giữ hàng đã EXPIRED không còn khớp điều kiện.
 */
export class ReservationExpiryJob {
  constructor(
    private readonly store: Pick<InventoryStore, 'reservation'>,
    private readonly batchSize = RESERVATION_EXPIRY_BATCH_SIZE,
  ) {}

  run(tenantId: string): Promise<Reservation[]> {
    return this.store.reservation.expireDue(tenantId, this.batchSize);
  }
}
