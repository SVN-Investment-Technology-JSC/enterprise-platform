/** Người duyệt dự kiến của một đơn chờ duyệt trực tiếp (không qua Procedure Engine), do `/request-direct-approvers` trả về. */
export interface DirectApproverEntry {
  requestKind: string;
  requestId: string;
  assigneeName: string;
}

/** Mã đơn là UUID duy nhất giữa các loại đơn nên tra theo mã đơn là đủ. */
export function directApproverIndex(entries: readonly DirectApproverEntry[] | undefined): Map<string, string> {
  return new Map((entries ?? []).filter((e) => e.requestId && e.assigneeName).map((e) => [e.requestId, e.assigneeName]));
}

/**
 * Gắn tên người duyệt dự kiến vào bản ghi đơn đang chờ: chỉ khi bản ghi chưa có người xử lý (đơn qua quy trình đã có
 * `currentAssigneeName` từ tiến độ thật, không bị ghi đè).
 */
export function withDirectApprover<T extends Record<string, unknown>>(
  raw: T,
  pending: boolean,
  index: ReadonlyMap<string, string>,
): T {
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  const name = pending && !raw['currentAssigneeName'] ? index.get(id) : undefined;
  return name ? { ...raw, currentAssigneeName: name } : raw;
}
