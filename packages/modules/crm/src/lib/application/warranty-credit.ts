import { CrmConflictError } from '../domain/crm.error.js';
import type { ReceivableAdjustmentService } from './receivable-adjustment.service.js';
import type { WarrantyCreditPort, WarrantyCreditRequest, WarrantyCreditResult } from './warranty.port.js';

/**
 * Giảm trừ công nợ, hoàn tiền của dòng trả hàng (T6-06, TC-WAR-11) qua sổ công
 * nợ GĐ5: tạo điều chỉnh giảm trừ Chờ duyệt, idempotent theo dòng bảo hành.
 * Điều chỉnh chưa duyệt thì chứng từ Chờ sổ công nợ; đã duyệt thì Đã ghi sổ
 * ("Gửi lại chứng từ" đọc lại trạng thái). Điều chỉnh bị huỷ thì báo lỗi để
 * người xử lý thấy và làm tiếp ở màn công nợ.
 */
export class ReceivableWarrantyCredit implements WarrantyCreditPort {
  constructor(private readonly adjustments: Pick<ReceivableAdjustmentService, 'createAdjustment'>) {}

  async requestCredit(request: WarrantyCreditRequest): Promise<WarrantyCreditResult> {
    const { adjustment } = await this.adjustments.createAdjustment({
      customerId: request.customerId,
      orderId: request.orderId,
      amount: request.amount,
      reason: request.reason,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      actor: { tenantId: request.tenantId, userId: request.actorId },
      direction: 'DECREASE',
    });
    if (adjustment.status === 'CANCELLED') {
      throw new CrmConflictError(
        'ADJUSTMENT_CANCELLED',
        `Điều chỉnh công nợ ${adjustment.code} của dòng này đã bị huỷ; vui lòng xử lý ở màn Công nợ.`,
      );
    }
    return {
      status: adjustment.status === 'APPROVED' ? 'POSTED' : 'PENDING_RECEIVABLE',
      documentId: adjustment.id,
      documentCode: adjustment.code,
    };
  }
}
