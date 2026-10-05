import type { HrmRequestKind } from '@enterprise-platform/contracts-hrm';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';

/**
 * FIX-E-07 - Chính sách duyệt đơn ở chế độ DIRECT (ISS-BE-001).
 *
 * Quy tắc (áp cho approve/reject/cancel/reverse do người DUYỆT thực hiện):
 *  1. Không tự duyệt đơn của chính mình (403 SELF_APPROVAL_FORBIDDEN), trừ khi tenant bật ngoại lệ
 *     (hrm_schema.approval_policy_settings.allow_self_approval, mặc định tắt).
 *     Người nộp rút đơn của mình (cancel) là thao tác của chủ đơn, không phải duyệt: được phép.
 *  2. Chỉ duyệt đơn của nhân viên thuộc phạm vi: cấp dưới theo chuỗi "Báo cáo cho" của chức danh hoặc
 *     thuộc cây đơn vị mà mình là trưởng (dữ liệu lấy qua API nội bộ của Platform, không đọc DB module khác).
 *  3. Quyền hrm.<x>.approve.all, hrm.manage hoặc tenant.manage duyệt toàn tenant (vẫn bị quy tắc 1).
 *  4. Đơn đã có liên kết Procedure Engine: 409 PROCEDURE_IN_PROGRESS (trigger DB vẫn là lớp bảo vệ cuối).
 * Ở chế độ PE, người duyệt do PE quyết định; các callback của PE không đi qua chính sách này.
 */

export type HrmApprovalDecision = 'approve' | 'reject' | 'cancel' | 'reverse';

export const SELF_APPROVAL_FORBIDDEN = 'SELF_APPROVAL_FORBIDDEN';
export const APPROVAL_OUT_OF_SCOPE = 'APPROVAL_OUT_OF_SCOPE';
export const PROCEDURE_IN_PROGRESS = 'PROCEDURE_IN_PROGRESS';
export const HRM_ORG_SCOPE = 'HRM_ORG_SCOPE';
export const ORG_CONTEXT_UNAVAILABLE = 'ORG_CONTEXT_UNAVAILABLE';

export const HRM_APPROVE_PERMISSIONS: Readonly<
  Record<HrmRequestKind, { approve: HrmAction; all: HrmAction }>
> = {
  leave: { approve: 'hrm.leave.approve', all: 'hrm.leave.approve.all' },
  ot: { approve: 'hrm.ot.approve', all: 'hrm.ot.approve.all' },
  business_trip: { approve: 'hrm.trip.approve', all: 'hrm.trip.approve.all' },
  shift_change: { approve: 'hrm.shift.approve', all: 'hrm.shift.approve.all' },
  correction: {
    approve: 'hrm.attendance.approve',
    all: 'hrm.attendance.approve.all',
  },
  advance: { approve: 'hrm.advance.approve', all: 'hrm.advance.approve.all' },
  profile_correction: {
    approve: 'hrm.profile.approve',
    all: 'hrm.profile.approve.all',
  },
};

export interface HrmApprovalActor {
  userId: string;
  permissions?: readonly string[];
}

type Queryable = Pick<PoolClient, 'query'>;

/** Cổng lấy cấp dưới của một người từ Platform (Tenant Core). */
export interface HrmOrgScopePort {
  subordinateUserIds(
    tenantId: string,
    actorUserId: string,
  ): Promise<ReadonlySet<string>>;
}

export interface HrmApprovalDeps {
  db: Queryable;
  tenantId: string;
  orgScope: HrmOrgScopePort;
}

/** Người này duyệt toàn tenant cho loại đơn đó (approve.all, hrm.manage, tenant.manage). */
export function hasApproveAll(
  actor: HrmApprovalActor,
  kind: HrmRequestKind,
): boolean {
  const permissions = actor.permissions ?? [];
  return (
    permissions.includes(HRM_APPROVE_PERMISSIONS[kind].all) ||
    permissions.includes('tenant.manage') ||
    permissions.includes('hrm.manage')
  );
}

export async function loadAllowSelfApproval(
  db: Queryable,
  tenantId: string,
): Promise<boolean> {
  const exists = await db.query(
    `SELECT to_regclass('hrm_schema.approval_policy_settings') IS NOT NULL AS ready`,
  );
  if (exists.rows[0]?.ready !== true) return false;
  const row = (
    await db.query(
      `SELECT allow_self_approval FROM hrm_schema.approval_policy_settings WHERE tenant_id=$1`,
      [tenantId],
    )
  ).rows[0];
  return row?.allow_self_approval === true;
}

/**
 * Kiểm tra người `actor` có được xử lý đơn `request.id` loại `kind` hay không; ném lỗi nếu không.
 * `decision` mặc định là 'approve'. 'cancel' do chủ đơn thực hiện được coi là rút đơn.
 */
export async function assertCanDecide(
  actor: HrmApprovalActor,
  request: { id: string; decision?: HrmApprovalDecision },
  kind: HrmRequestKind,
  deps: HrmApprovalDeps,
): Promise<void> {
  const decision = request.decision ?? 'approve';
  const table = HRM_REQUEST_TABLES[kind];
  const found = await deps.db.query(
    `SELECT r.employee_id, e.user_id
       FROM hrm_schema.${table} r
       JOIN core_schema.employees e ON e.tenant_id = r.tenant_id AND e.id = r.employee_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [deps.tenantId, request.id],
  );
  const row = found.rows[0] as
    | { employee_id: string; user_id: string | null }
    | undefined;
  if (!row)
    throw new NotFoundException({
      code: 'HRM_REQUEST_NOT_FOUND',
      message: 'Không tìm thấy đơn',
    });

  const isOwner = !!row.user_id && row.user_id === actor.userId;
  if (isOwner && decision === 'cancel') {
    // Người nộp rút đơn của mình: không phải quyết định duyệt.
  } else if (isOwner) {
    if (!(await loadAllowSelfApproval(deps.db, deps.tenantId)))
      throw new ForbiddenException({
        code: SELF_APPROVAL_FORBIDDEN,
        message: 'Không được tự duyệt đơn của chính mình.',
      });
  } else if (!hasApproveAll(actor, kind)) {
    const subordinates = row.user_id
      ? await deps.orgScope.subordinateUserIds(deps.tenantId, actor.userId)
      : new Set<string>();
    if (!row.user_id || !subordinates.has(row.user_id))
      throw new ForbiddenException({
        code: APPROVAL_OUT_OF_SCOPE,
        message: 'Đơn này không thuộc phạm vi đơn vị bạn được duyệt.',
      });
  }

  // Hủy hiệu lực đơn đã duyệt (reverse) vẫn hợp lệ khi đơn từng đi qua Procedure (trigger DB cũng
  // cho phép); các quyết định khác phải thực hiện tại quy trình đang liên kết.
  if (decision === 'reverse') return;
  const link = await deps.db.query(
    `SELECT 1 FROM hrm_schema.procedure_links
      WHERE tenant_id = $1 AND request_kind = $2 AND request_id = $3 LIMIT 1`,
    [deps.tenantId, kind, request.id],
  );
  if (link.rowCount)
    throw new ConflictException({
      code: PROCEDURE_IN_PROGRESS,
      message:
        'Đơn đang được xử lý qua Procedure Engine: hãy xử lý tại quy trình được liên kết.',
    });
}

/**
 * Chặn người nộp tự xử lý (duyệt/từ chối/trả lại/hoàn thành) đơn của chính mình qua Procedure Engine.
 * Người có quyền ghi đè của PE (vd. quản trị tenant) vẫn qua được kiểm tra của PE, nên HRM phải chặn trước.
 * Rút đơn (cancel) của chủ đơn không bị chặn.
 */
export async function assertNotSelfDecision(
  actor: HrmApprovalActor,
  requestId: string,
  kind: HrmRequestKind,
  action: string,
  deps: Pick<HrmApprovalDeps, 'db' | 'tenantId'>,
): Promise<void> {
  if (action.trim().toUpperCase() === 'CANCEL') return;
  const table = HRM_REQUEST_TABLES[kind];
  const found = await deps.db.query(
    `SELECT e.user_id
       FROM hrm_schema.${table} r
       JOIN core_schema.employees e ON e.tenant_id = r.tenant_id AND e.id = r.employee_id
      WHERE r.tenant_id = $1 AND r.id = $2`,
    [deps.tenantId, requestId],
  );
  const ownerUserId = (found.rows[0] as { user_id: string | null } | undefined)
    ?.user_id;
  if (!ownerUserId || ownerUserId !== actor.userId) return;
  if (await loadAllowSelfApproval(deps.db, deps.tenantId)) return;
  throw new ForbiddenException({
    code: SELF_APPROVAL_FORBIDDEN,
    message: 'Không được tự duyệt đơn của chính mình.',
  });
}

/**
 * Phạm vi để lọc danh sách đơn chờ duyệt ở SQL.
 * `all`: không giới hạn nhân viên; ngược lại chỉ các `userIds` (cấp dưới), luôn loại chính người duyệt
 * khi tenant không cho tự duyệt (loại bỏ do bên gọi dùng `excludeUserId`).
 */
export interface HrmApprovalScope {
  all: boolean;
  userIds: string[];
  excludeUserId: string | null;
}

export async function resolveApprovalScope(
  actor: HrmApprovalActor,
  kind: HrmRequestKind,
  deps: HrmApprovalDeps,
): Promise<HrmApprovalScope> {
  const allowSelf = await loadAllowSelfApproval(deps.db, deps.tenantId);
  const excludeUserId = allowSelf ? null : actor.userId;
  if (hasApproveAll(actor, kind))
    return { all: true, userIds: [], excludeUserId };
  const subordinates = await deps.orgScope.subordinateUserIds(
    deps.tenantId,
    actor.userId,
  );
  return { all: false, userIds: [...subordinates], excludeUserId };
}

/**
 * Điều kiện SQL lọc theo phạm vi, đặt vào mệnh đề WHERE của bảng đơn (alias `alias`).
 * Trả về đoạn SQL (dùng tham số $n bắt đầu từ `firstParam`) và mảng giá trị tham số.
 */
export function approvalScopeSql(
  scope: HrmApprovalScope,
  alias: string,
  firstParam: number,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let next = firstParam;
  if (!scope.all) {
    clauses.push(
      `${alias}.employee_id IN (SELECT ce.id FROM core_schema.employees ce WHERE ce.tenant_id = ${alias}.tenant_id AND ce.user_id = ANY($${next}::uuid[]))`,
    );
    params.push(scope.userIds);
    next += 1;
  }
  if (scope.excludeUserId) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM core_schema.employees se WHERE se.tenant_id = ${alias}.tenant_id AND se.id = ${alias}.employee_id AND se.user_id = $${next}::uuid)`,
    );
    params.push(scope.excludeUserId);
  }
  return { sql: clauses.length ? clauses.join(' AND ') : 'TRUE', params };
}

// ---------------------------------------------------------------------------
// Tính cấp dưới từ ảnh chụp tổ chức của Platform (thuần, có test)
// ---------------------------------------------------------------------------

export interface OrgSnapshotLike {
  units?: {
    id: string;
    parentId?: string | null;
    headMembershipId?: string | null;
    reportsToPositionId?: string | null;
    typeCategory?: string;
  }[];
  positions?: { id: string; reportsToPositionId?: string | null }[];
  members?: {
    userId: string;
    unitId: string;
    positionId?: string;
    reportsToPositionOverrideId?: string | null;
  }[];
}

/**
 * Cấp dưới của `actorUserId` gồm:
 *  - mọi người có chuỗi "Báo cáo cho" đi qua một chức danh mà actor đang giữ;
 *  - mọi thành viên thuộc cây đơn vị (theo parentId) mà actor là trưởng.
 * Không bao gồm chính actor.
 */
export function computeSubordinateUserIds(
  snapshot: OrgSnapshotLike,
  actorUserId: string,
): Set<string> {
  const members = snapshot.members ?? [];
  const units = snapshot.units ?? [];
  const reportsTo = new Map<string, string | null | undefined>();
  for (const node of units) reportsTo.set(node.id, node.reportsToPositionId);
  for (const node of snapshot.positions ?? [])
    reportsTo.set(node.id, node.reportsToPositionId);

  const heldPositions = new Set(
    members
      .filter((m) => m.userId === actorUserId)
      .map((m) => m.positionId ?? m.unitId),
  );
  const result = new Set<string>();

  for (const member of members) {
    if (member.userId === actorUserId) continue;
    const start = member.positionId ?? member.unitId;
    const seen = new Set<string>([start]);
    let cursor = member.reportsToPositionOverrideId ?? reportsTo.get(start);
    let guard = 0;
    while (cursor && !seen.has(cursor) && guard++ < 50) {
      if (heldPositions.has(cursor)) {
        result.add(member.userId);
        break;
      }
      seen.add(cursor);
      cursor = reportsTo.get(cursor);
    }
  }

  const children = new Map<string, string[]>();
  for (const node of units)
    if (node.parentId)
      children.set(node.parentId, [
        ...(children.get(node.parentId) ?? []),
        node.id,
      ]);
  const subtree = new Set<string>();
  const stack = units
    .filter((u) => u.headMembershipId === actorUserId)
    .map((u) => u.id);
  while (stack.length) {
    const id = stack.pop() as string;
    if (subtree.has(id)) continue;
    subtree.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  for (const member of members)
    if (member.userId !== actorUserId && subtree.has(member.unitId))
      result.add(member.userId);

  result.delete(actorUserId);
  return result;
}

/** Gọi API nội bộ Platform (organization-contexts), cùng cơ chế service-token với Procedure. */
export class HttpHrmOrgScopeResolver implements HrmOrgScopePort {
  private readonly cache = new Map<
    string,
    { at: number; snapshot: OrgSnapshotLike }
  >();

  constructor(
    private readonly baseUrl: string = process.env[
      'TENANT_CORE_ORGANIZATION_CONTEXT_URL'
    ] ?? 'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly ttlMs = 15_000,
  ) {}

  async subordinateUserIds(tenantId: string, actorUserId: string) {
    return computeSubordinateUserIds(
      await this.snapshot(tenantId),
      actorUserId,
    );
  }

  private async snapshot(tenantId: string): Promise<OrgSnapshotLike> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.snapshot;
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/${encodeURIComponent(tenantId)}`,
        {
          headers: {
            'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
          },
        },
      );
    } catch {
      throw this.unavailable();
    }
    if (!response.ok) throw this.unavailable();
    const snapshot = (await response.json()) as OrgSnapshotLike;
    this.cache.set(tenantId, { at: Date.now(), snapshot });
    return snapshot;
  }

  private unavailable() {
    return new ServiceUnavailableException({
      code: ORG_CONTEXT_UNAVAILABLE,
      message:
        'Không lấy được sơ đồ tổ chức để xác định phạm vi duyệt. Vui lòng thử lại.',
    });
  }
}

/** Dịch vụ Nest bọc các hàm thuần để controller dùng chung. */
@Injectable()
export class HrmApprovalPolicyService {
  private readonly orgScope: HrmOrgScopePort;

  constructor(@Optional() @Inject(HRM_ORG_SCOPE) orgScope?: HrmOrgScopePort) {
    this.orgScope = orgScope ?? new HttpHrmOrgScopeResolver();
  }

  assertCanDecide(
    ctx: {
      pool: Queryable;
      tenantId: string;
      principal: { userId: string; permissions?: readonly string[] };
    },
    requestId: string,
    kind: HrmRequestKind,
    decision: HrmApprovalDecision = 'approve',
    db: Queryable = ctx.pool,
  ) {
    return assertCanDecide(
      ctx.principal,
      { id: requestId, decision },
      kind,
      { db, tenantId: ctx.tenantId, orgScope: this.orgScope },
    );
  }

  assertNotSelfDecision(
    ctx: {
      pool: Queryable;
      tenantId: string;
      principal: { userId: string; permissions?: readonly string[] };
    },
    requestId: string,
    kind: HrmRequestKind,
    action: string,
  ) {
    return assertNotSelfDecision(ctx.principal, requestId, kind, action, {
      db: ctx.pool,
      tenantId: ctx.tenantId,
    });
  }

  /** Điều kiện SQL cho danh sách duyệt; chỉ áp khi người dùng có quyền duyệt loại đơn đó. */
  async listFilter(
    ctx: {
      pool: Queryable;
      tenantId: string;
      principal: { userId: string; permissions?: readonly string[] };
    },
    kind: HrmRequestKind,
    alias: string,
    firstParam: number,
  ) {
    const permissions = ctx.principal.permissions ?? [];
    const canApprove =
      permissions.includes(HRM_APPROVE_PERMISSIONS[kind].approve) ||
      hasApproveAll(ctx.principal, kind);
    if (!canApprove) return { sql: 'TRUE', params: [] as unknown[] };
    const scope = await resolveApprovalScope(ctx.principal, kind, {
      db: ctx.pool,
      tenantId: ctx.tenantId,
      orgScope: this.orgScope,
    });
    return approvalScopeSql(scope, alias, firstParam);
  }
}
