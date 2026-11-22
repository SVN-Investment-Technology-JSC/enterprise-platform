import type { WorkItemChecklistItem } from '@enterprise-platform/contracts-workspace';
import {
  applyAppend,
  applyDone,
  applyRemove,
  applyReplace,
  applyRestore,
  applyTitle,
  createSerialQueue,
  isTempChecklistId,
  makeTempChecklistItem,
  removeTempItems,
  focusIdAfterRemove,
  shouldAcceptServerList,
  shouldReloadAfterWrite,
} from './checklist-writes';

const row = (id: string, patch: Partial<WorkItemChecklistItem> = {}): WorkItemChecklistItem => ({
  id,
  workItemId: 'w',
  title: `Việc ${id}`,
  done: false,
  sortOrder: 0,
  ...patch,
});

describe('createSerialQueue', () => {
  it('chạy tuần tự đúng thứ tự gọi, không chồng nhau', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const results = await Promise.all([queue(task('a', 30)), queue(task('b', 5)), queue(task('c', 1))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('một tác vụ lỗi không chặn các tác vụ sau và chỉ báo lỗi cho người gọi nó', async () => {
    const queue = createSerialQueue();
    const failing = queue(() => Promise.reject(new Error('hỏng')));
    const next = queue(async () => 'ok');
    await expect(failing).rejects.toThrow('hỏng');
    await expect(next).resolves.toBe('ok');
  });
});

describe('thao tác lạc quan', () => {
  it('tích rồi bỏ tích: ghi người tích tạm, bỏ tích thì xoá', () => {
    const list = [row('a'), row('b')];
    const ticked = applyDone(list, 'a', true, 'u1', '2026-11-22T00:00:00Z');
    expect(ticked[0]).toMatchObject({ done: true, doneBy: 'u1', doneAt: '2026-11-22T00:00:00Z' });
    expect(ticked[1]).toBe(list[1]);
    const cleared = applyDone(ticked, 'a', false);
    expect(cleared[0].done).toBe(false);
    expect(cleared[0]).not.toHaveProperty('doneBy');
  });

  it('đổi tên, xoá, thêm và khôi phục đúng vị trí', () => {
    const list = [row('a'), row('b'), row('c')];
    expect(applyTitle(list, 'b', 'Mới')[1].title).toBe('Mới');
    const removed = applyRemove(list, 'b');
    expect(removed.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(applyRestore(removed, list[1], 1).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(applyRestore(list, list[1], 0)).toBe(list);
    expect(applyAppend(list, [row('d')]).map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyReplace(list, row('a', { title: 'Cũ' }))[0].title).toBe('Cũ');
  });

  it('đầu việc tạm nhận ra được và gỡ được khi thêm lỗi', () => {
    const temp = [makeTempChecklistItem('w', 'X', 1), makeTempChecklistItem('w', 'Y', 2)];
    expect(temp.every((entry) => isTempChecklistId(entry.id))).toBe(true);
    expect(isTempChecklistId('abc')).toBe(false);
    const list = applyAppend([row('a')], temp);
    expect(removeTempItems(list, temp.map((entry) => entry.id)).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('shouldAcceptServerList', () => {
  it('chỉ nhận phản hồi của yêu cầu ghi cuối cùng', () => {
    expect(shouldAcceptServerList(1)).toBe(true);
    expect(shouldAcceptServerList(0)).toBe(true);
    expect(shouldAcceptServerList(2)).toBe(false);
  });
});

describe('shouldReloadAfterWrite', () => {
  it('chỉ nạp lại khi không còn yêu cầu ghi nào chờ', () => {
    expect(shouldReloadAfterWrite(0)).toBe(true);
    expect(shouldReloadAfterWrite(2)).toBe(false);
  });
});

describe('focusIdAfterRemove', () => {
  const list = (ids: string[]) =>
    ids.map((id, index) => ({ id, workItemId: 'w', title: id, done: false, sortOrder: index }));

  it('ưu tiên dòng liền sau, rồi dòng liền trước', () => {
    expect(focusIdAfterRemove(list(['a', 'b', 'c']), 'b')).toBe('c');
    expect(focusIdAfterRemove(list(['a', 'b', 'c']), 'c')).toBe('b');
  });

  it('hết dòng hoặc không tìm thấy thì undefined', () => {
    expect(focusIdAfterRemove(list(['a']), 'a')).toBeUndefined();
    expect(focusIdAfterRemove(list(['a']), 'x')).toBeUndefined();
  });
});

describe('đầu việc của Công việc khác (khoá taskId)', () => {
  const entries = [
    { id: 'a', taskId: 't', title: 'A', done: false, sortOrder: 1 },
    { id: 'b', taskId: 't', title: 'B', done: true, doneBy: 'u', doneAt: '2026-01-01', sortOrder: 2 },
  ];

  it('applyDone giữ taskId và xoá dấu vết người tích khi bỏ tích', () => {
    const ticked = applyDone(entries, 'a', true, 'me', 'now');
    expect(ticked[0]).toEqual({ id: 'a', taskId: 't', title: 'A', done: true, doneBy: 'me', doneAt: 'now', sortOrder: 1 });
    const cleared = applyDone(entries, 'b', false);
    expect(cleared[1]).toEqual({ id: 'b', taskId: 't', title: 'B', done: false, sortOrder: 2 });
  });
});
