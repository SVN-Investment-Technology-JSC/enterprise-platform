import { DEFAULT_PALETTE, DEFAULT_RULES } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CompliancePanel } from './compliance-panel';
import { rectShape, testDoc } from './panel-test-utils';

const clean = () => testDoc([rectShape('a', 6, 6, 12, 12, { strokeWidth: 1.75 })]);

const renderPanel = (doc = clean(), onSelectShape?: (id: string) => void) =>
  render(<CompliancePanel doc={doc} palette={DEFAULT_PALETTE} rules={DEFAULT_RULES} onSelectShape={onSelectShape} />);

describe('CompliancePanel', () => {
  it('icon đạt quy chuẩn thì hiện dấu tích xanh và không có danh sách', () => {
    renderPanel();
    expect(screen.getByRole('status').textContent).toContain('Đạt quy chuẩn');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('hiện tổng quan số lỗi, cảnh báo, gợi ý và từng dòng với mức độ', () => {
    const doc = testDoc([rectShape('a', 6.2, 6, 12, 12, { strokeWidth: 1 })], { name: '  ' });
    renderPanel(doc);
    const summary = screen.getByRole('status').textContent ?? '';
    expect(summary).toContain('1 lỗi');
    expect(summary).toContain('1 cảnh báo');
    expect(summary).toContain('1 gợi ý');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole('img', { name: 'Lỗi' })).toBeTruthy();
    expect(within(items[0]).getByText('Icon chưa có tên.')).toBeTruthy();
    expect(within(items[1]).getByRole('img', { name: 'Cảnh báo' })).toBeTruthy();
    expect(within(items[2]).getByRole('img', { name: 'Gợi ý' })).toBeTruthy();
  });

  it('bấm vào dòng có lớp liên quan thì chọn lớp đó', () => {
    const onSelectShape = jest.fn();
    renderPanel(testDoc([rectShape('thin', 6, 6, 12, 12, { strokeWidth: 1 })]), onSelectShape);
    fireEvent.click(screen.getByRole('button', { name: /nét 1 không thuộc bộ cho phép/ }));
    expect(onSelectShape).toHaveBeenCalledWith('thin');
  });

  it('dòng về cả icon (không có lớp) không bấm được', () => {
    renderPanel(testDoc([rectShape('a')], { name: '' }), jest.fn());
    expect(screen.getByText('Icon chưa có tên.').closest('button')).toBeNull();
  });

  it('không có onSelectShape thì các dòng chỉ để đọc', () => {
    renderPanel(testDoc([rectShape('thin', 6, 6, 12, 12, { strokeWidth: 1 })]));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('kiểm tra lại khi tài liệu hoặc quy chuẩn đổi', () => {
    const doc = testDoc([rectShape('a', 6, 6, 12, 12, { strokeWidth: 1 })]);
    const { rerender } = render(<CompliancePanel doc={doc} palette={DEFAULT_PALETTE} rules={DEFAULT_RULES} />);
    expect(screen.getByText(/không thuộc bộ cho phép/)).toBeTruthy();
    rerender(<CompliancePanel doc={doc} palette={DEFAULT_PALETTE} rules={{ ...DEFAULT_RULES, allowedStrokeWidths: [1] }} />);
    expect(screen.queryByText(/không thuộc bộ cho phép/)).toBeNull();
  });

  it('icon rỗng báo lỗi chưa có hình nào hiển thị', () => {
    renderPanel(testDoc([]));
    expect(screen.getByText('Icon chưa có hình nào hiển thị.')).toBeTruthy();
  });
});
