import type { Pool } from 'pg';
import { hrmTransaction } from './hrm-transaction.js';
import { accrueMonth } from './hrm-leave-accrual.js';
import { carryoverYear, expireCarryovers } from './hrm-leave-carryover.js';
import { isoDate } from './hrm-time.js';

/** The common ERP worker calls this; row locks and ledger keys also fence replicas. */
export async function runHrmAutomation(
  pool: Pool,
  tenantId: string,
  force = false,
  now = new Date(),
) {
  try {
    return await hrmTransaction(pool, async (db) => {
      const settings = (
        await db.query(
          `SELECT * FROM hrm_schema.automation_settings WHERE tenant_id=$1 FOR UPDATE SKIP LOCKED`,
          [tenantId],
        )
      ).rows[0];
      if (!settings) {
        // SKIP LOCKED: phân biệt "chưa cấu hình" với "worker khác đang chạy".
        const exists = await db.query(
          `SELECT 1 FROM hrm_schema.automation_settings WHERE tenant_id=$1`,
          [tenantId],
        );
        return {
          skipped: true,
          reason: exists.rowCount ? 'LOCKED' : 'NOT_CONFIGURED',
        };
      }
      if (!settings.enabled && !force)
        return { skipped: true, reason: 'DISABLED' };
      const date = now.toLocaleDateString('en-CA', {
        timeZone: settings.timezone,
      });
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: settings.timezone,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(now),
      );
      if (
        !force &&
        (hour < settings.run_hour ||
          (settings.last_success_date &&
            isoDate(settings.last_success_date) === date) ||
          (settings.last_attempt_at &&
            now.getTime() - new Date(settings.last_attempt_at).getTime() <
              300000))
      )
        return { skipped: true };
      const months: unknown[] = [];
      const cursor = new Date(`${settings.from_month}-01T00:00:00Z`);
      if (
        settings.last_accrual_month &&
        settings.last_accrual_month >= settings.from_month
      ) {
        cursor.setTime(
          Date.parse(`${settings.last_accrual_month}-01T00:00:00Z`),
        );
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      let lastAccrualMonth = settings.last_accrual_month;
      const currentMonth = date.slice(0, 7);
      for (
        let count = 0;
        // Quy tắc cũ: chỉ cộng các tháng đã kết thúc (`< currentMonth`).
        // Quy tắc mới: tháng hiện tại cũng được +1 từ ngày 1.
        count < 24 && cursor.toISOString().slice(0, 7) <= currentMonth;
        count++
      ) {
        const month = cursor.toISOString().slice(0, 7);
        months.push(
          await accrueMonth(db, tenantId, settings.configured_by, month),
        );
        lastAccrualMonth = month;
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const carryovers: unknown[] = [];
      const carryThrough = Math.min(
        Number(date.slice(0, 4)),
        cursor.getUTCFullYear(),
      );
      if (settings.carryover_enabled)
        for (
          let year = Number(settings.from_month.slice(0, 4)) + 1;
          year <= carryThrough;
          year++
        )
          carryovers.push(
            await carryoverYear(
              db,
              tenantId,
              settings.configured_by,
              year,
              date,
            ),
          );
      // Expiry uses a UTC-safe date because its domain command rejects future UTC dates.
      const expiry = await expireCarryovers(
        db,
        tenantId,
        settings.configured_by,
        date < now.toISOString().slice(0, 10)
          ? date
          : now.toISOString().slice(0, 10),
      );
      const credited = (months as { credited?: number }[]).reduce(
        (n, m) => n + (m.credited || 0),
        0,
      );
      const skippedCount = (months as { skipped?: number }[]).reduce(
        (n, m) => n + (m.skipped || 0),
        0,
      );
      const yearEnd = carryovers as Awaited<ReturnType<typeof carryoverYear>>[];
      const carried = yearEnd.reduce((n, c) => n + (c.count || 0), 0);
      const reset = yearEnd.reduce((n, c) => n + (c.reset || 0), 0);
      const blocked = yearEnd.flatMap((c) => c.blocked ?? []);
      const missingContract = [
        ...new Set(
          (months as { missingContract?: string[] }[]).flatMap(
            (m) => m.missingContract ?? [],
          ),
        ),
      ];
      // Mỗi lần chuyển phép ghi hai dòng sổ (năm nguồn và năm đích).
      const summary = {
        createdTransactions:
          credited + carried * 2 + reset + (expiry.count || 0),
        skipped: skippedCount,
        errors: 0,
        reset,
        missingContract: missingContract.length,
        blocked: blocked.length,
      };
      const result = {
        months,
        carryovers,
        expiry,
        summary,
        missingContract,
        blocked,
      };
      const caughtUp = cursor.toISOString().slice(0, 7) >= currentMonth;
      await db.query(
        `UPDATE hrm_schema.automation_settings SET last_success_date=$2,last_attempt_at=$3,last_accrual_month=$4,last_error=NULL WHERE tenant_id=$1`,
        [tenantId, caughtUp ? date : null, now, lastAccrualMonth],
      );
      await db.query(
        `INSERT INTO hrm_schema.automation_runs(tenant_id,finished_at,status,result) VALUES($1,now(),'SUCCEEDED',$2)`,
        [tenantId, JSON.stringify(result)],
      );
      return result;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tác vụ thất bại';
    await hrmTransaction(pool, async (db) => {
      await db.query(
        `UPDATE hrm_schema.automation_settings SET last_attempt_at=$2,last_error=$3 WHERE tenant_id=$1`,
        [tenantId, now, message],
      );
      await db.query(
        `INSERT INTO hrm_schema.automation_runs(tenant_id,finished_at,status,error) VALUES($1,now(),'FAILED',$2)`,
        [tenantId, message],
      );
    });
    throw error;
  }
}
