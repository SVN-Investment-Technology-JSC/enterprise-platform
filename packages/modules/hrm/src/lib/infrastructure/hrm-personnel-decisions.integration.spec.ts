import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  applyDecision,
  applyDueDecisions,
  approveDecision,
  cancelDecision,
  createDecision,
  listSubordinates,
  loadAppointmentContext,
  loadDecision,
  loadDirectManager,
  loadReportingOverview,
  mapDecision,
  rejectDecision,
  resolveManagerChain,
  updateDraft,
} from './hrm-personnel-decisions';
import {
  HrmOrgAppointmentError,
  type HrmAppointmentCommand,
  type HrmOrgAppointmentPort,
} from './hrm-org-appointment';

/** Core giả: ghi lại lệnh nhận được, có thể được lập trình để lỗi. */
class FakeCore implements HrmOrgAppointmentPort {
  readonly commands: HrmAppointmentCommand[] = [];
  failNext: string | null = null;
  async apply(_tenantId: string, command: HrmAppointmentCommand) {
    this.commands.push(command);
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new HrmOrgAppointmentError(message, true);
    }
    return { assignmentId: randomUUID(), endedAssignmentIds: [], replayed: false };
  }
}

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM personnel decisions PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const hrUser = randomUUID();
  const approverUser = randomUUID();
  const treeId = randomUUID();
  const unitId = randomUUID();
  const posStaff = randomUUID();
  const posLead = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  const core = new FakeCore();

  const person = async (name: string, withAccount = true) => {
    const id = randomUUID();
    const userId = withAccount ? randomUUID() : null;
    if (userId)
      await pool.query(
        `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, $2, $3, 'test-only')`,
        [userId, name, `${userId}@test.local`],
      );
    await pool.query(
      `INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name, work_email) VALUES ($1, $2, $3, $4, $5)`,
      [id, tenantId, userId, name, `${id}@test.local`],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1, $2, $3, '2020-01-01')`,
      [id, tenantId, `E-${id.slice(0, 8)}`],
    );
    return { id, userId };
  };
  const line = async (employeeId: string, managerId: string) =>
    pool.query(
      `INSERT INTO hrm_schema.employee_reporting_lines (tenant_id, employee_id, manager_employee_id, effective_from, source)
       VALUES ($1, $2, $3, '2025-01-01', 'MANUAL')`,
      [tenantId, employeeId, managerId],
    );
  const draft = (
    employeeId: string,
    extra: Record<string, unknown> = {},
  ) =>
    createDecision(pool, tenantId, hrUser, {
      decisionType: 'APPOINT',
      employeeId,
      effectiveDate: '2026-01-02',
      reason: 'Bổ nhiệm theo nhu cầu',
      toPositionNodeId: posLead,
      ...extra,
    } as never);

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const migrate = async (path: string) =>
      pool.query(
        await readFile(resolve(process.cwd(), '../../../migrations/tenant', path), 'utf8'),
      );
    for (const path of [
      'core/0001-core-schema.sql',
      'core/0002-organization-soft-delete.sql',
      'core/0004-organization-category.sql',
      'core/0006-employees.sql',
      'core/0009-assignment-source-decision.sql',
      '0001-integration.sql',
      'hrm/0001-hrm.sql',
      'hrm/0002-employee-identity.sql',
      'hrm/0003-time-operations.sql',
      'hrm/0004-leave-operations.sql',
      'hrm/0005-timesheet-calculation.sql',
      'hrm/0006-payroll-formulas.sql',
      'hrm/0007-work-references.sql',
      'hrm/0008-profile-corrections.sql',
      'hrm/0009-leave-carryover.sql',
      'hrm/0010-attachments.sql',
      'hrm/0011-advance-settlement.sql',
      'hrm/0012-operations-and-workflow.sql',
      'hrm/0002-hrm-procedure-integration.sql',
      'hrm/0003-hrm-requests-enhancement.sql',
      'hrm/0014-hrm-profile-compatibility.sql',
      'hrm/0013-payroll-support.sql',
      'hrm/0015-hrm-procedure-sync.sql',
      'hrm/0015-procedure-definition-snapshot.sql',
      'hrm/0015-shift-submission.sql',
      'hrm/0016-hrm-lifecycle.sql',
      'hrm/0019-timesheet-attachment-lifecycle.sql',
      'hrm/0031-hrm-profile-documents.sql',
      'hrm/0020-payroll-lifecycle.sql',
      'hrm/0028-hrm-approval-policy.sql',
      'hrm/0032-hrm-personnel-decisions.sql',
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.organization_trees (id, code, name, is_primary) VALUES ($1, 'main', 'Sơ đồ chính', true)`,
      [treeId],
    );
    await pool.query(
      `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name) VALUES ($1, $2, 'unit', 'KT', 'Phòng Kỹ thuật')`,
      [unitId, treeId],
    );
    for (const [id, code, name] of [
      [posStaff, 'NV', 'Nhân viên kỹ thuật'],
      [posLead, 'TP', 'Trưởng phòng Kỹ thuật'],
    ])
      await pool.query(
        `INSERT INTO core_schema.organization_nodes (id, tree_id, parent_id, category, code, name) VALUES ($1, $2, $3, 'position', $4, $5)`,
        [id, treeId, unitId, code, name],
      );
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  it('bổ nhiệm kèm người quản lý, chuyển cấp dưới và đổi lương trong một quyết định', async () => {
    const employee = await person('An');
    const newBoss = await person('Sếp mới');
    const oldBoss = await person('Sếp cũ');
    const sub = await person('Cấp dưới');
    await line(employee.id, oldBoss.id);
    await line(sub.id, employee.id);
    await pool.query(
      `INSERT INTO hrm_schema.employee_salary_profiles (tenant_id, employee_id, salary_type, base_salary, effective_from, status)
       VALUES ($1, $2, 'NET', 15000000, '2025-01-01', 'ACTIVE')`,
      [tenantId, employee.id],
    );

    const created = await draft(employee.id, {
      managerMode: 'SET',
      toManagerEmployeeId: newBoss.id,
      subordinateMode: 'REASSIGN',
      subordinateTargetEmployeeId: newBoss.id,
      salaryChanged: true,
      toSalaryType: 'NET',
      toBaseSalary: 22000000,
    });
    expect(created.status).toBe('DRAFT');
    expect(created.decisionNo).toMatch(/^QDNS-2026-\d{4}$/);
    expect(created.fromManagerEmployeeId).toBe(oldBoss.id);
    expect(created.fromBaseSalary).toBe(15000000);
    expect(created.toPositionName).toBe('Trưởng phòng Kỹ thuật');
    expect(created.toUnitName).toBe('Phòng Kỹ thuật');

    const applied = await approveDecision(pool, tenantId, approverUser, created.id, { org: core });
    expect(applied.status).toBe('APPLIED');
    expect(applied.appliedSteps).toEqual({
      core: true,
      manager: true,
      subordinates: true,
      salary: true,
    });
    const command = core.commands.at(-1)!;
    expect(command).toMatchObject({
      decisionId: created.id,
      action: 'ASSIGN',
      nodeId: posLead,
      userId: employee.userId,
      endCurrent: true,
      isPrimary: true,
    });

    const overview = await loadReportingOverview(pool, tenantId, employee.id);
    expect(overview.current?.managerEmployeeId).toBe(newBoss.id);
    expect(overview.current?.decisionNo).toBe(created.decisionNo);
    expect(overview.history).toHaveLength(2);
    expect(overview.history.find((l) => l.managerEmployeeId === oldBoss.id)?.effectiveTo).toBe(
      '2026-01-01',
    );
    expect((await loadReportingOverview(pool, tenantId, sub.id)).current?.managerEmployeeId).toBe(
      newBoss.id,
    );
    expect(await listSubordinates(pool, tenantId, employee.id)).toEqual([]);
    expect((await listSubordinates(pool, tenantId, newBoss.id)).map((s) => s.employeeId)).toEqual(
      expect.arrayContaining([employee.id, sub.id]),
    );

    const salary = await pool.query(
      `SELECT base_salary, status, effective_from::text, change_reason FROM hrm_schema.employee_salary_profiles
        WHERE employee_id = $1 ORDER BY effective_from`,
      [employee.id],
    );
    expect(salary.rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    expect(Number(salary.rows[1].base_salary)).toBe(22000000);
    expect(salary.rows[1].change_reason).toContain(created.decisionNo);

    const manager = await loadDirectManager(pool, tenantId, employee.id);
    expect(manager?.name).toBe('Sếp mới');
    const audit = await pool.query(
      `SELECT action FROM hrm_schema.audit_log WHERE entity_id = $1`,
      [created.id],
    );
    expect(audit.rows.map((r) => r.action).sort()).toEqual([
      'PERSONNEL_DECISION_APPLIED',
      'PERSONNEL_DECISION_APPROVED',
      'PERSONNEL_DECISION_CREATED',
    ]);
  });

  it('không cho người lập quyết định tự duyệt', async () => {
    const employee = await person('Bình');
    const created = await draft(employee.id);
    await expect(
      approveDecision(pool, tenantId, hrUser, created.id, { org: core }),
    ).rejects.toMatchObject({ response: { code: 'SELF_APPROVAL_FORBIDDEN' } });
    expect(mapDecision(await loadDecision(pool, tenantId, created.id)).status).toBe('DRAFT');
  });

  it('không cho người được bổ nhiệm tự duyệt quyết định của mình', async () => {
    const employee = await person('Chi');
    const created = await draft(employee.id);
    await expect(
      approveDecision(pool, tenantId, employee.userId as string, created.id, { org: core }),
    ).rejects.toMatchObject({ response: { code: 'SELF_APPROVAL_FORBIDDEN' } });
  });

  it('Core lỗi thì dừng ở APPLY_PENDING và thử lại chỉ làm tiếp bước còn thiếu', async () => {
    const employee = await person('Dũng');
    const boss = await person('Quản lý Dũng');
    const created = await draft(employee.id, {
      managerMode: 'SET',
      toManagerEmployeeId: boss.id,
    });
    core.failNext = 'Core tạm thời không phản hồi';
    const before = core.commands.length;
    const pending = await approveDecision(pool, tenantId, approverUser, created.id, { org: core });
    expect(pending.status).toBe('APPLY_PENDING');
    expect(pending.applyError).toBe('Core tạm thời không phản hồi');
    expect(pending.appliedSteps).toEqual({});
    expect((await loadReportingOverview(pool, tenantId, employee.id)).current).toBeNull();
    await expect(cancelDecision(pool, tenantId, approverUser, created.id)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    // Hủy được vì chưa áp dụng bước nào; tạo quyết định mới để thử lại.
    const again = await draft(employee.id, { managerMode: 'SET', toManagerEmployeeId: boss.id });
    core.failNext = 'Core lỗi lần một';
    await approveDecision(pool, tenantId, approverUser, again.id, { org: core });
    const retried = await applyDecision(pool, tenantId, again.id, { org: core });
    expect(retried.status).toBe('APPLIED');
    expect(retried.applyError).toBeNull();
    expect(retried.applyAttempts).toBe(2);
    // 1 lần lỗi ở quyết định bị hủy + 1 lỗi + 1 thành công = 3 lệnh gửi Core
    expect(core.commands.length - before).toBe(3);
    expect((await loadReportingOverview(pool, tenantId, employee.id)).current?.managerEmployeeId).toBe(
      boss.id,
    );
  });

  it('áp dụng lại quyết định đã xong không tạo thêm dòng báo cáo', async () => {
    const employee = await person('Giang');
    const boss = await person('Quản lý Giang');
    const created = await draft(employee.id, { managerMode: 'SET', toManagerEmployeeId: boss.id });
    await approveDecision(pool, tenantId, approverUser, created.id, { org: core });
    const calls = core.commands.length;
    const again = await applyDecision(pool, tenantId, created.id, { org: core });
    expect(again.status).toBe('APPLIED');
    expect(core.commands.length).toBe(calls);
    expect((await loadReportingOverview(pool, tenantId, employee.id)).history).toHaveLength(1);
  });

  it('chặn vòng lặp báo cáo ngay khi lập quyết định', async () => {
    const boss = await person('Sếp');
    const staff = await person('Nhân viên');
    await line(boss.id, staff.id); // sếp đang báo cáo cho nhân viên
    await expect(
      draft(staff.id, { managerMode: 'SET', toManagerEmployeeId: boss.id }),
    ).rejects.toMatchObject({ response: { code: 'HRM_REPORTING_CYCLE' } });
  });

  it('mỗi nhân viên chỉ có một quyết định chưa hoàn tất', async () => {
    const employee = await person('Hà');
    await draft(employee.id);
    await expect(draft(employee.id)).rejects.toMatchObject({
      response: { code: 'HRM_DECISION_OPEN_EXISTS' },
    });
  });

  it('nhân viên chưa có tài khoản không thể bổ nhiệm vào chức danh Core', async () => {
    const employee = await person('Không tài khoản', false);
    await expect(draft(employee.id)).rejects.toMatchObject({
      response: { code: 'HRM_EMPLOYEE_NO_ACCOUNT' },
    });
    const context = await loadAppointmentContext(pool, tenantId, employee.id);
    expect(context.hasAccount).toBe(false);
    // Đổi người quản lý thì không cần tài khoản.
    const boss = await person('Quản lý');
    const change = await createDecision(pool, tenantId, hrUser, {
      decisionType: 'CHANGE_MANAGER',
      employeeId: employee.id,
      effectiveDate: '2026-01-02',
      reason: 'Điều chỉnh báo cáo',
      managerMode: 'SET',
      toManagerEmployeeId: boss.id,
    });
    const done = await approveDecision(pool, tenantId, approverUser, change.id, { org: core });
    expect(done.status).toBe('APPLIED');
    expect(done.appliedSteps).toEqual({ manager: true });
  });

  it('miễn nhiệm gửi lệnh END cho Core và có thể bỏ người quản lý', async () => {
    const employee = await person('Khánh');
    const boss = await person('Quản lý Khánh');
    await line(employee.id, boss.id);
    // Gán chức danh hiện tại như Core đã làm trước đó.
    await pool.query(
      `INSERT INTO core_schema.organization_node_assignments (id, node_id, user_id, is_primary, status, start_date)
       VALUES ($1, $2, $3, true, 'active', '2025-01-01')`,
      [randomUUID(), posStaff, employee.userId],
    );
    const created = await createDecision(pool, tenantId, hrUser, {
      decisionType: 'DISMISS',
      employeeId: employee.id,
      effectiveDate: '2026-01-02',
      reason: 'Miễn nhiệm chức vụ',
      managerMode: 'CLEAR',
    });
    expect(created.fromPositionName).toBe('Nhân viên kỹ thuật');
    const done = await approveDecision(pool, tenantId, approverUser, created.id, { org: core });
    expect(done.status).toBe('APPLIED');
    expect(core.commands.at(-1)).toMatchObject({ action: 'END', nodeId: posStaff });
    expect((await loadReportingOverview(pool, tenantId, employee.id)).current).toBeNull();
  });

  it('miễn nhiệm người chưa giữ chức danh bị từ chối', async () => {
    const employee = await person('Lan');
    await expect(
      createDecision(pool, tenantId, hrUser, {
        decisionType: 'DISMISS',
        employeeId: employee.id,
        effectiveDate: '2026-01-02',
        reason: 'Không có chức danh',
      }),
    ).rejects.toThrow(/chưa giữ chức danh/);
  });

  it('quyết định ngày tương lai chờ worker, đến hạn mới áp dụng', async () => {
    const employee = await person('Minh');
    const created = await draft(employee.id, { effectiveDate: '2999-01-01' });
    const approved = await approveDecision(pool, tenantId, approverUser, created.id, { org: core });
    expect(approved.status).toBe('APPROVED');
    const calls = core.commands.length;
    expect((await applyDueDecisions(pool, tenantId, { org: core })).applied).toBe(0);
    expect(core.commands.length).toBe(calls);
    await pool.query(
      `UPDATE hrm_schema.personnel_decisions SET effective_date = '2026-01-02' WHERE id = $1`,
      [created.id],
    );
    const result = await applyDueDecisions(pool, tenantId, { org: core });
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(mapDecision(await loadDecision(pool, tenantId, created.id)).status).toBe('APPLIED');
  });

  it('sửa bản nháp kiểm tra phiên bản; từ chối và hủy đóng quyết định', async () => {
    const employee = await person('Nga');
    const created = await draft(employee.id);
    const edited = await updateDraft(pool, tenantId, hrUser, created.id, {
      version: created.version,
      reason: 'Lý do đã chỉnh',
    });
    expect(edited.reason).toBe('Lý do đã chỉnh');
    expect(edited.version).toBe(created.version + 1);
    await expect(
      updateDraft(pool, tenantId, hrUser, created.id, { version: created.version, reason: 'Cũ' }),
    ).rejects.toMatchObject({ response: { code: 'HRM_STALE_VERSION' } });
    const rejected = await rejectDecision(pool, tenantId, approverUser, created.id, 'Chưa đủ căn cứ');
    expect(rejected.status).toBe('REJECTED');
    await expect(
      approveDecision(pool, tenantId, approverUser, created.id, { org: core }),
    ).rejects.toThrow(/trạng thái nháp/);
    // Sau khi bị từ chối, nhân viên lập được quyết định mới.
    const next = await draft(employee.id);
    expect((await cancelDecision(pool, tenantId, hrUser, next.id)).status).toBe('CANCELLED');
  });

  it('chuỗi quản lý đi lên nhiều cấp theo quan hệ báo cáo của HRM', async () => {
    const a = await person('A');
    const b = await person('B');
    const c = await person('C');
    await line(a.id, b.id);
    await line(b.id, c.id);
    expect(await resolveManagerChain(pool, tenantId, a.id)).toEqual([b.id, c.id]);
    expect(await resolveManagerChain(pool, tenantId, c.id)).toEqual([]);
  });
});
