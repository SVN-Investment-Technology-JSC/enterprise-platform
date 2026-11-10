'use client';

import type { DashboardCardCatalog, DashboardCardSize } from '@enterprise-platform/feature-module-shell';
import type {
  MaintenanceMatrix,
  MaintenanceOccurrence,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
  MaintenanceWorkspace,
} from '@enterprise-platform/contracts-maintenance';
import { formatDate } from '@enterprise-platform/shared-ui';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, ListChecks, RotateCcw, TriangleAlert, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { cn } from './utils';

/** Việc mà thẻ Tổng quan có thể làm thay người dùng; do màn hình chính cung cấp. */
export interface MaintenanceDashboardActions {
  /** Mở chi tiết một phiếu trong màn Lịch sử. */
  readonly openOccurrence: (id: string) => void;
  /** Mở màn Phiếu phát sinh, tuỳ chọn lọc sẵn theo loại. */
  readonly openOccurrences: (kind?: MaintenanceOccurrenceKind) => void;
  /** Mở Lịch sử đã lọc theo trạng thái. */
  readonly openHistoryByStatus: (status: MaintenanceOccurrenceStatus) => void;
  /** Gửi lại phiếu báo lỗi sang Quy trình; ném lỗi nếu không gửi được. */
  readonly retryDispatch: (id: string) => Promise<void>;
  /** Đóng phiếu kèm ghi chú; ném lỗi nếu không đóng được. */
  readonly completeOccurrence: (id: string, note: string) => Promise<void>;
}

/**
 * Dữ liệu chung cho mọi thẻ.
 *
 * Một object cho tất cả, cố ý: module nạp một lần rồi mọi thẻ đọc từ đó, nhờ vậy
 * package module-shell không chứa dòng gọi mạng nào và bật thêm thẻ không sinh
 * thêm request.
 */
export interface MaintenanceDashboardData {
  readonly workspace: MaintenanceWorkspace;
  readonly matrix?: MaintenanceMatrix;
  /** Người dùng có quyền xử lý phiếu (đóng phiếu ngay trên thẻ). */
  readonly canHandle: boolean;
  readonly actions: MaintenanceDashboardActions;
}

// ---------------------------------------------------------------- Phiếu: nhóm trạng thái dùng chung

const STATUS_LABEL: Readonly<Record<MaintenanceOccurrenceStatus, string>> = {
  planned: 'Đã lên lịch',
  in_progress: 'Đang xử lý',
  dispatch_pending: 'Chờ tạo phiếu',
  generated: 'Đã tạo phiếu',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  blocked: 'Bị chặn',
};

/** Màu thanh theo trạng thái; thứ tự này cũng là thứ tự hiện trong biểu đồ. */
const STATUS_BAR: ReadonlyArray<{ status: MaintenanceOccurrenceStatus; bar: string }> = [
  { status: 'planned', bar: 'bg-slate-400' },
  { status: 'dispatch_pending', bar: 'bg-sky-400' },
  { status: 'generated', bar: 'bg-blue-500' },
  { status: 'in_progress', bar: 'bg-amber-500' },
  { status: 'blocked', bar: 'bg-orange-600' },
  { status: 'failed', bar: 'bg-red-600' },
  { status: 'completed', bar: 'bg-emerald-500' },
];

const DAY_MS = 86_400_000;

/** Chưa đóng, kể cả phiếu gửi Quy trình lỗi: nó vẫn cần người xử lý (thử lại hoặc đóng tay), không được biến mất khỏi thẻ. */
function isOpen(occurrence: MaintenanceOccurrence): boolean {
  return occurrence.status !== 'completed';
}

function dueTime(occurrence: MaintenanceOccurrence): number {
  const value = Date.parse(occurrence.dueAt);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Đầu ngày (giờ máy) cách hôm nay `offsetDays` ngày; làm mốc cho "quá hạn" và "7 ngày tới". */
function startOfDay(offsetDays = 0): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays).getTime();
}

function isOverdue(occurrence: MaintenanceOccurrence): boolean {
  return isOpen(occurrence) && dueTime(occurrence) < startOfDay();
}

// ---------------------------------------------------------------- Thành phần nhỏ dùng trong thẻ

function Metric(props: { value: number | string; alert?: boolean }) {
  return (
    <span
      className={cn(
        'block text-[2rem] font-bold leading-none tracking-tight tabular-nums',
        props.alert ? 'text-red-700' : 'text-slate-900',
      )}
    >
      {props.value}
    </span>
  );
}

function Empty(props: { children: string }) {
  return <p className="m-0 py-4 text-center text-sm text-slate-500">{props.children}</p>;
}

/** Nút đóng phiếu ngay trên thẻ: bấm mở ô nhập ghi chú, xác nhận mới gửi (API bắt buộc có nội dung thực hiện). */
function CompleteButton(props: { occurrence: MaintenanceOccurrence; actions: MaintenanceDashboardActions }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await props.actions.completeOccurrence(props.occurrence.id, note.trim());
      setOpen(false);
      setNote('');
    } catch {
      // Lỗi đã được màn hình chính hiện ở banner; giữ ô nhập để người dùng thử lại.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-md"
            aria-label={`Hoàn thành: ${props.occurrence.title}`}
          />
        }
      >
        <CheckCircle2 />
        Hoàn thành
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-2">
          <label htmlFor={`complete-${props.occurrence.id}`} className="text-sm font-semibold text-slate-700">
            Nội dung đã thực hiện
          </label>
          <textarea
            id={`complete-${props.occurrence.id}`}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Hạng mục đã làm, kết quả đo kiểm…"
            className="w-full resize-none rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-100"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Huỷ
            </Button>
            <Button type="button" size="sm" disabled={busy || !note.trim()} onClick={() => void submit()}>
              Xác nhận
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Nút gửi lại phiếu báo lỗi sang Quy trình. Lỗi đã được màn hình chính hiện ở banner nên chỉ cần nuốt ở đây. */
function RetryButton(props: { occurrence: MaintenanceOccurrence; actions: MaintenanceDashboardActions }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-md"
      disabled={busy}
      aria-label={`Thử lại tạo phiếu: ${props.occurrence.title}`}
      onClick={() => {
        setBusy(true);
        void props.actions
          .retryDispatch(props.occurrence.id)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <RotateCcw />
      Thử lại
    </Button>
  );
}

/** Danh sách phiếu: mỗi dòng bấm để mở chi tiết, kèm nút đóng phiếu nếu người dùng có quyền. */
function OccurrenceList(props: {
  rows: readonly MaintenanceOccurrence[];
  data: MaintenanceDashboardData;
  trailing: (occurrence: MaintenanceOccurrence) => string;
}) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-slate-100 p-0">
      {props.rows.map((item) => {
        const late = isOverdue(item);
        return (
          <li key={item.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md border-0 bg-transparent p-1 text-left hover:bg-slate-50"
              onClick={() => props.data.actions.openOccurrence(item.id)}
            >
              <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
              <small className="truncate font-mono text-xs text-slate-500">
                {item.code ?? item.assetCode}
                {item.code ? ` · ${item.assetCode}` : ''}
              </small>
              {item.status === 'failed' && item.failureReason ? (
                <small className="truncate text-xs text-red-700" title={item.failureReason}>
                  {item.failureReason}
                </small>
              ) : null}
            </button>
            <small
              className={cn(
                'flex-none text-[0.8125rem] tabular-nums',
                late || item.priority === 'High' ? 'font-semibold text-red-700' : 'text-slate-500',
              )}
            >
              {item.status === 'failed' ? 'Lỗi tạo phiếu' : props.trailing(item)}
            </small>
            {props.data.canHandle && item.status === 'failed' && item.kind === 'preventive' ? (
              <RetryButton occurrence={item} actions={props.data.actions} />
            ) : null}
            {props.data.canHandle ? <CompleteButton occurrence={item} actions={props.data.actions} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Dòng "nhãn — thanh — số"; có `onClick` thì cả dòng bấm được (lọc sang Lịch sử). */
function BarRow(props: { label: string; value: number; max: number; barClass: string; onClick?: () => void }) {
  const width = props.max > 0 ? Math.max(props.value > 0 ? 4 : 0, Math.round((props.value / props.max) * 100)) : 0;
  const content = (
    <>
      <span className="truncate text-sm text-slate-700">{props.label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-slate-100">
        <span className={cn('block h-full rounded-full', props.barClass)} style={{ width: `${width}%` }} />
      </span>
      <span className="text-right text-[0.8125rem] font-semibold tabular-nums text-slate-700">{props.value}</span>
    </>
  );
  const grid = 'grid w-full grid-cols-[6.5rem_1fr_2rem] items-center gap-3';
  return (
    <li>
      {props.onClick ? (
        <button
          type="button"
          className={cn(grid, 'cursor-pointer rounded-md border-0 bg-transparent p-1 text-left hover:bg-slate-50')}
          aria-label={`${props.label}: ${props.value} phiếu, bấm để xem`}
          onClick={props.onClick}
        >
          {content}
        </button>
      ) : (
        <div className={grid}>{content}</div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- Danh mục thẻ

/** Mở màn tương ứng của thẻ số; `undefined` nghĩa là thẻ không dẫn đi đâu. */
const KPI_VIEW: Readonly<Partial<Record<string, (actions: MaintenanceDashboardActions) => void>>> = {
  'metric.overdue': (actions) => actions.openOccurrences(),
  'metric.dueThisWeek': (actions) => actions.openOccurrences(),
  'metric.openIncidents': (actions) => actions.openOccurrences('incident'),
  'metric.myOpen': (actions) => actions.openOccurrences(),
};

/**
 * Các thẻ dựng sẵn; mỗi người tự chọn tối đa 12 thẻ ngay trên trang Tổng quan.
 *
 * `id` được lưu vào tuỳ chọn của người dùng nên không bao giờ đổi tên — chỉ ngừng dùng (id đã gỡ khỏi catalog
 * thì bị bỏ qua khi hiển thị). Thứ tự trong mảng là thứ tự mặc định của các thẻ `defaultEnabled`.
 */
export const MAINTENANCE_DASHBOARD_CARDS: DashboardCardCatalog<MaintenanceDashboardData> = [
  {
    id: 'metric.overdue',
    title: 'Phiếu quá hạn',
    description: 'Phiếu chưa đóng mà ngày đến hạn đã qua.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const count = data.workspace.occurrences.filter(isOverdue).length;
      return <Metric value={count} alert={count > 0} />;
    },
  },
  {
    id: 'metric.dueThisWeek',
    title: 'Đến hạn 7 ngày tới',
    description: 'Phiếu chưa đóng có hạn từ hôm nay đến hết 7 ngày tới.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const from = startOfDay();
      const to = startOfDay(8);
      const count = data.workspace.occurrences.filter((item) => {
        const due = dueTime(item);
        return isOpen(item) && due >= from && due < to;
      }).length;
      return <Metric value={count} />;
    },
  },
  {
    id: 'metric.openIncidents',
    title: 'Số sự cố đang xử lý',
    description: 'Sự cố chưa đóng; đổi màu khi lớn hơn 0.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => (
      <Metric
        value={data.workspace.metrics.openIncidents}
        alert={data.workspace.metrics.openIncidents > 0}
      />
    ),
  },
  {
    id: 'metric.myOpen',
    title: 'Số việc của tôi',
    description: 'Phiếu chưa đóng đang giao cho bạn.',
    size: 'sm',
    defaultEnabled: true,
    render: (data) => {
      const me = data.workspace.actor.id;
      return <Metric value={data.workspace.occurrences.filter((item) => isOpen(item) && item.assigneeId === me).length} />;
    },
  },
  {
    id: 'list.needsAction',
    title: 'Cần xử lý',
    description: 'Phiếu chưa đóng gần hạn nhất, quá hạn xếp trước. Đóng phiếu ngay tại đây.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const rows = data.workspace.occurrences
        .filter((item) => isOpen(item) && item.kind === 'preventive')
        .sort((left, right) => dueTime(left) - dueTime(right))
        .slice(0, 6);
      if (rows.length === 0) return <Empty>Không có phiếu bảo trì nào đang chờ.</Empty>;
      return (
        <OccurrenceList
          rows={rows}
          data={data}
          trailing={(item) => (isOverdue(item) ? `Quá hạn · ${formatDate(item.dueAt.slice(0, 10))}` : formatDate(item.dueAt.slice(0, 10)))}
        />
      );
    },
  },
  {
    id: 'list.openIncidentItems',
    title: 'Danh sách sự cố đang xử lý',
    description: 'Sự cố chưa đóng, ưu tiên cao và mới nhất trước. Đóng sự cố ngay tại đây.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const rank = { High: 0, Normal: 1, Low: 2 } as const;
      const rows = data.workspace.occurrences
        .filter((item) => item.kind === 'incident' && isOpen(item))
        .sort((left, right) => rank[left.priority] - rank[right.priority] || right.createdAt.localeCompare(left.createdAt))
        .slice(0, 6);
      if (rows.length === 0) return <Empty>Không có sự cố nào đang mở.</Empty>;
      return <OccurrenceList rows={rows} data={data} trailing={(item) => STATUS_LABEL[item.status]} />;
    },
  },
  {
    id: 'list.myWork',
    title: 'Danh sách việc của tôi',
    description: 'Phiếu chưa đóng giao cho bạn, gần hạn nhất trước.',
    size: 'md',
    render: (data) => {
      const me = data.workspace.actor.id;
      const rows = data.workspace.occurrences
        .filter((item) => isOpen(item) && item.assigneeId === me)
        .sort((left, right) => dueTime(left) - dueTime(right))
        .slice(0, 6);
      if (rows.length === 0) return <Empty>Chưa có phiếu nào giao cho bạn.</Empty>;
      return (
        <OccurrenceList rows={rows} data={data} trailing={(item) => formatDate(item.dueAt.slice(0, 10))} />
      );
    },
  },
  {
    id: 'chart.statusBreakdown',
    title: 'Phiếu theo trạng thái',
    description: 'Phân bố phiếu theo trạng thái; bấm một dòng để xem danh sách trong Lịch sử.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const counts = new Map<MaintenanceOccurrenceStatus, number>();
      for (const item of data.workspace.occurrences) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
      const rows = STATUS_BAR.filter((entry) => (counts.get(entry.status) ?? 0) > 0);
      if (rows.length === 0) return <Empty>Chưa có phiếu nào.</Empty>;
      const max = Math.max(...rows.map((entry) => counts.get(entry.status) ?? 0));
      return (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((entry) => (
            <BarRow
              key={entry.status}
              label={STATUS_LABEL[entry.status]}
              value={counts.get(entry.status) ?? 0}
              max={max}
              barClass={entry.bar}
              onClick={() => data.actions.openHistoryByStatus(entry.status)}
            />
          ))}
        </ul>
      );
    },
  },
  {
    id: 'chart.completedByWeek',
    title: 'Hoàn thành 8 tuần gần nhất',
    description: 'Số phiếu đóng theo từng tuần, tuần mới nhất ở bên phải.',
    size: 'md',
    defaultEnabled: true,
    render: (data) => {
      const WEEKS = 8;
      // Tuần tính từ thứ Hai; mốc là đầu tuần hiện tại.
      const today = new Date(startOfDay());
      const weekStart = startOfDay(-((today.getDay() + 6) % 7));
      const buckets = new Array<number>(WEEKS).fill(0);
      for (const item of data.workspace.occurrences) {
        if (item.status !== 'completed' || !item.completedAt) continue;
        const done = Date.parse(item.completedAt);
        if (Number.isNaN(done)) continue;
        const weeksAgo = done >= weekStart ? 0 : Math.ceil((weekStart - done) / (7 * DAY_MS));
        const index = WEEKS - 1 - weeksAgo;
        if (index >= 0 && index < WEEKS) buckets[index] += 1;
      }
      const max = Math.max(...buckets);
      if (max === 0) return <Empty>Chưa có phiếu hoàn thành trong 8 tuần qua.</Empty>;
      return (
        <div className="flex h-28 items-end gap-2" role="img" aria-label={`Phiếu hoàn thành theo tuần: ${buckets.join(', ')}`}>
          {buckets.map((value, index) => (
            <div key={index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[0.75rem] font-semibold tabular-nums text-slate-600">{value}</span>
              <span
                className={cn('w-full rounded-t-sm', index === WEEKS - 1 ? 'bg-emerald-500' : 'bg-emerald-300')}
                style={{ height: `${Math.max(value > 0 ? 6 : 2, Math.round((value / max) * 76))}px` }}
              />
            </div>
          ))}
        </div>
      );
    },
  },
];

const CARD_ICON: Readonly<Record<string, typeof ClipboardList>> = {
  'metric.overdue': TriangleAlert,
  'metric.dueThisWeek': CalendarClock,
  'metric.openIncidents': TriangleAlert,
  'metric.myOpen': UserRound,
  'list.needsAction': ClipboardList,
  'list.openIncidentItems': TriangleAlert,
  'list.myWork': UserRound,
  'chart.statusBreakdown': ListChecks,
  'chart.completedByWeek': CheckCircle2,
};

/**
 * Lưới 2 cột trên màn nhỏ, 4 cột từ 640px, 8 cột từ 1280px: bốn thẻ số mặc định đúng một hàng,
 * thẻ danh sách và biểu đồ chiếm nửa hàng.
 */
const CARD_SPAN: Readonly<Record<DashboardCardSize, string>> = {
  sm: 'xl:col-span-2',
  md: 'col-span-2 sm:col-span-4 xl:col-span-4',
  lg: 'col-span-2 sm:col-span-4 xl:col-span-4',
  xl: 'col-span-full',
};

/**
 * Chọn thẻ hiển thị. Khác `resolveDashboardCards` của module-shell ở một điểm: mảng rỗng của người dùng
 * nghĩa là cố ý không hiện thẻ nào, còn `null` (chưa tuỳ chỉnh) mới rơi về thẻ mặc định.
 */
export function pickDashboardCards(selection: readonly string[] | null) {
  if (selection === null) return MAINTENANCE_DASHBOARD_CARDS.filter((card) => card.defaultEnabled);
  const byId = new Map(MAINTENANCE_DASHBOARD_CARDS.map((card) => [card.id, card]));
  return selection
    .map((id) => byId.get(id))
    .filter((card): card is (typeof MAINTENANCE_DASHBOARD_CARDS)[number] => card !== undefined);
}

export function MaintenanceDashboardGrid(props: {
  /** Danh sách id thẻ đã chọn theo thứ tự hiển thị; `null` là dùng mặc định. */
  selection: readonly string[] | null;
  data: MaintenanceDashboardData;
}) {
  const cards = pickDashboardCards(props.selection);
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
        <strong className="text-sm font-semibold text-slate-800">Chưa có thẻ nào trên trang Tổng quan</strong>
        <span className="text-sm text-slate-500">Bấm Tuỳ chỉnh để chọn thẻ bạn muốn xem.</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => {
        const Icon = CARD_ICON[card.id];
        const open = KPI_VIEW[card.id];
        // Trong nút chỉ được dùng nội dung dòng (span), nên thẻ số không dùng h2.
        const Heading = open ? 'span' : 'h2';
        const header = (
          <Heading className="m-0 flex min-w-0 items-start gap-2 text-[0.8125rem] font-bold uppercase leading-snug tracking-wide text-slate-500">
            {Icon ? <Icon className="mt-px size-4 flex-none text-slate-400" aria-hidden="true" /> : null}
            {/* Hiện đủ tiêu đề, xuống dòng khi hẹp; không cắt bằng dấu "…". */}
            <span className="min-w-0 break-words">{card.title}</span>
          </Heading>
        );
        // Thẻ số: cả thẻ là một nút dẫn tới danh sách tương ứng.
        if (open) {
          return (
            <button
              key={card.id}
              type="button"
              className={cn(
                'group/card flex cursor-pointer flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:border-blue-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-200',
                CARD_SPAN[card.size],
              )}
              aria-label={`${card.title}: bấm để xem danh sách`}
              onClick={() => open(props.data.actions)}
            >
              <span className="flex items-start justify-between gap-2">
                {header}
                <ArrowRight className="size-4 flex-none text-slate-300 group-hover/card:text-blue-600" aria-hidden="true" />
              </span>
              {card.render(props.data)}
            </button>
          );
        }
        return (
          <Card key={card.id} className={cn('gap-3', CARD_SPAN[card.size])}>
            {header}
            {card.render(props.data)}
          </Card>
        );
      })}
    </div>
  );
}
