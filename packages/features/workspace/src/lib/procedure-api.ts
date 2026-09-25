import type { ExternalReference } from '@enterprise-platform/contracts-workspace';
import { authFetch } from '@enterprise-platform/shared-ui';
import { linkWorkItem } from './workspace-api';

/**
 * Gọi sang module Quy trình **từ trình duyệt**, bằng chính phiên người dùng.
 *
 * Server của Workspace không bao giờ ghi sang module khác. Việc mở hồ sơ Quy
 * trình diễn ra ở đây, dưới danh nghĩa người đang bấm — đúng như họ tự vào
 * module đó bấm mở hồ sơ. Cùng tiền lệ với `openMovementWorkOrder` của Kho.
 *
 * Kiểu dữ liệu khai tại chỗ thay vì import `contracts-procedure-engine`: gói
 * `feature-workspace` không được phụ thuộc vào hợp đồng của module khác.
 */

export interface ProcedureOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Một lượt phân vai trong định nghĩa quy trình, rút gọn còn phần cần đối chiếu. */
interface ProcedureAssignment {
  readonly role?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

interface ProcedureDefinitionRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status?: string;
  readonly steps?: readonly { assignments?: readonly ProcedureAssignment[] }[];
}

/** Hồ sơ quy trình, rút gọn còn phần Workspace cần để hiện tiến độ. */
export interface ProcedureInstanceView {
  readonly id: string;
  readonly code: string;
  readonly title?: string;
  readonly status?: string;
  /** Số bước đã xong trên tổng số bước — cơ sở tính tiến độ. */
  readonly doneSteps: number;
  readonly totalSteps: number;
  readonly progressPercent: number;
}

interface ProcedureWorkspacePayload {
  readonly definitions?: readonly ProcedureDefinitionRow[];
  readonly instances?: readonly {
    id: string;
    code: string;
    title?: string;
    status?: string;
    steps?: readonly { status?: string }[];
  }[];
}

/**
 * Hồ sơ đã xong bao nhiêu phần.
 *
 * Module Quy trình **không có trường tiến độ**: hồ sơ chỉ có danh sách bước và
 * trạng thái từng bước. Quy ước ở đây là *số bước đã hoàn thành trên tổng số
 * bước*; hồ sơ đã đóng thì coi như 100% kể cả khi bước cuối bị bỏ qua.
 */
function percentOf(status: string | undefined, steps: readonly { status?: string }[]): number {
  if (status === 'completed') return 100;
  if (steps.length === 0) return 0;
  const done = steps.filter((step) => step.status === 'completed').length;
  return Math.round((done / steps.length) * 100);
}

async function loadWorkspacePayload(): Promise<ProcedureWorkspacePayload | undefined> {
  try {
    const response = await authFetch('/api/procedure/v1/workspace', { cache: 'no-store' });
    if (!response.ok) return undefined;
    return (await response.json()) as ProcedureWorkspacePayload;
  } catch {
    return undefined;
  }
}

/**
 * Quy trình mà **chính người này** khởi tạo được.
 *
 * Module Quy trình chỉ cho khởi tạo khi người bấm được phân **vai S** ở một
 * bước nào đó của quy trình. Lọc sẵn ở đây để người dùng không phải bấm rồi mới
 * nhận 403; luật thật vẫn nằm ở server và vẫn chặn nếu danh sách này rộng hơn
 * thực tế.
 *
 * `orgNodeIds` là id chức danh và các đơn vị cha của người dùng — cùng cây cơ
 * cấu với `subjectId` của phân vai, nên gán theo chức danh hay theo đơn vị đều
 * đối chiếu được.
 */
export async function loadStartableProcedures(
  userId: string,
  orgNodeIds: readonly string[],
): Promise<ProcedureOption[]> {
  const body = await loadWorkspacePayload();
  if (!body) return [];
  const nodes = new Set(orgNodeIds);
  return (body.definitions ?? [])
    .filter((definition) => definition.status === 'published')
    .filter((definition) =>
      (definition.steps ?? []).some((step) =>
        (step.assignments ?? []).some(
          (assignment) =>
            assignment.role === 'S' &&
            (assignment.subjectType === 'user'
              ? assignment.subjectId === userId
              : Boolean(assignment.subjectId && nodes.has(assignment.subjectId))),
        ),
      ),
    )
    .map(({ id, code, name }) => ({ id, code, name }));
}

/** Hồ sơ theo id, để lấy tiến độ về cho công việc đang gắn. */
export async function loadInstance(
  instanceId: string,
): Promise<ProcedureInstanceView | undefined> {
  const body = await loadWorkspacePayload();
  const instance = (body?.instances ?? []).find((item) => item.id === instanceId);
  if (!instance) return undefined;
  const steps = instance.steps ?? [];
  return {
    id: instance.id,
    code: instance.code,
    title: instance.title,
    status: instance.status,
    doneSteps: steps.filter((step) => step.status === 'completed').length,
    totalSteps: steps.length,
    progressPercent: percentOf(instance.status, steps),
  };
}

/** Đường mở hồ sơ ở module Quy trình. Module đó chưa có đường dẫn tới từng hồ sơ. */
export const PROCEDURE_LAUNCH_URL = '/modules/procedure#workspace';

/**
 * Quy trình đã công bố mà người dùng được thấy.
 *
 * Quy trình không đọc được thì trả mảng rỗng — form vẫn dùng được, chỉ là
 * không chọn được "Theo quy trình".
 */
export async function loadProcedureOptions(): Promise<ProcedureOption[]> {
  try {
    const response = await authFetch('/api/procedure/v1/workspace', { cache: 'no-store' });
    if (!response.ok) return [];
    const body = (await response.json()) as {
      definitions?: { id: string; code: string; name: string; status: string }[];
    };
    return (body.definitions ?? [])
      .filter((item) => item.status === 'published')
      .map(({ id, code, name }) => ({ id, code, name }));
  } catch {
    return [];
  }
}

/**
 * Khoá chống trùng cho một công việc.
 *
 * **Suy ra từ id công việc, không sinh ngẫu nhiên.** Quy trình trả lại đúng
 * hồ sơ cũ khi gặp lại một khoá đã dùng, nên bấm Lưu hai lần, hay bấm Thử lại
 * sau khi mạng chập chờn, đều chỉ ra **một** hồ sơ. Khoá ngẫu nhiên mỗi lần
 * bấm thì không chặn được gì.
 */
export function idempotencyKeyFor(workItemId: string): string {
  return `workspace-work-item:${workItemId}`;
}

/** Bước 4: mở hồ sơ bên Quy trình. */
async function openInstance(input: {
  workItemId: string;
  definitionId: string;
  title: string;
}): Promise<{ id: string; code: string; title?: string; status?: string }> {
  const response = await authFetch('/api/procedure/v1/instances', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      definitionId: input.definitionId,
      title: input.title,
      idempotencyKey: idempotencyKeyFor(input.workItemId),
    }),
  });
  if (!response.ok) {
    // Quy trình tự kiểm quyền; người không được mở hồ sơ sẽ nhận 403 từ chính
    // module đó, và thông điệp của họ được chuyển nguyên cho người dùng.
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw { code: 'PROCEDURE_OPEN_FAILED', message: body.message ?? 'Không mở được hồ sơ quy trình.' };
  }
  return (await response.json()) as { id: string; code: string; title?: string; status?: string };
}

/**
 * Bước 4 và 5 của luồng tạo công việc theo quy trình.
 *
 * Công việc (bước 3) đã được tạo trước khi hàm này chạy. Nếu bước 4 hoặc 5
 * hỏng, công việc **vẫn tồn tại** với `executionType = 'procedure'` nhưng chưa
 * có con trỏ — cây hiện badge "Chưa mở được quy trình" và người dùng bấm Thử
 * lại, gọi lại đúng hàm này. Khoá chống trùng bảo đảm lần thử lại không sinh
 * hồ sơ thứ hai.
 */
export async function startProcedureForWorkItem(input: {
  workItemId: string;
  definitionId: string;
  title: string;
}): Promise<ExternalReference> {
  const instance = await openInstance(input);
  return linkWorkItem(input.workItemId, {
    moduleKey: 'procedure-engine',
    externalId: instance.id,
    externalCode: instance.code,
    launchUrl: PROCEDURE_LAUNCH_URL,
    cachedLabel: instance.title ?? input.title,
    cachedStatus: instance.status ?? 'running',
  });
}
