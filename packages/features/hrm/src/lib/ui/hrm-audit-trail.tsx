'use client';
import { useCallback, useEffect, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import { formatDateVn } from '../personnel-decision-rules';
import { Input } from './input';
import { Button } from './button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './sheet';

export interface AuditRow {
  id: string;
  createdAt: string;
  action: string;
  actionLabel: string;
  entityKind: string | null;
  entityLabel: string | null;
  actorLabel: string;
  approverLabel: string | null;
  detail: unknown;
}

const stamp = (value: string) => new Date(value).toLocaleString('vi-VN');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Khóa kỹ thuật không đưa ra màn hình chi tiết. */
const HIDDEN_KEYS = new Set([
  'id',
  'tenant_id',
  'expectedUpdatedAt',
  'operationId',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
]);
const KEY_LABELS: Record<string, string> = {
  reason: 'Lý do',
  before: 'Trước thay đổi',
  after: 'Sau thay đổi',
  status: 'Trạng thái',
  previousStatus: 'Trạng thái trước',
  effectiveDate: 'Ngày hiệu lực',
  effectiveFrom: 'Hiệu lực từ',
  effectiveTo: 'Hiệu lực đến',
  name: 'Tên',
  note: 'Ghi chú',
  kind: 'Loại đơn',
  fields: 'Trường thay đổi',
  lastError: 'Lỗi',
  error: 'Lỗi',
  evidenceReference: 'Căn cứ / chứng từ',
  comment: 'Ý kiến',
  decision: 'Quyết định',
  outcome: 'Kết quả',
  target: 'Trạng thái đích',
  year: 'Năm',
  date: 'Ngày',
  from: 'Từ ngày',
  to: 'Đến ngày',
  days: 'Số ngày',
  amount: 'Số tiền',
  daysAdjusted: 'Số ngày điều chỉnh',
  employeeCode: 'Mã nhân viên',
  fullName: 'Họ tên',
  line: 'Quyết toán',
  dailyRate: 'Đơn giá ngày',
  purpose: 'Mục đích',
  saved: 'Đã lưu',
  skipped: 'Bỏ qua',
};

/** Hiển thị giá trị chi tiết dạng đọc được (ngày dd/mm/yyyy, ẩn UUID). */
function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'string') {
    if (UUID.test(value)) return '(mã nội bộ)';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateVn(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return stamp(value);
    return value;
  }
  if (Array.isArray(value))
    return value.length ? value.map(renderValue).join(', ') : '—';
  return '';
}

function DetailList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([k, v]) => !HIDDEN_KEYS.has(k) && !(typeof v === 'string' && UUID.test(v)),
  );
  if (!entries.length)
    return <p className="text-xs text-slate-500">Không có thông tin thêm.</p>;
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[160px_1fr] gap-3 px-3 py-2 text-xs">
          <dt className="font-medium text-slate-500">{KEY_LABELS[key] ?? key}</dt>
          <dd className="min-w-0 break-words text-slate-800">
            {value && typeof value === 'object' && !Array.isArray(value) ? (
              <DetailList data={value as Record<string, unknown>} />
            ) : (
              renderValue(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Nhật ký nghiệp vụ: lọc phía server, hiển thị tên/mã thay cho UUID. */
export function HrmAuditTrail() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<{ value: string; label: string }[]>([]);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);

  // Gõ tìm kiếm: chờ người dùng dừng gõ rồi mới gọi server.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (action) params.set('action', action);
      if (query) params.set('search', query);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const result = await hrmFetch<{
        data: AuditRow[];
        meta: { total: number; actions: { value: string; label: string }[] };
      }>(`/operations/audit?${params}`);
      setRows(result.data);
      setTotal(result.meta.total);
      setActions(result.meta.actions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được nhật ký');
    } finally {
      setBusy(false);
    }
  }, [action, query, from, to, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const reasonOf = (row: AuditRow) => {
    const d =
      row.detail && typeof row.detail === 'object'
        ? (row.detail as Record<string, unknown>)
        : {};
    const value = d.reason ?? d.lastError ?? d.error;
    return typeof value === 'string' && value.trim() ? value : '—';
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 md:grid-cols-[1.2fr_1.5fr_160px_160px_auto]">
        <label className="block text-[11px] font-semibold text-slate-600">
          Hành động
          <SearchableSelect
            value={action}
            placeholder="Tất cả hành động"
            options={actions}
            clearable
            onChange={(v) => {
              setAction(v || '');
              setPage(1);
            }}
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Tìm theo đối tượng / người thực hiện / lý do
          <Input
            aria-label="Tìm trong nhật ký"
            placeholder="VD: mã NV, tên nhân viên, mã hợp đồng, kỳ công…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-1 h-9 text-xs"
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Từ ngày
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="mt-1 h-9 text-xs"
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Đến ngày
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="mt-1 h-9 text-xs"
          />
        </label>
        <div className="flex items-end">
          <Button
            variant="outline"
            className="h-9 text-xs"
            disabled={!action && !search && !from && !to}
            onClick={() => {
              setAction('');
              setSearch('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            Xóa lọc
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-600">
          {error}
        </p>
      )}
      <Table<AuditRow>
        size="small"
        rowKey="id"
        loading={busy}
        dataSource={rows}
        scroll={{ x: 1150 }}
        onRow={(row) => ({
          onClick: () => setDetail(row),
          className: 'cursor-pointer',
        })}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t, range) => `Hiển thị ${range[0]}–${range[1]} / ${t} sự kiện`,
          onChange: (p, size) => {
            setPage(size !== pageSize ? 1 : p);
            setPageSize(size);
          },
        }}
        columns={[
          {
            title: 'Thời điểm',
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => (
              <span className="text-xs text-slate-700">{stamp(v)}</span>
            ),
          },
          {
            title: 'Hành động',
            dataIndex: 'actionLabel',
            width: 220,
            render: (v: string) => (
              <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                {v}
              </span>
            ),
          },
          {
            title: 'Đối tượng',
            width: 320,
            render: (_, r) =>
              r.entityLabel ? (
                <div className="min-w-0">
                  {r.entityKind && (
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {r.entityKind}
                    </span>
                  )}
                  <span className="block truncate text-xs font-semibold text-slate-800">
                    {r.entityLabel}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              ),
          },
          {
            title: 'Người thực hiện',
            width: 230,
            render: (_, r) => (
              <div className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-800">
                  {r.actorLabel}
                </span>
                {r.approverLabel && (
                  <span className="block truncate text-[11px] text-slate-500">
                    Người duyệt: {r.approverLabel}
                  </span>
                )}
              </div>
            ),
          },
          {
            title: 'Lý do / ghi chú',
            render: (_, r) => (
              <span className="block max-w-xs truncate text-xs text-slate-600">
                {reasonOf(r)}
              </span>
            ),
          },
        ]}
      />
      <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
          {detail && (
            <>
              <SheetHeader className="shrink-0">
                <SheetTitle>{detail.actionLabel}</SheetTitle>
                <SheetDescription>{stamp(detail.createdAt)}</SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-slate-500">Đối tượng</dt>
                  <dd className="font-semibold text-slate-800">
                    {detail.entityKind ? `${detail.entityKind}: ` : ''}
                    {detail.entityLabel ?? '—'}
                  </dd>
                  <dt className="text-slate-500">Người thực hiện</dt>
                  <dd className="font-semibold text-slate-800">{detail.actorLabel}</dd>
                  {detail.approverLabel && (
                    <>
                      <dt className="text-slate-500">Người duyệt</dt>
                      <dd className="font-semibold text-slate-800">
                        {detail.approverLabel}
                      </dd>
                    </>
                  )}
                  <dt className="text-slate-500">Mã hành động</dt>
                  <dd className="font-mono text-slate-600">{detail.action}</dd>
                </dl>
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Nội dung ghi nhận
                  </h3>
                  {detail.detail && typeof detail.detail === 'object' ? (
                    <DetailList data={detail.detail as Record<string, unknown>} />
                  ) : (
                    <p className="text-xs text-slate-500">Không có thông tin thêm.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
