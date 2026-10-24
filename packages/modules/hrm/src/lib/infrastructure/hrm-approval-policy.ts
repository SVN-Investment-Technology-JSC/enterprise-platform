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
import { fetchActionableProcedureInstanceIds, fetchParticipatingProcedureInstanceIds } from './hrm-procedure-api.js';
import { HRM_REQUEST_TABLES } from './hrm-procedure-links.js';
import { fallbackMayAct, loadRequestTimeRule } from './hrm-request-time-rules.js';
import {
  chiefFallbackUserIds,
  loadOrgFacts,
  managerUserIdsOf,
} from './hrm-chief-fallback.js';

/**
 * FIX-E-07 - Chính sách duyệt đơn ở chế độ DIRECT (ISS-BE-001).
 *
 * Quy tắc (áp cho approve/reject/cancel/reverse do người DUYỆT thực hiện):
 *  1. Không tự duyệt đơn của chính mình (403 SELF_APPROVAL_FORBIDDEN), trừ khi tenant bật ngoại lệ
 *     (hrm_schema.approval_policy_settings.allow_self_approval, mặc định tắt).
 *     Người nộp rút đơn của mình (cancel) là thao tác của chủ đơn, không phải duyệt: được phép.
 *  2. Chỉ duyệt đơn của nhân viên thuộc phạm vi: cấp dưới theo chuỗi "Báo cáo cho" của chức danh
 *     (dữ liệu lấy qua API nội bộ của Platform, không đọc DB module khác).
 *     Đơn ở chế độ DIRECT có hai nguồn người duyệt:
 *      - DIRECT_MANAGER (mặc định): Quản lý trực tiếp (và cấp trên theo sơ đồ tổ chức) HOẶC người giữ chức danh dự phòng.
 *      - POSITION: CHỈ người giữ chức danh được chỉ định (hoặc người giữ chức danh dự phòng) được duyệt;
 *        quản lý trực tiếp và cấp trên theo sơ đồ tổ chức KHÔNG có thẩm quyền duyệt.
 *     Nếu nhân viên chưa có quản lý trực tiếp, người giữ chức danh dự phòng (nếu có cấu hình)
 *     hoặc người có quyền duyệt toàn bộ (hrm.request.approve.all, hrm.manage, tenant.manage) xử lý.
 *  3. Quyền hrm.request.approve.all, hrm.manage hoặc tenant.manage duyệt toàn tenant (vẫn bị quy tắc 1).
 *  4. Đơn đã có liên kết Procedure Engine: 409 PROCEDURE_IN_PROGRESS (trigger DB vẫn là lớp bảo vệ cuối).
 * Ở chế độ PE, người duyệt do PE quyết định; các callback của PE không đi qua chính sách này.
 */

export type HrmApprovalDecision = 'approve' | 'reject' | 'cancel' | 'reverse';

export const SELF_APPROVAL_FORBIDDEN = 'SELF_APPROVAL_FORBIDDEN';
export const APPROVAL_OUT_OF_SCOPE = 'APPROVAL_OUT_OF_SCOPE';
export const PROCEDURE_IN_PROGRESS = 'PROCEDURE_IN_PROGRESS';
export const HRM_ORG_SCOPE = 'HRM_ORG_SCOPE';
export const ORG_CONTEXT_UNAVAILABLE = 'ORG_CONTEXT_UNAVAILABLE';

/** Một quyền duyệt chung cho mọi loại đơn: `approve` (trong phạm vi) và `all` (toàn tenant). */
const APPROVE_KEYS: { approve: HrmAction; all: HrmAction } = {
  approve: 'hrm.request.approve',
  all: 'hrm.request.approve.all',
};

export const HRM_APPROVE_PERMISSIONS: Readonly<
  Record<HrmRequestKind, { approve: HrmAction; all: HrmAction }>
> = {
  leave: APPROVE_KEYS,
  ot: APPROVE_KEYS,
  business_trip: APPROVE_KEYS,
  shift_change: APPROVE_KEYS,
  correction: APPROVE_KEYS,
  advance: APPROVE_KEYS,
  profile_correction: APPROVE_KEYS,
  custom: APPROVE_KEYS,
};

/** Các quyền cho phép xử lý đơn (duyệt trong phạm vi hoặc duyệt toàn tenant); dùng chung mọi loại đơn. */
export function approverPermissions(kind: HrmRequestKind): HrmAction[] {
  return [HRM_APPROVE_PERMISSIONS[kind].approve, HRM_APPROVE_PERMISSIONS[kind].all];
}

export interface HrmApprovalActor {
  userId: string;
  permissions?: readonly string[];
}

export type Queryable = Pick<PoolClient, 'query'>;

/** Cổng lấy cấp dưới của một người từ Platform (Tenant Core). */
export interface HrmOrgScopePort {
  subordinateUserIds(
    tenantId: string,
    actorUserId: string,
  ): Promise<ReadonlySet<string>>;
  /** Sơ đồ tổ chức (đơn vị, chức danh, thành viên); dùng cho phạm vi tạo đơn hộ theo đơn vị. */
  orgSnapshot?(tenantId: string): Promise<OrgSnapshotLike>;
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

/** Có quyền duyệt loại đơn này (trong phạm vi hoặc toàn tenant). */
export function hasApprovePermission(
  actor: HrmApprovalActor,
  kind: HrmRequestKind,
): boolean {
  return (
    hasApproveAll(actor, kind) ||
    (actor.permissions ?? []).includes(HRM_APPROVE_PERMISSIONS[kind].approve)
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
    const binding = await resolveDirectBinding(deps.db, deps.tenantId, kind, request.id);
    let inScope = false;
    if (binding?.source === 'POSITION') {
      // Khi cấu hình nguồn duyệt trực tiếp là POSITION: CHỈ người giữ chức danh được chỉ định (hoặc chức danh dự phòng)
      // được duyệt. Quản lý trực tiếp và cấp trên theo sơ đồ tổ chức KHÔNG được duyệt.
      inScope = await isDesignatedDirectApprover(
        deps.db,
        deps.tenantId,
        kind,
        request.id,
        row.employee_id,
        actor.userId,
      );
    } else {
      const subordinates = row.user_id
        ? await deps.orgScope.subordinateUserIds(deps.tenantId, actor.userId)
        : new Set<string>();
      inScope =
        !!row.user_id &&
        (subordinates.has(row.user_id) ||
          (await chiefFallbackUserIds(deps.db, deps.tenantId, actor.userId)).has(row.user_id));
      // Người duyệt được cấu hình của đơn DIRECT (quản lý trực tiếp, chức danh chỉ định, chức danh dự phòng).
      if (!inScope)
        inScope = await isDesignatedDirectApprover(
          deps.db,
          deps.tenantId,
          kind,
          request.id,
          row.employee_id,
          actor.userId,
        );
    }
    if (!inScope)
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

export const PROXY_CREATOR_DECISION_FORBIDDEN = 'HRM_PROXY_CREATOR_DECISION_FORBIDDEN';

/**
 * Người tạo hộ không được duyệt, từ chối hay huỷ hiệu lực đơn do chính mình tạo hộ (nghỉ phép, tăng ca, công tác),
 * kể cả khi tenant cho phép tự duyệt. Rút đơn (cancel) không bị chặn.
 */
export async function assertNotProxyCreatorDecision(
  actor: HrmApprovalActor,
  requestId: string,
  kind: HrmRequestKind,
  action: string,
  deps: Pick<HrmApprovalDeps, 'db' | 'tenantId'>,
): Promise<void> {
  if (kind !== 'leave' && kind !== 'ot' && kind !== 'business_trip') return;
  if (action.trim().toUpperCase() === 'CANCEL') return;
  // Cơ sở dữ liệu chưa chạy migration tạo hộ (0069) thì chưa có đơn nào tạo hộ để chặn.
  const ready = await deps.db.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'hrm_schema' AND table_name = $1 AND column_name = 'created_on_behalf'
     ) AS ready`,
    [HRM_REQUEST_TABLES[kind]],
  );
  if (ready.rows[0]?.ready !== true) return;
  const found = await deps.db.query(
    `SELECT submitted_by, created_on_behalf FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} WHERE tenant_id = $1 AND id = $2`,
    [deps.tenantId, requestId],
  );
  const row = found.rows[0] as { submitted_by: string | null; created_on_behalf: boolean } | undefined;
  if (row?.created_on_behalf && row.submitted_by === actor.userId)
    throw new ForbiddenException({
      code: PROXY_CREATOR_DECISION_FORBIDDEN,
      message: 'Không được duyệt đơn do chính bạn tạo hộ nhân viên.',
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
  /**
   * Đơn đang chạy qua Procedure Engine mà PE giao cho người dùng này xử lý (quản lý trực tiếp hoặc người dự phòng).
   * Hiện thêm vào danh sách duyệt dù nhân viên nộp đơn không thuộc cấp dưới của người này.
   */
  requestIds?: string[];
  /**
   * Mã các đơn duyệt trực tiếp theo nguồn POSITION mà người dùng này KHÔNG giữ chức danh chỉ định (hoặc dự phòng).
   * Cần loại trừ khỏi phạm vi cấp dưới (userIds) để cấp trên không thấy đơn chờ duyệt của các đơn này.
   */
  excludeRequestIds?: string[];
}

/** Số đơn PE đang chạy tối đa hỏi PE mỗi lần dựng danh sách (chia lô 100). */
const MAX_PROCEDURE_CANDIDATES = 500;

/**
 * Mã các đơn loại `kind` đang chạy qua Procedure Engine mà PE giao cho `userId` xử lý. Chỉ xét đơn có liên kết đang
 * RUNNING (bản liên kết mới nhất). Procedure không trả lời thì bỏ qua (danh sách vẫn hiện phần còn lại).
 */
export async function procedureActionableRequestIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  userId: string,
): Promise<string[]> {
  const candidates = (
    await db.query(
      `SELECT request_id, instance_id FROM (
         SELECT DISTINCT ON (request_id) request_id, instance_id, sync_status
           FROM hrm_schema.procedure_links
          WHERE tenant_id = $1 AND request_kind = $2 AND instance_id IS NOT NULL
          ORDER BY request_id, revision DESC) latest
        WHERE sync_status = 'RUNNING'
        LIMIT ${MAX_PROCEDURE_CANDIDATES}`,
      [tenantId, kind],
    )
  ).rows as { request_id: string; instance_id: string }[];
  if (!candidates.length) return [];
  const requestOf = new Map(candidates.map((row) => [row.instance_id, row.request_id]));
  const instanceIds = [...requestOf.keys()];
  const actionable: string[] = [];
  try {
    for (let index = 0; index < instanceIds.length; index += 100) {
      const ids = await fetchActionableProcedureInstanceIds(tenantId, userId, instanceIds.slice(index, index + 100));
      for (const id of ids) {
        const requestId = requestOf.get(id);
        if (requestId) actionable.push(requestId);
      }
    }
  } catch {
    // Procedure không phục vụ được: chỉ thiếu phần đơn PE giao riêng, không làm hỏng cả danh sách duyệt.
  }
  return actionable;
}

/**
 * Người dùng có tham gia quy trình của đúng đơn này (người khởi tạo, người được giao ở bất kỳ bước nào kể cả bước đã
 * qua hoặc chưa tới, người được uỷ quyền) hay không. Khác `procedureActionableRequestIds`: không đòi hỏi đang tới lượt xử lý.
 * Procedure không trả lời thì coi như không tham gia.
 */
export async function participatesInProcedureOfRequest(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const link = (
    await db.query(
      `SELECT instance_id FROM hrm_schema.procedure_links
        WHERE tenant_id = $1 AND request_kind = $2 AND request_id = $3 AND instance_id IS NOT NULL
        ORDER BY revision DESC LIMIT 1`,
      [tenantId, kind, requestId],
    )
  ).rows[0] as { instance_id: string } | undefined;
  if (!link) return false;
  try {
    return (await fetchParticipatingProcedureInstanceIds(tenantId, userId, [link.instance_id])).includes(link.instance_id);
  } catch {
    return false;
  }
}

/**
 * Kiểm tra xem người dùng có đang giữ chức danh cụ thể hay không (theo bổ nhiệm hiện tại).
 */
export async function actorHoldsPosition(
  db: Queryable,
  userId: string,
  positionId: string,
): Promise<boolean> {
  const res = await db.query(
    `SELECT 1
       FROM core_schema.organization_node_assignments a
      WHERE a.user_id = $1
        AND a.node_id = $2
        AND a.deleted_at IS NULL
        AND (a.status IS NULL OR a.status = 'active')
        AND (a.start_date IS NULL OR a.start_date <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        AND (a.end_date IS NULL OR a.end_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
      LIMIT 1`,
    [userId, positionId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Cấu hình duyệt trực tiếp áp dụng cho một đơn (hoặc một lý do). */
export interface DirectBinding {
  /** DIRECT_MANAGER: quản lý trực tiếp; POSITION: người giữ `approverPositionId`. */
  source: 'DIRECT_MANAGER' | 'POSITION';
  approverPositionId: string | null;
  fallbackPositionId: string | null;
}

interface BindingRow {
  sub_type_code: string | null;
  mode: string;
  fallback_position_id: string | null;
  direct_approver_source: string | null;
  approver_position_id: string | null;
}

/** Chưa có cấu hình nào thì đơn đi DIRECT, người duyệt là quản lý trực tiếp, không có dự phòng. */
const DEFAULT_DIRECT_BINDING: DirectBinding = {
  source: 'DIRECT_MANAGER',
  approverPositionId: null,
  fallbackPositionId: null,
};

/**
 * Cấu hình áp dụng cho mã lý do `subTypeCode`: cấu hình riêng theo mã nếu có, không thì cấu hình chung của loại đơn.
 * Trả null khi cấu hình đó là PROCEDURE (đơn không duyệt trực tiếp); không có cấu hình nào thì là DIRECT mặc định.
 */
export function directBindingOf(
  rows: readonly BindingRow[],
  subTypeCode: string | null,
): DirectBinding | null {
  const specific = subTypeCode ? rows.find((b) => b.sub_type_code === subTypeCode) : undefined;
  const effective = specific ?? rows.find((b) => b.sub_type_code === null);
  if (!effective) return DEFAULT_DIRECT_BINDING;
  if (effective.mode !== 'DIRECT') return null;
  const position = effective.direct_approver_source === 'POSITION' ? effective.approver_position_id : null;
  return {
    source: position ? 'POSITION' : 'DIRECT_MANAGER',
    approverPositionId: position,
    fallbackPositionId: effective.fallback_position_id,
  };
}

async function loadBindingRows(db: Queryable, tenantId: string, kind: HrmRequestKind): Promise<BindingRow[]> {
  return (
    await db.query(
      `SELECT sub_type_code, mode, fallback_position_id, direct_approver_source, approver_position_id
         FROM hrm_schema.request_procedure_bindings
        WHERE tenant_id = $1 AND request_kind = $2 AND is_active`,
      [tenantId, kind],
    )
  ).rows as BindingRow[];
}

/** Mã lý do (sub_type_code của cấu hình) của một đơn: loại nghỉ, loại đơn tuỳ chỉnh hoặc lý do danh mục. */
async function requestSubTypeCode(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
): Promise<string | null> {
  const table = HRM_REQUEST_TABLES[kind];
  if (kind === 'leave') {
    const row = (
      await db.query(
        `SELECT lt.code
           FROM hrm_schema.leave_requests r
           LEFT JOIN hrm_schema.leave_types lt ON lt.tenant_id = r.tenant_id AND lt.id = r.leave_type_id
          WHERE r.tenant_id = $1 AND r.id = $2`,
        [tenantId, requestId],
      )
    ).rows[0];
    return row?.code ?? null;
  }
  if (kind === 'custom') {
    const row = (
      await db.query(`SELECT type_code FROM hrm_schema.custom_requests WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        requestId,
      ])
    ).rows[0];
    return row?.type_code ?? null;
  }
  if (['ot', 'business_trip', 'correction', 'shift_change'].includes(kind)) {
    const row = (
      await db.query(
        `SELECT rr.code
           FROM hrm_schema.${table} r
           LEFT JOIN hrm_schema.request_reasons rr ON rr.tenant_id = r.tenant_id AND rr.id = r.reason_id
          WHERE r.tenant_id = $1 AND r.id = $2`,
        [tenantId, requestId],
      )
    ).rows[0];
    return row?.code ?? null;
  }
  return null;
}

/** Cấu hình duyệt trực tiếp của một đơn cụ thể; null nếu đơn đi theo quy trình (PROCEDURE). */
export async function resolveDirectBinding(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
): Promise<DirectBinding | null> {
  const subTypeCode = await requestSubTypeCode(db, tenantId, kind, requestId);
  return directBindingOf(await loadBindingRows(db, tenantId, kind), subTypeCode);
}

/** Người giữ chức danh dự phòng đã được xử lý đơn này chưa (xem `fallbackMayAct`). */
async function fallbackOpen(db: Queryable, tenantId: string, kind: HrmRequestKind, requestId: string): Promise<boolean> {
  const rule = await loadRequestTimeRule(db, tenantId, kind);
  if (rule.escalateAfterDays === null) return true;
  const created = await db.query(
    `SELECT created_at FROM hrm_schema.${HRM_REQUEST_TABLES[kind]} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, requestId],
  );
  return fallbackMayAct(rule, created.rows[0]?.created_at);
}

/** Chức danh duyệt dự phòng được cấu hình cho một đơn DIRECT (nếu có). */
export async function resolveDirectFallbackPosition(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
): Promise<string | null> {
  return (await resolveDirectBinding(db, tenantId, kind, requestId))?.fallbackPositionId ?? null;
}

/** Chức danh người dùng đang giữ (theo bổ nhiệm hiện tại). */
async function heldPositionIds(db: Queryable, userId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT a.node_id
       FROM core_schema.organization_node_assignments a
      WHERE a.user_id = $1
        AND a.deleted_at IS NULL
        AND (a.status IS NULL OR a.status = 'active')
        AND (a.start_date IS NULL OR a.start_date <= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        AND (a.end_date IS NULL OR a.end_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)`,
    [userId],
  );
  return res.rows.map((r: { node_id: string }) => r.node_id);
}

/**
 * Người này là người duyệt được cấu hình của đơn DIRECT: quản lý trực tiếp của người làm đơn (nguồn DIRECT_MANAGER),
 * người giữ chức danh được chỉ định (nguồn POSITION), hoặc người giữ chức danh dự phòng. Không đòi quyền duyệt của HRM.
 */
export async function isDesignatedDirectApprover(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  requestId: string,
  employeeId: string,
  userId: string,
): Promise<boolean> {
  const binding = await resolveDirectBinding(db, tenantId, kind, requestId);
  if (!binding) return false;
  if (binding.source === 'DIRECT_MANAGER') {
    const facts = await loadOrgFacts(db, tenantId);
    if (managerUserIdsOf(facts, employeeId).includes(userId)) return true;
  }
  const positions = [binding.source === 'POSITION' ? binding.approverPositionId : null];
  // Người dự phòng chỉ được xử lý khi đơn chờ đủ số ngày chuyển dự phòng (nếu tenant có đặt).
  if (await fallbackOpen(db, tenantId, kind, requestId)) positions.push(binding.fallbackPositionId);
  for (const positionId of positions)
    if (positionId && (await actorHoldsPosition(db, userId, positionId))) return true;
  return false;
}

/**
 * Mã các đơn loại `kind` đang chờ duyệt trực tiếp mà `userId` là người duyệt được cấu hình: quản lý trực tiếp của
 * người làm đơn, người giữ chức danh được chỉ định, hoặc người giữ chức danh duyệt dự phòng.
 * Đồng thời trả về `positionExcluded`: các đơn có nguồn POSITION mà `userId` KHÔNG giữ chức danh chỉ định/dự phòng
 * (cần loại trừ khỏi phạm vi cấp dưới để cấp trên không thấy đơn chờ duyệt).
 */
export async function directApproverScopes(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  userId: string,
): Promise<{ assigned: string[]; positionExcluded: string[] }> {
  const positionIds = await heldPositionIds(db, userId);
  const rows = await loadBindingRows(db, tenantId, kind);
  const table = HRM_REQUEST_TABLES[kind];
  let candidateSql: string;
  if (kind === 'leave') {
    candidateSql = `SELECT r.id, r.employee_id, r.created_at, lt.code AS sub_type_code
                      FROM hrm_schema.leave_requests r
                      LEFT JOIN hrm_schema.leave_types lt ON lt.tenant_id = r.tenant_id AND lt.id = r.leave_type_id`;
  } else if (kind === 'custom') {
    candidateSql = `SELECT r.id, r.employee_id, r.created_at, r.type_code AS sub_type_code FROM hrm_schema.custom_requests r`;
  } else if (['ot', 'business_trip', 'correction', 'shift_change'].includes(kind)) {
    candidateSql = `SELECT r.id, r.employee_id, r.created_at, rr.code AS sub_type_code
                      FROM hrm_schema.${table} r
                      LEFT JOIN hrm_schema.request_reasons rr ON rr.tenant_id = r.tenant_id AND rr.id = r.reason_id`;
  } else {
    candidateSql = `SELECT r.id, r.employee_id, r.created_at, NULL::text AS sub_type_code FROM hrm_schema.${table} r`;
  }
  const candidates = (
    await db.query(
      `${candidateSql}
        WHERE r.tenant_id = $1 AND r.status IN ('PENDING', 'PEER_CONFIRMED')
          AND NOT EXISTS (
            SELECT 1 FROM hrm_schema.procedure_links pl
             WHERE pl.tenant_id = r.tenant_id AND pl.request_kind = $2 AND pl.request_id = r.id AND pl.sync_status = 'RUNNING'
          )
        LIMIT 500`,
      [tenantId, kind],
    )
  ).rows as { id: string; employee_id: string; created_at: Date | string | null; sub_type_code: string | null }[];
  if (!candidates.length) return { assigned: [], positionExcluded: [] };
  const timeRule = await loadRequestTimeRule(db, tenantId, kind);

  let managed: ReadonlySet<string> | null = null;
  const managedEmployees = async (): Promise<ReadonlySet<string>> => {
    if (managed) return managed;
    const facts = await loadOrgFacts(db, tenantId);
    managed = new Set(
      facts.employees
        .filter((e) => !e.inactive && managerUserIdsOf(facts, e.employeeId).includes(userId))
        .map((e) => e.employeeId),
    );
    return managed;
  };
  const assigned: string[] = [];
  const positionExcluded: string[] = [];
  for (const row of candidates) {
    // Cùng quy tắc chọn cấu hình với lúc gửi đơn: riêng theo mã lý do, không thì cấu hình chung.
    const binding = directBindingOf(rows, row.sub_type_code);
    if (!binding) continue;
    if (binding.source === 'POSITION') {
      const holds =
        positionIds.length > 0 &&
        ((!!binding.approverPositionId && positionIds.includes(binding.approverPositionId)) ||
          (!!binding.fallbackPositionId &&
            positionIds.includes(binding.fallbackPositionId) &&
            fallbackMayAct(timeRule, row.created_at)));
      if (holds) {
        assigned.push(row.id);
      } else {
        positionExcluded.push(row.id);
      }
    } else if (binding.source === 'DIRECT_MANAGER') {
      const isDirect = positionIds.length > 0 && (await managedEmployees()).has(row.employee_id);
      const isFallback =
        positionIds.length > 0 &&
        !!binding.fallbackPositionId &&
        positionIds.includes(binding.fallbackPositionId) &&
        fallbackMayAct(timeRule, row.created_at);
      if (isDirect || isFallback) assigned.push(row.id);
    }
  }
  return { assigned, positionExcluded };
}

export async function directAssignedRequestIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  userId: string,
): Promise<string[]> {
  return (await directApproverScopes(db, tenantId, kind, userId)).assigned;
}

/** Tên cũ của `directAssignedRequestIds` (trước đây chỉ tính người giữ chức danh dự phòng). */
export const directFallbackActionableRequestIds = directAssignedRequestIds;

/**
 * Mã đơn loại `kind` được giao riêng cho người này: Procedure giao bước hiện tại (quản lý trực tiếp, người dự phòng...)
 * hoặc người này giữ chức danh duyệt dự phòng của đơn duyệt trực tiếp. Không đòi quyền duyệt của HRM.
 */
export async function assignedRequestIds(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  userId: string,
): Promise<string[]> {
  const [procedure, direct] = await Promise.all([
    procedureActionableRequestIds(db, tenantId, kind, userId),
    directAssignedRequestIds(db, tenantId, kind, userId),
  ]);
  return [...new Set([...procedure, ...direct])];
}

const ALL_REQUEST_KINDS = Object.keys(HRM_APPROVE_PERMISSIONS) as HrmRequestKind[];

/** Các loại đơn mà người này CHƯA có quyền duyệt HRM nhưng đang được giao xử lý (người dự phòng, người được PE chọn). */
export async function assignedKindsWithoutPermission(
  db: Queryable,
  tenantId: string,
  actor: HrmApprovalActor,
): Promise<HrmRequestKind[]> {
  const kinds = ALL_REQUEST_KINDS.filter((kind) => !hasApprovePermission(actor, kind));
  const found = await Promise.all(
    kinds.map(async (kind) => {
      try {
        return (await assignedRequestIds(db, tenantId, kind, actor.userId)).length > 0 ? kind : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((kind): kind is HrmRequestKind => kind !== null);
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
  // Không có quyền duyệt HRM: chỉ thấy đơn được giao riêng (PE hoặc chức danh dự phòng), không thấy đơn của cấp dưới.
  if (actor.permissions && !hasApprovePermission(actor, kind))
    return {
      all: false,
      userIds: [],
      excludeUserId,
      requestIds: await assignedRequestIds(deps.db, deps.tenantId, kind, actor.userId),
    };
  const subordinates = await deps.orgScope.subordinateUserIds(
    deps.tenantId,
    actor.userId,
  );
  const unassigned = await chiefFallbackUserIds(deps.db, deps.tenantId, actor.userId);
  // Đơn qua Procedure mà PE giao cho người này (quản lý trực tiếp hoặc người dự phòng) dù không thuộc cấp dưới.
  const procedureRequestIds = await procedureActionableRequestIds(deps.db, deps.tenantId, kind, actor.userId);
  // Đơn duyệt trực tiếp mà người này được giao (theo chức danh hoặc quản lý trực tiếp) & đơn POSITION bị loại trừ khỏi cấp dưới.
  const { assigned: directAssigned, positionExcluded } = await directApproverScopes(deps.db, deps.tenantId, kind, actor.userId);
  const requestIds = [...new Set([...procedureRequestIds, ...directAssigned])];
  return {
    all: false,
    userIds: [...new Set([...subordinates, ...unassigned])],
    excludeUserId,
    requestIds,
    excludeRequestIds: positionExcluded.length > 0 ? positionExcluded : undefined,
  };
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
    let inScope = `${alias}.employee_id IN (SELECT ce.id FROM core_schema.employees ce WHERE ce.tenant_id = ${alias}.tenant_id AND ce.user_id = ANY($${next}::uuid[]))`;
    params.push(scope.userIds);
    next += 1;
    if (scope.excludeRequestIds?.length) {
      inScope = `(${inScope} AND NOT (${alias}.id = ANY($${next}::uuid[])))`;
      params.push(scope.excludeRequestIds);
      next += 1;
    }
    if (scope.requestIds?.length) {
      clauses.push(`(${inScope} OR ${alias}.id = ANY($${next}::uuid[]))`);
      params.push(scope.requestIds);
      next += 1;
    } else {
      clauses.push(inScope);
    }
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
 * Cấp dưới của `actorUserId`: mọi người có chuỗi "Báo cáo cho" đi qua một chức danh mà actor đang giữ.
 * Trưởng đơn vị không được tính. Không bao gồm chính actor.
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

  result.delete(actorUserId);
  return result;
}

export const NO_REPORTING_LINE_MESSAGE =
  'Chưa khai báo "Báo cáo cho" nên không có đơn nào trong phạm vi của bạn. ' +
  'Hãy khai báo "Báo cáo cho" của chức danh trong Cấu trúc tổ chức.';

export interface HrmApprovalScopeStatus {
  /** Người dùng có ít nhất một quyền duyệt đơn. */
  canApprove: boolean;
  /** Duyệt toàn tenant (approve.all / hrm.manage / tenant.manage) cho ít nhất một loại đơn. */
  approveAll: boolean;
  directReportCount: number;
  /** Có quyền duyệt nhưng không có cấp dưới nào và không duyệt toàn tenant: danh sách trống do thiếu cấu hình. */
  noReportingLine: boolean;
  message: string | null;
}

/** Người này đang giữ chức danh được chọn làm người duyệt (chỉ định hoặc dự phòng) ở một cấu hình duyệt đang bật. */
export async function holdsConfiguredApproverPosition(db: Queryable, tenantId: string, userId: string): Promise<boolean> {
  const positionIds = await heldPositionIds(db, userId);
  if (!positionIds.length) return false;
  const res = await db.query(
    `SELECT 1 FROM hrm_schema.request_procedure_bindings
      WHERE tenant_id = $1 AND is_active AND mode = 'DIRECT'
        AND (approver_position_id = ANY($2::uuid[]) OR fallback_position_id = ANY($2::uuid[]))
      LIMIT 1`,
    [tenantId, positionIds],
  );
  return (res.rows?.length ?? 0) > 0;
}

/** Thuần: mô tả phạm vi duyệt để màn hình giải thích vì sao danh sách có thể trống. */
export function describeApprovalScope(
  permissions: readonly string[],
  subordinateCount: number,
): HrmApprovalScopeStatus {
  const kinds = Object.keys(HRM_APPROVE_PERMISSIONS) as HrmRequestKind[];
  const actor = { userId: '', permissions };
  const approveAll = kinds.some((k) => hasApproveAll(actor, k));
  const canApprove =
    approveAll ||
    kinds.some((k) => permissions.includes(HRM_APPROVE_PERMISSIONS[k].approve));
  const noReportingLine = canApprove && !approveAll && subordinateCount === 0;
  return {
    canApprove,
    approveAll,
    directReportCount: subordinateCount,
    noReportingLine,
    message: noReportingLine ? NO_REPORTING_LINE_MESSAGE : null,
  };
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

  orgSnapshot(tenantId: string): Promise<OrgSnapshotLike> {
    return this.snapshot(tenantId);
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
    ).then(() =>
      assertNotProxyCreatorDecision(ctx.principal, requestId, kind, decision, {
        db,
        tenantId: ctx.tenantId,
      }),
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
    }).then(() =>
      assertNotProxyCreatorDecision(ctx.principal, requestId, kind, action, {
        db: ctx.pool,
        tenantId: ctx.tenantId,
      }),
    );
  }

  /** Trạng thái phạm vi duyệt của người dùng hiện tại (đếm cấp dưới theo Báo cáo cho). */
  async scopeStatus(ctx: {
    pool?: Queryable;
    tenantId: string;
    principal: { userId: string; permissions?: readonly string[] };
  }): Promise<HrmApprovalScopeStatus> {
    const permissions = ctx.principal.permissions ?? [];
    const preview = describeApprovalScope(permissions, 0);
    if (!preview.canApprove || preview.approveAll) return preview;
    const subordinates = await this.orgScope.subordinateUserIds(
      ctx.tenantId,
      ctx.principal.userId,
    );
    const unassigned = ctx.pool
      ? await chiefFallbackUserIds(ctx.pool, ctx.tenantId, ctx.principal.userId)
      : new Set<string>();
    const status = describeApprovalScope(
      permissions,
      new Set([...subordinates, ...unassigned]).size,
    );
    // Người được cấu hình duyệt theo chức danh (chỉ định hoặc dự phòng) không cần có cấp dưới: không báo thiếu "Báo cáo cho".
    if (status.noReportingLine && ctx.pool && (await holdsConfiguredApproverPosition(ctx.pool, ctx.tenantId, ctx.principal.userId)))
      return { ...status, noReportingLine: false, message: null };
    return status;
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
    if (!canApprove) {
      // Không có quyền duyệt HRM: chỉ những đơn được giao riêng (Procedure hoặc chức danh được chỉ định/dự phòng).
      const requestIds = await assignedRequestIds(ctx.pool, ctx.tenantId, kind, ctx.principal.userId);
      // Không có đơn nào được giao ở loại này thì chỉ thấy đơn của chính mình. Không thể trông vào `scoped` để giới hạn:
      // người được giao duyệt MỘT loại đơn được đọc không theo nhân viên ở mọi loại (các loại dùng chung một quyền duyệt),
      // nên trả 'TRUE' ở đây sẽ lộ toàn bộ đơn của những loại không được giao.
      if (!requestIds.length)
        return {
          sql: `${alias}.employee_id IN (SELECT oe.id FROM core_schema.employees oe WHERE oe.tenant_id = ${alias}.tenant_id AND oe.user_id = $${firstParam}::uuid)`,
          params: [ctx.principal.userId] as unknown[],
        };
      const allowSelf = await loadAllowSelfApproval(ctx.pool, ctx.tenantId);
      return approvalScopeSql(
        { all: false, userIds: [], requestIds, excludeUserId: allowSelf ? null : ctx.principal.userId },
        alias,
        firstParam,
      );
    }
    const scope = await resolveApprovalScope(ctx.principal, kind, {
      db: ctx.pool,
      tenantId: ctx.tenantId,
      orgScope: this.orgScope,
    });
    return approvalScopeSql(scope, alias, firstParam);
  }
}
