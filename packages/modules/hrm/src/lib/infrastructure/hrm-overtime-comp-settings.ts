import type {
  HrmOvertimeCompConfig,
  HrmOvertimeCompSettings,
  HrmOvertimeCompVersionSummary,
  SaveHrmOvertimeCompSettingsRequest,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  overtimeCompLegalWarnings,
  parseOvertimeCompPolicy,
  validateOvertimeCompPolicy,
} from '../domain/overtime-comp-policy.js';
import { ensureCompOffLeaveType } from './hrm-comp-off.js';
import { publishPolicyVersion, versionEmployeeIds } from './hrm-policy-versions.js';
import { isoDate, resolvePolicy } from './hrm-time.js';
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
  const base = await resolvePolicy(db, tenant, 'OT', effectiveFrom);
  if (!base)
    throw new BadRequestException(
      'Cần cấu hình tăng ca (giới hạn giờ và hệ số) trước khi cấu hình quy tắc làm thêm và nghỉ bù',
    );
  const previous = (base.config_json.overtimeComp ?? {}) as Record<string, unknown>;
  const merged = { ...previous, ...body.config };
  const next = parseOvertimeCompPolicy({ ...base.config_json, overtimeComp: merged });
  // Giữ các khóa người dùng đặt; khóa không gửi lấy từ phiên bản trước hoặc mặc định khi đọc.
  await publishPolicyVersion(db, tenant, 'OT', {
    effectiveFrom,
    config: { overtimeComp: merged },
    reason,
    actorId: actor,
    defaultCode: 'OT_DEFAULT',
    defaultName: 'Quy định tăng ca',
    inherit: true,
    touchUpdatedAt: true,
  });
  if (next.enabled) await ensureCompOffLeaveType(db, tenant);
  return readOvertimeCompSettings(db, tenant, effectiveFrom);
}
