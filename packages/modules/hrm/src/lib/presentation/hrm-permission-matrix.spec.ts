import 'reflect-metadata';
import {
  expandTenantActions,
  HRM_ROLE_TEMPLATES,
} from '@enterprise-platform/contracts-identity';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  APPROVAL_OUT_OF_SCOPE,
  SELF_APPROVAL_FORBIDDEN,
  assertCanDecide,
  describeApprovalScope,
  type HrmApprovalDeps,
} from '../infrastructure/hrm-approval-policy.js';
import { HrmContextService } from '../infrastructure/hrm-context.service';
import { HrmEmployeeController } from './hrm-employee.controller';
import { HrmPayrollController } from './hrm-payroll.controller';
import { HrmSalaryController } from './hrm-salary.controller';

jest.mock('@enterprise-platform/platform-identity', () => ({
  PlatformIdentityService: class {},
}));
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

/**
 * Ma tran quyen HRM: vai tro x hanh dong x pham vi, kiem o tang chinh sach/controller (khong can DB).
 * Quyen cua vai tro lay tu HRM_ROLE_TEMPLATES va duoc mo rong bang expandTenantActions nhu Core.
 */
const template = (key: string) =>
  HRM_ROLE_TEMPLATES.find((t) => t.key === key)?.actions ?? [];
const grant = (...actions: string[]) => expandTenantActions(actions);

const ROLES = {
  self: grant(...template('employee')),
  managerApprove: grant(...template('department-head')),
  managerAll: grant(
    ...template('department-head'),
    'hrm.leave.approve.all',
    'hrm.ot.approve.all',
    'hrm.trip.approve.all',
    'hrm.shift.approve.all',
  ),
  hrNoSalary: grant(...template('hr-profile')),
  hrSalary: grant(...template('comp-ben')),
  admin: grant(...template('hrm-admin')),
} as const;
type RoleName = keyof typeof ROLES;
const roleNames = Object.keys(ROLES) as RoleName[];

const USER = 'user-viewer';
const OTHER_EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const OWN_EMPLOYEE = '44444444-4444-4444-8444-444444444444';

/** Stand-in for Core's decision: a route needs its permission (hrm.manage/tenant.manage cover all). */
class StubContext extends HrmContextService {
  constructor(
    private readonly permissions: readonly string[],
    private readonly pool: unknown,
  ) {
    super({} as never, {} as never);
  }
  override async getContext(_request: Request, required = 'hrm.read') {
    const ok =
      this.permissions.includes(required) ||
      this.permissions.includes('hrm.manage') ||
      this.permissions.includes('tenant.manage');
    if (!ok) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return {
      principal: {
        kind: 'tenant-user',
        tenantId: 't',
        userId: USER,
        sessionId: 's',
        permissions: this.permissions,
      } as never,
      tenantId: 't',
      pool: this.pool as never,
    };
  }
}

function fakePool() {
  const profileRow = (employeeId: string, userId: string) => ({
    employee_id: employeeId,
    user_id: userId,
    tenant_id: 't',
    employee_code: 'E1',
    full_name: 'Nhan vien',
    join_date: '2024-01-01',
    employment_status: 'OFFICIAL',
    salary_grade_name: 'Ngach 5',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  });
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const result = await answer(sql, params);
      return { ...result, rowCount: result.rows.length };
    }),
  };
  async function answer(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: unknown[] }> {
    if (sql.includes('FROM hrm_schema.employee_directory')) {
      const employeeId = params[1] as string | undefined;
      if (sql.includes('LIMIT')) {
        return {
          rows: [
            profileRow(OTHER_EMPLOYEE, 'user-other'),
            profileRow(OWN_EMPLOYEE, USER),
          ],
        };
      }
      return {
        rows: [
          profileRow(
            employeeId as string,
            employeeId === OWN_EMPLOYEE ? USER : 'user-other',
          ),
        ],
      };
    }
    if (sql.includes('count(*)::int AS total')) return { rows: [{ total: 2 }] };
    if (sql.includes('FROM hrm_schema.employment_contracts'))
      return {
        rows: [
          {
            id: 'c1',
            tenant_id: 't',
            employee_id: params[1],
            contract_code: 'HD1',
            contract_type: 'INDEFINITE',
            effective_from: '2024-01-01',
            status: 'ACTIVE',
            base_salary: '20000000',
            issued_snapshot: { baseSalary: 20000000 },
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      };
    if (sql.startsWith('SELECT user_id FROM core_schema.employees'))
      return {
        rows: [{ user_id: params[1] === OWN_EMPLOYEE ? USER : 'user-other' }],
      };
    if (sql.includes('FROM core_schema.employees')) {
      // own-scope check: id = $3 belongs to the viewer only for OWN_EMPLOYEE
      if (params.length > 2 && params[2] !== OWN_EMPLOYEE) return { rows: [] };
      return { rows: [{ id: OWN_EMPLOYEE, full_name: 'Toi' }] };
    }
    return { rows: [] };
  }
}

const req = { headers: {}, method: 'GET' } as unknown as Request;
const bodyOf = (r: unknown) => (r as { data: any }).data;

async function outcome<T>(run: () => Promise<T>) {
  try {
    return { allowed: true as const, value: await run() };
  } catch (error) {
    if (error instanceof ForbiddenException)
      return { allowed: false as const, value: undefined };
    throw error;
  }
}

describe('HRM permission matrix: who can open what', () => {
  /** [action, handler factory, roles allowed] */
  const gates: {
    action: string;
    run: (ctx: StubContext) => Promise<unknown>;
    allowed: RoleName[];
  }[] = [
    {
      action: 'view other employee profile',
      run: (ctx) =>
        new HrmEmployeeController(ctx).getEmployeeProfile(req, OTHER_EMPLOYEE),
      allowed: ['hrNoSalary', 'hrSalary', 'admin'],
    },
    {
      action: 'view own profile',
      run: (ctx) =>
        new HrmEmployeeController(ctx).getEmployeeProfile(req, OWN_EMPLOYEE),
      allowed: [
        'self',
        'managerApprove',
        'managerAll',
        'hrNoSalary',
        'hrSalary',
        'admin',
      ],
    },
    {
      action: 'list employees (/employees)',
      run: (ctx) => new HrmEmployeeController(ctx).listEmployees(req),
      allowed: ['hrNoSalary', 'hrSalary', 'admin'],
    },
    {
      action: 'view salary grades (hrm.salary.read)',
      run: (ctx) => new HrmSalaryController(ctx, {} as never).listGrades(req),
      allowed: ['hrSalary', 'admin'],
    },
    {
      action: 'view payroll periods (hrm.payroll.read)',
      run: (ctx) => new HrmPayrollController(ctx).listPeriods(req),
      allowed: ['hrSalary', 'admin'],
    },
  ];

  for (const gate of gates)
    describe(gate.action, () => {
      for (const role of roleNames)
        it(`${role}: ${gate.allowed.includes(role) ? 'allowed' : 'forbidden'}`, async () => {
          const ctx = new StubContext(ROLES[role], fakePool());
          const result = await outcome(() => gate.run(ctx));
          expect(result.allowed).toBe(gate.allowed.includes(role));
        });
    });
});

describe('HRM permission matrix: salary fields in employee payloads', () => {
  const canSeeSalary: RoleName[] = ['hrSalary', 'admin'];

  for (const role of ['hrNoSalary', 'hrSalary', 'admin'] as RoleName[]) {
    it(`${role}: other employee profile ${canSeeSalary.includes(role) ? 'includes' : 'omits'} salary fields`, async () => {
      const ctx = new StubContext(ROLES[role], fakePool());
      const data = bodyOf(
        await new HrmEmployeeController(ctx).getEmployeeProfile(
          req,
          OTHER_EMPLOYEE,
        ),
      );
      const visible = canSeeSalary.includes(role);
      expect(data.salaryGrade).toEqual(visible ? 'Ngach 5' : null);
      expect(data.contracts[0].baseSalary).toEqual(visible ? 20000000 : null);
      expect(data.contracts[0].issuedSnapshot).toEqual(
        visible ? { baseSalary: 20000000 } : null,
      );
    });
    it(`${role}: /employees list ${canSeeSalary.includes(role) ? 'includes' : 'omits'} salaryGrade for others`, async () => {
      const ctx = new StubContext(ROLES[role], fakePool());
      const data = bodyOf(
        await new HrmEmployeeController(ctx).listEmployees(req),
      );
      const other = data.find((p: any) => p.employeeId === OTHER_EMPLOYEE);
      expect(other.salaryGrade).toEqual(
        canSeeSalary.includes(role) ? 'Ngach 5' : null,
      );
    });
    it(`${role}: contracts endpoint ${canSeeSalary.includes(role) ? 'includes' : 'omits'} baseSalary`, async () => {
      const ctx = new StubContext(ROLES[role], fakePool());
      const data = bodyOf(
        await new HrmEmployeeController(ctx).getEmployeeContracts(
          req,
          OTHER_EMPLOYEE,
        ),
      );
      expect(data[0].baseSalary).toEqual(
        canSeeSalary.includes(role) ? 20000000 : null,
      );
    });
  }

  it('an employee without hrm.salary.read still sees their own salary data', async () => {
    const ctx = new StubContext(ROLES.self, fakePool());
    const profile = bodyOf(
      await new HrmEmployeeController(ctx).getEmployeeProfile(
        req,
        OWN_EMPLOYEE,
      ),
    );
    expect(profile.salaryGrade).toBe('Ngach 5');
    const contracts = bodyOf(
      await new HrmEmployeeController(ctx).getEmployeeContracts(
        req,
        OWN_EMPLOYEE,
      ),
    );
    expect(contracts[0].baseSalary).toBe(20000000);
  });
});

describe('HRM permission matrix: approving requests (scope x role)', () => {
  const OWNER_USER = 'user-staff';
  const deps = (owner: string, subordinates: string[]): HrmApprovalDeps => ({
    tenantId: 't',
    orgScope: {
      subordinateUserIds: async () => new Set(subordinates),
    },
    db: {
      query: async (sql: string) => {
        if (sql.includes('to_regclass'))
          return { rows: [{ ready: false }], rowCount: 1 };
        if (sql.includes('procedure_links')) return { rows: [], rowCount: 0 };
        return { rows: [{ employee_id: 'e', user_id: owner }], rowCount: 1 };
      },
    } as never,
  });
  const actor = (role: RoleName) => ({
    userId: USER,
    permissions: ROLES[role] as readonly string[],
  });
  const decide = (role: RoleName, owner: string, subordinates: string[]) =>
    assertCanDecide(
      actor(role),
      { id: 'r1' },
      'leave',
      deps(owner, subordinates),
    );

  it('only roles with hrm.leave.approve can approve at all', () => {
    expect(ROLES.self).not.toContain('hrm.leave.approve');
    expect(ROLES.hrNoSalary).not.toContain('hrm.leave.approve');
    expect(ROLES.hrSalary).not.toContain('hrm.leave.approve');
    expect(ROLES.managerApprove).toContain('hrm.leave.approve');
    expect(ROLES.managerApprove).not.toContain('hrm.leave.approve.all');
    expect(ROLES.managerAll).toContain('hrm.leave.approve.all');
  });

  it('manager with approve (not .all): in-scope request passes', async () => {
    await expect(
      decide('managerApprove', OWNER_USER, [OWNER_USER]),
    ).resolves.toBeUndefined();
  });
  it('manager with approve (not .all): out-of-scope request is rejected', async () => {
    await expect(
      decide('managerApprove', OWNER_USER, []),
    ).rejects.toMatchObject({
      response: { code: APPROVAL_OUT_OF_SCOPE },
    });
    await expect(
      decide('managerApprove', OWNER_USER, ['someone-else']),
    ).rejects.toMatchObject({ response: { code: APPROVAL_OUT_OF_SCOPE } });
  });
  it('manager with .all: any request in the tenant passes', async () => {
    await expect(decide('managerAll', OWNER_USER, [])).resolves.toBeUndefined();
  });
  it('hrm.manage admin: any request passes', async () => {
    await expect(decide('admin', OWNER_USER, [])).resolves.toBeUndefined();
  });
  for (const role of ['managerApprove', 'managerAll', 'admin'] as RoleName[])
    it(`${role}: approving their own request is forbidden`, async () => {
      await expect(decide(role, USER, [USER])).rejects.toMatchObject({
        response: { code: SELF_APPROVAL_FORBIDDEN },
      });
    });
});

describe('HRM permission matrix: approval scope warning (no reporting line)', () => {
  it('flags an approver without any subordinate and without .all', () => {
    const status = describeApprovalScope(ROLES.managerApprove, 0);
    expect(status).toMatchObject({
      canApprove: true,
      approveAll: false,
      noReportingLine: true,
    });
    expect(status.message).toContain('Chưa khai báo người quản lý trực tiếp');
  });
  it('does not warn when the approver has subordinates or approves everything', () => {
    expect(describeApprovalScope(ROLES.managerApprove, 3).noReportingLine).toBe(
      false,
    );
    expect(describeApprovalScope(ROLES.managerAll, 0).noReportingLine).toBe(
      false,
    );
    expect(describeApprovalScope(ROLES.admin, 0).noReportingLine).toBe(false);
  });
  it('does not warn people who cannot approve anything', () => {
    expect(describeApprovalScope(ROLES.self, 0)).toMatchObject({
      canApprove: false,
      noReportingLine: false,
      message: null,
    });
  });
});
