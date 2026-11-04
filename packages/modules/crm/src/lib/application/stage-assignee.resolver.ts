import type { ReportingLineReader } from './organization-scope.port.js';
import type { PeopleDirectory } from './sales-store.port.js';
import type { ReportingLineSnapshot } from '../domain/reporting-line.js';

export type StageAssigneeRule = 'NONE' | 'FIXED_USER' | 'PROJECT_OWNER' | 'DIRECT_MANAGER' | 'MANAGER_LEVEL' | 'POSITION';

export type StageAssigneeWarningCode =
  | 'INVALID_RULE'
  | 'INVALID_PARAM'
  | 'FIXED_USER_INACTIVE'
  | 'OWNER_NOT_IN_ORGANIZATION'
  | 'MANAGER_NOT_FOUND'
  | 'POSITION_EMPTY'
  | 'ORGANIZATION_UNAVAILABLE';

export interface StageAssigneeWarning {
  readonly code: StageAssigneeWarningCode;
  readonly message: string;
}

/** `userId` rỗng = chưa gán; `warning` giải thích vì sao (không có cảnh báo khi quy tắc NONE). */
export interface StageAssigneeResult {
  readonly userId: string | null;
  readonly warning?: StageAssigneeWarning;
}

export interface StageAssigneeRequest {
  readonly tenantId: string;
  readonly rule: string;
  readonly param?: string | null;
  readonly ownerUserId: string;
}

/** Chuỗi báo cáo sâu hơn mức này coi như dữ liệu hỏng, cùng giới hạn với `reporting-line`. */
const MAX_CHAIN_DEPTH = 50;
export const MAX_MANAGER_LEVEL = 10;

/**
 * Các bậc quản lý của `userId`, từ gần đến xa. Mỗi bậc là những người đang giữ
 * chức danh cấp trên đầu tiên chưa duyệt qua; chức danh trống người được bỏ qua
 * (không tính là một bậc). Thuần dữ liệu: dùng chung snapshot với phạm vi dữ
 * liệu, snapshot chỉ gồm phân công đang hiệu lực của người đang hoạt động.
 */
export function computeManagerLevels(snapshot: ReportingLineSnapshot, userId: string): string[][] {
  const reportsTo = new Map<string, string | null | undefined>();
  for (const position of snapshot.positions) reportsTo.set(position.id, position.reportsToPositionId);
  const holders = new Map<string, Set<string>>();
  for (const assignment of snapshot.assignments) {
    const set = holders.get(assignment.positionId) ?? new Set<string>();
    set.add(assignment.userId);
    holders.set(assignment.positionId, set);
  }

  const levels: Set<string>[] = [];
  for (const own of snapshot.assignments.filter((assignment) => assignment.userId === userId)) {
    const seen = new Set<string>([own.positionId]);
    let cursor = own.reportsToOverrideId ?? reportsTo.get(own.positionId);
    let depth = 0;
    let level = 0;
    while (cursor && !seen.has(cursor) && depth++ < MAX_CHAIN_DEPTH) {
      seen.add(cursor);
      const found = [...(holders.get(cursor) ?? [])].filter((holder) => holder !== userId);
      if (found.length > 0) {
        levels[level] = levels[level] ?? new Set<string>();
        found.forEach((holder) => levels[level].add(holder));
        level += 1;
      }
      cursor = reportsTo.get(cursor);
    }
  }
  return levels.map((set) => [...set].sort());
}

export interface OrganizationFacts {
  readonly snapshot: ReportingLineSnapshot;
  /** Người đang hoạt động trong tổ chức (Tenant Core chỉ trả người hoạt động). */
  readonly activeUserIds: ReadonlySet<string>;
}

/**
 * Hàm thuần: chọn người đảm nhận từ quy tắc và dữ kiện tổ chức đã đọc.
 * `organization` có thể rỗng với các quy tắc không cần tổ chức.
 */
export function resolveStageAssignee(
  request: Pick<StageAssigneeRequest, 'rule' | 'param' | 'ownerUserId'>,
  organization?: OrganizationFacts,
): StageAssigneeResult {
  const param = request.param?.trim() || undefined;
  switch (request.rule) {
    case 'NONE':
      return { userId: null };
    case 'PROJECT_OWNER':
      return { userId: request.ownerUserId };
    case 'FIXED_USER': {
      if (!param) return warn('INVALID_PARAM', 'Giai đoạn gán cố định nhưng chưa chọn người.');
      if (!organization?.activeUserIds.has(param)) {
        return warn(
          'FIXED_USER_INACTIVE',
          'Người được gán cố định cho giai đoạn không còn hoạt động hoặc không còn trong tổ chức.',
        );
      }
      return { userId: param };
    }
    case 'POSITION': {
      if (!param) return warn('INVALID_PARAM', 'Giai đoạn gán theo chức danh nhưng chưa chọn chức danh.');
      if (!organization) return warn('ORGANIZATION_UNAVAILABLE', unavailableMessage);
      const holders = [
        ...new Set(
          organization.snapshot.assignments
            .filter((assignment) => assignment.positionId === param)
            .map((assignment) => assignment.userId)
            .filter((userId) => organization.activeUserIds.has(userId)),
        ),
      ].sort();
      if (!holders.length) {
        return warn('POSITION_EMPTY', 'Chức danh của giai đoạn hiện chưa có người đảm nhiệm trong sơ đồ tổ chức.');
      }
      return { userId: holders[0] };
    }
    case 'DIRECT_MANAGER':
    case 'MANAGER_LEVEL': {
      let level = 1;
      if (request.rule === 'MANAGER_LEVEL') {
        level = Number(param);
        if (!Number.isInteger(level) || level < 1 || level > MAX_MANAGER_LEVEL) {
          return warn('INVALID_PARAM', `Số bậc cấp trên phải là số nguyên từ 1 đến ${MAX_MANAGER_LEVEL}.`);
        }
      }
      if (!organization) return warn('ORGANIZATION_UNAVAILABLE', unavailableMessage);
      const isMember = organization.snapshot.assignments.some((a) => a.userId === request.ownerUserId);
      if (!isMember) {
        return warn('OWNER_NOT_IN_ORGANIZATION', 'Chủ dự án chưa được bổ nhiệm vào chức danh nào trong sơ đồ tổ chức.');
      }
      const picked = computeManagerLevels(organization.snapshot, request.ownerUserId)[level - 1];
      if (!picked?.length) {
        return warn(
          'MANAGER_NOT_FOUND',
          level === 1
            ? 'Chủ dự án không có quản lý trực tiếp trong sơ đồ tổ chức.'
            : `Chủ dự án không có cấp trên ${level} bậc trong sơ đồ tổ chức.`,
        );
      }
      return { userId: picked[0] };
    }
    default:
      return warn('INVALID_RULE', 'Quy tắc gán người của giai đoạn không hợp lệ.');
  }
}

const unavailableMessage =
  'Không đọc được sơ đồ tổ chức từ Tenant Core nên chưa xác định được người đảm nhận; giai đoạn để trống.';

function warn(code: StageAssigneeWarningCode, message: string): StageAssigneeResult {
  return { userId: null, warning: { code, message } };
}

/**
 * Đọc cơ cấu tổ chức (qua `HttpOrganizationScope`, cache 60 giây) rồi áp quy
 * tắc. Không bao giờ ném lỗi vì tổ chức: Tenant Core lỗi (và chưa có bản cache)
 * thì trả trống kèm cảnh báo, tuyệt không đoán người.
 */
export class StageAssigneeResolver {
  constructor(private readonly organization: ReportingLineReader & PeopleDirectory) {}

  async resolve(request: StageAssigneeRequest): Promise<StageAssigneeResult> {
    if (request.rule === 'NONE' || request.rule === 'PROJECT_OWNER') return resolveStageAssignee(request);
    if (!['FIXED_USER', 'DIRECT_MANAGER', 'MANAGER_LEVEL', 'POSITION'].includes(request.rule)) {
      return resolveStageAssignee(request);
    }
    try {
      // Tuần tự (không Promise.all): lần đọc thứ hai dùng cache của lần đầu, chỉ một request tới Tenant Core.
      const snapshot = await this.organization.snapshot(request.tenantId);
      const people = await this.organization.people(request.tenantId);
      return resolveStageAssignee(request, {
        snapshot,
        activeUserIds: new Set(people.map((person) => person.userId)),
      });
    } catch {
      return warn('ORGANIZATION_UNAVAILABLE', unavailableMessage);
    }
  }
}
