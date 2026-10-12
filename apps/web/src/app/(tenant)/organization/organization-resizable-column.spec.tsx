import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ColumnResizeHandle, useResizableColumn } from './organization-resizable-column';

const STORAGE_KEY = 'organization.treeColumnWidth';

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const column = useResizableColumn({
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 720,
    reservedWidth: 400,
    containerRef,
  });
  return (
    <div ref={containerRef}>
      <span data-testid="width">{column.width}</span>
      <ColumnResizeHandle
        width={column.width}
        min={220}
        max={column.max}
        dragging={column.dragging}
        label="Đổi độ rộng cột sơ đồ cây"
        onReset={column.reset}
        handleProps={column.handleProps}
      />
    </div>
  );
}

const width = () => Number(screen.getByTestId('width').textContent);
const handle = () => screen.getByRole('separator', { name: 'Đổi độ rộng cột sơ đồ cây' });

// jsdom chưa có PointerEvent nên mất clientX và button; dựng từ MouseEvent để mô phỏng đúng trình duyệt.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

describe('Cột sơ đồ cây kéo thả được theo chiều ngang', () => {
  let rect: jest.SpyInstance;
  const original = (window as unknown as { PointerEvent?: unknown }).PointerEvent;

  beforeAll(() => {
    (window as unknown as { PointerEvent: unknown }).PointerEvent = TestPointerEvent;
  });
  afterAll(() => {
    (window as unknown as { PointerEvent?: unknown }).PointerEvent = original;
  });

  beforeEach(() => {
    window.localStorage.clear();
    // Khung chứa rộng 1000px: chừa 400px cho các cột còn lại nên cột cây tối đa 600px.
    rect = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  });
  afterEach(() => rect.mockRestore());

  it('bắt đầu ở độ rộng mặc định và công bố giới hạn cho trình đọc màn hình', () => {
    render(<Harness />);
    expect(width()).toBe(280);
    expect(handle().getAttribute('aria-valuenow')).toBe('280');
    expect(handle().getAttribute('aria-valuemin')).toBe('220');
    expect(handle().getAttribute('aria-valuemax')).toBe('600');
  });

  it('phím mũi tên đổi 16px, Shift đổi 64px, và độ rộng được nhớ', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(width()).toBe(296);
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(360);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(width()).toBe(344);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('344');
  });

  it('không nhỏ hơn mức tối thiểu và không vượt chỗ còn lại của khung chứa', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(width()).toBe(220);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft', shiftKey: true });
    expect(width()).toBe(220);
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(width()).toBe(600);
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(600);
  });

  it('nhấp đúp hoặc Enter đưa về độ rộng mặc định', () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: 'End' });
    fireEvent.doubleClick(handle());
    expect(width()).toBe(280);
    fireEvent.keyDown(handle(), { key: 'End' });
    fireEvent.keyDown(handle(), { key: 'Enter' });
    expect(width()).toBe(280);
  });

  it('đọc lại độ rộng đã lưu, kẹp trong giới hạn', () => {
    window.localStorage.setItem(STORAGE_KEY, '9999');
    render(<Harness />);
    expect(width()).toBe(600);
  });

  it('kéo chuột đổi độ rộng theo quãng kéo và lưu khi thả', () => {
    render(<Harness />);
    const el = handle();
    el.setPointerCapture = jest.fn();
    el.hasPointerCapture = jest.fn(() => true);
    el.releasePointerCapture = jest.fn();
    fireEvent.pointerDown(el, { clientX: 300, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 380, pointerId: 1 });
    expect(width()).toBe(360);
    fireEvent.pointerMove(el, { clientX: 5000, pointerId: 1 });
    expect(width()).toBe(600);
    fireEvent.pointerUp(el, { clientX: 5000, pointerId: 1 });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('600');
    // Sau khi thả, di chuột không còn đổi độ rộng.
    fireEvent.pointerMove(el, { clientX: 0, pointerId: 1 });
    expect(width()).toBe(600);
  });
});
