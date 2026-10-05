import { resolveProcedureAssigneeUserIds } from './procedure-assignee-resolver.js';

/**
 * root (đơn vị, có trưởng P-head-root)
 *   ├── U-a (đơn vị): P-head-a (trưởng), P-staff-a
 *   └── U-b (đơn vị, KHÔNG có trưởng) -> trách nhiệm leo lên root
 */
const organization = {
  units: [
    { id: 'root', typeCategory: 'unit' },
    { id: 'P-head-root', typeCategory: 'position', parentId: 'root' },
    { id: 'U-a', typeCategory: 'unit', parentId: 'root' },
    { id: 'P-head-a', typeCategory: 'position', parentId: 'U-a' },
    { id: 'P-staff-a', typeCategory: 'position', parentId: 'U-a' },
    { id: 'U-b', typeCategory: 'unit', parentId: 'root' },
  ],
  members: [
    { membershipId: 'm-head-root', userId: 'u-head-root', unitId: 'P-head-root', isHead: true },
    { membershipId: 'm-head-a', userId: 'u-head-a', unitId: 'P-head-a', isHead: true },
    { membershipId: 'm-staff-a', userId: 'u-staff-a', unitId: 'P-staff-a', isHead: false },
  ],
  membershipSubjects: {
    'm-head-root': { organizationUnitIds: ['P-head-root'], positionIds: ['P-head-root'] },
    'm-head-a': { organizationUnitIds: ['P-head-a'], positionIds: ['P-head-a'] },
    'm-staff-a': { organizationUnitIds: ['P-staff-a'], positionIds: ['P-staff-a'] },
  },
};

const unit = (subjectId: string, role: string) => ({ subjectType: 'organization_unit', subjectId, role });

describe('resolveProcedureAssigneeUserIds', () => {
  it('routes a unit assignment to the unit head for every role except S', () => {
    expect(resolveProcedureAssigneeUserIds([unit('U-a', 'A')], organization)).toEqual(['u-head-a']);
    expect(resolveProcedureAssigneeUserIds([unit('U-a', 'R')], organization)).toEqual(['u-head-a']);
  });

  it('routes an S assignment on a unit to every member position under it', () => {
    expect(resolveProcedureAssigneeUserIds([unit('U-a', 'S')], organization).sort()).toEqual([
      'u-head-a',
      'u-staff-a',
    ]);
  });

  it('escalates a headless unit to the nearest headed ancestor', () => {
    expect(resolveProcedureAssigneeUserIds([unit('U-b', 'A')], organization)).toEqual(['u-head-root']);
  });

  it('resolves a position assignment to its holder and keeps direct users', () => {
    const result = resolveProcedureAssigneeUserIds(
      [
        { subjectType: 'position', subjectId: 'P-staff-a', role: 'A' },
        { subjectType: 'user', subjectId: 'u-direct', role: 'A' },
      ],
      organization,
    );
    expect(result.sort()).toEqual(['u-direct', 'u-staff-a']);
  });

  it('returns only direct users when the organization payload is unusable', () => {
    expect(
      resolveProcedureAssigneeUserIds(
        [unit('U-a', 'A'), { subjectType: 'user', subjectId: 'u-direct', role: 'A' }],
        null,
      ),
    ).toEqual(['u-direct']);
    expect(resolveProcedureAssigneeUserIds([unit('U-a', 'A')], { units: 'x', members: 5 })).toEqual([]);
  });
});
