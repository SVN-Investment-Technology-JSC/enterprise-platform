import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  AssetForm,
  BulkReturnToStockDialog,
  FormError,
  MaterialForm,
  useFormSubmit,
} from '@enterprise-platform/feature-inventory';

// Lỗi của lần gửi phải hiện ngay trong form: dải thông báo đầu trang nằm sau lớp phủ của hộp thoại.
jest.mock('@enterprise-platform/shared-ui', () => ({
  // Các hàm và ô nhập dùng chung là mã thuần, dùng bản thật để test khớp hành vi trên giao diện.
  ...jest.requireActual('../../../packages/shared/ui/src/lib/currency-format'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/vn-number-input'),
  ...jest.requireActual('../../../packages/shared/ui/src/lib/close-guard'),
  SearchableSelect: ({
    options,
    value,
    placeholder,
    onChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={placeholder ?? 'Chọn'} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

afterEach(cleanup);

describe('FormError', () => {
  it('không hiện gì khi không có lỗi, hiện role alert khi có', () => {
    const { container, rerender } = render(<FormError />);
    expect(container.firstChild).toBeNull();
    rerender(<FormError error="Mã vật tư BO DO đã tồn tại." />);
    expect(screen.getByRole('alert').textContent).toBe('Mã vật tư BO DO đã tồn tại.');
  });
});

describe('useFormSubmit', () => {
  function Probe({ run }: { run: () => Promise<void> | void }) {
    const { error, submit } = useFormSubmit('Không lưu được.');
    return (
      <>
        <button type="button" onClick={() => void submit(run)}>
          gửi
        </button>
        <FormError error={error} />
      </>
    );
  }

  it('lỗi có lời thì hiện nguyên văn, lỗi không có lời thì hiện lời mặc định, gửi lại xoá lỗi cũ', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('Mã đã tồn tại.'))
      .mockRejectedValueOnce('lỗi lạ')
      .mockResolvedValueOnce(undefined);
    render(<Probe run={run} />);
    const send = screen.getByRole('button', { name: 'gửi' });
    fireEvent.click(send);
    expect((await screen.findByRole('alert')).textContent).toBe('Mã đã tồn tại.');
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Không lưu được.'));
    fireEvent.click(send);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('chạy hàm đồng bộ ném lỗi cũng được bắt', async () => {
    render(
      <Probe
        run={() => {
          throw new Error('Thiếu quyền.');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'gửi' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Thiếu quyền.');
  });
});

describe('Form vật tư', () => {
  it('lỗi của Kho hiện trong form, dữ liệu đã nhập còn nguyên', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Mã vật tư BO DO đã tồn tại.'));
    render(<MaterialForm busy={false} onCancel={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Mã SKU/), { target: { value: 'bo do' } });
    fireEvent.change(screen.getByLabelText(/Tên vật tư/), { target: { value: 'Bộ đo' } });
    fireEvent.change(screen.getByLabelText(/Đơn vị tính/), { target: { value: 'Bộ' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu|Thêm|Tạo|Xác nhận/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Mã vật tư BO DO đã tồn tại.');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(/Tên vật tư/) as HTMLInputElement).value).toBe('Bộ đo');
  });
});

describe('Form thiết bị', () => {
  it('lỗi của Kho hiện trong form thiết bị', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Mã thiết bị TB-1 đã tồn tại.'));
    render(<AssetForm assets={[]} materials={[]} busy={false} onCancel={jest.fn()} onSubmit={onSubmit} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'tb-1' } });
    fireEvent.change(inputs[1], { target: { value: 'Máy biến áp' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thiết bị|Xác nhận tạo gốc/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Mã thiết bị TB-1 đã tồn tại.');
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ code: 'TB-1', name: 'Máy biến áp' });
  });
});

describe('Hộp thoại tháo dỡ hàng loạt', () => {
  it('lỗi của Kho hiện trong hộp thoại, danh sách thiết bị còn nguyên', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('Kho KHO-A đã ngừng hoạt động.'));
    const assets = [
      { id: 'a1', code: 'TB-1', name: 'Máy đo', parentId: null, status: 'OPERATING' },
    ] as never;
    const warehouses = [{ id: 'w1', code: 'KHO-A', name: 'Kho A', type: 'MAIN', isActive: true }] as never;
    render(<BulkReturnToStockDialog assets={assets} warehouses={warehouses} onCancel={jest.fn()} onConfirm={onConfirm} />);
    // Mỗi thiết bị cần một kho tiếp nhận; chọn kho cho tất cả rồi xác nhận.
    const selects = screen.getAllByRole('combobox');
    for (const select of selects) {
      if (within(select).queryByText('Kho A')) fireEvent.change(select, { target: { value: 'KHO-A' } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận tháo dỡ/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Kho KHO-A đã ngừng hoạt động.');
    expect(screen.getByText('TB-1')).toBeTruthy();
  });
});
