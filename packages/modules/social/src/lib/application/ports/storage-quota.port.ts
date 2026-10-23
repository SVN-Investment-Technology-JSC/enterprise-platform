/**
 * Cổng hạn mức dung lượng của tenant. Hạn mức và dung lượng đã dùng (mọi phân hệ) do Hệ dùng chung
 * giữ; Mạng nội bộ chỉ hỏi trước khi ký URL tải lên. Ném `SocialStorageQuotaExceededError` khi Hệ
 * dùng chung trả lời rõ là vượt hạn mức; mọi trục trặc khác thì cho qua (fail-open).
 */
export const STORAGE_QUOTA = Symbol('SOCIAL_STORAGE_QUOTA');

export interface StorageQuotaPort {
  ensureCapacity(tenantId: string, additionalBytes: number): Promise<void>;
}
