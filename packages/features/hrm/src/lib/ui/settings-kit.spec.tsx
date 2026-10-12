/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Settings } from 'lucide-react';
import {
  EmptyPanel,
  InfoNote,
  RadioCards,
  SectionTabs,
  SegmentedTabs,
  SettingsSection,
  StatusPill,
  kitPanelProps,
} from './settings-kit';

const TABS = [
  { id: 'a', label: 'Tab A', count: 3 },
  { id: 'b', label: 'Tab B' },
  { id: 'c', label: 'Tab C', disabled: true },
  { id: 'd', label: 'Tab D' },
];

describe('settings-kit', () => {
  it('SettingsSection: tiêu đề, mô tả, nút thao tác và nội dung; vùng được gắn nhãn bằng tiêu đề', () => {
    render(
      <SettingsSection icon={Settings} title="Cách tính phép" description="Mô tả thẻ" actions={<button type="button">Lưu</button>}>
        <p>Nội dung thẻ</p>
      </SettingsSection>,
    );
    const region = screen.getByRole('region', { name: 'Cách tính phép' });
    expect(within(region).getByText('Mô tả thẻ')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Lưu' })).toBeTruthy();
    expect(within(region).getByText('Nội dung thẻ')).toBeTruthy();
  });

  it('InfoNote: mặc định là ghi chú (role note); cảnh báo lỗi có thể đặt role alert', () => {
    const { rerender } = render(<InfoNote>Thông tin</InfoNote>);
    expect(screen.getByRole('note').textContent).toBe('Thông tin');
    rerender(
      <InfoNote tone="red" role="alert">
        Lỗi
      </InfoNote>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Lỗi');
  });

  it('SectionTabs: đánh dấu tab đang chọn, hiện số lượng, bấm đổi tab và bỏ qua tab vô hiệu khi dùng phím mũi tên', () => {
    const onChange = jest.fn();
    render(<SectionTabs tabs={TABS} active="b" onChange={onChange} ariaLabel="Mục con" idPrefix="demo" />);
    const list = screen.getByRole('tablist', { name: 'Mục con' });
    expect(within(list).getByRole('tab', { name: /Tab A/ }).textContent).toContain('3');
    expect(within(list).getByRole('tab', { name: 'Tab B' }).getAttribute('aria-selected')).toBe('true');
    expect(within(list).getByRole('tab', { name: 'Tab B' }).getAttribute('aria-controls')).toBe('demo-panel-b');
    fireEvent.click(within(list).getByRole('tab', { name: /Tab A/ }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(within(list).getByRole('tab', { name: 'Tab B' }), { key: 'ArrowRight' });
    // Tab C bị vô hiệu nên nhảy sang Tab D.
    expect(onChange).toHaveBeenLastCalledWith('d');
    fireEvent.keyDown(within(list).getByRole('tab', { name: 'Tab B' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(within(list).getByRole('tab', { name: 'Tab B' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('d');
  });

  it('SegmentedTabs: chia đều cột theo số tab và đổi tab khi bấm', () => {
    const onChange = jest.fn();
    render(
      <SegmentedTabs
        tabs={[
          { id: 'assign', label: 'Phân ca' },
          { id: 'release', label: 'Nhả ca' },
        ]}
        active="assign"
        onChange={onChange}
        ariaLabel="Chế độ"
        idPrefix="seg"
      />,
    );
    const list = screen.getByRole('tablist', { name: 'Chế độ' });
    expect(list.getAttribute('style')).toContain('repeat(2');
    fireEvent.click(within(list).getByRole('tab', { name: 'Nhả ca' }));
    expect(onChange).toHaveBeenCalledWith('release');
  });

  it('kitPanelProps nối vùng nội dung với tab tương ứng', () => {
    expect(kitPanelProps('demo', 'a')).toEqual({ id: 'demo-panel-a', role: 'tabpanel', 'aria-labelledby': 'demo-tab-a' });
  });

  it('RadioCards: radiogroup chọn một, mũi tên đổi lựa chọn, thẻ vô hiệu bị bỏ qua', () => {
    const onChange = jest.fn();
    render(
      <RadioCards
        label="Phạm vi áp dụng"
        value="all"
        onChange={onChange}
        options={[
          { value: 'all', title: 'Toàn bộ nhân viên', description: 'Áp dụng cho tất cả' },
          { value: 'some', title: 'Chọn nhân viên' },
          { value: 'unit', title: 'Theo phòng ban', disabled: true },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Phạm vi áp dụng' });
    expect(within(group).getByRole('radio', { name: /Toàn bộ nhân viên/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: /Chọn nhân viên/ }));
    expect(onChange).toHaveBeenLastCalledWith('some');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('some');
    expect((within(group).getByRole('radio', { name: /Theo phòng ban/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('StatusPill và EmptyPanel hiện nội dung', () => {
    render(
      <>
        <StatusPill tone="green">Đang sử dụng</StatusPill>
        <EmptyPanel icon={Settings} title="Chưa có dữ liệu" description="Hãy thêm mới" action={<button type="button">Thêm</button>} />
      </>,
    );
    expect(screen.getByText('Đang sử dụng')).toBeTruthy();
    expect(screen.getByText('Chưa có dữ liệu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thêm' })).toBeTruthy();
  });
});
