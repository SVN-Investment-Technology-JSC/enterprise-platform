import type { OrgFacts, OrgHolder } from './hrm-chief-fallback.js';
import { superiorUserIdsOf } from './hrm-chief-fallback.js';
import { directApproverUserIds, fallbackHolderUserIds, managerUserIdsOf } from './hrm-direct-approvers.js';

const holder = (positionId: string, employeeId: string, over: Partial<OrgHolder> = {}): OrgHolder => ({
  positionId,
  isPrimary: true,
  overrideId: null,
  employeeId,
  userId: `u-${employeeId}`,
  name: employeeId,
  email: null,
  code: null,
  inactive: false,
  ...over,
});

const facts = (holders: OrgHolder[]): OrgFacts => ({
  positions: [
    { id: 'staff', name: 'Nhân viên', reportsToId: 'lead' },
    { id: 'lead', name: 'Trưởng nhóm', reportsToId: 'head' },
    { id: 'head', name: 'Trưởng phòng', reportsToId: 'ceo' },
    { id: 'ceo', name: 'Tổng giám đốc', reportsToId: null },
    { id: 'deputy', name: 'Phụ trách dự phòng', reportsToId: null },
  ],
  holders,
  employees: [],
  lastResortPositionId: 'ceo',
});

describe('managerUserIdsOf', () => {
  it('returns the holders of the first occupied position on the reporting chain', () => {
    const f = facts([holder('staff', 'e1'), holder('lead', 'e2'), holder('head', 'e3')]);
    expect(managerUserIdsOf(f, 'e1')).toEqual(['u-e2']);
  });

  it('skips vacant and inactive positions', () => {
    const f = facts([holder('staff', 'e1'), holder('lead', 'e2', { inactive: true }), holder('head', 'e3')]);
    expect(managerUserIdsOf(f, 'e1')).toEqual(['u-e3']);
  });

  it('falls back to the chief when nobody on the chain is eligible', () => {
    const f = facts([holder('staff', 'e1'), holder('ceo', 'e9')]);
    expect(managerUserIdsOf(f, 'e1')).toEqual(['u-e9']);
  });

  it('never returns the requester', () => {
    const f = facts([holder('ceo', 'e9')]);
    expect(managerUserIdsOf(f, 'e9')).toEqual([]);
  });
});

describe('superiorUserIdsOf', () => {
  it('returns the holders of every level on the reporting chain, not just the nearest', () => {
    const f = facts([holder('staff', 'e1'), holder('lead', 'e2'), holder('head', 'e3'), holder('ceo', 'e4')]);
    expect(superiorUserIdsOf(f, 'e1').sort()).toEqual(['u-e2', 'u-e3', 'u-e4']);
  });

  it('skips vacant and inactive levels but keeps climbing', () => {
    const f = facts([holder('staff', 'e1'), holder('lead', 'e2', { inactive: true }), holder('ceo', 'e4')]);
    expect(superiorUserIdsOf(f, 'e1')).toEqual(['u-e4']);
  });

  it('never returns the requester or people outside the chain', () => {
    const f = facts([holder('staff', 'e1'), holder('lead', 'e2'), holder('deputy', 'e7'), holder('lead', 'e1')]);
    expect(superiorUserIdsOf(f, 'e1')).toEqual(['u-e2']);
  });
});

describe('fallbackHolderUserIds', () => {
  it('returns active holders of the fallback position except the requester', () => {
    const f = facts([
      holder('deputy', 'e5'),
      holder('deputy', 'e6', { inactive: true }),
      holder('deputy', 'e1'),
    ]);
    expect(fallbackHolderUserIds(f, 'deputy', 'e1')).toEqual(['u-e5']);
    expect(fallbackHolderUserIds(f, null, 'e1')).toEqual([]);
  });
});

describe('directApproverUserIds', () => {
  it('returns an empty list when the organisation cannot be read', async () => {
    const db = { query: jest.fn(async () => { throw new Error('boom'); }) };
    await expect(
      directApproverUserIds(db as never, 'tenant', 'ot', 'request', 'employee'),
    ).resolves.toEqual([]);
  });
});
