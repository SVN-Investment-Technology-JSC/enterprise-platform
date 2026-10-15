import type {
  ProcedureInstance,
  ProcedureRaciAssignment,
} from '@enterprise-platform/contracts-procedure-engine';
import { buildInstanceProgress } from './procedure-progress.js';
import { isProcedureParticipant, type ProcedureActor } from './procedure-authorization.js';

const DEPARTMENTS = ['Phòng Kỹ thuật', 'Phòng Kinh doanh', 'Phòng Hành chính', 'Phòng Kế toán', 'Phòng Vận hành'];

const assignment = (
  id: string,
  role: ProcedureRaciAssignment['role'],
  subjectType: ProcedureRaciAssignment['subjectType'],
  subjectId: string,
  subjectLabel?: string,
): ProcedureRaciAssignment => ({ id, role, subjectType, subjectId, subjectLabel });

/** Đơn cá nhân của `starter`: B1 (S) đã xong, B2 (A) Tổng Giám đốc đang chờ duyệt. */
function personalRequest(stepOneAssignments: ProcedureRaciAssignment[]): ProcedureInstance {
  return {
    id: 'instance',
    code: 'PR-1',
    title: 'Đơn cá nhân',
    definitionId: 'def',
    definitionCode: 'DEF',
    definitionName: 'Đơn',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 'step-2',
    initiatedBy: 'starter',
    startedAt: '2026-10-15T02:00:00.000Z',
    activity: [
      { id: 'a1', action: 'start', actorId: 'starter', actorName: 'Nguyễn Văn A', summary: 'Khởi tạo', createdAt: '2026-10-15T02:00:00.000Z' },
    ],
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'd1',
        key: 'S1',
        order: 1,
        name: 'Khởi tạo',
        status: 'completed',
        currentRoleStage: null,
        assignments: stepOneAssignments,
      },
      {
        id: 'step-2',
        definitionStepId: 'd2',
        key: 'S2',
        order: 2,
        name: 'Quản lý duyệt',
        status: 'active',
        currentRoleStage: 'A',
        assignments: [
          assignment('b1', 'A', 'position', 'pos-tgd', 'Tổng Giám đốc'),
          assignment('b2', 'I', 'position', 'pos-hr', 'Nhân sự'),
        ],
      },
    ],
  } as ProcedureInstance;
}

const actor = (over: Partial<ProcedureActor>): ProcedureActor => ({
  tenantId: 't',
  userId: 'other',
  displayName: 'Khác',
  membershipId: 'm',
  canDesign: false,
  canPublish: false,
  canCreateInstances: false,
  isOverride: false,
  organizationUnitIds: [],
  positionIds: [],
  ...over,
});

describe('B1 gán nhiều phòng ban ở vai S', () => {
  const instance = personalRequest(
    DEPARTMENTS.map((name, i) => assignment(`s${i}`, 'S', 'position', `pos-${i}`, name)),
  );

  it('nhãn bước 1 là người khởi tạo thật, không liệt kê các phòng ban', () => {
    const [step1, step2] = buildInstanceProgress(instance).steps;
    expect(step1.roleTitle).toBe('Nguyễn Văn A');
    for (const name of DEPARTMENTS) expect(step1.roleTitle).not.toContain(name);
    expect(step2.roleTitle).toBe('Tổng Giám đốc');
  });

  it('thành viên phòng ban được gán ở S không trở thành người tham gia đơn cá nhân', () => {
    const outsider = actor({ positionIds: ['pos-0', 'pos-3'] });
    expect(isProcedureParticipant(instance, outsider)).toBe(false);
  });

  it('người khởi tạo, người duyệt bước sau và quản trị vẫn là người tham gia', () => {
    expect(isProcedureParticipant(instance, actor({ userId: 'starter' }))).toBe(true);
    expect(isProcedureParticipant(instance, actor({ positionIds: ['pos-tgd'] }))).toBe(true);
    expect(isProcedureParticipant(instance, actor({ isOverride: true }))).toBe(true);
  });

  it('đơn vị gán ở S cũng không cấp quyền tham gia', () => {
    const byUnit = personalRequest([assignment('s', 'S', 'organization_unit', 'unit-ky-thuat', 'Phòng Kỹ thuật')]);
    expect(isProcedureParticipant(byUnit, actor({ organizationUnitIds: ['unit-ky-thuat'] }))).toBe(false);
  });
});

describe('B1 gán "Toàn bộ nhân viên" (everyone) ở vai S', () => {
  const instance = personalRequest([assignment('s', 'S', 'everyone', 'everyone')]);

  it('nhãn bước 1 là người khởi tạo, không rơi về chữ "S"', () => {
    const [step1] = buildInstanceProgress(instance).steps;
    expect(step1.roleTitle).toBe('Nguyễn Văn A');
  });

  it('nhân viên khác không có mặt trong đơn của người khác', () => {
    expect(isProcedureParticipant(instance, actor({ positionIds: ['pos-0'] }))).toBe(false);
  });

  it('người khởi tạo và người duyệt bước sau vẫn có mặt', () => {
    expect(isProcedureParticipant(instance, actor({ userId: 'starter' }))).toBe(true);
    expect(isProcedureParticipant(instance, actor({ positionIds: ['pos-tgd'] }))).toBe(true);
  });

  it('thiếu nhật ký khởi tạo thì dùng nhãn dự phòng', () => {
    const noLog = { ...instance, activity: [] } as ProcedureInstance;
    expect(buildInstanceProgress(noLog).steps[0].roleTitle).toBe('Người khởi tạo');
  });
});

describe('nhãn người xử lý các bước còn lại', () => {
  it('bước đã xong hiện người duyệt thật, bước đang chạy chỉ hiện pha hiện tại (bỏ I)', () => {
    const instance = personalRequest([assignment('s', 'S', 'everyone', 'everyone')]);
    instance.steps[1].status = 'completed';
    instance.activity.unshift({
      id: 'a2', action: 'approve', actorId: 'tgd-user', actorName: 'Trần Tổng', summary: 'Duyệt', createdAt: '2026-10-15T03:00:00.000Z', stepInstanceId: 'step-2',
    } as never);
    expect(buildInstanceProgress(instance).steps[1].roleTitle).toBe('Trần Tổng');
  });

  it('bước chỉ có vai I thì không có nhãn', () => {
    const instance = personalRequest([assignment('i', 'I', 'position', 'p', 'Nhân sự')]);
    expect(buildInstanceProgress(instance).steps[0].roleTitle).toBe('');
  });
});
