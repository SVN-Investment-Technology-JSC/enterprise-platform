import type { WorkItem, WorkItemDependency } from '@enterprise-platform/contracts-workspace';
import { ROW_HEIGHT, buildGanttLayout, dayWidthOf } from './gantt.model';

function item(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    projectId: 'p1',
    code: overrides.id.toUpperCase(),
    title: `Việc ${overrides.id}`,
    itemType: 'task',
    executionType: 'manual',
    status: 'todo',
    priority: 'normal',
    progressPercent: 0,
    sortOrder: 0,
    depth: 0,
    createdBy: 'u1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const rowsOf = (items: WorkItem[]) => items.map((entry) => ({ item: entry, depth: 0 }));
const TODAY = new Date(2026, 8, 21);
const DAY = dayWidthOf('day');

describe('buildGanttLayout — thanh công việc', () => {
  it('việc một ngày vẫn chiếm trọn một ô ngày', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', plannedStart: '2026-09-21', plannedEnd: '2026-09-21' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.bar?.width).toBe(DAY);
  });

  it('bề rộng thanh tính cả ngày kết thúc', () => {
    // 21 đến 25 là năm ngày, không phải bốn.
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', plannedStart: '2026-09-21', plannedEnd: '2026-09-25' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.bar?.width).toBe(5 * DAY);
  });

  it('khung chừa hai ngày lề nên thanh không dính mép trái', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', plannedStart: '2026-09-21', plannedEnd: '2026-09-25' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.bar?.x).toBe(2 * DAY);
  });

  it('phần tiến độ tỉ lệ đúng với bề rộng thanh', () => {
    const layout = buildGanttLayout(
      rowsOf([
        item({
          id: 'a',
          plannedStart: '2026-09-21',
          plannedEnd: '2026-09-24',
          progressPercent: 50,
        }),
      ]),
      [],
      'day',
      TODAY,
    );
    const bar = layout.rows[0]?.bar;
    expect(bar?.progressWidth).toBe((bar?.width ?? 0) / 2);
  });

  it('việc thiếu mốc kế hoạch thì không có thanh', () => {
    const layout = buildGanttLayout(rowsOf([item({ id: 'a' })]), [], 'day', TODAY);
    expect(layout.rows[0]?.bar).toBeUndefined();
    expect(layout.rows[0]?.milestoneX).toBeUndefined();
  });

  it('mỗi dòng cách nhau đúng một hàng', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows.map((row) => row.y)).toEqual([0, ROW_HEIGHT, 2 * ROW_HEIGHT]);
    expect(layout.height).toBe(3 * ROW_HEIGHT);
  });
});

describe('buildGanttLayout — cột mốc và quá hạn', () => {
  it('cột mốc là một điểm, không phải thanh', () => {
    const layout = buildGanttLayout(
      rowsOf([
        item({
          id: 'm',
          itemType: 'milestone',
          plannedStart: '2026-09-21',
          plannedEnd: '2026-09-25',
        }),
      ]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.bar).toBeUndefined();
    expect(layout.rows[0]?.milestoneX).toBeGreaterThan(0);
  });

  it('việc đang mở quá hạn bị đánh dấu', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', status: 'in_progress', plannedEnd: '2026-09-20' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.overdue).toBe(true);
  });

  it('việc đóng muộn KHÔNG tính là quá hạn', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', status: 'done', plannedEnd: '2026-09-01' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.overdue).toBe(false);
  });

  it('hạn đúng hôm nay thì chưa quá hạn', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', plannedEnd: '2026-09-21' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.rows[0]?.overdue).toBe(false);
  });
});

describe('buildGanttLayout — trục thời gian', () => {
  const span = [item({ id: 'a', plannedStart: '2026-09-01', plannedEnd: '2026-11-30' })];

  it('mức ngày đánh dấu từng ngày, in đậm thứ Hai', () => {
    const layout = buildGanttLayout(rowsOf(span), [], 'day', TODAY);
    // Khung bắt đầu 30/08/2026 (01/09 lùi hai ngày); 31/08 là thứ Hai.
    expect(layout.ticks[0]).toMatchObject({ label: '30', major: false });
    expect(layout.ticks[1]).toMatchObject({ label: '31', major: true });
  });

  it('mức tuần chỉ đánh dấu thứ Hai', () => {
    const layout = buildGanttLayout(rowsOf(span), [], 'week', TODAY);
    expect(layout.ticks[0]?.label).toBe('31/8');
    expect(layout.ticks[1]?.label).toBe('7/9');
  });

  it('mức tháng chỉ đánh dấu đầu tháng', () => {
    // Khung chạy 30/08 → 02/12 (đã cộng hai ngày lề), nên có bốn mốc đầu tháng.
    const layout = buildGanttLayout(rowsOf(span), [], 'month', TODAY);
    expect(layout.ticks.map((tick) => tick.label)).toEqual([
      '9/2026',
      '10/2026',
      '11/2026',
      '12/2026',
    ]);
  });

  it('vạch hôm nay rỗng khi hôm nay nằm ngoài khung', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a', plannedStart: '2020-01-01', plannedEnd: '2020-01-05' })]),
      [],
      'day',
      TODAY,
    );
    expect(layout.todayX).toBeUndefined();
  });

  it('dự án chưa có mốc nào vẫn dựng được trục', () => {
    const layout = buildGanttLayout(rowsOf([item({ id: 'a' })]), [], 'day', TODAY);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.todayX).toBeDefined();
  });
});

describe('buildGanttLayout — đường phụ thuộc', () => {
  const pair = [
    item({ id: 'a', plannedStart: '2026-09-21', plannedEnd: '2026-09-23' }),
    item({ id: 'b', plannedStart: '2026-09-25', plannedEnd: '2026-09-27' }),
  ];

  const dependency = (overrides: Partial<WorkItemDependency>): WorkItemDependency => ({
    id: 'd1',
    projectId: 'p1',
    predecessorId: 'a',
    successorId: 'b',
    dependencyType: 'FS',
    lagDays: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });

  it('chỉ loại FS được vẽ đậm', () => {
    const layout = buildGanttLayout(rowsOf(pair), [dependency({}), dependency({ id: 'd2', dependencyType: 'SS' })], 'day', TODAY);
    expect(layout.edges.map((edge) => edge.strong)).toEqual([true, false]);
  });

  it('đường gấp khúc vuông góc, không nối chéo', () => {
    const layout = buildGanttLayout(rowsOf(pair), [dependency({})], 'day', TODAY);
    // Bốn điểm: ra khỏi thanh trước, rẽ ngang, đổi hàng, vào thanh sau.
    expect(layout.edges[0]?.path.split('L')).toHaveLength(4);
  });

  it('bỏ qua cạnh có đầu thiếu mốc kế hoạch', () => {
    const layout = buildGanttLayout(
      rowsOf([item({ id: 'a' }), pair[1] as WorkItem]),
      [dependency({})],
      'day',
      TODAY,
    );
    expect(layout.edges).toEqual([]);
  });

  it('bỏ qua cạnh trỏ tới công việc không có trên biểu đồ', () => {
    const layout = buildGanttLayout(
      rowsOf(pair),
      [dependency({ successorId: 'khong-co' })],
      'day',
      TODAY,
    );
    expect(layout.edges).toEqual([]);
  });

  it('cạnh nối hai cột mốc cũng vẽ được', () => {
    const layout = buildGanttLayout(
      rowsOf([
        item({ id: 'a', itemType: 'milestone', plannedEnd: '2026-09-21' }),
        item({ id: 'b', itemType: 'milestone', plannedEnd: '2026-09-25' }),
      ]),
      [dependency({})],
      'day',
      TODAY,
    );
    expect(layout.edges).toHaveLength(1);
  });
});

describe('dayWidthOf', () => {
  it('thu nhỏ dần từ ngày tới tháng', () => {
    expect(dayWidthOf('day')).toBeGreaterThan(dayWidthOf('week'));
    expect(dayWidthOf('week')).toBeGreaterThan(dayWidthOf('month'));
  });
});
