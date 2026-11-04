import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { TabWork } from '@enterprise-platform/feature-workspace';

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  listSavedFilters: jest.fn(async () => ({ items: [] })),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-directory', () => ({
  useDirectory: () => ({ nameOf: (userId: string) => userId }),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-tags', () => ({
  useTags: () => ({ tags: [], find: () => undefined }),
  tagColor: () => '#64748b',
}));

const makeItems = (count: number): WorkItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    code: `CV-${index + 1}`,
    title: `Gốc ${index + 1}`,
    sortOrder: index + 1,
    depth: 0,
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
  })) as unknown as WorkItem[];

let counter = 0;
/** Mỗi ca dùng dự án và người dùng riêng để trạng thái Redux (sống suốt phiên) không lẫn giữa các ca. */
const fresh = (prefix: string) => {
  counter += 1;
  return { projectId: `${prefix}-p${counter}`, userId: `${prefix}-u${counter}` };
};
const view = (projectId: string, userId: string, items: WorkItem[]) => (
  <TabWork
    projectId={projectId}
    items={items}
    dependencies={[]}
    externalRefs={[]}
    pendingProcedure={new Map()}
    canWrite={false}
    currentUserId={userId}
    onOpen={jest.fn()}
    onAddRoot={jest.fn()}
    onMenu={jest.fn()}
    onChangeStatus={jest.fn(async () => undefined)}
  />
);

const bodyRows = () => [...document.querySelectorAll('table tbody tr')] as HTMLElement[];
const headers = () => [...document.querySelectorAll('table thead th')].map((th) => th.textContent);
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /Cột/ }));
const storageKey = (userId: string) => `workspace:work-table:hidden-columns:${userId}`;

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Bảng công việc: người dùng chọn cột hiển thị', () => {
  it('mặc định đủ 9 cột; bỏ chọn cột thì cột đó biến mất cả ở tiêu đề lẫn từng dòng; cột Công việc không bỏ được', async () => {
    const { projectId, userId } = fresh('mac-dinh');
    render(view(projectId, userId, makeItems(4)));
    await waitFor(() => expect(bodyRows()).toHaveLength(4));
    expect(headers()).toHaveLength(9);
    openPicker();
    fireEvent.click(screen.getByLabelText('Tiến độ'));
    fireEvent.click(screen.getByLabelText('Quy trình'));
    expect(headers()).toEqual([
      'Công việc',
      'Người thực hiện',
      'Ưu tiên',
      'Trạng thái',
      'Bắt đầu',
      'Thời hạn',
      'Trạng thái cuối',
    ]);
    expect(bodyRows()[0].querySelectorAll('td')).toHaveLength(7);
    expect((screen.getByLabelText('Công việc') as HTMLInputElement).disabled).toBe(true);
  });

  it('lưu theo người dùng và áp cho mọi dự án; người dùng khác vẫn thấy mặc định', async () => {
    const { projectId, userId } = fresh('luu');
    const items = makeItems(3);
    const first = render(view(projectId, userId, items));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    openPicker();
    fireEvent.click(screen.getByLabelText('Người thực hiện'));
    fireEvent.click(screen.getByLabelText('Bắt đầu'));
    expect(headers()).toHaveLength(7);
    expect(JSON.parse(window.localStorage.getItem(storageKey(userId)) as string)).toEqual(['people', 'start']);
    first.unmount();
    // Dự án khác, cùng người dùng: giữ nguyên lựa chọn.
    render(view('du-an-khac', userId, items));
    await waitFor(() => expect(headers()).toHaveLength(7));
    expect(headers()).not.toContain('Người thực hiện');
    cleanup();
    // Người dùng khác: mặc định.
    render(view(projectId, `${userId}-khac`, items));
    await waitFor(() => expect(headers()).toHaveLength(9));
  });

  it('nạp lại từ localStorage khi mở lại trang (sau khi tải lại, Redux trống)', async () => {
    const { projectId, userId } = fresh('nap');
    window.localStorage.setItem(storageKey(userId), JSON.stringify(['progress', 'process', 'khong-ton-tai']));
    render(view(projectId, userId, makeItems(2)));
    await waitFor(() => expect(headers()).toHaveLength(7));
    expect(headers()).not.toContain('Tiến độ');
    expect(headers()).not.toContain('Quy trình');
  });

  it('dữ liệu lưu hỏng thì bỏ qua và dùng mặc định, không làm hỏng bảng', async () => {
    const { projectId, userId } = fresh('hong');
    window.localStorage.setItem(storageKey(userId), '{không phải JSON');
    render(view(projectId, userId, makeItems(2)));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(headers()).toHaveLength(9);
  });

  it('đã tuỳ chỉnh thì hiện đúng các cột đã chọn với bề rộng tối thiểu theo cột; đặt lại về mặc định', async () => {
    const { projectId, userId } = fresh('dat-lai');
    render(view(projectId, userId, makeItems(3)));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const table = () => document.querySelector('table') as HTMLElement;
    expect(table().style.minWidth).toBe('');
    openPicker();
    expect((screen.getByRole('button', { name: 'Đặt lại mặc định' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Tiến độ'));
    // 220 (cột Công việc) + 150 + 104 + 108 + 84 + 84 + 124 + 130 = 1004, không còn cột Tiến độ.
    expect(table().style.minWidth).toBe('1004px');
    expect(table().className).toMatch(/wbsTableCustom/);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }));
    await waitFor(() => expect(headers()).toHaveLength(9));
    expect(table().style.minWidth).toBe('');
    expect(table().className).not.toMatch(/wbsTableCustom/);
    expect(window.localStorage.getItem(storageKey(userId))).toBeNull();
  });

  it('bảng chọn cột đóng khi bấm ra ngoài hoặc nhấn Esc', async () => {
    const { projectId, userId } = fresh('dong');
    render(view(projectId, userId, makeItems(2)));
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    openPicker();
    expect(screen.getByRole('dialog', { name: 'Cột hiển thị' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Cột hiển thị' })).toBeNull();
    openPicker();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Cột hiển thị' })).toBeNull();
  });

  it('khi bảng rỗng, ô thông báo trải đúng số cột đang hiện', async () => {
    const { projectId, userId } = fresh('rong');
    render(view(projectId, userId, []));
    await waitFor(() => expect(screen.getByText('Dự án chưa có công việc nào.')).toBeTruthy());
    expect(screen.getByText('Dự án chưa có công việc nào.').getAttribute('colspan')).toBe('9');
    openPicker();
    fireEvent.click(screen.getByLabelText('Tiến độ'));
    fireEvent.click(screen.getByLabelText('Quy trình'));
    expect(screen.getByText('Dự án chưa có công việc nào.').getAttribute('colspan')).toBe('7');
  });
});
