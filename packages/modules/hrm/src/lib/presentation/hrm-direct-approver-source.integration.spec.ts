import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmApprovalRouteController } from './hrm-approval-route.controller';
import {
  APPROVAL_OUT_OF_SCOPE,
  directAssignedRequestIds,
  HrmApprovalPolicyService,
  isDesignatedDirectApprover,
} from '../infrastructure/hrm-approval-policy';
import { approvalAudienceOf, directApproverUserIds } from '../infrastructure/hrm-direct-approvers';
import { previewApprovalRoute } from '../infrastructure/hrm-approval-route';
import { fakeOrgScope } from '../infrastructure/hrm-test-support';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

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

/**
 * Nguồn người duyệt của cách duyệt DIRECT (PostgreSQL thật): quản lý trực tiếp (mặc định) hoặc người giữ chức danh được
 * chỉ định, kèm chức danh dự phòng tuỳ chọn. Người được cấu hình duyệt KHÔNG cần quyền duyệt của HRM; người còn lại chỉ
 * duyệt được qua quyền + phạm vi cấp dưới.
 *
 * Sơ đồ: Giám đốc (D) > Trưởng phòng (M) > Nhân viên (A); Trưởng phòng HC (H) và Chức danh khác (X) đứng riêng.
 */
integration('Nguồn người duyệt DIRECT: quản lý trực tiếp hoặc chức danh chỉ định (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const req = { headers: {} } as Request;
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;

  const user = { d: randomUUID(), m: randomUUID(), a: randomUUID(), h: randomUUID(), x: randomUUID() };
  const emp = { d: randomUUID(), m: randomUUID(), a: randomUUID(), h: randomUUID(), x: randomUUID() };
  const pos = { d: randomUUID(), m: randomUUID(), a: randomUUID(), h: randomUUID(), x: randomUUID() };
  const noPermission = (userId: string) => ({ userId, permissions: [] as string[] });

  const leaveTypes: Record<string, string> = {};
  let leaveGeneral: string; // đơn nghỉ loại AL của A
  let leaveSpecific: string; // đơn nghỉ loại SP của A
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  const route = () =>
    new HrmApprovalRouteController({
      getContext: async () => ({ pool, tenantId, principal: { userId: user.m, permissions: ['hrm.manage'] } }),
      procedureAvailable: async () => false,
    } as any);
  const setRoute = (body: Record<string, unknown>) => route().putConfig(req, body);
  const policy = (subordinates: string[] = []) => new HrmApprovalPolicyService(fakeOrgScope(subordinates));
  const decide = (who: { userId: string; permissions: string[] }, requestId: string, subordinates: string[] = []) =>
    policy(subordinates).assertCanDecide({ pool, tenantId, principal: who }, requestId, 'leave', 'approve');
  const assigned = (userId: string) => directAssignedRequestIds(pool, tenantId, 'leave', userId);
  const resetBindings = () => q(`DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1`, [tenantId]);

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

    for (const key of ['d', 'm', 'a', 'h', 'x'] as const) {
      await pool.query(`INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test')`, [
        user[key],
        `Người ${key.toUpperCase()}`,
        `${key}@example.test`,
      ]);
      await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [
        emp[key],
        tenantId,
        user[key],
        `Người ${key.toUpperCase()}`,
      ]);
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2026-01-01')`,
        [emp[key], tenantId, `NV_${key.toUpperCase()}`],
      );
    }
    const tree = randomUUID();
    await pool.query(`INSERT INTO core_schema.organization_trees (id, code, name, is_primary) VALUES ($1,'main','Sơ đồ chính',true)`, [tree]);
    const nodes: [string, string, string, string | null][] = [
      [pos.d, 'GD', 'Giám đốc khối', null],
      [pos.m, 'TP', 'Trưởng phòng', pos.d],
      [pos.a, 'NV', 'Nhân viên', pos.m],
      [pos.h, 'HC', 'Trưởng phòng HC', null],
      [pos.x, 'KH', 'Chức danh khác', null],
    ];
    for (const [id, code, name, reportsTo] of nodes)
      await pool.query(
        `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name, reports_to_position_id) VALUES ($1,$2,'position',$3,$4,$5)`,
        [id, tree, code, name, reportsTo],
      );
    for (const key of ['d', 'm', 'a', 'h', 'x'] as const)
      await pool.query(
        `INSERT INTO core_schema.organization_node_assignments (id, node_id, user_id, is_primary, status, start_date) VALUES ($1,$2,$3,true,'active','2026-01-01')`,
        [randomUUID(), pos[key], user[key]],
      );
    for (const code of ['AL', 'SP'])
      leaveTypes[code] = (
        await pool.query(
          `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,$2,$2,'DAYS',true,false) RETURNING id`,
          [tenantId, code],
        )
      ).rows[0].id as string;
    const mkLeave = async (code: string) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,status)
           VALUES ($1,$2,$3,'2026-10-05','2026-10-05',1,'Việc riêng','PENDING') RETURNING id`,
          [tenantId, emp.a, leaveTypes[code]],
        )
      ).rows[0].id as string;
    leaveGeneral = await mkLeave('AL');
    leaveSpecific = await mkLeave('SP');
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  beforeEach(resetBindings);

  describe('quản lý trực tiếp (mặc định, chưa có cấu hình)', () => {
    it('quản lý trực tiếp được giao đơn và duyệt được dù KHÔNG có quyền duyệt của HRM', async () => {
      expect(await assigned(user.m)).toEqual(expect.arrayContaining([leaveGeneral, leaveSpecific]));
      expect(await isDesignatedDirectApprover(pool, tenantId, 'leave', leaveGeneral, emp.a, user.m)).toBe(true);
      await expect(decide(noPermission(user.m), leaveGeneral)).resolves.toBeUndefined();
    });

    it('người không liên quan hoặc cấp trên gián tiếp không có quyền thì không được giao và bị chặn ngoài phạm vi', async () => {
      for (const who of [user.x, user.d, user.h]) {
        expect(await assigned(who)).toEqual([]);
        await expect(decide(noPermission(who), leaveGeneral)).rejects.toMatchObject({
          response: { code: APPROVAL_OUT_OF_SCOPE },
        });
      }
    });

    it('cấp trên gián tiếp có quyền duyệt và đơn trong phạm vi cấp dưới thì vẫn duyệt được (lớp quyền)', async () => {
      const director = { userId: user.d, permissions: ['hrm.request.approve'] };
      await expect(decide(director, leaveGeneral, [user.a, user.m])).resolves.toBeUndefined();
    });

    it('chủ đơn không tự duyệt dù là người được cấu hình', async () => {
      // A không phải người duyệt của chính mình; manager của M là D, nên đơn của M do D duyệt, M không tự duyệt.
      const own = (
        await q(
          `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,status)
           VALUES ($1,$2,$3,'2026-10-06','2026-10-06',1,'Việc riêng','PENDING') RETURNING id`,
          [tenantId, emp.m, leaveTypes.AL],
        )
      )[0].id as string;
      expect(await assigned(user.d)).toContain(own);
      expect(await assigned(user.m)).not.toContain(own);
      await expect(decide(noPermission(user.m), own)).rejects.toMatchObject({
        response: { code: 'SELF_APPROVAL_FORBIDDEN' },
      });
      await q(`DELETE FROM hrm_schema.leave_requests WHERE id=$1`, [own]);
    });
  });

  describe('chỉ định chức danh duyệt', () => {
    beforeEach(async () => {
      await setRoute({ requestKind: 'leave', mode: 'DIRECT', directApprover: 'POSITION', approverPositionId: pos.h });
    });

    it('lưu nguồn POSITION kèm chức danh và trả lại trong danh sách cấu hình', async () => {
      const config = (await route().getConfig(req)).data;
      const general = config.items.find((i) => i.requestKind === 'leave' && !i.reasonCode);
      expect(general).toMatchObject({
        mode: 'DIRECT',
        directApprover: 'POSITION',
        approverPositionId: pos.h,
        approverPositionName: 'Trưởng phòng HC',
        fallbackPositionId: null,
      });
      const [row] = await q(
        `SELECT direct_approver_source, approver_position_id, fallback_position_id FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND is_active`,
        [tenantId],
      );
      expect(row).toEqual({ direct_approver_source: 'POSITION', approver_position_id: pos.h, fallback_position_id: null });
    });

    it('người giữ chức danh chỉ định duyệt được không cần quyền; quản lý trực tiếp không còn là người duyệt', async () => {
      expect(await assigned(user.h)).toEqual(expect.arrayContaining([leaveGeneral, leaveSpecific]));
      await expect(decide(noPermission(user.h), leaveGeneral)).resolves.toBeUndefined();
      expect(await assigned(user.m)).toEqual([]);
      await expect(decide(noPermission(user.m), leaveGeneral)).rejects.toMatchObject({
        response: { code: APPROVAL_OUT_OF_SCOPE },
      });
    });

    it('quản lý trực tiếp hoặc cấp trên có quyền duyệt HRM vẫn bị chặn 403 APPROVAL_OUT_OF_SCOPE đối với đơn chỉ định chức danh', async () => {
      const managerWithPerm = { userId: user.m, permissions: ['hrm.request.approve'] };
      await expect(decide(managerWithPerm, leaveGeneral, [user.a])).rejects.toMatchObject({
        response: { code: APPROVAL_OUT_OF_SCOPE },
      });
      const directorWithPerm = { userId: user.d, permissions: ['hrm.request.approve'] };
      await expect(decide(directorWithPerm, leaveGeneral, [user.a, user.m])).rejects.toMatchObject({
        response: { code: APPROVAL_OUT_OF_SCOPE },
      });
    });

    it('người nhận thông báo là người giữ chức danh chỉ định, không phải quản lý trực tiếp', async () => {
      expect(await directApproverUserIds(pool, tenantId, 'leave', leaveGeneral, emp.a)).toEqual([user.h]);
    });

    it('chỉ định chức danh thì không báo cho cấp trên giữ quyền duyệt (họ bị loại và không duyệt được)', async () => {
      const audience = await approvalAudienceOf(pool, tenantId, 'leave', leaveGeneral, emp.a);
      expect(audience.assigned).toEqual([user.h]);
      expect(audience.superiors).toEqual([]);
    });

    it('xem trước người duyệt nêu chức danh và những người đang giữ', async () => {
      const preview = await previewApprovalRoute(pool, { tenantId, kind: 'leave', employeeId: emp.a });
      expect(preview).toMatchObject({
        mode: 'DIRECT',
        directApprover: 'POSITION',
        approverPosition: {
          positionId: pos.h,
          positionName: 'Trưởng phòng HC',
          holders: [{ employeeId: emp.h, fullName: 'Người H' }],
        },
      });
      expect(preview.directManager).toBeUndefined();
    });

    it('chức danh dự phòng là tuỳ chọn: có thì người giữ dự phòng cũng duyệt, bỏ (null) thì không', async () => {
      await setRoute({
        requestKind: 'leave',
        mode: 'DIRECT',
        directApprover: 'POSITION',
        approverPositionId: pos.h,
        fallbackPositionId: pos.x,
      });
      expect(await assigned(user.x)).toEqual(expect.arrayContaining([leaveGeneral]));
      await expect(decide(noPermission(user.x), leaveGeneral)).resolves.toBeUndefined();
      expect((await directApproverUserIds(pool, tenantId, 'leave', leaveGeneral, emp.a)).sort()).toEqual(
        [user.h, user.x].sort(),
      );
      await setRoute({
        requestKind: 'leave',
        mode: 'DIRECT',
        directApprover: 'POSITION',
        approverPositionId: pos.h,
        fallbackPositionId: null,
      });
      expect(await assigned(user.x)).toEqual([]);
    });

    it('cấu hình riêng theo loại nghỉ thắng cấu hình chung của loại đơn', async () => {
      // Chung: chức danh HC. Riêng loại SP: quay về quản lý trực tiếp.
      await setRoute({ requestKind: 'leave', reasonCode: 'SP', mode: 'DIRECT' });
      expect(await assigned(user.m)).toEqual([leaveSpecific]);
      expect(await assigned(user.h)).toEqual([leaveGeneral]);
    });

    it('chuyển lại quản lý trực tiếp xoá chức danh chỉ định khỏi cấu hình (ràng buộc bảng giữ nhất quán)', async () => {
      await setRoute({ requestKind: 'leave', mode: 'DIRECT' });
      const [row] = await q(
        `SELECT direct_approver_source, approver_position_id FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND is_active`,
        [tenantId],
      );
      expect(row).toEqual({ direct_approver_source: 'DIRECT_MANAGER', approver_position_id: null });
      expect(await assigned(user.m)).toEqual(expect.arrayContaining([leaveGeneral]));
      expect(await assigned(user.h)).toEqual([]);
    });
  });

  describe('kiểm tra cấu hình', () => {
    it('chức danh chỉ định không tồn tại hoặc không phải chức danh bị từ chối', async () => {
      await expect(
        setRoute({ requestKind: 'leave', mode: 'DIRECT', directApprover: 'POSITION', approverPositionId: randomUUID() }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        setRoute({ requestKind: 'leave', mode: 'DIRECT', directApprover: 'POSITION' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        setRoute({ requestKind: 'leave', mode: 'DIRECT', fallbackPositionId: randomUUID() }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('bảng từ chối POSITION thiếu chức danh và chức danh khi không phải POSITION', async () => {
      const insert = (source: string, position: string | null) =>
        pool.query(
          `INSERT INTO hrm_schema.request_procedure_bindings (id,tenant_id,request_kind,mode,direct_approver_source,approver_position_id)
           VALUES ($1,$2,'leave','DIRECT',$3,$4)`,
          [randomUUID(), tenantId, source, position],
        );
      await expect(insert('POSITION', null)).rejects.toThrow(/direct_approver_chk/);
      await expect(insert('DIRECT_MANAGER', pos.h)).rejects.toThrow(/direct_approver_chk/);
      await expect(insert('BOSS', null)).rejects.toThrow(/direct_approver_chk/);
    });
  });

  describe('đơn đi theo quy trình', () => {
    it('cấu hình PROCEDURE: không ai được giao theo cách duyệt trực tiếp', async () => {
      await q(
        `INSERT INTO hrm_schema.request_procedure_bindings (id,tenant_id,request_kind,mode,procedure_definition_id)
         VALUES ($1,$2,'leave','PROCEDURE',$3)`,
        [randomUUID(), tenantId, randomUUID()],
      );
      for (const who of [user.m, user.h, user.x]) expect(await assigned(who)).toEqual([]);
      expect(await directApproverUserIds(pool, tenantId, 'leave', leaveGeneral, emp.a)).toEqual([]);
      await expect(decide(noPermission(user.m), leaveGeneral)).rejects.toMatchObject({
        response: { code: APPROVAL_OUT_OF_SCOPE },
      });
    });
  });
});
