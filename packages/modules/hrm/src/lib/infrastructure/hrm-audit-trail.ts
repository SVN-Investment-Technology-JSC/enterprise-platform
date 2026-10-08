import type { Pool } from 'pg';

/** Trùng HRM_PROCEDURE_SYSTEM_ACTOR_ID (hrm-procedure-sync.ts); không import để tránh kéo theo client Platform. */
const HRM_PROCEDURE_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

/** Nhãn tiếng Việt cho các hành động được ghi nhật ký. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LEAVE_SUBMITTED: 'Gửi đơn nghỉ',
  LEAVE_APPROVED: 'Duyệt đơn nghỉ',
  LEAVE_REJECTED: 'Từ chối đơn nghỉ',
  LEAVE_CANCELLED: 'Hủy đơn nghỉ',
  LEAVE_AMENDED: 'Điều chỉnh đơn nghỉ',
  LEAVE_TYPE_UPDATED: 'Cập nhật loại nghỉ',
  LEAVE_TYPE_MERGED: 'Gộp loại nghỉ',
  LEAVE_ADJUSTMENT_REVERSED: 'Đảo điều chỉnh quỹ phép',
  LEAVE_SCHEDULE_EDIT: 'Sửa lịch cộng phép',
  LEAVE_SCHEDULE_VERSION: 'Tạo phiên bản lịch cộng phép',
  LEAVE_SCHEDULE_DEACTIVATE: 'Kết thúc lịch cộng phép',
  LEAVE_SCHEDULE_DELETED: 'Xóa lịch cộng phép',
  LEAVE_SETTLED: 'Quyết toán phép nghỉ việc',
  LEAVE_SETTLEMENT_SCHEDULED: 'Gắn thu hồi phép vào kỳ lương',
  LEAVE_SETTLEMENT_WAIVED: 'Miễn khấu trừ phép',
  REQUEST_WITHDRAW: 'Rút đơn',
  REQUEST_REJECT: 'Từ chối đơn',
  REQUEST_EFFECT_REVERSED: 'Hủy hiệu lực đơn đã duyệt',
  REQUEST_DRAFT_CREATED: 'Tạo bản nháp đơn',
  REQUEST_DRAFT_UPDATED: 'Cập nhật bản nháp đơn',
  REQUEST_DRAFT_DELETED: 'Xóa bản nháp đơn',
  REQUEST_DRAFT_SUBMITTED: 'Gửi đơn từ bản nháp',
  PROCEDURE_RESULT_APPLIED: 'Áp dụng kết quả phê duyệt',
  PROCEDURE_BINDING_CONFIGURED: 'Cấu hình quy trình duyệt',
  PROCEDURE_FIELD_MAPPINGS_CONFIGURED: 'Cấu hình ánh xạ trường',
  PROCEDURE_RETRY_QUEUED: 'Gửi lại đồng bộ quy trình',
  PROCEDURE_RELINK_QUEUED: 'Gắn lại quy trình',
  APPROVAL_POLICY_CHANGED: 'Đổi chính sách phê duyệt',
  EMPLOYEE_UPDATED: 'Cập nhật hồ sơ nhân viên',
  EMPLOYEE_DEACTIVATED: 'Ngừng nhân viên',
  EMPLOYEE_ACCOUNT_LINKED: 'Liên kết tài khoản',
  PROFILE_CORRECTION_APPROVED: 'Duyệt điều chỉnh hồ sơ',
  PROFILE_DOCUMENT_SET: 'Cập nhật giấy tờ hồ sơ',
  CONTRACT_DRAFT_CREATED: 'Tạo hợp đồng nháp',
  CONTRACT_DRAFT_UPDATED: 'Sửa hợp đồng nháp',
  CONTRACT_DRAFT_DELETED: 'Xóa hợp đồng nháp',
  CONTRACT_ISSUED: 'Ban hành hợp đồng',
  CONTRACT_AMENDMENT_CREATED: 'Tạo phụ lục hợp đồng',
  CONTRACT_TERMINATED: 'Chấm dứt hợp đồng',
  PERSONNEL_DECISION_CREATED: 'Tạo quyết định nhân sự',
  PERSONNEL_DECISION_UPDATED: 'Sửa quyết định nhân sự',
  PERSONNEL_DECISION_APPROVED: 'Duyệt quyết định nhân sự',
  PERSONNEL_DECISION_REJECTED: 'Từ chối quyết định nhân sự',
  PERSONNEL_DECISION_CANCELLED: 'Hủy quyết định nhân sự',
  PERSONNEL_DECISION_APPLIED: 'Áp dụng quyết định nhân sự',
  DEPENDENT_REGISTER: 'Đăng ký người phụ thuộc',
  DEPENDENT_AMENDED: 'Điều chỉnh người phụ thuộc',
  FAMILY_DECLARED: 'Khai báo thành viên gia đình',
  FAMILY_UPDATED: 'Cập nhật thành viên gia đình',
  FAMILY_DELETED: 'Xóa thành viên gia đình',
  QUALIFICATION_ADDED: 'Thêm bằng cấp',
  QUALIFICATION_UPDATED: 'Cập nhật bằng cấp',
  QUALIFICATION_REMOVED: 'Xóa bằng cấp',
  ATTACHMENT_REMOVED: 'Xóa tệp đính kèm',
  SENSITIVE_ATTACHMENT_DOWNLOADED: 'Tải tệp bảo mật',
  POSITION_PROFILE_CREATED: 'Tạo hồ sơ chức danh',
  POSITION_PROFILE_UPDATED: 'Cập nhật hồ sơ chức danh',
  POSITION_PROFILE_DELETED: 'Xóa hồ sơ chức danh',
  CALENDAR_SAVED: 'Lưu lịch làm việc',
  CALENDAR_DELETED: 'Xóa ngày trong lịch',
  HOLIDAY_YEAR_IMPORTED: 'Nạp lịch nghỉ lễ',
  SITE_UPDATED: 'Cập nhật địa điểm chấm công',
  SITE_DEACTIVATED: 'Ngừng địa điểm chấm công',
  ATTENDANCE_DEVICE_APPROVED: 'Duyệt thiết bị chấm công',
  ATTENDANCE_DEVICE_REVOKED: 'Thu hồi thiết bị chấm công',
  approve: 'Duyệt thiết bị chấm công',
  revoke: 'Thu hồi thiết bị chấm công',
  POLICY_VERSION_PUBLISHED: 'Ban hành phiên bản chính sách',
  SHIFT_UPDATED: 'Cập nhật ca làm việc',
  ROSTER_CREATED: 'Phân ca',
  ROSTER_UPDATED: 'Sửa phân ca',
  ROSTER_CANCELLED: 'Hủy phân ca',
  TIMESHEET_CALCULATED: 'Tính bảng công',
  TIMESHEET_ADJUSTED: 'Điều chỉnh bảng công',
  TIMESHEET_EXPORT: 'Xuất bảng công',
  TIMESHEET_OUTSIDE_EMPLOYMENT_REMOVED: 'Xóa công ngoài thời gian làm việc',
  TIMESHEET_PERIOD_UPDATED: 'Cập nhật kỳ công',
  TIMESHEET_PERIOD_DELETED: 'Xóa kỳ công',
  TIMESHEET_PERIOD_LOCKED: 'Khóa kỳ công',
  TIMESHEET_PERIOD_REOPENED: 'Mở lại kỳ công',
  PAYROLL_PERIOD_UPDATED: 'Cập nhật kỳ lương',
  PAYROLL_PERIOD_DELETED: 'Xóa kỳ lương',
  PAYROLL_RUN_CANCELLED: 'Hủy lần tính lương',
  PAYROLL_EXPORT: 'Xuất bảng lương',
  PAYROLL_PAYMENT_RECORDED: 'Ghi nhận chi trả lương',
  PAYROLL_ADJUSTMENT_UPDATED: 'Sửa khoản điều chỉnh lương',
  PAYROLL_ADJUSTMENT_DELETED: 'Xóa khoản điều chỉnh lương',
  PAYROLL_CONFIGURATION_UPDATED: 'Cập nhật cấu hình lương',
  PAYROLL_CONFIGURATION_DELETED: 'Xóa cấu hình lương',
  PAYROLL_INPUT_UPDATED: 'Cập nhật tham số lương',
  PAYROLL_INPUT_DELETED: 'Xóa tham số lương',
  PAYROLL_SOD_CONFIGURED: 'Cấu hình phân tách nhiệm vụ lương',
  SALARY_GRADE_CREATED: 'Tạo ngạch lương',
  SALARY_GRADE_UPDATED: 'Cập nhật ngạch lương',
  SALARY_GRADE_DELETED: 'Xóa ngạch lương',
  SALARY_STEP_UPDATED: 'Cập nhật bậc lương',
  SALARY_STEP_DELETED: 'Xóa bậc lương',
  ADVANCE_RECOVERY_SCHEDULED: 'Lập lịch thu hồi tạm ứng',
  ADVANCE_RECOVERY_UPDATED: 'Sửa lịch thu hồi tạm ứng',
  ADVANCE_RECOVERY_CANCELLED: 'Hủy lịch thu hồi tạm ứng',
  DEV_MOCK_ATTENDANCE_SEEDED: 'Tạo dữ liệu chấm công mẫu',
  MOCK_FIXTURE_CREATED: 'Tạo dữ liệu mẫu',
  MOCK_PAYROLL_FIXTURE_CREATED: 'Tạo dữ liệu lương mẫu',
};

const WORDS: Record<string, string> = {
  CREATED: 'Tạo',
  UPDATED: 'Cập nhật',
  DELETED: 'Xóa',
  APPROVED: 'Duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Hủy',
  SUBMITTED: 'Gửi',
};

/** Nhãn hành động; hành động mới chưa có trong bảng vẫn đọc được. */
export function auditActionLabel(action: string): string {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const parts = action.split('_');
  const verb = WORDS[parts[parts.length - 1]];
  return verb
    ? `${verb} ${parts.slice(0, -1).join(' ').toLowerCase()}`
    : action.replace(/_/g, ' ').toLowerCase();
}

const emp = (col: string) =>
  `(SELECT ed.employee_code||' · '||ed.full_name FROM hrm_schema.employee_directory ed WHERE ed.tenant_id=a.tenant_id AND ed.employee_id=${col})`;
const vn = (col: string) => `to_char(${col},'DD/MM/YYYY')`;
const range = (from: string, to: string) =>
  `${vn(from)}||CASE WHEN ${to}<>${from} THEN ' - '||${vn(to)} ELSE '' END`;
const kindLabel = (col: string) =>
  `CASE ${col} WHEN 'leave' THEN 'Đơn nghỉ' WHEN 'ot' THEN 'Tăng ca' WHEN 'shift_change' THEN 'Đổi ca' WHEN 'business_trip' THEN 'Công tác' WHEN 'correction' THEN 'Giải trình công' WHEN 'advance' THEN 'Tạm ứng' WHEN 'profile' THEN 'Điều chỉnh hồ sơ' ELSE ${col} END`;

/**
 * Mỗi dòng: [loại đối tượng, bảng, biểu thức nhãn]. entity_id là UUID duy nhất
 * nên tra lần lượt từng bảng, dừng ở bảng đầu tiên khớp.
 */
const ENTITY_SOURCES: [string, string, string][] = [
  ['Nhân viên', 'hrm_schema.employee_directory x', `x.employee_code||' · '||x.full_name`],
  ['Đơn nghỉ phép', 'hrm_schema.leave_requests x', `${emp('x.employee_id')}||' · '||${range('x.from_date', 'x.to_date')}`],
  ['Đơn tăng ca', 'hrm_schema.ot_requests x', `${emp('x.employee_id')}||' · '||${vn('x.work_date')}`],
  ['Đơn công tác', 'hrm_schema.business_trip_requests x', `${emp('x.employee_id')}||' · '||${range('x.from_date', 'x.to_date')}`],
  ['Đơn đổi ca', 'hrm_schema.shift_change_requests x', `${emp('x.employee_id')}||' · '||${range('x.from_date', 'x.to_date')}`],
  ['Giải trình công', 'hrm_schema.attendance_corrections x', `${emp('x.employee_id')}||' · '||${vn('x.request_date')}`],
  ['Đơn tạm ứng lương', 'hrm_schema.salary_advance_requests x', `${emp('x.employee_id')}||' · '||${vn('x.request_date')}`],
  ['Điều chỉnh hồ sơ', 'hrm_schema.profile_corrections x', `${emp('x.employee_id')}`],
  ['Bản nháp đơn', 'hrm_schema.request_drafts x', `${kindLabel('x.request_kind')}||' · '||${emp('x.employee_id')}`],
  ['Liên kết quy trình', 'hrm_schema.procedure_links x', `COALESCE(x.instance_code,'Đang tạo')||' · '||${kindLabel('x.request_kind')}||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Cấu hình quy trình duyệt', 'hrm_schema.request_procedure_bindings x', `${kindLabel('x.request_kind')}||COALESCE(' · '||x.sub_type_code,'')`],
  ['Loại nghỉ', 'hrm_schema.leave_types x', `x.code||' · '||x.name`],
  ['Lịch cộng phép', 'hrm_schema.leave_accrual_schedules x JOIN hrm_schema.leave_types lt ON lt.id=x.leave_type_id', `lt.name||' · từ '||${vn('x.effective_from')}`],
  ['Giao dịch phép', 'hrm_schema.leave_transactions x', `${emp('x.employee_id')}||' · năm '||x.balance_year`],
  ['Quyết toán phép', 'hrm_schema.leave_settlements x', `${emp('x.employee_id')}||' · năm '||x.year`],
  ['Hợp đồng lao động', 'hrm_schema.employment_contracts x', `x.contract_code||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Quyết định nhân sự', 'hrm_schema.personnel_decisions x', `x.decision_no||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Người phụ thuộc', 'hrm_schema.employee_dependents x', `x.full_name||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Thành viên gia đình', 'hrm_schema.employee_family_members x', `x.full_name||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Bằng cấp / chứng chỉ', 'hrm_schema.employee_qualifications x', `x.name||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Tệp đính kèm', 'hrm_schema.attachments x', `x.file_name||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Kỳ lương', 'hrm_schema.payroll_periods x', `x.period_code`],
  ['Lần tính lương', 'hrm_schema.payroll_runs x JOIN hrm_schema.payroll_periods pp ON pp.id=x.payroll_period_id', `pp.period_code||' · lần '||x.run_no`],
  ['Chi trả lương', 'hrm_schema.payroll_employee_totals x', `${emp('x.employee_id')}`],
  ['Khoản lương', 'hrm_schema.payroll_items x', `x.description||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Ngạch lương', 'hrm_schema.salary_grades x', `x.code||' · '||x.name`],
  ['Bậc lương', 'hrm_schema.salary_grade_steps x JOIN hrm_schema.salary_grades sg ON sg.id=x.salary_grade_id', `sg.code||' · bậc '||x.step_no`],
  ['Thu hồi tạm ứng', 'hrm_schema.salary_advance_deductions x JOIN hrm_schema.salary_advance_requests ar ON ar.id=x.advance_request_id', `${emp('ar.employee_id')}||' · đợt '||x.installment_no`],
  ['Kỳ công', 'hrm_schema.timesheet_periods x', `x.period_code`],
  ['Bảng công', 'hrm_schema.timesheets x', `${emp('x.employee_id')}||' · '||${vn('x.work_date')}`],
  ['Ca làm việc', 'hrm_schema.shift_definitions x', `x.code||' · '||x.name`],
  ['Phân ca', 'hrm_schema.shift_assignments x', `${emp('x.employee_id')}||' · từ '||${vn('x.effective_from')}`],
  ['Lịch làm việc', 'hrm_schema.work_calendar x', `${vn('x.work_date')}||' · '||x.name`],
  ['Địa điểm chấm công', 'hrm_schema.attendance_sites x', `x.name`],
  ['Thiết bị chấm công', 'hrm_schema.attendance_devices x', `x.name||COALESCE(' · '||${emp('x.employee_id')},'')`],
  ['Phiên bản chính sách', 'hrm_schema.policy_versions x JOIN hrm_schema.policies po ON po.id=x.policy_id', `po.name||' · v'||x.version_no`],
];

function entityLateral() {
  const branches = ENTITY_SOURCES.map(([kind, from, label]) => {
    const idCol =
      from.startsWith('hrm_schema.employee_directory') ? 'x.employee_id' : 'x.id';
    return `SELECT '${kind}'::text AS kind, (${label})::text AS label FROM ${from} WHERE ${idCol}=a.entity_id`;
  });
  branches.push(
    `SELECT 'Hồ sơ chức danh', n.name::text FROM core_schema.organization_nodes n WHERE n.id=a.entity_id`,
    `SELECT 'Toàn hệ thống', 'Cấu hình chung của doanh nghiệp' WHERE a.entity_id=a.tenant_id`,
  );
  return `LEFT JOIN LATERAL (${branches.join(' UNION ALL ')} LIMIT 1) ent ON a.entity_id IS NOT NULL`;
}

const actorLabel = (col: string, prefix: string) => `CASE
    WHEN ${col} IS NULL THEN NULL
    WHEN ${col}='${HRM_PROCEDURE_SYSTEM_ACTOR_ID}' THEN 'Hệ thống (Procedure Engine)'
    ELSE COALESCE(
      (SELECT ${prefix}.employee_code||' · '||${prefix}.full_name FROM hrm_schema.employee_directory ${prefix} WHERE ${prefix}.tenant_id=a.tenant_id AND (${prefix}.user_id=${col} OR ${prefix}.employee_id=${col}) LIMIT 1),
      (SELECT COALESCE(NULLIF(u.full_name,''),u.email) FROM core_schema.users u WHERE u.id=${col}),
      'Người dùng không còn tồn tại')
  END`;

const APPROVER = `CASE WHEN a.detail->>'approverId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (a.detail->>'approverId')::uuid END`;

/** Loại đối tượng suy từ tiền tố action, dùng khi bản ghi gốc đã bị xóa. */
const ACTION_ENTITY_KIND: [string, string][] = [
  ['LEAVE_SCHEDULE_', 'Lịch cộng phép'],
  ['LEAVE_SETTLE', 'Quyết toán phép'],
  ['LEAVE_TYPE_', 'Loại nghỉ'],
  ['LEAVE_', 'Đơn nghỉ phép'],
  ['REQUEST_DRAFT_', 'Bản nháp đơn'],
  ['CALENDAR_', 'Lịch làm việc'],
  ['HOLIDAY_', 'Lịch làm việc'],
  ['TIMESHEET_PERIOD_', 'Kỳ công'],
  ['TIMESHEET_', 'Bảng công'],
  ['PAYROLL_PERIOD_', 'Kỳ lương'],
  ['PAYROLL_ADJUSTMENT_', 'Khoản lương'],
  ['PAYROLL_CONFIGURATION_', 'Cấu hình lương'],
  ['PAYROLL_INPUT_', 'Tham số lương'],
  ['PAYROLL_', 'Bảng lương'],
  ['SITE_', 'Địa điểm chấm công'],
  ['ROSTER_', 'Phân ca'],
  ['SHIFT_', 'Ca làm việc'],
  ['ADVANCE_RECOVERY_', 'Thu hồi tạm ứng'],
  ['POSITION_PROFILE_', 'Hồ sơ chức danh'],
  ['SALARY_STEP_', 'Bậc lương'],
  ['SALARY_GRADE_', 'Ngạch lương'],
  ['CONTRACT_', 'Hợp đồng lao động'],
  ['PERSONNEL_DECISION_', 'Quyết định nhân sự'],
  ['FAMILY_', 'Thành viên gia đình'],
  ['DEPENDENT_', 'Người phụ thuộc'],
  ['QUALIFICATION_', 'Bằng cấp / chứng chỉ'],
  ['ATTACHMENT_', 'Tệp đính kèm'],
  ['EMPLOYEE_', 'Nhân viên'],
  ['ATTENDANCE_DEVICE_', 'Thiết bị chấm công'],
  ['MOCK_', 'Dữ liệu mẫu'],
  ['DEV_MOCK_', 'Dữ liệu mẫu'],
];

/** Ngày từ ảnh chụp bản ghi (pg serialize date thành nửa đêm giờ VN theo UTC). */
function snapshotDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value.split('-').reverse().join('/');
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null;
}

/** Nhãn dự phòng từ detail.before / detail.after khi bản ghi gốc không còn. */
export function auditFallback(action: string, detail: unknown) {
  const kind =
    ACTION_ENTITY_KIND.find(([prefix]) => action.startsWith(prefix))?.[1] ??
    null;
  const d = (detail && typeof detail === 'object' ? detail : {}) as Record<
    string,
    unknown
  >;
  const snap = (d.before ?? d.after ?? d.previousProfile ?? d) as Record<
    string,
    unknown
  >;
  const name = [
    'name',
    'period_code',
    'contract_code',
    'decision_no',
    'item_code',
    'code',
    'full_name',
    'file_name',
  ]
    .map((k) => snap?.[k])
    .find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const from = snapshotDate(snap?.work_date ?? snap?.from_date ?? snap?.effective_from ?? d.from);
  const to = snapshotDate(snap?.to_date ?? d.to);
  const when = from ? (to && to !== from ? `${from} - ${to}` : from) : null;
  const parts = [name, when].filter(Boolean);
  return {
    kind,
    label: parts.length ? `${parts.join(' · ')} (đã xóa/không còn)` : null,
  };
}

export interface AuditQuery {
  action?: string;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** Nhật ký nghiệp vụ đã phân giải người thực hiện và đối tượng thành tên/mã đọc được. */
export async function listAuditTrail(
  pool: Pool,
  tenantId: string,
  q: AuditQuery,
) {
  const base = `FROM hrm_schema.audit_log a ${entityLateral()}
    WHERE a.tenant_id=$1
      AND ($2::text IS NULL OR a.action=$2)
      AND ($3::date IS NULL OR a.created_at >= $3::date)
      AND ($4::date IS NULL OR a.created_at < $4::date + 1)`;
  const actor = actorLabel('a.actor_id', 'ad');
  const searchable = `($5::text IS NULL OR concat_ws(' ', ent.label, ent.kind, (${actor}), a.detail->>'reason') ILIKE '%'||$5||'%')`;
  const params = [
    tenantId,
    q.action || null,
    q.from || null,
    q.to || null,
    q.search?.trim() || null,
  ];
  const [rows, total, actions] = await Promise.all([
    pool.query(
      `SELECT a.id,a.created_at,a.action,a.entity_type,a.detail,
        ent.kind AS entity_kind, ent.label AS entity_label,
        (a.entity_id IS NOT NULL) AS has_entity,
        ${actor} AS actor_label,
        ${actorLabel(APPROVER, 'pd')} AS approver_label
       ${base} AND ${searchable}
       ORDER BY a.created_at DESC, a.id
       LIMIT $6 OFFSET $7`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    ),
    pool.query(
      `SELECT count(*)::int AS n ${base} AND ${searchable}`,
      params,
    ),
    pool.query(
      `SELECT DISTINCT action FROM hrm_schema.audit_log WHERE tenant_id=$1 ORDER BY action`,
      [tenantId],
    ),
  ]);
  return {
    rows: rows.rows.map((r) => {
      const fallback = r.entity_label
        ? null
        : auditFallback(r.action, r.detail);
      return {
      id: r.id as string,
      createdAt: new Date(r.created_at).toISOString(),
      action: r.action as string,
      actionLabel: auditActionLabel(r.action),
      entityKind:
        (r.entity_kind as string | null) ?? fallback?.kind ?? null,
      entityLabel:
        (r.entity_label as string | null) ??
        fallback?.label ??
        (r.has_entity ? 'Bản ghi đã xóa' : null),
      actorLabel: (r.actor_label as string | null) ?? 'Hệ thống',
      approverLabel: (r.approver_label as string | null) ?? null,
      detail: r.detail ?? null,
      };
    }),
    total: total.rows[0].n as number,
    actions: actions.rows.map((r) => ({
      value: r.action as string,
      label: auditActionLabel(r.action),
    })),
  };
}
