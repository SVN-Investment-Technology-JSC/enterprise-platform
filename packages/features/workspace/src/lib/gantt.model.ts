import type { WorkItem, WorkItemDependency } from '@enterprise-platform/contracts-workspace';

export type GanttZoom = 'day' | 'week' | 'month';

/** Bề rộng một ngày, tính bằng pixel, ở từng mức thu phóng. */
const DAY_WIDTH: Record<GanttZoom, number> = { day: 30, week: 10, month: 3.4 };

export const ROW_HEIGHT = 28;
export const BAR_HEIGHT = 14;
/** Chừa lề hai bên để thanh đầu và thanh cuối không dính mép khung. */
const PADDING_DAYS = 2;
const MS_PER_DAY = 86_400_000;

/** Một dòng trên biểu đồ; thứ tự đúng bằng thứ tự cây bên trái. */
export interface GanttRow {
  readonly item: WorkItem;
  readonly depth: number;
  readonly y: number;
  /** Rỗng khi công việc chưa có cả hai mốc kế hoạch. */
  readonly bar?: {
    readonly x: number;
    readonly width: number;
    /** Bề rộng phần đã hoàn thành, luôn nằm trong `width`. */
    readonly progressWidth: number;
  };
  /** Cột mốc vẽ hình thoi tại một điểm, không phải thanh. */
  readonly milestoneX?: number;
  readonly overdue: boolean;
}

/** Một vạch trên trục thời gian. */
export interface GanttTick {
  readonly x: number;
  readonly label: string;
  /** Vạch đầu một đơn vị lớn hơn — kẻ đậm hơn. */
  readonly major: boolean;
}

export interface GanttEdge {
  readonly id: string;
  /** Đường gấp khúc dạng `M … L …`. */
  readonly path: string;
  /** Chỉ `FS` chặn cứng việc hoàn thành, nên chỉ nó vẽ mũi tên đậm. */
  readonly strong: boolean;
  readonly label: string;
}

export interface GanttLayout {
  readonly rows: readonly GanttRow[];
  readonly ticks: readonly GanttTick[];
  readonly edges: readonly GanttEdge[];
  readonly width: number;
  readonly height: number;
  /** Vị trí vạch hôm nay; rỗng khi hôm nay nằm ngoài khung thời gian. */
  readonly todayX?: number;
  readonly start: Date;
  readonly end: Date;
}

/** `2026-09-21` → mốc 00:00 giờ trình duyệt, không phải UTC. */
function parseDay(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/**
 * Khoảng thời gian bao trọn mọi mốc kế hoạch.
 *
 * Việc chưa có mốc nào không kéo dài khung: chúng không vẽ thanh, nên đưa vào
 * chỉ làm biểu đồ rộng ra vô ích.
 */
function boundsOf(items: readonly WorkItem[]): { start: Date; end: Date } {
  const dates: Date[] = [];
  for (const item of items) {
    if (item.plannedStart) dates.push(parseDay(item.plannedStart));
    if (item.plannedEnd) dates.push(parseDay(item.plannedEnd));
  }
  // Không có mốc nào thì lấy tuần quanh hôm nay, để trục vẫn vẽ được.
  if (dates.length === 0) {
    const today = startOfDay(new Date());
    return {
      start: new Date(today.getTime() - 3 * MS_PER_DAY),
      end: new Date(today.getTime() + 3 * MS_PER_DAY),
    };
  }

  let min = dates[0] as Date;
  let max = dates[0] as Date;
  for (const date of dates) {
    if (date.getTime() < min.getTime()) min = date;
    if (date.getTime() > max.getTime()) max = date;
  }
  return {
    start: new Date(min.getTime() - PADDING_DAYS * MS_PER_DAY),
    end: new Date(max.getTime() + PADDING_DAYS * MS_PER_DAY),
  };
}

/**
 * Tính toàn bộ hình học của biểu đồ.
 *
 * Tách khỏi phần vẽ để kiểm được bằng unit test: toạ độ là thứ dễ sai và khó
 * nhìn ra bằng mắt trên một tấm SVG.
 *
 * `rows` phải đã theo đúng thứ tự cây — hàm này không tự sắp xếp, vì Gantt
 * cần trùng khít với cây bên trái.
 */
export function buildGanttLayout(
  rows: readonly { item: WorkItem; depth: number }[],
  dependencies: readonly WorkItemDependency[],
  zoom: GanttZoom,
  today: Date = new Date(),
): GanttLayout {
  const items = rows.map((row) => row.item);
  const { start, end } = boundsOf(items);
  const dayWidth = DAY_WIDTH[zoom];
  const totalDays = Math.max(daysBetween(start, end) + 1, 1);
  const width = totalDays * dayWidth;

  const xOf = (date: Date) => daysBetween(start, date) * dayWidth;
  const todayOffset = daysBetween(start, today);
  const todayX =
    todayOffset >= 0 && todayOffset < totalDays ? todayOffset * dayWidth : undefined;

  const todayKey = [
    String(today.getFullYear()).padStart(4, '0'),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const laidOut: GanttRow[] = rows.map((row, index) => {
    const y = index * ROW_HEIGHT;
    const item = row.item;
    const overdue =
      item.status !== 'done' &&
      item.status !== 'cancelled' &&
      Boolean(item.plannedEnd) &&
      (item.plannedEnd as string).slice(0, 10) < todayKey;

    if (item.itemType === 'milestone') {
      const at = item.plannedEnd ?? item.plannedStart;
      return {
        item,
        depth: row.depth,
        y,
        milestoneX: at ? xOf(parseDay(at)) : undefined,
        overdue,
      };
    }

    if (!item.plannedStart || !item.plannedEnd) {
      return { item, depth: row.depth, y, overdue };
    }

    const from = parseDay(item.plannedStart);
    const to = parseDay(item.plannedEnd);
    // Cộng một ngày: việc bắt đầu và kết thúc cùng ngày vẫn chiếm trọn ô
    // ngày đó, nếu không thanh sẽ rộng 0 và biến mất.
    const barWidth = Math.max((daysBetween(from, to) + 1) * dayWidth, dayWidth);
    return {
      item,
      depth: row.depth,
      y,
      bar: {
        x: xOf(from),
        width: barWidth,
        progressWidth: (barWidth * Math.min(Math.max(item.progressPercent, 0), 100)) / 100,
      },
      overdue,
    };
  });

  return {
    rows: laidOut,
    ticks: buildTicks(start, totalDays, dayWidth, zoom),
    edges: buildEdges(laidOut, dependencies, dayWidth),
    width,
    height: Math.max(laidOut.length * ROW_HEIGHT, ROW_HEIGHT),
    todayX,
    start,
    end,
  };
}

/**
 * Vạch trục thời gian.
 *
 * Mức `day` đánh dấu từng ngày và in đậm thứ Hai; mức `week` đánh dấu mỗi thứ
 * Hai và in đậm ngày mùng 1; mức `month` chỉ đánh dấu đầu tháng. Nhãn dày hơn
 * thế sẽ chồng lên nhau ở mức thu nhỏ.
 */
function buildTicks(
  start: Date,
  totalDays: number,
  dayWidth: number,
  zoom: GanttZoom,
): GanttTick[] {
  const ticks: GanttTick[] = [];
  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const isMonday = date.getDay() === 1;
    const isFirstOfMonth = date.getDate() === 1;

    if (zoom === 'day') {
      ticks.push({
        x: offset * dayWidth,
        label: `${date.getDate()}`,
        major: isMonday,
      });
    } else if (zoom === 'week' && isMonday) {
      ticks.push({
        x: offset * dayWidth,
        label: `${date.getDate()}/${date.getMonth() + 1}`,
        major: isFirstOfMonth,
      });
    } else if (zoom === 'month' && isFirstOfMonth) {
      ticks.push({
        x: offset * dayWidth,
        label: `${date.getMonth() + 1}/${date.getFullYear()}`,
        major: true,
      });
    }
  }
  return ticks;
}

const DEPENDENCY_LABELS: Record<string, string> = {
  FS: 'Xong rồi mới bắt đầu',
  SS: 'Bắt đầu cùng lúc',
  FF: 'Kết thúc cùng lúc',
  SF: 'Bắt đầu rồi mới kết thúc',
};

/**
 * Đường nối phụ thuộc, vẽ dạng gấp khúc vuông góc.
 *
 * Đi vòng qua **bên dưới** hàng của công việc tiền nhiệm thay vì nối thẳng
 * hai điểm: đường chéo cắt ngang các thanh khác và rất khó lần theo khi có
 * nhiều phụ thuộc.
 *
 * Cạnh nào có đầu thiếu mốc kế hoạch thì bỏ qua — không có toạ độ để nối.
 */
function buildEdges(
  rows: readonly GanttRow[],
  dependencies: readonly WorkItemDependency[],
  dayWidth: number,
): GanttEdge[] {
  const byId = new Map(rows.map((row) => [row.item.id, row]));
  const edges: GanttEdge[] = [];
  const gap = Math.max(dayWidth / 2, 6);

  for (const dependency of dependencies) {
    const from = byId.get(dependency.predecessorId);
    const to = byId.get(dependency.successorId);
    if (!from || !to) continue;

    const fromX = anchorRight(from);
    const toX = anchorLeft(to);
    if (fromX === undefined || toX === undefined) continue;

    const fromY = from.y + ROW_HEIGHT / 2;
    const toY = to.y + ROW_HEIGHT / 2;
    // Điểm rẽ nằm giữa hai thanh khi còn chỗ; hết chỗ thì lùi ra sau thanh
    // đích để mũi tên vẫn chỉ vào đúng cạnh trái của nó.
    const turnX = toX - fromX > gap * 2 ? fromX + gap : Math.min(fromX + gap, toX - gap);

    edges.push({
      id: dependency.id,
      path: [
        `M ${round(fromX)} ${round(fromY)}`,
        `L ${round(turnX)} ${round(fromY)}`,
        `L ${round(turnX)} ${round(toY)}`,
        `L ${round(toX)} ${round(toY)}`,
      ].join(' '),
      strong: dependency.dependencyType === 'FS',
      label: DEPENDENCY_LABELS[dependency.dependencyType] ?? dependency.dependencyType,
    });
  }
  return edges;
}

function anchorRight(row: GanttRow): number | undefined {
  if (row.milestoneX !== undefined) return row.milestoneX;
  return row.bar ? row.bar.x + row.bar.width : undefined;
}

function anchorLeft(row: GanttRow): number | undefined {
  if (row.milestoneX !== undefined) return row.milestoneX;
  return row.bar?.x;
}

/** Làm tròn tới 0,1px: chuỗi path ngắn hơn và không đổi hình. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Bề rộng một ngày ở mức thu phóng đang chọn; dùng để giữ vị trí cuộn. */
export function dayWidthOf(zoom: GanttZoom): number {
  return DAY_WIDTH[zoom];
}
