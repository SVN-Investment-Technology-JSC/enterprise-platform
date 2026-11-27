import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RelatedObjectCreateForm } from '@enterprise-platform/contracts-workspace';
import { toast } from '@enterprise-platform/shared-ui';
import {
  createRelatedObjectRecord,
  getRelatedObjectCreateForm,
  getRelatedObjectCreatePreview,
  searchRelatedObjects,
} from '../workspace-api';
import { RelatedObjectCreateDialog } from './related-object-create-dialog';

jest.mock('../workspace-api', () => ({
  getRelatedObjectCreateForm: jest.fn(),
  createRelatedObjectRecord: jest.fn(),
  searchRelatedObjects: jest.fn(),
  getRelatedObjectCreatePreview: jest.fn(),
}));

const loadForm = getRelatedObjectCreateForm as jest.Mock;
const create = createRelatedObjectRecord as jest.Mock;
const search = searchRelatedObjects as jest.Mock;
const loadPreview = getRelatedObjectCreatePreview as jest.Mock;

const CUSTOMER_FORM: RelatedObjectCreateForm = {
  kind: 'crm.customer',
  title: 'Thêm khách hàng',
  fields: [
    { key: 'name', label: 'Tên khách hàng', type: 'text', required: true },
    { key: 'taxCode', label: 'Mã số thuế', type: 'text' },
    { key: 'creditLimit', label: 'Hạn mức tín dụng (đồng)', type: 'money' },
  ],
};

const CREATED = { kind: 'crm.customer', id: 'k-9', code: 'KH009', label: 'KH009 — Công ty B', launchUrl: '/modules/crm#customers/k-9', fields: [], upstream: [] };

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  loadForm.mockReset();
  create.mockReset();
  search.mockReset();
  loadPreview.mockReset();
  loadForm.mockResolvedValue(CUSTOMER_FORM);
  search.mockResolvedValue({ items: [] });
});

afterEach(() => cleanup());

describe('RelatedObjectCreateDialog', () => {
  it('vẽ đúng form module gốc gửi; gửi giá trị đã đổi (tiền thành số), xong thì báo hồ sơ vừa tạo', async () => {
    create.mockResolvedValue(CREATED);
    const onCreated = jest.fn();
    render(<RelatedObjectCreateDialog kind="crm.customer" onClose={jest.fn()} onCreated={onCreated} />);
    expect(loadForm).toHaveBeenCalledWith('crm.customer');
    const name = await screen.findByLabelText('Tên khách hàng');
    fireEvent.change(name, { target: { value: 'Công ty B' } });
    fireEvent.change(screen.getByLabelText('Hạn mức tín dụng (đồng)'), { target: { value: '5000000' } });
    expect((screen.getByLabelText('Hạn mức tín dụng (đồng)') as HTMLInputElement).value).toBe('5.000.000');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(create).toHaveBeenCalledWith('crm.customer', {
      values: { name: 'Công ty B', taxCode: null, creditLimit: 5_000_000 },
    });
  });

  it('thiếu ô bắt buộc thì không gửi', async () => {
    render(<RelatedObjectCreateDialog kind="crm.customer" onClose={jest.fn()} onCreated={jest.fn()} />);
    await screen.findByLabelText('Tên khách hàng');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(create).not.toHaveBeenCalled();
  });

  it('module gốc cần xác nhận: hiện cảnh báo, nút thành "Vẫn lưu", bấm lại thì gửi kèm confirm', async () => {
    create
      .mockRejectedValueOnce({
        code: 'LINKABLE_CONFIRM_REQUIRED',
        message: 'Mã số thuế 0101234567 đã có ở khách hàng KH001 - Công ty A.',
        warnings: ['KH001 - Công ty A'],
      })
      .mockResolvedValueOnce(CREATED);
    const onCreated = jest.fn();
    render(<RelatedObjectCreateDialog kind="crm.customer" onClose={jest.fn()} onCreated={onCreated} />);
    fireEvent.change(await screen.findByLabelText('Tên khách hàng'), { target: { value: 'Công ty B' } });
    fireEvent.change(screen.getByLabelText('Mã số thuế'), { target: { value: '0101234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    expect(await screen.findByText('KH001 - Công ty A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vẫn lưu' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(create).toHaveBeenLastCalledWith('crm.customer', expect.objectContaining({ confirm: true }));
  });

  it('đổi dữ liệu sau cảnh báo thì bỏ xác nhận cũ', async () => {
    create.mockRejectedValueOnce({ code: 'LINKABLE_CONFIRM_REQUIRED', message: 'Trùng.', warnings: ['KH001 - Công ty A'] });
    render(<RelatedObjectCreateDialog kind="crm.customer" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText('Tên khách hàng'), { target: { value: 'Công ty B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await screen.findByRole('button', { name: 'Vẫn lưu' });
    fireEvent.change(screen.getByLabelText('Mã số thuế'), { target: { value: '0109999999' } });
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeTruthy();
    expect(screen.queryByText('KH001 - Công ty A')).toBeNull();
  });

  it('không có quyền mở form: hiện câu của module gốc, không cho gửi', async () => {
    loadForm.mockRejectedValue({ code: 'FORBIDDEN', message: 'Bạn không có quyền quản lý hợp đồng.' });
    render(<RelatedObjectCreateDialog kind="crm.contract" kindLabel="Hợp đồng bán" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(await screen.findByText('Bạn không có quyền quản lý hợp đồng.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Tạo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lưu trong hộp thoại không gửi luôn form bên dưới; Esc khi chưa nhập chỉ đóng hộp thoại này', async () => {
    create.mockResolvedValue(CREATED);
    const outerSubmit = jest.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const outerKey = jest.fn();
    window.addEventListener('keydown', outerKey);
    const onClose = jest.fn();
    render(
      <form onSubmit={outerSubmit}>
        <RelatedObjectCreateDialog kind="crm.customer" onClose={onClose} onCreated={jest.fn()} />
      </form>,
    );
    const name = await screen.findByLabelText('Tên khách hàng');
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outerKey).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: 'Công ty B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(outerSubmit).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerKey);
  });

  it('ô tham chiếu tìm qua đúng đường tìm của đối tượng liên quan', async () => {
    loadForm.mockResolvedValue({
      kind: 'crm.contract',
      title: 'Lập hợp đồng',
      fields: [{ key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', required: true }],
    });
    render(<RelatedObjectCreateDialog kind="crm.contract" onClose={jest.fn()} onCreated={jest.fn()} />);
    await screen.findByText('Khách hàng');
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.customer', ''));
  });
});

const CONTRACT_FORM: RelatedObjectCreateForm = {
  kind: 'crm.contract',
  title: 'Lập hợp đồng',
  fields: [
    { key: 'customerId', label: 'Khách hàng', type: 'reference', reference: 'crm.customer', requiredUnless: 'quoteId' },
    {
      key: 'quoteId',
      label: 'Báo giá',
      type: 'reference',
      reference: 'crm.quote',
      preview: true,
      placeholder: 'Không gắn báo giá',
      filters: [
        { param: 'contractLinkable', value: 'true' },
        { param: 'customerId', fromField: 'customerId' },
      ],
    },
    { key: 'title', label: 'Tên hợp đồng', type: 'text', required: true },
  ],
};

const QUOTE_PREVIEW = {
  field: 'quoteId',
  value: 'q-1',
  title: 'Dòng hàng từ báo giá BG-001',
  note: 'Hợp đồng nhận 1 dòng của phiên bản 2 khách đã chấp nhận.',
  columns: [
    { key: 'material', label: 'Mặt hàng', type: 'text' },
    { key: 'lineAmount', label: 'Thành tiền', type: 'money' },
  ],
  rows: [{ material: 'VT01 Tủ điện 400A', lineAmount: 100_000_000 }],
  fill: {
    customerId: { value: 'k-1', label: 'KH001 — Công ty A' },
    title: { value: 'Hợp đồng theo báo giá BG-001' },
  },
};

/** Mở ô chọn (theo chữ gợi ý khi trống, hoặc giá trị đang hiện) rồi bấm lựa chọn `option`. */
async function pick(trigger: string, option: string) {
  const input = await waitFor(() => screen.queryByPlaceholderText(trigger) ?? screen.getByDisplayValue(trigger));
  fireEvent.click(input);
  const choice = await screen.findByRole('option', { name: new RegExp(option) });
  // Chọn xong hộp thoại hỏi bản xem trước: chờ trong act để cập nhật trạng thái khi kết quả về không bị cảnh báo.
  await act(async () => {
    fireEvent.click(choice);
  });
}

describe('RelatedObjectCreateDialog: ô tham chiếu có lọc và xem trước', () => {
  let toastError: jest.SpyInstance;
  afterEach(() => toastError.mockRestore());
  beforeEach(() => {
    toastError = jest.spyOn(toast, 'error').mockImplementation(() => undefined as never);
    loadForm.mockResolvedValue(CONTRACT_FORM);
    search.mockImplementation(async (kind: string) =>
      kind === 'crm.customer'
        ? { items: [{ kind, id: 'k-1', code: 'KH001', label: 'KH001 — Công ty A' }, { kind, id: 'k-2', code: 'KH002', label: 'KH002 — Công ty B' }] }
        : { items: [{ kind, id: 'q-1', code: 'BG-001', label: 'BG-001 — Tủ điện', hint: 'KH001 — Công ty A' }] },
    );
    loadPreview.mockResolvedValue(QUOTE_PREVIEW);
  });

  it('tìm báo giá kèm lọc của module; chọn báo giá thì hiện bảng xem trước, điền khách và tên; gửi kèm báo giá', async () => {
    create.mockResolvedValue({ ...CREATED, kind: 'crm.contract' });
    const onCreated = jest.fn();
    render(<RelatedObjectCreateDialog kind="crm.contract" onClose={jest.fn()} onCreated={onCreated} />);
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.quote', '', { contractLinkable: 'true' }));
    await pick('Không gắn báo giá', 'BG-001 — Tủ điện');
    await waitFor(() => expect(loadPreview).toHaveBeenCalledWith('crm.contract', 'quoteId', 'q-1'));
    expect(await screen.findByText('Dòng hàng từ báo giá BG-001')).toBeTruthy();
    expect(screen.getByText('VT01 Tủ điện 400A')).toBeTruthy();
    expect(screen.getByText(/100\.000\.000/)).toBeTruthy();
    // Khách lấy theo báo giá; tìm báo giá lại theo khách đó; báo giá đang chọn không bị bỏ.
    expect(await screen.findByDisplayValue('KH001 — Công ty A')).toBeTruthy();
    expect(screen.getByDisplayValue('BG-001 — Tủ điện')).toBeTruthy();
    expect((screen.getByLabelText('Tên hợp đồng') as HTMLInputElement).value).toBe('Hợp đồng theo báo giá BG-001');
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.quote', '', { contractLinkable: 'true', customerId: 'k-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith('crm.contract', {
      values: { customerId: 'k-1', quoteId: 'q-1', title: 'Hợp đồng theo báo giá BG-001' },
    });
  });

  it('đổi sang khách khác thì bỏ báo giá đã chọn và bảng xem trước', async () => {
    render(<RelatedObjectCreateDialog kind="crm.contract" onClose={jest.fn()} onCreated={jest.fn()} />);
    await pick('Không gắn báo giá', 'BG-001 — Tủ điện');
    expect(await screen.findByText('Dòng hàng từ báo giá BG-001')).toBeTruthy();
    await pick('KH001 — Công ty A', 'KH002 — Công ty B');
    await waitFor(() => expect(screen.queryByText('Dòng hàng từ báo giá BG-001')).toBeNull());
    expect(screen.queryByDisplayValue('BG-001 — Tủ điện')).toBeNull();
    expect(screen.getByPlaceholderText('Không gắn báo giá')).toBeTruthy();
    await waitFor(() => expect(search).toHaveBeenCalledWith('crm.quote', '', { contractLinkable: 'true', customerId: 'k-2' }));
  });

  it('module gốc từ chối báo giá (đã gắn hợp đồng khác): hiện câu của nó, bỏ chọn', async () => {
    loadPreview.mockRejectedValueOnce({ code: 'QUOTE_CONVERTED', message: 'Báo giá đã chuyển thành hợp đồng HD-001.' });
    render(<RelatedObjectCreateDialog kind="crm.contract" onClose={jest.fn()} onCreated={jest.fn()} />);
    await pick('Không gắn báo giá', 'BG-001 — Tủ điện');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Báo giá đã chuyển thành hợp đồng HD-001.'));
    expect(screen.queryByDisplayValue('BG-001 — Tủ điện')).toBeNull();
    expect(screen.queryByText('Dòng hàng từ báo giá BG-001')).toBeNull();
  });

  it('chưa chọn khách cũng chưa chọn báo giá thì không gửi', async () => {
    render(<RelatedObjectCreateDialog kind="crm.contract" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText('Tên hợp đồng'), { target: { value: 'HĐ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Vui lòng chọn khách hàng.'));
    expect(create).not.toHaveBeenCalled();
  });
});
