import type {
  StocktakeLine,
  StocktakeLineAudit,
  StocktakeLinesResult,
  StocktakeListQuery,
  StocktakePage,
  StocktakeScopeType,
  StocktakeSession,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';

export const STOCKTAKE_STORE = Symbol('STOCKTAKE_STORE');

export interface NewStocktakeInput {
  readonly title: string;
  readonly warehouseCode: string;
  readonly stocktakeDate?: string;
  readonly scopeType: StocktakeScopeType;
  readonly scopeCategories?: readonly string[];
  readonly scopeMaterialCodes?: readonly string[];
  readonly leadAuditor?: string;
  readonly auditors?: readonly string[];
  readonly note?: string;
  readonly createdBy: string;
}

export interface StocktakeLineFilter {
  readonly status?: StocktakeLine['status'];
  readonly search?: string;
  readonly hasDiffOnly?: boolean;
}

/** Người thao tác, ghi lên nhật ký sửa số đếm (`operator` giới hạn 100 ký tự). */
export interface StocktakeActor {
  readonly id: string;
  readonly name: string;
}

/** Đổi trạng thái đợt sang một trong các trạng thái này, kèm người làm và lý do nếu có. */
export interface StocktakeTransition {
  readonly to: 'COUNTING' | 'PENDING_APPROVAL' | 'APPROVED' | 'CANCELLED';
  readonly actorId: string;
  readonly reason?: string;
}

/**
 * Kho lưu kiểm kê. Mọi thao tác đổi dữ liệu khoá đợt `FOR UPDATE`, gọi `check`
 * trên bản ghi mới nhất (nên ném lỗi nếu không hợp lệ) rồi áp thay đổi, tất cả
 * trong một transaction.
 */
export interface StocktakeStore {
  list(tenantId: string, query: StocktakeListQuery): Promise<StocktakePage>;
  /** Tìm theo id (UUID) hoặc mã đợt. */
  get(tenantId: string, key: string): Promise<StocktakeSession | null>;
  lines(tenantId: string, key: string, filter?: StocktakeLineFilter): Promise<StocktakeLine[]>;
  audits(tenantId: string, key: string): Promise<StocktakeLineAudit[]>;
  create(tenantId: string, input: NewStocktakeInput): Promise<StocktakeSession>;
  /**
   * Chụp số tồn sổ sách của phạm vi kiểm kê thành các dòng, đặt `snapshot_at` và
   * chuyển sang Đang kiểm đếm. Phạm vi không có vật tư nào thì ném lỗi.
   */
  start(
    tenantId: string,
    key: string,
    actorId: string,
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeLinesResult>;
  /** Ghi số đếm của một hoặc nhiều dòng, tính chênh lệch và ghi nhật ký khi số đếm đổi. */
  saveLines(
    tenantId: string,
    key: string,
    actor: StocktakeActor,
    updates: readonly UpdateStocktakeLineInput[],
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeLinesResult>;
  transition(
    tenantId: string,
    key: string,
    change: StocktakeTransition,
    check: (current: StocktakeSession, lines: readonly StocktakeLine[]) => void,
  ): Promise<StocktakeSession>;
  /** Đánh dấu Đã ghi sổ và gắn chứng từ điều chỉnh (nếu có). */
  markPosted(
    tenantId: string,
    key: string,
    input: { readonly documentId?: string; readonly actorId: string },
    check: (current: StocktakeSession) => void,
  ): Promise<StocktakeSession>;
}
