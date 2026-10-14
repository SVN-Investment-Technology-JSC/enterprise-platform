import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmApprovalRouteController } from './hrm-approval-route.controller';
import { HrmCustomRequestController } from './hrm-custom-request.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmOperationsController } from './hrm-operations.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmRequestController } from './hrm-request.controller';
import { HrmRequestCommentController } from './hrm-request-comment.controller';
import { HrmRequestTimeController } from './hrm-request-time.controller';
import { HrmRequestTypeController } from './hrm-request-type.controller';
import { pendingCustomRequestCount } from '../infrastructure/hrm-custom-request';
import { approveOvertime } from '../infrastructure/hrm-overtime';
import { testApprovalPolicy } from '../infrastructure/hrm-test-support';
import { hrmTransaction } from '../infrastructure/hrm-transaction';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/** Danh sách migration tenant theo đúng thứ tự đã đăng ký (core, integration, rồi HRM). */
async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const pathsBetween = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...pathsBetween('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...pathsBetween('  hrm: [', '  inventory: ['),
  ];
}

integration('Đơn từ theo từ ngày giờ đến ngày giờ và loại đơn cấu hình (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  const employeeId = randomUUID();
  const req = { headers: {} } as Request;
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let paidDay: string;
  let paidHour: string;
  let otReason: string;
  let tripReason: string;

  const principal = { userId, permissions: ['hrm.manage'] };
  // Người duyệt khác người nộp (không được tự duyệt đơn của chính mình).
  const approverId = randomUUID();
  const approver = { userId: approverId, permissions: ['hrm.manage'] };
  const ctx = (who: { userId: string; permissions: string[] } = principal) =>
    ({
      has: () => true,
      getRequestContext: async (_req: Request, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested ?? employeeId,
        principal: who,
      }),
      scoped: async (_req: Request, _permission: string, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested,
        principal: who,
      }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      resolveEmployee: async () => ({ employeeId }),
      procedureAvailable: async () => false,
    }) as any;
  const bridge = { startOrResume: jest.fn() } as any;
  const leaveController = () => new HrmLeaveController(ctx(), bridge, testApprovalPolicy());
  const requestController = () => new HrmRequestController(ctx(), bridge, testApprovalPolicy());
  const leave = (body: Record<string, unknown>) =>
    leaveController().createLeaveRequest(req, { employeeId, ...body } as any);
  const tx = <T>(work: (db: any) => Promise<T>) => hrmTransaction(pool as any, work);
  const days = async (requestId: string) =>
    (
      await pool.query(
        `SELECT to_char(work_date,'YYYY-MM-DD') AS date, quantity::float AS quantity, paid_minutes FROM hrm_schema.leave_request_days WHERE request_id=$1 ORDER BY work_date`,
        [requestId],
      )
    ).rows;

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));

    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,'Nguyễn Minh Anh','minhanh@example.test','test')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,'Nguyễn Minh Anh')`,
      [employeeId, tenantId, userId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,'NV001','2026-01-01')`,
      [employeeId, tenantId],
    );
    // Ca hành chính 08:00-17:00, nghỉ trưa 12:00-13:00; thứ Hai đến thứ Sáu đi làm, thứ Bảy và Chủ nhật nghỉ.
    const shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0,'12:00','13:00') RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
       SELECT $1,$2,d::date,
              CASE WHEN extract(isodow FROM d) >= 6 THEN 'OFF' ELSE 'SHIFT' END,
              CASE WHEN extract(isodow FROM d) >= 6 THEN NULL ELSE $3::uuid END,
              'MANUAL'
         FROM generate_series('2026-10-01'::date,'2026-10-31'::date,'1 day') d`,
      [tenantId, employeeId, shiftId],
    );
    const leaveType = async (code: string, unit: string) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,$2,$2,$3,true,false) RETURNING id`,
          [tenantId, code, unit],
        )
      ).rows[0].id as string;
    paidDay = await leaveType('NGHI_NGAY', 'DAYS');
    paidHour = await leaveType('NGHI_GIO', 'HOURS');
    const reason = async (kind: string, code: string) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name) VALUES ($1,$2,$3,$3) RETURNING id`,
          [tenantId, kind, code],
        )
      ).rows[0].id as string;
    otReason = await reason('OVERTIME', 'OT_WORK');
    tripReason = await reason('BUSINESS_TRIP', 'TRIP_PLAN');
    await new HrmPayrollSettingsController(ctx()).overtime(req, {
      effectiveFrom: '2025-01-01',
      reason: 'Thiết lập chính sách OT',
      dailyLimitMinutes: 240,
      weeklyLimitMinutes: 1200,
      monthlyLimitMinutes: 2400,
      yearlyLimitMinutes: 12000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  describe('loại đơn cấu hình', () => {
    const controller = () => new HrmRequestTypeController(ctx());

    it('lần đọc đầu có đủ 7 loại hệ thống; tạo, sửa, xoá loại tự tạo', async () => {
      const first = await controller().list(req);
      expect(first.data.map((t) => t.code)).toEqual([
        'LEAVE',
        'OVERTIME',
        'BUSINESS_TRIP',
        'SHIFT_CHANGE',
        'ATTENDANCE_CORRECTION',
        'ADVANCE',
        'PROFILE_CORRECTION',
      ]);
      expect((await controller().list(req)).data).toHaveLength(7);

      const created = await controller().create(req, {
        name: 'Xin xác nhận công tác',
        fields: [{ key: 'noi_nhan', label: 'Nơi nhận', type: 'text', required: true }],
      });
      expect(created.data).toMatchObject({ code: 'XIN_XAC_NHAN_CONG_TAC', engine: 'GENERIC', kind: 'custom' });
      expect((await controller().listForManage(req)).data).toHaveLength(8);

      const updated = await controller().update(req, created.data.id, {
        expectedUpdatedAt: created.data.updatedAt,
        name: 'Xác nhận công tác',
        timeMode: 'SINGLE_DATE',
      });
      expect(updated.data).toMatchObject({ name: 'Xác nhận công tác', timeMode: 'SINGLE_DATE' });
      await expect(
        controller().update(req, created.data.id, { expectedUpdatedAt: created.data.updatedAt, name: 'Cũ' }),
      ).rejects.toMatchObject({ status: 409 });

      // Loại đang sử dụng chưa xoá được: phải ngừng sử dụng trước.
      await expect(controller().remove(req, created.data.id)).rejects.toMatchObject({ status: 409 });
      await controller().update(req, created.data.id, { expectedUpdatedAt: updated.data.updatedAt, active: false });
      const removed = await controller().remove(req, created.data.id);
      expect(removed.data).toMatchObject({ deleted: true });
      expect((await controller().listForManage(req)).data).toHaveLength(7);
    });
  });

  describe('nghỉ phép theo từ ngày giờ đến ngày giờ', () => {
    it('nửa ngày sáng: 0.5 ngày, 240 phút, mốc giờ lưu theo UTC đúng múi giờ', async () => {
      const result = await leave({
        leaveTypeId: paidDay,
        fromAt: '2026-10-12T08:00',
        toAt: '2026-10-12T12:00',
        description: 'Việc riêng buổi sáng',
      });
      expect(result.data).toMatchObject({
        duration: 0.5,
        fromDate: '2026-10-12',
        toDate: '2026-10-12',
        fromAt: '2026-10-12T01:00:00.000Z',
        toAt: '2026-10-12T05:00:00.000Z',
        timeKnown: true,
      });
      expect(await days(result.data.id)).toEqual([{ date: '2026-10-12', quantity: 0.5, paid_minutes: 240 }]);
    });

    it('nghỉ chiều cùng ngày với đơn nghỉ sáng không bị coi là chồng đơn', async () => {
      const result = await leave({
        leaveTypeId: paidDay,
        fromAt: '2026-10-12T13:00',
        toAt: '2026-10-12T17:00',
      });
      expect(result.data.duration).toBe(0.5);
      expect(await days(result.data.id)).toEqual([{ date: '2026-10-12', quantity: 0.5, paid_minutes: 240 }]);
    });

    it('nghỉ chồng giờ với đơn đã có bị từ chối (409), kể cả chỉ chồng một phần', async () => {
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-12T08:00', toAt: '2026-10-12T12:00' }),
      ).rejects.toMatchObject({ status: 409 });
      // Nghỉ theo giờ chồng 1 giờ với buổi sáng đã nghỉ (11:00-12:00).
      await expect(
        leave({ leaveTypeId: paidHour, fromAt: '2026-10-12T11:00', toAt: '2026-10-12T14:00' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('từ thứ Sáu đến thứ Hai: bỏ thứ Bảy, Chủ nhật; 2 ngày; mỗi ngày 480 phút', async () => {
      const result = await leave({
        leaveTypeId: paidDay,
        fromAt: '2026-10-16T08:00',
        toAt: '2026-10-19T17:00',
      });
      expect(result.data).toMatchObject({ duration: 2, fromDate: '2026-10-16', toDate: '2026-10-19' });
      expect(await days(result.data.id)).toEqual([
        { date: '2026-10-16', quantity: 1, paid_minutes: 480 },
        { date: '2026-10-19', quantity: 1, paid_minutes: 480 },
      ]);
    });

    it('loại nghỉ tính theo giờ: 09:00 đến 11:00 là 2 giờ, 120 phút', async () => {
      const result = await leave({
        leaveTypeId: paidHour,
        fromAt: '2026-10-13T09:00',
        toAt: '2026-10-13T11:00',
      });
      expect(result.data.duration).toBe(2);
      expect(await days(result.data.id)).toEqual([{ date: '2026-10-13', quantity: 2, paid_minutes: 120 }]);
    });

    it('loại nghỉ tính theo ngày không nhận nghỉ 2 giờ; số lượng client sai bị từ chối', async () => {
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-14T08:00', toAt: '2026-10-14T10:00' }),
      ).rejects.toThrow(/cả ngày hoặc đúng nửa ca/);
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-14T08:00', toAt: '2026-10-14T17:00', duration: 0.5 }),
      ).rejects.toThrow(/Số lượng nghỉ theo thời gian đã chọn là 1/);
    });

    it('khoảng chỉ rơi vào cuối tuần hoặc ngoài ca: lỗi không có giờ làm việc', async () => {
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-17T08:00', toAt: '2026-10-18T17:00' }),
      ).rejects.toThrow(/không có giờ làm việc/);
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-20T18:00', toAt: '2026-10-20T20:00' }),
      ).rejects.toThrow(/không có giờ làm việc/);
    });

    it('định dạng sai, đến không sau từ: 400', async () => {
      await expect(leave({ leaveTypeId: paidDay, fromAt: '12/10/2026 08:00', toAt: '2026-10-12T12:00' })).rejects.toMatchObject(
        { status: 400 },
      );
      await expect(leave({ leaveTypeId: paidDay, fromAt: '2026-10-21T12:00', toAt: '2026-10-21T08:00' })).rejects.toThrow(
        /sau từ/,
      );
    });

    it('cách cũ (khoảng ngày + số ngày) vẫn hoạt động, đơn không có giờ cụ thể', async () => {
      const result = await leave({
        leaveTypeId: paidDay,
        fromDate: '2026-10-15',
        toDate: '2026-10-15',
        duration: 1,
      });
      expect(result.data).toMatchObject({ duration: 1, fromAt: null, toAt: null, timeKnown: false });
      // Đơn cũ không có giờ nên chồng ngày với đơn có giờ vẫn bị chặn theo quy tắc theo ngày.
      await expect(
        leave({ leaveTypeId: paidDay, fromAt: '2026-10-15T08:00', toAt: '2026-10-15T12:00' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('xem trước giờ giấc cho cùng kết quả server sẽ lưu', async () => {
      const controller = new HrmRequestTimeController(ctx());
      const preview = await controller.timePreview(
        req,
        employeeId,
        '2026-10-22T11:00',
        '2026-10-22T14:00',
        paidHour,
      );
      expect(preview.data).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', totalMinutes: 120, totalHours: 2 });
      expect(preview.data.days).toEqual([{ date: '2026-10-22', kind: 'WORK', minutes: 120, quantity: 2 }]);
      expect(preview.data.errors).toEqual([]);
      const bad = await controller.timePreview(req, employeeId, '2026-10-17T08:00', '2026-10-17T17:00', paidDay);
      expect(bad.data.errors.join(' ')).toMatch(/không có giờ làm việc/);
    });
  });

  describe('làm thêm giờ và công tác', () => {
    it('OT theo từ ngày giờ đến ngày giờ: suy ra ngày làm, giờ và số phút; không chồng với nghỉ ban ngày cùng ngày', async () => {
      const result = await requestController().createOtRequest(req, {
        employeeId,
        reasonId: otReason,
        fromAt: '2026-10-13T18:00',
        toAt: '2026-10-13T20:00',
      } as any);
      expect(result.data).toMatchObject({
        workDate: '2026-10-13',
        plannedMinutes: 120,
        fromAt: '2026-10-13T11:00:00.000Z',
        toAt: '2026-10-13T13:00:00.000Z',
        timeKnown: true,
      });
      expect(String(result.data.startTime).slice(0, 5)).toBe('18:00');
      expect(String(result.data.endTime).slice(0, 5)).toBe('20:00');
    });

    it('hệ số theo lý do: lý do có hệ số thì đơn lấy hệ số đó (lúc tạo và lúc duyệt), lý do không có thì theo chính sách OT', async () => {
      const rated = (
        await pool.query(
          `INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name,rate_multiplier) VALUES ($1,'OVERTIME','OT_RATE_3','Hệ số 3',3) RETURNING id`,
          [tenantId],
        )
      ).rows[0].id;
      const create = (reasonId: string, day: string) =>
        requestController().createOtRequest(req, {
          employeeId,
          reasonId,
          fromAt: `${day}T18:00`,
          toAt: `${day}T19:00`,
        } as any);
      const withRate = await create(rated, '2026-12-14');
      expect(withRate.data).toMatchObject({ otRateMultiplier: 3, rateSource: 'REASON' });
      const withPolicy = await create(otReason, '2026-12-15');
      expect(withPolicy.data).toMatchObject({ otRateMultiplier: 1.5, rateSource: 'POLICY' });
      // Đổi hệ số của lý do trước khi duyệt: duyệt dùng hệ số hiện hành của lý do.
      await pool.query(`UPDATE hrm_schema.request_reasons SET rate_multiplier=2.5 WHERE id=$1`, [rated]);
      const approvedRow = await tx((db) => approveOvertime(db, tenantId, approverId, withRate.data.id));
      expect(Number(approvedRow.ot_rate_multiplier)).toBe(2.5);
      expect(approvedRow.rate_source).toBe('REASON');
      // Bỏ hệ số của lý do: đơn duyệt sau đó quay về chính sách OT.
      await pool.query(`UPDATE hrm_schema.request_reasons SET rate_multiplier=NULL WHERE id=$1`, [rated]);
      const second = await create(rated, '2026-12-16');
      expect(second.data).toMatchObject({ otRateMultiplier: 1.5, rateSource: 'POLICY' });
    });

    it('trao đổi trên đơn: chủ đơn, người duyệt trong phạm vi và người được nhắc đọc ghi được; người lạ bị chặn; thông báo vào outbox', async () => {
      const bossUser = randomUUID();
      const peerUser = randomUUID();
      const strangerUser = randomUUID();
      for (const [id, name] of [[bossUser, 'Trần Quản Lý'], [peerUser, 'Lê Văn Bình'], [strangerUser, 'Phạm Người Lạ']]) {
        await pool.query(`INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test')`, [id, name, `${id}@example.test`]);
        await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [randomUUID(), tenantId, id, name]);
      }
      const created = await requestController().createOtRequest(req, {
        employeeId,
        reasonId: otReason,
        fromAt: '2027-01-12T18:00',
        toAt: '2027-01-12T19:00',
      } as any);
      const requestId = created.data.id as string;
      const inScope = { assertCanDecide: jest.fn(async () => undefined) };
      const outOfScope = { assertCanDecide: jest.fn(async () => { throw new Error('ngoài phạm vi'); }) };
      const controller = (who: { userId: string; permissions: string[] }, approvals: unknown) =>
        new HrmRequestCommentController(ctx(who), approvals as any);

      // Chủ đơn viết trước: người có quyền duyệt tăng ca được báo.
      const owner = controller({ userId, permissions: [] }, outOfScope);
      await owner.create(req, { kind: 'OT', requestId, body: 'Em xin duyệt giúp, việc gấp ạ' } as any);
      // Người duyệt trong phạm vi trả lời và nhắc Bình.
      const boss = controller({ userId: bossUser, permissions: ['hrm.ot.approve'] }, inScope);
      await boss.create(req, { kind: 'ot', requestId, body: 'Anh Bình xem giúp phần ca trực', mentionUserIds: [peerUser, randomUUID()] } as any);
      // Người được nhắc đọc và trả lời được dù không có quyền duyệt.
      const peer = controller({ userId: peerUser, permissions: [] }, outOfScope);
      const seen = await peer.list(req, 'OT', requestId);
      expect(seen.data.map((c) => c.body)).toEqual(['Em xin duyệt giúp, việc gấp ạ', 'Anh Bình xem giúp phần ca trực']);
      expect(seen.data[1].mentions).toEqual([{ userId: peerUser, name: 'Lê Văn Bình' }]);
      expect(seen.data.map((c) => c.mine)).toEqual([false, false]);
      await peer.create(req, { kind: 'OT', requestId, body: 'Ca trực ổn, đồng ý' } as any);
      // Người lạ (không phải chủ đơn, không có quyền duyệt, chưa được nhắc) bị chặn cả đọc lẫn ghi.
      const stranger = controller({ userId: strangerUser, permissions: ['hrm.ot.approve'] }, outOfScope);
      await expect(stranger.list(req, 'OT', requestId)).rejects.toMatchObject({ status: 403 });
      await expect(stranger.create(req, { kind: 'OT', requestId, body: 'chen vào' } as any)).rejects.toMatchObject({ status: 403 });
      // Người được nhắc không được ghi ý kiến kèm quyết định.
      await expect(peer.create(req, { kind: 'OT', requestId, body: 'duyệt', commentKind: 'DECISION', decision: 'APPROVE' } as any)).rejects.toMatchObject({ status: 403 });
      // Người duyệt ghi ý kiến kèm quyết định.
      await boss.create(req, { kind: 'OT', requestId, body: 'Đã duyệt, nhớ báo ca sau', commentKind: 'DECISION', decision: 'APPROVE' } as any);
      const all = await owner.list(req, 'OT', requestId);
      expect(all.data.map((c) => `${c.kind}:${c.decision ?? '-'}`)).toEqual(['COMMENT:-', 'COMMENT:-', 'COMMENT:-', 'DECISION:APPROVE']);
      expect(all.data.filter((c) => c.mine)).toHaveLength(1);
      // Thông báo: chủ đơn nhận khi người khác viết, người duyệt nhận khi chủ đơn viết, người được nhắc nhận riêng.
      const events = (
        await pool.query(
          `SELECT event_type, payload->'payload' AS p FROM integration_schema.outbox_events WHERE event_type LIKE 'hrm.request.comment.%' AND aggregate_id=$1 ORDER BY occurred_at, id`,
          [requestId],
        )
      ).rows;
      const byType = (t: string) => events.filter((e) => e.event_type === t);
      expect(byType('hrm.request.comment.to-approvers')).toHaveLength(1);
      expect(byType('hrm.request.comment.to-approvers')[0].p.approvalPermissions).toEqual(['hrm.ot.approve', 'hrm.manage']);
      expect(byType('hrm.request.comment.mentioned')).toHaveLength(1);
      expect(byType('hrm.request.comment.mentioned')[0].p.mentionedUserIds).toEqual([peerUser]);
      expect(byType('hrm.request.comment.to-requester')).toHaveLength(3);
      expect(byType('hrm.request.comment.to-requester').every((e) => e.p.recipientUserIds[0] === userId)).toBe(true);
      // Ứng viên nhắc tên: tìm không dấu, không có chính mình.
      const found = await boss.candidates(req, 'binh');
      expect(found.data.map((c) => c.name)).toEqual(['Lê Văn Bình']);
      expect((await boss.candidates(req, '')).data.some((c) => c.userId === bossUser)).toBe(false);
    });

    it('OT cách cũ vẫn nhận; OT từ 24 giờ trở lên bị từ chối', async () => {
      const legacy = await requestController().createOtRequest(req, {
        employeeId,
        reasonId: otReason,
        workDate: '2026-10-14',
        startTime: '18:00',
        endTime: '19:00',
        plannedMinutes: 60,
      } as any);
      expect(legacy.data).toMatchObject({ plannedMinutes: 60, fromAt: null });
      await expect(
        requestController().createOtRequest(req, {
          employeeId,
          reasonId: otReason,
          fromAt: '2026-10-21T08:00',
          toAt: '2026-10-22T08:00',
        } as any),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('công tác từ thứ Sáu đến thứ Hai: tự tính 4 ngày lịch, lưu mốc giờ', async () => {
      const result = await requestController().createBusinessTripRequest(req, {
        employeeId,
        reasonId: tripReason,
        destination: 'Đà Nẵng',
        fromAt: '2026-10-23T08:00',
        toAt: '2026-10-26T17:00',
      } as any);
      expect(result.data).toMatchObject({
        fromDate: '2026-10-23',
        toDate: '2026-10-26',
        daysCount: 4,
        fromAt: '2026-10-23T01:00:00.000Z',
        toAt: '2026-10-26T10:00:00.000Z',
        timeKnown: true,
      });
    });

    it('công tác chồng giờ với công tác khác bị chặn; ngày kết thúc đúng 00:00 không tính ngày đó', async () => {
      await expect(
        requestController().createBusinessTripRequest(req, {
          employeeId,
          reasonId: tripReason,
          destination: 'Huế',
          fromAt: '2026-10-25T08:00',
          toAt: '2026-10-27T17:00',
        } as any),
      ).rejects.toMatchObject({ status: 409 });
      const ok = await requestController().createBusinessTripRequest(req, {
        employeeId,
        reasonId: tripReason,
        destination: 'Huế',
        fromAt: '2026-10-28T08:00',
        toAt: '2026-10-30T00:00',
      } as any);
      expect(ok.data).toMatchObject({ fromDate: '2026-10-28', toDate: '2026-10-29', daysCount: 2 });
    });
  });

  describe('đơn của loại đơn do quản trị tạo (engine GENERIC)', () => {
    const types = () => new HrmRequestTypeController(ctx());
    const custom = (who = principal) => new HrmCustomRequestController(ctx(who), bridge, testApprovalPolicy());
    let rangeType: any;
    let dateType: any;
    let noneType: any;

    beforeAll(async () => {
      rangeType = (
        await types().create(req, {
          name: 'Xin xác nhận công tác',
          timeMode: 'RANGE_DATETIME',
          requiresAttachment: false,
          fields: [
            { key: 'noi_nhan', label: 'Nơi nhận', type: 'text', required: true },
            { key: 'muc_do', label: 'Mức độ', type: 'select', options: ['Gấp', 'Thường'] },
            { key: 'so_ban', label: 'Số bản', type: 'number' },
          ],
        })
      ).data;
      dateType = (await types().create(req, { name: 'Đăng ký làm việc từ xa', timeMode: 'DATE_RANGE' })).data;
      noneType = (await types().create(req, { name: 'Đề xuất chung', timeMode: 'NONE' })).data;
    });

    it('tạo đơn theo từ ngày giờ đến ngày giờ: lưu mốc UTC, số phút, trường động đã chuẩn hoá', async () => {
      const result = await custom().create(req, {
        employeeId,
        typeId: rangeType.id,
        fromAt: '2026-11-02T09:00',
        toAt: '2026-11-02T11:30',
        fields: { noi_nhan: '  Ngân hàng ABC ', muc_do: 'Gấp', so_ban: '2' },
        description: 'Cần cho thủ tục vay',
      } as any);
      expect(result.data).toMatchObject({
        // Mã của loại đã xoá mềm ở test trước không được dùng lại nên loại này có hậu tố.
        typeCode: rangeType.code,
        typeName: 'Xin xác nhận công tác',
        status: 'PENDING',
        fromAt: '2026-11-02T02:00:00.000Z',
        toAt: '2026-11-02T04:30:00.000Z',
        durationMinutes: 150,
        fields: { noi_nhan: 'Ngân hàng ABC', muc_do: 'Gấp', so_ban: 2 },
        description: 'Cần cho thủ tục vay',
      });
    });

    it('trường bắt buộc, giá trị ngoài lựa chọn, trường lạ, thời gian sai bị từ chối (400)', async () => {
      const base = { employeeId, typeId: rangeType.id, fromAt: '2026-11-03T09:00', toAt: '2026-11-03T10:00' };
      await expect(custom().create(req, { ...base, fields: {} } as any)).rejects.toThrow(/Nơi nhận/);
      await expect(
        custom().create(req, { ...base, fields: { noi_nhan: 'A', muc_do: 'Khẩn' } } as any),
      ).rejects.toThrow(/lựa chọn/);
      await expect(
        custom().create(req, { ...base, fields: { noi_nhan: 'A', la: 1 } } as any),
      ).rejects.toThrow(/không thuộc loại đơn/);
      await expect(
        custom().create(req, { ...base, toAt: '2026-11-03T08:00', fields: { noi_nhan: 'A' } } as any),
      ).rejects.toThrow(/sau từ/);
      await expect(
        custom().create(req, { employeeId, typeId: rangeType.id, fields: { noi_nhan: 'A' } } as any),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('loại theo khoảng ngày lưu cả ngày; loại không có thời gian từ chối fromAt; loại ngừng dùng bị từ chối', async () => {
      const dated = await custom().create(req, {
        employeeId,
        typeId: dateType.id,
        fromAt: '2026-11-04',
        toAt: '2026-11-05',
      } as any);
      expect(dated.data).toMatchObject({
        fromAt: '2026-11-03T17:00:00.000Z',
        toAt: '2026-11-05T17:00:00.000Z',
        durationMinutes: null,
      });
      const none = await custom().create(req, {
        employeeId,
        typeId: noneType.id,
        description: 'Đề xuất mua máy in',
      } as any);
      expect(none.data).toMatchObject({ fromAt: null, toAt: null });
      await expect(
        custom().create(req, { employeeId, typeId: noneType.id, fromAt: '2026-11-06' } as any),
      ).rejects.toThrow(/không có thời gian/);
      const stopped = (await types().create(req, { name: 'Loại đã ngừng', active: false })).data;
      await expect(custom().create(req, { employeeId, typeId: stopped.id } as any)).rejects.toThrow(
        /ngừng sử dụng/,
      );
    });

    it('loại có danh mục lý do thì bắt buộc chọn lý do của đúng loại; loại không có danh mục thì không nhận reasonId', async () => {
      await pool.query(
        `INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name) VALUES ($1,$2,'KHAC','Khác')`,
        [tenantId, dateType.code],
      );
      const reasonId = (
        await pool.query(`SELECT id FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$2`, [
          tenantId,
          dateType.code,
        ])
      ).rows[0].id;
      const base = { employeeId, typeId: dateType.id, fromAt: '2026-11-09', toAt: '2026-11-09' };
      await expect(custom().create(req, base as any)).rejects.toThrow(/Chọn lý do/);
      const ok = await custom().create(req, { ...base, reasonId } as any);
      expect(ok.data).toMatchObject({ reasonId, reasonName: 'Khác' });
      await expect(custom().create(req, { employeeId, typeId: noneType.id, reasonId } as any)).rejects.toThrow(
        /không có danh mục lý do/,
      );
    });

    it('duyệt trực tiếp: người nộp không tự duyệt được; người có quyền duyệt được, từ chối cần lý do', async () => {
      const created = await custom().create(req, { employeeId, typeId: noneType.id, description: 'Đề xuất 2' } as any);
      await expect(custom(principal).approve(req, created.data.id)).rejects.toMatchObject({ status: 403 });
      const approved = await custom(approver).approve(req, created.data.id);
      expect(approved.data).toMatchObject({ status: 'APPROVED', approvedBy: approverId });
      // Duyệt lại là idempotent; đã duyệt thì không từ chối được nữa.
      expect((await custom(approver).approve(req, created.data.id)).data.status).toBe('APPROVED');
      await expect(custom(approver).reject(req, created.data.id, 'Không đạt')).rejects.toMatchObject({
        status: 409,
      });

      const other = await custom().create(req, { employeeId, typeId: noneType.id, description: 'Đề xuất 3' } as any);
      await expect(custom(approver).reject(req, other.data.id, '  ')).rejects.toMatchObject({ status: 400 });
      const rejected = await custom(approver).reject(req, other.data.id, 'Chưa phù hợp');
      expect(rejected.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Chưa phù hợp' });
    });

    it('đơn tuỳ chỉnh đã duyệt hiện trên lịch cá nhân ở từng ngày trong khoảng; đơn chờ duyệt thì không', async () => {
      const approvedRange = await custom().create(req, {
        employeeId,
        typeId: rangeType.id,
        fromAt: '2026-11-10T09:00',
        toAt: '2026-11-11T12:00',
        fields: { noi_nhan: 'Lịch' },
      } as any);
      const calendar = () => new HrmOperationsController(ctx(), bridge).calendar(req, '2026-11-09', '2026-11-12');
      const customEvents = async () => (await calendar()).data.filter((e: any) => e.kind === 'CUSTOM');
      expect(await customEvents()).toEqual([]);
      await custom(approver).approve(req, approvedRange.data.id);
      expect((await customEvents()).map((e: any) => [e.date, e.label])).toEqual([
        ['2026-11-10', 'Xin xác nhận công tác'],
        ['2026-11-11', 'Xin xác nhận công tác'],
      ]);
    });

    it('danh sách lọc theo loại và trạng thái; đơn chờ duyệt có giờ trong tháng được đếm để chặn chốt công', async () => {
      const list = await custom(approver).list(req, undefined, noneType.id, 'REJECTED');
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({ typeId: noneType.id, status: 'REJECTED' });
      // Đơn chờ duyệt lúc 09:00 ngày 02/11/2026 được đếm ở tháng 11, không đếm ở tháng 12.
      expect(await pendingCustomRequestCount(pool as any, tenantId, '2026-11-01', '2026-11-30')).toBeGreaterThan(0);
      expect(await pendingCustomRequestCount(pool as any, tenantId, '2026-12-01', '2026-12-31')).toBe(0);
    });

    it('tháng đã chốt đơn từ: không tạo và không duyệt được đơn có ngày trong tháng', async () => {
      const waiting = await custom().create(req, {
        employeeId,
        typeId: rangeType.id,
        fromAt: '2026-11-16T09:00',
        toAt: '2026-11-16T10:00',
        fields: { noi_nhan: 'B' },
      } as any);
      await pool.query(
        `INSERT INTO hrm_schema.timesheet_periods (tenant_id,period_code,from_date,to_date,status,requests_closed_at)
         VALUES ($1,'2026-11','2026-11-01','2026-11-30','OPEN',now())`,
        [tenantId],
      );
      await expect(
        custom().create(req, {
          employeeId,
          typeId: rangeType.id,
          fromAt: '2026-11-17T09:00',
          toAt: '2026-11-17T10:00',
          fields: { noi_nhan: 'C' },
        } as any),
      ).rejects.toMatchObject({ status: 409 });
      await expect(custom(approver).approve(req, waiting.data.id)).rejects.toMatchObject({ status: 409 });
      // Loại không có thời gian không bị khoá tháng.
      await expect(
        custom().create(req, { employeeId, typeId: noneType.id, description: 'Vẫn tạo được' } as any),
      ).resolves.toBeDefined();
    });

    it('cấu hình duyệt theo loại: loại tuỳ chỉnh có dòng riêng, đặt DIRECT riêng được lưu', async () => {
      const route = new HrmApprovalRouteController(ctx());
      const config = await route.getConfig(req);
      const rows = config.data.items.filter((i) => i.requestKind === 'custom');
      expect(rows[0]).toMatchObject({ reasonCode: null, label: 'Loại đơn tuỳ chỉnh', mode: 'DIRECT' });
      expect(rows.map((r) => r.reasonCode)).toEqual(
        expect.arrayContaining([rangeType.code, dateType.code, noneType.code]),
      );
      const saved = await route.putConfig(req, { requestKind: 'custom', reasonCode: rangeType.code, mode: 'DIRECT' });
      const row = saved.data.items.find((i) => i.reasonCode === rangeType.code)!;
      expect(row).toMatchObject({ mode: 'DIRECT', inherited: false });
    });
  });
});
