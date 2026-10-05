/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DynamicAttributeForm } from './dynamic-attribute-form';

const base = { required: false, scope: 'step' as const };

describe('DynamicAttributeForm', () => {
  it('tải tệp cho thuộc tính kiểu file và lưu id đính kèm', async () => {
    const onChange = jest.fn();
    const onUploadFile = jest.fn().mockResolvedValue({ id: 'att-1', name: 'a.pdf' });
    const { container } = render(
      <DynamicAttributeForm
        attributes={[{ ...base, id: '1', code: 'giay_to', name: 'Giấy tờ', type: 'file' }]}
        values={{}}
        onChange={onChange}
        onUploadFile={onUploadFile}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('giay_to', 'att-1'));
    expect(onUploadFile).toHaveBeenCalledWith(file);
  });

  it('hiển thị lỗi khi tải tệp thất bại', async () => {
    const onChange = jest.fn();
    const { container } = render(
      <DynamicAttributeForm
        attributes={[{ ...base, id: '1', code: 'f', name: 'Tệp', type: 'file' }]}
        values={{}}
        onChange={onChange}
        onUploadFile={jest.fn().mockRejectedValue(new Error('Tệp vượt quá dung lượng'))}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.pdf')] },
    });
    expect(await screen.findByText('Tệp vượt quá dung lượng')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ẩn thuộc tính nằm trong excludeCodes', () => {
    render(
      <DynamicAttributeForm
        attributes={[{ ...base, id: '1', code: 'so_ngay_nghi', name: 'Số ngày nghỉ', type: 'number' }]}
        values={{}}
        onChange={jest.fn()}
        excludeCodes={['so_ngay_nghi']}
      />,
    );
    expect(screen.queryByText('Số ngày nghỉ')).toBeNull();
  });

  it('hiển thị nhãn thuộc tính kiểu user', () => {
    render(
      <DynamicAttributeForm
        attributes={[{ ...base, id: '1', code: 'nguoi', name: 'Người phối hợp', type: 'user' }]}
        values={{}}
        onChange={jest.fn()}
        userOptions={[{ value: 'e1', label: 'Nguyễn A (E01)' }]}
      />,
    );
    expect(screen.getByText('Người phối hợp')).toBeTruthy();
  });
});
