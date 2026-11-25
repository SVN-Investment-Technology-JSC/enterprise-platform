import type { WorkItemProcedureSteps } from '@enterprise-platform/contracts-workspace';
import type { ProcedureStepsReader } from './procedure-steps.port.js';

/**
 * Dựng câu trả lời "các bước hồ sơ" cho một công việc. `instanceId` do Workspace tự suy từ dữ liệu của
 * mình (không bao giờ nhận từ client); người gọi phải kiểm quyền xem công việc trước khi gọi hàm này.
 */
export async function loadProcedureSteps(
  reader: ProcedureStepsReader | undefined,
  tenantId: string,
  instanceId: string | undefined,
): Promise<WorkItemProcedureSteps> {
  if (!instanceId) return { linked: false, available: true, steps: [], events: [] };
  if (!reader) return { linked: true, available: false, instanceId, steps: [], events: [] };
  const snapshot = await reader.read(tenantId, instanceId);
  // Quy trình không còn hồ sơ này (đã xoá): coi như công việc không gắn hồ sơ.
  if (snapshot === undefined) return { linked: false, available: true, steps: [], events: [] };
  if (snapshot === 'unavailable' || snapshot.instanceId !== instanceId) {
    return { linked: true, available: false, instanceId, steps: [], events: [] };
  }
  return { linked: true, available: true, ...snapshot };
}
