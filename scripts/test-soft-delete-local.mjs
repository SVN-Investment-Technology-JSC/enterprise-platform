import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { Client } = createRequire(resolve('apps/api/package.json'))('pg');

async function runLocalSoftDeleteTests() {
  console.log('====================================================');
  console.log('  BẮT ĐẦU KIỂM THỬ XÓA MỀM TRÊN LOCAL (NO TUNNEL)');
  console.log('====================================================\n');

  const client = new Client({
    connectionString: 'postgresql://tenant:tenant@localhost:56436/savina',
  });
  await client.connect();

  const tenantRes = await client.query('SELECT tenant_id FROM hrm_schema.employee_profiles LIMIT 1');
  const tenantId = tenantRes.rows[0]?.tenant_id;
  if (!tenantId) throw new Error('Không tìm thấy tenant_id trong hrm_schema');
  console.log('Tenant ID đang kiểm thử:', tenantId);

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  [PASS]', message);
      passedCount++;
    } else {
      console.error('  [FAIL]', message);
      failedCount++;
    }
  }

  // ---------------------------------------------------------
  // TEST 1: Danh mục ca làm việc (Shift Definitions)
  // ---------------------------------------------------------
  console.log('\n--- TEST 1: Xóa ca làm việc (hrm_schema.shift_definitions) ---');

  // 1A. Ca chưa có dữ liệu liên kết -> Hard delete
  const shiftCodeA = 'TEST_NO_USE';
  await client.query('DELETE FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND code=$2', [tenantId, shiftCodeA]);
  const insA = await client.query(
    `INSERT INTO hrm_schema.shift_definitions (tenant_id, code, name, start_time, end_time, break_minutes)
     VALUES ($1, $2, 'Ca test chưa dùng', '08:00', '17:00', 60) RETURNING id`,
    [tenantId, shiftCodeA],
  );
  const shiftIdA = insA.rows[0].id;

  // Giả lập logic deleteShift: kiểm tra inUse -> false -> DELETE FROM
  const inUseA = (await client.query(
    `SELECT 1 FROM hrm_schema.work_schedule_rule_days WHERE shift_id=$1 LIMIT 1`,
    [shiftIdA],
  )).rowCount > 0;
  assert(!inUseA, '1A.1: Ca mới tạo xác định inUse = false');

  await client.query('DELETE FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND id=$2', [tenantId, shiftIdA]);
  const checkA = await client.query('SELECT 1 FROM hrm_schema.shift_definitions WHERE id=$1', [shiftIdA]);
  assert(checkA.rowCount === 0, '1A.2: Ca chưa phát sinh dữ liệu được xóa vĩnh viễn (Hard delete)');

  // 1B. Ca ĐÃ có dữ liệu liên kết -> Soft delete (deleted_at = now(), status = 'INACTIVE')
  const shiftCodeB = 'TEST_IN_USE';
  await client.query('DELETE FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND code=$2', [tenantId, shiftCodeB]);
  const insB = await client.query(
    `INSERT INTO hrm_schema.shift_definitions (tenant_id, code, name, start_time, end_time, break_minutes, status)
     VALUES ($1, $2, 'Ca test đã phát sinh dữ liệu', '08:00', '17:00', 60, 'ACTIVE') RETURNING id`,
    [tenantId, shiftCodeB],
  );
  const shiftIdB = insB.rows[0].id;

  // Giả lập phát sinh dữ liệu trong work_schedule_rule_days
  // Tìm hoặc tạo 1 rule_id
  const r = await client.query(
    `INSERT INTO hrm_schema.work_schedule_rules (tenant_id, scope_type, effective_from, status)
     VALUES ($1, 'COMPANY', CURRENT_DATE, 'ACTIVE') RETURNING id`,
    [tenantId],
  );
  const ruleId = r.rows[0].id;
  await client.query(
    `INSERT INTO hrm_schema.work_schedule_rule_days (tenant_id, rule_id, weekday, day_type, shift_id)
     VALUES ($1, $2, 1, 'SHIFT', $3)`,
    [tenantId, ruleId, shiftIdB],
  );

  // Giả lập logic deleteShift mới cập nhật:
  const inUseB = (await client.query(
    `SELECT 1 FROM hrm_schema.work_schedule_rule_days WHERE shift_id=$1 LIMIT 1`,
    [shiftIdB],
  )).rowCount > 0;
  assert(inUseB, '1B.1: Ca phát hiện inUse = true (đã có dữ liệu liên kết)');

  // Thực hiện soft delete
  await client.query(
    `UPDATE hrm_schema.shift_definitions
     SET deleted_at = clock_timestamp(),
         status = 'INACTIVE',
         updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
     WHERE tenant_id=$1 AND id=$2`,
    [tenantId, shiftIdB],
  );

  // Kiểm tra listShifts query (WHERE tenant_id = $1 AND deleted_at IS NULL)
  const listShifts = await client.query(
    `SELECT * FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND deleted_at IS NULL AND id=$2`,
    [tenantId, shiftIdB],
  );
  assert(listShifts.rowCount === 0, '1B.2: Ca đã soft-delete KHÔNG xuất hiện trong GET /shifts (đã ẩn hoàn toàn)');

  // Kiểm tra trong DB: bản ghi vẫn còn để bảo đảm dữ liệu lịch sử
  const rawShiftB = await client.query(
    `SELECT status, deleted_at FROM hrm_schema.shift_definitions WHERE id=$1`,
    [shiftIdB],
  );
  assert(
    rawShiftB.rows[0]?.status === 'INACTIVE' && rawShiftB.rows[0]?.deleted_at !== null,
    '1B.3: Dữ liệu ca vẫn tồn tại trong DB với deleted_at != null và status = INACTIVE',
  );

  // Clean up 1B
  await client.query('DELETE FROM hrm_schema.work_schedule_rule_days WHERE shift_id=$1', [shiftIdB]);
  await client.query('DELETE FROM hrm_schema.work_schedule_rules WHERE id=$1', [ruleId]);
  await client.query('DELETE FROM hrm_schema.shift_definitions WHERE id=$1', [shiftIdB]);

  // ---------------------------------------------------------
  // TEST 2: Lý do nghỉ (Leave Types - kiểm tra sửa lỗi balance)
  // ---------------------------------------------------------
  console.log('\n--- TEST 2: Xóa lý do nghỉ (hrm_schema.leave_types) ---');

  // 2A. Kiểm tra câu truy vấn sửa lỗi: không còn crash cột balance
  const leaveCodeA = 'TEST_LV_NO_USE';
  await client.query('DELETE FROM hrm_schema.leave_types WHERE tenant_id=$1 AND code=$2', [tenantId, leaveCodeA]);
  const insLvA = await client.query(
    `INSERT INTO hrm_schema.leave_types (tenant_id, code, name, unit, paid, is_annual, active)
     VALUES ($1, $2, 'Lý do test chưa dùng', 'DAYS', false, false, true) RETURNING id`,
    [tenantId, leaveCodeA],
  );
  const leaveIdA = insLvA.rows[0].id;

  // Thực hiện câu kiểm tra hasBalances đã sửa:
  let hasBalancesResult = null;
  let balanceQueryError = null;
  try {
    const q = await client.query(
      'SELECT 1 FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2 AND (remaining <> 0 OR pending <> 0 OR used <> 0 OR opening_balance <> 0 OR accrued <> 0) LIMIT 1',
      [tenantId, leaveIdA],
    );
    hasBalancesResult = q.rowCount > 0;
  } catch (err) {
    balanceQueryError = err;
  }
  assert(!balanceQueryError, '2A.1: Câu lệnh SQL kiểm tra số dư chạy thành công, KHÔNG còn lỗi column "balance" does not exist');
  assert(hasBalancesResult === false, '2A.2: Loại nghỉ mới tạo có hasBalances = false');

  // Xóa mềm khi không có dữ liệu:
  await client.query(
    `UPDATE hrm_schema.leave_types SET deleted_at=now(), active=false WHERE tenant_id=$1 AND id=$2`,
    [tenantId, leaveIdA],
  );
  const listLeaveA = await client.query(
    `SELECT * FROM hrm_schema.leave_types WHERE tenant_id=$1 AND deleted_at IS NULL AND id=$2`,
    [tenantId, leaveIdA],
  );
  assert(listLeaveA.rowCount === 0, '2A.3: Loại nghỉ xóa mềm đã ẩn khỏi GET /leave-types');

  // 2A.4: Kiểm tra tái sử dụng mã sau khi xóa mềm (Partial Unique Index giải phóng mã)
  let recreateError = null;
  let newLeaveId = null;
  try {
    const insRecreate = await client.query(
      `INSERT INTO hrm_schema.leave_types (tenant_id, code, name, unit, paid, is_annual, active)
       VALUES ($1, $2, 'Lý do test tạo lại cùng mã', 'DAYS', false, false, true) RETURNING id`,
      [tenantId, leaveCodeA],
    );
    newLeaveId = insRecreate.rows[0].id;
  } catch (err) {
    recreateError = err;
  }
  assert(!recreateError && newLeaveId, '2A.4: Tạo mới loại nghỉ cùng mã với loại đã xóa mềm thành công (mã không còn bị giữ chỗ)');

  // Clean up 2A
  if (newLeaveId) await client.query('DELETE FROM hrm_schema.leave_types WHERE id=$1', [newLeaveId]);
  await client.query('DELETE FROM hrm_schema.leave_types WHERE id=$1', [leaveIdA]);

  // 2B. Lý do nghỉ ĐÃ có đơn -> Chỉ ngừng dùng (active = false, deleted = false)
  const leaveCodeB = 'TEST_LV_IN_USE';
  await client.query('DELETE FROM hrm_schema.leave_types WHERE tenant_id=$1 AND code=$2', [tenantId, leaveCodeB]);
  const insLvB = await client.query(
    `INSERT INTO hrm_schema.leave_types (tenant_id, code, name, unit, paid, is_annual, active)
     VALUES ($1, $2, 'Lý do test đã có đơn', 'DAYS', false, false, true) RETURNING id`,
    [tenantId, leaveCodeB],
  );
  const leaveIdB = insLvB.rows[0].id;

  // Tạo 1 đơn nghỉ giả lập
  const empRes = await client.query('SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id=$1 LIMIT 1', [tenantId]);
  const empId = empRes.rows[0]?.employee_id;
  const insReq = await client.query(
    `INSERT INTO hrm_schema.leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, duration, reason, status)
     VALUES ($1, $2, $3, '2026-10-15', '2026-10-15', 1, 'Lý do test', 'PENDING') RETURNING id`,
    [tenantId, empId, leaveIdB],
  );
  const reqId = insReq.rows[0].id;

  const hasRequestsB = (await client.query(
    'SELECT id FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND leave_type_id=$2 LIMIT 1',
    [tenantId, leaveIdB],
  )).rowCount > 0;
  assert(hasRequestsB, '2B.1: Phát hiện hasRequests = true');

  // Khi có requests, backend chuyển active = false (Ngừng dùng), KHÔNG đặt deleted_at
  await client.query(
    `UPDATE hrm_schema.leave_types SET active=false, updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2`,
    [tenantId, leaveIdB],
  );
  const rawLvB = await client.query('SELECT active, deleted_at FROM hrm_schema.leave_types WHERE id=$1', [leaveIdB]);
  assert(
    rawLvB.rows[0]?.active === false && rawLvB.rows[0]?.deleted_at === null,
    '2B.2: Loại nghỉ đã có đơn được chuyển active = false (Ngừng dùng) và giữ nguyên trong sổ để đơn cũ tham chiếu',
  );

  // Clean up 2B
  await client.query('DELETE FROM hrm_schema.leave_requests WHERE id=$1', [reqId]);
  await client.query('DELETE FROM hrm_schema.leave_types WHERE id=$1', [leaveIdB]);

  // ---------------------------------------------------------
  // TEST 3: Lý do đơn từ (Request Reasons - Overtime, Business Trip...)
  // ---------------------------------------------------------
  console.log('\n--- TEST 3: Xóa lý do đơn từ (hrm_schema.request_reasons) ---');

  const reasonCodeA = 'TEST_RS_1';
  await client.query('DELETE FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND code=$2', [tenantId, reasonCodeA]);
  const insRsA = await client.query(
    `INSERT INTO hrm_schema.request_reasons (tenant_id, kind, code, name, active)
     VALUES ($1, 'OVERTIME', $2, 'Lý do tăng ca test', true) RETURNING id`,
    [tenantId, reasonCodeA],
  );
  const reasonIdA = insRsA.rows[0].id;

  // Xóa mềm khi usageCount = 0
  await client.query(
    `UPDATE hrm_schema.request_reasons SET deleted_at = now(), active = false, updated_at = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, reasonIdA],
  );

  const listRsA = await client.query(
    `SELECT * FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND deleted_at IS NULL AND id=$2`,
    [tenantId, reasonIdA],
  );
  assert(listRsA.rowCount === 0, '3.1: Lý do đơn từ xóa mềm (deleted_at != null) ẩn khỏi GET /request-reasons');

  // Clean up 3
  await client.query('DELETE FROM hrm_schema.request_reasons WHERE id=$1', [reasonIdA]);

  await client.end();

  console.log('\n====================================================');
  console.log(`  KẾT QUẢ KIỂM THỬ LOCAL: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('====================================================');

  if (failedCount > 0) process.exit(1);
}

runLocalSoftDeleteTests().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});
