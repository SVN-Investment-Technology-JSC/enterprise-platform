/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ProcedureAttachment, ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { AttributeValues, attributeValueItems } from './attribute-form';
import { CASE_LAYOUT_STORAGE_KEY } from './case-layout-a/case-layout';
import { WorkspaceBoard } from './workspace-board';

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
  window.localStorage.clear();
  window.location.hash = '';
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const STARTED = '2026-11-20T01:00:00.000Z';
const APPROVED = '2026-11-20T03:00:00.000Z';
const CONTENT = 'Thanh toán tiền điện tháng 11/2026\nCông trình: Trạm trộn Nguyên Anh\nTheo hoá đơn số 0001234';
const REFERENCE = 'Tham chiếu hợp đồng khung số HĐ-2026/NA-0099 giữa hai bên, phụ lục 03 ký ngày 15/10/2026';
const COMMENT =
  'Đồng ý chi theo đề nghị.\nĐề nghị kế toán đối chiếu lại hoá đơn đỏ trước khi ghi sổ, nếu lệch số tiền thì trả lại bước 1 để bổ sung chứng từ.';

const text = (value: string) => ({ value: { type: 'text', value }, enteredBy: 'u-1', enteredAt: STARTED });

/** Hồ sơ thanh toán: bước 1 (đã duyệt, kèm ý kiến dài) nhập mọi ô; bước 2 đang chờ người duyệt (vai A), không có ô mở. */
function paymentCase(overrides: Record<string, unknown> = {}): ProcedureInstance {
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
    startedAt: STARTED,
    currentStepId: 'step-2',
    activity: [
      { id: 'a-1', action: 'start', actorId: 'u-1', actorName: 'Hồ Thọ', summary: 'Mở hồ sơ', createdAt: STARTED },
      {
        id: 'a-2',
        action: 'approve',
        actorId: 'u-2',
        actorName: 'Nguyễn Văn A',
        summary: 'Đã duyệt',
        comment: COMMENT,
        stepInstanceId: 'step-1',
        createdAt: APPROVED,
      },
    ],
    flow: {
      gateways: [],
      attributes: [
        { code: 'nguoi_nhan', name: 'Người nhận', type: 'text' },
        { code: 'so_tien', name: 'Số tiền', type: 'money' },
        { code: 'noi_dung', name: 'Nội dung', type: 'text' },
        { code: 'stk_nguoi_nhan', name: 'STK người nhận', type: 'text' },
        { code: 'ngay_chi', name: 'Ngày chi', type: 'date' },
        { code: 'ma_tham_chieu', name: 'Mã tham chiếu', type: 'text' },
        { code: 'da_kiem_tra', name: 'Đã kiểm tra', type: 'boolean' },
        { code: 'ngan_hang_nguoi_nhan', name: 'Ngân hàng người nhận', type: 'text' },
        { code: 'nguoi_phu_trach', name: 'Người phụ trách', type: 'user' },
        { code: 'ghi_chu', name: 'Ghi chú', type: 'text' },
        { code: 'chung_tu', name: 'Chứng từ', type: 'file' },
      ],
    },
    attributeValues: {
      'process:nguoi_nhan': text('Công ty Điện lực'),
      'process:so_tien': { value: { type: 'money', value: 3000000 }, enteredBy: 'u-1', enteredAt: STARTED },
      'process:noi_dung': text(CONTENT),
      'process:stk_nguoi_nhan': text('0011223344'),
      'process:ngay_chi': { value: { type: 'date', value: '2026-11-20' }, enteredBy: 'u-1', enteredAt: STARTED },
      'process:ma_tham_chieu': text(REFERENCE),
      'process:da_kiem_tra': { value: { type: 'boolean', value: true }, enteredBy: 'u-1', enteredAt: STARTED },
      'process:ngan_hang_nguoi_nhan': text('Agribank'),
      'process:nguoi_phu_trach': { value: { type: 'user', value: 'u-5' }, enteredBy: 'u-1', enteredAt: STARTED },
      'process:ghi_chu': text('   '),
      'process:chung_tu': { value: { type: 'file', value: ['f-1'] }, enteredBy: 'u-1', enteredAt: STARTED },
      'step:def-1:so_hoa_don': text('HD-0001234'),
    },
    authorization: {
      myRoles: ['A'],
      currentRoleStage: 'A',
      availableActions: ['comment', 'approve'],
      isOverride: false,
      canManageSubtasks: false,
      editableAttributeKeys: [],
    },
    steps: [
      {
        id: 'step-1',
        definitionStepId: 'def-1',
        key: 's1',
        order: 1,
        name: 'Chuẩn bị hồ sơ thanh toán',
        status: 'completed',
        currentRoleStage: 'A',
        startedAt: STARTED,
        completedAt: APPROVED,
        attributes: [{ code: 'so_hoa_don', name: 'Số hoá đơn', type: 'text' }],
        assignments: [{ id: 'as-1', role: 'A', subjectId: 'u-2', subjectType: 'user', subjectLabel: 'Nguyễn Văn A' }],
      },
      {
        id: 'step-2',
        definitionStepId: 'def-2',
        key: 's2',
        order: 2,
        name: 'Kế toán duyệt chi',
        status: 'active',
        currentRoleStage: 'A',
        startedAt: APPROVED,
        attributes: [],
        assignments: [{ id: 'as-2', role: 'A', subjectId: 'pos-kt', subjectType: 'position', subjectLabel: 'Kế toán' }],
      },
      {
        id: 'step-3',
        definitionStepId: 'def-3',
        key: 's3',
        order: 3,
        name: 'Lập phiếu chi',
        status: 'pending',
        currentRoleStage: 'R',
        attributes: [],
        integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' },
        assignments: [],
      },
    ],
    ...overrides,
  } as unknown as ProcedureInstance;
}

const BASE = {
  definitions: [],
  canCreateInstances: false,
  onAction: jest.fn(async () => undefined),
  onOpenDefinitions: jest.fn(),
  onStart: jest.fn(async () => undefined),
};

const FILES = [
  { id: 'f-1', instanceId: 'inst-1', stepInstanceId: 'step-1', fileName: 'hoa-don-dien.pdf', downloadUrl: '/files/f-1' },
] as unknown as ProcedureAttachment[];
const MEMBERS = [{ userId: 'u-5', displayName: 'Lê Văn Bình' }];

const labelOf = (item: Element) => item.querySelector('dt')?.firstChild?.textContent;
const valueOf = (root: HTMLElement, label: string) => {
  const item = [...root.querySelectorAll('[data-value-key]')].find((cell) => labelOf(cell) === label);
  return item as HTMLElement | undefined;
};

describe('Khối "Thông tin đã nhập" dùng chung', () => {
  const renderValues = (contextStepId?: string) =>
    render(
      <AttributeValues
        instance={paymentCase()}
        items={attributeValueItems(paymentCase())}
        contextStepId={contextStepId}
        members={MEMBERS}
        attachments={FILES}
        heading="Thông tin đã nhập"
      />,
    );

  it('không ghi "Thông tin chung"; ô thuộc bước khác ghi "bước N", ô của chính bước thì không', () => {
    const { container, unmount } = renderValues('def-2');
    const root = container.querySelector('[data-attribute-values]') as HTMLElement;
    expect(within(root).getByRole('heading', { name: 'Thông tin đã nhập' })).toBeTruthy();
    expect(root.textContent).not.toContain('Thông tin chung');
    // Ô của bước 1 hiện ở thẻ bước 2: có "bước 1", chữ nhỏ.
    const invoice = valueOf(root, 'Số hoá đơn') as HTMLElement;
    expect(invoice.querySelector('dt small')?.textContent).toBe('bước 1');
    expect(invoice.querySelector('dt small')?.className).toContain('valueScope');
    // Thông tin chung không bao giờ có ghi chú phạm vi.
    expect(valueOf(root, 'Số tiền')?.querySelector('dt small')).toBeNull();
    unmount();

    const same = renderValues('def-1').container.querySelector('[data-attribute-values]') as HTMLElement;
    expect(valueOf(same, 'Số hoá đơn')?.querySelector('dt small')).toBeNull();
    expect(same.querySelectorAll('dt small')).toHaveLength(0);
  });

  it('chữ dài (ô nội dung, chữ > 60 ký tự, có xuống dòng) trọn bề ngang, giữ xuống dòng, đủ chữ; ô ngắn thì không', () => {
    const root = renderValues('def-2').container.querySelector('[data-attribute-values]') as HTMLElement;
    const content = valueOf(root, 'Nội dung') as HTMLElement;
    expect(content.hasAttribute('data-long')).toBe(true);
    expect(content.className).toContain('valueItemLong');
    const contentValue = content.querySelector('dd') as HTMLElement;
    expect(contentValue.className).toContain('valueText');
    expect(contentValue.textContent).toBe(CONTENT);
    expect(contentValue.getAttribute('title')).toBeNull();
    // Mã không thuộc bộ chữ dài, nhưng chữ dài hơn 60 ký tự.
    const reference = valueOf(root, 'Mã tham chiếu') as HTMLElement;
    expect(reference.className).toContain('valueItemLong');
    expect(reference.querySelector('dd')?.textContent).toBe(REFERENCE);
    expect(valueOf(root, 'Số tiền')?.className).not.toContain('valueItemLong');
    expect(valueOf(root, 'Số hoá đơn')?.hasAttribute('data-long')).toBe(false);
  });

  it('định dạng giá trị: tiền "3.000.000 đ", ngày dd/mm/yyyy, Có / Không, tên người, tệp là đường dẫn', () => {
    const root = renderValues('def-2').container.querySelector('[data-attribute-values]') as HTMLElement;
    const shown = (label: string) => valueOf(root, label)?.querySelector('dd')?.textContent?.replace(/\u00a0/g, ' ');
    expect(shown('Số tiền')).toBe('3.000.000 đ');
    expect(shown('Ngày chi')).toBe('20/11/2026');
    expect(shown('Đã kiểm tra')).toBe('Có');
    expect(shown('Người phụ trách')).toBe('Lê Văn Bình');
    const file = within(valueOf(root, 'Chứng từ') as HTMLElement).getByRole('link', { name: 'hoa-don-dien.pdf' });
    expect(file.getAttribute('href')).toBe('/files/f-1');
  });

  it('ô trống không hiện nhãn; không còn ô nào thì không vẽ khối', () => {
    const root = renderValues('def-2').container.querySelector('[data-attribute-values]') as HTMLElement;
    expect(valueOf(root, 'Ghi chú')).toBeUndefined();
    expect(root.textContent).not.toContain('Ghi chú');
    expect(root.textContent).not.toContain('(trống)');
    const blank = paymentCase({ attributeValues: { 'process:ghi_chu': text('') } });
    const { container } = render(<AttributeValues instance={blank} items={attributeValueItems(blank)} heading="Thông tin đã nhập" />);
    expect(container.querySelector('[data-attribute-values]')).toBeNull();
  });

  it('thứ tự: ô ngắn, chữ dài, rồi khối người nhận (Người nhận, STK, Ngân hàng) liền nhau ở hàng mới', () => {
    const root = renderValues('def-2').container.querySelector('[data-attribute-values]') as HTMLElement;
    const items = [...root.querySelectorAll('[data-value-key]')];
    expect(items.map(labelOf)).toEqual([
      'Số tiền',
      'Ngày chi',
      'Đã kiểm tra',
      'Người phụ trách',
      'Chứng từ',
      'Số hoá đơn',
      'Nội dung',
      'Mã tham chiếu',
      'Người nhận',
      'STK người nhận',
      'Ngân hàng người nhận',
    ]);
    const payee = items.filter((item) => item.hasAttribute('data-payee'));
    expect(payee.map(labelOf)).toEqual(['Người nhận', 'STK người nhận', 'Ngân hàng người nhận']);
    expect(payee[0]?.className).toContain('valueItemPayeeStart');
    expect(payee.slice(1).some((item) => item.className.includes('valueItemPayeeStart'))).toBe(false);
  });

  it('CSS: lưới co giãn minmax(200px), chữ dài trọn bề ngang; giữ xuống dòng, không cắt chữ, không "…"', () => {
    const source = readFileSync(join(__dirname, 'attribute-form.module.scss'), 'utf8');
    const rule = (selector: string) => {
      const start = source.indexOf(`\n${selector} {`);
      if (start < 0) throw new Error(`Không thấy ${selector}`);
      return source.slice(start, source.indexOf('}', start));
    };
    expect(rule('.valuesGrid')).toContain('grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr))');
    expect(rule('.valueItemLong')).toContain('grid-column: 1 / -1');
    expect(rule('.valueItemPayeeStart')).toContain('grid-column-start: 1');
    expect(rule('.valueText')).toContain('white-space: pre-wrap');
    expect(rule('.valueText')).toContain('overflow-wrap: anywhere');
    expect(rule('.valueText')).toContain('font-size: ui.$fs-body');
    expect(rule('.valueLabel')).toContain('font-size: ui.$fs-small');
    const block = source.slice(source.indexOf('\n.values {'));
    expect(block).not.toMatch(/text-overflow|line-clamp|nowrap; overflow: hidden/);
  });
});

const openCase = () => fireEvent.click(screen.getByRole('link', { name: 'Quy trình: Thanh toán tiền điện tháng 11' }));
const modal = () => screen.getByRole('dialog', { name: 'Thanh toán tiền điện tháng 11' });

describe('Mọi chỗ hiện giá trị đã nhập dùng cùng một khối', () => {
  it('cửa sổ hồ sơ: khung "Việc cần làm" và thẻ bước đã qua (khi mở) dùng khối chung, không có "Thông tin chung"', () => {
    render(<WorkspaceBoard {...BASE} attachments={FILES} instances={[paymentCase()]} />);
    openCase();
    const task = within(modal()).getByRole('region', { name: 'Việc cần làm' });
    const current = task.querySelector('[data-attribute-values]') as HTMLElement;
    expect(current).toBeTruthy();
    expect(current.textContent).not.toContain('Thông tin chung');
    expect(valueOf(current, 'Số hoá đơn')?.querySelector('dt small')?.textContent).toBe('bước 1');
    expect(valueOf(current, 'Nội dung')?.querySelector('dd')?.textContent).toBe(CONTENT);

    // Bước 1 đã qua: dòng gọn không có khối giá trị; mở thẻ thì có, ô của chính bước không ghi phạm vi.
    const flow = within(modal()).getByRole('list', { name: 'Tiến trình các bước' });
    const first = flow.querySelector('[data-step-id="step-1"]') as HTMLElement;
    expect(first.querySelector('[data-attribute-values]')).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: /Bước 1 · Chuẩn bị hồ sơ thanh toán/ }));
    const card = (flow.querySelector('[data-step-id="step-1"]') as HTMLElement).querySelector('[data-attribute-values]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(valueOf(card, 'Số hoá đơn')?.querySelector('dt small')).toBeNull();
    expect(valueOf(card, 'Nội dung')?.className).toContain('valueItemLong');
    expect(card.textContent).not.toContain('Thông tin chung');
  });

  it('giao diện cũ và khung nhúng: khung xử lý và thẻ bước đã qua dùng cùng khối chung', () => {
    window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, 'legacy');
    const { unmount } = render(<WorkspaceBoard {...BASE} attachments={FILES} instances={[paymentCase()]} />);
    const blocks = [...document.querySelectorAll<HTMLElement>('[data-attribute-values]')];
    // Một khối trong thẻ bước 1 (đã qua), một khối trong khung xử lý bước 2.
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.textContent).not.toContain('Thông tin chung');
      expect(valueOf(block, 'Nội dung')?.querySelector('dd')?.textContent).toBe(CONTENT);
    }
    unmount();

    render(<WorkspaceBoard {...BASE} embedded initialInstanceId="inst-1" attachments={FILES} instances={[paymentCase()]} />);
    expect(document.querySelectorAll('[data-attribute-values]').length).toBeGreaterThanOrEqual(2);
  });

  it('hồ sơ đã hoàn thành: thẻ bước đã qua vẫn hiện đủ giá trị đã nhập', () => {
    const done = paymentCase({
      status: 'completed',
      currentStepId: undefined,
      authorization: { myRoles: [], availableActions: [], isOverride: false, canManageSubtasks: false, editableAttributeKeys: [] },
    });
    render(<WorkspaceBoard {...BASE} embedded initialInstanceId="inst-1" instances={[done]} />);
    const block = document.querySelector('[data-attribute-values]') as HTMLElement;
    expect(block).toBeTruthy();
    expect(valueOf(block, 'Số tiền')?.querySelector('dd')?.textContent?.replace(/\u00a0/g, ' ')).toBe('3.000.000 đ');
  });
});

describe('Ý kiến ở dòng bước đã qua', () => {
  it('dòng gọn: ý kiến tối đa 2 dòng (đủ chữ ở gợi ý); mở thẻ: ý kiến hiện đủ, giữ xuống dòng', () => {
    render(<WorkspaceBoard {...BASE} instances={[paymentCase()]} />);
    openCase();
    const flow = within(modal()).getByRole('list', { name: 'Tiến trình các bước' });
    const first = () => flow.querySelector('[data-step-id="step-1"]') as HTMLElement;
    const note = first().querySelector('[data-clamp="2"]') as HTMLElement;
    expect(note.className).toContain('flowNote');
    expect(note.getAttribute('title')).toBe(COMMENT);
    expect(first().querySelector('[data-decision-note]')).toBeNull();

    fireEvent.click(within(first()).getByRole('button', { name: /Bước 1 · Chuẩn bị hồ sơ thanh toán/ }));
    const full = first().querySelector('[data-decision-note]') as HTMLElement;
    expect(full.textContent).toContain('Nguyễn Văn A');
    const textBox = full.querySelector('p') as HTMLElement;
    expect(textBox.className).toContain('flowNoteFullText');
    expect(textBox.textContent).toBe(COMMENT);
    expect(textBox.hasAttribute('data-clamp')).toBe(false);

    const source = readFileSync(join(__dirname, 'case-layout-a/case-layout-a.module.scss'), 'utf8');
    const block = (selector: string) => {
      const start = source.indexOf(`\n${selector} {`);
      if (start < 0) throw new Error(`Không thấy ${selector}`);
      return source.slice(start, source.indexOf('}', start));
    };
    expect(block('.flowNote,\n.flowVoucher')).toContain('-webkit-line-clamp: 2');
    expect(block('.flowNoteFullText')).toContain('white-space: pre-wrap');
    expect(block('.stageNoteFull')).toContain('white-space: pre-wrap');
  });
});
