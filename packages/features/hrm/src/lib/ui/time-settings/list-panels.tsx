'use client';
/**
 * Ba mục dạng danh sách của "Chấm công & thiết bị": Lịch làm / OFF / Lễ, Địa điểm GPS, Thiết bị.
 * Mỗi mục là một thẻ gồm thanh công cụ gọn (ô tìm, lọc, nút thêm) và danh sách co giãn theo khung chứa. Chỉ lo giao diện:
 * mọi thao tác ghi nằm ở màn hình cha và được truyền vào bằng hàm.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CalendarDays, MapPin, Plus, Search, Smartphone } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { formatDateVn } from '../../personnel-decision-rules';
import { Button } from '../button';
import { Input } from '../input';
import { RowMenu } from '../row-menu';
import { EmptyPanel, InfoNote, StatusPill, type PillTone } from '../settings-kit';
import { Pager, ResponsiveList, usePaged, type ListColumn } from './responsive-list';
import {
  DAY_KIND_LABELS,
  DEVICE_STATUS_LABELS,
  filterCalendar,
  filterDevices,
  filterSites,
  type CalendarRow,
  type DeviceRow,
  type Settings,
  type SiteRow,
} from './time-settings-model';

const DAY_KIND_TONE: Record<string, PillTone> = {
  WORK: 'slate',
  OFF: 'amber',
  HOLIDAY: 'red',
};
const DEVICE_TONE: Record<string, PillTone> = {
  PENDING: 'amber',
  ACTIVE: 'green',
  REVOKED: 'slate',
};

function ListCard({
  title,
  description,
  toolbar,
  children,
}: {
  title: string;
  description?: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 @xl:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 @2xl:w-auto">{toolbar}</div>
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative min-w-0 flex-1 basis-48 @2xl:w-60 @2xl:flex-none">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 pl-8 text-xs"
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <div className="min-w-0 flex-1 basis-44 @2xl:w-52 @2xl:flex-none" aria-label={label} role="group">
      <SearchableSelect
        value={value}
        options={options}
        clearable={false}
        onChange={(next) => onChange(next || options[0].value)}
      />
    </div>
  );
}

const CALENDAR_COLUMNS: ListColumn<CalendarRow>[] = [
  {
    id: 'date',
    header: 'Ngày',
    primary: true,
    cell: (r) => <span className="text-sm font-semibold text-slate-900 @2xl:text-xs">{formatDateVn(r.work_date)}</span>,
  },
  { id: 'name', header: 'Tên', cell: (r) => r.name },
  {
    id: 'kind',
    header: 'Loại',
    cell: (r) => (
      <StatusPill tone={DAY_KIND_TONE[r.day_kind] ?? 'slate'}>
        {DAY_KIND_LABELS[r.day_kind] ?? r.day_kind}
      </StatusPill>
    ),
  },
  { id: 'paid', header: 'Hưởng lương', cell: (r) => (r.paid ? 'Có' : 'Không') },
];

/** Lịch ngày làm / OFF / lễ: chỉ đọc (quản lý tại Phân ca), có tìm kiếm và lọc theo loại ngày. */
export function CalendarPanel({
  rows,
  holidayStatus,
}: {
  rows: Settings['calendar'];
  holidayStatus?: Settings['holidayStatus'];
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('ALL');
  const filtered = useMemo(() => filterCalendar(rows, search, kind), [rows, search, kind]);
  const paged = usePaged(filtered, 20);
  return (
    <div className="space-y-3">
      {holidayStatus?.warning ? (
        <InfoNote tone="amber" role="alert">
          {holidayStatus.warning}
        </InfoNote>
      ) : null}
      <InfoNote tone="blue">
        <span>Lịch lễ/Tết và ngày nghỉ được quản lý tại </span>
        <Link
          href="/settings?view=schedules"
          className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          Phân ca
        </Link>
        <span>. Danh sách dưới đây chỉ để tham khảo.</span>
      </InfoNote>
      <ListCard
        title="Lịch ngày làm / OFF / lễ"
        description={`${rows.length} ngày đã khai báo`}
        toolbar={
          <>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Tìm theo ngày, tên hoặc loại ngày"
              label="Tìm lịch làm việc"
            />
            <FilterSelect
              label="Lọc theo loại ngày"
              value={kind}
              onChange={(next) => {
                setKind(next);
                paged.setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'Tất cả loại ngày' },
                ...Object.entries(DAY_KIND_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyPanel
            icon={CalendarDays}
            title="Chưa có ngày nào trong lịch"
            description="Ngày làm, ngày OFF và ngày lễ được khai báo tại Phân ca."
          />
        ) : filtered.length === 0 ? (
          <EmptyPanel icon={Search} title="Không có ngày nào khớp" description="Thử đổi từ khóa hoặc bộ lọc." />
        ) : (
          <>
            <ResponsiveList
              label="Lịch làm việc"
              rows={paged.pageRows}
              rowKey={(r) => r.id}
              columns={CALENDAR_COLUMNS}
              gridClass="@2xl:grid-cols-[7rem_minmax(0,1fr)_8rem_7rem]"
            />
            <Pager paged={paged} sizeChanger />
          </>
        )}
      </ListCard>
    </div>
  );
}

/** Địa điểm chấm công theo GPS: tìm, lọc theo trạng thái, thêm; sửa và ngừng gom vào menu "...". */
export function SitesPanel({
  rows,
  canConfigure,
  onAdd,
  onEdit,
  onStop,
}: {
  rows: Settings['sites'];
  canConfigure: boolean;
  onAdd: () => void;
  onEdit: (row: SiteRow) => void;
  onStop: (row: SiteRow) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const filtered = useMemo(() => filterSites(rows, search, status), [rows, search, status]);
  const paged = usePaged(filtered, 10);
  const columns: ListColumn<SiteRow>[] = [
    {
      id: 'name',
      header: 'Địa điểm',
      primary: true,
      cell: (r) => <span className="text-sm font-semibold text-slate-900 @2xl:text-xs">{r.name}</span>,
    },
    {
      id: 'coords',
      header: 'Tọa độ',
      cell: (r) => <span className="font-mono text-[11px]">{`${r.latitude}, ${r.longitude}`}</span>,
    },
    { id: 'radius', header: 'Bán kính', cell: (r) => `${r.radius_meters} m` },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: (r) =>
        r.active ? (
          <StatusPill tone="green">Đang dùng</StatusPill>
        ) : (
          <StatusPill tone="slate">Đã ngừng</StatusPill>
        ),
    },
    {
      id: 'actions',
      header: 'Thao tác',
      actions: 'corner',
      cell: (r) =>
        r.active ? (
          <RowMenu
            label={`Thao tác với ${r.name}`}
            items={[
              { key: 'edit', label: 'Sửa', hidden: !canConfigure, onSelect: () => onEdit(r) },
              { key: 'stop', label: 'Ngừng', tone: 'danger', hidden: !canConfigure, onSelect: () => onStop(r) },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <ListCard
      title="Địa điểm chấm công"
      description={`${rows.filter((r) => r.active).length} địa điểm đang dùng`}
      toolbar={
        <>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Tìm theo tên hoặc tọa độ"
            label="Tìm địa điểm chấm công"
          />
          <FilterSelect
            label="Lọc theo trạng thái"
            value={status}
            onChange={(next) => {
              setStatus(next);
              paged.setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'Tất cả trạng thái' },
              { value: 'ACTIVE', label: 'Đang dùng' },
              { value: 'INACTIVE', label: 'Đã ngừng' },
            ]}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyPanel
          icon={MapPin}
          title="Chưa có địa điểm chấm công"
          description="Thêm địa điểm để kiểm soát chấm công theo bán kính GPS."
          action={
            <Button permission="hrm.time.configure" onClick={onAdd} className="h-9 gap-1.5 px-4 text-xs font-semibold">
              <Plus className="size-4" />
              Thêm địa điểm
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyPanel icon={Search} title="Không có địa điểm nào khớp" description="Thử đổi từ khóa hoặc bộ lọc." />
      ) : (
        <>
          <ResponsiveList
            label="Địa điểm chấm công"
            rows={paged.pageRows}
            rowKey={(r) => r.id}
            columns={columns}
            gridClass="@2xl:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6rem_7rem_2.5rem]"
          />
          <Pager paged={paged} sizeChanger />
        </>
      )}
    </ListCard>
  );
}

/** Thiết bị chấm công đã đăng ký: duyệt (thu hồi thiết bị cũ của nhân viên) và thu hồi, xác nhận tại chỗ bằng Popconfirm. */
export function DevicesPanel({
  rows,
  busy,
  onApprove,
  onRevoke,
}: {
  rows: Settings['devices'];
  busy: boolean;
  onApprove: (device: DeviceRow) => void | Promise<void>;
  onRevoke: (device: DeviceRow) => void | Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const filtered = useMemo(() => filterDevices(rows, search, status), [rows, search, status]);
  const paged = usePaged(filtered, 10);
  const columns: ListColumn<DeviceRow>[] = [
    {
      id: 'employee',
      header: 'Nhân viên',
      primary: true,
      cell: (r) => <span className="text-sm font-semibold text-slate-900 @2xl:text-xs">{r.full_name}</span>,
    },
    { id: 'device', header: 'Thiết bị', cell: (r) => r.name },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: (r) => (
        <StatusPill tone={DEVICE_TONE[r.status] ?? 'slate'}>
          {DEVICE_STATUS_LABELS[r.status] ?? r.status}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Thao tác',
      actions: 'inline',
      cell: (device) => (
        <>
          {device.status === 'PENDING' && (
            <Popconfirm
              title="Duyệt thiết bị mới và thu hồi thiết bị cũ?"
              onConfirm={() => onApprove(device)}
            >
              <Button permission="hrm.device.manage" size="sm" disabled={busy} className="h-9 px-3 @2xl:h-8">
                Duyệt
              </Button>
            </Popconfirm>
          )}
          {device.status !== 'REVOKED' && (
            <Popconfirm title="Thu hồi thiết bị chấm công?" onConfirm={() => onRevoke(device)}>
              <Button
                permission="hrm.device.manage"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-9 px-3 @2xl:h-8"
              >
                Thu hồi
              </Button>
            </Popconfirm>
          )}
        </>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <InfoNote tone="slate">
        Duyệt thiết bị mới sẽ thu hồi thiết bị đang hoạt động của nhân viên; định danh gắn với trình duyệt đã đăng ký.
      </InfoNote>
      <ListCard
        title="Thiết bị đăng ký"
        description={`${rows.length} thiết bị`}
        toolbar={
          <>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Tìm theo nhân viên, thiết bị hoặc trạng thái"
              label="Tìm thiết bị chấm công"
            />
            <FilterSelect
              label="Lọc theo trạng thái"
              value={status}
              onChange={(next) => {
                setStatus(next);
                paged.setPage(1);
              }}
              options={[
                { value: 'ALL', label: 'Tất cả trạng thái' },
                ...Object.entries(DEVICE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyPanel
            icon={Smartphone}
            title="Chưa có thiết bị nào đăng ký"
            description="Thiết bị xuất hiện ở đây khi nhân viên đăng ký trình duyệt chấm công."
          />
        ) : filtered.length === 0 ? (
          <EmptyPanel icon={Search} title="Không có thiết bị nào khớp" description="Thử đổi từ khóa hoặc bộ lọc." />
        ) : (
          <>
            <ResponsiveList
              label="Thiết bị chấm công"
              rows={paged.pageRows}
              rowKey={(r) => r.id}
              columns={columns}
              gridClass="@2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_12rem]"
            />
            <Pager paged={paged} sizeChanger />
          </>
        )}
      </ListCard>
    </div>
  );
}
