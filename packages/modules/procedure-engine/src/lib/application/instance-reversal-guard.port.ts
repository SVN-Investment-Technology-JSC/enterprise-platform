export const INSTANCE_REVERSAL_GUARD = Symbol('INSTANCE_REVERSAL_GUARD');

/** Câu trả lời của module nguồn: có cho huỷ hiệu lực hồ sơ này không, và vì sao. */
export interface ReversalCheck {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Hỏi module đã sinh ra hồ sơ (hiện là HRM) trước khi huỷ hiệu lực.
 *
 * Chỉ ĐỌC — Quy trình không ghi sang module khác; việc hoàn tác thật do module
 * nguồn làm khi nhận `procedure.instance.reversed`. Hỏi trước để chặn hẳn khi
 * kỳ công/lương đã khoá, thay vì huỷ bên này rồi bên kia từ chối.
 */
export interface InstanceReversalGuard {
  check(
    tenantId: string,
    source: { readonly sourceType: string; readonly sourceId: string },
  ): Promise<ReversalCheck>;
}
