/** Thao tác đủ đơn giản để bấm ngay trên dòng danh sách, không cần mở drawer. */
export type ProcedureQuickAction = 'approve' | 'complete';

export interface ProcedureQuickActionInput {
  readonly availableActions?: readonly string[];
  readonly currentRoleStage?: string | null;
  readonly editableAttributeKeys?: readonly string[];
  /** Vai người này giữ ở bước hiện tại (kể cả vai được ủy quyền). */
  readonly myRoles?: readonly string[];
}

/**
 * Hồ sơ đang tới lượt người này xử lý: server cho thao tác khác "trao đổi" VÀ người này giữ chính vai của pha hiện tại.
 * Quản trị override được phép thao tác mọi hồ sơ đang chạy (`availableActions` luôn có), nhưng nếu không giữ vai của pha
 * thì hồ sơ chưa tới lượt họ, không đưa vào "cần bạn xử lý" để họ không duyệt thay người khác chỉ vì mở Dashboard.
 */
export function procedureNeedsMyAction(input: ProcedureQuickActionInput): boolean {
  const stage = input.currentRoleStage;
  if (!stage || !(input.myRoles ?? []).includes(stage)) return false;
  return (input.availableActions ?? []).some((action) => action !== 'comment');
}

/**
 * Những thao tác nhanh được phép cho một hồ sơ, theo đúng quyền server đã tính (`availableActions`) và pha hiện tại:
 *  - C, A: duyệt; R, E: hoàn thành.
 *  - Từ chối không có thao tác nhanh: đó là trạng thái cuối, cần ý kiến/lý do nên đi qua drawer.
 *  - Bước còn thuộc tính phải nhập (`editableAttributeKeys`) thì không có thao tác nhanh: người xử lý phải mở drawer
 *    để điền thông tin trước khi chốt, nếu không sẽ chốt bước khi chưa có dữ liệu.
 *  - Người không giữ vai của pha hiện tại (quản trị override xử lý thay) không có thao tác nhanh.
 * Các trường hợp khác (bước S nộp lại, bước Tài chính chờ ghi sổ, trả lại, huỷ...) đều đi qua drawer.
 */
export function procedureQuickActions(input: ProcedureQuickActionInput): ProcedureQuickAction[] {
  if (!procedureNeedsMyAction(input)) return [];
  if (input.editableAttributeKeys && input.editableAttributeKeys.length > 0) return [];
  const allowed = new Set(input.availableActions ?? []);
  const wanted: ProcedureQuickAction[] =
    input.currentRoleStage === 'C' || input.currentRoleStage === 'A'
      ? ['approve']
      : input.currentRoleStage === 'R' || input.currentRoleStage === 'E'
        ? ['complete']
        : [];
  return wanted.filter((action) => allowed.has(action));
}
