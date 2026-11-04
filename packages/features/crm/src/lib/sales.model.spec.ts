import { CRM_NO_CAPABILITIES, type CustomerTimelineEntry, OpportunityBoard, OpportunitySummary, Pipeline, PipelineStage, StageRef } from '@enterprise-platform/contracts-crm';
import {
  buildSkipStages,
  canDropStage,
  canEditStageAssignee,
  canLeaveCurrentStage,
  canSkipPlanItem,
  groupByCustomer,
  isDueOverdue,
  skippableStartStages,
  stageAssigneeWarning,
  defaultPipeline,
  describeStageError,
  describeTimelineEntry,
  findStage,
  formatMoney,
  groupCodeFromName,
  isClosedStage,
  isOverdue,
  moveCard,
  normalizeGroupName,
  personName,
  replaceCard,
  stageFilterOptions,
  stageLabelByCode,
  stageNeedsReason,
  stageOptions,
  stageTone,
  taxCodeLooksValid,
} from './sales.model';

const ref = (code: string, semantic: StageRef['semantic'] = 'OPEN'): StageRef => ({ id: `id-${code}`, code, name: `Tên ${code}`, semantic });
const pipelineRef = { id: 'p1', code: 'SALES_STANDARD', name: 'Bán hàng' };

const card = (id: string, stage: string, value = 100): OpportunitySummary => ({
  id, name: id, customerId: 'c', customerCode: 'KH1', customerName: 'Khách', stage, pipeline: pipelineRef, stageInfo: ref(stage),
  probability: 0, expectedValue: value, expectedCloseDate: null, ownerUserId: 'u', version: 1, updatedAt: '',
});

const stage = (code: string, semantic: StageRef['semantic'], next: string[], extra: Partial<PipelineStage> = {}): PipelineStage => ({
  id: `id-${code}`, pipelineId: 'p1', code, name: `Tên ${code}`, semantic, sortOrder: 0, defaultProbability: 0, active: true,
  skippable: false, assigneeRule: 'NONE', assigneeParam: null, nextStageIds: next.map((item) => `id-${item}`), requirements: [], ...extra,
});

const pipeline: Pipeline = {
  ...pipelineRef, profile: 'STANDARD', isDefault: true, active: true, sortOrder: 0, careSuggestion: true,
  stages: [
    stage('NEW', 'OPEN', ['CONTACTED', 'LOST']),
    stage('CONTACTED', 'OPEN', ['NEW', 'LOST', 'OFF']),
    stage('OFF', 'OPEN', ['WON'], { active: false }),
    stage('WON', 'WON', []),
    stage('LOST', 'LOST', [], { requirements: [{ kind: 'REASON', ref: '', required: true, message: 'Cần lý do', sortOrder: 0 }] }),
  ],
};

const board: OpportunityBoard = {
  pipeline: pipelineRef,
  perStageLimit: 50,
  columns: [
    { stage: 'NEW', stageInfo: ref('NEW'), total: 2, totalValue: 300, items: [card('a', 'NEW'), card('b', 'NEW', 200)] },
    { stage: 'CONTACTED', stageInfo: ref('CONTACTED'), total: 0, totalValue: 0, items: [] },
    { stage: 'LOST', stageInfo: ref('LOST', 'LOST'), total: 0, totalValue: 0, items: [] },
  ],
};

describe('kanban theo luồng', () => {
  it('chỉ thả được theo bước chuyển cấu hình, không vào giai đoạn tắt', () => {
    expect(canDropStage(pipeline, 'NEW', 'CONTACTED')).toBe(true);
    expect(canDropStage(pipeline, 'NEW', 'WON')).toBe(false);
    expect(canDropStage(pipeline, 'CONTACTED', 'OFF')).toBe(false);
    expect(canDropStage(pipeline, 'NEW', 'NEW')).toBe(false);
    expect(canDropStage(pipeline, 'NEW', 'KHONG_CO')).toBe(false);
    expect(canDropStage(undefined, 'NEW', 'CONTACTED')).toBe(false);
  });

  it('chuyển lạc quan cập nhật hai cột, đổi stageInfo và giữ bảng cũ để hoàn tác', () => {
    const moved = moveCard(board, 'b', 'CONTACTED');
    expect(moved?.from).toBe('NEW');
    expect(moved?.board.columns[0]).toMatchObject({ total: 1, totalValue: 100 });
    expect(moved?.board.columns[1]).toMatchObject({ total: 1, totalValue: 200 });
    expect(moved?.board.columns[1].items[0]).toMatchObject({ id: 'b', stage: 'CONTACTED', stageInfo: { code: 'CONTACTED' } });
    expect(board.columns[0].items).toHaveLength(2);
    expect(moveCard(board, 'a', 'NEW')).toBeUndefined();
    expect(moveCard(board, 'a', 'KHONG_CO_COT')).toBeUndefined();
    expect(moveCard(board, 'khong-co', 'LOST')).toBeUndefined();
  });

  it('thay thẻ bằng bản server trả về', () => {
    const next = replaceCard(board, { ...card('a', 'NEW'), version: 5 });
    expect(next.columns[0].items[0].version).toBe(5);
  });

  it('giai đoạn cần lý do: nghĩa Thua hoặc điều kiện REASON bắt buộc', () => {
    expect(stageNeedsReason(findStage(pipeline, 'LOST'))).toBe(true);
    expect(stageNeedsReason(findStage(pipeline, 'CONTACTED'))).toBe(false);
    expect(stageNeedsReason({ semantic: 'OPEN', requirements: [{ kind: 'REASON', ref: '', required: true, message: '', sortOrder: 0 }] })).toBe(true);
    expect(stageNeedsReason({ semantic: 'OPEN', requirements: [{ kind: 'REASON', ref: '', required: false, message: '', sortOrder: 0 }] })).toBe(false);
    expect(stageNeedsReason(undefined)).toBe(false);
  });

  it('lựa chọn giai đoạn, luồng mặc định, nhãn và màu', () => {
    expect(stageOptions([ref('A'), ref('B')])).toEqual([{ value: 'A', label: 'Tên A' }, { value: 'B', label: 'Tên B' }]);
    expect(stageFilterOptions([pipeline], 'p1').map((item) => item.value)).toEqual(['NEW', 'CONTACTED', 'OFF', 'WON', 'LOST']);
    expect(stageFilterOptions([pipeline], 'khac')).toEqual([]);
    expect(defaultPipeline([{ ...pipeline, isDefault: false, id: 'x' }, pipeline])?.id).toBe('p1');
    expect(stageLabelByCode('QUOTING')).toBe('Báo giá');
    expect(stageLabelByCode('TENDER_OPEN')).toBe('TENDER_OPEN');
    expect(stageTone('WON')).toBe('success');
    expect(stageTone('LOST')).toBe('danger');
    expect(isClosedStage(ref('X', 'LOST'))).toBe(true);
    expect(isClosedStage(ref('X'))).toBe(false);
  });

  it('lỗi chuyển giai đoạn bằng tiếng Việt, liệt kê điều kiện thiếu', () => {
    const missing = [{ kind: 'FIELD', ref: 'budget', message: 'Cần nhập Ngân sách.' }, { kind: 'REASON', ref: '', message: 'Cần ghi lý do.' }];
    const text = describeStageError({ code: 'STAGE_REQUIREMENTS_NOT_MET', message: 'x', missing }, 'lỗi');
    expect(text).toContain('Còn thiếu: Cần nhập Ngân sách.; Cần ghi lý do.');
    expect(describeStageError({ code: 'INVALID_STAGE_TRANSITION', message: 'Không chuyển được.' }, 'lỗi')).toBe('Không chuyển được.');
    expect(describeStageError({ code: 'LOST_REASON_REQUIRED' }, 'lỗi')).toContain('lý do');
    expect(describeStageError(undefined, 'lỗi chung')).toBe('lỗi chung');
  });
});

describe('tiện ích hiển thị', () => {
  it('quá hạn chỉ khi đang mở và hạn đã qua', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(isOverdue({ status: 'OPEN', dueAt: '2026-10-27T09:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'DONE', dueAt: '2026-10-27T09:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'OPEN', dueAt: null }, now)).toBe(false);
  });

  it('tên người, tiền, MST', () => {
    expect(personName([{ userId: 'u1', displayName: 'Nguyễn Văn A' }], 'u1')).toBe('Nguyễn Văn A');
    expect(personName([], 'u2')).toBe('Người dùng khác');
    expect(formatMoney(1234567)).toMatch(/^1\.234\.567/);
    expect(formatMoney(null)).toBe('');
    expect(taxCodeLooksValid('0101234567-001')).toBe(true);
    expect(taxCodeLooksValid('0101')).toBe(false);
    expect(taxCodeLooksValid('')).toBe(true);
  });

  it('mô tả mục dòng thời gian, loại lạ không làm vỡ', () => {
    const changed: CustomerTimelineEntry = {
      kind: 'opportunity-stage-changed', id: 'h', at: '', actorId: null, opportunityId: 'o',
      opportunityName: 'Dự án A', fromStage: 'NEGOTIATION', toStage: 'LOST', reason: 'Giá cao',
    };
    expect(describeTimelineEntry(changed)).toEqual({ title: 'Dự án bán hàng "Dự án A": Đàm phán → Thua', detail: 'Lý do: Giá cao' });
    expect(describeTimelineEntry({ kind: 'quote-sent' } as unknown as CustomerTimelineEntry)).toEqual({ title: 'Sự kiện khác' });
  });
});

describe('mã và tên nhóm khách hàng', () => {
  it('sinh mã từ tên có dấu', () => {
    expect(groupCodeFromName('Đại lý cấp 1')).toBe('DAI-LY-CAP-1');
    expect(groupCodeFromName('  Khách (VIP)  ')).toBe('KHACH-VIP');
    expect(groupCodeFromName('???')).toBe('');
    expect(groupCodeFromName('a'.repeat(60))).toHaveLength(50);
  });

  it('so trùng tên không phân biệt hoa thường, dấu, khoảng trắng', () => {
    expect(normalizeGroupName('  Đại   LÝ ')).toBe(normalizeGroupName('dai ly'));
    expect(normalizeGroupName('Đại lý')).not.toBe(normalizeGroupName('Đại lý 2'));
  });
});

describe('kế hoạch giai đoạn và quyền thao tác', () => {
  const writer = { ...CRM_NO_CAPABILITIES, canWriteOpportunity: true };
  const opp = { ownerUserId: 'owner' };
  const plan = [
    { status: 'ACTIVE' as const, assigneeUserId: 'assignee' },
    { status: 'PENDING' as const, assigneeUserId: null },
  ];

  it('chỉ chủ dự án, crm.manage hoặc admin đổi được người đảm nhận', () => {
    expect(canEditStageAssignee(writer, 'owner', opp)).toBe(true);
    expect(canEditStageAssignee(writer, 'assignee', opp)).toBe(false);
    expect(canEditStageAssignee({ ...writer, canManage: true }, 'x', opp)).toBe(true);
    expect(canEditStageAssignee({ ...CRM_NO_CAPABILITIES, isTenantAdmin: true }, 'x', opp)).toBe(true);
    expect(canEditStageAssignee(CRM_NO_CAPABILITIES, 'owner', opp)).toBe(false);
  });

  it('chuyển hoặc bỏ qua giai đoạn: chủ, người đảm nhận giai đoạn hiện tại, crm.manage', () => {
    expect(canLeaveCurrentStage(writer, 'owner', opp, plan)).toBe(true);
    expect(canLeaveCurrentStage(writer, 'assignee', opp, plan)).toBe(true);
    expect(canLeaveCurrentStage(writer, 'other', opp, plan)).toBe(false);
    expect(canLeaveCurrentStage(writer, 'other', opp, undefined)).toBe(false);
    expect(canLeaveCurrentStage({ ...writer, canManage: true }, 'other', opp, plan)).toBe(true);
    expect(canLeaveCurrentStage(writer, 'pending-person', opp, [{ status: 'PENDING', assigneeUserId: 'pending-person' }])).toBe(false);
    expect(canLeaveCurrentStage(CRM_NO_CAPABILITIES, 'owner', opp, plan)).toBe(false);
  });

  it('chỉ bỏ qua giai đoạn cho phép, chưa tới, dự án còn mở', () => {
    expect(canSkipPlanItem({ skippable: true, status: 'PENDING' }, true)).toBe(true);
    expect(canSkipPlanItem({ skippable: false, status: 'PENDING' }, true)).toBe(false);
    expect(canSkipPlanItem({ skippable: true, status: 'ACTIVE' }, true)).toBe(false);
    expect(canSkipPlanItem({ skippable: true, status: 'PENDING' }, false)).toBe(false);
  });

  it('cảnh báo thiếu người đảm nhận', () => {
    expect(stageAssigneeWarning({ status: 'PENDING', assigneeUserId: null, assigneeWarning: null })).toBe('Chưa có người đảm nhận giai đoạn này.');
    expect(stageAssigneeWarning({ status: 'PENDING', assigneeUserId: null, assigneeWarning: 'Không tìm thấy cấp trên.' })).toBe('Không tìm thấy cấp trên.');
    expect(stageAssigneeWarning({ status: 'DONE', assigneeUserId: null, assigneeWarning: null })).toBe('');
    expect(stageAssigneeWarning({ status: 'PENDING', assigneeUserId: 'u', assigneeWarning: null })).toBe('');
  });

  it('hạn quá hạn so theo ngày', () => {
    const now = new Date(2026, 10, 2);
    expect(isDueOverdue('2026-11-01', now)).toBe(true);
    expect(isDueOverdue('2026-11-02', now)).toBe(false);
    expect(isDueOverdue(null, now)).toBe(false);
  });
});

describe('bỏ qua giai đoạn lúc tạo dự án', () => {
  const skipPipeline: Pipeline = {
    ...pipelineRef, profile: 'STANDARD', isDefault: true, active: true, sortOrder: 0, careSuggestion: true,
    stages: [
      stage('NEW', 'OPEN', ['SURVEY'], { skippable: true }),
      stage('SURVEY', 'OPEN', ['WON'], { skippable: true }),
      stage('OLD', 'OPEN', [], { skippable: true, active: false }),
      stage('QUOTE', 'OPEN', ['WON'], { skippable: false }),
      stage('WON', 'WON', [], { skippable: true }),
    ],
  };

  it('chỉ liệt kê giai đoạn đang bật, đang chạy, cho bỏ qua, không phải giai đoạn đầu', () => {
    expect(skippableStartStages(skipPipeline).map((item) => item.code)).toEqual(['SURVEY']);
    expect(skippableStartStages(undefined)).toEqual([]);
  });

  it('dựng skipStages và bắt buộc lý do', () => {
    expect(buildSkipStages(skipPipeline, { SURVEY: ' Khách đã khảo sát ' })).toEqual({ skipStages: [{ stage: 'SURVEY', reason: 'Khách đã khảo sát' }] });
    expect(buildSkipStages(skipPipeline, { SURVEY: '  ' }).error).toContain('Tên SURVEY');
    expect(buildSkipStages(skipPipeline, {})).toEqual({ skipStages: [] });
  });
});

describe('nhóm dự án theo khách hàng', () => {
  it('đếm dự án và cộng giá trị dự kiến theo khách, giữ thứ tự', () => {
    const a1 = { ...card('a1', 'NEW', 100), customerId: 'A', customerName: 'Khách A' };
    const b1 = { ...card('b1', 'NEW', 50), customerId: 'B', customerName: 'Khách B' };
    const a2 = { ...card('a2', 'NEW', 0), customerId: 'A', customerName: 'Khách A', expectedValue: null };
    const groups = groupByCustomer([a1, b1, a2]);
    expect(groups.map((group) => [group.customerId, group.count, group.totalValue])).toEqual([['A', 2, 100], ['B', 1, 50]]);
    expect(groups[0].items.map((item) => item.id)).toEqual(['a1', 'a2']);
    expect(groupByCustomer([])).toEqual([]);
  });

  it('khách vắt sang trang khác: lấy tổng của mọi trang từ server và đánh dấu đang xem một phần', () => {
    const a1 = { ...card('a1', 'NEW', 100), customerId: 'A', customerName: 'Khách A' };
    const b1 = { ...card('b1', 'NEW', 50), customerId: 'B', customerName: 'Khách B' };
    const groups = groupByCustomer([a1, b1], [
      { customerId: 'A', customerCode: 'KH-A', customerName: 'Khách A', count: 1, totalValue: 100 },
      { customerId: 'B', customerCode: 'KH-B', customerName: 'Khách B', count: 7, totalValue: 900 },
    ]);
    expect(groups.map((group) => [group.customerId, group.count, group.totalValue, group.partial])).toEqual([
      ['A', 1, 100, false],
      ['B', 7, 900, true],
    ]);
  });
});
