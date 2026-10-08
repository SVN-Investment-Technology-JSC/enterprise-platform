'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import {
  Lock,
  Unlock,
  RefreshCw,
  Download,
  Plus,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
} from 'lucide-react';
import type {
  HrmTimesheet,
  HrmTimesheetPeriod,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import {
  MonthlyAttendanceMatrixTable,
  type MatrixEmployee,
  type MatrixAttendanceRecord,
} from '../ui/monthly-attendance-matrix-table';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

const statuses: Record<string, string> = {
  NORMAL: 'Công',
  OFF: 'OFF',
  HOLIDAY: 'Lễ',
  LEAVE: 'Phép',
  BUSINESS_TRIP: 'Công tác',
  ABNORMAL: 'Bất thường',
  ABSENT: 'Vắng',
  ADJUSTED: 'Điều chỉnh',
};
function exportRows(rows: HrmTimesheet[], name: string) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const data: unknown[][] = [
    [
      'Nhân viên',
      'Ngày',
      'Trạng thái',
      'Phút chuẩn',
      'Phút thực tế',
      'Phút hưởng lương',
      'Công',
      'Phút OT',
      'Phút trễ',
      'Phút sớm',
      'Phút phép',
      'Bất thường',
      'Căn cứ điều chỉnh',
    ],
    ...rows.map((r) => [
      r.employeeName || r.employeeId,
      r.workDate,
      statuses[r.status] || r.status,
      r.scheduledMinutes,
      r.workedMinutes,
      r.paidMinutes,
      r.workdayUnits,
      r.otMinutes,
      r.lateMinutes,
      r.earlyLeaveMinutes,
      r.calculationSnapshot?.leaveMinutes || 0,
      (r.calculationSnapshot?.anomalies as string[] | undefined)?.join('; '),
      r.adjustedReason,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ['\uFEFF', data.map((row) => row.map(cell).join(',')).join('\r\n')],
      { type: 'text/csv;charset=utf-8' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TimesheetsScreen() {
  const [periods, setPeriods] = useState<HrmTimesheetPeriod[]>([]),
    [selected, setSelected] = useState(''),
    [rows, setRows] = useState<HrmTimesheet[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<HrmAction | null>(null);
  const current = periods.find((p) => p.id === selected);
  const [matrix, setMatrix] = useState(true),
    [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Lấy năm và tháng từ kỳ công hiện tại (fromDate YYYY-MM-DD)
  const [currentYear, currentMonth] = useMemo(() => {
    if (current?.fromDate) {
      const parts = current.fromDate.split('-');
      if (parts.length >= 2) {
        return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
      }
    }
    const d = new Date();
    return [d.getFullYear(), d.getMonth() + 1];
  }, [current]);
  const filteredRows = rows.filter(
    (r) =>
      `${r.employeeName || ''} ${r.employeeId}`
        .toLocaleLowerCase('vi')
        .includes(search.toLocaleLowerCase('vi')) &&
      (!statusFilter || r.status === statusFilter),
  );
  // Adapter cho MonthlyAttendanceMatrixTable
  const matrixEmployees: MatrixEmployee[] = useMemo(() => {
    const map = new Map<string, MatrixEmployee>();
    for (const r of rows) {
      if (!map.has(r.employeeId)) {
        map.set(r.employeeId, {
          employeeId: r.employeeId,
          employeeCode: r.employeeCode || '',
          fullName: r.employeeName || r.employeeCode || r.employeeId,
          department: r.department ?? null,
          position: r.position ?? null,
        });
      }
    }
    return [...map.values()];
  }, [rows]);

  const matrixAttendances: MatrixAttendanceRecord[] = useMemo(() => {
    return rows.map((r) => {
      // Xác định trạng thái mapping tương ứng cho ma trận
      let status = r.status;
      if (r.isManuallyAdjusted || r.status === 'ADJUSTED') {
        status = 'ADJUSTED';
      }
      return {
        id: r.id,
        employeeId: r.employeeId,
        workDate: r.workDate,
        status,
        workedMinutes: r.workedMinutes,
        checkInAt: r.scheduledMinutes && r.workedMinutes > 0 ? `${r.workDate}T08:00:00Z` : undefined,
        checkOutAt: r.scheduledMinutes && r.workedMinutes > 0 ? `${r.workDate}T17:30:00Z` : undefined,
        note: r.adjustedReason || undefined,
      };
    });
  }, [rows]);
  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmTimesheetPeriod[] }>(
      '/timesheet-periods',
    );
    setPeriods(result.data);
    setSelected((id) =>
      result.data.some((p) => p.id === id) ? id : result.data[0]?.id || '',
    );
  }, []);
  const loadRows = useCallback(async () => {
    if (selected)
      setRows(
        (
          await hrmFetch<{ data: HrmTimesheet[] }>(
            `/timesheets?period_id=${selected}`,
          )
        ).data,
      );
  }, [selected]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    setRows([]);
    void loadRows().catch((e) => setError(e.message));
  }, [loadRows]);
  async function command(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(path, { method, body: JSON.stringify(body) });
      await load();
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Bảng công Tổng hợp & Khóa kỳ
            </h1>
            {current && (
              <Badge
                className={
                  current.status === 'LOCKED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold text-xs'
                    : 'bg-amber-50 text-amber-700 border-amber-200 font-semibold text-xs'
                }
              >
                {current.status === 'LOCKED' ? 'Đã khóa kỳ' : 'Đang mở'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 max-w-[85ch]">
            Đối soát chi tiết ngày công, phép, chế độ nghỉ lễ, công tác và tăng ca (OT) trước khi khóa kỳ công phục vụ tính lương.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            permission="hrm.timesheet.calculate"
            onClick={() =>
              setAction({
                title: 'Tạo kỳ công mới',
                fields: [
                  { key: 'periodCode', label: 'Mã kỳ công (VD: BC-2026-09)' },
                  { key: 'fromDate', label: 'Từ ngày', type: 'date' },
                  { key: 'toDate', label: 'Đến ngày', type: 'date' },
                ],
                submit: (v) => command('/timesheet-periods', v),
              })
            }
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="size-4" />
            <span>Tạo kỳ công</span>
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <span>{error}</span>
          </div>
          {error.includes('bất thường') && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setStatusFilter('ABNORMAL');
                setMatrix(false);
              }}
              className="text-xs bg-white text-red-700 border-red-300 hover:bg-red-100"
            >
              Lọc danh sách dòng bất thường để điều chỉnh
            </Button>
          )}
        </div>
      )}

      {/* 2. Master-Detail Layout */}
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left Sidebar: Periods */}
        <aside className="rounded-xl border border-slate-200 bg-white shadow-xs p-3 flex flex-col max-h-[calc(100vh-220px)]">
          <div className="px-2 py-1.5 mb-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Kỳ công ({periods.length})
            </span>
          </div>
          <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
            {periods.length === 0 && (
              <p className="text-xs text-slate-400 p-2">Chưa có kỳ công nào.</p>
            )}
            {periods.map((p) => {
              const isSelected = selected === p.id;
              const isLocked = p.status === 'LOCKED';
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/70 shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                  onClick={() => setSelected(p.id)}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <strong className="text-xs font-bold font-mono text-slate-900">{p.periodCode}</strong>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        isLocked
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {isLocked ? 'Đã khóa' : 'Mở'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {p.fromDate} → {p.toDate}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Content: Period Workspace */}
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
          {/* Action Toolbar */}
          <div className="mb-4 pb-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                permission="hrm.timesheet.calculate"
                disabled={!current || current.status === 'LOCKED' || busy}
                onClick={() =>
                  void command(`/timesheet-periods/${selected}/calculate`).catch(
                    () => undefined,
                  )
                }
                className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 shadow-xs"
              >
                <RefreshCw className="size-3.5" />
                <span>Tính lại bảng công</span>
              </Button>

              <Popconfirm
                title="Khóa kỳ công này?"
                description="Dữ liệu công sẽ được cố định làm đầu vào tính toán lương. Không thể chỉnh sửa thêm sau khi khóa."
                onConfirm={() => command(`/timesheet-periods/${selected}/lock`)}
                okText="Khóa kỳ"
                cancelText="Bỏ qua"
              >
                <Button
                  permission="hrm.timesheet.lock"
                  disabled={!current || current.status === 'LOCKED' || busy}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 shadow-xs"
                >
                  <Lock className="size-3.5" />
                  <span>Khóa kỳ</span>
                </Button>
              </Popconfirm>

              <Button
                permission="hrm.timesheet.reopen"
                variant="outline"
                disabled={current?.status !== 'LOCKED' || busy}
                onClick={() =>
                  setAction({
                    title: 'Mở lại kỳ công',
                    fields: [{ key: 'reason', label: 'Lý do mở lại kỳ' }],
                    submit: (v) =>
                      command(`/timesheet-periods/${selected}/reopen`, v),
                  })
                }
                className="flex items-center gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
              >
                <Unlock className="size-3.5" />
                <span>Mở lại kỳ</span>
              </Button>

              <Button
                permission="hrm.timesheet.calculate"
                variant="outline"
                disabled={
                  !current ||
                  current.status === 'LOCKED' ||
                  rows.length > 0 ||
                  busy
                }
                onClick={() =>
                  current &&
                  setAction({
                    title: 'Sửa kỳ công',
                    description:
                      'Chỉ sửa kỳ trống, chưa được kỳ lương tham chiếu.',
                    fields: [
                      {
                        key: 'periodCode',
                        label: 'Mã kỳ',
                        value: current.periodCode,
                      },
                      {
                        key: 'fromDate',
                        label: 'Từ ngày',
                        type: 'date',
                        value: current.fromDate,
                      },
                      {
                        key: 'toDate',
                        label: 'Đến ngày',
                        type: 'date',
                        value: current.toDate,
                      },
                      { key: 'reason', label: 'Lý do' },
                    ],
                    submit: (v) =>
                      command(
                        `/timesheet-periods/${current.id}`,
                        { ...v, expectedUpdatedAt: current.updatedAt },
                        'PATCH',
                      ),
                  })
                }
                className="flex items-center gap-1"
              >
                <Pencil className="size-3.5" />
                <span>Sửa kỳ</span>
              </Button>

              <Button
                permission="hrm.timesheet.calculate"
                variant="outline"
                disabled={
                  !current ||
                  current.status === 'LOCKED' ||
                  rows.length > 0 ||
                  busy
                }
                onClick={() =>
                  current &&
                  setAction({
                    title: 'Xóa kỳ công trống',
                    confirmTitle: 'Xóa kỳ công này?',
                    fields: [{ key: 'reason', label: 'Lý do xóa' }],
                    submit: (v) =>
                      command(
                        `/timesheet-periods/${current.id}`,
                        { ...v, expectedUpdatedAt: current.updatedAt },
                        'DELETE',
                      ),
                  })
                }
                className="flex items-center gap-1 text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa kỳ trống</span>
              </Button>
            </div>
          </div>

          {/* Search, Mode Toggle & Filters */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
              <div className="relative min-w-[200px] max-w-xs flex-1">
                <Input
                  aria-label="Tìm nhân viên trong bảng công"
                  placeholder="Tìm theo tên hoặc mã nhân viên…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="w-48">
                <SearchableSelect
                  aria-label="Lọc trạng thái công"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  placeholder="Tất cả trạng thái"
                  options={[
                    { value: '', label: 'Tất cả trạng thái' },
                    ...Object.entries(statuses).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
              </div>

              <Button
                variant="outline"
                onClick={() => setMatrix(!matrix)}
                className="flex items-center gap-1.5"
              >
                {matrix ? <List className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                <span>{matrix ? 'Dạng chi tiết từng ngày' : 'Dạng ma trận tháng'}</span>
              </Button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                permission="hrm.timesheet.export"
                variant="outline"
                disabled={!filteredRows.length}
                onClick={() =>
                  void hrmFetch<{ data: HrmTimesheet[] }>(
                    `/timesheet-periods/${selected}/export`,
                  )
                    .then((result) =>
                      exportRows(
                        result.data.filter(
                          (r) =>
                            `${r.employeeName || ''} ${r.employeeId}`
                              .toLocaleLowerCase('vi')
                              .includes(search.toLocaleLowerCase('vi')) &&
                            (!statusFilter || r.status === statusFilter),
                        ),
                        current?.periodCode || 'bang-cong',
                      ),
                    )
                    .catch((e) => setError(e.message))
                }
                className="flex items-center gap-1.5"
              >
                <Download className="size-3.5" />
                <span>Xuất CSV</span>
              </Button>
            </div>
          </div>

          {matrix ? (
            <div className="flex-1 min-h-0 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
              <MonthlyAttendanceMatrixTable
                title={current ? `Bảng công ma trận kỳ ${current.periodCode} (${current.fromDate} → ${current.toDate})` : 'Bảng công ma trận tháng'}
                employees={matrixEmployees}
                attendances={matrixAttendances}
                isLoading={busy}
                year={currentYear}
                month={currentMonth}
                hideHeader={false}
                embedded={true}
                footerExtra={
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                    <div className="flex items-center gap-4">
                      <span>Tổng nhân sự trong kỳ: <strong className="text-slate-900 font-bold">{matrixEmployees.length}</strong></span>
                      <span>Tổng số bản ghi công: <strong className="text-slate-900 font-bold">{rows.length}</strong></span>
                      <span>Trạng thái kỳ: <strong className={current?.status === 'LOCKED' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>{current?.status === 'LOCKED' ? 'Đã khóa' : 'Đang mở'}</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMatrix(false)}
                        className="text-xs h-7.5"
                      >
                        Chuyển sang dạng chi tiết từng ngày
                      </Button>
                    </div>
                  </div>
                }
              />
            </div>
          ) : (
            <Table<HrmTimesheet>
              size="small"
              rowKey="id"
              dataSource={filteredRows}
              pagination={{ pageSize: 20 }}
              scroll={{ x: 1400, y: 480 }}
              columns={[
                { title: 'Nhân viên', dataIndex: 'employeeName', width: 200 },
                { title: 'Ngày', dataIndex: 'workDate' },
                {
                  title: 'Trạng thái',
                  dataIndex: 'status',
                  render: (value: string) => statuses[value] || value,
                },
                { title: 'Định mức phút', dataIndex: 'scheduledMinutes' },
                { title: 'Phút thực tế', dataIndex: 'workedMinutes' },
                { title: 'Phút hưởng lương', dataIndex: 'paidMinutes' },
                { title: 'Công', dataIndex: 'workdayUnits' },
                { title: 'OT', dataIndex: 'otMinutes' },
                { title: 'Đi trễ', dataIndex: 'lateMinutes' },
                { title: 'Về sớm', dataIndex: 'earlyLeaveMinutes' },
                {
                  title: 'Điều chỉnh',
                  render: (_, r) => (
                    <Button
                      permission="hrm.timesheet.adjust"
                      variant="outline"
                      disabled={current?.status === 'LOCKED'}
                      onClick={() =>
                        setAction({
                          title: `Điều chỉnh công ${r.workDate}`,
                          fields: [
                            {
                              key: 'paidMinutes',
                              label: 'Phút hưởng lương',
                              type: 'number',
                              min: 0,
                              max: r.scheduledMinutes,
                              value: r.paidMinutes,
                            },
                            { key: 'reason', label: 'Căn cứ điều chỉnh' },
                          ],
                          submit: (v) =>
                            command(`/timesheets/${r.id}/adjust`, {
                              paidMinutes: Number(v.paidMinutes),
                              workdayUnits: r.scheduledMinutes
                                ? Math.round(
                                    (Number(v.paidMinutes) /
                                      r.scheduledMinutes) *
                                      100,
                                  ) / 100
                                : 0,
                              status: 'ADJUSTED',
                              expectedUpdatedAt: r.updatedAt,
                              reason: v.reason,
                            }),
                        })
                      }
                    >
                      Điều chỉnh
                    </Button>
                  ),
                },
              ]}
              expandable={{
                expandedRowRender: (r) => (
                  <div className="space-y-1 text-sm">
                    {r.adjustmentNeedsReview && (
                      <p className="font-semibold text-red-700">
                        Dữ liệu nguồn đã đổi sau điều chỉnh. Đối soát và xác
                        nhận lại số công trước khi khóa kỳ.
                      </p>
                    )}
                    <p>
                      Cách tính: phút hưởng lương / định mức ca = số công. OFF
                      không tính công; lễ theo lịch hưởng lương; phép/công tác
                      lấy từ đơn đã duyệt; OT chỉ tính thời gian thực tế trong
                      khung đã duyệt.
                    </p>
                    <p>
                      Múi giờ: {String(r.calculationSnapshot?.timezone || '—')}{' '}
                      · Loại ngày:{' '}
                      {String(r.calculationSnapshot?.dayKind || '—')}
                    </p>
                    <p>
                      Bất thường:{' '}
                      {(
                        r.calculationSnapshot?.anomalies as string[] | undefined
                      )?.join(', ') || 'Không'}
                    </p>
                    <p>
                      Phút phép hưởng lương:{' '}
                      {String(r.calculationSnapshot?.leaveMinutes || 0)}
                    </p>
                    <p>
                      OT quy đổi hệ số:{' '}
                      {String(r.calculationSnapshot?.weightedOtMinutes || 0)}{' '}
                      phút
                    </p>
                    {r.adjustedReason && (
                      <p>Căn cứ điều chỉnh: {r.adjustedReason}</p>
                    )}
                  </div>
                ),
              }}
            />
          )}
        </section>
      </div>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
