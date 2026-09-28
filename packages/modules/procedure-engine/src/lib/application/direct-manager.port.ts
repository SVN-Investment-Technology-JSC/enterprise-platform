import type { ProcedureManagerChainLink } from '@enterprise-platform/contracts-procedure-engine';

export const DIRECT_MANAGER_RESOLVER = Symbol('DIRECT_MANAGER_RESOLVER');

export interface DirectManagerChain {
  /** Chức danh được dùng làm gốc (chức danh chính của người đó, nếu không chỉ định). */
  readonly initiatorPositionId?: string;
  /** Từ quản lý trực tiếp leo lên gốc cây, đã áp ô ghi đè và bỏ phân công hết hạn. */
  readonly chain: readonly ProcedureManagerChainLink[];
}

/**
 * Hỏi Core chuỗi quản lý của một người, theo quan hệ "Báo cáo cho" giữa các chức danh.
 *
 * Dữ liệu tổ chức thuộc Core; Procedure chỉ đọc qua cổng này và không bao giờ
 * tự suy từ bảng `core_schema`. Gọi ngoài transaction vì là lời gọi mạng.
 */
export interface DirectManagerResolver {
  chain(tenantId: string, userId: string, positionId?: string): Promise<DirectManagerChain>;
}
