import type {
  Lot,
  LotDetail,
  QualityStatus,
  SerialHistory,
} from '@enterprise-platform/contracts-inventory';
import type { LotCandidate } from '../domain/traceability-policy.js';

export const TRACEABILITY_STORE = Symbol('TRACEABILITY_STORE');

/** Kết luận của service sau khi kiểm đổi trạng thái chất lượng trên bản ghi đã khoá. */
export interface QualityDecision {
  readonly to: QualityStatus;
  readonly reason: string;
}

/** Hàm kiểm của service, chạy trên trạng thái mới nhất của lô hoặc serial đã khoá. */
export type DecideQuality = (current: QualityStatus, subject: string) => QualityDecision;

/** Lô, serial và trạng thái chất lượng (T1-15, T1-17, T1-19). */
export interface TraceabilityStore {
  /** Lô của một mặt hàng kèm tồn từng kho; ném lỗi 404 khi không có mặt hàng. */
  listLots(tenantId: string, materialCode: string): Promise<Lot[]>;
  getLot(tenantId: string, lotId: string): Promise<LotDetail | null>;
  /** Lô có tồn của mặt hàng tại một kho, cho gợi ý FEFO. */
  lotCandidates(tenantId: string, materialCode: string, warehouseCode: string): Promise<LotCandidate[]>;
  /**
   * Tra một serial. Cùng số serial ở nhiều mặt hàng mà không nêu `materialCode`
   * thì 409; không có thì null.
   */
  serialHistory(tenantId: string, serial: string, materialCode?: string): Promise<SerialHistory | null>;
  /** Khoá serial, gọi `decide`, cập nhật tồn không Đạt và ghi lịch sử trong một transaction. */
  changeSerialQuality(
    tenantId: string,
    serial: string,
    materialCode: string | undefined,
    actorId: string,
    decide: DecideQuality,
  ): Promise<SerialHistory>;
  /** Khoá lô, gọi `decide`, cập nhật tồn không Đạt của mọi kho và ghi lịch sử trong một transaction. */
  changeLotQuality(
    tenantId: string,
    lotId: string,
    actorId: string,
    decide: DecideQuality,
  ): Promise<LotDetail>;
}
