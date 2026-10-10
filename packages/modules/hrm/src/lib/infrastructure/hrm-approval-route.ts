import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ApprovalRouteConfigItem,
  ApprovalRouteMode,
  ApprovalRoutePreview,
  HrmRequestKind,
  SetApprovalRoutePayload,
} from '@enterprise-platform/contracts-hrm';
import { loadAllowSelfApproval } from './hrm-approval-policy.js';
import { fetchPublishedProcedureDefinition } from './hrm-procedure-api.js';
import {
  normalizeHrmRequestKind,
  saveHrmProcedureBinding,
} from './hrm-procedure-links.js';
import { loadDirectManagerRef } from './hrm-personnel-decisions.js';
import {
  REQUEST_REASON_KIND_TO_REQUEST_KIND,
  type RequestReasonKind,
} from './hrm-request-reason.js';
import { requireUuid } from './hrm-validation.js';

/**
 * Cách duyệt đơn (hai cách): DIRECT = quản lý trực tiếp duyệt, PROCEDURE = theo quy trình của Procedure Engine.
 * Dữ liệu nằm ở `request_procedure_bindings` (kind + sub_type_code; sub_type_code là MÃ LÝ DO của đơn):
 *  - đơn nghỉ: lý do = loại nghỉ (`leave_types.code`);
 *  - làm thêm giờ, công tác, giải trình công, đổi ca: lý do = `request_reasons.code` của đúng loại danh mục;
 *  - ứng lương, đính chính hồ sơ: không có lý do, chỉ có cấu hình chung.
 * Quy tắc chọn cấu hình khi gửi đơn (khớp `prepareHrmProcedureLink`, truyền `subTypeCode` = mã lý do): có cấu hình
 * riêng theo mã lý do thì dùng nó, không thì dùng cấu hình chung của loại đơn (sub_type_code NULL), không có gì thì DIRECT.
 */

type Queryable = Pick<PoolClient, 'query'>;

export const APPROVAL_ROUTE_KINDS: readonly {
  readonly kind: HrmRequestKind;
  readonly label: string;
}[] = [
  { kind: 'leave', label: 'Nghỉ phép' },
  { kind: 'ot', label: 'Làm thêm giờ' },
  { kind: 'business_trip', label: 'Công tác' },
  { kind: 'shift_change', label: 'Đổi ca' },
  { kind: 'correction', label: 'Giải trình công' },
  { kind: 'advance', label: 'Ứng lương' },
  { kind: 'profile_correction', label: 'Đính chính hồ sơ' },
];

/** Loại đơn có lý do cấu hình được -> loại danh mục `request_reasons.kind` (đơn nghỉ dùng leave_types, không có ở đây). */
const REASON_KIND_OF_REQUEST_KIND: Partial<
  Record<HrmRequestKind, RequestReasonKind>
> = Object.fromEntries(
  Object.entries(REQUEST_REASON_KIND_TO_REQUEST_KIND).map(
    ([reasonKind, requestKind]) => [requestKind, reasonKind],
  ),
);

/** Loại đơn có thể cấu hình cách duyệt riêng theo lý do. */
export function kindHasReasons(kind: HrmRequestKind): boolean {
  return kind === 'leave' || kind in REASON_KIND_OF_REQUEST_KIND;
}

export interface ApprovalBindingRow {
  id: string;
  request_kind: string;
  sub_type_code: string | null;
  mode: string;
  procedure_definition_id: string | null;
  configuration_status?: string | null;
}

/** Một lý do đang dùng của một loại đơn (loại nghỉ hoặc dòng danh mục lý do). */
export interface ApprovalReasonRow {
  requestKind: HrmRequestKind;
  id: string;
  code: string;
  name: string;
}

export interface ApprovalRouteRows {
  bindings: readonly ApprovalBindingRow[];
  reasons: readonly ApprovalReasonRow[];
}

export interface SelectedApprovalBinding {
  binding: ApprovalBindingRow | null;
  /** true nếu binding được chọn là cấu hình riêng theo mã lý do (không phải cấu hình chung). */
  specific: boolean;
  /** Có nhiều cấu hình mâu thuẫn trong cùng nhóm được chọn (gửi đơn sẽ bị chặn 409). */
  conflict: boolean;
}

/**
 * Chọn cấu hình áp dụng: riêng theo mã lý do (`subTypeCode`) nếu có, nếu không thì chung của loại đơn.
 * `rows` đã sắp theo created_at, id.
 */
export function selectApprovalBinding(
  rows: readonly ApprovalBindingRow[],
  kind: HrmRequestKind,
  subTypeCode?: string | null,
): SelectedApprovalBinding {
  const ofKind = rows.filter((row) => row.request_kind === kind);
  const specificRows = subTypeCode
    ? ofKind.filter((row) => row.sub_type_code === subTypeCode)
    : [];
  const specific = specificRows.length > 0;
  const selected = specific
    ? specificRows
    : ofKind.filter((row) => row.sub_type_code == null);
  const binding = selected[0] ?? null;
  const conflict =
    binding !== null &&
    selected.some(
      (row) =>
        row.configuration_status === 'CONFLICT' ||
        row.mode !== binding.mode ||
        row.procedure_definition_id !== binding.procedure_definition_id,
    );
  return { binding, specific, conflict };
}

function routeMode(binding: ApprovalBindingRow | null): ApprovalRouteMode {
  return binding?.mode === 'PROCEDURE' ? 'PROCEDURE' : 'DIRECT';
}

/** Id quy trình đang được dùng bởi các cấu hình PROCEDURE còn hiệu lực (để tra tên một lần). */
export function procedureIdsInUse(rows: ApprovalRouteRows): string[] {
  return [
    ...new Set(
      rows.bindings
        .filter((row) => row.mode === 'PROCEDURE' && row.procedure_definition_id)
        .map((row) => row.procedure_definition_id as string),
    ),
  ];
}

/**
 * Thuần: dựng danh sách dòng cấu hình. Mọi loại đơn đều có một dòng (mặc định DIRECT); mỗi lý do đang dùng của
 * đơn nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca có thêm một dòng, `inherited` khi lý do chưa có cấu hình riêng.
 */
export function buildApprovalRouteItems(
  rows: ApprovalRouteRows,
  procedureNames: ReadonlyMap<string, string> = new Map(),
): ApprovalRouteConfigItem[] {
  const nameOf = (binding: ApprovalBindingRow | null, mode: ApprovalRouteMode) =>
    mode === 'PROCEDURE' && binding?.procedure_definition_id
      ? (procedureNames.get(binding.procedure_definition_id) ?? null)
      : null;
  const items: ApprovalRouteConfigItem[] = [];
  for (const { kind, label } of APPROVAL_ROUTE_KINDS) {
    const general = selectApprovalBinding(rows.bindings, kind);
    const generalMode = routeMode(general.binding);
    items.push({
      requestKind: kind,
      reasonId: null,
      reasonCode: null,
      reasonName: null,
      label,
      mode: generalMode,
      procedureDefinitionId:
        generalMode === 'PROCEDURE'
          ? (general.binding?.procedure_definition_id ?? null)
          : null,
      procedureName: nameOf(general.binding, generalMode),
      inherited: false,
      bindingId: general.binding?.id ?? null,
      conflict: general.conflict,
    });
    for (const reason of rows.reasons.filter((r) => r.requestKind === kind)) {
      const own = selectApprovalBinding(rows.bindings, kind, reason.code);
      const effective = own.specific ? own : general;
      const mode = routeMode(effective.binding);
      items.push({
        requestKind: kind,
        reasonId: reason.id,
        reasonCode: reason.code,
        reasonName: reason.name,
        label: `${label} · ${reason.name}`,
        mode,
        procedureDefinitionId:
          mode === 'PROCEDURE'
            ? (effective.binding?.procedure_definition_id ?? null)
            : null,
        procedureName: nameOf(effective.binding, mode),
        inherited: !own.specific,
        bindingId: own.specific ? (own.binding?.id ?? null) : null,
        conflict: effective.conflict,
      });
    }
  }
  return items;
}

/** Đọc cấu hình đang hiệu lực và các lý do đang dùng (loại nghỉ + danh mục lý do) của tenant. */
export async function loadApprovalRouteRows(
  db: Queryable,
  tenantId: string,
): Promise<ApprovalRouteRows> {
  const bindings = await db.query(
    `SELECT id,request_kind,sub_type_code,mode,procedure_definition_id,configuration_status
       FROM hrm_schema.request_procedure_bindings
      WHERE tenant_id=$1 AND is_active
      ORDER BY created_at,id`,
    [tenantId],
  );
  const leaveTypes = await db.query(
    `SELECT id,code,name FROM hrm_schema.leave_types
      WHERE tenant_id=$1 AND deleted_at IS NULL AND active=true
      ORDER BY code`,
    [tenantId],
  );
  const catalog = await db.query(
    `SELECT id,kind,code,name FROM hrm_schema.request_reasons
      WHERE tenant_id=$1 AND deleted_at IS NULL AND active=true AND code IS NOT NULL
      ORDER BY sort_order,name`,
    [tenantId],
  );
  const reasons: ApprovalReasonRow[] = [
    ...leaveTypes.rows.map(
      (row: { id: string; code: string; name: string }) => ({
        requestKind: 'leave' as HrmRequestKind,
        id: row.id,
        code: row.code,
        name: row.name,
      }),
    ),
  ];
  for (const row of catalog.rows as {
    id: string;
    kind: string;
    code: string;
    name: string;
  }[]) {
    const requestKind =
      REQUEST_REASON_KIND_TO_REQUEST_KIND[row.kind as RequestReasonKind];
    if (requestKind)
      reasons.push({ requestKind, id: row.id, code: row.code, name: row.name });
  }
  return { bindings: bindings.rows as ApprovalBindingRow[], reasons };
}

/**
 * Tên các quy trình qua API nội bộ của Procedure (không đọc DB của Procedure).
 * Quy trình không đọc được (chưa công bố, Procedure tắt) thì bỏ qua; dòng đó hiện procedureName = null.
 */
export async function resolveProcedureNames(
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const results = await Promise.allSettled(
    ids.map((id) => fetchPublishedProcedureDefinition(tenantId, id)),
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value?.name)
      names.set(ids[index], result.value.name);
  });
  return names;
}

/**
 * Tìm một lý do của loại đơn theo id hoặc theo mã. Đơn nghỉ: `leave_types`; bốn loại đơn còn lại: `request_reasons`
 * đúng loại danh mục. Loại đơn không có lý do (ứng lương, đính chính hồ sơ) luôn trả null.
 * `onlyLive`: bỏ qua lý do đã xóa (cấu hình mới chỉ cho lý do còn tồn tại; tra cứu khi xem trước thì không cần).
 */
export async function findApprovalReason(
  db: Queryable,
  tenantId: string,
  kind: HrmRequestKind,
  by: { id: string } | { code: string },
  onlyLive: boolean,
): Promise<{ id: string; code: string; name: string } | null> {
  const live = onlyLive ? ' AND deleted_at IS NULL' : '';
  const byId = 'id' in by;
  if (kind === 'leave') {
    const row = (
      await db.query(
        `SELECT id,code,name FROM hrm_schema.leave_types WHERE tenant_id=$1 AND ${
          byId ? 'id=$2' : 'code=$2'
        }${live}`,
        [tenantId, byId ? by.id : by.code],
      )
    ).rows[0];
    return row ?? null;
  }
  const reasonKind = REASON_KIND_OF_REQUEST_KIND[kind];
  if (!reasonKind) return null;
  const row = (
    await db.query(
      `SELECT id,code,name FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$3 AND ${
        byId ? 'id=$2' : 'upper(code)=upper($2)'
      } AND code IS NOT NULL${live}`,
      [tenantId, byId ? by.id : by.code, reasonKind],
    )
  ).rows[0];
  return row ?? null;
}

export interface ParsedApprovalRoute {
  kind: HrmRequestKind;
  reasonCode: string | null;
  mode: ApprovalRouteMode | 'INHERIT';
  definitionId: string | null;
}

/** Kiểm tra và chuẩn hóa body của PUT /approval-config (chưa chạm DB hay Procedure). */
export function parseSetApprovalRoute(body: unknown): ParsedApprovalRoute {
  const input = (body ?? {}) as Partial<SetApprovalRoutePayload> & {
    [key: string]: unknown;
  };
  if (typeof input.requestKind !== 'string')
    throw new BadRequestException('Loại đơn không hợp lệ');
  const kind = normalizeHrmRequestKind(input.requestKind);
  const mode = input.mode;
  if (mode !== 'DIRECT' && mode !== 'PROCEDURE' && mode !== 'INHERIT')
    throw new BadRequestException('Chế độ duyệt không hợp lệ');
  if (input.reasonCode != null && typeof input.reasonCode !== 'string')
    throw new BadRequestException('Mã lý do không hợp lệ');
  const code = input.reasonCode?.trim() || null;
  if (code && !kindHasReasons(kind))
    throw new BadRequestException(
      'Loại đơn này không có lý do để cấu hình riêng',
    );
  if (code && code.length > 50)
    throw new BadRequestException('Mã lý do quá dài');
  if (mode === 'INHERIT' && !code)
    throw new BadRequestException(
      'Chỉ lý do mới có thể dùng lại cấu hình chung của loại đơn',
    );
  let definitionId: string | null = null;
  if (mode === 'PROCEDURE') {
    if (
      typeof input.procedureDefinitionId !== 'string' ||
      !input.procedureDefinitionId.trim()
    )
      throw new BadRequestException(
        'Cần chọn quy trình khi duyệt theo quy trình',
      );
    definitionId = requireUuid(input.procedureDefinitionId, 'Quy trình');
  }
  return { kind, reasonCode: code, mode, definitionId };
}

/**
 * Đảm bảo loại đơn có cấu hình chung (mặc định DIRECT) để các lý do không có cấu hình riêng vẫn rõ ràng.
 * Gọi trong giao dịch đã giữ khóa `hrm-binding:<tenant>:<kind>` của `saveHrmProcedureBinding`.
 */
export async function ensureDefaultDirectBinding(
  db: PoolClient,
  tenantId: string,
  kind: HrmRequestKind,
  actorId: string,
): Promise<boolean> {
  const exists = await db.query(
    `SELECT 1 FROM hrm_schema.request_procedure_bindings
      WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code IS NULL AND is_active LIMIT 1`,
    [tenantId, kind],
  );
  if (exists.rows.length) return false;
  await saveHrmProcedureBinding(db, {
    tenantId,
    kind,
    mode: 'DIRECT',
    actorId,
  });
  return true;
}

/** Gỡ cấu hình riêng của một lý do để nó dùng lại cấu hình chung (kế thừa). */
async function clearReasonBinding(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  kind: HrmRequestKind,
  reasonCode: string,
): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `hrm-binding:${tenantId}:${kind}`,
  ]);
  const before = (
    await db.query(
      `SELECT * FROM hrm_schema.request_procedure_bindings
        WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code=$3 AND is_active
        ORDER BY created_at,id FOR UPDATE`,
      [tenantId, kind, reasonCode],
    )
  ).rows;
  if (!before.length) return;
  await db.query(
    `UPDATE hrm_schema.request_procedure_bindings SET is_active=false,updated_at=now(),updated_by=$4
      WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code=$3 AND is_active`,
    [tenantId, kind, reasonCode, actorId],
  );
  await db.query(
    `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
     VALUES($1,$2,'PROCEDURE_BINDING_CONFIGURED','request_procedure_binding',$3,$4)`,
    [
      tenantId,
      actorId,
      before[0].id,
      JSON.stringify({ before, after: { inherited: true } }),
    ],
  );
}

/**
 * Đặt cách duyệt cho một loại đơn hoặc một lý do của loại đơn, trong giao dịch của bên gọi.
 * - PROCEDURE: tái dùng `saveHrmProcedureBinding` (kiểm tra quy trình đã công bố qua API Procedure, khóa theo loại đơn,
 *   vô hiệu cấu hình trùng, ghi audit_log).
 * - DIRECT: cũng qua `saveHrmProcedureBinding`; cấu hình PROCEDURE khớp đúng (kind + mã lý do) được chuyển thành DIRECT.
 *   Với một lý do, cấu hình DIRECT riêng được lưu rõ để thắng cấu hình chung đang là PROCEDURE.
 * - INHERIT (chỉ lý do): gỡ cấu hình riêng.
 * Mã lý do phải khớp một lý do có thật của đúng loại đơn; mã lưu là mã gốc của lý do (đúng chữ hoa/thường).
 * Trả về các cảnh báo cấu hình (không chặn lưu).
 */
export async function applyApprovalRoute(
  db: PoolClient,
  input: {
    tenantId: string;
    actorId: string;
    route: ParsedApprovalRoute;
  },
): Promise<string[]> {
  const { tenantId, actorId, route } = input;
  let reasonCode: string | null = null;
  if (route.reasonCode) {
    const reason = await findApprovalReason(
      db,
      tenantId,
      route.kind,
      { code: route.reasonCode },
      true,
    );
    if (!reason)
      throw new NotFoundException('Không tìm thấy lý do của loại đơn này');
    reasonCode = reason.code;
  }
  if (route.mode === 'INHERIT') {
    await clearReasonBinding(
      db,
      tenantId,
      actorId,
      route.kind,
      reasonCode as string,
    );
    return [];
  }
  const saved = (await saveHrmProcedureBinding(db, {
    tenantId,
    kind: route.kind,
    subTypeCode: reasonCode ?? undefined,
    mode: route.mode,
    definitionId: route.definitionId ?? undefined,
    actorId,
  })) as { warnings?: string[] };
  if (reasonCode)
    await ensureDefaultDirectBinding(db, tenantId, route.kind, actorId);
  return saved?.warnings ?? [];
}

export const NO_DIRECT_MANAGER_NOTE =
  'Chưa có quản lý trực tiếp; đơn do người có quyền duyệt toàn bộ xử lý';

/**
 * Người duyệt dự kiến của một đơn trước khi gửi. Cùng quy tắc chọn cấu hình với lúc gửi đơn.
 * `reasonId`: với đơn nghỉ là `leave_types.id`; với làm thêm giờ, công tác, giải trình công, đổi ca là
 * `request_reasons.id`. Tra ra mã lý do để chọn cấu hình theo sub_type_code trước, rồi mới tới cấu hình chung.
 */
export async function previewApprovalRoute(
  db: Queryable,
  input: {
    tenantId: string;
    kind: HrmRequestKind;
    employeeId: string;
    reasonId?: string | null;
  },
): Promise<ApprovalRoutePreview> {
  const { tenantId, kind, employeeId } = input;
  let reasonCode: string | null = null;
  if (input.reasonId && kindHasReasons(kind)) {
    const reason = await findApprovalReason(
      db,
      tenantId,
      kind,
      { id: input.reasonId },
      false,
    );
    if (!reason) throw new NotFoundException('Không tìm thấy lý do của đơn');
    reasonCode = reason.code;
  }
  const rows = (
    await db.query(
      `SELECT id,request_kind,sub_type_code,mode,procedure_definition_id,configuration_status
         FROM hrm_schema.request_procedure_bindings
        WHERE tenant_id=$1 AND request_kind=$2 AND is_active AND (sub_type_code IS NULL OR sub_type_code=$3)
        ORDER BY created_at,id`,
      [tenantId, kind, reasonCode],
    )
  ).rows as ApprovalBindingRow[];
  const selected = selectApprovalBinding(rows, kind, reasonCode);
  const mode = routeMode(selected.binding);
  const selfApprovalBlocked = !(await loadAllowSelfApproval(db, tenantId));
  const conflictNote = selected.conflict
    ? 'Cấu hình quy trình đang xung đột; quản trị viên cần chọn lại trước khi gửi đơn.'
    : undefined;
  if (mode === 'PROCEDURE') {
    const definitionId = selected.binding?.procedure_definition_id ?? null;
    let procedureName: string | null = null;
    let note: string | undefined = conflictNote;
    if (!note && !definitionId)
      note = 'Chưa cấu hình quy trình được công bố; đơn chưa thể gửi.';
    else if (!note && definitionId) {
      try {
        procedureName =
          (await fetchPublishedProcedureDefinition(tenantId, definitionId))
            .name ?? null;
      } catch {
        note =
          'Chưa đọc được tên quy trình; Procedure Engine có thể tạm thời không khả dụng.';
      }
    }
    return {
      mode,
      procedureName,
      selfApprovalBlocked,
      ...(note ? { note } : {}),
    };
  }
  const manager = await loadDirectManagerRef(db, tenantId, employeeId);
  return {
    mode,
    directManager: manager
      ? {
          employeeId: manager.employeeId,
          fullName: manager.name,
          positionName: manager.title,
        }
      : null,
    selfApprovalBlocked,
    ...(conflictNote
      ? { note: conflictNote }
      : manager
        ? {}
        : { note: NO_DIRECT_MANAGER_NOTE }),
  };
}
