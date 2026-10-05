import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Phân tách nhiệm vụ lương (SoD). Cấu hình trong hrm_schema.payroll_sod_settings:
 * - separate_calc_finalize: người chốt phải khác người tính.
 * - separate_finalize_publish: người phát hành phiếu lương/ghi nhận chi trả phải khác người chốt.
 * Không có dòng cấu hình = tenant mới = BẬT. Tenant cũ được migration 0026 gán FALSE.
 * Nếu migration 0026 chưa chạy (chưa có bảng) thì bỏ qua hoàn toàn để không làm hỏng luồng lương hiện tại.
 */
export type PayrollSodStep = 'finalize' | 'publish' | 'pay';
export interface PayrollSodSettings {
  separateCalcFinalize: boolean;
  separateFinalizePublish: boolean;
}
export interface PayrollSodRun {
  calculated_by?: string | null;
  finalized_by?: string | null;
}

export const SOD_CODE = 'SEGREGATION_OF_DUTIES';

export async function payrollSodReady(db: Pick<PoolClient, 'query'>) {
  const r = await db.query(
    `SELECT to_regclass('hrm_schema.payroll_sod_settings') IS NOT NULL
       AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema' AND table_name='payroll_runs' AND column_name='calculated_by') AS ready`,
  );
  return r.rows[0]?.ready === true;
}

export async function loadPayrollSod(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
): Promise<PayrollSodSettings> {
  const r = await db.query(
    `SELECT separate_calc_finalize,separate_finalize_publish FROM hrm_schema.payroll_sod_settings WHERE tenant_id=$1`,
    [tenantId],
  );
  const row = r.rows[0];
  return row
    ? {
        separateCalcFinalize: row.separate_calc_finalize === true,
        separateFinalizePublish: row.separate_finalize_publish === true,
      }
    : { separateCalcFinalize: true, separateFinalizePublish: true };
}

/** Thuần: trả thông báo vi phạm hoặc null. Thiếu dữ liệu người thực hiện (dữ liệu cũ) thì không chặn. */
export function payrollSodViolation(
  settings: PayrollSodSettings,
  step: PayrollSodStep,
  actorId: string,
  run: PayrollSodRun,
): string | null {
  if (
    step === 'finalize' &&
    settings.separateCalcFinalize &&
    run.calculated_by &&
    run.calculated_by === actorId
  )
    return 'Người tính lương không được tự chốt cùng lần lương. Cần người khác chốt.';
  if (
    (step === 'publish' || step === 'pay') &&
    settings.separateFinalizePublish &&
    run.finalized_by &&
    run.finalized_by === actorId
  )
    return step === 'publish'
      ? 'Người chốt lương không được tự phát hành phiếu lương. Cần người khác phát hành.'
      : 'Người chốt lương không được tự ghi nhận chi trả. Cần người khác thực hiện.';
  return null;
}

export async function assertPayrollSod(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  runId: string,
  step: PayrollSodStep,
  actorId: string,
) {
  if (!(await payrollSodReady(db))) return;
  const settings = await loadPayrollSod(db, tenantId);
  const run = await db.query(
    `SELECT calculated_by,finalized_by FROM hrm_schema.payroll_runs WHERE tenant_id=$1 AND id=$2`,
    [tenantId, runId],
  );
  const message = payrollSodViolation(settings, step, actorId, run.rows[0] ?? {});
  if (message) throw new ForbiddenException({ code: SOD_CODE, message });
}

export async function recordPayrollActor(
  db: Pick<PoolClient, 'query'>,
  tenantId: string,
  runId: string,
  column: 'calculated_by' | 'published_by',
  actorId: string,
) {
  if (!(await payrollSodReady(db))) return;
  await db.query(
    `UPDATE hrm_schema.payroll_runs SET ${column}=$3 WHERE tenant_id=$1 AND id=$2`,
    [tenantId, runId, actorId],
  );
}
