import type {
  ContractDetail,
  ContractLine,
  ContractStatus,
  ContractSummary,
  ContractType,
  CrmPage,
} from '@enterprise-platform/contracts-crm';
import type { KeysetCursor } from '../domain/pagination.js';
import type { PaymentTermDraft } from '../domain/payment-terms.js';
import type { CrmDataScope } from './data-scope.js';
import type { ReservedStock } from './fulfillment.port.js';

/**
 * Port lưu trữ hợp đồng (GĐ4). Hàm đọc nhận `scope` và lọc theo người phụ trách
 * hợp đồng; ngoài phạm vi đọc ra `undefined`. Hàm ghi khoá dòng hợp đồng rồi so
 * lại `revision` và trạng thái service đã đọc: lệch thì 409, không ghi đè.
 */

export const CRM_CONTRACT_STORE = Symbol('CRM_CONTRACT_STORE');
export const CRM_SALES_SETTINGS_STORE = Symbol('CRM_SALES_SETTINGS_STORE');

export interface ContractFilter {
  readonly q?: string;
  readonly status?: ContractStatus;
  readonly type?: ContractType;
  readonly customerId?: string;
  readonly ownerUserId?: string;
  /** Chỉ hợp đồng Hiệu lực có ngày kết thúc trong `[today, expiringBefore]`. */
  readonly expiring?: { readonly today: string; readonly until: string };
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface ContractRecord {
  readonly type: ContractType;
  readonly customerId: string;
  readonly title: string;
  readonly signedDate: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly value: number;
  readonly warrantyMonths: number | null;
  readonly warehouseCode: string | null;
  readonly ownerUserId: string;
  readonly note: string | null;
}

export type ContractLineRecord = ContractLine;

export interface ContractTransition {
  readonly from: ContractStatus;
  readonly to: Exclude<ContractStatus, 'DRAFT' | 'ACTIVE'>;
  /** Tên thao tác ghi nhật ký: `cancel`, `complete`, `liquidate`. */
  readonly action: string;
  readonly reason: string | null;
}

export interface ContractStore {
  listContracts(tenantId: string, scope: CrmDataScope, filter: ContractFilter): Promise<CrmPage<ContractSummary>>;
  getContract(tenantId: string, scope: CrmDataScope, id: string): Promise<ContractDetail | undefined>;
  /** Tạo hợp đồng Nháp cùng dòng và nhật ký. Trả id. */
  createContract(tenantId: string, record: ContractRecord, lines: readonly ContractLineRecord[], actorId: string): Promise<string>;
  /**
   * Sửa hợp đồng Nháp. `lines` rỗng (`undefined`) giữ dòng đang có; `terms`
   * có khi giá trị đổi (số tiền đợt phần trăm tính lại).
   */
  updateContract(
    tenantId: string,
    id: string,
    revision: number,
    record: ContractRecord,
    lines: readonly ContractLineRecord[] | undefined,
    terms: readonly PaymentTermDraft[] | undefined,
    actorId: string,
  ): Promise<void>;
  /** Thay toàn bộ đợt thanh toán của hợp đồng Nháp. */
  savePaymentTerms(tenantId: string, id: string, revision: number, terms: readonly PaymentTermDraft[], actorId: string): Promise<void>;
  /** Nháp → Hiệu lực, ghi phần giữ hàng (rỗng khi không có dòng cần giữ). */
  confirm(tenantId: string, id: string, revision: number, reservation: ReservedStock | null, actorId: string): Promise<void>;
  /** Huỷ, hoàn thành, thanh lý. Huỷ thì xếp lệnh nhả phần đang giữ (cả phần đơn đang dùng). */
  transition(tenantId: string, id: string, revision: number, transition: ContractTransition, actorId: string): Promise<void>;
  /** Số lần giữ hàng hiện tại (cho khoá chống lặp). */
  reserveAttempt(tenantId: string, id: string): Promise<number>;
  /** Lần giữ trước đã nhả: lần sau dùng khoá mới. */
  bumpReserveAttempt(tenantId: string, id: string): Promise<void>;
  /** Có đơn chưa huỷ nào của hợp đồng đã giao hàng. */
  hasDeliveredOrders(tenantId: string, id: string): Promise<boolean>;
  /** Job: hợp đồng Hiệu lực quá ngày kết thúc chuyển Hết hạn; tối đa `limit`. Trả số đã chuyển. */
  expireDue(tenantId: string, today: string, limit: number): Promise<number>;
}

export interface SalesSettingsStore {
  reservationHoldDays(tenantId: string): Promise<number>;
  contractExpiringDays(tenantId: string): Promise<number>;
  save(tenantId: string, settings: { reservationHoldDays: number; contractExpiringDays: number }, actorId: string): Promise<void>;
}
