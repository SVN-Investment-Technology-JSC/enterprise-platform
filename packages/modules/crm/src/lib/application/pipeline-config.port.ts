import type { Pipeline } from '@enterprise-platform/contracts-crm';

/** Token DI của `PipelineConfigProvider` (cấu hình luồng, có cache). */
export const CRM_PIPELINE_CONFIG = Symbol('CRM_PIPELINE_CONFIG');

/** Đọc cấu hình luồng của một tenant từ nguồn (DB). */
export interface PipelineConfigReader {
  /** Mọi luồng của tenant (cả luồng tắt), mỗi luồng kèm giai đoạn, bước chuyển, điều kiện. */
  loadPipelines(tenantId: string): Promise<readonly Pipeline[]>;
}

/**
 * Nguồn cấu hình luồng cho service. Bản có cache: `invalidate(tenantId)` phải
 * được gọi ngay khi cấu hình đổi (P2G-05) để lần chuyển giai đoạn kế tiếp dùng
 * cấu hình mới.
 */
export interface PipelineConfigProvider {
  /** Cấu hình hiện hành (có thể từ cache). */
  pipelines(tenantId: string): Promise<readonly Pipeline[]>;
  /** Bỏ cache của tenant (hoặc tất cả khi không truyền) để lần đọc sau tải lại từ nguồn. */
  invalidate(tenantId?: string): void;
}
