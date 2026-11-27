/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProcedureInstance } from '@enterprise-platform/contracts-procedure-engine';
import { StrictMode, useState } from 'react';
import { resetMyPayeeProfileCache } from '../payee-prefill';
import { AttributeForm, type AttributeDraft } from './attribute-form';
import { usePayeePicker } from './use-payee-picker';

jest.mock('@enterprise-platform/shared-ui/date-picker', () => ({ DatePickerInput: () => null }));

const mockAuthFetch = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({
  ...jest.requireActual('@enterprise-platform/shared-ui'),
  authFetch: (url: string) => mockAuthFetch(url),
}));

const members = [
  { userId: 'u-1', displayName: 'Hà Nguyên Hoàng' },
  { userId: 'u-2', displayName: 'Trần Thị Bình' },
  { userId: 'u-3', displayName: 'Lê Văn Cường' },
];

const profiles: Record<string, unknown> = {
  '/api/hrm/v1/my-profile': { fullName: 'Hà Nguyên Hoàng', bankAccountNumber: '0123456789', bankName: 'Vietcombank' },
  '/api/hrm/v1/employees/by-user/u-1/payee': { fullName: 'Hà Nguyên Hoàng', bankAccountNumber: null, bankName: null },
  '/api/hrm/v1/employees/by-user/u-2/payee': { fullName: 'Trần Thị Bình', bankAccountNumber: '999888', bankName: 'BIDV' },
  // Người đang xem không phải chính chủ, không có quyền xem dữ liệu nhạy cảm: HRM trả null.
  '/api/hrm/v1/employees/by-user/u-3/payee': { fullName: 'Lê Văn Cường', bankAccountNumber: null, bankName: null },
};

function instance({
  payment = true,
  values = {},
}: { payment?: boolean; values?: Record<string, { value: { type: 'text'; value: string } }> } = {}) {
  return {
    id: 'i-1',
    initiatedBy: 'u-1',
    currentStepId: 's-1',
    flow: {
      attributes: [
        { code: 'nguoi_nhan', name: 'Người nhận', type: 'text' },
        { code: 'stk_nguoi_nhan', name: 'STK người nhận', type: 'text' },
        { code: 'ngan_hang_nguoi_nhan', name: 'Ngân hàng người nhận', type: 'text' },
      ],
    },
    steps: [
      { id: 's-1', definitionStepId: 'd-1', order: 1, name: 'Chuẩn bị hồ sơ', attributes: [] },
      {
        id: 's-4',
        definitionStepId: 'd-4',
        order: 4,
        name: 'Lập phiếu chi',
        ...(payment ? { integration: { module: 'finance', action: 'voucher', voucherKind: 'PAYMENT' } } : {}),
      },
    ],
    attributeValues: values,
    authorization: {
      editableAttributeKeys: ['process:nguoi_nhan', 'process:stk_nguoi_nhan', 'process:ngan_hang_nguoi_nhan'],
    },
  } as unknown as ProcedureInstance;
}

/** Như khung xử lý: nháp giữ ở cha, ô chọn người nhận do `usePayeePicker` điều khiển. */
function Harness({ item, actorId }: { item: ProcedureInstance; actorId: string }) {
  const [draft, setDraft] = useState<AttributeDraft>({});
  const payee = usePayeePicker({ instance: item, draft, setDraft, members, actorId });
  return (
    <AttributeForm instance={item} draft={draft} onChange={setDraft} members={members} attachments={[]} payee={payee} />
  );
}

const field = (name: string) => screen.getByText(name).closest('label') as HTMLElement;
const input = (name: string) => within(field(name)).getByRole('textbox') as HTMLInputElement;

function pick(name: string) {
  fireEvent.click(input('Người nhận'));
  fireEvent.click(screen.getByRole('option', { name }));
}

beforeEach(() => {
  resetMyPayeeProfileCache();
  mockAuthFetch.mockReset();
  mockAuthFetch.mockImplementation(async (url: string) =>
    url in profiles ? { ok: true, json: async () => ({ data: profiles[url] }) } : { ok: false, json: async () => ({}) },
  );
});

describe('ô người nhận ở hồ sơ thanh toán', () => {
  it('là ô chọn thành viên, mặc định người tạo hồ sơ; người tạo đang nhập thì điền STK, ngân hàng của mình', async () => {
    render(<Harness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));
    expect(input('Người nhận').value).toBe('Hà Nguyên Hoàng');
    expect(input('Ngân hàng người nhận').value).toBe('Vietcombank');
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/hrm/v1/my-profile');

    fireEvent.click(input('Người nhận'));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      members.map((member) => member.displayName),
    );
    expect(screen.getByRole('option', { name: 'Hà Nguyên Hoàng' }).getAttribute('aria-selected')).toBe('true');
  });

  it('chạy hai lần effect (StrictMode) vẫn điền đủ, không bỏ mất kết quả tra', async () => {
    render(
      <StrictMode>
        <Harness item={instance()} actorId="u-1" />
      </StrictMode>,
    );
    await waitFor(() => expect(input('Ngân hàng người nhận').value).toBe('Vietcombank'));
    expect(input('Người nhận').value).toBe('Hà Nguyên Hoàng');
  });

  it('bỏ chọn thì xoá tên và STK, ngân hàng tự điền; ô người dùng tự gõ thì giữ', async () => {
    render(<Harness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));
    fireEvent.change(input('Ngân hàng người nhận'), { target: { value: 'ACB chi nhánh 1' } });

    fireEvent.click(within(field('Người nhận')).getByRole('button', { name: 'Xoá tìm kiếm' }));
    expect(input('Người nhận').value).toBe('');
    expect(input('STK người nhận').value).toBe('');
    expect(input('Ngân hàng người nhận').value).toBe('ACB chi nhánh 1');
  });

  it('chọn người khác thì lấy STK, ngân hàng theo hồ sơ nhân sự của người đó', async () => {
    render(<Harness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));

    pick('Trần Thị Bình');
    await waitFor(() => expect(input('STK người nhận').value).toBe('999888'));
    expect(input('Người nhận').value).toBe('Trần Thị Bình');
    expect(input('Ngân hàng người nhận').value).toBe('BIDV');
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/hrm/v1/employees/by-user/u-2/payee');
    expect(screen.queryByText(/Chưa có STK trong hồ sơ nhân sự/)).toBeNull();
  });

  it('HRM trả STK null (không có, hay không được xem) thì để trống ô ngân hàng và hiện gợi ý', async () => {
    render(<Harness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));

    pick('Lê Văn Cường');
    await waitFor(() => expect(screen.getByText(/Chưa có STK trong hồ sơ nhân sự/)).toBeTruthy());
    expect(input('Người nhận').value).toBe('Lê Văn Cường');
    expect(input('STK người nhận').value).toBe('');
    expect(input('Ngân hàng người nhận').value).toBe('');
  });

  it('người xem không phải người tạo: vẫn chọn sẵn người tạo, tra HRM theo tài khoản người tạo', async () => {
    render(<Harness item={instance()} actorId="u-9" />);
    await waitFor(() => expect(screen.getByText(/Chưa có STK trong hồ sơ nhân sự/)).toBeTruthy());
    expect(input('Người nhận').value).toBe('Hà Nguyên Hoàng');
    expect(input('STK người nhận').value).toBe('');
    expect(mockAuthFetch).toHaveBeenCalledWith('/api/hrm/v1/employees/by-user/u-1/payee');
    expect(mockAuthFetch).not.toHaveBeenCalledWith('/api/hrm/v1/my-profile');
  });

  it('tên đã lưu không khớp thành viên nào vẫn hiện là lựa chọn, không tự điền đè', async () => {
    const saved = { 'process:nguoi_nhan': { value: { type: 'text' as const, value: 'Công ty TNHH ABC' } } };
    render(<Harness item={instance({ values: saved })} actorId="u-1" />);
    expect(input('Người nhận').value).toBe('Công ty TNHH ABC');
    fireEvent.click(input('Người nhận'));
    expect(screen.getAllByRole('option')).toHaveLength(members.length + 1);
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it('hồ sơ không phải thanh toán: ô người nhận vẫn là ô chữ thường', () => {
    render(<Harness item={instance({ payment: false })} actorId="u-1" />);
    const name = input('Người nhận');
    fireEvent.click(name);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(name.value).toBe('');
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});

/** Như `Harness` nhưng kiểu trình bày của cửa sổ hồ sơ (giao diện mới). */
function ModalHarness({ item, actorId }: { item: ProcedureInstance; actorId: string }) {
  const [draft, setDraft] = useState<AttributeDraft>({});
  const payee = usePayeePicker({ instance: item, draft, setDraft, members, actorId });
  return (
    <AttributeForm
      instance={item}
      draft={draft}
      onChange={setDraft}
      members={members}
      attachments={[]}
      payee={payee}
      variant="modal"
    />
  );
}

describe('ô người nhận ở cửa sổ hồ sơ (giao diện mới): đổi người nhận không làm xô lệch ô', () => {
  /** Khung cây phần tử của lưới ô nhập (thẻ + số con), không tính class / thuộc tính. */
  const shape = (root: Element): string[] =>
    [...root.querySelectorAll('*')].map((node) => `${node.tagName}:${node.childElementCount}`);
  const hintIcon = () => document.querySelector('[data-payee-hint]') as HTMLElement;

  it('gợi ý thiếu STK là biểu tượng có chú thích cạnh nhãn STK; chọn người khác không thêm / bớt phần tử nào', async () => {
    const { container } = render(<ModalHarness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));
    const grid = container.querySelector('[data-fields-grid]') as HTMLElement;
    const before = shape(grid);
    const selectBox = input('Người nhận').closest('label')?.querySelector(':scope > div') as HTMLElement;

    // Biểu tượng nằm trong nhãn ô STK, đang ẩn (giữ chỗ), không có chữ gợi ý chèn dưới ô.
    expect(field('STK người nhận').contains(hintIcon())).toBe(true);
    expect(hintIcon().closest('span[class*="modalLabel"]')).toBeTruthy();
    expect(hintIcon().getAttribute('data-payee-hint')).toBe('off');
    expect(hintIcon().getAttribute('title')).toBeNull();
    expect(hintIcon().getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText(/Chưa có STK trong hồ sơ nhân sự/)).toBeNull();

    // Người không có STK: biểu tượng hiện, chú thích đủ câu; cây phần tử y như trước.
    pick('Lê Văn Cường');
    await waitFor(() => expect(hintIcon().getAttribute('data-payee-hint')).toBe('on'));
    expect(hintIcon().getAttribute('title')).toBe(
      'Chưa có STK trong hồ sơ nhân sự hoặc bạn không có quyền xem; nhập tay nếu cần.',
    );
    expect(screen.getByRole('img', { name: /Chưa có STK trong hồ sơ nhân sự/ })).toBe(hintIcon());
    expect(screen.queryByText(/Chưa có STK trong hồ sơ nhân sự/)).toBeNull();
    expect(shape(grid)).toEqual(before);
    // Ô chọn người nhận vẫn là đúng phần tử cũ (không dựng lại), không thêm phần tử quanh ô.
    expect(input('Người nhận').closest('label')?.querySelector(':scope > div')).toBe(selectBox);

    // Đổi sang người có STK: biểu tượng ẩn lại, cây phần tử vẫn như cũ.
    pick('Trần Thị Bình');
    await waitFor(() => expect(input('STK người nhận').value).toBe('999888'));
    expect(hintIcon().getAttribute('data-payee-hint')).toBe('off');
    expect(hintIcon().getAttribute('title')).toBeNull();
    expect(shape(grid)).toEqual(before);
  });
});

describe('loại người nhận "Nhân viên | Khách hàng / bên ngoài" (cửa sổ hồ sơ)', () => {
  const radio = (name: string) => screen.getByRole('radio', { name });
  const saved = (value: string) => ({ 'process:nguoi_nhan': { value: { type: 'text' as const, value } } });
  /** Khung cây phần tử ngoài ô nhập tên người nhận (ô này đổi giữa ô chọn và ô chữ). */
  const outsideShape = (root: Element): string[] =>
    [...root.querySelectorAll('*')]
      .filter((node) => node.matches('[data-payee-control]') || !node.closest('[data-payee-control]'))
      .map((node) => `${node.tagName}:${node.matches('[data-payee-control]') ? '' : node.childElementCount}`);

  it('suy ra từ tên đã lưu: trùng thành viên là Nhân viên (ô chọn), tên ngoài là bên ngoài (ô chữ, không tra HRM)', async () => {
    const { unmount } = render(<ModalHarness item={instance({ values: saved('Trần Thị Bình') })} actorId="u-1" />);
    expect(radio('Nhân viên').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(input('Người nhận'));
    expect(screen.getByRole('option', { name: 'Trần Thị Bình' }).getAttribute('aria-selected')).toBe('true');
    unmount();

    render(<ModalHarness item={instance({ values: saved('Công ty TNHH ABC') })} actorId="u-1" />);
    expect(radio('Khách hàng / bên ngoài').getAttribute('aria-checked')).toBe('true');
    const name = input('Người nhận');
    expect(name.value).toBe('Công ty TNHH ABC');
    fireEvent.click(name);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    // Gõ tay tên, STK, ngân hàng: không tra hồ sơ nhân sự, không tự điền.
    fireEvent.change(name, { target: { value: 'Công ty TNHH XYZ' } });
    fireEvent.change(input('STK người nhận'), { target: { value: '111222' } });
    expect(input('Người nhận').value).toBe('Công ty TNHH XYZ');
    expect(input('STK người nhận').value).toBe('111222');
    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect((document.querySelector('[data-payee-hint]') as HTMLElement).getAttribute('data-payee-hint')).toBe('off');
  });

  it('Nhân viên -> bên ngoài: xoá tên và STK tự điền, giữ ngân hàng gõ tay, con trỏ vào ô tên; bên ngoài -> Nhân viên: về người tạo hồ sơ và tự điền lại', async () => {
    const { container } = render(<ModalHarness item={instance()} actorId="u-1" />);
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));
    fireEvent.change(input('Ngân hàng người nhận'), { target: { value: 'ACB chi nhánh 1' } });
    const grid = container.querySelector('[data-fields-grid]') as HTMLElement;
    const before = outsideShape(grid);
    const control = grid.querySelector('[data-payee-control]');
    const calls = mockAuthFetch.mock.calls.length;

    fireEvent.click(radio('Khách hàng / bên ngoài'));
    expect(radio('Khách hàng / bên ngoài').getAttribute('aria-checked')).toBe('true');
    expect(input('Người nhận').value).toBe('');
    expect(document.activeElement).toBe(input('Người nhận'));
    expect(input('STK người nhận').value).toBe('');
    expect(input('Ngân hàng người nhận').value).toBe('ACB chi nhánh 1');
    // Chỉ ô nhập tên đổi (ô chọn -> ô chữ), mọi phần tử khác giữ nguyên; khung ô tên vẫn là phần tử cũ.
    expect(outsideShape(grid)).toEqual(before);
    expect(grid.querySelector('[data-payee-control]')).toBe(control);
    fireEvent.change(input('Người nhận'), { target: { value: 'Công ty ABC' } });
    expect(mockAuthFetch.mock.calls.length).toBe(calls);

    fireEvent.click(radio('Nhân viên'));
    await waitFor(() => expect(input('STK người nhận').value).toBe('0123456789'));
    expect(input('Người nhận').value).toBe('Hà Nguyên Hoàng');
    expect(input('Ngân hàng người nhận').value).toBe('ACB chi nhánh 1');
    expect(outsideShape(grid)).toEqual(before);
  });

  it('bên ngoài -> Nhân viên: STK gõ tay ngay sau khi đổi không bị kết quả tra về muộn ghi đè', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockAuthFetch.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({ data: profiles[url] }) });
        }),
    );
    render(<ModalHarness item={instance({ values: saved('Công ty TNHH ABC') })} actorId="u-1" />);
    expect(mockAuthFetch).not.toHaveBeenCalled();
    fireEvent.click(radio('Nhân viên'));
    expect(input('Người nhận').value).toBe('Hà Nguyên Hoàng');
    fireEvent.change(input('STK người nhận'), { target: { value: '777' } });
    release(undefined);
    await waitFor(() => expect(input('Ngân hàng người nhận').value).toBe('Vietcombank'));
    expect(input('STK người nhận').value).toBe('777');
  });
});
