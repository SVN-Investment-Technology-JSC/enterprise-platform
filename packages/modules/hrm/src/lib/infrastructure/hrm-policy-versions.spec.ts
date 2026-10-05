import { ConflictException } from '@nestjs/common';
import {
  inheritConfig,
  planPolicyPublish,
  planVersionRemoval,
  readPolicyConfig,
  versionStatusByDate,
  type PolicyVersionLike,
} from './hrm-policy-versions.js';
import { pickPolicyVersion } from './hrm-time.js';

const v = (
  id: string,
  from: string,
  to: string | null,
  extra: Partial<PolicyVersionLike> = {},
): PolicyVersionLike => ({
  id,
  version_no: Number(id.replace(/\D/g, '')) || 1,
  effective_from: from,
  effective_to: to,
  config_json: {},
  status: 'ACTIVE',
  ...extra,
});
const company = { from: '2026-10-03', to: null, employeeIds: [] as string[] };

describe('planPolicyPublish', () => {
  it('closes the open version', () => {
    const plan = planPolicyPublish([v('a1', '2026-01-01', null)], company);
    expect(plan.toClose.map((x) => x.id)).toEqual(['a1']);
    expect(plan.conflicts).toHaveLength(0);
  });
  it('rejects a version with a future end date that intersects', () => {
    const plan = planPolicyPublish(
      [v('a1', '2026-01-01', '2026-12-31')],
      company,
    );
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.toClose).toHaveLength(0);
  });
  it('rejects when an existing version starts on or after the new start', () => {
    const plan = planPolicyPublish([v('a2', '2030-01-01', null)], company);
    expect(plan.conflicts[0].id).toBe('a2');
  });
  it('ignores non-intersecting and draft versions', () => {
    const plan = planPolicyPublish(
      [
        v('a1', '2025-01-01', '2026-10-02'),
        v('a2', '2026-01-01', null, { status: 'DRAFT' }),
      ],
      company,
    );
    expect(plan.toClose).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });
  it('only collides employee scopes that share an employee', () => {
    const group = v('a1', '2026-01-01', null, {
      config_json: { employeeIds: ['e1', 'e2'] },
    });
    expect(
      planPolicyPublish([group], { ...company, employeeIds: ['e2'] }).toClose,
    ).toHaveLength(1);
    expect(
      planPolicyPublish([group], { ...company, employeeIds: ['e9'] }).toClose,
    ).toHaveLength(0);
    // a company-wide version stays untouched by a pilot for one group
    expect(
      planPolicyPublish([v('a3', '2026-01-01', null)], {
        ...company,
        employeeIds: ['e1'],
      }).toClose,
    ).toHaveLength(0);
  });
  it('closes open versions from two policy records of the same type', () => {
    const plan = planPolicyPublish(
      [
        v('a1', '2026-01-01', null, { policy_id: 'p1' }),
        v('b1', '2026-10-03', null, { policy_id: 'p2' }),
      ],
      { ...company, from: '2026-11-01' },
    );
    expect(plan.toClose.map((x) => x.id).sort()).toEqual(['a1', 'b1']);
  });
  it('warns about a gap when the new version is bounded', () => {
    const plan = planPolicyPublish([v('a1', '2026-01-01', null)], {
      ...company,
      to: '2026-12-31',
    });
    expect(plan.warnings).toHaveLength(1);
  });
});

describe('config helpers', () => {
  it('reads snake_case and camelCase keys', () => {
    expect(readPolicyConfig({ break_minutes: 60, requireGps: true })).toEqual({
      breakMinutes: 60,
      requireGps: true,
    });
  });
  it('inherits undeclared keys from the running version', () => {
    const merged = inheritConfig(
      {
        break_minutes: 60,
        grace_late_minutes: 5,
        timezone: 'Asia/Ho_Chi_Minh',
      },
      { timezone: 'Asia/Bangkok', graceLateMinutes: 10 },
    );
    expect(merged).toEqual({
      break_minutes: 60,
      timezone: 'Asia/Bangkok',
      graceLateMinutes: 10,
    });
  });
});

describe('resolver and removal rules', () => {
  const row = (id: string, ids: string[] = []) => ({
    id,
    config_json: { employeeIds: ids },
    version_no: 1,
    effective_from: '2026-01-01',
    effective_to: null,
    policy_code: 'X',
  });
  it('lists the conflicting versions in the error', () => {
    expect(() =>
      pickPolicyVersion(
        [row('1'), row('2')],
        'ATTENDANCE',
        '2026-10-03',
        'e1',
      ),
    ).toThrow(/ATTENDANCE.*X v1/);
  });
  it('prefers an employee-scoped version over company-wide', () => {
    expect(
      pickPolicyVersion(
        [row('1'), row('2', ['e1'])],
        'ATTENDANCE',
        '2026-10-03',
        'e1',
      )?.id,
    ).toBe('2');
    expect(
      pickPolicyVersion(
        [row('1'), row('2', ['e1'])],
        'ATTENDANCE',
        '2026-10-03',
        'e9',
      )?.id,
    ).toBe('1');
  });

  const today = '2026-10-05';
  const v1 = v('p1', '2026-01-01', '2029-12-31', { status: 'SUPERSEDED' });
  const v2 = v('p2', '2030-01-01', null);
  it('reopens the previous version when the newest future version is removed', () => {
    const plan = planVersionRemoval(v2, [v1, v2], today);
    expect(plan.previous?.id).toBe('p1');
    expect(plan.reopenTo).toBeNull();
  });
  it('blocks removing a version in the middle of the chain', () => {
    const v3 = v('p3', '2031-01-01', null);
    const mid = { ...v2, effective_to: '2030-12-31' };
    expect(() => planVersionRemoval(mid, [v1, mid, v3], today)).toThrow(
      ConflictException,
    );
  });
  it('blocks removing a version already in effect', () => {
    expect(() =>
      planVersionRemoval(v('p1', '2026-01-01', null), [], today),
    ).toThrow(ConflictException);
  });
  it('computes status by date', () => {
    expect(versionStatusByDate(v2, today)).toBe('UPCOMING');
    expect(versionStatusByDate(v1, today)).toBe('CURRENT');
    expect(versionStatusByDate(v('x', '2025-01-01', '2025-12-31'), today)).toBe(
      'EXPIRED',
    );
  });
});
