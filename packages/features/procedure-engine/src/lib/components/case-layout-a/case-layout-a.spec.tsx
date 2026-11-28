/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ProcedureAttachment,
  ProcedureDefinition,
  ProcedureInstance,
} from '@enterprise-platform/contracts-procedure-engine';
import * as api from '../../procedure-api';
import { WorkspaceBoard } from '../workspace-board';
import { CASE_LAYOUT_STORAGE_KEY } from './case-layout';
import { toolbarLayoutOf, widthModeOf } from './use-width-mode';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  retainProcedureRoom: () => () => undefined,
}));
jest.mock('../../procedure-api', () => ({
  ...jest.requireActual('../../procedure-api'),
  applyProcedureAction: jest.fn(),
  bulkProcedureAction: jest.fn(),
}));

const mocked = api as jest.Mocked<typeof api>;

// Bề rộng khung giả lập cho ResizeObserver (jsdom không có).
let mockWidth = 1400;
class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: mockWidth } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve = jest.fn();
  disconnect = jest.fn();
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = '';
  mockWidth = 1400;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const step = (order: number, status: string, name: string) => ({
  id: `step-${order}`,
  definitionStepId: `def-${order}`,
  key: `s${order}`,
  order,
  name,
  status,
  currentRoleStage: 'A',
  assignments: [],
});

function makeInstance(overrides: Record<string, unknown> = {}): ProcedureInstance {
  return {
    id: 'inst-1',
    code: 'PR-1',
    title: 'Thanh toán mua thùng dây mạng',
    definitionId: 'def',
    definitionCode: 'PR',
    definitionName: 'Thanh toán',
    definitionVersion: 2,
    status: 'running',
    initiatedBy: 'u-1',
    startedAt: '2026-10-22T01:15:00.000Z',
    currentStepId: 'step-3',
    activity: [{ id: 'a-1', action: 'start', actorName: 'Hồ Thọ', summary: 'Mở hồ sơ', createdAt: '2026-10-22T01:15:00.000Z' }],
    authorization: {
      myRoles: ['R'],
      currentRoleStage: 'A',
      availableActions: ['comment', 'complete', 'return', 'reject'],
      isOverride: false,
      editableAttributeKeys: [],
    },
    steps: [
      step(1, 'completed', 'Chuẩn bị hồ sơ'),
      step(2, 'completed', 'Quản lý duyệt'),
      step(3, 'active', 'Lập phiếu chi'),
      step(4, 'pending', 'Kế toán ghi sổ'),
    ],
    ...overrides,
  } as unknown as ProcedureInstance;
}

/** Hồ sơ có lịch sử: bước 1 do Nguyễn Văn A duyệt kèm ý kiến; bước 3 chờ vai A là Kế toán. */
function withHistory(overrides: Record<string, unknown> = {}): ProcedureInstance {
  const base = makeInstance(overrides);
  return {
    ...base,
    activity: [
      ...base.activity,
      {
        id: 'a-2',
        action: 'approve',
        actorId: 'u-2',
        actorName: 'Nguyễn Văn A',
        summary: 'Đã duyệt',
        comment: 'Đồng ý chi',
        stepInstanceId: 'step-1',
        createdAt: '2026-10-22T03:20:00.000Z',
      },
    ],
    steps: base.steps.map((item) =>
      item.id === 'step-1'
        ? { ...item, assignments: [{ id: 'as-0', role: 'A', subjectId: 'u-2', subjectType: 'user', subjectLabel: 'Nguyễn Văn A' }] }
        : item.id === 'step-3'
          ? {
              ...item,
              slaDueAt: '2026-10-23T09:30:00.000Z',
              assignments: [
                { id: 'as-1', role: 'A', subjectId: 'pos-1', subjectType: 'position', subjectLabel: 'Kế toán' },
              ],
            }
          : item,
    ),
  } as unknown as ProcedureInstance;
}

const FILES = [
  { id: 'f-1', instanceId: 'inst-1', stepInstanceId: 'step-1', fileName: 'hoa-don.pdf' },
] as unknown as ProcedureAttachment[];

const project = (projectId: string, projectName: string) => ({
  workspaceProject: { projectId, projectCode: projectId.toUpperCase(), projectName },
});

/** Tới lượt người xem duyệt ngay trên dòng (không cần nhập thêm). */
const approving = {
  myRoles: ['A'],
  currentRoleStage: 'A',
  availableActions: ['comment', 'approve'],
  isOverride: false,
  editableAttributeKeys: [],
  currentStepPart: 'act',
};

const baseProps = {
  definitions: [],
  canCreateInstances: false,
  onAction: jest.fn(async () => undefined),
  onOpenDefinitions: jest.fn(),
  onStart: jest.fn(async () => undefined),
};

const layoutRoot = (container: HTMLElement) => container.querySelector('[data-layout="a"]');
const table = () => within(screen.getByLabelText('Danh sách hồ sơ')).getByRole('table');
const modal = () => screen.getByRole('dialog', { name: 'Thanh toán mua thùng dây mạng' });
const openRow = (title: string) => fireEvent.click(screen.getByRole('link', { name: `Quy trình: ${title}` }));

describe('Giao diện mới - nút đổi giao diện', () => {
  it('mặc định là giao diện mới; bấm "Cũ" về giao diện cũ (danh sách | chi tiết) và nhớ lựa chọn, bấm "Mới" quay lại', () => {
    const { container, unmount } = render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    expect(layoutRoot(container)).toBeTruthy();
    const toggle = screen.getByRole('group', { name: 'Giao diện' });
    expect(within(toggle).getByRole('button', { name: 'Mới' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(toggle).getByRole('button', { name: 'Cũ' }));
    expect(layoutRoot(container)).toBeNull();
    expect(window.localStorage.getItem(CASE_LAYOUT_STORAGE_KEY)).toBe('legacy');
    // Giao diện cũ: khung chia đôi, tự mở hồ sơ đầu trang, không có bảng chung và cửa sổ.
    expect(screen.getByLabelText('Chi tiết hồ sơ PR-1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Thanh toán mua thùng dây mạng/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('group', { name: 'Giao diện' })).toBeTruthy();
    unmount();

    // Mở lại màn: đọc lựa chọn đã lưu.
    const again = render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    expect(layoutRoot(again.container)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
    expect(layoutRoot(again.container)).toBeTruthy();
    expect(window.localStorage.getItem(CASE_LAYOUT_STORAGE_KEY)).toBe('a');
  });

  it('nhúng trong khung khác thì giữ giao diện cũ, không có nút đổi', () => {
    const { container } = render(
      <WorkspaceBoard {...baseProps} instances={[makeInstance()]} initialInstanceId="inst-1" embedded />,
    );
    expect(layoutRoot(container)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Giao diện' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Nội dung hồ sơ' }).textContent).toContain('Tiến trình');
  });
});

describe('Giao diện mới - bảng hồ sơ', () => {
  const instances = [
    makeInstance({ id: 'a1', code: 'A-1', title: 'Hồ sơ dự án Đăkrơsa 1', startedAt: '2026-10-25T00:00:00.000Z', ...project('p-1', 'Thủy điện Đăkrơsa') }),
    makeInstance({ id: 'n1', code: 'N-1', title: 'Hồ sơ lẻ', startedAt: '2026-10-24T00:00:00.000Z' }),
    makeInstance({ id: 'b1', code: 'B-1', title: 'Hồ sơ Euro Plast', startedAt: '2026-10-23T00:00:00.000Z', ...project('p-2', 'Euro Plast') }),
    makeInstance({ id: 'a2', code: 'A-2', title: 'Hồ sơ dự án Đăkrơsa 2', startedAt: '2026-10-22T00:00:00.000Z', ...project('p-1', 'Thủy điện Đăkrơsa') }),
  ];

  it('bảng chung (như Tổng quan): gom theo dự án, "Không thuộc dự án" cuối; có cột Trạng thái, SLA; không hiện mã hồ sơ', () => {
    render(<WorkspaceBoard {...baseProps} instances={instances} />);
    const headers = within(table()).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['', 'Tên công việc', 'Trạng thái', 'SLA', 'Bắt đầu thực tế', 'Kết thúc dự kiến', 'Hành động', 'Người tạo']);
    const groups = [...table().querySelectorAll('tr[data-group] button')].map((button) => button.textContent);
    expect(groups).toEqual(['Thủy điện Đăkrơsa(2)', 'Euro Plast(1)', 'Không thuộc dự án(1)']);
    // Tên công việc là bước đang ở, dòng dưới là tên hồ sơ; mã chỉ ở gợi ý.
    const link = screen.getByRole('link', { name: 'Quy trình: Hồ sơ Euro Plast' });
    expect(link.getAttribute('title')).toContain('Mã hồ sơ B-1');
    expect(link.closest('tr')?.textContent).toContain('Lập phiếu chi');
    expect(link.closest('tr')?.textContent).toContain('Đang xử lý');
    expect(table().textContent).not.toContain('B-1');
    // Cột "Cột" của trang này lưu riêng (khoá của bảng Hồ sơ xử lý), không dùng khoá cũ của Tổng quan.
    fireEvent.click(screen.getByRole('button', { name: /^Cột/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Tuỳ chỉnh cột' })).getByLabelText('SLA'));
    expect(within(table()).queryByRole('columnheader', { name: /^SLA/ })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('procedure-case-board.columns.v1') ?? '{}').hidden).toEqual(['sla']);
    expect(window.localStorage.getItem('procedure-overview.columns.v1')).toBeNull();
  });

  it('tab trạng thái giữ nguyên số đếm và cách lọc; tìm vẫn khớp mã hồ sơ', () => {
    const { unmount } = render(
      <WorkspaceBoard {...baseProps} instances={[...instances, makeInstance({ id: 'c1', code: 'C-1', status: 'completed' })]} />,
    );
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect([...tabs.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Đang xử lý4',
      'Duyệt gấp / SLA0',
      'Đang theo dõi0',
      'Bạn đã xử lý0',
      'Hoàn thành1',
      'Từ chối0',
      'Đã huỷ0',
      'Đã huỷ hiệu lực0',
      'Tất cả5',
    ]);
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toBe('Đang xử lý4');
    fireEvent.click(within(tabs).getByRole('tab', { name: /Hoàn thành/ }));
    expect(screen.getAllByRole('link', { name: /^Quy trình:/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Đặt lại' })).toBeTruthy();
    // Không tự mở hồ sơ nào.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: /Tất cả/ }));
    fireEvent.change(screen.getByLabelText('Tìm hồ sơ'), { target: { value: 'B-1' } });
    expect(screen.getAllByRole('link', { name: /^Quy trình:/ }).map((item) => item.textContent)).toEqual([
      'Quy trình: Hồ sơ Euro Plast',
    ]);
    unmount();

    render(<WorkspaceBoard {...baseProps} instances={[]} />);
    expect(screen.getByText('Chưa có hồ sơ.')).toBeTruthy();
  });

  it('"Đang xử lý" / "Duyệt gấp / SLA" chỉ gồm hồ sơ tới lượt mình; chưa tới lượt nằm ở "Đang theo dõi"; số đếm khớp danh sách', () => {
    const overdue = (instance: ProcedureInstance) =>
      ({
        ...instance,
        steps: instance.steps.map((item) => (item.id === 'step-3' ? { ...item, slaDueAt: '2020-01-01T00:00:00.000Z' } : item)),
      }) as unknown as ProcedureInstance;
    const others = { myRoles: [], currentRoleStage: 'A', availableActions: ['comment'], isOverride: false, editableAttributeKeys: [] };
    const cases = [
      makeInstance({ id: 'm1', code: 'M-1', title: 'Tới lượt tôi' }),
      overdue(makeInstance({ id: 'm2', code: 'M-2', title: 'Tới lượt tôi, quá hạn' })),
      // Đầu việc E(x) của tôi chưa xong: tới lượt dù không có nút duyệt.
      makeInstance({ id: 'm3', code: 'M-3', title: 'Đầu việc của tôi', authorization: { ...others, currentStepPart: 'act' } }),
      makeInstance({ id: 'w1', code: 'W-1', title: 'Chờ người khác', authorization: others }),
      overdue(makeInstance({ id: 'w2', code: 'W-2', title: 'Chờ người khác, quá hạn', authorization: { ...others, currentStepPart: 'done' } })),
      makeInstance({ id: 'c1', code: 'C-1', title: 'Đã xong', status: 'completed' }),
    ];
    const titles = () => screen.queryAllByRole('link', { name: /^Quy trình:/ }).map((item) => item.textContent?.replace('Quy trình: ', ''));
    const { unmount } = render(<WorkspaceBoard {...baseProps} instances={cases} />);
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect([...tabs.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Đang xử lý3',
      'Duyệt gấp / SLA1',
      'Đang theo dõi2',
      'Bạn đã xử lý1',
      'Hoàn thành1',
      'Từ chối0',
      'Đã huỷ0',
      'Đã huỷ hiệu lực0',
      'Tất cả6',
    ]);
    expect(titles().sort()).toEqual(['Tới lượt tôi', 'Tới lượt tôi, quá hạn', 'Đầu việc của tôi'].sort());
    fireEvent.click(within(tabs).getByRole('tab', { name: /Duyệt gấp/ }));
    expect(titles()).toEqual(['Tới lượt tôi, quá hạn']);
    fireEvent.click(within(tabs).getByRole('tab', { name: /Đang theo dõi/ }));
    expect(titles().sort()).toEqual(['Chờ người khác', 'Chờ người khác, quá hạn'].sort());
    fireEvent.click(within(tabs).getByRole('tab', { name: /Tất cả/ }));
    expect(titles()).toHaveLength(6);
    unmount();

    // Giao diện cũ giữ cách đếm cũ: mọi hồ sơ đang chạy, không có tab "Đang theo dõi" / "Bạn đã xử lý".
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    render(<WorkspaceBoard {...baseProps} instances={cases} />);
    const legacyTabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect([...legacyTabs.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Đang xử lý5',
      'Duyệt gấp / SLA2',
      'Hoàn thành1',
      'Từ chối0',
      'Đã huỷ0',
      'Đã huỷ hiệu lực0',
      'Tất cả6',
    ]);
  });

  it('mở thẳng qua đường dẫn một hồ sơ chưa tới lượt mình: chuyển sang tab "Đang theo dõi"', async () => {
    const others = { myRoles: [], currentRoleStage: 'A', availableActions: ['comment'], isOverride: false, editableAttributeKeys: [] };
    render(
      <WorkspaceBoard
        {...baseProps}
        instances={[makeInstance({ id: 'm1', code: 'M-1', title: 'Tới lượt tôi' }), makeInstance({ id: 'w1', code: 'W-1', title: 'Chờ người khác', authorization: others })]}
        initialInstanceId="w1"
      />,
    );
    await act(async () => undefined);
    expect(screen.getByRole('dialog', { name: 'Chờ người khác' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toBe('Đang theo dõi1');
  });

  it('"Duyệt" ngay trên dòng đi đúng đường xử lý hồ sơ của màn (onAction)', async () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[makeInstance({ authorization: approving })]} />);
    const actions = screen.getByLabelText('Thao tác cho PR-1');
    fireEvent.click(within(actions).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('inst-1', 'approve', undefined));
    // Thao tác trên dòng không mở cửa sổ hồ sơ.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('chọn dòng hiện thanh duyệt hàng loạt theo cấu hình của quy trình; duyệt xong nạp lại danh sách', async () => {
    mocked.bulkProcedureAction.mockResolvedValueOnce({ done: [{ id: 'inst-1', code: 'PR-1' }], skipped: [] });
    const onChanged = jest.fn(async () => undefined);
    const onNotice = jest.fn();
    const definitions = [{ id: 'def', code: 'PR', name: 'Thanh toán', bulkActions: { approve: true } }] as unknown as ProcedureDefinition[];
    render(
      <WorkspaceBoard
        {...baseProps}
        definitions={definitions}
        onChanged={onChanged}
        onNotice={onNotice}
        instances={[
          makeInstance({ authorization: approving }),
          makeInstance({ id: 'x2', code: 'X-2', title: 'Hồ sơ khác', definitionId: 'off', authorization: approving }),
        ]}
      />,
    );
    expect((screen.getByLabelText('Chọn X-2') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Chọn PR-1'));
    expect(screen.getByText('Đã chọn 1 hồ sơ')).toBeTruthy();
    // Bấm ô chọn không mở hồ sơ.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Duyệt 1 hồ sơ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.bulkProcedureAction).toHaveBeenCalledWith('approve', ['inst-1'], undefined);
    expect(onNotice).toHaveBeenCalledWith('Đã duyệt 1 hồ sơ.');
    expect(screen.getByRole('status', { name: 'Kết quả xử lý hàng loạt' }).textContent).toContain('Đã duyệt 1 hồ sơ');
  });
});

describe('Giao diện mới - tab "Bạn đã xử lý" (luật "Bạn thực hiện – Hoàn thành" của Tổng quan cũ)', () => {
  const ME = 'u-me';
  const others = { myRoles: [], currentRoleStage: 'A', availableActions: ['comment'], isOverride: false, editableAttributeKeys: [] };
  const myApproval = (stepInstanceId: string, createdAt: string) => ({
    id: `mine-${stepInstanceId}`,
    action: 'approve',
    actorId: ME,
    actorName: 'Tôi',
    summary: 'Đã duyệt',
    stepInstanceId,
    createdAt,
  });
  const cases = () => [
    // Tới lượt mình: không tính dù đã từng duyệt một bước trước.
    makeInstance({
      id: 'act',
      title: 'Tới lượt tôi',
      activity: [...makeInstance().activity, myApproval('step-1', '2026-10-22T02:00:00.000Z')],
    }),
    // Đã xong phần mình ở bước hiện tại (server tính `done`).
    makeInstance({ id: 'done-part', title: 'Đã xong phần tôi', authorization: { ...others, currentStepPart: 'done' } }),
    // Hồ sơ đã đóng, mình đã duyệt bước 2.
    makeInstance({
      id: 'closed',
      title: 'Đã đóng, tôi đã duyệt',
      status: 'completed',
      currentStepId: undefined,
      authorization: others,
      activity: [...makeInstance().activity, myApproval('step-2', '2026-10-23T02:00:00.000Z')],
    }),
    // Không liên quan: chưa tới lượt, chưa xử lý gì.
    makeInstance({ id: 'none', title: 'Không liên quan', authorization: others }),
    // Chỉ trao đổi thì không phải đã xử lý.
    makeInstance({
      id: 'comment',
      title: 'Tôi chỉ trao đổi',
      authorization: others,
      activity: [
        ...makeInstance().activity,
        { id: 'c-1', action: 'comment', actorId: ME, actorName: 'Tôi', summary: 'Hỏi', createdAt: '2026-10-22T05:00:00.000Z' },
      ],
    }),
  ];
  const titles = () => screen.queryAllByRole('link', { name: /^Quy trình:/ }).map((item) => item.textContent?.replace('Quy trình: ', ''));

  it('nằm sau "Đang theo dõi"; số đếm và danh sách đúng luật isMyDone; dòng hiện bước mình xử lý gần nhất', () => {
    render(<WorkspaceBoard {...baseProps} actorId={ME} instances={cases()} />);
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    const labels = [...tabs.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(labels.indexOf('Bạn đã xử lý2')).toBe(labels.findIndex((label) => label?.startsWith('Đang theo dõi')) + 1);

    fireEvent.click(within(tabs).getByRole('tab', { name: /Bạn đã xử lý/ }));
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toBe('Bạn đã xử lý2');
    expect(titles().sort()).toEqual(['Đã xong phần tôi', 'Đã đóng, tôi đã duyệt'].sort());
    // Hồ sơ đã đóng: "Tên công việc" là bước mình đã duyệt (bước 2), không phải bước xong sau cùng.
    const closed = screen.getByRole('link', { name: 'Quy trình: Đã đóng, tôi đã duyệt' }).closest('tr') as HTMLElement;
    expect(closed.textContent).toContain('Quản lý duyệt');
    // Không tự mở hồ sơ nào.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('không biết người xem (thiếu actorId) thì chỉ còn hồ sơ server báo đã xong phần mình', () => {
    render(<WorkspaceBoard {...baseProps} instances={cases()} />);
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    fireEvent.click(within(tabs).getByRole('tab', { name: /Bạn đã xử lý/ }));
    expect(titles()).toEqual(['Đã xong phần tôi']);
  });

  it('giao diện cũ không có tab này; đang ở tab này mà đổi sang giao diện cũ thì về "Đang xử lý"', () => {
    render(<WorkspaceBoard {...baseProps} actorId={ME} instances={cases()} />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Bạn đã xử lý/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Giao diện' })).getByRole('button', { name: 'Cũ' }));
    const tabs = screen.getByRole('tablist', { name: 'Lọc theo trạng thái' });
    expect(within(tabs).queryByRole('tab', { name: /Bạn đã xử lý/ })).toBeNull();
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toMatch(/^Đang xử lý/);
    // Quay lại giao diện mới: tab vẫn còn.
    fireEvent.click(within(screen.getByRole('group', { name: 'Giao diện' })).getByRole('button', { name: 'Mới' }));
    expect(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Bạn đã xử lý/ })).toBeTruthy();
  });
});

describe('Giao diện mới - cửa sổ hồ sơ', () => {
  const three = [
    withHistory({ startedAt: '2026-10-25T00:00:00.000Z' }),
    makeInstance({ id: 'i2', code: 'I-2', title: 'Hồ sơ thứ hai', startedAt: '2026-10-24T00:00:00.000Z' }),
    makeInstance({ id: 'i3', code: 'I-3', title: 'Hồ sơ thứ ba', startedAt: '2026-10-23T00:00:00.000Z' }),
  ];

  it('bấm tên hồ sơ (hay cả dòng) mở cửa sổ, ghi #workspace/<id>; đóng thì bỏ chọn, về #workspace, trả focus về dòng', () => {
    render(<WorkspaceBoard {...baseProps} instances={three} />);
    openRow('Thanh toán mua thùng dây mạng');
    const dialog = modal();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(window.location.hash).toBe('#workspace/inst-1');
    expect(within(dialog).getByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Quy trình: Thanh toán mua thùng dây mạng' }).closest('tr')?.className).toContain(
      'rowOpen',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng hồ sơ' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#workspace');
    const rowLink = screen.getByRole('link', { name: 'Quy trình: Thanh toán mua thùng dây mạng' }).closest('tr')?.querySelector('a');
    expect(document.activeElement).toBe(rowLink);

    // Bấm vào ô trống của dòng cũng mở.
    const row = screen.getByRole('link', { name: 'Quy trình: Hồ sơ thứ hai' }).closest('tr') as HTMLElement;
    fireEvent.click(row.querySelector('td:last-child') as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Hồ sơ thứ hai' })).toBeTruthy();
  });

  it('‹ › đi tới hồ sơ trước / sau theo thứ tự đang thấy, hiện "n / N"', () => {
    render(<WorkspaceBoard {...baseProps} instances={three} />);
    openRow('Thanh toán mua thùng dây mạng');
    expect((within(modal()).getByRole('button', { name: 'Hồ sơ trước' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(modal()).getByRole('button', { name: 'Hồ sơ sau' }));
    const second = screen.getByRole('dialog', { name: 'Hồ sơ thứ hai' });
    expect(within(second).getByText('2 / 3')).toBeTruthy();
    expect(window.location.hash).toBe('#workspace/i2');
    fireEvent.click(within(second).getByRole('button', { name: 'Hồ sơ sau' }));
    const third = screen.getByRole('dialog', { name: 'Hồ sơ thứ ba' });
    expect((within(third).getByRole('button', { name: 'Hồ sơ sau' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(third).getByRole('button', { name: 'Hồ sơ trước' }));
    expect(screen.getByRole('dialog', { name: 'Hồ sơ thứ hai' })).toBeTruthy();
  });

  it('Esc đóng cửa sổ; khi đang có hộp xác nhận / hộp thoại con thì Esc không đóng cửa sổ', () => {
    const cancellable = makeInstance({
      authorization: { ...makeInstance().authorization, availableActions: ['comment', 'complete', 'cancel'] },
    });
    render(<WorkspaceBoard {...baseProps} instances={[cancellable]} />);
    openRow('Thanh toán mua thùng dây mạng');

    // Ô xác nhận tại chỗ "Huỷ hồ sơ".
    fireEvent.click(within(modal()).getByRole('button', { name: 'Huỷ hồ sơ' }));
    expect(screen.getByText('Xác nhận huỷ hồ sơ này?')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modal()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Không' }));

    // Hộp thoại xác nhận hoàn tất (vẽ ngoài cửa sổ, nằm trên).
    fireEvent.click(within(modal()).getByRole('button', { name: 'Hoàn tất' }));
    expect(screen.getByRole('dialog', { name: 'Xác nhận hoàn tất bước này?' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(modal()).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Xác nhận hoàn tất bước này?' })).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bấm nền đóng cửa sổ; bấm trong cửa sổ thì không', () => {
    render(<WorkspaceBoard {...baseProps} instances={three} />);
    openRow('Thanh toán mua thùng dây mạng');
    fireEvent.mouseDown(modal());
    fireEvent.click(modal());
    expect(modal()).toBeTruthy();
    const backdrop = modal().parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('giữ Tab trong cửa sổ: Tab ở phần tử cuối quay về đầu, Shift+Tab ở đầu sang cuối', () => {
    render(<WorkspaceBoard {...baseProps} instances={three} />);
    openRow('Thanh toán mua thùng dây mạng');
    const dialog = modal();
    expect(document.activeElement).toBe(dialog);
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input')];
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('chuyển hồ sơ qua ‹ › sang trang khác thì bảng cũng sang trang đó', () => {
    const many = Array.from({ length: 16 }, (_, index) =>
      makeInstance({
        id: `m${index + 1}`,
        code: `M-${index + 1}`,
        title: `Hồ sơ số ${index + 1}`,
        startedAt: `2026-10-${String(30 - index).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    render(<WorkspaceBoard {...baseProps} instances={many} />);
    expect(screen.getByText('Trang 1 / 2')).toBeTruthy();
    openRow('Hồ sơ số 15');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Hồ sơ số 15' })).getByRole('button', { name: 'Hồ sơ sau' }));
    expect(within(screen.getByRole('dialog', { name: 'Hồ sơ số 16' })).getByText('16 / 16')).toBeTruthy();
    expect(screen.getByText('Trang 2 / 2')).toBeTruthy();
  });

  it('cửa sổ chỉ giữ nhãn, giá trị và cảnh báo ngắn: bỏ chữ hướng dẫn dài của khung xử lý', () => {
    const { unmount } = render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    openRow('Thanh toán mua thùng dây mạng');
    // Cửa sổ: nút "Đính kèm tệp" mở thẳng hộp chọn tệp, không có khung thả tệp kèm chữ hướng dẫn.
    expect(within(modal()).getByRole('button', { name: 'Đính kèm tệp' })).toBeTruthy();
    expect(within(modal()).queryByRole('button', { name: /Đính kèm tài liệu/ })).toBeNull();
    expect(within(modal()).queryByText('Tệp sẽ được tải lên tự động khi bạn bấm gửi phê duyệt')).toBeNull();
    expect((within(modal()).getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe('Ý kiến / ghi chú…');
    unmount();

    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Đính kèm tài liệu/ }));
    expect(screen.getByRole('button', { name: 'Chọn tệp từ máy tính' })).toBeTruthy();
    expect(screen.queryByText('Tệp sẽ được tải lên tự động khi bạn bấm gửi phê duyệt')).toBeNull();
  });

  it('mở thẳng qua đường dẫn (#workspace/<id>) thì mở cửa sổ hồ sơ đó', async () => {
    render(<WorkspaceBoard {...baseProps} instances={three} initialInstanceId="i3" />);
    await act(async () => undefined);
    expect(screen.getByRole('dialog', { name: 'Hồ sơ thứ ba' })).toBeTruthy();
  });

  it('đường dẫn về #workspace (nút Back) thì đóng cửa sổ', async () => {
    const { rerender } = render(<WorkspaceBoard {...baseProps} instances={three} initialInstanceId="i2" />);
    await act(async () => undefined);
    expect(screen.getByRole('dialog', { name: 'Hồ sơ thứ hai' })).toBeTruthy();
    rerender(<WorkspaceBoard {...baseProps} instances={three} initialInstanceId={undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đầu hồ sơ: lưới thông tin chính thẳng cột; không hiện mã hồ sơ (mã nằm ở gợi ý tên)', () => {
    render(<WorkspaceBoard {...baseProps} instances={[withHistory(project('p-1', 'Thủy điện Đăkrơsa'))]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const grid = modal().querySelector('dl[aria-label="Thông tin hồ sơ"]') as HTMLElement;
    const pairs = [...grid.querySelectorAll('div')].map((item) => item.textContent);
    expect(pairs[0]).toBe('Dự ánThủy điện Đăkrơsa');
    expect(pairs).toContain('Quy trìnhThanh toán · v2');
    expect(pairs).toContain('Khởi tạoHồ Thọ');
    expect(pairs.find((text) => text?.startsWith('Mở đơn'))).toMatch(/^Mở đơn\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/);
    expect(pairs.find((text) => text?.startsWith('Hạn'))).toMatch(/^Hạn\d{2}:\d{2} 23\/10\/2026$/);
    expect(pairs).toContain('Bước2/4 · Lập phiếu chi');
    expect(pairs).toContain('Người xử lýKế toán');
    expect(pairs).toContain('NguồnTạo thủ công');
    expect(within(grid).getByRole('link', { name: 'Thủy điện Đăkrơsa' }).getAttribute('href')).toBe(
      '/modules/workspace?project=p-1#projects/project/p-1',
    );
    expect(within(modal()).getByRole('heading', { name: 'Thanh toán mua thùng dây mạng' }).getAttribute('title')).toBe(
      'Thanh toán mua thùng dây mạng\nMã hồ sơ PR-1',
    );
    expect(modal().textContent).not.toContain('PR-1');
  });

  it('tên hồ sơ, chip trạng thái / SLA và nút quản trị nằm trên thanh đầu cửa sổ (cạnh ‹ n/N ›), không lặp trong vùng cuộn', () => {
    const allowed = withHistory({
      authorization: {
        ...makeInstance().authorization,
        availableActions: ['comment', 'complete', 'cancel'],
        canRelinkWorkspace: true,
        canDelete: true,
      },
    });
    render(
      <WorkspaceBoard
        {...baseProps}
        instances={[allowed]}
        onDeleteInstance={jest.fn(async () => undefined)}
        onRelinkWorkspace={jest.fn(async () => undefined)}
      />,
    );
    openRow('Thanh toán mua thùng dây mạng');
    const dialog = modal();
    const [bar, body] = [...dialog.children] as HTMLElement[];
    expect(bar?.className).toContain('modalBar');
    const heading = within(bar as HTMLElement).getByRole('heading', { name: 'Thanh toán mua thùng dây mạng' });
    // Tên cửa sổ lấy từ chính tiêu đề trên thanh.
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(within(bar as HTMLElement).getByText('1 / 1')).toBeTruthy();
    expect(within(bar as HTMLElement).getByText('Đang xử lý')).toBeTruthy();
    for (const name of ['Huỷ hồ sơ', 'Đổi dự án / công việc', 'Xoá đơn', 'Đóng hồ sơ']) {
      expect(within(bar as HTMLElement).getByRole('button', { name })).toBeTruthy();
    }
    // Vùng cuộn không còn khối tên riêng, không lặp nút quản trị.
    expect(within(body as HTMLElement).queryByRole('heading', { name: 'Thanh toán mua thùng dây mạng' })).toBeNull();
    expect(within(body as HTMLElement).queryByRole('button', { name: 'Huỷ hồ sơ' })).toBeNull();
    expect(within(body as HTMLElement).queryByRole('button', { name: 'Xoá đơn' })).toBeNull();
    expect(dialog.querySelectorAll('h2')).toHaveLength(1);
    // Tên dài tối đa 2 dòng trên thanh (không 1 dòng cắt cụt).
    expect(scssBlock('case-layout-a.module.scss', '.title')).toContain('-webkit-line-clamp: 2');
  });

  it('không ghi câu "Công việc ... trong dự án ..." (dự án đã ở lưới thông tin); chỉ cảnh báo ngắn một dòng khi lỗi', () => {
    const link = { projectId: 'p-1', projectCode: 'DA-IMP-123', baseTitle: 'x', workItem: {}, requestedBy: 'u-1', requestedAt: '2026-10-22T01:15:00.000Z' };
    const { unmount } = render(
      <WorkspaceBoard
        {...baseProps}
        instances={[makeInstance({ workspaceLink: { ...link, status: 'linked', workItemCode: 'CV063' } })]}
      />,
    );
    openRow('Thanh toán mua thùng dây mạng');
    expect(modal().textContent).not.toContain('Công việc CV063 trong dự án DA-IMP-123');
    expect(modal().querySelector('[data-link-warning]')).toBeNull();
    unmount();

    render(
      <WorkspaceBoard
        {...baseProps}
        instances={[makeInstance({ workspaceLink: { ...link, status: 'pending' } })]}
      />,
    );
    openRow('Thanh toán mua thùng dây mạng');
    expect(modal().textContent).not.toContain('Đang tạo công việc trong dự án');
    expect(modal().querySelector('[data-link-warning]')).toBeNull();
    fireEvent.click(within(modal()).getByRole('button', { name: 'Đóng hồ sơ' }));
  });

  it('không tạo được công việc bên Workspace: một dòng cảnh báo, đủ lý do ở gợi ý', () => {
    const link = { projectId: 'p-1', projectCode: 'DA-IMP-123', baseTitle: 'x', workItem: {}, requestedBy: 'u-1', requestedAt: '2026-10-22T01:15:00.000Z' };
    render(
      <WorkspaceBoard
        {...baseProps}
        instances={[makeInstance({ workspaceLink: { ...link, status: 'rejected', error: 'không phải thành viên dự án' } })]}
      />,
    );
    openRow('Thanh toán mua thùng dây mạng');
    const warnings = modal().querySelectorAll('[data-link-warning]');
    expect(warnings).toHaveLength(1);
    const warning = warnings[0] as HTMLElement;
    expect(warning.textContent).toBe('Không tạo được công việc trong dự án DA-IMP-123: không phải thành viên dự án');
    expect(warning.getAttribute('title')).toBe(warning.textContent);
    expect(scssBlock('case-layout-a.module.scss', '.linkWarningText')).toContain('white-space: nowrap');
  });

  it('các bước nằm ngang: tên và trạng thái từng bước', () => {
    const returned = makeInstance({
      steps: [step(1, 'completed', 'Chuẩn bị hồ sơ'), step(2, 'returned', 'Quản lý duyệt'), step(3, 'active', 'Lập phiếu chi'), step(4, 'pending', 'Kế toán ghi sổ')],
    });
    render(<WorkspaceBoard {...baseProps} instances={[returned]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const items = within(screen.getByRole('list', { name: 'Các bước của hồ sơ' })).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['done', 'returned', 'current', 'upcoming']);
    expect(items.map((item) => item.textContent)).toEqual([
      'Chuẩn bị hồ sơHoàn thành',
      'Quản lý duyệtTrả lại',
      '3Lập phiếu chiĐang xử lý',
      '4Kế toán ghi sổChờ',
    ]);
    expect(items[2]?.getAttribute('aria-current')).toBe('step');
  });

  it('tiến trình: bước đã qua một dòng chia cột (người xử lý + vai, thời gian, kết quả, ý kiến, số tệp); bước đang làm nổi bật', () => {
    render(<WorkspaceBoard {...baseProps} attachments={FILES} instances={[withHistory()]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const tabs = within(modal()).getByRole('tablist', { name: 'Nội dung hồ sơ' });
    expect(within(tabs).getByRole('tab', { selected: true }).textContent).toContain('Tiến trình');
    for (const label of ['Trao đổi', 'Tệp & tài liệu', 'Nhật ký']) expect(tabs.textContent).toContain(label);

    const flow = within(modal()).getByRole('list', { name: 'Tiến trình các bước' });
    // Không có dòng tiêu đề cột (Bước / Người xử lý / Thời gian / Kết quả / Ý kiến / Tệp) phía trên các bước.
    expect(flow.previousElementSibling?.className ?? '').not.toContain('flowGrid');
    expect(modal().querySelector('[class*="flowHead"]')).toBeNull();
    for (const label of ['Thời gian', 'Kết quả', 'Ý kiến', 'Tệp']) expect(within(modal()).queryByText(label)).toBeNull();
    const items = [...flow.children] as HTMLElement[];
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming']);

    const done = within(items[0] as HTMLElement).getByRole('button', { name: /Bước 1 · Chuẩn bị hồ sơ/ });
    const cells = [...done.children].map((cell) => cell.textContent);
    expect(cells[1]).toBe('Bước 1 · Chuẩn bị hồ sơ');
    expect(cells[2]).toBe('ANguyễn Văn A');
    expect(cells[3]).toMatch(/^\d{2}:\d{2} 22\/10\/2026$/);
    expect(cells[4]).toBe('Đã duyệt');
    expect(cells[5]).toBe('Đồng ý chi');
    expect(within(done).getByTitle('1 tệp của bước này').textContent?.trim()).toBe('1');

    // Bước đang làm: khung "Việc cần làm" có một dòng đầu (tên bước, vai của bạn; hạn đã ở đầu cửa sổ) và khung xử lý.
    const current = items[2] as HTMLElement;
    const head = current.querySelector('[data-task-head]') as HTMLElement;
    expect(head.textContent).toContain('Lập phiếu chi');
    expect(head.textContent).not.toContain('Hạn');
    expect(within(head).queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    expect(within(current).getByRole('button', { name: 'Hoàn tất' })).toBeTruthy();
    // Bước sắp tới: dòng mờ, không bấm được.
    expect(items[3]?.textContent).toContain('Bước 4 · Kế toán ghi sổ');
    expect(within(items[3] as HTMLElement).queryByRole('button')).toBeNull();

    fireEvent.click(done);
    expect(within(items[0] as HTMLElement).getByText('Bước 1')).toBeTruthy();
    fireEvent.click(within(modal()).getByRole('button', { name: /Thu gọn bước 1/ }));
    expect(within(modal()).queryByText('Bước 1')).toBeNull();
  });

  it('bấm một bước trên thanh ngang thì mở bước đó trên tiến trình (cả khi đang ở tab khác)', () => {
    render(<WorkspaceBoard {...baseProps} instances={[withHistory()]} />);
    openRow('Thanh toán mua thùng dây mạng');
    fireEvent.click(within(modal()).getByRole('tab', { name: /Nhật ký/ }));
    expect(screen.queryByRole('list', { name: 'Tiến trình các bước' })).toBeNull();
    fireEvent.click(within(screen.getByRole('list', { name: 'Các bước của hồ sơ' })).getByRole('button', { name: /Quản lý duyệt/ }));
    expect(screen.getByRole('list', { name: 'Tiến trình các bước' })).toBeTruthy();
    expect(within(modal()).getByText('Bước 2')).toBeTruthy();
  });

  it('nút đầu hồ sơ theo đúng điều kiện cũ; hộp đổi dự án nằm trên cửa sổ và Esc chỉ đóng hộp đó', async () => {
    const onAction = jest.fn(async () => undefined);
    const allowed = makeInstance({
      authorization: {
        ...makeInstance().authorization,
        availableActions: ['comment', 'complete', 'cancel'],
        canRelinkWorkspace: true,
        canDelete: true,
      },
    });
    const { unmount } = render(
      <WorkspaceBoard
        {...baseProps}
        onAction={onAction}
        instances={[allowed]}
        onDeleteInstance={jest.fn(async () => undefined)}
        onRelinkWorkspace={jest.fn(async () => undefined)}
      />,
    );
    openRow('Thanh toán mua thùng dây mạng');
    expect(within(modal()).getByRole('button', { name: 'Xoá đơn' })).toBeTruthy();
    fireEvent.click(within(modal()).getByRole('button', { name: 'Đổi dự án / công việc' }));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs.length).toBe(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(modal()).toBeTruthy();

    fireEvent.click(within(modal()).getByRole('button', { name: 'Huỷ hồ sơ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý huỷ' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('inst-1', 'cancel', undefined, undefined, undefined));
    unmount();

    render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    openRow('Thanh toán mua thùng dây mạng');
    expect(within(modal()).queryByRole('button', { name: 'Đổi dự án / công việc' })).toBeNull();
    expect(within(modal()).queryByRole('button', { name: 'Xoá đơn' })).toBeNull();
    expect(within(modal()).queryByRole('button', { name: 'Huỷ hồ sơ' })).toBeNull();
  });
});

describe('Giao diện mới - bổ sung tài liệu (tab "Tệp & tài liệu")', () => {
  const openFiles = () => fireEvent.click(within(modal()).getByRole('tab', { name: /Tệp & tài liệu/ }));
  const pickFile = (file: File) => {
    const button = within(modal()).getByRole('button', { name: 'Bổ sung tài liệu' });
    const input = button.parentElement?.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('người tham gia (không phải người xem) bổ sung tài liệu ở bước sau, gọi đúng hàm bổ sung của màn', () => {
    const onSupplementFile = jest.fn();
    // Người này đã xử lý bước trước, bước hiện tại không còn tới lượt: vẫn được bổ sung.
    const later = withHistory({
      authorization: { myRoles: [], currentRoleStage: 'A', availableActions: ['comment'], isOverride: false, editableAttributeKeys: [], canSupplement: true },
    });
    render(<WorkspaceBoard {...baseProps} onSupplementFile={onSupplementFile} instances={[later]} />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Tất cả/ }));
    openRow('Thanh toán mua thùng dây mạng');
    openFiles();
    const file = new File(['a'], 'bien-ban.pdf', { type: 'application/pdf' });
    pickFile(file);
    expect(onSupplementFile).toHaveBeenCalledWith('inst-1', file);
  });

  it('hồ sơ đã hoàn thành: người tham gia vẫn bổ sung được', () => {
    const onSupplementFile = jest.fn();
    const done = makeInstance({
      status: 'completed',
      completedAt: '2026-10-25T00:00:00.000Z',
      currentStepId: undefined,
      authorization: { myRoles: [], availableActions: [], isOverride: false, editableAttributeKeys: [], canSupplement: true },
    });
    render(<WorkspaceBoard {...baseProps} onSupplementFile={onSupplementFile} instances={[done]} />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Hoàn thành/ }));
    openRow('Thanh toán mua thùng dây mạng');
    openFiles();
    const file = new File(['b'], 'nghiem-thu.pdf', { type: 'application/pdf' });
    pickFile(file);
    expect(onSupplementFile).toHaveBeenCalledWith('inst-1', file);
  });

  it('người chỉ xem (vai I, không được bổ sung) không có nút "Bổ sung tài liệu"', () => {
    const viewer = makeInstance({
      authorization: { myRoles: ['I'], currentRoleStage: 'A', availableActions: [], isOverride: false, editableAttributeKeys: [], canSupplement: false },
    });
    render(<WorkspaceBoard {...baseProps} onSupplementFile={jest.fn()} instances={[viewer]} />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Tất cả/ }));
    openRow('Thanh toán mua thùng dây mạng');
    openFiles();
    expect(within(modal()).queryByRole('button', { name: 'Bổ sung tài liệu' })).toBeNull();
  });
});

describe('Giao diện mới - hàng nút thao tác ghim đáy cửa sổ', () => {
  const pinnedRow = () => {
    const row = document.querySelector('[data-pinned-actions="true"]');
    if (!row) throw new Error('Không thấy hàng nút ghim đáy');
    return row as HTMLElement;
  };

  it('có đủ Hoàn tất / Trả lại / Từ chối; bấm gọi đúng hành động như giao diện cũ; cửa sổ vẫn mở', async () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[makeInstance()]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const row = pinnedRow();
    expect(modal().contains(row)).toBe(true);
    expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['Trả lại', 'Từ chối', 'Hoàn tất']);

    fireEvent.click(within(row).getByRole('button', { name: 'Hoàn tất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý hoàn tất' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'complete', undefined, undefined, {}));
    expect(modal()).toBeTruthy();

    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Từ chối' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý từ chối' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'reject', undefined, undefined, undefined));

    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Trả lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận trả lại' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'return', undefined, undefined, undefined));
  });

  it('xử lý xong (hồ sơ sang bước khác) thì cửa sổ giữ hồ sơ đã nạp lại và mời "Hồ sơ kế tiếp"', () => {
    const second = makeInstance({ id: 'i2', code: 'I-2', title: 'Hồ sơ thứ hai', startedAt: '2026-10-21T00:00:00.000Z' });
    const { rerender } = render(<WorkspaceBoard {...baseProps} instances={[makeInstance(), second]} />);
    openRow('Thanh toán mua thùng dây mạng');
    expect(within(modal()).queryByRole('button', { name: /Hồ sơ kế tiếp/ })).toBeNull();
    const moved = makeInstance({
      currentStepId: 'step-4',
      steps: [step(1, 'completed', 'Chuẩn bị hồ sơ'), step(2, 'completed', 'Quản lý duyệt'), step(3, 'completed', 'Lập phiếu chi'), step(4, 'active', 'Kế toán ghi sổ')],
    });
    rerender(<WorkspaceBoard {...baseProps} instances={[moved, second]} />);
    expect(modal()).toBeTruthy();
    fireEvent.click(within(modal()).getByRole('button', { name: /Hồ sơ kế tiếp/ }));
    expect(screen.getByRole('dialog', { name: 'Hồ sơ thứ hai' })).toBeTruthy();
  });

  it('pha duyệt: nút Phê duyệt cũng nằm trong hàng ghim và gửi approve', async () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[makeInstance({ authorization: approving })]} />);
    openRow('Thanh toán mua thùng dây mạng');
    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Phê duyệt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý phê duyệt' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'approve', undefined, undefined, {}));
  });

  it('giao diện cũ không gắn hàng ghim của giao diện mới', () => {
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    expect(document.querySelector('[data-pinned-actions]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hoàn tất' })).toBeTruthy();
  });
});

describe('Giao diện mới - theo bề rộng khung', () => {
  it('widthModeOf / toolbarLayoutOf', () => {
    expect(widthModeOf(0)).toBe('wide');
    expect(widthModeOf(1000)).toBe('wide');
    expect(widthModeOf(999)).toBe('medium');
    expect(widthModeOf(719)).toBe('narrow');
    expect(toolbarLayoutOf(1800)).toBe('one');
    expect(toolbarLayoutOf(1300)).toBe('split');
    expect(toolbarLayoutOf(900)).toBe('stack');
  });

  it('khung hẹp vẫn là bảng (cuộn trong thẻ) và cửa sổ hồ sơ', () => {
    mockWidth = 600;
    const { container } = render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    expect(layoutRoot(container)?.getAttribute('data-width-mode')).toBe('narrow');
    openRow('Thanh toán mua thùng dây mạng');
    expect(modal()).toBeTruthy();
  });
});

/** Khối luật của một selector trong file SCSS (đủ cho các khối không lồng nhau ở đây). */
function scssBlock(file: string, selector: string, from = 0): string {
  const source = readFileSync(join(__dirname, file), 'utf8');
  const start = source.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`Không thấy ${selector} trong ${file}`);
  return source.slice(start, source.indexOf('}', start));
}

describe('Giao diện mới - đầu cửa sổ hồ sơ gọn, cuộn cùng nội dung', () => {
  it('8 mục thông tin: Dự án ô rộng nhất, từ 1280px 5 cột x 2 hàng (Dự án và Bước 2 cột); đầu hồ sơ và thanh bước nằm trong vùng cuộn', () => {
    render(<WorkspaceBoard {...baseProps} instances={[withHistory(project('p-1', 'Thủy điện Đăkrơsa Một Hai Ba'))]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const grid = modal().querySelector('dl[aria-label="Thông tin hồ sơ"]') as HTMLElement;
    const items = [...grid.children] as HTMLElement[];
    expect(items.map((item) => item.querySelector('dt')?.textContent)).toEqual([
      'Dự án',
      'Quy trình',
      'Khởi tạo',
      'Mở đơn',
      'Hạn',
      'Bước',
      'Người xử lý',
      'Nguồn',
    ]);
    // Dự án và Bước (tên dài) có thêm chỗ khi cửa sổ rộng; Dự án luôn là ô rộng nhất.
    expect(items.filter((item) => item.className.includes('infoItemWide')).map((item) => item.querySelector('dt')?.textContent)).toEqual([
      'Dự án',
      'Bước',
    ]);
    expect(items.filter((item) => item.className.includes('infoItemProject')).map((item) => item.querySelector('dt')?.textContent)).toEqual([
      'Dự án',
    ]);
    // Tên dự án dài: hiện đủ chữ, xuống dòng; không có class cắt chữ ("…", kẹp số dòng); gợi ý có thêm mã dự án.
    const projectLink = within(grid).getByRole('link', { name: 'Thủy điện Đăkrơsa Một Hai Ba' });
    expect(projectLink.textContent).toBe('Thủy điện Đăkrơsa Một Hai Ba');
    const projectValue = projectLink.closest('dd') as HTMLElement;
    expect(projectValue.textContent).toBe('Thủy điện Đăkrơsa Một Hai Ba');
    for (const node of [projectValue, projectLink, projectValue.parentElement as HTMLElement]) {
      expect(node.className).not.toMatch(/ellipsis|clamp|truncate|nowrap/i);
    }
    expect(projectLink.getAttribute('title')).toContain('Thủy điện Đăkrơsa Một Hai Ba');
    expect(projectLink.getAttribute('title')).toContain('Mã dự án P-1');
    const value = scssBlock('case-layout-a.module.scss', '.infoItem dd');
    expect(value).not.toMatch(/text-overflow|nowrap|line-clamp|overflow: hidden/);
    expect(value).toContain('white-space: normal');
    // Tên bước trên thanh ngang: tối đa 2 dòng thay vì một dòng cắt "…".
    const stepName = scssBlock('case-layout-a.module.scss', '.stepperName');
    expect(stepName).toContain('-webkit-line-clamp: 2');
    expect(stepName).not.toContain('nowrap');

    // Đầu hồ sơ (cả thanh bước, tab) nằm TRONG vùng cuộn, không ghim.
    const header = modal().querySelector('header') as HTMLElement;
    const scroller = header.parentElement as HTMLElement;
    expect(scroller.className).toContain('detailScroll');
    expect(within(header).getByRole('list', { name: 'Các bước của hồ sơ' })).toBeTruthy();
    expect(scroller.contains(within(modal()).getByRole('list', { name: 'Tiến trình các bước' }))).toBe(true);

    expect(scssBlock('case-layout-a.module.scss', '.infoGrid')).toContain('grid-template-columns: minmax(0, 1fr)');
    const wide = readFileSync(join(__dirname, 'case-layout-a.module.scss'), 'utf8');
    const from480 = wide.slice(wide.indexOf('@media (min-width: 480px)'));
    expect(from480).toMatch(/\.infoGrid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.infoItemProject \{\s*grid-column: span 2;/);
    const from768 = wide.slice(wide.indexOf('@media (min-width: 768px)'));
    expect(from768).toMatch(/\.infoGrid \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    const media = wide.slice(wide.indexOf('@media (min-width: 1280px)'));
    expect(media).toMatch(/\.infoGrid \{\s*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
    expect(media).toMatch(/\.infoItemWide \{\s*grid-column: span 2;/);
    const head = scssBlock('case-layout-a.module.scss', '.detailHead');
    expect(head).not.toMatch(/position:\s*sticky/);
  });

  it('cửa sổ rộng tối đa 1440px (96% màn), cao 92% màn; dưới 768px toàn màn', () => {
    const panel = scssBlock('case-layout-a.module.scss', '.modalBackdrop .modalPanel');
    expect(panel).toContain('width: min(1440px, 96vw)');
    expect(panel).toContain('height: 92vh');
    const source = readFileSync(join(__dirname, 'case-layout-a.module.scss'), 'utf8');
    const mobile = scssBlock('case-layout-a.module.scss', '.modalBackdrop .modalPanel', source.indexOf('@media (max-width: 767px)'));
    expect(mobile).toContain('width: 100vw');
    expect(mobile).toContain('height: 100dvh');
  });

  it('tên dự án còn đang tra: hiện khung chờ thay vì để trống', () => {
    const fetchMock = jest.fn(() => new Promise(() => undefined));
    const previous = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    try {
      render(
        <WorkspaceBoard
          {...baseProps}
          instances={[makeInstance({ sourceType: 'workspace_work_item', sourceId: '00000000-0000-4000-8000-0000000000aa' })]}
        />,
      );
      openRow('Thanh toán mua thùng dây mạng');
      const grid = modal().querySelector('dl[aria-label="Thông tin hồ sơ"]') as HTMLElement;
      expect(within(grid).getByLabelText('Đang tải tên dự án')).toBeTruthy();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = previous;
    }
  });
});

describe('Giao diện mới - tiến độ từng người trong bước (Xem xét rồi Phê duyệt)', () => {
  const assignments = [
    { id: 'as-r', role: 'R', subjectId: 'u-lan', subjectType: 'user', subjectLabel: 'Trần Thị Lan' },
    { id: 'as-a', role: 'A', subjectId: 'pos-kt', subjectType: 'position', subjectLabel: 'Kế toán trưởng' },
  ];
  const act3 = (id: string, action: string, actorName: string, createdAt: string, stepInstanceId: string, comment?: string) => ({
    id,
    action,
    actorId: `id-${actorName}`,
    actorName,
    summary: action,
    createdAt,
    stepInstanceId,
    ...(comment ? { comment } : {}),
  });
  const lines = (list: HTMLElement) =>
    [...list.querySelectorAll('li')].map((line) => [
      line.getAttribute('data-role'),
      line.getAttribute('data-status'),
      line.textContent,
    ]);

  it('bước đang làm: người xem xét đã xong (tên, giờ, ý kiến), người phê duyệt đang chờ; ai mở hồ sơ cũng thấy', () => {
    const instance = makeInstance({
      authorization: { myRoles: [], currentRoleStage: 'A', availableActions: ['comment'], isOverride: false, editableAttributeKeys: [] },
      activity: [
        act3('a-9', 'complete', 'Trần Thị Lan', '2026-10-22T03:20:00.000Z', 'step-3', 'Hồ sơ đủ'),
        { id: 'a-1', action: 'start', actorName: 'Hồ Thọ', summary: 'Mở hồ sơ', createdAt: '2026-10-22T01:15:00.000Z' },
      ],
      steps: [
        step(1, 'completed', 'Chuẩn bị hồ sơ'),
        step(2, 'completed', 'Quản lý duyệt'),
        { ...step(3, 'ready', 'Lập phiếu chi'), startedAt: '2026-10-22T02:00:00.000Z', assignments },
        step(4, 'pending', 'Kế toán ghi sổ'),
      ],
    });
    render(<WorkspaceBoard {...baseProps} instances={[instance]} />);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Lọc theo trạng thái' })).getByRole('tab', { name: /Tất cả/ }));
    openRow('Thanh toán mua thùng dây mạng');
    const task = within(modal()).getByRole('region', { name: 'Việc cần làm' });
    const list = within(task).getByRole('list', { name: 'Tiến độ từng người ở bước 3' });
    const [review, approve] = lines(list);
    expect(review?.slice(0, 2)).toEqual(['R', 'done']);
    expect(review?.[2]).toMatch(/^Xem xétTrần Thị LanĐã xem xét\d{2}:\d{2} 22\/10\/2026Hồ sơ đủ$/);
    expect(approve).toEqual(['A', 'waiting', 'Phê duyệtKế toán trưởngĐang chờ']);
  });

  it('bước đã xong: đã xem xét và đã phê duyệt; bước bị trả lại: đã xem xét và đã trả lại kèm lý do', () => {
    const instance = makeInstance({
      activity: [
        act3('a-5', 'return', 'Phạm Kế Toán', '2026-10-22T06:00:00.000Z', 'step-2', 'Thiếu hoá đơn'),
        act3('a-4', 'complete', 'Trần Thị Lan', '2026-10-22T05:00:00.000Z', 'step-2'),
        act3('a-3', 'approve', 'Phạm Kế Toán', '2026-10-22T04:00:00.000Z', 'step-1'),
        act3('a-2', 'complete', 'Trần Thị Lan', '2026-10-22T03:00:00.000Z', 'step-1'),
        { id: 'a-1', action: 'start', actorName: 'Hồ Thọ', summary: 'Mở hồ sơ', createdAt: '2026-10-22T01:15:00.000Z' },
      ],
      steps: [
        { ...step(1, 'completed', 'Chuẩn bị hồ sơ'), startedAt: '2026-10-22T01:15:00.000Z', assignments },
        { ...step(2, 'returned', 'Quản lý duyệt'), assignments },
        step(3, 'active', 'Lập phiếu chi'),
        step(4, 'pending', 'Kế toán ghi sổ'),
      ],
    });
    render(<WorkspaceBoard {...baseProps} instances={[instance]} />);
    openRow('Thanh toán mua thùng dây mạng');
    const done = within(modal()).getByRole('list', { name: 'Tiến độ từng người ở bước 1' });
    expect(lines(done).map((line) => line.slice(0, 2))).toEqual([
      ['R', 'done'],
      ['A', 'done'],
    ]);
    expect(done.textContent).toContain('Đã xem xét');
    expect(done.textContent).toContain('Phạm Kế ToánĐã phê duyệt');
    const returned = within(modal()).getByRole('list', { name: 'Tiến độ từng người ở bước 2' });
    expect(lines(returned).map((line) => line.slice(0, 2))).toEqual([
      ['R', 'done'],
      ['A', 'returned'],
    ]);
    expect(returned.textContent).toContain('Đã trả lại');
    expect(returned.textContent).toContain('Thiếu hoá đơn');
  });

  it('giao diện cũ không thêm dòng tiến độ từng người', () => {
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    const instance = makeInstance({
      steps: [step(1, 'completed', 'Chuẩn bị hồ sơ'), step(2, 'completed', 'Quản lý duyệt'), { ...step(3, 'ready', 'Lập phiếu chi'), assignments }, step(4, 'pending', 'Kế toán ghi sổ')],
    });
    render(<WorkspaceBoard {...baseProps} instances={[instance]} />);
    expect(document.querySelector('[data-stage-progress]')).toBeNull();
  });
});

describe('Bảng hồ sơ - tiêu đề cột đủ chữ', () => {
  const FULL = ['Tên công việc', 'Bắt đầu thực tế', 'Kết thúc dự kiến', 'Hành động', 'Người tạo'];

  it('Hồ sơ xử lý: tiêu đề cột hiện đủ tên, được xuống dòng, không cắt "…"', () => {
    render(<WorkspaceBoard {...baseProps} instances={[makeInstance()]} />);
    const caseHeaders = within(table()).getAllByRole('columnheader').map((cell) => cell.textContent);
    for (const label of [...FULL, 'Trạng thái', 'SLA']) expect(caseHeaders).toContain(label);
    for (const cell of within(table()).getAllByRole('columnheader').slice(1)) {
      expect(cell.className).not.toMatch(/ellipsis|truncate/);
      expect(cell.querySelector('[class*="headLabel"]')).toBeTruthy();
    }
    // Kiểu của tiêu đề: xuống dòng, không cắt chữ.
    expect(scssBlock('../case-table/case-table.module.scss', '.headLabel')).not.toContain('ellipsis');
    expect(scssBlock('../case-table/case-table.module.scss', '.headLabel')).toContain('white-space: normal');
    expect(scssBlock('../case-table/case-table.module.scss', '.headCell')).not.toContain('ellipsis');
    expect(scssBlock('../case-table/case-table.module.scss', '  th')).toContain('white-space: normal');
  });
});
