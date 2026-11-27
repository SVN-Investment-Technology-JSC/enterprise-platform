import type { ProcedureInstance, ProcedureInstanceStep } from '@enterprise-platform/contracts-procedure-engine';
import {
  CASE_BOARD_COLUMN_SET,
  DATE_COLUMN_MIN_WIDTH,
  NO_PROJECT_KEY,
  NO_PROJECT_LABEL,
  OVERVIEW_COLUMNS_STORAGE_KEY,
  OVERVIEW_SORT_STORAGE_KEY,
  buildOverviewRow,
  compareOverviewRows,
  defaultOverviewColumnLayout,
  isDefaultOverviewColumnLayout,
  loadOverviewColumnLayout,
  loadOverviewSort,
  moveOverviewColumn,
  nextOverviewSort,
  normalizeOverviewColumnLayout,
  overviewColumnWidth,
  parseOverviewSort,
  resizeOverviewColumn,
  saveOverviewColumnLayout,
  saveOverviewSort,
  shiftOverviewColumn,
  sortOverviewGroups,
  splitInlineActions,
  toggleOverviewColumn,
  visibleOverviewColumns,
  type OverviewRow,
  bulkAllowedByDefinition,
  formatOverviewDateTime,
  groupOverviewRowsInOrder,
  inlineActionPlan,
  inlineBlocker,
  isBulkEligible,
  isMyActive,
  isMyDone,
  overviewStep,
  overviewWaitingLabel,
  paginateOverviewGroups,
} from './procedure-overview';

const ME = 'u-me';

function step(extra: Partial<ProcedureInstanceStep> = {}): ProcedureInstanceStep {
  return {
    id: 's1',
    definitionStepId: 'd-s1',
    key: 'B1',
    order: 1,
    name: 'Kiểm tra hồ sơ',
    status: 'active',
    currentRoleStage: 'A',
    assignments: [{ id: 'a1', role: 'A', subjectType: 'position', subjectId: 'p1', subjectLabel: 'Kế toán trưởng' }],
    startedAt: '2026-11-20T08:00:00.000Z',
    ...extra,
  };
}

const BASE_AUTH: NonNullable<ProcedureInstance['authorization']> = {
  myRoles: [],
  currentRoleStage: 'A',
  availableActions: [],
  canManageSubtasks: false,
  isOverride: false,
};
const MY_AUTH: NonNullable<ProcedureInstance['authorization']> = {
  ...BASE_AUTH,
  myRoles: ['A'],
  availableActions: ['approve', 'return', 'reject', 'comment'],
  currentStepPart: 'act',
};

function instance(extra: Partial<ProcedureInstance> = {}): ProcedureInstance {
  return {
    id: 'i1',
    code: 'QT-1',
    title: 'Mua vật tư',
    definitionId: 'def-1',
    definitionCode: 'MUA',
    definitionName: 'Mua sắm',
    definitionVersion: 1,
    status: 'running',
    currentStepId: 's1',
    initiatedBy: 'u-other',
    startedAt: '2026-11-20T08:00:00.000Z',
    steps: [step()],
    activity: [
      { id: 'act1', action: 'start', actorId: 'u-other', actorName: 'Nguyễn Văn A', summary: 'Mở', createdAt: '2026-11-20T08:00:00.000Z' },
    ],
    authorization: BASE_AUTH,
    ...extra,
  } as ProcedureInstance;
}

const mine = (extra: Partial<ProcedureInstance> = {}) =>
  instance({ authorization: MY_AUTH, ...extra });

describe('luật tab "Đang xử lý" / "Bạn đã xử lý" của Hồ sơ xử lý', () => {
  it('Đang xử lý = tới lượt bạn; Bạn đã xử lý = đã xong phần mình hoặc đã xử lý', () => {
    const active = mine({ id: 'a' });
    const donePart = instance({
      id: 'b',
      authorization: { ...BASE_AUTH, currentStepPart: 'done' },
    });
    const closedActed = instance({
      id: 'c',
      status: 'completed',
      currentStepId: undefined,
      activity: [
        ...instance().activity,
        { id: 'x', action: 'approve', actorId: ME, actorName: 'Tôi', summary: '', createdAt: '2026-11-21T08:00:00.000Z', stepInstanceId: 's1' },
      ],
    });
    const unrelated = instance({ id: 'd' });

    expect(isMyActive(active)).toBe(true);
    expect(isMyDone(active, ME)).toBe(false);
    expect(isMyDone(donePart, ME)).toBe(true);
    expect(isMyDone(closedActed, ME)).toBe(true);
    expect(isMyDone(unrelated, ME)).toBe(false);
    // Bước hiện trên dòng ở tab "Bạn đã xử lý": bước người xem xử lý gần nhất.
    expect(overviewStep(closedActed, 'mine-done', ME)?.id).toBe('s1');
  });

  it('người còn đầu việc chưa xong (currentStepPart act, không có nút) vẫn là đang thực hiện', () => {
    expect(isMyActive(instance({ authorization: { ...BASE_AUTH, currentStepPart: 'act' } }))).toBe(true);
  });
});

describe('dòng và nhóm theo dự án', () => {
  const project = (id: string, name?: string) => ({ projectId: id, projectCode: `DA-${id}`, ...(name ? { projectName: name } : {}) });

  it('dòng lấy bước hiện tại, mốc thời gian và người tạo; hồ sơ không có dự án vào "Không thuộc dự án"', () => {
    const row = buildOverviewRow(
      instance({ startDueAt: '2026-11-19T01:00:00.000Z', steps: [step({ slaDueAt: '2026-11-21T08:00:00.000Z' })] }),
      'all',
      ME,
      undefined,
      new Date('2026-11-25T00:00:00.000Z'),
    );
    expect(row).toMatchObject({
      stepName: 'Kiểm tra hồ sơ',
      projectKey: NO_PROJECT_KEY,
      projectName: NO_PROJECT_LABEL,
      actualStart: '2026-11-20T08:00:00.000Z',
      plannedEnd: '2026-11-21T08:00:00.000Z',
      overdue: true,
      initiatorName: 'Nguyễn Văn A',
    });
    // Cột "Bắt đầu dự kiến" đã bỏ khỏi bảng: dòng không còn mang mốc này.
    expect(row).not.toHaveProperty('plannedStart');
  });

  it('nhóm theo TÊN dự án (thiếu tên thì mã), giữ thứ tự đầu vào; "Không thuộc dự án" luôn cuối', () => {
    const rows = [
      buildOverviewRow(instance({ id: 'none', startedAt: '2026-11-26T00:00:00.000Z', activity: [], steps: [] }), 'all', ME, undefined),
      buildOverviewRow(instance({ id: 'old', startedAt: '2026-11-01T00:00:00.000Z', activity: [] }), 'all', ME, project('p1', 'Thí nghiệm MBA 15MVA')),
      buildOverviewRow(instance({ id: 'new', startedAt: '2026-11-26T00:00:00.000Z', activity: [], steps: [] }), 'all', ME, project('p2')),
      buildOverviewRow(instance({ id: 'old2', startedAt: '2026-11-02T00:00:00.000Z', activity: [], steps: [] }), 'all', ME, project('p1', 'Thí nghiệm MBA 15MVA')),
    ];
    const groups = groupOverviewRowsInOrder(rows);
    expect(groups.map((group) => [group.name, group.rows.length])).toEqual([
      ['Thí nghiệm MBA 15MVA', 2],
      ['DA-p2', 1],
      [NO_PROJECT_LABEL, 1],
    ]);
    expect(groups[0]?.rows.map((row) => row.instance.id)).toEqual(['old', 'old2']);
  });

  it('phân trang theo dòng, giữ nhóm và đếm "từ - đến / tổng"', () => {
    const rows = ['a', 'b', 'c'].map((id, index) =>
      buildOverviewRow(instance({ id, startedAt: `2026-11-0${index + 1}T00:00:00.000Z`, activity: [], steps: [] }), 'all', ME, project(index < 2 ? 'p1' : 'p2', 'DA')),
    );
    const groups = groupOverviewRowsInOrder(rows);
    const second = paginateOverviewGroups(groups, 2, 2);
    expect(second).toMatchObject({ from: 3, to: 3, total: 3, page: 2, pageCount: 2 });
    expect(second.groups).toHaveLength(1);
    expect(paginateOverviewGroups([], 1, 50)).toMatchObject({ from: 0, to: 0, total: 0, pageCount: 1 });
  });

  it('ngày giờ dạng "HH:mm dd/mm/yyyy", trống là "--"', () => {
    expect(formatOverviewDateTime(undefined)).toBe('--');
    const local = new Date(2026, 10, 9, 14, 5).toISOString();
    expect(formatOverviewDateTime(local)).toBe('14:05 09/11/2026');
  });
});

describe('thao tác ngay trên dòng', () => {
  it('đổi tên theo 1office: Duyệt, Không duyệt cần chỉnh sửa, Không duyệt hủy', () => {
    const plan = inlineActionPlan(mine());
    expect(plan.actions.map((action) => action.label)).toEqual(['Duyệt', 'Không duyệt, cần chỉnh sửa', 'Không duyệt, hủy']);
    expect(plan.openReason).toBeUndefined();
  });

  it('pha xem xét (R) chỉ được duyệt; hoàn tất giữ nhãn "Hoàn tất"; hoàn duyệt khi được rút lại', () => {
    const review = mine({
      authorization: { ...MY_AUTH, currentRoleStage: 'R', availableActions: ['complete', 'return', 'reject'], canWithdraw: true },
    });
    expect(inlineActionPlan(review).actions.map((action) => action.label)).toEqual(['Hoàn tất', 'Hoàn duyệt']);
  });

  it('trả lại có nhiều bước để chọn thì mở hồ sơ', () => {
    const plan = inlineActionPlan(mine({ authorization: { ...MY_AUTH, returnTargetStepIds: ['s0', 's00'] } }));
    expect(plan.actions.find((action) => action.kind === 'return')?.needsDetail).toBe(true);
  });

  it('thiếu thông tin bắt buộc: không có nút Duyệt, chỉ "Mở để xử lý"', () => {
    const blocked = mine({
      steps: [step({ attributes: [{ id: 'at', code: 'amount', name: 'Số tiền', type: 'number', required: true }] })],
      authorization: { ...MY_AUTH, editableAttributeKeys: ['step:d-s1:amount'] },
    });
    expect(inlineBlocker(blocked)).toBe('Cần nhập: Số tiền');
    const plan = inlineActionPlan(blocked);
    expect(plan.actions.map((action) => action.kind)).toEqual(['return', 'reject']);
    expect(plan.openReason).toBe('Cần nhập: Số tiền');

    const filled = mine({
      ...blocked,
      attributeValues: { 'step:d-s1:amount': { value: { type: 'number', value: 5 }, enteredBy: ME, enteredAt: '2026-11-20' } },
    });
    expect(inlineBlocker(filled)).toBeUndefined();
  });

  it('bước Tài chính, thiếu vật tư, đầu việc chưa xong đều chặn duyệt ngay', () => {
    expect(inlineBlocker(mine({ steps: [step({ integration: { module: 'finance', action: 'voucher', voucherKind: 'payment' } as never })] }))).toMatch(/Tài chính/);
    expect(
      inlineBlocker(mine({ steps: [step({ materials: [{ materialCode: 'M1', quantity: 1 }], materialCheck: { state: 'short', checkedAt: '', lines: [] } })] })),
    ).toMatch(/vật tư/);
    expect(
      inlineBlocker(mine({ subtasks: [{ id: 't', instanceId: 'i1', stepInstanceId: 's1', title: 'x', order: 1, weight: 100, status: 'open', createdAt: '' }] })),
    ).toMatch(/đầu việc/);
  });

  it('chưa tới lượt: không nút, hiện đang chờ ai; hồ sơ đã đóng hiện trạng thái', () => {
    const waiting = inlineActionPlan(instance());
    expect(waiting.actions).toEqual([]);
    expect(waiting.waiting).toBe('Chờ Kế toán trưởng');
    expect(overviewWaitingLabel(instance({ status: 'completed' }))).toBe('Hoàn thành');
  });
});

describe('thao tác hàng loạt', () => {
  const definitions = new Map([
    ['def-1', { bulkActions: { approve: true, reject: true } }],
    ['def-approve', { bulkActions: { approve: true } }],
    ['def-off', {}],
  ]);

  it('ô chọn chỉ mở khi quy trình bật một thao tác hàng loạt; không thấy quy trình thì khoá', () => {
    expect(bulkAllowedByDefinition(mine(), definitions)).toBe(true);
    expect(bulkAllowedByDefinition(mine({ definitionId: 'def-approve' }), definitions)).toBe(true);
    expect(bulkAllowedByDefinition(mine({ definitionId: 'def-off' }), definitions)).toBe(false);
    expect(bulkAllowedByDefinition(mine({ definitionId: 'khong-co' }), definitions)).toBe(false);
  });

  it('chỉ tính hồ sơ: quy trình cho phép, tới lượt, có thao tác, không cần nhập thêm', () => {
    expect(isBulkEligible(mine(), definitions, 'approve')).toBe(true);
    expect(isBulkEligible(mine(), definitions, 'reject')).toBe(true);
    expect(isBulkEligible(mine({ definitionId: 'def-approve' }), definitions, 'reject')).toBe(false);
    expect(isBulkEligible(instance(), definitions, 'approve')).toBe(false);
    const needsInput = mine({
      steps: [step({ attributes: [{ id: 'at', code: 'amount', name: 'Số tiền', type: 'number', required: true }] })],
      authorization: { ...MY_AUTH, editableAttributeKeys: ['step:d-s1:amount'] },
    });
    expect(isBulkEligible(needsInput, definitions, 'approve')).toBe(false);
    // Không duyệt không cần nhập thông tin của bước.
    expect(isBulkEligible(needsInput, definitions, 'reject')).toBe(true);
  });
});

describe('sắp xếp theo cột', () => {
  const project = (id: string, name: string) => ({ projectId: id, projectCode: `DA-${id}`, projectName: name });
  /** Dòng tối giản: chỉ các trường cột sắp xếp dùng tới. */
  function row(id: string, extra: Partial<OverviewRow> & { title?: string; projectId?: string; projectName?: string } = {}) {
    const { title, projectId, projectName, ...fields } = extra;
    return {
      ...buildOverviewRow(
        instance({ id, title: title ?? `Hồ sơ ${id}`, activity: [], steps: [] }),
        'all',
        ME,
        projectId ? project(projectId, projectName ?? projectId) : undefined,
      ),
      actualStart: undefined,
      plannedEnd: undefined,
      initiatorName: undefined,
      ...fields,
    } as OverviewRow;
  }
  const ids = (rows: readonly OverviewRow[]) => rows.map((item) => item.instance.id);
  const sorted = (rows: OverviewRow[], key: Parameters<typeof nextOverviewSort>[1], direction: 'asc' | 'desc') =>
    ids([...rows].sort(compareOverviewRows({ key, direction })));

  it('vòng bấm: tăng dần → giảm dần → bỏ sắp; bấm cột khác về tăng dần', () => {
    const asc = nextOverviewSort(undefined, 'name');
    expect(asc).toEqual({ key: 'name', direction: 'asc' });
    const desc = nextOverviewSort(asc, 'name');
    expect(desc).toEqual({ key: 'name', direction: 'desc' });
    expect(nextOverviewSort(desc, 'name')).toBeUndefined();
    expect(nextOverviewSort(desc, 'owner')).toEqual({ key: 'owner', direction: 'asc' });
  });

  it('Tên công việc: theo tên bước (tiếng Việt), rồi tên hồ sơ', () => {
    const rows = [
      row('a', { stepName: 'Duyệt giá', title: 'Z' }),
      row('b', { stepName: 'Đề xuất', title: 'B' }),
      row('c', { stepName: 'Đề xuất', title: 'A' }),
      row('d', { stepName: 'Báo giá' }),
    ];
    expect(sorted(rows, 'name', 'asc')).toEqual(['d', 'a', 'c', 'b']);
    expect(sorted(rows, 'name', 'desc')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('Bắt đầu thực tế: theo thời điểm, dòng chưa bắt đầu luôn cuối', () => {
    const rows = [
      row('none'),
      row('late', { actualStart: '2026-11-22T00:00:00.000Z' }),
      row('early', { actualStart: '2026-11-20T00:00:00.000Z' }),
    ];
    expect(sorted(rows, 'actualStart', 'asc')).toEqual(['early', 'late', 'none']);
    expect(sorted(rows, 'actualStart', 'desc')).toEqual(['late', 'early', 'none']);
  });

  it('Kết thúc dự kiến: hạn quá (sớm nhất) đứng đầu khi tăng dần, không có hạn luôn cuối', () => {
    const rows = [
      row('none'),
      row('soon', { plannedEnd: '2026-11-30T00:00:00.000Z' }),
      row('overdue', { plannedEnd: '2026-11-01T00:00:00.000Z', overdue: true }),
      row('far', { plannedEnd: '2026-12-31T00:00:00.000Z' }),
    ];
    expect(sorted(rows, 'plannedEnd', 'asc')).toEqual(['overdue', 'soon', 'far', 'none']);
    expect(sorted(rows, 'plannedEnd', 'desc')).toEqual(['far', 'soon', 'overdue', 'none']);
  });

  it('Người tạo: theo họ tên tiếng Việt, không rõ người tạo cuối', () => {
    const rows = [
      row('none'),
      row('tran', { initiatorName: 'Trần Thị B' }),
      row('dang', { initiatorName: 'Đặng Văn C' }),
      row('an', { initiatorName: 'An Văn A' }),
    ];
    expect(sorted(rows, 'owner', 'asc')).toEqual(['an', 'dang', 'tran', 'none']);
    expect(sorted(rows, 'owner', 'desc')).toEqual(['tran', 'dang', 'an', 'none']);
  });

  it('sắp trong từng nhóm; nhóm xếp theo dòng tốt nhất của nhóm; không sắp thì giữ nguyên thứ tự', () => {
    const groups = [
      { key: 'p1', name: 'Dự án 1', lastActivityAt: '3', rows: [row('p1-c', { stepName: 'C' }), row('p1-b', { stepName: 'B' })] },
      { key: 'p2', name: 'Dự án 2', lastActivityAt: '2', rows: [row('p2-d', { stepName: 'D' }), row('p2-a', { stepName: 'A' })] },
      { key: NO_PROJECT_KEY, name: NO_PROJECT_LABEL, lastActivityAt: '1', rows: [row('none-e', { stepName: 'E' })] },
    ];
    expect(sortOverviewGroups(groups, undefined).map((group) => group.key)).toEqual(['p1', 'p2', NO_PROJECT_KEY]);

    const asc = sortOverviewGroups(groups, { key: 'name', direction: 'asc' });
    expect(asc.map((group) => group.key)).toEqual(['p2', 'p1', NO_PROJECT_KEY]);
    expect(asc.map((group) => ids(group.rows))).toEqual([['p2-a', 'p2-d'], ['p1-b', 'p1-c'], ['none-e']]);

    const desc = sortOverviewGroups(groups, { key: 'name', direction: 'desc' });
    expect(desc.map((group) => group.key)).toEqual([NO_PROJECT_KEY, 'p2', 'p1']);
    expect(desc.map((group) => ids(group.rows))).toEqual([['none-e'], ['p2-d', 'p2-a'], ['p1-c', 'p1-b']]);
    // Không đổi mảng gốc.
    expect(ids(groups[0]?.rows ?? [])).toEqual(['p1-c', 'p1-b']);
  });

  it('nhóm có toàn dòng trống mốc xếp sau nhóm có mốc', () => {
    const groups = [
      { key: 'p1', name: 'A', lastActivityAt: '2', rows: [row('empty')] },
      { key: 'p2', name: 'B', lastActivityAt: '1', rows: [row('dated', { plannedEnd: '2026-11-01T00:00:00.000Z' })] },
    ];
    for (const direction of ['asc', 'desc'] as const) {
      expect(sortOverviewGroups(groups, { key: 'plannedEnd', direction }).map((group) => group.key)).toEqual(['p2', 'p1']);
    }
  });

  it('sắp theo dự án: theo tên nhóm, "Không thuộc dự án" luôn cuối, dòng trong nhóm giữ nguyên', () => {
    const groups = [
      { key: NO_PROJECT_KEY, name: NO_PROJECT_LABEL, lastActivityAt: '3', rows: [row('x')] },
      { key: 'p2', name: 'Trạm Đông Anh', lastActivityAt: '2', rows: [row('b2', { stepName: 'Z' }), row('b1', { stepName: 'A' })] },
      { key: 'p1', name: 'Âu Cơ', lastActivityAt: '1', rows: [row('a')] },
    ];
    const asc = sortOverviewGroups(groups, { key: 'project', direction: 'asc' });
    expect(asc.map((group) => group.key)).toEqual(['p1', 'p2', NO_PROJECT_KEY]);
    expect(ids(asc[1]?.rows ?? [])).toEqual(['b2', 'b1']);
    expect(sortOverviewGroups(groups, { key: 'project', direction: 'desc' }).map((group) => group.key)).toEqual([
      'p2',
      'p1',
      NO_PROJECT_KEY,
    ]);
  });

  it('đọc / ghi lựa chọn sắp xếp: dữ liệu lạ bị bỏ, bộ nhớ lỗi không làm vỡ trang', () => {
    expect(parseOverviewSort({ key: 'owner', direction: 'desc' })).toEqual({ key: 'owner', direction: 'desc' });
    expect(parseOverviewSort({ key: 'khac', direction: 'asc' })).toBeUndefined();
    expect(parseOverviewSort({ key: 'owner', direction: 'up' })).toBeUndefined();
    expect(parseOverviewSort('owner')).toBeUndefined();

    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    saveOverviewSort({ key: 'plannedEnd', direction: 'asc' }, storage);
    expect(loadOverviewSort(storage)).toEqual({ key: 'plannedEnd', direction: 'asc' });
    saveOverviewSort(undefined, storage);
    expect(store.has(OVERVIEW_SORT_STORAGE_KEY)).toBe(false);
    store.set(OVERVIEW_SORT_STORAGE_KEY, '{hỏng');
    expect(loadOverviewSort(storage)).toBeUndefined();

    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadOverviewSort(broken)).toBeUndefined();
    expect(() => saveOverviewSort({ key: 'name', direction: 'asc' }, broken)).not.toThrow();
  });
});

describe('bố cục cột', () => {
  const base = defaultOverviewColumnLayout();

  it('đổi chỗ: chèn trước / sau cột đích; khoá lạ hoặc thả lên chính nó thì giữ nguyên', () => {
    expect(moveOverviewColumn(base, 'owner', 'name', 'before').order).toEqual([
      'owner',
      'name',
      'actualStart',
      'plannedEnd',
      'action',
    ]);
    expect(moveOverviewColumn(base, 'name', 'action', 'after').order).toEqual([
      'actualStart',
      'plannedEnd',
      'action',
      'name',
      'owner',
    ]);
    expect(moveOverviewColumn(base, 'select', 'name')).toBe(base);
    expect(moveOverviewColumn(base, 'name', 'khac')).toBe(base);
    expect(moveOverviewColumn(base, 'name', 'name')).toBe(base);
    // Thả vào chỗ cũ (trước cột kế sau) không tạo bố cục mới.
    expect(moveOverviewColumn(base, 'name', 'actualStart', 'before')).toBe(base);
    expect(shiftOverviewColumn(base, 'actualStart', -1).order.slice(0, 2)).toEqual(['actualStart', 'name']);
    expect(shiftOverviewColumn(base, 'name', -1)).toBe(base);
    expect(shiftOverviewColumn(base, 'owner', 1)).toBe(base);
  });

  it('độ rộng kẹp ở mức tối thiểu; ẩn cột (trừ "Tên công việc"); về mặc định', () => {
    const narrow = resizeOverviewColumn(base, 'owner', 20);
    expect(narrow.widths).toEqual({ owner: 110 });
    expect(overviewColumnWidth(narrow, 'owner')).toBe(110);
    expect(overviewColumnWidth(narrow, 'actualStart')).toBe(164);
    const hidden = toggleOverviewColumn(narrow, 'actualStart');
    expect(visibleOverviewColumns(hidden)).toEqual(['name', 'plannedEnd', 'action', 'owner']);
    expect(toggleOverviewColumn(hidden, 'name')).toBe(hidden);
    expect(visibleOverviewColumns(toggleOverviewColumn(hidden, 'actualStart'))).toContain('actualStart');
    expect(isDefaultOverviewColumnLayout(base)).toBe(true);
    expect(isDefaultOverviewColumnLayout(narrow)).toBe(false);
    expect(isDefaultOverviewColumnLayout(defaultOverviewColumnLayout())).toBe(true);
  });

  it('chuẩn hoá dữ liệu đã lưu: bỏ khoá lạ / trùng, thêm cột còn thiếu, kẹp độ rộng, không ẩn cột bắt buộc', () => {
    expect(
      normalizeOverviewColumnLayout({
        order: ['owner', 'khac', 'owner', 'name'],
        widths: { owner: 9999, khac: 200, name: 'rộng', plannedEnd: 50 },
        hidden: ['name', 'action', 'action', 'khac'],
      }),
    ).toEqual({
      order: ['owner', 'name', 'actualStart', 'plannedEnd', 'action'],
      widths: { owner: 900, plannedEnd: DATE_COLUMN_MIN_WIDTH },
      hidden: ['action'],
    });
    expect(normalizeOverviewColumnLayout(null)).toEqual(base);
    expect(normalizeOverviewColumnLayout('hỏng')).toEqual(base);
  });

  it('lưu / đọc trên trình duyệt; bố cục mặc định thì xoá khoá', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    const custom = resizeOverviewColumn(moveOverviewColumn(base, 'owner', 'name', 'before'), 'name', 400);
    saveOverviewColumnLayout(custom, storage);
    expect(loadOverviewColumnLayout(storage)).toEqual(custom);
    saveOverviewColumnLayout(defaultOverviewColumnLayout(), storage);
    expect(store.has(OVERVIEW_COLUMNS_STORAGE_KEY)).toBe(false);
    expect(loadOverviewColumnLayout(storage)).toEqual(base);
    expect(loadOverviewColumnLayout(undefined)).toEqual(base);
  });
});

describe('nút chính và menu thao tác phụ', () => {
  it('Duyệt là nút chính, trả lại / không duyệt / hoàn duyệt vào menu', () => {
    const split = splitInlineActions(
      inlineActionPlan(mine({ authorization: { ...MY_AUTH, canWithdraw: true } })),
    );
    expect(split.primary?.kind).toBe('approve');
    expect(split.secondary.map((action) => action.kind)).toEqual(['return', 'reject', 'withdraw']);
  });

  it('bị chặn (cần nhập thêm): không có nút chính, thao tác phụ vẫn còn', () => {
    const blocked = mine({
      steps: [step({ attributes: [{ id: 'at', code: 'amount', name: 'Số tiền', type: 'number', required: true }] })],
      authorization: { ...MY_AUTH, editableAttributeKeys: ['step:d-s1:amount'] },
    });
    const split = splitInlineActions(inlineActionPlan(blocked));
    expect(split.primary).toBeUndefined();
    expect(split.secondary.map((action) => action.kind)).toEqual(['return', 'reject']);
  });
});

describe('tiêu đề cột đủ chữ, cột ngày không bị cắt', () => {
  it('cột ngày mặc định và tối thiểu đủ "HH:mm dd/mm/yyyy"; bố cục đã lưu hẹp hơn được nới lên mức tối thiểu', () => {
    const base = defaultOverviewColumnLayout(CASE_BOARD_COLUMN_SET);
    expect(overviewColumnWidth(base, 'actualStart')).toBeGreaterThanOrEqual(DATE_COLUMN_MIN_WIDTH);
    expect(overviewColumnWidth(base, 'plannedEnd')).toBeGreaterThanOrEqual(DATE_COLUMN_MIN_WIDTH);
    // Bố cục lưu từ trước (mức tối thiểu cũ 120 / 130px) đọc lại thì được nới, không còn cắt ngày.
    const saved = normalizeOverviewColumnLayout(
      { order: CASE_BOARD_COLUMN_SET.keys, widths: { actualStart: 120, plannedEnd: 130, owner: 200 }, hidden: [] },
      CASE_BOARD_COLUMN_SET,
    );
    expect(saved.widths).toEqual({ actualStart: DATE_COLUMN_MIN_WIDTH, plannedEnd: DATE_COLUMN_MIN_WIDTH, owner: 200 });
    expect(resizeOverviewColumn(base, 'plannedEnd', 90).widths.plannedEnd).toBe(DATE_COLUMN_MIN_WIDTH);
  });
});
