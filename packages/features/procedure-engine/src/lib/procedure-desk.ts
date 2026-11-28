import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';

/**
 * Vị trí của hồ sơ trong danh sách "Hồ sơ cần bạn xử lý":
 *  - `act`: tới lượt bạn (server cho thao tác khác trao đổi, hoặc bạn còn đầu việc chưa xong);
 *  - `upcoming`: bạn có vai ở pha sau của bước hiện tại, chưa tới lượt;
 *  - `done`: phần của bạn ở bước hiện tại đã xong, bước còn chờ người khác.
 */
export type ProcedureDeskPart = 'act' | 'upcoming' | 'done';

type DeskInstance = Pick<ProcedureInstance, 'status' | 'authorization'>;

/**
 * Hồ sơ có nằm trên bàn của người này không. Rộng hơn "tới lượt": mọi người cùng làm bước hiện tại (vai R, E, C, A,
 * người nhận đầu việc) đều thấy hồ sơ tới khi bước xong (`currentStepPart` do server tính). Chỉ để hiển thị; nút thao
 * tác vẫn theo `availableActions`.
 */
export function procedureDeskPart(instance: DeskInstance): ProcedureDeskPart | undefined {
  if (instance.status !== 'running') return undefined;
  const authorization = instance.authorization;
  if ((authorization?.availableActions ?? []).some((action) => action !== 'comment')) return 'act';
  return authorization?.currentStepPart;
}
