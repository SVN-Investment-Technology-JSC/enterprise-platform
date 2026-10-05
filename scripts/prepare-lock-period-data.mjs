import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const periodId = '9cbccf5d-3a00-4da6-83a0-adbebfd1575d'; // QA03-LOCK-B (2025-01-03 -> 2025-01-04)
  
  console.log('--- Preparing period QA03-LOCK-B for Lock Period test ---');

  // 1. Cập nhật các dòng ABNORMAL thành NORMAL hoặc ADJUSTED
  const updateTimesheets = await client.query(`
    UPDATE hrm_schema.timesheets
    SET status = 'ADJUSTED',
        is_manually_adjusted = true,
        adjusted_reason = 'Dữ liệu chuẩn hóa phục vụ kiểm thử khóa kỳ',
        worked_minutes = CASE WHEN worked_minutes = 0 THEN 480 ELSE worked_minutes END,
        workday_units = CASE WHEN workday_units = 0 THEN 1.0 ELSE workday_units END,
        paid_minutes = CASE WHEN paid_minutes = 0 THEN 480 ELSE paid_minutes END,
        updated_at = NOW()
    WHERE period_id = $1
    RETURNING id
  `, [periodId]);
  console.log(`Updated ${updateTimesheets.rowCount} timesheet rows to ADJUSTED.`);

  // 2. Đảm bảo kỳ công ở trạng thái OPEN, calculated_at = NOW(), và chưa bị lock
  await client.query(`
    UPDATE hrm_schema.timesheet_periods
    SET status = 'OPEN',
        calculated_at = NOW(),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [periodId]);
  console.log(`Period ${periodId} is reset to OPEN with calculated_at set.`);

  // 3. Tạo thêm một kỳ công chuẩn tháng 8/2026: BC-TEST-2026-08 (2026-08-01 -> 2026-08-31)
  const tenantRes = await client.query('SELECT tenant_id FROM hrm_schema.timesheet_periods WHERE id = $1', [periodId]);
  const tenantId = tenantRes.rows[0]?.tenant_id;

  const existingAug = await client.query('SELECT id FROM hrm_schema.timesheet_periods WHERE period_code = $1', ['BC-TEST-2026-08']);
  let augPeriodId = existingAug.rows[0]?.id;

  if (!augPeriodId) {
    const insertRes = await client.query(`
      INSERT INTO hrm_schema.timesheet_periods (
        tenant_id, period_code, from_date, to_date, status, calculated_at
      ) VALUES (
        $1, 'BC-TEST-2026-08', '2026-08-01', '2026-08-31', 'OPEN', NOW()
      ) RETURNING id
    `, [tenantId]);
    augPeriodId = insertRes.rows[0].id;
    console.log(`Created new clean test period BC-TEST-2026-08 (${augPeriodId})`);

    // Clone timesheets from existing employees into this period
    const empRows = await client.query('SELECT DISTINCT employee_id FROM hrm_schema.timesheets WHERE period_id = $1 LIMIT 5', [periodId]);
    for (const emp of empRows.rows) {
      await client.query(`
        INSERT INTO hrm_schema.timesheets (
          tenant_id, employee_id, period_id, work_date, scheduled_minutes, worked_minutes,
          paid_minutes, workday_units, ot_minutes, late_minutes, early_leave_minutes,
          status, is_manually_adjusted, adjusted_reason
        ) VALUES (
          $1, $2, $3, '2026-08-15', 480, 480, 480, 1.0, 0, 0, 0,
          'NORMAL', false, NULL
        )
      `, [tenantId, emp.employee_id, augPeriodId]);
    }
    console.log(`Seeded normal timesheet rows for BC-TEST-2026-08`);
  } else {
    await client.query(`
      UPDATE hrm_schema.timesheet_periods
      SET status = 'OPEN', calculated_at = NOW(), locked_by = NULL, locked_at = NULL
      WHERE id = $1
    `, [augPeriodId]);
    await client.query(`
      UPDATE hrm_schema.timesheets
      SET status = 'NORMAL'
      WHERE period_id = $1
    `, [augPeriodId]);
    console.log(`Reset BC-TEST-2026-08 to OPEN and NORMAL`);
  }

  // 4. Kiểm tra lại điều kiện Lock của cả 2 kỳ
  const checkPeriods = [periodId, augPeriodId];
  for (const pid of checkPeriods) {
    const p = (await client.query('SELECT * FROM hrm_schema.timesheet_periods WHERE id = $1', [pid])).rows[0];
    const ready = await client.query(
      `SELECT $2::date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS ended, EXISTS(SELECT 1 FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$3) AS has_lines`,
      [p.tenant_id, p.to_date, p.id]
    );
    const abnormal = await client.query(
      `SELECT count(*)::int as cnt FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND status='ABNORMAL'`,
      [p.tenant_id, p.id]
    );
    const pending = await client.query(
      `SELECT count(*)::int as cnt FROM (
        SELECT id FROM hrm_schema.attendance_corrections WHERE tenant_id=$1 AND status='PENDING' AND request_date BETWEEN $2 AND $3 
        UNION ALL SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 
        UNION ALL SELECT id FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND status='PENDING' AND work_date BETWEEN $2 AND $3 
        UNION ALL SELECT id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND status='PENDING' AND from_date<=$3 AND to_date>=$2 
        UNION ALL SELECT id FROM hrm_schema.shift_change_requests WHERE tenant_id=$1 AND status IN ('PENDING','PEER_CONFIRMED') AND from_date<=$3 AND to_date>=$2
      ) t`,
      [p.tenant_id, p.from_date, p.to_date]
    );

    console.log(`\nValidation for ${p.period_code}:`, {
      ended: ready.rows[0].ended,
      has_lines: ready.rows[0].has_lines,
      calculated_at: p.calculated_at ? true : false,
      abnormal_count: abnormal.rows[0].cnt,
      pending_requests: pending.rows[0].cnt,
      CAN_LOCK_NOW: ready.rows[0].ended && ready.rows[0].has_lines && !!p.calculated_at && abnormal.rows[0].cnt === 0 && pending.rows[0].cnt === 0
    });
  }

  await client.end();
}

run().catch(console.error);
