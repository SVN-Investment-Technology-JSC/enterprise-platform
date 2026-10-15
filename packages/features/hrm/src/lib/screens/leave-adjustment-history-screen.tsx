'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect, formatDateTime } from '@enterprise-platform/shared-ui';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';
import type { HrmLeaveTransaction } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { normalizeSearchText } from '../hrm-employee-view';
import { useHrmPermissions } from '../hrm-permissions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { formatLeaveNumber } from '../ui/leave-ledger-format';
import { PageTitle } from '../ui/page-title';

const PAGE_SIZE = 20;
const TH = 'px-3 py-2.5 text-left text-[12px] font-bold text-slate-500';

type TypeFilter = 'ALL' | 'ADJUSTMENT' | 'REVERSAL';

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả điều chỉnh' },
  { value: 'ADJUSTMENT', label: 'Điều chỉnh' },
  { value: 'REVERSAL', label: 'Đảo điều chỉnh' },
];

const signed = (value: number) => (value > 0 ? `+${formatLeaveNumber(value)}` : formatLeaveNumber(value));

/**
 * Lịch sử điều chỉnh phép năm: toàn bộ lần điều chỉnh và đảo điều chỉnh quỹ phép năm của mọi nhân viên, mỗi dòng ghi
 * rõ tài khoản đã thực hiện (tên và email). Điều chỉnh mới luôn bắt buộc có tài khoản thực hiện.
 */
export default function LeaveAdjustmentHistoryScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canRead = can('hrm.leave.read');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState('ALL');
  const [type, setType] = useState<TypeFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HrmLeaveTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadSeq = useRef(0);

  const yearOptions = useMemo(
    () => [
      { value: 'ALL', label: 'Tất cả các năm' },
      ...Array.from({ length: 7 }, (_, i) => currentYear + 1 - i).map((y) => ({ value: String(y), label: `Năm ${y}` })),
    ],
    [currentYear],
  );

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ types: 'ADJUSTMENT,REVERSAL', annual: '1' });
      if (year !== 'ALL') query.set('year', year);
      const result = await hrmFetch<{ data: HrmLeaveTransaction[] }>(`/leave-transactions?${query}`);
      if (seq === loadSeq.current) setRows(result.data);
    } catch (e) {
      if (seq === loadSeq.current) {
        setRows([]);
        setError(e instanceof Error ? e.message : 'Không đọc được lịch sử điều chỉnh phép năm');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const filtered = useMemo(() => {
    const needle = normalizeSearchText(search.trim());
    return rows.filter((r) => {
      if (type !== 'ALL' && r.transactionType !== type) return false;
      if (!needle) return true;
      const hay = normalizeSearchText(
        [r.employeeName, r.employeeCode, r.actorLabel, r.actorEmail, r.note].filter(Boolean).join(' '),
      );
      return hay.includes(needle);
    });
  }, [rows, type, search]);

  useEffect(() => setPage(1), [year, type, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (!permissionsLoading && !canRead)
    return (
      <div role="alert" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        Bạn không có quyền xem lịch sử điều chỉnh phép năm.
      </div>
    );

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageTitle
        title="Lịch sử điều chỉnh phép năm"
        description="Mọi lần điều chỉnh và đảo điều chỉnh quỹ phép năm, kèm tài khoản đã thực hiện."
      />
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="w-44">
          <SearchableSelect
            height={36}
            value={year}
            onChange={(v) => setYear(v || 'ALL')}
            options={yearOptions}
            clearable={false}
            placeholder="Chọn năm"
          />
        </div>
        <div className="w-52">
          <SearchableSelect
            height={36}
            value={type}
            onChange={(v) => setType((v || 'ALL') as TypeFilter)}
            options={TYPE_OPTIONS}
            clearable={false}
            placeholder="Loại"
          />
        </div>
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Tìm theo nhân viên, tài khoản thực hiện hoặc lý do"
            placeholder="Tìm theo nhân viên, tài khoản thực hiện, lý do..."
            className="h-9 border-slate-200 pl-9 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="lg" className="text-xs font-medium" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-xs" data-testid="leave-adjustment-history">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Thời điểm</th>
                <th className={TH}>Nhân viên</th>
                <th className={TH}>Năm</th>
                <th className={TH}>Loại</th>
                <th className={`${TH} text-right`}>Số ngày</th>
                <th className={`${TH} text-right`}>Còn lại sau</th>
                <th className={TH}>Lý do</th>
                <th className={TH}>Tài khoản thực hiện</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    Đang tải lịch sử điều chỉnh...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    Chưa có lần điều chỉnh phép năm nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id} data-testid="leave-adjustment-row">
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-slate-600">
                      {formatDateTime(r.createdAt, r.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block font-semibold text-slate-900">{r.employeeName}</span>
                      <span className="block text-[12px] text-slate-500">
                        {r.employeeCode}
                        {r.department ? ` · ${r.department}` : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{r.balanceYear ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        className={
                          r.transactionType === 'REVERSAL'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-blue-200 bg-blue-50 text-blue-700'
                        }
                      >
                        {r.transactionType === 'REVERSAL' ? 'Đảo điều chỉnh' : 'Điều chỉnh'}
                      </Badge>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-bold ${
                        r.daysChanged < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {signed(r.daysChanged)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatLeaveNumber(r.balanceAfter)}</td>
                    <td className="max-w-[320px] px-3 py-2.5 text-slate-700" title={r.note ?? ''}>
                      <span className="line-clamp-2">{r.note || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5" data-testid="adjustment-actor">
                      {r.actorLabel || r.actorEmail ? (
                        <>
                          <span className="block font-semibold text-slate-900">{r.actorLabel || r.actorEmail}</span>
                          {r.actorEmail && r.actorLabel !== r.actorEmail && (
                            <span className="block text-[12px] text-slate-500">{r.actorEmail}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">Không xác định (dữ liệu cũ)</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          <span>{filtered.length} lần điều chỉnh</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              Trước
            </Button>
            <span>
              Trang {current}/{pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={current >= pageCount} onClick={() => setPage(current + 1)}>
              Sau
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
