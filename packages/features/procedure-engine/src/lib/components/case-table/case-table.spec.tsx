/** @jest-environment jsdom */
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import type {
  ProcedureDefinition,
  ProcedureInstance,
  ProcedureInstanceStep,
} from '@enterprise-platform/contracts-procedure-engine';
import * as api from '../../procedure-api';
import {
  OVERVIEW_COLUMN_SET,
  buildOverviewRow,
  groupOverviewRowsInOrder,
  paginateOverviewGroups,
  type InlineActionKind,
} from '../../procedure-overview';
import { useInstanceProjects } from '../use-instance-project';
import { CaseBulkBar, CaseTable, ColumnSettings, useCaseTable } from './case-table';

/**
 * Bảng hồ sơ dùng chung (`case-table`), chạy qua một khung tối giản: các luật của bảng (thao tác trên dòng, cột, sắp
 * xếp, hàng loạt) trước đây được kiểm qua trang "Tổng quan"; trang đó đã bỏ nên kiểm thẳng ở đây. Màn Hồ sơ xử lý dùng
 * cùng bảng (xem `case-layout-a.spec.tsx`).
 */

jest.mock('../../procedure-api', () => ({ applyProcedureAction: jest.fn(), bulkProcedureAction: jest.fn() }));

const mocked = api as jest.Mocked<typeof api>;
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

const myTurn = {
  myRoles: ['A' as const],
  currentRoleStage: 'A' as const,
  availableActions: ['approve' as const, 'return' as const, 'reject' as const, 'comment' as const],
  canManageSubtasks: false,
  isOverride: false,
  currentStepPart: 'act' as const,
};

function instance(id: string, extra: Partial<ProcedureInstance> = {}): ProcedureInstance {
  return {
    id,
    code: `QT-${id}`,
    title: `Hồ sơ ${id}`,
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
      { id: `${id}-start`, action: 'start', actorId: 'u-other', actorName: 'Nguyễn Văn A', summary: 'Mở', createdAt: '2026-11-20T08:00:00.000Z' },
    ],
    authorization: myTurn,
    ...extra,
  } as ProcedureInstance;
}

const project = (projectId: string, projectName: string) => ({
  workspaceProject: { projectId, projectCode: `DA-${projectId}`, projectName },
});

const notMine = { ...myTurn, myRoles: [], availableActions: [], currentStepPart: undefined };

const definition = (id: string, bulkActions?: ProcedureDefinition['bulkActions']) =>
  ({ id, code: id, name: `Quy trình ${id}`, ...(bulkActions ? { bulkActions } : {}) }) as ProcedureDefinition;

interface HarnessProps {
  readonly instances: readonly ProcedureInstance[];
  readonly definitions: readonly ProcedureDefinition[];
  readonly onChanged: () => void;
  readonly onNotice: (message: string) => void;
  readonly onError: (message: string) => void;
}

/** Khung tối giản quanh bảng: dòng theo thứ tự đầu vào, bộ cột mặc định, thao tác trên dòng gọi thẳng API. */
function Harness({ instances, definitions, onChanged, onNotice, onError }: HarnessProps) {
  const projects = useInstanceProjects(instances);
  const groups = useMemo(
    () =>
      groupOverviewRowsInOrder(
        instances.map((item) => buildOverviewRow(item, 'all', ME, projects.get(item.id))),
      ),
    [instances, projects],
  );
  const table = useCaseTable({
    groups,
    definitions,
    columnSet: OVERVIEW_COLUMN_SET,
    runAction: async (item: ProcedureInstance, kind: InlineActionKind, comment?: string) => {
      await api.applyProcedureAction(item.id, kind, comment);
      onChanged();
    },
    afterBulk: () => onChanged(),
    onNotice,
    onError,
  });
  const view = paginateOverviewGroups(table.sortedGroups, 1, 50);
  return (
    <section>
      <ColumnSettings table={table} />
      <CaseBulkBar table={table} titleOf={(id) => instances.find((item) => item.id === id)?.title} />
      <CaseTable table={table} view={view} emptyText="Chưa có hồ sơ nào." />
    </section>
  );
}

const fixtures = (): ProcedureInstance[] => [
  instance('1', project('p1', 'Thí nghiệm máy biến áp 15MVA DAUN PENH')),
  instance('2', { ...project('p1', 'Thí nghiệm máy biến áp 15MVA DAUN PENH'), authorization: notMine }),
  instance('3'),
  instance('4', { status: 'completed', currentStepId: undefined, authorization: notMine }),
];

function setup(instances: ProcedureInstance[] = fixtures(), definitions: ProcedureDefinition[] = []) {
  const onChanged = jest.fn();
  const onNotice = jest.fn();
  const onError = jest.fn();
  render(
    <Harness instances={instances} definitions={definitions} onChanged={onChanged} onNotice={onNotice} onError={onError} />,
  );
  return { onChanged, onNotice, onError };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mocked.applyProcedureAction.mockResolvedValue(instance('x'));
});

describe('CaseTable - bảng hồ sơ dùng chung', () => {
  it('cột Người tạo hiện đủ họ tên cạnh ảnh chữ tắt', () => {
    setup();
    expect(screen.getAllByText('Nguyễn Văn A').length).toBeGreaterThan(0);
  });

  it('gom dòng theo tên dự án, hồ sơ không có dự án vào "Không thuộc dự án", thu gọn được', () => {
    setup();
    const groupButtons = screen.getAllByRole('button', { expanded: true }).filter((button) => button.closest('tr'));
    const labels = groupButtons.map((button) => button.textContent);
    expect(labels).toContain('Thí nghiệm máy biến áp 15MVA DAUN PENH(2)');
    expect(labels).toContain('Không thuộc dự án(2)');
    expect(screen.queryByText('DA-p1')).toBeNull();

    const projectGroup = screen.getByRole('button', { name: /Thí nghiệm máy biến áp/ });
    expect(screen.getByText('Quy trình: Hồ sơ 1')).toBeTruthy();
    fireEvent.click(projectGroup);
    expect(projectGroup.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Quy trình: Hồ sơ 1')).toBeNull();
    expect(screen.getByText('Quy trình: Hồ sơ 3')).toBeTruthy();
  });

  it('"Duyệt" ngay trên dòng chạy thao tác approve của trang rồi làm mới danh sách', async () => {
    const { onChanged } = setup([instance('1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.applyProcedureAction).toHaveBeenCalledWith('1', 'approve', undefined);
  });

  it('"Không duyệt, cần chỉnh sửa" hiện ngay trên dòng và hỏi nội dung cần sửa rồi mới trả lại', async () => {
    const { onChanged } = setup([instance('1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Không duyệt, cần chỉnh sửa' }));
    const reason = screen.getByLabelText(/Nội dung cần chỉnh sửa/);
    const confirm = screen.getByRole('button', { name: 'Trả lại' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(mocked.applyProcedureAction).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: 'Bổ sung báo giá' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.applyProcedureAction).toHaveBeenCalledWith('1', 'return', 'Bổ sung báo giá');
  });

  it('bước cần nhập thông tin bắt buộc: không có "Duyệt", hiện "Mở để xử lý" dẫn tới hồ sơ', () => {
    setup([
      instance('1', {
        steps: [step({ attributes: [{ id: 'at', code: 'amount', name: 'Số tiền', type: 'number', required: true }] })],
        authorization: { ...myTurn, editableAttributeKeys: ['step:d-s1:amount'] },
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    const open = screen.getByRole('link', { name: 'Mở để xử lý' });
    expect(open.getAttribute('href')).toBe('#workspace/1');
    expect(open.getAttribute('title')).toBe('Cần nhập: Số tiền');
  });

  it('chưa tới lượt: không có nút thao tác, chỉ hiện nhãn "Chờ …"', () => {
    setup([instance('2', { authorization: notMine })]);
    const row = screen.getByText('Quy trình: Hồ sơ 2').closest('tr') as HTMLElement;
    const pill = within(row).getByText('Chờ Kế toán trưởng');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.getAttribute('title')).toBe('Chờ Kế toán trưởng');
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(within(row).queryByText('Mở để xử lý')).toBeNull();
  });

  it('báo lỗi khi thao tác không thành công', async () => {
    mocked.applyProcedureAction.mockRejectedValueOnce(new Error('Hồ sơ đã được người khác xử lý.'));
    const { onError, onChanged } = setup([instance('1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Hồ sơ đã được người khác xử lý.'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('bỏ cột "Bắt đầu dự kiến", giữ "Bắt đầu thực tế" và "Kết thúc dự kiến"', () => {
    setup();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).not.toContain('Bắt đầu dự kiến');
    expect(headers).toContain('Bắt đầu thực tế');
    expect(headers).toContain('Kết thúc dự kiến');
  });

  it('cột Hành động hiện HẾT thao tác xếp dọc kiểu 1office: chỉnh sửa, duyệt, hủy', () => {
    setup([instance('1')]);
    const list = screen.getByLabelText('Thao tác cho QT-1');
    expect(within(list).getAllByRole('button').map((item) => item.textContent)).toEqual([
      'Không duyệt, cần chỉnh sửa',
      'Duyệt',
      'Không duyệt, hủy',
    ]);
    expect(list.className).toContain('actionListBracket');
  });

  it('"Không duyệt, hủy": xác nhận (lý do tuỳ chọn) rồi gọi reject', async () => {
    const { onChanged } = setup([instance('1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Không duyệt, hủy' }));
    expect(mocked.applyProcedureAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Lý do/), { target: { value: 'Trùng hồ sơ' } });
    // Nút xác nhận của ô hỏi trùng tên với thao tác trên dòng: lấy nút sau cùng.
    const buttons = screen.getAllByRole('button', { name: 'Không duyệt, hủy' });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.applyProcedureAction).toHaveBeenCalledWith('1', 'reject', 'Trùng hồ sơ');
  });

  it('hạn đã qua: chỉ tô đỏ ngày, không hiện chữ "Quá hạn" (chỉ ở chú thích khi rê chuột)', () => {
    setup([instance('1', { steps: [step({ slaDueAt: '2020-01-01T08:00:00.000Z' })] })]);
    expect(screen.queryByText('Quá hạn')).toBeNull();
    const date = screen.getByTitle('Quá hạn');
    expect(date.textContent).toMatch(/^\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
    expect(date.className).toContain('overdue');
  });

  describe('sắp xếp và bố cục cột', () => {
    const rowTitles = () => screen.getAllByText(/^Quy trình: /).map((node) => node.textContent);
    const headerTexts = () => screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    const sortFixtures = () => [
      instance('1', { steps: [step({ name: 'Bước B', startedAt: '2026-11-22T08:00:00.000Z' })] }),
      instance('3', { steps: [step({ name: 'Bước A', startedAt: '2026-11-21T08:00:00.000Z' })] }),
      instance('5', { steps: [step({ name: 'Bước C', startedAt: '2026-11-23T08:00:00.000Z' })] }),
    ];

    it('bấm tiêu đề cột: tăng dần → giảm dần → về mặc định, có aria-sort và lưu lựa chọn', () => {
      setup(sortFixtures());
      const header = () => screen.getByRole('columnheader', { name: /Tên công việc/ });
      const before = rowTitles();
      expect(header().getAttribute('aria-sort')).toBe('none');

      fireEvent.click(screen.getByRole('button', { name: 'Tên công việc' }));
      expect(rowTitles()).toEqual(['Quy trình: Hồ sơ 3', 'Quy trình: Hồ sơ 1', 'Quy trình: Hồ sơ 5']);
      expect(header().getAttribute('aria-sort')).toBe('ascending');
      expect(JSON.parse(window.localStorage.getItem('procedure-overview.sort.v1') ?? 'null')).toEqual({
        key: 'name',
        direction: 'asc',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Tên công việc' }));
      expect(rowTitles()).toEqual(['Quy trình: Hồ sơ 5', 'Quy trình: Hồ sơ 1', 'Quy trình: Hồ sơ 3']);
      expect(header().getAttribute('aria-sort')).toBe('descending');

      fireEvent.click(screen.getByRole('button', { name: 'Tên công việc' }));
      expect(rowTitles()).toEqual(before);
      expect(header().getAttribute('aria-sort')).toBe('none');
      expect(window.localStorage.getItem('procedure-overview.sort.v1')).toBeNull();
    });

    it('khôi phục sắp xếp đã lưu khi mở lại', () => {
      window.localStorage.setItem('procedure-overview.sort.v1', JSON.stringify({ key: 'actualStart', direction: 'desc' }));
      setup(sortFixtures());
      expect(rowTitles()).toEqual(['Quy trình: Hồ sơ 5', 'Quy trình: Hồ sơ 1', 'Quy trình: Hồ sơ 3']);
    });

    it('kéo tiêu đề thả lên cột khác để đổi chỗ, lưu lại; "Về mặc định" trả về như cũ', () => {
      setup([instance('1')]);
      const defaults = headerTexts();
      expect(defaults).toEqual(['', 'Tên công việc', 'Bắt đầu thực tế', 'Kết thúc dự kiến', 'Hành động', 'Người tạo']);
      const owner = screen.getByRole('columnheader', { name: /Người tạo/ });
      const name = screen.getByRole('columnheader', { name: /Tên công việc/ });
      const dataTransfer = {
        types: ['application/x-procedure-overview-column'],
        setData: jest.fn(),
        getData: () => 'owner',
        effectAllowed: '',
        dropEffect: '',
      };
      // jsdom không có DragEvent đủ toạ độ: gắn clientX vào sự kiện để thả vào nửa trái của cột đích.
      const dragAt = (target: HTMLElement, type: 'dragOver' | 'drop', clientX: number) => {
        const event = createEvent[type](target, { dataTransfer });
        Object.defineProperty(event, 'clientX', { value: clientX });
        fireEvent(target, event);
      };
      fireEvent.dragStart(owner, { dataTransfer });
      dragAt(name, 'dragOver', -1);
      expect(name.className).toMatch(/dropBefore/);
      dragAt(name, 'drop', -1);
      expect(headerTexts()).toEqual(['', 'Người tạo', 'Tên công việc', 'Bắt đầu thực tế', 'Kết thúc dự kiến', 'Hành động']);
      // Ô dữ liệu đi theo tiêu đề.
      const firstRow = screen.getByText('Quy trình: Hồ sơ 1').closest('tr') as HTMLElement;
      expect(firstRow.children[1]?.textContent).toBe('NANguyễn Văn A');
      expect(JSON.parse(window.localStorage.getItem('procedure-overview.columns.v1') ?? '{}').order).toEqual([
        'owner',
        'name',
        'actualStart',
        'plannedEnd',
        'action',
      ]);

      fireEvent.click(screen.getByRole('button', { name: /^Cột/ }));
      const panel = screen.getByRole('dialog', { name: 'Tuỳ chỉnh cột' });
      fireEvent.click(within(panel).getByRole('button', { name: /Về mặc định/ }));
      expect(headerTexts()).toEqual(defaults);
      expect(window.localStorage.getItem('procedure-overview.columns.v1')).toBeNull();
    });

    it('kéo mép phải tiêu đề đổi độ rộng (có mức tối thiểu), không kích hoạt sắp xếp', () => {
      setup([instance('1')]);
      const handle = screen.getByRole('separator', { name: 'Độ rộng cột Người tạo' });
      const header = screen.getByRole('columnheader', { name: /Người tạo/ });
      fireEvent.mouseDown(handle, { button: 0, clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 160 });
      fireEvent.mouseUp(document);
      fireEvent.click(handle);
      expect(header.getAttribute('aria-sort')).toBe('none');
      const cols = () => [...document.querySelectorAll('col')].map((col) => (col as HTMLElement).style.width);
      // Mặc định 176px + 60px.
      expect(cols()[5]).toBe('236px');
      fireEvent.mouseDown(handle, { button: 0, clientX: 100 });
      fireEvent.mouseMove(document, { clientX: -500 });
      fireEvent.mouseUp(document);
      expect(cols()[5]).toBe('110px');
      expect(JSON.parse(window.localStorage.getItem('procedure-overview.columns.v1') ?? '{}').widths).toEqual({ owner: 110 });
    });

    it('ẩn cột trong bảng chọn "Cột"; cột "Tên công việc" không ẩn được', () => {
      setup([instance('1')]);
      fireEvent.click(screen.getByRole('button', { name: /^Cột/ }));
      const panel = screen.getByRole('dialog', { name: 'Tuỳ chỉnh cột' });
      expect((within(panel).getByLabelText('Tên công việc') as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(within(panel).getByLabelText('Người tạo'));
      expect(headerTexts()).not.toContain('Người tạo');
      const groupCell = document.querySelector('tr[data-group] td') as HTMLTableCellElement;
      expect(groupCell.colSpan).toBe(5);
    });
  });

  describe('duyệt / không duyệt hàng loạt', () => {
    const bulkDefinitions = [
      definition('def-1', { approve: true, reject: true }),
      definition('def-approve', { approve: true }),
      definition('def-off'),
    ];

    it('quy trình không bật thao tác hàng loạt: ô chọn bị khoá, có ghi chú', () => {
      setup([instance('1', { definitionId: 'def-off' }), instance('3')], bulkDefinitions);
      const locked = screen.getByLabelText('Chọn QT-1') as HTMLInputElement;
      expect(locked.disabled).toBe(true);
      expect(locked.getAttribute('title')).toBe('Quy trình này không cho duyệt hàng loạt');
      expect((screen.getByLabelText('Chọn QT-3') as HTMLInputElement).disabled).toBe(false);
      // Chọn cả trang chỉ chọn dòng chọn được.
      fireEvent.click(screen.getByLabelText('Chọn mọi hồ sơ trên trang'));
      expect(screen.getByText('Đã chọn 1 hồ sơ')).toBeTruthy();
    });

    it('nút chỉ đếm hồ sơ đủ điều kiện cho từng thao tác', () => {
      setup(
        [
          instance('1'),
          instance('3', { definitionId: 'def-approve' }),
          instance('5', {
            steps: [step({ attributes: [{ id: 'at', code: 'amount', name: 'Số tiền', type: 'number', required: true }] })],
            authorization: { ...myTurn, editableAttributeKeys: ['step:d-s1:amount'] },
          }),
        ],
        bulkDefinitions,
      );
      fireEvent.click(screen.getByLabelText('Chọn mọi hồ sơ trên trang'));
      expect(screen.getByText('Đã chọn 3 hồ sơ')).toBeTruthy();
      // QT-5 cần nhập thêm nên không tính vào duyệt; QT-3 không bật không duyệt hàng loạt.
      expect(screen.getByRole('button', { name: /Duyệt 2 hồ sơ/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Không duyệt 2 hồ sơ/ })).toBeTruthy();
    });

    it('duyệt gọi một lần API hàng loạt với mọi hồ sơ đã chọn, rồi hiện kết quả và làm mới', async () => {
      mocked.bulkProcedureAction.mockResolvedValueOnce({
        done: [{ id: '1', code: 'QT-1' }],
        skipped: [
          { id: '3', code: 'QT-3', reason: 'failed', message: 'Hồ sơ đã được người khác xử lý.' },
          { id: 'x', code: null, reason: 'not_found', message: 'Không tìm thấy hồ sơ.' },
        ],
      });
      const { onChanged, onNotice } = setup([instance('1'), instance('3')], bulkDefinitions);
      fireEvent.click(screen.getByLabelText('Chọn mọi hồ sơ trên trang'));
      fireEvent.click(screen.getByRole('button', { name: /Duyệt 2 hồ sơ/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Đồng ý' }));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(mocked.bulkProcedureAction).toHaveBeenCalledTimes(1);
      expect(mocked.bulkProcedureAction).toHaveBeenCalledWith('approve', ['1', '3'], undefined);
      expect(mocked.applyProcedureAction).not.toHaveBeenCalled();
      expect(onNotice).toHaveBeenCalledWith('Đã duyệt 1 hồ sơ.');
      const summary = screen.getByRole('status', { name: 'Kết quả xử lý hàng loạt' });
      expect(within(summary).getByText('Đã duyệt 1 hồ sơ')).toBeTruthy();
      // Hiện tên hồ sơ, không hiện mã (mã nằm ở gợi ý khi rê chuột).
      expect(summary.textContent).toContain('Hồ sơ 3: Hồ sơ đã được người khác xử lý.');
      expect(summary.textContent).not.toContain('QT-3');
      expect(summary.textContent).toContain('Hồ sơ không xem được: Không tìm thấy hồ sơ.');
      fireEvent.click(within(summary).getByRole('button', { name: 'Đóng' }));
      expect(screen.queryByRole('status', { name: 'Kết quả xử lý hàng loạt' })).toBeNull();
    });

    it('không duyệt hàng loạt bắt buộc lý do', async () => {
      mocked.bulkProcedureAction.mockResolvedValueOnce({ done: [{ id: '1', code: 'QT-1' }], skipped: [] });
      const { onChanged } = setup([instance('1')], bulkDefinitions);
      fireEvent.click(screen.getByLabelText('Chọn QT-1'));
      fireEvent.click(screen.getByRole('button', { name: /Không duyệt 1 hồ sơ/ }));
      const confirm = screen.getByRole('button', { name: 'Không duyệt' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/Lý do không duyệt/), { target: { value: 'Sai đơn giá' } });
      fireEvent.click(confirm);
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(mocked.bulkProcedureAction).toHaveBeenCalledWith('reject', ['1'], 'Sai đơn giá');
      expect(screen.getByText('Đã không duyệt (huỷ) 1 hồ sơ')).toBeTruthy();
    });
  });
});
