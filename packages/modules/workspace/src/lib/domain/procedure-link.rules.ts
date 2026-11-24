import type { ProcedureLinkSettings } from '@enterprise-platform/contracts-workspace';

/** Việc coi là đã đóng khi hoàn thành hoặc huỷ; cổng `open_only` chặn các việc này. */
function isClosedStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/**
 * Nhập tay tiến độ có bị chặn không: chỉ khi tenant đặt `block` và công việc chạy theo quy trình.
 * Trả về thông báo lỗi tiếng Việt, hoặc `null` nếu được phép.
 */
export function manualProgressBlockedMessage(
  settings: Pick<ProcedureLinkSettings, 'manualProgressWhenLinked'>,
  executionType: string | null | undefined,
): string | null {
  if (settings.manualProgressWhenLinked !== 'block' || executionType !== 'procedure') return null;
  return 'Tiến độ của công việc này lấy từ hồ sơ quy trình, không nhập tay được.';
}

/** Việc ở trạng thái này có được tạo hồ sơ quy trình không; trả về thông báo lỗi hoặc `null`. */
export function startProcedureBlockedMessage(
  settings: Pick<ProcedureLinkSettings, 'startProcedureStatusGate'>,
  status: string,
): string | null {
  if (settings.startProcedureStatusGate !== 'open_only' || !isClosedStatus(status)) return null;
  return 'Công việc đã đóng, không tạo hồ sơ quy trình được; hãy mở lại công việc trước.';
}

/** Việc ở trạng thái này có được đổi quy trình không; trả về thông báo lỗi hoặc `null`. */
export function changeProcedureBlockedMessage(
  settings: Pick<ProcedureLinkSettings, 'changeProcedureStatusGate'>,
  status: string,
): string | null {
  if (settings.changeProcedureStatusGate !== 'open_only' || !isClosedStatus(status)) return null;
  return 'Công việc đã đóng, không đổi quy trình được; hãy mở lại công việc trước.';
}
