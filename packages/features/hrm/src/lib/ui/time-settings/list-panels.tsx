'use client';
/**
 * Mục dạng danh sách của "Chấm công": Địa điểm GPS.
 * Mỗi mục là một thẻ gồm thanh công cụ gọn (ô tìm, lọc, nút thêm) và danh sách co giãn theo khung chứa. Chỉ lo giao diện:
 * mọi thao tác ghi nằm ở màn hình cha và được truyền vào bằng hàm.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { MapPin, Plus, Search } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { Button } from '../button';
import { Input } from '../input';
import { EmptyPanel, StatusPill } from '../settings-kit';
import { Pager, ResponsiveList, usePaged, type ListColumn } from './responsive-list';
import {
  describeAssignments,
  filterSites,
  ipSummary,
  tenantHasAssignments,
  type Settings,
  type SiteRow,
} from './time-settings-model';

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
        height={36}
        value={value}
        options={options}
        clearable={false}
        onChange={(next) => onChange(next || options[0].value)}
      />
    </div>
  );
}

/** Địa điểm chấm công theo GPS (kèm IP, phòng ban được gán): tìm, lọc theo trạng thái, thêm; sửa và ngừng (có hộp xác nhận) ngay trên dòng. */
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
  onStop: (row: SiteRow) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const filtered = useMemo(() => filterSites(rows, search, status), [rows, search, status]);
  const paged = usePaged(filtered, 10);
  const anyAssignments = tenantHasAssignments(rows);
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
      cell: (r) => <span className="font-mono text-[12px]">{`${r.latitude}, ${r.longitude}`}</span>,
    },
    { id: 'radius', header: 'Bán kính', cell: (r) => `${r.radius_meters} m` },
    {
      id: 'ips',
      header: 'IP',
      cell: (r) => <span className="font-mono text-[12px]">{ipSummary(r.allowed_ips)}</span>,
    },
    {
      id: 'scope',
      header: 'Áp dụng cho',
      cell: (r) => <span className="text-[12px] text-slate-700">{describeAssignments(r, anyAssignments)}</span>,
    },
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
        r.active && canConfigure ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              aria-label={`Sửa ${r.name}`}
              onClick={() => onEdit(r)}
              className="h-8 px-3 text-xs"
            >
              Sửa
            </Button>
            <Popconfirm
              title={`Ngừng địa điểm ${r.name}?`}
              description="Giữ lịch sử và chứng cứ đã ghi nhận. Kỳ công mở bị ảnh hưởng phải tính lại."
              okText="Ngừng địa điểm"
              cancelText="Không"
              okType="danger"
              placement="top-end"
              onConfirm={() => onStop(r)}
            >
              <Button
                type="button"
                variant="outline"
                aria-label={`Ngừng ${r.name}`}
                className="h-8 border-red-200 px-3 text-xs text-red-700 hover:bg-red-50"
              >
                Ngừng
              </Button>
            </Popconfirm>
          </div>
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
            placeholder="Tìm theo tên, tọa độ hoặc IP"
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
          description="Thêm địa điểm (GPS, kèm IP nếu cần) và gán cho phòng ban để kiểm soát chấm công."
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
            gridClass="@2xl:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_5rem_minmax(0,9rem)_minmax(0,13rem)_6.5rem_2.5rem]"
          />
          <Pager paged={paged} sizeChanger />
        </>
      )}
    </ListCard>
  );
}
