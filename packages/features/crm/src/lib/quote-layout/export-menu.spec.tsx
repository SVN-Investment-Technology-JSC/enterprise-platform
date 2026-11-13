/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ExportMenu } from './export-menu';
import { fixtureDetail, fixtureFullLayout } from './quote-layout.fixtures';
import { buildQuoteLayoutData } from './quote-layout.data';

jest.mock('./quote-layout.module.scss', () => ({ __esModule: true, default: new Proxy({}, { get: (_t, key) => String(key) }) }));
const mockToastError = jest.fn();
jest.mock('@enterprise-platform/shared-ui', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() } }));

const layout = fixtureFullLayout();
const data = buildQuoteLayoutData({ detail: fixtureDetail(), now: new Date(2026, 10, 6) });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Xuất/ }));

describe('ExportMenu', () => {
  beforeEach(() => mockToastError.mockReset());

  it('menu có PDF / In và Word (.docx); tên file truyền nguyên cho bộ xuất', async () => {
    const pdf = jest.fn().mockResolvedValue(undefined);
    render(<ExportMenu layout={layout} data={data} fileName="BG2600001_v1" exporters={{ pdf }} />);
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'PDF / In' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Word (.docx)' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'PDF / In' }));
    });
    expect(pdf).toHaveBeenCalledWith({ layout, data, fileName: 'BG2600001_v1' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('TC-EX-13: đang xuất thì khoá nút, bấm lặp không xuất thêm', async () => {
    const pending = deferred();
    const docx = jest.fn().mockReturnValue(pending.promise);
    render(<ExportMenu layout={layout} data={data} fileName="BG_v1" exporters={{ docx }} />);
    openMenu();
    const item = screen.getByRole('menuitem', { name: 'Word (.docx)' });
    fireEvent.click(item);
    fireEvent.click(item);
    fireEvent.click(item);
    expect(docx).toHaveBeenCalledTimes(1);
    const button = screen.getByRole('button', { name: /Đang xuất/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect((screen.getByRole('button', { name: /Xuất/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('TC-EX-12: lỗi tải thư viện Word báo toast tiếng Việt, bấm lại được', async () => {
    const loadDocx = jest.fn().mockRejectedValue(new Error('ChunkLoadError: Loading chunk 77 failed.'));
    // Không truyền `docx`: dùng bộ xuất Word thật với bộ tải thư viện hỏng.
    render(<ExportMenu layout={layout} data={data} fileName="BG_v1" exporters={{ loadDocx }} />);
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Word (.docx)' }));
    });
    expect(loadDocx).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith('Không tải được bộ xuất Word. Kiểm tra mạng và thử lại.');
    expect((screen.getByRole('button', { name: /Xuất/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Escape đóng menu', () => {
    render(<ExportMenu layout={layout} data={data} fileName="BG_v1" />);
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
