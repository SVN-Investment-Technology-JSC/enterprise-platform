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

/** Việc gốc 1..N; việc gốc số 3 và số 7 có hai việc con (nhóm việc gốc có việc con). */
function makeItems(roots: number): WorkItem[] {
  const items: WorkItem[] = [];
  for (let n = 1; n <= roots; n += 1) {
    items.push({
      id: `r${n}`,
      code: `CV-${n}`,
      title: `Gốc ${n}`,
      sortOrder: n,
      depth: 0,
      status: 'todo',
      priority: 'normal',
      progressPercent: 0,
    } as unknown as WorkItem);
    if (n === 3 || n === 7) {
      for (let child = 1; child <= 2; child += 1) {
        items.push({
          id: `r${n}c${child}`,
          code: `CV-${n}.${child}`,
          title: `Con ${n}.${child}`,
          parentId: `r${n}`,
          sortOrder: child,
          depth: 1,
          status: 'todo',
          priority: 'normal',
          progressPercent: 0,
        } as unknown as WorkItem);
      }
    }
  }
  return items;
}

let counter = 0;
const props = (projectId: string, items: WorkItem[], currentUserId = 'me') => ({
  projectId,
  items,
  dependencies: [],
  externalRefs: [],
  pendingProcedure: new Map(),
  canWrite: false,
  currentUserId,
  onOpen: jest.fn(),
  onAddRoot: jest.fn(),
  onMenu: jest.fn(),
  onChangeStatus: jest.fn(async () => undefined),
});

const bodyRows = () => [...document.querySelectorAll('table tbody tr')] as HTMLElement[];
const codes = () => bodyRows().map((row) => row.querySelector('td')?.textContent?.match(/CV-[\d.]+/)?.[0]);

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

describe('Bảng công việc: phân trang, trạng thái nhớ lại và vạch ngăn việc gốc', () => {
  it('mặc định 10 dòng mỗi trang, có phân trang; qua trang 2 hiện đúng các dòng kế tiếp', async () => {
    const items = makeItems(20);
    render(<TabWork {...props(`wt-${(counter += 1)}`, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(10));
    expect(screen.getByText(/^1–10 \/ 24$/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(screen.getByText(/^11–20 \/ 24$/)).toBeTruthy());
    // Trang 1 gồm CV-1..CV-7.1 (10 dòng, kể cả việc con); trang 2 bắt đầu ở CV-7.2.
    expect(codes()[0]).toBe('CV-7.2');
    expect(bodyRows()).toHaveLength(10);
  });

  it('đổi cỡ trang sang 20 và 50: số dòng đúng và về trang 1', async () => {
    const items = makeItems(40);
    render(<TabWork {...props(`wt-${(counter += 1)}`, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    fireEvent.click(screen.getByPlaceholderText('Chọn số việc mỗi trang…'));
    fireEvent.click(await screen.findByText('20 / trang'));
    await waitFor(() => expect(bodyRows()).toHaveLength(20));
    expect(screen.getByText(/^1–20 \/ 44$/)).toBeTruthy();
    fireEvent.click(screen.getByPlaceholderText('Chọn số việc mỗi trang…'));
    fireEvent.click(await screen.findByText('50 / trang'));
    await waitFor(() => expect(bodyRows()).toHaveLength(44));
  });

  it('trạng thái nhớ trong Redux theo dự án: tắt tab rồi mở lại vẫn đúng trang và cỡ trang; dự án khác không bị ảnh hưởng', async () => {
    const items = makeItems(40);
    const projectId = `wt-${(counter += 1)}`;
    const first = render(<TabWork {...props(projectId, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(10));
    fireEvent.click(screen.getByPlaceholderText('Chọn số việc mỗi trang…'));
    fireEvent.click(await screen.findByText('20 / trang'));
    await waitFor(() => expect(bodyRows()).toHaveLength(20));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(screen.getByText(/^21–40 \/ 44$/)).toBeTruthy());
    first.unmount();
    // Mở lại: vẫn trang 2 của cỡ 20.
    render(<TabWork {...props(projectId, items)} />);
    await waitFor(() => expect(screen.getByText(/^21–40 \/ 44$/)).toBeTruthy());
    expect(bodyRows()).toHaveLength(20);
    cleanup();
    // Dự án khác: bắt đầu từ mặc định.
    render(<TabWork {...props(`wt-${(counter += 1)}`, items)} />);
    await waitFor(() => expect(screen.getByText(/^1–10 \/ 44$/)).toBeTruthy());
  });

  it('đổi bộ lọc thì về trang 1', async () => {
    const items = makeItems(40);
    render(<TabWork {...props(`wt-${(counter += 1)}`, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(10));
    fireEvent.click(screen.getByLabelText('Trang sau'));
    await waitFor(() => expect(screen.getByText(/^11–20 \/ 44$/)).toBeTruthy());
    // Tắt "Hiện việc con": chỉ còn 40 việc gốc, đồng thời về trang 1.
    fireEvent.click(screen.getByLabelText('Hiện việc con'));
    await waitFor(() => expect(screen.getByText(/^1–10 \/ 40$/)).toBeTruthy());
  });

  it('việc gốc mới (trừ dòng đầu bảng) có vạch ngăn đậm; việc con thì không', async () => {
    const items = makeItems(6);
    render(<TabWork {...props(`wt-${(counter += 1)}`, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(8));
    const marked = bodyRows().filter((row) => /wbsRootStart/.test(row.className));
    const roots = bodyRows().filter((row) => /^CV-\d+$/.test(row.querySelector('td')?.textContent?.match(/CV-[\d.]+/)?.[0] ?? ''));
    // Mọi việc gốc trừ việc đầu tiên.
    expect(marked).toHaveLength(roots.length - 1);
    expect(/wbsRootStart/.test(bodyRows()[0].className)).toBe(false);
    const children = bodyRows().filter((row) => /CV-\d+\.\d/.test(row.querySelector('td')?.textContent ?? ''));
    expect(children.length).toBe(2);
    expect(children.every((row) => !/wbsRootStart/.test(row.className))).toBe(true);
  });

  it('thu gọn một nhánh làm bớt dòng và nhớ lại nhánh đang thu gọn', async () => {
    const items = makeItems(6);
    const projectId = `wt-${(counter += 1)}`;
    const first = render(<TabWork {...props(projectId, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(8));
    fireEvent.click(screen.getAllByLabelText('Thu gọn nhánh')[0]);
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    first.unmount();
    render(<TabWork {...props(projectId, items)} />);
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(screen.getAllByLabelText('Mở nhánh').length).toBe(1);
  });
});
