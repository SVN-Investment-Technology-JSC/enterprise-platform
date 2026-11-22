import type { WorkItemStatusHistoryEntry } from '@enterprise-platform/contracts-workspace';
import { mergeFieldEdits } from './activity-merge';

const edit = (
  id: string,
  at: string,
  changes: WorkItemStatusHistoryEntry['changes'],
  by = 'u1',
): WorkItemStatusHistoryEntry => ({ id, workItemId: 'w1', createdBy: by, createdAt: at, changes });

describe('mergeFieldEdits', () => {
  it('gộp các lần sửa cùng người cùng phút: giữ từ của lần đầu, đến của lần cuối', () => {
    const merged = mergeFieldEdits([
      edit('c', '2026-11-22T03:54:40Z', [{ field: 'manualProgressPercent', from: 50, to: 33 }]),
      edit('b', '2026-11-22T03:54:20Z', [
        { field: 'progressMethod', from: 'manual', to: 'checklist' },
        { field: 'manualProgressPercent', from: 0, to: 50 },
      ]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('c');
    expect(merged[0]?.changes).toEqual([
      { field: 'progressMethod', from: 'manual', to: 'checklist' },
      { field: 'manualProgressPercent', from: 0, to: 33 },
    ]);
  });

  it('bỏ trường kết thúc đúng như lúc bắt đầu, và bỏ cả dòng nếu không còn gì', () => {
    const merged = mergeFieldEdits([
      edit('b', '2026-11-22T03:54:40Z', [{ field: 'progressPercent', from: 50, to: 0 }]),
      edit('a', '2026-11-22T03:54:10Z', [{ field: 'progressPercent', from: 0, to: 50 }]),
    ]);
    expect(merged).toEqual([]);
  });

  it('không gộp khi khác người, khác phút, hoặc có dòng đổi trạng thái chen giữa', () => {
    const status: WorkItemStatusHistoryEntry = {
      id: 's',
      workItemId: 'w1',
      toStatus: 'done',
      createdBy: 'u1',
      createdAt: '2026-11-22T03:54:30Z',
    };
    const merged = mergeFieldEdits([
      edit('d', '2026-11-22T03:55:05Z', [{ field: 'title', from: 'A', to: 'B' }]),
      edit('c', '2026-11-22T03:54:50Z', [{ field: 'title', from: 'Z', to: 'A' }], 'u2'),
      edit('b2', '2026-11-22T03:54:45Z', [{ field: 'title', from: 'Y', to: 'Z' }], 'u2'),
      status,
      edit('a', '2026-11-22T03:54:10Z', [{ field: 'title', from: 'X', to: 'Y' }]),
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(['d', 'c', 's', 'a']);
    expect(merged[1]?.changes).toEqual([{ field: 'title', from: 'Y', to: 'A' }]);
  });
});
