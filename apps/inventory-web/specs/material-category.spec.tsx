import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { InventoryTradeCatalog } from '@enterprise-platform/contracts-inventory';
import { MaterialForm } from '@enterprise-platform/feature-inventory';

jest.mock('@enterprise-platform/shared-ui', () => ({
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

const catalog: InventoryTradeCatalog = {
  goodsCategories: ['HH_1', 'HH_2'],
  serviceCategories: ['DV_1'],
  usageModes: [],
};

const optionValues = (label: string | RegExp) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((option) => option.value);

function fillBasics() {
  fireEvent.change(screen.getByLabelText(/Mã SKU/), { target: { value: 'vt-1' } });
  fireEvent.change(screen.getByLabelText(/Tên vật tư/), { target: { value: 'Cáp điện' } });
  fireEvent.change(screen.getByLabelText(/Đơn vị tính/), { target: { value: 'Mét' } });
}

describe('Form vật tư: Phân loại lấy từ Cài đặt', () => {
  it('không còn ô Nhóm vật tư cố định; ô Phân loại liệt kê danh mục hàng hóa', () => {
    render(<MaterialForm catalog={catalog} busy={false} onCancel={jest.fn()} onSubmit={jest.fn()} />);
    expect(screen.queryByText(/Nhóm vật tư/)).toBeNull();
    expect(optionValues('— Chọn phân loại —')).toEqual(['', 'HH_1', 'HH_2']);
  });

  it('gửi tradeCategory đã chọn; category kỹ thuật vẫn do chế độ theo dõi quyết định', () => {
    const onSubmit = jest.fn();
    render(<MaterialForm catalog={catalog} busy={false} onCancel={jest.fn()} onSubmit={onSubmit} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText('— Chọn phân loại —'), { target: { value: 'HH_2' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu|Thêm|Tạo|Xác nhận/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ code: 'VT-1', tradeCategory: 'HH_2', category: 'SPARE_PART' });
  });

  it('đổi sang dịch vụ thì dùng danh mục dịch vụ và bỏ phân loại hàng hóa đã chọn', () => {
    const onSubmit = jest.fn();
    render(<MaterialForm catalog={catalog} busy={false} onCancel={jest.fn()} onSubmit={onSubmit} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText('— Chọn phân loại —'), { target: { value: 'HH_1' } });
    fireEvent.change(screen.getByLabelText('Chọn loại mặt hàng'), { target: { value: 'SERVICE' } });
    expect(optionValues('— Chọn phân loại —')).toEqual(['', 'DV_1']);
    fireEvent.click(screen.getByRole('button', { name: /Lưu|Thêm|Tạo|Xác nhận/ }));
    expect(onSubmit.mock.calls[0][0].tradeCategory).toBeUndefined();
  });

  it('sửa vật tư giữ phân loại đang có dù đã bị bỏ khỏi danh mục Cài đặt', () => {
    const editing = {
      id: 'm1',
      code: 'VT-9',
      name: 'Bộ đo',
      unit: 'Bộ',
      category: 'SPARE_PART',
      kind: 'STOCK',
      tradeCategory: 'HH_CU',
      minStock: 0,
      maxStock: 0,
      isSerialized: false,
      isActive: true,
    } as never;
    render(<MaterialForm editing={editing} catalog={catalog} busy={false} onCancel={jest.fn()} onSubmit={jest.fn()} />);
    expect(optionValues('— Chọn phân loại —')).toContain('HH_CU');
    expect((screen.getByLabelText('— Chọn phân loại —') as HTMLSelectElement).value).toBe('HH_CU');
  });
});
