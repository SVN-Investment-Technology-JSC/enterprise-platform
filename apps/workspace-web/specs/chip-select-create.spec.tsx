import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Choice, ChipSelect, mergeUpdated } from '@enterprise-platform/feature-workspace';

// `SearchableSelect` đo bằng ResizeObserver; jsdom chưa có.
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => cleanup());

/** Chip nhóm như trong bảng dự án: có mục "Chưa phân loại" và ô thêm nhóm ở cuối danh sách. */
function Harness({
  onCreate,
  onChange,
  initialOptions = [{ value: 'Cá basa', label: 'Cá basa' }],
  start = 'Cá basa',
}: {
  onCreate: (name: string, code: string) => Promise<string>;
  onChange?: (value: string) => void;
  initialOptions?: { value: string; label: string }[];
  start?: string;
}) {
  const [value, setValue] = useState(start);
  const [options, setOptions] = useState(initialOptions);
  return (
    <ChipSelect
      label="Nhóm của DA-1"
      value={value}
      emptyLabel="Chưa phân loại"
      options={options}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      create={{
        namePlaceholder: 'Tên nhóm mới',
        codePlaceholder: 'Mã',
        codeLabel: 'Mã viết tắt (tuỳ chọn)',
        addLabel: 'Thêm',
        addTitle: 'Thêm nhóm',
        onCreate: async (name, code) => {
          const created = await onCreate(name, code);
          setOptions((current) => [...current, { value: created, label: created }]);
          return created;
        },
      }}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole('group', { name: 'Nhóm của DA-1' }).querySelector('input') as HTMLElement);

describe('ChipSelect có ô thêm mục mới', () => {
  it('"Chưa phân loại" là một lựa chọn và gửi giá trị rỗng để gỡ nhóm', async () => {
    const onChange = jest.fn();
    render(<Harness onCreate={jest.fn()} onChange={onChange} />);
    open();
    fireEvent.click(await screen.findByText('Chưa phân loại', { selector: 'span' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('gõ tên (và mã) rồi bấm Thêm: tạo nhóm, chọn luôn nhóm đó và đóng danh sách', async () => {
    const onCreate = jest.fn(async (name: string) => name);
    const onChange = jest.fn();
    render(<Harness onCreate={onCreate} onChange={onChange} />);
    open();
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: '  Dịch vụ thí nghiệm ' } });
    fireEvent.change(screen.getByLabelText('Mã viết tắt (tuỳ chọn)'), { target: { value: 'DVTN' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhóm/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Dịch vụ thí nghiệm'));
    expect(onCreate).toHaveBeenCalledWith('Dịch vụ thí nghiệm', 'DVTN');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('group', { name: 'Nhóm của DA-1' }).querySelector('input')?.getAttribute('value')).toBe(
      'Dịch vụ thí nghiệm',
    );
  });

  it('Enter ở ô tên cũng thêm, và không chọn nhầm mục đang sáng trong danh sách', async () => {
    const onCreate = jest.fn(async (name: string) => name);
    const onChange = jest.fn();
    render(<Harness onCreate={onCreate} onChange={onChange} />);
    open();
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: 'Nhóm mới' } });
    fireEvent.keyDown(screen.getByLabelText('Tên nhóm mới'), { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Nhóm mới', ''));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Nhóm mới');
  });

  it('tên trống thì báo lỗi và không gọi tạo', async () => {
    const onCreate = jest.fn(async (name: string) => name);
    render(<Harness onCreate={onCreate} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhóm/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nhập tên trước khi thêm.');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('server từ chối (trùng tên, không đủ quyền) thì hiện đúng lỗi, giữ danh sách mở và không đổi lựa chọn', async () => {
    const onChange = jest.fn();
    render(
      <Harness
        onCreate={async () => {
          throw { message: 'Nhóm dự án "Cá basa" đã tồn tại.' };
        }}
        onChange={onChange}
      />,
    );
    open();
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: 'Cá basa' } });
    fireEvent.click(screen.getByRole('button', { name: /Thêm nhóm/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nhóm dự án "Cá basa" đã tồn tại.');
    expect(screen.queryByRole('listbox')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // Gõ lại thì lỗi cũ biến mất.
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: 'Cá basa 2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('mergeUpdated', () => {
  type Row = { id: string; name: string; projectType?: string; customerId?: string };
  const row: Row = { id: 'p1', name: 'Dự án', projectType: 'Cá basa', customerId: 'c1' };

  it('trường patch đặt null mà server bỏ khỏi phản hồi thì bị xoá khỏi dòng (gỡ nhóm / bỏ khách hàng)', () => {
    const merged = mergeUpdated(row, { id: 'p1', name: 'Dự án' }, { projectType: null });
    expect('projectType' in merged).toBe(false);
    expect(merged.customerId).toBe('c1');
    expect('customerId' in mergeUpdated(row, { id: 'p1', name: 'Dự án' }, { customerId: null })).toBe(false);
  });

  it('trường có giá trị mới thì lấy giá trị mới; trường không đụng tới giữ nguyên', () => {
    expect(mergeUpdated(row, { projectType: 'Sấm sét' }, { projectType: 'Sấm sét' })).toEqual({
      ...row,
      projectType: 'Sấm sét',
    });
    expect(mergeUpdated(row, { name: 'Tên mới' }, { name: 'Tên mới' })).toEqual({ ...row, name: 'Tên mới' });
  });

  it('phản hồi có trường nhưng giá trị undefined thì cũng là đã gỡ', () => {
    expect(mergeUpdated(row, { projectType: undefined }, { projectType: null }).projectType).toBeUndefined();
  });
});

describe('Choice (ô chọn của form) có ô thêm mục mới', () => {
  function ChoiceHarness({ onCreate, withCreate = true }: { onCreate: (name: string, code: string) => Promise<string>; withCreate?: boolean }) {
    const [value, setValue] = useState('');
    const [options, setOptions] = useState([{ value: 'Cá basa', label: 'Cá basa' }]);
    return (
      <>
        <Choice
          label="Nhóm dự án"
          value={value}
          emptyOption="Chưa phân loại"
          options={options}
          onChange={setValue}
          create={
            withCreate
              ? {
                  namePlaceholder: 'Tên nhóm mới',
                  codePlaceholder: 'Mã',
                  addLabel: 'Thêm',
                  addTitle: 'Thêm nhóm',
                  onCreate: async (name, code) => {
                    const created = await onCreate(name, code);
                    setOptions((current) => [...current, { value: created, label: created }]);
                    return created;
                  },
                }
              : undefined
          }
        />
        <output aria-label="giá trị">{value}</output>
      </>
    );
  }
  const openChoice = () => fireEvent.click(screen.getByRole('group', { name: 'Nhóm dự án' }).querySelector('input') as HTMLElement);

  it('thêm xong thì chọn luôn mục mới và đóng danh sách', async () => {
    const onCreate = jest.fn(async (name: string) => name);
    render(<ChoiceHarness onCreate={onCreate} />);
    openChoice();
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: 'Tia chớp' } });
    fireEvent.change(screen.getByLabelText('Mã'), { target: { value: 'TC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhóm' }));
    await waitFor(() => expect(screen.getByLabelText('giá trị').textContent).toBe('Tia chớp'));
    expect(onCreate).toHaveBeenCalledWith('Tia chớp', 'TC');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('lỗi từ server hiện dưới ô nhập, không đổi giá trị; không truyền create thì không có chân', async () => {
    render(
      <ChoiceHarness
        onCreate={async () => {
          throw { message: 'Chỉ quản trị viên được thêm nhóm.' };
        }}
      />,
    );
    openChoice();
    fireEvent.change(screen.getByLabelText('Tên nhóm mới'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm nhóm' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Chỉ quản trị viên được thêm nhóm.');
    expect(screen.getByLabelText('giá trị').textContent).toBe('');
    cleanup();
    render(<ChoiceHarness onCreate={jest.fn()} withCreate={false} />);
    openChoice();
    expect(screen.queryByLabelText('Tên nhóm mới')).toBeNull();
  });
});
