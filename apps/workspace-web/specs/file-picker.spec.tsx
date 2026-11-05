import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChatAttachments } from '../../../packages/features/workspace/src/lib/components/chat-attachments';
import { FilePicker } from '../../../packages/features/workspace/src/lib/components/file-picker';

afterEach(cleanup);

const ACCEPT = ['application/pdf', 'image/png'];
const MAX_BYTES = 1000;

const file = (name: string, size = 10, type = 'application/pdf') => {
  const value = new File([new Uint8Array(size)], name, { type, lastModified: 1 });
  return value;
};

/** Giữ danh sách tệp như hộp thoại thật: ô chọn là ô kiểm soát nên cần một chỗ giữ state. */
function Harness({ maxFiles }: { maxFiles?: number }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <>
      <FilePicker files={files} onChange={setFiles} accept={ACCEPT} maxBytes={MAX_BYTES} maxFiles={maxFiles} />
      <output data-testid="names">{files.map((entry) => entry.name).join('|')}</output>
    </>
  );
}

const pick = (...files: File[]) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
};

describe('FilePicker', () => {
  it('một tệp: chọn tệp mới thay tệp cũ', () => {
    render(<Harness />);
    pick(file('a.pdf'));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf');
    pick(file('b.pdf'));
    expect(screen.getByTestId('names').textContent).toBe('b.pdf');
  });

  it('nhiều tệp: chọn một lượt nhiều tệp rồi thêm tiếp, bỏ được từng tệp', () => {
    render(<Harness maxFiles={5} />);
    pick(file('a.pdf'), file('b.png', 10, 'image/png'));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf|b.png');
    pick(file('c.pdf', 20));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf|b.png|c.pdf');
    expect(screen.getByText('Đã chọn 3/5 tệp')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ tệp b.png' }));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf|c.pdf');
  });

  it('nhiều tệp: bỏ qua tệp trùng, từ chối tệp quá lớn hoặc sai loại nhưng vẫn nhận tệp hợp lệ trong cùng lượt', () => {
    render(<Harness maxFiles={5} />);
    pick(file('a.pdf'));
    pick(file('a.pdf'), file('big.pdf', MAX_BYTES + 1), file('x.exe', 10, 'application/x-msdownload'), file('ok.pdf', 11));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf|ok.pdf');
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain('big.pdf');
    expect(alert).toContain('x.exe');
  });

  it('nhiều tệp: chọn quá số tệp tối đa thì cắt và báo', () => {
    render(<Harness maxFiles={2} />);
    pick(file('a.pdf'), file('b.pdf', 11), file('c.pdf', 12));
    expect(screen.getByTestId('names').textContent).toBe('a.pdf|b.pdf');
    expect(screen.getByRole('alert').textContent).toContain('tối đa 2 tệp');
  });
});

describe('ChatAttachments', () => {
  it('mỗi tệp một nhãn; không có tệp thì không vẽ gì', () => {
    const { container, rerender } = render(<ChatAttachments names={['Hợp đồng.pdf', 'Bản vẽ.png']} />);
    expect(screen.getByText('Hợp đồng.pdf')).toBeTruthy();
    expect(screen.getByText('Bản vẽ.png')).toBeTruthy();
    rerender(<ChatAttachments names={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
