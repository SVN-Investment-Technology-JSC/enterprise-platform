import type {
  HrmOvertimeCompConfig,
  HrmOvertimeCompSettings,
  HrmOvertimeCompVersionSummary,
  SaveHrmOvertimeCompSettingsRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { assertLifecycleVersion, lifecycleAudit, timestamp } from './hrm-lifecycle.js';
import {
  overtimeCompLegalWarnings,
  parseOvertimeCompPolicy,
  validateOvertimeCompPolicy,
} from '../domain/overtime-comp-policy.js';
import { ensureCompOffLeaveType } from './hrm-comp-off.js';
import {
  isPublishConflictMode,
  lockPolicyType,
  publishPolicyVersion,
  reopenPreviousVersion,
  todayInVietnam,
  versionEmployeeIds,
} from './hrm-policy-versions.js';
import { assertOpenRange, isoDate, resolvePolicy } from './hrm-time.js';
import { requireDate } from './hrm-validation.js';

type Db = Pick<PoolClient, 'query'>;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

function summaryOf(row: Record<string, any>): HrmOvertimeCompVersionSummary {
  return {
    id: row.id,
    versionNo: Number(row.version_no),
    effectiveFrom: isoDate(row.effective_from),
    effectiveTo: row.effective_to ? isoDate(row.effective_to) : null,
    status: row.status,
    updatedAt: timestamp(row.updated_at),
    config: parseOvertimeCompPolicy(row.config_json) as HrmOvertimeCompConfig,
  };
}

/**
 * Cấu hình làm thêm và nghỉ bù: phiên bản hiệu lực tại `asOf` (mặc định hôm nay) và lịch sử các phiên bản chính sách OT
 * áp dụng cho cả công ty (bỏ qua phiên bản riêng cho từng nhân viên).
 */
export async function readOvertimeCompSettings(db: Db, tenant: string, asOf: string = today()): Promise<HrmOvertimeCompSettings> {
  const versions = await db.query(
    `SELECT v.*,p.id AS policy_id FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
      WHERE p.tenant_id=$1 AND p.policy_type='OT' AND p.status='ACTIVE' AND v.status IN ('ACTIVE','SUPERSEDED')
      ORDER BY v.effective_from DESC,v.version_no DESC`,
    [tenant],
  );
  const company = versions.rows.filter((r) => versionEmployeeIds(r.config_json).length === 0);
  const current = (await resolvePolicy(db as PoolClient, tenant, 'OT', asOf)) ?? null;
  const currentRow = current ? company.find((r) => r.id === current.id) : undefined;
  const summary = currentRow ? summaryOf(currentRow) : null;
  return {
    policyId: (company[0]?.policy_id as string | undefined) ?? null,
    current: summary,
    versions: company.map(summaryOf),
    legalWarnings: summary ? overtimeCompLegalWarnings(parseOvertimeCompPolicy(currentRow?.config_json)) : [],
  };
}

/**
 * Tạo phiên bản mới của chính sách OT chỉ thay nhóm `overtimeComp` (các giới hạn và hệ số khác giữ từ phiên bản đang hiệu lực).
 * Hiệu lực từ mùng 1 của một tháng chưa chốt công và chưa vào kỳ lương đã chốt. Bật quy tắc thì bảo đảm tenant có loại nghỉ "Nghỉ bù".
 */
export async function saveOvertimeCompSettings(
  db: PoolClient,
  tenant: string,
  actor: string,
  body: SaveHrmOvertimeCompSettingsRequest,
): Promise<HrmOvertimeCompSettings> {
  const effectiveFrom = requireDate(body.effectiveFrom, 'effectiveFrom');
  if (!effectiveFrom.endsWith('-01'))
    throw new BadRequestException('Chính sách làm thêm và nghỉ bù chỉ có hiệu lực từ mùng 1 của một tháng');
  const invalid = validateOvertimeCompPolicy(body.config ?? {});
  if (invalid) throw new BadRequestException(invalid);
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new BadRequestException('Cần nhập lý do khi đổi chính sách');
  if (reason.length > 2000) throw new BadRequestException('Lý do tối đa 2000 ký tự');
  const onConflict = body.onConflict ?? 'REPORT';
  if (!isPublishConflictMode(onConflict)) throw new BadRequestException('Cách xử lý khi giao với phiên bản đã có không hợp lệ');
  const base = await resolvePolicy(db, tenant, 'OT', effectiveFrom);
  if (!base)
    throw new BadRequestException(
      'Cần cấu hình tăng ca (giới hạn giờ và hệ số) trước khi cấu hình quy tắc làm thêm và nghỉ bù',
    );
  const previous = (base.config_json.overtimeComp ?? {}) as Record<string, unknown>;
  const merged = { ...previous, ...body.config };
  const next = parseOvertimeCompPolicy({ ...base.config_json, overtimeComp: merged });
  // Giữ các khóa người dùng đặt; khóa không gửi lấy từ phiên bản trước hoặc mặc định khi đọc.
  const published = await publishPolicyVersion(db, tenant, 'OT', {
    effectiveFrom,
    config: { overtimeComp: merged },
    reason,
    actorId: actor,
    defaultCode: 'OT_DEFAULT',
    defaultName: 'Quy định tăng ca',
    inherit: true,
    onConflict,
    touchUpdatedAt: true,
  });
  // Nhật ký riêng của quỹ nghỉ bù để Lịch sử thay đổi lọc đúng nhóm này (POLICY_VERSION_PUBLISHED dùng chung cho mọi chính sách).
  await lifecycleAudit(db, tenant, actor, 'OVERTIME_COMP_SETTINGS_SAVED', published.version.id, {
    reason,
    effectiveFrom,
    enabled: next.enabled,
    ruleSet: next.ruleSet,
    onConflict,
    closed: published.closed,
    replaced: published.replaced,
  });
  if (next.enabled) await ensureCompOffLeaveType(db, tenant);
  return readOvertimeCompSettings(db, tenant, effectiveFrom);
}

/**
 * Xóa phiên bản chính sách làm thêm và nghỉ bù chưa có hiệu lực. Cùng luật với màn Lương và OT: chỉ xóa phiên bản mới nhất
 * chưa hiệu lực, chưa có dữ liệu công, đơn làm thêm, phép hay lương tham chiếu; phiên bản liền trước được mở lại.
 * Cần `expectedUpdatedAt` của bản ghi vừa tải để không xóa nhầm khi người khác vừa đổi.
 */
export async function removeOvertimeCompVersion(
  db: PoolClient,
  tenant: string,
  actor: string,
  id: string,
  body: { reason?: unknown; expectedUpdatedAt?: unknown },
): Promise<HrmOvertimeCompSettings> {
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new BadRequestException('Cần nhập lý do khi xóa phiên bản');
  if (reason.length > 2000) throw new BadRequestException('Lý do tối đa 2000 ký tự');
  await lockPolicyType(db, tenant, 'OT');
  const found = await db.query(
    `SELECT v.* FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id
      WHERE p.tenant_id=$1 AND p.policy_type='OT' AND v.id=$2 FOR UPDATE OF v`,
    [tenant, id],
  );
  const row = found.rows[0];
  if (!row || versionEmployeeIds(row.config_json).length) throw new NotFoundException('Không tìm thấy phiên bản làm thêm và nghỉ bù');
  assertLifecycleVersion(row, body.expectedUpdatedAt);
  const used = await db.query(
    `SELECT EXISTS(SELECT 1 FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND policy_version_id=$2)
         OR EXISTS(SELECT 1 FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND policy_version_id=$2)
         OR EXISTS(SELECT 1 FROM hrm_schema.leave_accrual_schedules WHERE tenant_id=$1 AND policy_version_id=$2)
         OR EXISTS(SELECT 1 FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND policy_version_id=$2) AS used`,
    [tenant, id],
  );
  if (used.rows[0].used)
    throw new ConflictException('Phiên bản đã được dữ liệu công, đơn làm thêm, phép hoặc lương tham chiếu; tạo phiên bản tiếp theo để giữ lịch sử');
  const target = {
    ...row,
    effective_from: isoDate(row.effective_from),
    effective_to: row.effective_to ? isoDate(row.effective_to) : null,
  };
  await assertOpenRange(db, tenant, target.effective_from, target.effective_to);
  const reopened = await reopenPreviousVersion(db, tenant, 'OT', target, todayInVietnam());
  await db.query('DELETE FROM hrm_schema.policy_versions WHERE id=$1', [id]);
  await lifecycleAudit(db, tenant, actor, 'OVERTIME_COMP_VERSION_REMOVED', id, {
    reason,
    versionNo: row.version_no,
    effectiveFrom: target.effective_from,
    reopenedVersionId: reopened?.id ?? null,
  });
  return readOvertimeCompSettings(db, tenant);
}
