import { render } from '@testing-library/react';
import type { EditorCommand } from './interactions';
import { isTypingTarget, useEditorKeyboard } from './use-editor-keyboard';

const commands: EditorCommand[] = [];
const spaceCalls: boolean[] = [];

function Harness({ enabled = true }: { enabled?: boolean }) {
  useEditorKeyboard({
    enabled,
    tool: 'select',
    onCommand: (command) => commands.push(command),
    onSpace: (pressed) => spaceCalls.push(pressed),
  });
  return (
    <div>
      <button type="button">Công cụ</button>
      <div role="button" tabIndex={0}>
        Nút kiểu div
      </div>
      <input aria-label="Tên" />
      <div role="dialog">
        <button type="button">Trong hộp thoại</button>
      </div>
      <svg aria-label="Canvas" tabIndex={0} />
    </div>
  );
}

/** Gửi phím tới phần tử đang có tiêu điểm như trình duyệt; trả về sự kiện để kiểm tra preventDefault. */
function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const get = (container: HTMLElement, selector: string) => container.querySelector(selector) as HTMLElement;

beforeEach(() => {
  commands.length = 0;
  spaceCalls.length = 0;
});

describe('isTypingTarget', () => {
  it('ô nhập, hộp thoại và nút tự xử lý phím của mình', () => {
    const { container, getByLabelText } = render(<Harness />);

    expect(isTypingTarget(getByLabelText('Tên'))).toBe(true);
    expect(isTypingTarget(get(container, 'button'))).toBe(true);
    expect(isTypingTarget(get(container, '[role="button"]'))).toBe(true);
    expect(isTypingTarget(get(container, '[role="dialog"] button'))).toBe(true);
  });

  it('canvas, nền trang và đích không phải phần tử thì không', () => {
    const { getByLabelText } = render(<Harness />);

    expect(isTypingTarget(getByLabelText('Canvas'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('useEditorKeyboard: phím Space', () => {
  it('Space khi tiêu điểm ở nền hoặc canvas giữ để kéo nền và chặn cuộn trang', () => {
    const { getByLabelText } = render(<Harness />);

    const onCanvas = press(getByLabelText('Canvas'), ' ');

    expect(onCanvas.defaultPrevented).toBe(true);
    expect(spaceCalls).toEqual([true]);
  });

  it('Space khi nút đang có tiêu điểm không bị chặn: nút vẫn bấm được và không bật chế độ kéo nền', () => {
    const { container } = render(<Harness />);

    const onButton = press(get(container, 'button'), ' ');
    const onRoleButton = press(get(container, '[role="button"]'), ' ');

    expect(onButton.defaultPrevented).toBe(false);
    expect(onRoleButton.defaultPrevented).toBe(false);
    expect(spaceCalls).toEqual([]);
  });

  it('Space trong ô nhập vẫn là gõ khoảng trắng', () => {
    const { getByLabelText } = render(<Harness />);

    const event = press(getByLabelText('Tên'), ' ');

    expect(event.defaultPrevented).toBe(false);
    expect(spaceCalls).toEqual([]);
  });
});

describe('useEditorKeyboard: phím tắt khi nút có tiêu điểm', () => {
  it('Enter thuộc về nút (bấm nút), không thành lệnh của trình thiết kế', () => {
    const { container } = render(<Harness />);

    const event = press(get(container, 'button'), 'Enter');

    expect(event.defaultPrevented).toBe(false);
    expect(commands).toEqual([]);
  });

  it('các phím tắt khác vẫn chạy sau khi bấm một nút trên thanh công cụ: Ctrl+Z, V, Delete, mũi tên', () => {
    const { container } = render(<Harness />);
    const button = get(container, 'button');

    press(button, 'z', { ctrlKey: true });
    press(button, 'r');
    press(button, 'Delete');
    press(button, 'ArrowLeft');

    expect(commands).toEqual([
      { type: 'undo' },
      { type: 'tool', tool: 'rect' },
      { type: 'delete' },
      { type: 'nudge', dx: -1, dy: 0, shift: false, alt: false },
    ]);
  });

  it('nút nằm trong hộp thoại giữ mọi phím cho hộp thoại', () => {
    const { container } = render(<Harness />);

    press(get(container, '[role="dialog"] button'), 'Delete');
    press(get(container, '[role="dialog"] button'), 'z', { ctrlKey: true });

    expect(commands).toEqual([]);
  });

  it('ô nhập giữ mọi phím; riêng Ctrl+S vẫn lưu được', () => {
    jest.useFakeTimers();
    try {
      const { getByLabelText } = render(<Harness />);
      const input = getByLabelText('Tên');

      press(input, 'Delete');
      press(input, 'z', { ctrlKey: true });
      expect(commands).toEqual([]);

      const save = press(input, 's', { ctrlKey: true });
      jest.runOnlyPendingTimers();

      expect(save.defaultPrevented).toBe(true);
      expect(commands).toEqual([{ type: 'save' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tắt hẳn thì không bắt phím nào', () => {
    const { getByLabelText } = render(<Harness enabled={false} />);

    const event = press(getByLabelText('Canvas'), ' ');
    press(getByLabelText('Canvas'), 'Delete');

    expect(event.defaultPrevented).toBe(false);
    expect(commands).toEqual([]);
    expect(spaceCalls).toEqual([]);
  });
});
