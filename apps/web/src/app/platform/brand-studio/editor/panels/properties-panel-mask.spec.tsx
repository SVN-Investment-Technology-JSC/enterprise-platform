import { createShape, type IconShape, type ShapeMask } from '@enterprise-platform/shared-brand-icon';
import { fireEvent, screen } from '@testing-library/react';
import { rectShape, renderWithEditor, testDoc } from './panel-test-utils';
import { PropertiesPanel } from './properties-panel';

const panel = (props: Parameters<typeof PropertiesPanel>[0]) => <PropertiesPanel {...props} />;

const MASK: ShapeMask = {
  layers: [
    createShape({ type: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 0 }, { fill: '#ffffff', stroke: 'none' }),
    createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 2, ry: 2 }, { fill: '#000000', stroke: 'none' }),
  ],
};

const withMask = (id: string, overrides: Partial<Omit<IconShape, 'geometry'>> = {}) => rectShape(id, 4, 4, 16, 16, { fill: '#ffffff', stroke: 'none', mask: MASK, ...overrides });

describe('PropertiesPanel: mặt nạ', () => {
  it('lớp có mặt nạ hiện mục Mặt nạ kèm số hình; lớp thường thì không', () => {
    renderWithEditor(testDoc([withMask('a')]), panel, { selection: ['a'] });
    expect(screen.getByRole('heading', { name: 'Mặt nạ' })).toBeTruthy();
    expect(screen.getByTestId('mask-info').textContent).toContain('gồm 2 hình');

    renderWithEditor(testDoc([rectShape('b')]), panel, { selection: ['b'] });
    expect(screen.getAllByRole('heading', { name: 'Mặt nạ' })).toHaveLength(1);
  });

  it('chọn nhiều lớp thì nói số lớp có mặt nạ', () => {
    renderWithEditor(testDoc([withMask('a'), withMask('b'), rectShape('c')]), panel, { selection: ['a', 'b', 'c'] });
    expect(screen.getByTestId('mask-info').textContent).toContain('2 lớp đang chọn có mặt nạ');
  });

  it('Bỏ mặt nạ gỡ mặt nạ khỏi các lớp đang chọn trong một bước hoàn tác, giữ nguyên hình và màu', () => {
    const { harness } = renderWithEditor(testDoc([withMask('a'), withMask('b'), rectShape('c')]), panel, { selection: ['a', 'b', 'c'] });
    fireEvent.click(screen.getByRole('button', { name: /^Bỏ mặt nạ/ }));
    expect(harness.shape('a').mask).toBeUndefined();
    expect(harness.shape('b').mask).toBeUndefined();
    expect(harness.shape('a')).toMatchObject({ fill: '#ffffff', geometry: { type: 'rect', width: 16 } });
    expect(harness.state().past).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Mặt nạ' })).toBeNull();
  });

  it('lớp bị khoá thì không bỏ được mặt nạ', () => {
    const { harness } = renderWithEditor(testDoc([withMask('a', { locked: true })]), panel, { selection: ['a'] });
    expect((screen.getByRole('button', { name: /^Bỏ mặt nạ/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(harness.shape('a').mask).toBeDefined();
  });
});
