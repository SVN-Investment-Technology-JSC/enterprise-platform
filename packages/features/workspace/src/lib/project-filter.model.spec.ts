import type { DirectoryOrgNode, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import { orgUnitOptions } from './org-units';
import {
  activeConditionCount,
  matchProjectFilter,
  type FilterCondition,
  type ProjectFilter,
} from './project-filter.model';

const project = (overrides: Partial<ProjectSummary> = {}): ProjectSummary =>
  ({
    id: 'p1',
    code: 'DA_DVTN_0001',
    name: 'Thí nghiệm trạm 110kV',
    status: 'active',
    ownerUserId: 'u1',
    progressPercent: 40,
    metadata: {},
    createdBy: 'u1',
    createdAt: '2026-10-21T03:00:00.000Z',
    updatedAt: '2026-10-21T03:00:00.000Z',
    totalItems: 5,
    closedItems: 2,
    overdueItems: 1,
    projectType: 'Dịch vụ thí nghiệm',
    orgUnitId: 'kt-1',
    tagIds: ['t1'],
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    ...overrides,
  }) as ProjectSummary;

const nodes: DirectoryOrgNode[] = [
  { id: 'ct', name: 'Công ty', kind: 'unit' },
  { id: 'kt', name: 'Khối kỹ thuật', parentId: 'ct', kind: 'unit' },
  { id: 'kt-1', name: 'Phòng thí nghiệm', parentId: 'kt', kind: 'unit' },
  { id: 'pos', name: 'Trưởng phòng', parentId: 'kt-1', kind: 'position' },
  { id: 'tv', name: 'Trung tâm Tư vấn', parentId: 'ct', kind: 'unit' },
];
// Thứ Tư 21/10/2026.
const context = { today: new Date(2026, 9, 21), orgNodes: nodes };
let seq = 0;
const cond = (condition: Omit<FilterCondition, 'id'>): FilterCondition => ({ id: `c${(seq += 1)}`, ...condition });
const one = (...conditions: FilterCondition[]): ProjectFilter => ({ keyword: '', groups: [conditions] });
const match = (filter: ProjectFilter, overrides?: Partial<ProjectSummary>) =>
  matchProjectFilter(project(overrides), filter, context);

describe('matchProjectFilter', () => {
  it('bộ lọc rỗng hay điều kiện chưa nhập đủ giá trị thì khớp mọi dự án', () => {
    expect(match({ keyword: '', groups: [] })).toBe(true);
    expect(match(one(cond({ field: 'name', operator: 'contains', value: ' ' })))).toBe(true);
  });

  it('từ khoá không dấu, tìm trong mã, tên, mô tả, nhóm', () => {
    expect(match({ keyword: 'tram 110', groups: [] })).toBe(true);
    expect(match({ keyword: 'dvtn_0001', groups: [] })).toBe(true);
    expect(match({ keyword: 'kiem dinh', groups: [] })).toBe(false);
  });

  it('chữ: chứa, không chứa, bằng, bắt đầu bằng, không áp dụng', () => {
    expect(match(one(cond({ field: 'name', operator: 'contains', value: 'trạm' })))).toBe(true);
    expect(match(one(cond({ field: 'name', operator: 'not_contains', value: 'tram' })))).toBe(false);
    expect(match(one(cond({ field: 'code', operator: 'starts_with', value: 'da_dvtn' })))).toBe(true);
    expect(match(one(cond({ field: 'code', operator: 'equals', value: 'DA_DVTN_0001' })))).toBe(true);
  });

  it('phòng ban "thuộc" tính cả phòng con; chức danh không phải phòng', () => {
    expect(match(one(cond({ field: 'orgUnitId', operator: 'in', values: ['kt'] })))).toBe(true);
    expect(match(one(cond({ field: 'orgUnitId', operator: 'in', values: ['tv'] })))).toBe(false);
    expect(match(one(cond({ field: 'orgUnitId', operator: 'not_in', values: ['ct'] })))).toBe(false);
    expect(match(one(cond({ field: 'orgUnitId', operator: 'empty' })), { orgUnitId: undefined })).toBe(true);
  });

  it('nhãn và nhóm: thuộc / không thuộc / chưa phân nhóm', () => {
    expect(match(one(cond({ field: 'tagIds', operator: 'in', values: ['t2', 't1'] })))).toBe(true);
    expect(match(one(cond({ field: 'projectType', operator: 'not_in', values: ['Dịch vụ thí nghiệm'] })))).toBe(false);
    expect(match(one(cond({ field: 'projectType', operator: 'empty' })), { projectType: undefined })).toBe(true);
  });

  it('ngày: bằng, trước, sau, trong khoảng, tuần / tháng / năm, không áp dụng', () => {
    expect(match(one(cond({ field: 'startDate', operator: 'eq', value: '2026-10-01' })))).toBe(true);
    expect(match(one(cond({ field: 'endDate', operator: 'after_today' })))).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'before_today' })))).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'between', value: '2026-10-05', value2: '2026-09-01' })))).toBe(true);
    expect(match(one(cond({ field: 'createdAt', operator: 'today' })))).toBe(true);
    expect(match(one(cond({ field: 'createdAt', operator: 'this_week' })))).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'this_month' })))).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'last_month' })))).toBe(false);
    expect(match(one(cond({ field: 'startDate', operator: 'last_month' })), { startDate: '2026-09-30' })).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'last_week' })), { startDate: '2026-10-12' })).toBe(true);
    expect(match(one(cond({ field: 'startDate', operator: 'last_year' })))).toBe(false);
    expect(match(one(cond({ field: 'endDate', operator: 'empty' })), { endDate: undefined })).toBe(true);
  });

  it('số: bằng, lớn hơn, nhỏ hơn, trong khoảng', () => {
    expect(match(one(cond({ field: 'progressPercent', operator: 'gt', value: '30' })))).toBe(true);
    expect(match(one(cond({ field: 'overdueItems', operator: 'eq', value: '0' })))).toBe(false);
    expect(match(one(cond({ field: 'progressPercent', operator: 'between', value: '50', value2: '20' })))).toBe(true);
  });

  it('VÀ trong một nhóm, HOẶC giữa các nhóm', () => {
    const inTv = cond({ field: 'orgUnitId', operator: 'in', values: ['tv'] });
    const active = cond({ field: 'status', operator: 'in', values: ['active'] });
    expect(match(one(inTv, active))).toBe(false);
    expect(match({ keyword: '', groups: [[inTv], [active]] })).toBe(true);
    expect(activeConditionCount({ keyword: 'x', groups: [[inTv], [active, cond({ field: 'name', operator: 'contains' })]] })).toBe(3);
  });
});

describe('orgUnitOptions', () => {
  it('chỉ đơn vị, cha trước con, kèm đường dẫn', () => {
    expect(orgUnitOptions(nodes)).toEqual([
      { value: 'ct', label: 'Công ty' },
      { value: 'kt', label: 'Khối kỹ thuật', description: 'Công ty' },
      { value: 'kt-1', label: 'Phòng thí nghiệm', description: 'Công ty › Khối kỹ thuật' },
      { value: 'tv', label: 'Trung tâm Tư vấn', description: 'Công ty' },
    ]);
  });
});
