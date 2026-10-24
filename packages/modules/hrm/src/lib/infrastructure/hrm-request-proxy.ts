import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  HRM_ORG_SCOPE,
  HttpHrmOrgScopeResolver,
  type HrmOrgScopePort,
  type OrgSnapshotLike,
  type Queryable,
} from './hrm-approval-policy.js';
import { requireText, requireUuid } from './hrm-validation.js';

/**
 * Tạo đơn hộ nhân viên. Chỉ áp cho nghỉ phép, tăng ca, công tác, giải trình công. Người tạo hộ phải có quyền
 * `hrm.request.create.behalf` và nhân viên được chọn phải nằm trong phạm vi cấu hình (bảng request_proxy_rules);
 * `hrm.request.create.behalf.all` (và quyền quản lý đơn cũ `hrm.request.manage`) không bị giới hạn phạm vi.
 */
export const PROXY_KINDS = ['leave', 'ot', 'business_trip', 'correction'] as const;
export type ProxyKind = (typeof PROXY_KINDS)[number];

export const PROXY_SCOPE_TYPES = ['SUBORDINATES', 'SAME_UNIT', 'UNIT_LIST', 'EMPLOYEE_LIST', 'ALL'] as const;
export type ProxyScopeType = (typeof PROXY_SCOPE_TYPES)[number];

export const PROXY_FORBIDDEN = 'HRM_PROXY_FORBIDDEN';
export const PROXY_OUT_OF_SCOPE = 'HRM_PROXY_OUT_OF_SCOPE';
export const PROXY_REASON_REQUIRED = 'HRM_PROXY_REASON_REQUIRED';

/** Các trường dấu đơn tạo hộ để trả về cho giao diện (dùng trong mapper của từng loại đơn). */
export function onBehalfView(row: Record<string, unknown>) {
  return {
    submittedBy: (row['submitted_by'] ?? null) as string | null,
    createdOnBehalf: row['created_on_behalf'] === true,
    onBehalfReason: (row['on_behalf_reason'] ?? null) as string | null,
    onBehalfByName: (row['on_behalf_by_name'] ?? null) as string | null,
  };
}

export const isProxyKind = (kind: string): kind is ProxyKind => (PROXY_KINDS as readonly string[]).includes(kind);

export interface ProxyRule {
  id: string;
  name: string;
  /** NULL: áp cho mọi người có quyền tạo hộ; có giá trị: chỉ tài khoản đó. */
  granteeUserId: string | null;
  requestKinds: ProxyKind[];
  scopeType: ProxyScopeType;
  unitIds: string[];
  employeeIds: string[];
  active: boolean;
}

export interface ProxyDirectoryEntry {
  employeeId: string;
  userId: string | null;
  employeeCode: string;
  fullName: string;
}

export interface ProxyScope {
  /** Không giới hạn phạm vi. */
  all: boolean;
  /** Nhân viên được tạo hộ (không gồm chính người tạo). Bỏ qua khi `all`. */
  employeeIds: ReadonlySet<string>;
}

const SUBORDINATE_DEFAULT: ProxyRule = {
  id: 'default',
  name: 'Mặc định: cấp dưới theo sơ đồ tổ chức',
  granteeUserId: null,
  requestKinds: [...PROXY_KINDS],
  scopeType: 'SUBORDINATES',
  unitIds: [],
  employeeIds: [],
  active: true,
};

/** Các dòng cấu hình áp cho người tạo hộ với loại đơn này. */
export function applicableProxyRules(rules: readonly ProxyRule[], actorUserId: string, kind: ProxyKind): ProxyRule[] {
  return rules.filter(
    (rule) => rule.active && rule.requestKinds.includes(kind) && (rule.granteeUserId === null || rule.granteeUserId === actorUserId),
  );
}

/** Đơn vị và mọi đơn vị con của nó theo cây `parentId`. */
export function unitWithDescendants(snapshot: OrgSnapshotLike, unitIds: readonly string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const unit of snapshot.units ?? [])
    if (unit.parentId) children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit.id]);
  const result = new Set<string>();
  const stack = [...unitIds];
  while (stack.length) {
    const id = stack.pop() as string;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

/**
 * Tập nhân viên mà `actorUserId` được tạo hộ cho loại đơn `kind`. Hàm thuần: dữ liệu tổ chức và danh bạ truyền vào.
 * Nhiều dòng cùng áp thì lấy hợp; không có dòng nào áp thì dùng mặc định "cấp dưới".
 */
export function resolveProxyScope(input: {
  rules: readonly ProxyRule[];
  actorUserId: string;
  kind: ProxyKind;
  unrestricted: boolean;
  subordinateUserIds: ReadonlySet<string>;
  snapshot: OrgSnapshotLike;
  directory: readonly ProxyDirectoryEntry[];
}): ProxyScope {
  if (input.unrestricted) return { all: true, employeeIds: new Set() };
  const applicable = applicableProxyRules(input.rules, input.actorUserId, input.kind);
  const rules = applicable.length ? applicable : [SUBORDINATE_DEFAULT];
  const members = input.snapshot.members ?? [];
  const unitOfUser = new Map<string, Set<string>>();
  for (const member of members) {
    const set = unitOfUser.get(member.userId) ?? new Set<string>();
    set.add(member.unitId);
    unitOfUser.set(member.userId, set);
  }
  const inUnits = (units: ReadonlySet<string>) => (entry: ProxyDirectoryEntry) =>
    !!entry.userId && [...(unitOfUser.get(entry.userId) ?? [])].some((unit) => units.has(unit));

  const allowed = new Set<string>();
  for (const rule of rules) {
    if (rule.scopeType === 'ALL') return { all: true, employeeIds: new Set() };
    let picked: ProxyDirectoryEntry[] = [];
    if (rule.scopeType === 'SUBORDINATES')
      picked = input.directory.filter((e) => !!e.userId && input.subordinateUserIds.has(e.userId));
    else if (rule.scopeType === 'SAME_UNIT')
      picked = input.directory.filter(inUnits(new Set(unitOfUser.get(input.actorUserId) ?? [])));
    else if (rule.scopeType === 'UNIT_LIST')
      picked = input.directory.filter(inUnits(unitWithDescendants(input.snapshot, rule.unitIds)));
    else if (rule.scopeType === 'EMPLOYEE_LIST') {
      const ids = new Set(rule.employeeIds);
      picked = input.directory.filter((e) => ids.has(e.employeeId));
    }
    for (const entry of picked) if (entry.userId !== input.actorUserId) allowed.add(entry.employeeId);
  }
  return { all: false, employeeIds: allowed };
}

export function mapProxyRule(row: Record<string, unknown>): ProxyRule & { updatedAt: string } {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    granteeUserId: (row['grantee_user_id'] as string | null) ?? null,
    requestKinds: (row['request_kinds'] as ProxyKind[]) ?? [],
    scopeType: row['scope_type'] as ProxyScopeType,
    unitIds: (row['unit_ids'] as string[]) ?? [],
    employeeIds: (row['employee_ids'] as string[]) ?? [],
    active: row['active'] === true,
    updatedAt: new Date(row['updated_at'] as string).toISOString(),
  };
}

export interface ProxyRuleInput {
  name: string;
  granteeUserId: string | null;
  requestKinds: ProxyKind[];
  scopeType: ProxyScopeType;
  unitIds: string[];
  employeeIds: string[];
  active: boolean;
}

const uuidList = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: `${field}: danh sách không hợp lệ` });
  return [...new Set(value.map((v) => requireUuid(v, field)))];
};

/** Kiểm tra và chuẩn hoá nội dung một dòng cấu hình. Ném 400 tiếng Việt khi sai. */
export function normalizeProxyRuleInput(body: Record<string, unknown> | undefined): ProxyRuleInput {
  const input = body ?? {};
  const scopeType = String(input['scopeType'] ?? '');
  if (!(PROXY_SCOPE_TYPES as readonly string[]).includes(scopeType))
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Loại phạm vi không hợp lệ' });
  const kindsRaw = Array.isArray(input['requestKinds']) ? (input['requestKinds'] as unknown[]) : [];
  const requestKinds = [...new Set(kindsRaw.map(String))];
  if (!requestKinds.length || !requestKinds.every(isProxyKind))
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: 'Chỉ cho phép tạo hộ đơn nghỉ phép, tăng ca hoặc công tác',
    });
  const unitIds = uuidList(input['unitIds'], 'Đơn vị');
  const employeeIds = uuidList(input['employeeIds'], 'Nhân viên');
  if (scopeType === 'UNIT_LIST' && !unitIds.length)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Cần chọn ít nhất một đơn vị' });
  if (scopeType === 'EMPLOYEE_LIST' && !employeeIds.length)
    throw new BadRequestException({ code: 'HRM_INVALID_INPUT', message: 'Cần chọn ít nhất một nhân viên' });
  const grantee = input['granteeUserId'];
  return {
    name: requireText(input['name'], 'Tên cấu hình', 120),
    granteeUserId: grantee === undefined || grantee === null || grantee === '' ? null : requireUuid(grantee, 'Người được tạo hộ'),
    requestKinds: requestKinds as ProxyKind[],
    scopeType: scopeType as ProxyScopeType,
    unitIds: scopeType === 'UNIT_LIST' ? unitIds : [],
    employeeIds: scopeType === 'EMPLOYEE_LIST' ? employeeIds : [],
    active: input['active'] === undefined ? true : input['active'] === true,
  };
}

export async function loadProxyRules(db: Queryable, tenantId: string): Promise<ProxyRule[]> {
  const exists = await db.query(`SELECT to_regclass('hrm_schema.request_proxy_rules') IS NOT NULL AS ready`);
  if (exists.rows[0]?.ready !== true) return [];
  const rows = await db.query(
    `SELECT * FROM hrm_schema.request_proxy_rules WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at, id`,
    [tenantId],
  );
  return rows.rows.map(mapProxyRule);
}

/** Danh bạ nhân viên còn làm việc (để tính phạm vi và hiện danh sách chọn). */
export async function loadProxyDirectory(db: Queryable, tenantId: string): Promise<ProxyDirectoryEntry[]> {
  const rows = await db.query(
    `SELECT e.id AS employee_id, e.user_id, ep.employee_code, e.full_name
       FROM core_schema.employees e
       JOIN hrm_schema.employee_profiles ep ON ep.tenant_id = e.tenant_id AND ep.employee_id = e.id
      WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND ep.deleted_at IS NULL
        AND ep.employment_status NOT IN ('RESIGNED', 'TERMINATED')
      ORDER BY e.full_name`,
    [tenantId],
  );
  return rows.rows.map((r) => ({
    employeeId: r.employee_id as string,
    userId: (r.user_id as string | null) ?? null,
    employeeCode: r.employee_code as string,
    fullName: r.full_name as string,
  }));
}

export interface ProxyActor {
  pool: Queryable;
  tenantId: string;
  principal: { userId: string; permissions?: readonly string[] };
}

/** Quyền không bị giới hạn phạm vi: tạo hộ toàn tenant, quản lý đơn (quyền cũ), quản trị HRM/tenant. */
export function hasUnrestrictedProxy(permissions: readonly string[] | undefined): boolean {
  const held = permissions ?? [];
  return (
    held.includes('hrm.request.create.behalf.all') ||
    held.includes('hrm.request.manage') ||
    held.includes('hrm.manage') ||
    held.includes('tenant.manage')
  );
}

export const canCreateBehalf = (permissions: readonly string[] | undefined) =>
  hasUnrestrictedProxy(permissions) || (permissions ?? []).includes('hrm.request.create.behalf');

@Injectable()
export class HrmRequestProxyService {
  private readonly orgScope: HrmOrgScopePort;

  constructor(@Optional() @Inject(HRM_ORG_SCOPE) orgScope?: HrmOrgScopePort) {
    this.orgScope = orgScope ?? new HttpHrmOrgScopeResolver();
  }

  /** Phạm vi tạo hộ hiện tại của người dùng cho loại đơn. Ném 403 khi không có quyền tạo hộ. */
  async scope(ctx: ProxyActor, kind: ProxyKind): Promise<ProxyScope & { directory: ProxyDirectoryEntry[] }> {
    const permissions = ctx.principal.permissions;
    if (!canCreateBehalf(permissions))
      throw new ForbiddenException({ code: PROXY_FORBIDDEN, message: 'Bạn không có quyền tạo đơn hộ nhân viên.' });
    const unrestricted = hasUnrestrictedProxy(permissions);
    const directory = await loadProxyDirectory(ctx.pool, ctx.tenantId);
    if (unrestricted) return { all: true, employeeIds: new Set(), directory };
    const [rules, subordinateUserIds, snapshot] = await Promise.all([
      loadProxyRules(ctx.pool, ctx.tenantId),
      this.orgScope.subordinateUserIds(ctx.tenantId, ctx.principal.userId),
      this.orgScope.orgSnapshot ? this.orgScope.orgSnapshot(ctx.tenantId) : Promise.resolve({} as OrgSnapshotLike),
    ]);
    return {
      ...resolveProxyScope({
        rules,
        actorUserId: ctx.principal.userId,
        kind,
        unrestricted: false,
        subordinateUserIds,
        snapshot,
        directory,
      }),
      directory,
    };
  }

  /** Chặn khi nhân viên được chọn nằm ngoài phạm vi tạo hộ của người dùng. */
  async assertCanCreateFor(ctx: ProxyActor, kind: ProxyKind, targetEmployeeId: string): Promise<void> {
    const scope = await this.scope(ctx, kind);
    const target = scope.directory.find((e) => e.employeeId === targetEmployeeId);
    if (!target)
      throw new NotFoundException({ code: 'HRM_EMPLOYEE_NOT_FOUND', message: 'Không tìm thấy nhân viên còn làm việc.' });
    if (target.userId === ctx.principal.userId) return;
    if (!scope.all && !scope.employeeIds.has(targetEmployeeId))
      throw new ForbiddenException({
        code: PROXY_OUT_OF_SCOPE,
        message: 'Nhân viên này không thuộc phạm vi bạn được tạo đơn hộ.',
      });
  }

  /** Danh sách nhân viên được chọn ở ô "Tạo cho" (không gồm chính người dùng). */
  async candidates(ctx: ProxyActor, kind: ProxyKind, query: string, limit = 50) {
    const scope = await this.scope(ctx, kind);
    const needle = query.trim().toLowerCase();
    return scope.directory
      .filter((e) => e.userId !== ctx.principal.userId)
      .filter((e) => scope.all || scope.employeeIds.has(e.employeeId))
      .filter((e) => !needle || e.fullName.toLowerCase().includes(needle) || e.employeeCode.toLowerCase().includes(needle))
      .slice(0, Math.min(Math.max(limit, 1), 200))
      .map((e) => ({ employeeId: e.employeeId, employeeCode: e.employeeCode, fullName: e.fullName }));
  }
}

/** Lý do tạo hộ bắt buộc, tối đa 500 ký tự. */
export function requireProxyReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException({
      code: PROXY_REASON_REQUIRED,
      message: 'Cần nhập lý do tạo đơn hộ nhân viên.',
    });
  return requireText(value, 'Lý do tạo hộ', 500);
}

const KIND_LABELS: Readonly<Record<ProxyKind, string>> = {
  leave: 'nghỉ phép',
  ot: 'làm thêm giờ',
  business_trip: 'công tác',
  correction: 'giải trình công',
};

/**
 * Ghi dấu đơn tạo hộ ngay sau khi đơn được tạo (cùng giao dịch): người gửi thật, lý do, nhật ký kiểm toán và sự kiện báo
 * cho chủ đơn qua outbox. Chủ đơn không có tài khoản thì chỉ ghi nhật ký.
 */
export async function recordOnBehalfCreation(
  db: PoolClient,
  input: {
    tenantId: string;
    table: 'leave_requests' | 'ot_requests' | 'business_trip_requests' | 'attendance_corrections';
    kind: ProxyKind;
    requestId: string;
    employeeId: string;
    actorUserId: string;
    reason: string;
    /** Điền sẵn tên người tạo sau khi ghi (để bên gọi trả về trong phản hồi). */
    actorName?: string | null;
  },
): Promise<void> {
  const people = await db.query(
    `SELECT e.user_id AS owner_user_id, e.full_name AS owner_name,
            (SELECT u.full_name FROM core_schema.employees u WHERE u.tenant_id = e.tenant_id AND u.user_id = $3 LIMIT 1) AS actor_name
       FROM core_schema.employees e WHERE e.tenant_id = $1 AND e.id = $2`,
    [input.tenantId, input.employeeId, input.actorUserId],
  );
  const owner = people.rows[0] as { owner_user_id: string | null; owner_name: string; actor_name: string | null } | undefined;
  await db.query(
    `UPDATE hrm_schema.${input.table}
        SET submitted_by = $3, created_on_behalf = true, on_behalf_reason = $4, on_behalf_by_name = $5
      WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.requestId, input.actorUserId, input.reason, owner?.actor_name ?? null],
  );
  input.actorName = owner?.actor_name ?? null;
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id, actor_id, action, entity_type, entity_id, detail)
     VALUES($1, $2, 'REQUEST_CREATE_ON_BEHALF', $3, $4, $5)`,
    [
      input.tenantId,
      input.actorUserId,
      input.kind.toUpperCase(),
      input.requestId,
      JSON.stringify({ employeeId: input.employeeId, reason: input.reason }),
    ],
  );
  if (!owner?.owner_user_id || owner.owner_user_id === input.actorUserId) return;
  const event = createIntegrationEvent({
    tenantId: input.tenantId,
    source: 'hrm',
    correlationId: input.requestId,
    id: randomUUID(),
    type: 'hrm.request.created-on-behalf',
    version: 1,
    payload: {
      requestId: input.requestId,
      requestKind: input.kind,
      actorUserId: input.actorUserId,
      recipientUserIds: [owner.owner_user_id],
      summary: `${owner.actor_name ?? 'Một người dùng'} đã tạo đơn ${KIND_LABELS[input.kind]} hộ bạn. Lý do: ${input.reason}`,
      deepLink: `/modules/hrm/requests?request=${encodeURIComponent(input.requestId)}`,
    },
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'hrm-request', $2, $3, $4, $5::jsonb, $6)`,
    [event.id, event.correlationId, event.type, event.version, JSON.stringify(event), event.occurredAt],
  );
}

/** Ghi dấu đơn tạo hộ rồi trả lại dòng đơn đã kèm các cột mới (để phản hồi đúng ngay lần tạo). */
export async function markOnBehalf<T extends Record<string, unknown>>(
  db: PoolClient,
  row: T,
  input: Omit<Parameters<typeof recordOnBehalfCreation>[1], 'requestId'>,
): Promise<T> {
  const detail: Parameters<typeof recordOnBehalfCreation>[1] = { ...input, requestId: row['id'] as string };
  await recordOnBehalfCreation(db, detail);
  return {
    ...row,
    submitted_by: input.actorUserId,
    created_on_behalf: true,
    on_behalf_reason: input.reason,
    on_behalf_by_name: detail.actorName ?? null,
  };
}
