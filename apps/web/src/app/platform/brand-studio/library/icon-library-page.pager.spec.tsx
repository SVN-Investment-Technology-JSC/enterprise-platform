import {
  createDocument,
  createPresetDocuments,
  createShape,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { STORAGE_KEYS, localStore } from '../store/local-store';
import { IconLibraryPage } from './icon-library-page';
import { MEMORY_KEY } from './library-pager';

jest.mock('../export/export-dialog', () => ({ ExportDialog: () => null }));

const presets = createPresetDocuments();
const EXTRA = 60;
const TOTAL = presets.length + EXTRA;

/** Icon `Icon 01`..`Icon 60`: số lớn hơn thì mới sửa hơn, nên thứ tự mặc định (mới sửa trước) là Icon 60, 59... */
const extras: IconDocument[] = Array.from({ length: EXTRA }, (_, index) => {
  const number = index + 1;
  return createDocument({
    id: `extra-${number}`,
    name: `Icon ${String(number).padStart(2, '0')}`,
    updatedAt: new Date(2030, 0, 1, 0, number).toISOString(),
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
  });
});

function seed(docs: readonly IconDocument[]) {
  window.localStorage.setItem(STORAGE_KEYS.docs, JSON.stringify(docs));
  localStore.reloadForTest();
}

const tiles = () => screen.queryAllByTestId('icon-tile');
const tileNames = () => tiles().map((tile) => within(tile).getAllByRole('link')[0].getAttribute('aria-label')?.replace(/^Mở /, ''));
const summary = () => screen.getByTestId('pager-bar').textContent ?? '';
const goTo = (page: number) => fireEvent.click(screen.getByRole('button', { name: `Trang ${page}` }));
const currentPage = () => screen.getByRole('button', { current: 'page' }).getAttribute('aria-label');
const search = () => screen.getByRole('searchbox', { name: 'Tìm icon' });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  seed([...presets, ...extras]);
});

describe('IconLibraryPage: phân trang', () => {
  it('trang đầu hiện 24 icon mới sửa nhất, kèm khoảng đang xem và tổng số', () => {
    render(<IconLibraryPage />);
    expect(tiles()).toHaveLength(24);
    expect(tileNames().slice(0, 3)).toEqual(['Icon 60', 'Icon 59', 'Icon 58']);
    expect(summary()).toContain(`1–24 / ${TOTAL} icon`);
    expect(currentPage()).toBe('Trang 1');
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('chuyển trang bằng nút số, Trang sau và Trang trước; trang cuối chỉ hiện phần còn lại', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(currentPage()).toBe('Trang 2');
    expect(tileNames()[0]).toBe('Icon 36');
    expect(summary()).toContain(`25–48 / ${TOTAL} icon`);

    goTo(3);
    expect(tiles()).toHaveLength(TOTAL - 48);
    expect(summary()).toContain(`49–${TOTAL} / ${TOTAL} icon`);
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(currentPage()).toBe('Trang 2');
  });

  it('đổi số icon mỗi trang giữ icon đầu trang trong trang mới, và nhớ cho lần sau', () => {
    const { unmount } = render(<IconLibraryPage />);
    goTo(3); // icon thứ 49 trở đi
    fireEvent.click(screen.getByRole('button', { name: '48 icon mỗi trang' }));
    expect(tiles()).toHaveLength(TOTAL - 48);
    expect(currentPage()).toBe('Trang 2');
    expect(screen.getByRole('button', { name: '48 icon mỗi trang' }).getAttribute('aria-pressed')).toBe('true');
    unmount();

    sessionStorage.clear();
    render(<IconLibraryPage />);
    expect(tiles()).toHaveLength(48);
    expect(screen.getByRole('button', { name: '48 icon mỗi trang' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ít icon hơn một trang cỡ nhỏ nhất thì không hiện thanh phân trang', () => {
    // Icon mẫu luôn có mặt trong thư viện, nên đây là số icon tối thiểu.
    seed([]);
    render(<IconLibraryPage />);
    expect(tiles()).toHaveLength(presets.length);
    expect(screen.queryByTestId('pager-bar')).toBeNull();
  });

  it('dạng danh sách cũng phân trang', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Dạng danh sách' }));
    expect(screen.queryAllByTestId('icon-row')).toHaveLength(24);
    goTo(2);
    expect(screen.queryAllByTestId('icon-row')).toHaveLength(24);
    expect(summary()).toContain(`25–48 / ${TOTAL} icon`);
  });
});

describe('IconLibraryPage: ghi nhớ chỗ đang xem', () => {
  it('quay lại trang (như từ trình thiết kế về) vẫn đúng trang và từ khoá đã gõ', () => {
    const first = render(<IconLibraryPage />);
    goTo(2);
    fireEvent.change(search(), { target: { value: 'icon' } });
    goTo(2);
    first.unmount();

    render(<IconLibraryPage />);
    expect((search() as HTMLInputElement).value).toBe('icon');
    expect(currentPage()).toBe('Trang 2');
    expect(tileNames()[0]).toBe('Icon 36');
  });

  it('mỗi tổ hợp bộ lọc nhớ trang riêng: đổi bộ lọc về trang 1, bỏ bộ lọc thì về đúng trang cũ', () => {
    render(<IconLibraryPage />);
    goTo(3);
    fireEvent.change(search(), { target: { value: 'icon 5' } });
    expect(currentPage()).toBe('Trang 1');

    fireEvent.change(search(), { target: { value: '' } });
    expect(currentPage()).toBe('Trang 3');
    expect(summary()).toContain(`49–${TOTAL} / ${TOTAL} icon`);
  });

  it('lưu vào sessionStorage; dữ liệu hỏng thì bỏ qua, trang vẫn dùng được', () => {
    render(<IconLibraryPage />);
    goTo(2);
    const saved = JSON.parse(window.sessionStorage.getItem(MEMORY_KEY) ?? '{}') as { pages?: Record<string, number> };
    expect(Object.values(saved.pages ?? {})).toEqual([2]);

    cleanupAndBreakMemory();
    render(<IconLibraryPage />);
    expect(tiles()).toHaveLength(24);
    expect(currentPage()).toBe('Trang 1');
  });

  it('xoá bớt icon khiến trang đang xem vượt cuối thì về trang cuối, không ra trang trống', () => {
    const { unmount } = render(<IconLibraryPage />);
    goTo(3);
    unmount();

    seed([...presets, ...extras.slice(0, 20)]);
    render(<IconLibraryPage />);
    expect(tiles().length).toBeGreaterThan(0);
    expect(currentPage()).toBe('Trang 2');
  });
});

describe('IconLibraryPage: chọn qua nhiều trang', () => {
  it('ô tick đầu khối chọn trang đang xem; lựa chọn giữ nguyên khi sang trang khác', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả icon đang hiện' }));
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 24');

    goTo(2);
    expect(screen.getByTestId('bulk-bar').textContent).toContain('Đã chọn 24');
    expect((screen.getByRole('checkbox', { name: 'Chọn tất cả icon đang hiện' }) as HTMLInputElement).checked).toBe(false);
  });

  it('nút "Chọn cả N icon" chọn toàn bộ danh sách đã lọc, kể cả các trang chưa xem', () => {
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả icon đang hiện' }));
    fireEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: `Chọn cả ${TOTAL} icon` }));
    expect(screen.getByTestId('bulk-bar').textContent).toContain(`Đã chọn ${TOTAL}`);
    expect(within(screen.getByTestId('bulk-bar')).queryByRole('button', { name: /^Chọn cả/ })).toBeNull();
  });

  it('chỉ có một trang thì không có nút "Chọn cả N icon"', () => {
    seed([]);
    render(<IconLibraryPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả icon đang hiện' }));
    expect(within(screen.getByTestId('bulk-bar')).queryByRole('button', { name: /^Chọn cả/ })).toBeNull();
  });
});

function cleanupAndBreakMemory() {
  document.body.innerHTML = '';
  window.sessionStorage.setItem(MEMORY_KEY, '{không phải json');
}
