/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { AttributeForm } from '../attribute-form';
import type { PayeePicker } from '../use-payee-picker';
import { WorkspaceBoard } from '../workspace-board';
import { CASE_LAYOUT_STORAGE_KEY } from './case-layout';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  retainProcedureRoom: () => () => undefined,
}));

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([{ contentRect: { width: 1400 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve = jest.fn();
  disconnect = jest.fn();
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = '';
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const POSITIONS = [
  'Trưởng Văn phòng Đại diện',
  'Trưởng phòng Hành chính - Tổng hợp',
  'Chánh Văn phòng',
  'Chủ tịch HĐQT',
  'Tổng Giám đốc',
];

/** Hồ sơ "Thanh toán" ở bước 1, pha S: vai S giao cho cả dãy chức danh, nhưng hồ sơ đã do Hồ Thọ mở. */
function submitStep(overrides: Record<string, unknown> = {}): ProcedureInstance {
  return {
    id: 'inst-1',
    code: 'PR-1',
    title: 'Thanh toán tiền điện tháng 11',
    definitionId: 'def',
    definitionCode: 'PR',
    definitionName: 'Thanh toán',
    definitionVersion: 1,
    status: 'running',
    initiatedBy: 'u-1',
    startedAt: '2026-11-20T01:00:00.000Z',
    currentStepId: 'step-1',
    activity: [
      { id: 'a-1', action: 'start', actorId: 'u-1', actorName: 'Hồ Thọ', summary: 'Mở hồ sơ', createdAt: '2026-11-20T01:00:00.000Z' },
    ],
    flow: {
      gateways: [],
      attributes: [
        { code: 'so_tien', name: 'Số tiền', type: 'money', required: true },
        { code: 'noi_dung', name: 'Nội dung thanh toán', type: 'text' },
      ],
    },
    attributeValues: { 'step:def-2:ma_hd': { value: { type: 'text', value: 'HD-01' } } },
    authorization: {
      myRoles: ['S'],
      currentRoleStage: 'S',
      availableActions: ['comment', 'complete'],
      isOverride: false,
      canManageSubtasks: false,
      editableAttributeKeys: ['process:so_tien', 'process:noi_dung', 'step:def-2:so_hoa_don'],
    },
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'def-1',
        key: 's1',
        order: 1,
        name: 'Chuẩn bị hồ sơ thanh toán',
        status: 'active',
        currentRoleStage: 'S',
        slaDueAt: '2026-11-21T09:30:00.000Z',
        attributes: [],
        assignments: POSITIONS.map((label, index) => ({
          id: `as-${index}`,
          role: 'S',
          subjectType: 'position',
          subjectId: `pos-${index}`,
          subjectLabel: label,
        })),
      },
      {
        id: 'step-2',
        definitionStepId: 'def-2',
        key: 's2',
        order: 2,
        name: 'Kế toán kiểm tra',
        status: 'pending',
        currentRoleStage: 'A',
        attributes: [
          { code: 'so_hoa_don', name: 'Số hoá đơn', type: 'text' },
          { code: 'ma_hd', name: 'Mã hợp đồng', type: 'text' },
        ],
        assignments: [{ id: 'as-k', role: 'A', subjectId: 'pos-kt', subjectType: 'position', subjectLabel: 'Kế toán' }],
      },
    ],
    ...overrides,
  } as unknown as ProcedureInstance;
}

const baseProps = {
  definitions: [],
  canCreateInstances: false,
  onAction: jest.fn(async () => undefined),
  onOpenDefinitions: jest.fn(),
  onStart: jest.fn(async () => undefined),
};

const modal = () => screen.getByRole('dialog', { name: 'Thanh toán tiền điện tháng 11' });
const openCase = () => fireEvent.click(screen.getByRole('link', { name: 'Quy trình: Thanh toán tiền điện tháng 11' }));
/** Hồ sơ chưa tới lượt mình nằm ở tab "Đang theo dõi". */
const openWatched = () => {
  fireEvent.click(screen.getByRole('tab', { name: /Đang theo dõi/ }));
  openCase();
};
const infoValue = (label: string) => {
  const grid = modal().querySelector('dl[aria-label="Thông tin hồ sơ"]') as HTMLElement;
  const item = [...grid.querySelectorAll('div')].find((div) => div.querySelector('dt')?.textContent === label);
  return item?.querySelector('dd') as HTMLElement;
};
const panel = () => within(modal()).getByRole('region', { name: 'Việc cần làm' });
/** Người duyệt (pha A) của bước 1, không có ô nhập. */
const APPROVER = {
  myRoles: ['A'],
  currentRoleStage: 'A',
  availableActions: ['comment', 'approve'],
  isOverride: false,
  canManageSubtasks: false,
  editableAttributeKeys: [],
};
const pinnedRow = () => modal().querySelector('[data-pinned-actions="true"]') as HTMLElement;

describe('Cửa sổ hồ sơ - người xử lý', () => {
  it('bước 1 pha S: hiện người đã mở hồ sơ, không hiện danh sách chức danh được phép lập', () => {
    render(<WorkspaceBoard {...baseProps} instances={[submitStep()]} />);
    openCase();
    expect(infoValue('Người xử lý').textContent).toBe('Hồ Thọ');
    expect(modal().textContent).not.toContain('Chánh Văn phòng');
  });

  it('chỉ có chức danh: hiện 2 nhãn đầu + "+N", đủ danh sách ở gợi ý (lưới thông tin và dòng đầu khung)', () => {
    const waiting = submitStep({
      authorization: { myRoles: [], currentRoleStage: 'A', availableActions: [], isOverride: false, canManageSubtasks: false },
      steps: submitStep().steps.map((step) =>
        step.id === 'step-1'
          ? { ...step, currentRoleStage: 'A', assignments: step.assignments.map((item) => ({ ...item, role: 'A' })) }
          : step,
      ),
    });
    render(<WorkspaceBoard {...baseProps} instances={[waiting]} />);
    openWatched();
    const value = infoValue('Người xử lý');
    expect(value.textContent).toBe('Trưởng Văn phòng Đại diện, Trưởng phòng Hành chính - Tổng hợp +3');
    expect(value.getAttribute('title')).toBe(POSITIONS.join(', '));
    const head = panel().querySelector('[data-task-head]') as HTMLElement;
    expect(head.textContent).toContain('Đang chờ Trưởng Văn phòng Đại diện, Trưởng phòng Hành chính - Tổng hợp +3');
    expect(within(head).getByTitle(`Đang chờ ${POSITIONS.join(', ')}`)).toBeTruthy();
    // Bước đang làm trên thanh ngang: gợi ý có đủ danh sách.
    const current = within(screen.getByRole('list', { name: 'Các bước của hồ sơ' })).getByRole('button', {
      name: /Chuẩn bị hồ sơ thanh toán/,
    });
    expect(current.getAttribute('title')).toContain(`Chờ ${POSITIONS.join(', ')}`);
  });

  it('có sơ đồ tổ chức: chức danh phân giải ra tên người đang giữ', () => {
    const organization = {
      units: [],
      positions: [{ id: 'pos-0', name: POSITIONS[0], unitId: undefined }],
      members: [{ userId: 'u-5', displayName: 'Lê Văn Chánh', positionId: 'pos-0' }],
    } as unknown as TenantOrganizationSnapshot;
    const waiting = submitStep({
      authorization: { myRoles: [], currentRoleStage: 'A', availableActions: [], isOverride: false, canManageSubtasks: false },
      steps: submitStep().steps.map((step) =>
        step.id === 'step-1'
          ? { ...step, currentRoleStage: 'A', assignments: [{ ...step.assignments[0], role: 'A' }] }
          : step,
      ),
    });
    render(<WorkspaceBoard {...baseProps} organization={organization} instances={[waiting]} />);
    openWatched();
    expect(infoValue('Người xử lý').textContent).toBe('Lê Văn Chánh');
  });
});

describe('Cửa sổ hồ sơ - khung "Việc cần làm"', () => {
  it('một dòng đầu duy nhất (không dải lặp), vai bằng lời, ô nhập chỉ ghi phạm vi khi thuộc bước khác', () => {
    render(<WorkspaceBoard {...baseProps} instances={[submitStep()]} />);
    openCase();
    const region = panel();
    expect(modal().querySelectorAll('[data-task-head]')).toHaveLength(1);
    const head = region.querySelector('[data-task-head]') as HTMLElement;
    expect(within(head).getByRole('heading', { name: /Chuẩn bị hồ sơ thanh toán/ })).toBeTruthy();
    expect(head.textContent).toContain('Bạn · Khởi tạo');
    // Hạn và thời gian còn lại đã có ở đầu cửa sổ: dòng đầu khung không lặp lại, không có Lưu nháp.
    expect(head.textContent).not.toMatch(/Hạn|Còn /);
    expect(within(head).queryAllByRole('button')).toHaveLength(0);
    // Không còn dải "Bước 1 · Đang thực hiện", dòng vai S, "Vai của bạn" hay khung "Thông tin cần nhập" lồng bên trong.
    expect(modal().textContent).not.toContain('Đang thực hiện');
    expect(modal().textContent).not.toContain('Vai của bạn');
    expect(region.textContent).not.toContain('Thông tin cần nhập');
    expect(region.textContent).not.toContain('Thông tin chung');
    expect(region.textContent).toContain('từ bước 2');
    // Nhãn ô: bắt buộc vẫn có dấu *, ô tiền có "đ".
    const money = within(region).getByText('Số tiền').closest('label') as HTMLElement;
    expect(money.querySelector('em[aria-label="bắt buộc"]')).toBeTruthy();
    expect(money.textContent).toContain('đ');
    // Giá trị đã nhập ở bước khác: danh sách gọn "Thông tin đã nhập".
    expect(within(region).getByRole('heading', { name: 'Thông tin đã nhập' })).toBeTruthy();
    expect(region.textContent).toContain('HD-01');
    // Pha khởi tạo (S): không có ô ý kiến; nội dung là ô nhiều dòng.
    expect(within(region).queryByRole('textbox', { name: 'Ý kiến / ghi chú' })).toBeNull();
    expect((within(region).getByLabelText('Nội dung thanh toán') as HTMLElement).tagName).toBe('TEXTAREA');
  });

  it('cửa sổ không có Lưu nháp; giá trị vừa nhập vẫn đi cùng Hoàn tất như trước (không gọi lưu riêng)', async () => {
    const onAction = jest.fn(async () => undefined);
    const onSaveAttributes = jest.fn(async () => undefined);
    render(
      <WorkspaceBoard
        {...baseProps}
        onAction={onAction}
        onSaveAttributes={onSaveAttributes}
        instances={[submitStep()]}
      />,
    );
    openCase();
    expect(within(modal()).queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    fireEvent.change(within(panel()).getByLabelText('Nội dung thanh toán'), { target: { value: 'Tiền điện' } });
    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Hoàn tất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý hoàn tất' }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith('inst-1', 'complete', undefined, undefined, {
        'process:noi_dung': { type: 'text', value: 'Tiền điện' },
      }),
    );
    expect(onSaveAttributes).not.toHaveBeenCalled();
  });

  it('bước duyệt có ô nhập: Phê duyệt gửi kèm giá trị vừa nhập, không có Lưu nháp', async () => {
    const onAction = jest.fn(async () => undefined);
    const approval = submitStep({
      authorization: {
        myRoles: ['A'],
        currentRoleStage: 'A',
        availableActions: ['comment', 'approve'],
        isOverride: false,
        canManageSubtasks: false,
        editableAttributeKeys: ['process:noi_dung'],
      },
    });
    render(
      <WorkspaceBoard {...baseProps} onAction={onAction} onSaveAttributes={jest.fn(async () => undefined)} instances={[approval]} />,
    );
    openCase();
    expect(within(modal()).queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    fireEvent.change(within(panel()).getByLabelText('Nội dung thanh toán'), { target: { value: 'Duyệt chi' } });
    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Phê duyệt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý phê duyệt' }));
    await waitFor(() =>
      expect(onAction).toHaveBeenLastCalledWith('inst-1', 'approve', undefined, undefined, {
        'process:noi_dung': { type: 'text', value: 'Duyệt chi' },
      }),
    );
  });

  it('pha sau (A): ô ý kiến một dòng, nút "Đính kèm tệp" cùng hàng bên phải; tệp đã chọn dạng chip bên dưới hàng', () => {
    render(<WorkspaceBoard {...baseProps} instances={[submitStep({ authorization: APPROVER })]} />);
    openCase();
    expect(within(pinnedRow()).queryByRole('button', { name: 'Đính kèm tệp' })).toBeNull();
    const row = panel().querySelector('[data-comment-row]') as HTMLElement;
    expect(row.className).toContain('taskCommentRow');
    const comment = within(row).getByRole('textbox', { name: 'Ý kiến / ghi chú' }) as HTMLTextAreaElement;
    const attach = within(row).getByRole('button', { name: 'Đính kèm tệp' });
    // Ô ý kiến đứng trước, nút đính kèm ngay sau trong cùng hàng.
    expect(comment.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(comment.rows).toBe(1);
    expect(comment.placeholder).toBe('Ý kiến / ghi chú…');
    const input = row.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['a'], 'hoa-don.pdf', { type: 'application/pdf' })] } });
    const chip = within(panel()).getByText('hoa-don.pdf');
    expect(row.contains(chip)).toBe(false);
    expect(row.parentElement?.contains(chip)).toBe(true);
  });

  it('pha khởi tạo (S): không có ô ý kiến; "Đính kèm tệp" ở đầu trái hàng nút, tải tệp rồi mới Hoàn tất (ý kiến rỗng như cũ)', async () => {
    const onAction = jest.fn(async () => undefined);
    const onUploadFile = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} onUploadFile={onUploadFile} instances={[submitStep()]} />);
    openCase();
    const region = panel();
    expect(within(region).queryByRole('textbox', { name: 'Ý kiến / ghi chú' })).toBeNull();
    expect(region.querySelector('[data-comment-row]')).toBeNull();
    const input = pinnedRow().querySelector('input[type="file"]') as HTMLInputElement;
    const first = new File(['a'], 'hoa-don.pdf', { type: 'application/pdf' });
    const second = new File(['b'], 'bang-ke.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [first, second] } });
    expect(region.textContent).toContain('hoa-don.pdf');
    // Bỏ một tệp khỏi hàng chờ.
    fireEvent.click(within(region).getAllByRole('button', { name: 'Xoá tệp' })[1] as HTMLElement);
    expect(region.textContent).not.toContain('bang-ke.pdf');

    const row = pinnedRow();
    expect(within(row).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Đính kèm tệp',
      'Hoàn tất & Gửi 1 tệp',
    ]);
    fireEvent.click(within(row).getByRole('button', { name: 'Hoàn tất & Gửi 1 tệp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý hoàn tất' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('inst-1', 'complete', undefined, undefined, {}));
    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(onUploadFile).toHaveBeenCalledWith('inst-1', first);
  });

  it('pha khởi tạo (S) không có ô nội dung nào: cũng không có ô ý kiến (mọi quy trình); giao diện cũ vẫn có', () => {
    const plain = submitStep({ flow: { gateways: [], attributes: [{ code: 'so_tien', name: 'Số tiền', type: 'money' }] } });
    const { unmount } = render(<WorkspaceBoard {...baseProps} instances={[plain]} />);
    openCase();
    expect(within(panel()).queryByRole('textbox', { name: 'Ý kiến / ghi chú' })).toBeNull();
    expect(within(pinnedRow()).getByRole('button', { name: 'Đính kèm tệp' })).toBeTruthy();
    unmount();
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    render(<WorkspaceBoard {...baseProps} instances={[plain]} />);
    expect(screen.getAllByRole('textbox').some((box) => box.tagName === 'TEXTAREA')).toBe(true);
  });

  it('pha sau (A): ô ý kiến có, ý kiến và tệp đi cùng Phê duyệt như cũ', async () => {
    const onAction = jest.fn(async () => undefined);
    const onUploadFile = jest.fn(async () => undefined);
    render(
      <WorkspaceBoard {...baseProps} onAction={onAction} onUploadFile={onUploadFile} instances={[submitStep({ authorization: APPROVER })]} />,
    );
    openCase();
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Ý kiến / ghi chú' }), { target: { value: 'Đủ chứng từ' } });
    const file = new File(['a'], 'hoa-don.pdf', { type: 'application/pdf' });
    fireEvent.change(panel().querySelector('[data-comment-row] input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Phê duyệt & Gửi 1 tệp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý phê duyệt' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('inst-1', 'approve', 'Đủ chứng từ', undefined, {}));
    expect(onUploadFile).toHaveBeenCalledWith('inst-1', file);
  });

  it('bước duyệt (A): Trả lại / Từ chối / Phê duyệt ở hàng ghim đáy, đi qua hộp xác nhận như cũ', async () => {
    const onAction = jest.fn(async () => undefined);
    const approval = submitStep({
      authorization: {
        myRoles: ['A'],
        currentRoleStage: 'A',
        availableActions: ['comment', 'approve', 'return', 'reject'],
        isOverride: false,
        canManageSubtasks: false,
        editableAttributeKeys: [],
      },
    });
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[approval]} />);
    openCase();
    expect((panel().querySelector('[data-task-head]') as HTMLElement).textContent).toContain('Bạn · Phê duyệt');
    // Không có ô nhập thì không có Lưu nháp.
    expect(within(panel()).queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    const row = pinnedRow();
    expect(modal().contains(row)).toBe(true);
    expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['Trả lại', 'Từ chối', 'Phê duyệt']);

    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Ý kiến / ghi chú' }), { target: { value: 'Đồng ý' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Phê duyệt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý phê duyệt' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'approve', 'Đồng ý', undefined, {}));

    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Trả lại' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận trả lại' }));
    await waitFor(() => expect(onAction).toHaveBeenLastCalledWith('inst-1', 'return', undefined, undefined, undefined));
  });

  it('giao diện cũ giữ nguyên khung xử lý: "Vai của bạn", "Thông tin cần nhập", phạm vi "Thông tin chung"', () => {
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    render(<WorkspaceBoard {...baseProps} onSaveAttributes={jest.fn(async () => undefined)} instances={[submitStep()]} />);
    expect(screen.queryByRole('region', { name: 'Việc cần làm' })).toBeNull();
    expect(document.querySelector('[data-task-head]')).toBeNull();
    expect(screen.getByText(/Vai của bạn/)).toBeTruthy();
    expect(screen.getByText('Thông tin cần nhập')).toBeTruthy();
    expect(screen.getAllByText('Thông tin chung').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Đính kèm tài liệu/ })).toBeTruthy();
  });
});

describe('Cửa sổ hồ sơ - ô người nhận tiền', () => {
  /** Hồ sơ thanh toán: bước 2 lập phiếu chi; bước 1 (pha S) nhập số tiền, nội dung, người nhận, STK, ngân hàng. */
  const paymentCase = () =>
    submitStep({
      flow: {
        gateways: [],
        attributes: [
          { code: 'nguoi_nhan', name: 'Người nhận', type: 'text' },
          { code: 'so_tien', name: 'Số tiền', type: 'money' },
          { code: 'stk_nguoi_nhan', name: 'STK người nhận', type: 'text' },
          { code: 'noi_dung', name: 'Nội dung thanh toán', type: 'text' },
          { code: 'ngan_hang_nguoi_nhan', name: 'Ngân hàng người nhận', type: 'text' },
          { code: 'ngay_chi', name: 'Ngày chi', type: 'date' },
        ],
      },
      authorization: {
        ...submitStep().authorization,
        editableAttributeKeys: [
          'process:nguoi_nhan',
          'process:so_tien',
          'process:stk_nguoi_nhan',
          'process:noi_dung',
          'process:ngan_hang_nguoi_nhan',
          'process:ngay_chi',
        ],
      },
      steps: submitStep().steps.map((step) =>
        step.id === 'step-2' ? { ...step, integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' } } : step,
      ),
    });

  it('bước thanh toán: ô ngắn trước, nội dung trọn bề ngang, rồi khối người nhận; người nhận bên ngoài gõ tay được gửi kèm Hoàn tất', async () => {
    const onAction = jest.fn(async () => undefined);
    render(<WorkspaceBoard {...baseProps} onAction={onAction} instances={[paymentCase()]} />);
    openCase();
    const grid = panel().querySelector('[data-fields-grid]') as HTMLElement;
    const labels = [...grid.children].map((cell) => cell.querySelector('[class*="modalLabel"]')?.firstChild?.textContent);
    expect(labels).toEqual(['Số tiền', 'Ngày chi', 'Nội dung thanh toán', 'Người nhận', 'STK người nhận', 'Ngân hàng người nhận']);
    const nameCell = grid.children[3] as HTMLElement;
    expect(within(nameCell).getByRole('radio', { name: 'Nhân viên' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(within(nameCell).getByRole('radio', { name: 'Khách hàng / bên ngoài' }));
    fireEvent.change(within(panel()).getByLabelText('Người nhận'), { target: { value: 'Công ty Điện lực' } });
    fireEvent.change(within(panel()).getByLabelText('STK người nhận'), { target: { value: '0011223344' } });
    fireEvent.change(within(panel()).getByLabelText('Ngân hàng người nhận'), { target: { value: 'Agribank' } });
    fireEvent.change(within(panel()).getByLabelText('Nội dung thanh toán'), { target: { value: 'Tiền điện tháng 11' } });
    fireEvent.click(within(pinnedRow()).getByRole('button', { name: 'Hoàn tất' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đồng ý hoàn tất' }));
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith('inst-1', 'complete', undefined, undefined, {
        'process:nguoi_nhan': { type: 'text', value: 'Công ty Điện lực' },
        'process:stk_nguoi_nhan': { type: 'text', value: '0011223344' },
        'process:ngan_hang_nguoi_nhan': { type: 'text', value: 'Agribank' },
        'process:noi_dung': { type: 'text', value: 'Tiền điện tháng 11' },
      }),
    );
  });

  it('bước không phải thanh toán: ô chữ dài (mô tả) thành ô nhiều dòng trọn bề ngang, sau các ô ngắn', () => {
    const plain = submitStep({
      flow: {
        gateways: [],
        attributes: [
          { code: 'mo_ta', name: 'Mô tả yêu cầu', type: 'text' },
          { code: 'so_luong', name: 'Số lượng', type: 'number' },
          { code: 'ma_kho', name: 'Mã kho', type: 'text' },
        ],
      },
      authorization: { ...submitStep().authorization, editableAttributeKeys: ['process:mo_ta', 'process:so_luong', 'process:ma_kho'] },
    });
    render(<WorkspaceBoard {...baseProps} instances={[plain]} />);
    openCase();
    const grid = panel().querySelector('[data-fields-grid]') as HTMLElement;
    const cells = [...grid.children] as HTMLElement[];
    expect(cells.map((cell) => cell.querySelector('[class*="modalLabel"]')?.firstChild?.textContent)).toEqual([
      'Số lượng',
      'Mã kho',
      'Mô tả yêu cầu',
    ]);
    expect(cells[2]?.className).toContain('modalFieldFull');
    expect((within(panel()).getByLabelText('Mô tả yêu cầu') as HTMLElement).tagName).toBe('TEXTAREA');
    expect((within(panel()).getByLabelText('Mã kho') as HTMLElement).tagName).toBe('INPUT');
    expect(within(panel()).queryByRole('radiogroup', { name: 'Loại người nhận' })).toBeNull();
  });

  it('kiểu "modal": mọi ô chung MỘT lưới co giãn (ô ngắn, nội dung trọn bề ngang, rồi khối người nhận); kiểu mặc định giữ như cũ', () => {
    const payment = submitStep({
      flow: {
        gateways: [],
        attributes: [
          { code: 'so_tien', name: 'Số tiền', type: 'money' },
          { code: 'nguoi_nhan', name: 'Người nhận', type: 'text' },
          { code: 'stk', name: 'STK người nhận', type: 'text' },
          { code: 'ngan_hang', name: 'Ngân hàng người nhận', type: 'text' },
          { code: 'noi_dung', name: 'Nội dung thanh toán', type: 'text' },
        ],
      },
      authorization: {
        ...submitStep().authorization,
        editableAttributeKeys: ['process:so_tien', 'process:nguoi_nhan', 'process:stk', 'process:ngan_hang', 'process:noi_dung'],
      },
    });
    const picker: PayeePicker = {
      slots: { name: 'process:nguoi_nhan', accountNo: 'process:stk', bank: 'process:ngan_hang' },
      selectedUserId: null,
      missingBankInfo: false,
      choose: jest.fn(),
      mode: 'employee',
      modeChosen: false,
      setMode: jest.fn(),
    };
    const props = {
      instance: payment,
      draft: {},
      onChange: jest.fn(),
      onSaveDraft: jest.fn(),
      members: [{ userId: 'u-1', displayName: 'Hồ Thọ' }],
      attachments: [],
      payee: picker,
    };
    const { container, unmount } = render(<AttributeForm {...props} variant="modal" />);
    expect(screen.queryByRole('group', { name: 'Người nhận tiền' })).toBeNull();
    expect(screen.queryByText('Người nhận tiền')).toBeNull();
    const grid = container.querySelector('[data-fields-grid]') as HTMLElement;
    expect(grid.className).toContain('modalGrid');
    // Mỗi ô là con trực tiếp của lưới. Thứ tự: ô ngắn, ô nội dung (trọn bề ngang), rồi khối người nhận tiền.
    const cells = [...grid.children] as HTMLElement[];
    expect(cells.map((cell) => cell.tagName)).toEqual(['LABEL', 'LABEL', 'DIV', 'LABEL', 'LABEL']);
    expect(cells.map((cell) => cell.querySelector('[class*="modalLabel"]')?.firstChild?.textContent)).toEqual([
      'Số tiền',
      'Nội dung thanh toán',
      'Người nhận',
      'STK người nhận',
      'Ngân hàng người nhận',
    ]);
    expect(cells.map((cell) => cell.className.includes('modalFieldFull'))).toEqual([false, true, false, false, false]);
    expect(cells[2]?.className).toContain('payeeCell');
    // Nội dung là ô nhiều dòng (3 dòng), giá trị vẫn là chữ thường.
    const content = within(cells[1] as HTMLElement).getByRole('textbox') as HTMLTextAreaElement;
    expect(content.tagName).toBe('TEXTAREA');
    expect(content.rows).toBe(3);
    fireEvent.change(content, { target: { value: 'Thanh toán\ntiền điện' } });
    expect(props.onChange).toHaveBeenLastCalledWith({ 'process:noi_dung': { type: 'text', value: 'Thanh toán\ntiền điện' } });
    // Nút chọn loại người nhận nằm ngoài thẻ label: tên ô nhập vẫn chỉ là "Người nhận".
    const modeSwitch = within(cells[2] as HTMLElement).getByRole('radiogroup', { name: 'Loại người nhận' });
    expect(modeSwitch.closest('label')).toBeNull();
    expect(within(modeSwitch).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Nhân viên', 'Khách hàng / bên ngoài']);
    // Không có Lưu nháp trong cửa sổ hồ sơ.
    expect(screen.queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    unmount();

    render(<AttributeForm {...props} />);
    expect(screen.queryByRole('group', { name: 'Người nhận tiền' })).toBeNull();
    expect(screen.getByText('Thông tin cần nhập')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeTruthy();
  });

  it('kiểu "modal": lưới ô nhập co giãn theo bề rộng (minmax 220px), ô chữ dài trọn bề ngang; ô chọn rộng đúng ô lưới', () => {
    const source = readFileSync(join(__dirname, '../attribute-form.module.scss'), 'utf8');
    const rule = (selector: string) => {
      const start = source.indexOf(`${selector} {`);
      if (start < 0) throw new Error(`Không thấy ${selector}`);
      return source.slice(start, source.indexOf('}', start));
    };
    expect(rule('.modalGrid')).toContain('grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr))');
    expect(rule('.modalField > div:not(.toggle):not(.payeeMode)')).toContain('width: 100%');
    expect(rule('.modalFieldFull')).toContain('grid-column: 1 / -1');
    expect(rule('.textarea')).toContain('max-height: 176px');
    // Khối người nhận bắt đầu hàng mới; nút chọn loại cao 28px.
    expect(rule('.payeeCell')).toContain('grid-column-start: 1');
    expect(rule('.payeeMode')).toContain('height: 28px');
    expect(rule('.modalForm .input')).toContain('height: 36px');
    // Gợi ý thiếu STK luôn giữ chỗ (ẩn bằng visibility), không chèn / bỏ phần tử.
    expect(rule('.hintIconOff')).toContain('visibility: hidden');
  });
});
