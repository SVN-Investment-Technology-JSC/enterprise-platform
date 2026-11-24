import type { ProcedureLinkSettings } from '@enterprise-platform/contracts-workspace';

/** Phần cài đặt liên kết Quy trình mà nút Tạo / Đổi quy trình cần đọc. */
export type ProcedureGateSettings = Pick<
  ProcedureLinkSettings,
  'startProcedureStatusGate' | 'changeProcedureStatusGate'
> &
  Partial<Pick<ProcedureLinkSettings, 'engineChangeEligibility'>>;

/** Cùng định nghĩa "đã đóng" với server (domain/procedure-link.rules.ts): hoàn thành hoặc huỷ. */
function isClosed(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/**
 * Lý do chưa cho tạo hồ sơ quy trình theo cài đặt trạng thái; `undefined` là cho phép.
 * Chỉ để mờ nút — server vẫn là nơi chặn thật, cùng thông báo.
 */
export function startProcedureGateReason(
  settings: ProcedureGateSettings,
  status: string,
): string | undefined {
  if (settings.startProcedureStatusGate !== 'open_only' || !isClosed(status)) return undefined;
  return 'Công việc đã đóng, không tạo hồ sơ quy trình được; hãy mở lại công việc trước.';
}

/** Như trên, cho thao tác Đổi quy trình (kể cả khi tenant tắt hẳn việc đổi). */
export function changeProcedureGateReason(
  settings: ProcedureGateSettings,
  status: string,
): string | undefined {
  if (settings.engineChangeEligibility === 'never') {
    return 'Cài đặt của tổ chức không cho đổi quy trình của công việc.';
  }
  if (settings.changeProcedureStatusGate !== 'open_only' || !isClosed(status)) return undefined;
  return 'Công việc đã đóng, không đổi quy trình được; hãy mở lại công việc trước.';
}
