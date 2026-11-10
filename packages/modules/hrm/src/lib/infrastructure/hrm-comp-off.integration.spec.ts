import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  adjustCompOff,
  compOffAvailability,
  compOffDetail,
  confirmCompOffConversion,
  expireCompOffLots,
  listCompOffBalances,
  previewCompOffConversion,
} from './hrm-comp-off.js';
import { approveOvertime, createOvertime } from './hrm-overtime.js';
import { createLeave, transitionLeave } from './hrm-leave-operations.js';
import {
  listOvertimeBlocks,
  overrideOvertimeBlock,
  previewOvertimeClassification,
  removeOvertimeBlocks,
} from './hrm-overtime-blocks.js';
import { readOvertimeCompSettings, saveOvertimeCompSettings } from './hrm-overtime-comp-settings.js';
import {
  clearOvertimeCompSnapshot,
  payrollOvertimeInputs,
  readOvertimeCompSnapshot,
  snapshotOvertimeComp,
} from './hrm-overtime-month.js';
import { publishPolicyVersion } from './hrm-policy-versions.js';
import { lockEmployee } from './hrm-time.js';
import { hrmTransaction } from './hrm-transaction.js';

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/**
 * Luồng đầu cuối của quỹ nghỉ bù trên PostgreSQL thật: đơn làm thêm duyệt -> ca phân loại -> chốt tháng (ảnh chụp chính sách)
 * -> chuyển đổi giờ dư thành ngày nghỉ bù -> đơn nghỉ bù giữ chỗ, duyệt, hủy -> điều chỉnh, hết hạn.
 * Chính sách thử dùng trần tháng 10 giờ để dữ liệu nhỏ.
 */
integration('HRM quỹ nghỉ bù: PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const actor = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let shiftId: string;
  let e1: string;
  let e2: string;
  let compTypeId: string;

  const employee = async (code: string) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, full_name, work_email) VALUES ($1,$2,$3,$4)`, [
      id,
      tenantId,
      code,
      `${id}@test.local`,
    ]);
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2010-01-01')`,
      [id, tenantId, code],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
       SELECT $1,$2,d::date,'SHIFT',$3,'MANUAL' FROM generate_series('2025-01-01'::date,'2027-12-31'::date,'1 day') d`,
      [tenantId, id, shiftId],
    );
    return id;
  };
  const tx = <T>(work: Parameters<typeof hrmTransaction<T>>[1]) => hrmTransaction(pool, work);
  const ledger = async (employeeId: string) =>
    (
      await pool.query(
        `SELECT kind,days::float AS days,lot_id,request_id,idempotency_key FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at,id`,
        [tenantId, employeeId],
      )
    ).rows;
  const ot = async (employeeId: string, workDate: string, start: string, end: string, minutes: number, nextDayRest?: 'HALF' | 'FULL') => {
    const created = await tx((db) =>
      createOvertime(db, tenantId, { employeeId, workDate, startTime: start, endTime: end, plannedMinutes: minutes, nextDayRest }),
    );
    return tx((db) => approveOvertime(db, tenantId, actor, created.id));
  };

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const registry = await readFile(resolve(process.cwd(), '../../platform/entitlement/src/lib/tenant-migrations.ts'), 'utf8');
    const registered = [...registry.matchAll(/path:\s*'tenant\/((?:core|hrm)\/[^']+\.sql)'/g)].map((m) => m[1]);
    for (const path of [
      ...registered.filter((f) => f.startsWith('core/')),
      '0001-integration.sql',
      ...registered.filter((f) => f.startsWith('hrm/')),
    ]) {
      const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant', path), 'utf8');
      await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
    }
    shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0) RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    e1 = await employee('NV-A');
    e2 = await employee('NV-B');
    // Chính sách OT nền (giới hạn rất rộng, hệ số hợp lệ); quy tắc nghỉ bù chưa bật.
    await tx((db) =>
      publishPolicyVersion(db, tenantId, 'OT', {
        effectiveFrom: '2026-01-01',
        config: {
          dailyLimitMinutes: 1440,
          weeklyLimitMinutes: 10080,
          monthlyLimitMinutes: 44640,
          yearlyLimitMinutes: 527040,
          weekdayRate: 1.5,
          offRate: 2,
          holidayRate: 3,
          nightRate: 2,
        },
        reason: 'Thiết lập thử',
        actorId: actor,
        defaultCode: 'OT_DEFAULT',
        defaultName: 'Quy định tăng ca',
      }),
    );
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid DB');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  it('cấu hình: ngày hiệu lực phải là mùng 1, cần lý do; lưu thì tạo phiên bản mới và loại nghỉ "Nghỉ bù"', async () => {
    const config = { enabled: true, ruleSet: 'NIGHT_REST' as const, monthlyCapHours: 10, yearlyCapHours: 200, accrualMonthOffset: 1 as const };
    await expect(tx((db) => saveOvertimeCompSettings(db, tenantId, actor, { effectiveFrom: '2026-09-15', config, reason: 'x' }))).rejects.toThrow('mùng 1');
    await expect(tx((db) => saveOvertimeCompSettings(db, tenantId, actor, { effectiveFrom: '2026-09-01', config, reason: ' ' }))).rejects.toThrow('lý do');
    await expect(
      tx((db) => saveOvertimeCompSettings(db, tenantId, actor, { effectiveFrom: '2026-09-01', config: { monthlyCapHours: -1 }, reason: 'x' })),
    ).rejects.toThrow('Trần làm thêm theo tháng');
    const saved = await tx((db) => saveOvertimeCompSettings(db, tenantId, actor, { effectiveFrom: '2026-09-01', config, reason: 'Bật quy tắc cho Savina' }));
    expect(saved.current?.config).toMatchObject({ enabled: true, ruleSet: 'NIGHT_REST', monthlyCapHours: 10, compFactor: 1.5 });
    expect(saved.versions.length).toBeGreaterThanOrEqual(2);
    const type = await pool.query(`SELECT id,paid,deduct_balance,comp_off FROM hrm_schema.leave_types WHERE tenant_id=$1 AND comp_off`, [tenantId]);
    expect(type.rows).toHaveLength(1);
    expect(type.rows[0]).toMatchObject({ paid: true, deduct_balance: false });
    compTypeId = type.rows[0].id;
    // Các khóa chính sách OT khác (giới hạn, hệ số) được giữ nguyên.
    const kept = await pool.query(
      `SELECT v.config_json FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND p.policy_type='OT' AND v.status='ACTIVE'`,
      [tenantId],
    );
    expect(kept.rows[0].config_json).toMatchObject({ weekdayRate: 1.5, dailyLimitMinutes: 1440 });
    expect((await readOvertimeCompSettings(pool, tenantId, '2026-10-15')).current?.config.enabled).toBe(true);
  });

  it('xem trước phân loại ca xuyên đêm: hỏi hôm sau nghỉ; nghỉ cả ngày thì 8 giờ là ca đêm', async () => {
    const preview = await tx((db) =>
      previewOvertimeClassification(db, tenantId, {
        employeeId: e1,
        fromAt: '2026-10-05T11:00:00.000Z',
        toAt: '2026-10-05T21:00:00.000Z',
        nextDayRest: 'FULL',
      }),
    );
    expect(preview).toMatchObject({ enabled: true, ruleSet: 'NIGHT_REST', askNextDayRest: true, otHours: 2, nightHours: 8 });
    const none = await tx((db) =>
      previewOvertimeClassification(db, tenantId, { employeeId: e1, fromAt: '2026-10-05T11:00:00.000Z', toAt: '2026-10-05T21:00:00.000Z' }),
    );
    expect(none).toMatchObject({ otHours: 10, nightHours: 0 });
  });

  it('duyệt đơn làm thêm ghi ca phân loại và ngày nghỉ sau ca đêm; ca xuyên tháng tách tại 00:00 mùng 1', async () => {
    await ot(e1, '2026-10-05', '18:00', '04:00', 600, 'FULL');
    await ot(e1, '2026-10-07', '18:00', '23:00', 300);
    await ot(e1, '2026-10-08', '18:00', '23:00', 300);
    await ot(e1, '2026-10-09', '18:00', '23:00', 300);
    await ot(e2, '2026-10-13', '18:00', '04:00', 600, 'HALF');
    await ot(e2, '2026-10-31', '20:00', '02:00', 360);

    const octE1 = await listOvertimeBlocks(pool, tenantId, '2026-10', e1);
    expect(octE1.map((b) => [b.start, b.end, b.otHoursFinal, b.nightHoursFinal])).toEqual([
      ['2026-10-05T18:00', '2026-10-06T04:00', 2, 8],
      ['2026-10-07T18:00', '2026-10-07T23:00', 5, 0],
      ['2026-10-08T18:00', '2026-10-08T23:00', 5, 0],
      ['2026-10-09T18:00', '2026-10-09T23:00', 5, 0],
    ]);
    const split = await pool.query(
      `SELECT period_month,hours::float AS hours FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND employee_id=$2 AND start_at>=timestamptz '2026-10-31 00:00+07' ORDER BY start_at`,
      [tenantId, e2],
    );
    expect(split.rows).toEqual([
      { period_month: '2026-10', hours: 4 },
      { period_month: '2026-11', hours: 2 },
    ]);
    const rests = await pool.query(
      `SELECT employee_id,to_char(rest_date,'YYYY-MM-DD') AS d,fraction::float AS f FROM hrm_schema.night_rest_days WHERE tenant_id=$1 ORDER BY d`,
      [tenantId],
    );
    expect(rests.rows).toEqual([
      { employee_id: e1, d: '2026-10-06', f: 1 },
      { employee_id: e2, d: '2026-10-14', f: 0.5 },
    ]);
  });

  it('HR sửa phân loại cần lý do, có dấu vết, bỏ sửa tay trả về gợi ý; không sửa được tháng đã chốt', async () => {
    const [first] = await listOvertimeBlocks(pool, tenantId, '2026-10', e2);
    await expect(tx((db) => overrideOvertimeBlock(db, tenantId, actor, first!.id, { otHours: 3 }))).rejects.toThrow('lý do');
    await expect(tx((db) => overrideOvertimeBlock(db, tenantId, actor, first!.id, { otHours: 99, reason: 'x' }))).rejects.toThrow('số giờ của ca');
    const edited = await tx((db) => overrideOvertimeBlock(db, tenantId, actor, first!.id, { otHours: 6, reason: 'Nhập sai ngày nghỉ' }));
    expect(edited).toMatchObject({ otHoursFinal: 6, nightHoursFinal: 4, source: 'MANUAL', overrideReason: 'Nhập sai ngày nghỉ', otHoursSuggested: 6 });
    const reverted = await tx((db) => overrideOvertimeBlock(db, tenantId, actor, first!.id, { revert: true }));
    expect(reverted).toMatchObject({ source: 'RULE', overrideReason: null, otHoursFinal: 6 });
    const audit = await pool.query(`SELECT action FROM hrm_schema.audit_log WHERE tenant_id=$1 AND entity_id=$2 ORDER BY created_at`, [tenantId, first!.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['OVERTIME_BLOCK_OVERRIDDEN', 'OVERTIME_BLOCK_REVERTED']);
  });

  it('chốt tháng chụp chính sách và số liệu; đổi chính sách sau đó không đổi kỳ đã chốt; lương đọc ảnh chụp', async () => {
    const period = (
      await pool.query(
        `INSERT INTO hrm_schema.timesheet_periods (tenant_id,period_code,from_date,to_date,status) VALUES ($1,'2026-10','2026-10-01','2026-10-31','OPEN') RETURNING *`,
        [tenantId],
      )
    ).rows[0];
    const snapshot = await tx((db) => snapshotOvertimeComp(db, tenantId, actor, period));
    await pool.query(`UPDATE hrm_schema.timesheet_periods SET status='LOCKED' WHERE id=$1`, [period.id]);
    expect(snapshot?.employees[e1]).toMatchObject({
      actualOtHours: 17,
      countedOtHours: 10,
      nightHours: 8,
      excessOtHours: 7,
      compDays: 1.3,
      payrollHours: 18,
      nightRestDays: 1,
    });
    // Đổi trần sang 5 giờ từ tháng sau không làm đổi kỳ 2026-10 đã chụp.
    await tx((db) =>
      saveOvertimeCompSettings(db, tenantId, actor, { effectiveFrom: '2026-12-01', config: { monthlyCapHours: 5 }, reason: 'Thử đổi chính sách' }),
    );
    const stored = readOvertimeCompSnapshot(
      (await pool.query(`SELECT policy_snapshot FROM hrm_schema.timesheet_periods WHERE id=$1`, [period.id])).rows[0].policy_snapshot,
    );
    expect(stored?.policy.monthlyCapHours).toBe(10);
    expect(payrollOvertimeInputs(stored, e1, 99999)).toEqual({
      OT_COUNTED_MINUTES: 600,
      NIGHT_MINUTES: 480,
      OT_EXCESS_MINUTES: 420,
      NIGHT_REST_DAYS: 1,
    });
    // Kỳ chưa bật quy tắc: lương giữ cách tính cũ.
    expect(payrollOvertimeInputs(null, e1, 99999)).toEqual({ OT_COUNTED_MINUTES: 99999, NIGHT_MINUTES: 0, OT_EXCESS_MINUTES: 0, NIGHT_REST_DAYS: 0 });
    const octBlock = (await listOvertimeBlocks(pool, tenantId, '2026-10', e1))[0]!.id;
    await expect(tx((db) => overrideOvertimeBlock(db, tenantId, actor, octBlock, { otHours: 1, reason: 'sau chốt' }))).rejects.toThrow('đã chốt công');
  });

  it('chuyển đổi: chỉ khi tháng đã chốt, một lần cho mỗi tháng, chỉnh số ngày phải có lý do', async () => {
    const preview = await previewCompOffConversion(pool, tenantId, '2026-10');
    expect(preview).toMatchObject({ locked: true, enabled: true });
    const row = preview.rows.find((r) => r.employeeId === e1)!;
    expect(row).toMatchObject({ status: 'READY', compDays: 1.3, accrualOn: '2026-11-01', expiresOn: null });

    await expect(tx((db) => confirmCompOffConversion(db, tenantId, actor, { month: '2026-11', rows: [{ employeeId: e1 }] }))).rejects.toThrow('chưa chốt công');
    const noReason = await tx((db) => confirmCompOffConversion(db, tenantId, actor, { month: '2026-10', rows: [{ employeeId: e1, days: 1 }] }));
    expect(noReason).toMatchObject({ created: 0 });
    expect(noReason.skipped[0]?.reason).toContain('lý do');

    const done = await tx((db) => confirmCompOffConversion(db, tenantId, actor, { month: '2026-10', rows: [{ employeeId: e1 }, { employeeId: e2 }] }));
    // e2 làm thêm đúng bằng trần (10 giờ) nên không có giờ dư để chuyển đổi.
    expect(done.created).toBe(1);
    expect(done.skipped).toEqual([{ employeeId: e2, reason: 'Không có giờ làm thêm vượt trần trong tháng' }]);
    const again = await tx((db) => confirmCompOffConversion(db, tenantId, actor, { month: '2026-10', rows: [{ employeeId: e1 }] }));
    expect(again).toMatchObject({ created: 0 });
    expect(again.skipped[0]?.reason).toContain('Đã chuyển đổi');
    expect((await ledger(e1)).filter((r) => r.kind === 'ACCRUAL')).toHaveLength(1);
    expect((await previewCompOffConversion(pool, tenantId, '2026-10')).rows.find((r) => r.employeeId === e1)).toMatchObject({ status: 'CONVERTED', convertedDays: 1.3 });
    // Sổ chỉ thêm dòng: không sửa, không xóa.
    await expect(pool.query(`UPDATE hrm_schema.comp_off_ledger SET days=9 WHERE tenant_id=$1`, [tenantId])).rejects.toThrow('chỉ được thêm dòng');
    await expect(pool.query(`DELETE FROM hrm_schema.comp_off_ledger WHERE tenant_id=$1`, [tenantId])).rejects.toThrow('chỉ được thêm dòng');
  });

  it('đơn nghỉ bù: bội số 0,5 ngày, giữ chỗ khi gửi, chặn vượt số dư, duyệt thành đã dùng, hủy thì hoàn', async () => {
    const leave = (employeeId: string, from: string, to: string, duration: number) =>
      tx((db) => createLeave(db, tenantId, actor, { employeeId, leaveTypeId: compTypeId, fromDate: from, toDate: to, duration, reason: 'Nghỉ bù' }));
    expect((await compOffAvailability(pool, tenantId, e1, '2026-11-18')).available).toBe(1.3);
    // 0,3 ngày không phải bội số 0,5 và không phải ngày nửa/cả: bị chặn trước khi giữ chỗ.
    await expect(leave(e1, '2026-11-17', '2026-11-17', 0.3)).rejects.toThrow();
    await expect(leave(e1, '2026-11-17', '2026-11-18', 2)).rejects.toThrow('Quỹ nghỉ bù không đủ');
    const half = await leave(e1, '2026-11-16', '2026-11-16', 0.5);
    let rows = await ledger(e1);
    expect(rows.filter((r) => r.kind === 'RESERVE').map((r) => r.days)).toEqual([-0.5]);
    expect((await compOffAvailability(pool, tenantId, e1, '2026-11-18')).available).toBe(0.8);
    // Quỹ phép năm không bị đụng tới.
    expect((await pool.query(`SELECT count(*)::int AS n FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2`, [tenantId, compTypeId])).rows[0].n).toBe(0);

    await tx((db) => transitionLeave(db, tenantId, actor, half.id, 'APPROVED'));
    rows = await ledger(e1);
    // RELEASE và USAGE ghi cùng một giao dịch nên cùng thời điểm: so sánh không theo thứ tự.
    expect(rows.map((r) => r.kind).sort()).toEqual(['ACCRUAL', 'RELEASE', 'RESERVE', 'USAGE']);
    // Duyệt lại không ghi thêm.
    await tx((db) => transitionLeave(db, tenantId, actor, half.id, 'APPROVED'));
    expect(await ledger(e1)).toHaveLength(4);
    let balance = (await listCompOffBalances(pool, tenantId, '2026-11-18')).find((b) => b.employeeId === e1)!;
    expect(balance).toMatchObject({ accrued: 1.3, used: 0.5, reserved: 0, available: 0.8 });

    // Hủy đơn đã duyệt hoàn lại đủ.
    await tx((db) => transitionLeave(db, tenantId, actor, half.id, 'CANCELLED', 'Đổi kế hoạch'));
    balance = (await listCompOffBalances(pool, tenantId, '2026-11-18')).find((b) => b.employeeId === e1)!;
    expect(balance).toMatchObject({ used: 0, reserved: 0, available: 1.3 });

    // Từ chối đơn đang chờ hoàn phần giữ chỗ.
    const pending = await leave(e1, '2026-11-19', '2026-11-19', 1);
    expect((await compOffAvailability(pool, tenantId, e1, '2026-11-20')).available).toBe(0.3);
    await tx((db) => transitionLeave(db, tenantId, actor, pending.id, 'REJECTED', 'Không phù hợp'));
    expect((await compOffAvailability(pool, tenantId, e1, '2026-11-20')).available).toBe(1.3);
    const detail = await compOffDetail(pool, tenantId, e1, '2026-11-20');
    expect(detail.entries.length).toBeGreaterThanOrEqual(7);
  });

  it('hai đơn gửi đồng thời không dùng chung số dư (khóa nhân viên)', async () => {
    await tx((db) => adjustCompOff(db, tenantId, actor, { employeeId: e2, days: 1.5, reason: 'Cộng thêm để thử đồng thời' }));
    const available = (await compOffAvailability(pool, tenantId, e2, '2026-11-25')).available;
    const attempt = (date: string) =>
      tx(async (db) => {
        await lockEmployee(db, tenantId, e2);
        return createLeave(db, tenantId, actor, { employeeId: e2, leaveTypeId: compTypeId, fromDate: date, toDate: date, duration: 1, reason: 'Nghỉ bù' });
      });
    const results = await Promise.allSettled([attempt('2026-11-23'), attempt('2026-11-24')]);
    expect(available).toBeGreaterThanOrEqual(1);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    // Số dư của e2 đủ cho đúng một ngày: một đơn thành công, một đơn bị chặn.
    expect(available).toBeLessThan(2);
    expect(ok).toBe(1);
    expect((await ledger(e2)).filter((r) => r.kind === 'RESERVE')).toHaveLength(1);
  });

  it('điều chỉnh cần lý do, không để âm; hết hạn lô ghi một lần', async () => {
    await expect(tx((db) => adjustCompOff(db, tenantId, actor, { employeeId: e1, days: -1, reason: ' ' }))).rejects.toThrow('lý do');
    await expect(tx((db) => adjustCompOff(db, tenantId, actor, { employeeId: e1, days: -50, reason: 'Trừ quá' }))).rejects.toThrow('Không đủ số dư');
    // Lô có hạn đã qua: mở lô qua điều chỉnh với hạn dùng trong quá khứ rồi chạy hết hạn.
    await tx((db) => adjustCompOff(db, tenantId, actor, { employeeId: e1, days: 2, reason: 'Lô thử hết hạn', expiresOn: '2026-11-01' }));
    const before = (await listCompOffBalances(pool, tenantId, '2026-10-20')).find((b) => b.employeeId === e1)!;
    const afterDue = (await listCompOffBalances(pool, tenantId, '2026-11-20')).find((b) => b.employeeId === e1)!;
    expect(before.available - afterDue.available).toBeCloseTo(2, 5);
    expect(await tx((db) => expireCompOffLots(db, tenantId, actor, '2026-11-20'))).toBe(1);
    expect(await tx((db) => expireCompOffLots(db, tenantId, actor, '2026-11-20'))).toBe(0);
    expect((await ledger(e1)).filter((r) => r.kind === 'EXPIRE')).toHaveLength(1);
  });

  it('đảo đơn làm thêm xóa ca phân loại; mở lại kỳ xóa ảnh chụp', async () => {
    const created = await pool.query(`SELECT id FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 AND work_date='2026-10-07'`, [tenantId, e1]);
    await tx((db) => removeOvertimeBlocks(db, tenantId, created.rows[0].id));
    expect((await pool.query(`SELECT count(*)::int AS n FROM hrm_schema.overtime_blocks WHERE tenant_id=$1 AND ot_request_id=$2`, [tenantId, created.rows[0].id])).rows[0].n).toBe(0);
    const period = (await pool.query(`SELECT id FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND period_code='2026-10'`, [tenantId])).rows[0];
    await tx((db) => clearOvertimeCompSnapshot(db, tenantId, period.id));
    expect((await pool.query(`SELECT policy_snapshot FROM hrm_schema.timesheet_periods WHERE id=$1`, [period.id])).rows[0].policy_snapshot).toBeNull();
  });
});
