/**
 * Một dòng nhật ký chuyển trạng thái (`crm_schema.audit_log`).
 *
 * Mọi máy trạng thái của Bán hàng (cơ hội, báo giá, hợp đồng, đơn bán, bảo
 * hành) ghi cùng một bảng: thực thể nào, từ trạng thái nào sang trạng thái nào,
 * ai làm, vì sao. Ghi trong cùng transaction với thay đổi dữ liệu.
 */
export interface CrmAuditEntry {
  /** Loại thực thể, chữ thường nối gạch dưới: `opportunity`, `quote`, `sales_order`… */
  readonly entityType: string;
  readonly entityId: string;
  /** Trạng thái trước khi chuyển; rỗng khi vừa tạo. */
  readonly fromStatus?: string | null;
  /** Trạng thái sau khi chuyển; rỗng với thao tác không đổi trạng thái. */
  readonly toStatus?: string | null;
  /** Thao tác đã làm, ví dụ `submit`, `approve`, `cancel`. */
  readonly action: string;
  /** Người làm; rỗng khi hệ thống tự làm (job, sự kiện). */
  readonly actorId?: string | null;
  /** Lý do người dùng nhập (bắt buộc với một số chuyển như Thua, Huỷ). */
  readonly reason?: string | null;
  /** Thông tin thêm để tra cứu: id sự kiện gây ra, số phiên bản… */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Giới hạn độ dài khớp với cột trong migration 0001. */
export const CRM_AUDIT_LIMITS = {
  entityType: 64,
  status: 64,
  action: 64,
  reason: 2000,
} as const;

/**
 * Kiểm và chuẩn hoá một dòng nhật ký trước khi ghi. Lỗi ở đây là lỗi lập trình
 * (bên gọi truyền sai), nên ném `Error` thường chứ không phải lỗi nghiệp vụ.
 */
export function normalizeAuditEntry(entry: CrmAuditEntry): CrmAuditEntry {
  const entityType = entry.entityType.trim();
  const action = entry.action.trim();
  if (!entityType || entityType.length > CRM_AUDIT_LIMITS.entityType) {
    throw new Error(`Invalid audit entity type: "${entry.entityType}".`);
  }
  if (!action || action.length > CRM_AUDIT_LIMITS.action) {
    throw new Error(`Invalid audit action: "${entry.action}".`);
  }
  for (const status of [entry.fromStatus, entry.toStatus]) {
    if (status && status.length > CRM_AUDIT_LIMITS.status) {
      throw new Error(`Invalid audit status: "${status}".`);
    }
  }
  const reason = entry.reason?.trim() || null;
  return {
    entityType,
    entityId: entry.entityId,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    action,
    actorId: entry.actorId ?? null,
    reason: reason ? reason.slice(0, CRM_AUDIT_LIMITS.reason) : null,
    metadata: entry.metadata ?? {},
  };
}
