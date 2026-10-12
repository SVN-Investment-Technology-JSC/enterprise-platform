'use client';
import { useEffect, useMemo, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { Building2, ChevronDown, FileSignature, Plus, Search } from 'lucide-react';
import type {
  HrmPersonnelDecision,
  HrmPersonnelDecisionStatus,
  HrmPersonnelDecisionType,
} from '@enterprise-platform/contracts-hrm';
import {
  Popconfirm,
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { hrmEmployeeOptions } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import {
  runPersonnelDecisionCommand,
  usePersonnelDecisions,
  type PersonnelDecisionCommand,
} from '../hrm-personnel-decisions-api';
import {
  applyStepLabels,
  DECISION_STATUSES,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TONES,
  DECISION_TYPES,
  DECISION_TYPE_LABELS,
  decisionRowActions,
  decisionStats,
  decisionSummary,
  decisionUnitOf,
  groupDecisionsByUnit,
  formatDateVn,
  formatMoney,
} from '../personnel-decision-rules';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { PersonnelDecisionDialog } from '../ui/personnel-decision-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { toast } from '../ui/toast';

const typeOptions: SearchableSelectOption[] = DECISION_TYPES.map((t) => ({
  value: t,
  label: DECISION_TYPE_LABELS[t],
}));
const statusOptions: SearchableSelectOption[] = DECISION_STATUSES.map((s) => ({
  value: s,
  label: DECISION_STATUS_LABELS[s],
}));

function StatusBadge({ status }: { status: HrmPersonnelDecisionStatus }) {
  return (
    <Badge className={`border text-[10px] font-bold ${DECISION_STATUS_TONES[status]}`}>
      {DECISION_STATUS_LABELS[status]}
    </Badge>
  );
}

function DetailRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-2 text-slate-500">{label}</td>
      <td className="py-2 pr-2 font-semibold text-slate-800">{before}</td>
      <td className="py-2 font-semibold text-blue-700">{after}</td>
    </tr>
  );
}

export default function PersonnelDecisionsScreen() {
  const { can } = useHrmPermissions();
  const perms = {
    manage: can('hrm.appointment.manage'),
    approve: can('hrm.appointment.approve'),
  };
  const [typeFilter, setTypeFilter] = useState<HrmPersonnelDecisionType | ''>('');
  const [statusFilter, setStatusFilter] = useState<HrmPersonnelDecisionStatus | ''>('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  // Cách xem: nhóm theo phòng ban (mặc định) hoặc danh sách phẳng; các phòng ban đang thu gọn.
  const [view, setView] = useState<'unit' | 'flat'>('unit');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [employees, setEmployees] = useState<SearchableSelectOption[]>([]);
  const list = usePersonnelDecisions({
    type: typeFilter,
    status: statusFilter,
    employeeId: employeeFilter,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrmPersonnelDecision | null>(null);
  const [detail, setDetail] = useState<HrmPersonnelDecision | null>(null);
  const [rejecting, setRejecting] = useState<HrmPersonnelDecision | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void hrmEmployeeOptions()
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('vi');
    return (list.data ?? []).filter(
      (d) =>
        (!unitFilter || decisionUnitOf(d) === unitFilter) &&
        (!q ||
          `${d.decisionNo} ${d.employeeCode ?? ''} ${d.employeeName ?? ''} ${d.reason}`
            .toLocaleLowerCase('vi')
            .includes(q)),
    );
  }, [list.data, search, unitFilter]);
  // Số liệu và danh sách phòng ban tính trên toàn bộ quyết định đã tải; nhóm tính trên danh sách đang lọc.
  const stats = useMemo(() => decisionStats(list.data ?? []), [list.data]);
  const unitOptions = useMemo<SearchableSelectOption[]>(
    () =>
      groupDecisionsByUnit(list.data ?? []).map((g) => ({ value: g.unit, label: `${g.unit} (${g.rows.length})` })),
    [list.data],
  );
  const groups = useMemo(() => groupDecisionsByUnit(rows), [rows]);
  const toggleGroup = (unit: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });

  async function run(
    d: HrmPersonnelDecision,
    command: PersonnelDecisionCommand,
    okMessage: string,
    body: { reason?: string } = {},
  ) {
    setBusyId(d.id);
    try {
      const updated = await runPersonnelDecisionCommand(d.id, command, body);
      toast.success(okMessage);
      setDetail((cur) => (cur?.id === d.id ? updated : cur));
      list.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setBusyId('');
    }
  }

  function renderActions(d: HrmPersonnelDecision) {
    const a = decisionRowActions(d.status, perms);
    const busy = busyId === d.id;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetail(d)}>
          Chi tiết
        </Button>
        {a.edit && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => {
              setEditing(d);
              setDialogOpen(true);
            }}
          >
            Sửa
          </Button>
        )}
        {a.approve && (
          <Popconfirm
            title="Duyệt quyết định này?"
            description="Quyết định sẽ được áp dụng vào hồ sơ nhân viên."
            okText="Duyệt"
            okType="primary"
            onConfirm={() => run(d, 'approve', 'Đã duyệt quyết định')}
          >
            <Button size="sm" className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={busy}>
              Duyệt
            </Button>
          </Popconfirm>
        )}
        {a.reject && (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => {
              setRejectReason('');
              setRejecting(d);
            }}
          >
            Từ chối
          </Button>
        )}
        {a.cancel && (
          <Popconfirm
            title="Hủy quyết định nháp?"
            description="Quyết định bị hủy sẽ không thể phục hồi."
            okText="Hủy quyết định"
            cancelText="Giữ lại"
            onConfirm={() => run(d, 'cancel', 'Đã hủy quyết định')}
          >
            <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={busy}>
              Hủy
            </Button>
          </Popconfirm>
        )}
        {a.retry && (
          <Popconfirm
            title="Thử lại áp dụng quyết định?"
            description="Hệ thống chạy tiếp các bước chưa hoàn tất."
            okText="Thử lại"
            okType="primary"
            onConfirm={() => run(d, 'retry-apply', 'Đã gửi yêu cầu áp dụng lại')}
          >
            <Button size="sm" className="h-7 bg-amber-600 text-xs text-white hover:bg-amber-700" disabled={busy}>
              Thử lại áp dụng
            </Button>
          </Popconfirm>
        )}
      </div>
    );
  }

  const columns: TableColumnsType<HrmPersonnelDecision> = [
    {
      title: 'Số quyết định',
      dataIndex: 'decisionNo',
      width: 150,
      render: (v: string) => <span className="font-mono text-xs font-bold text-blue-700">{v}</span>,
    },
    {
      title: 'Nhân viên',
      width: 200,
      render: (_, d) => (
        <div>
          <span className="block text-xs font-semibold text-slate-900">{d.employeeName ?? '----'}</span>
          <span className="font-mono text-[11px] text-slate-500">{d.employeeCode ?? ''}</span>
        </div>
      ),
    },
    {
      title: 'Loại',
      dataIndex: 'decisionType',
      width: 150,
      render: (t: HrmPersonnelDecisionType) => <span className="text-xs">{DECISION_TYPE_LABELS[t]}</span>,
    },
    {
      title: 'Ngày hiệu lực',
      dataIndex: 'effectiveDate',
      width: 120,
      render: (v: string) => <span className="text-xs">{formatDateVn(v)}</span>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (s: HrmPersonnelDecisionStatus) => <StatusBadge status={s} />,
    },
    {
      title: 'Thay đổi (từ → đến)',
      render: (_, d) => <span className="text-xs text-slate-700">{decisionSummary(d)}</span>,
    },
    { title: 'Thao tác', width: 330, fixed: 'right', render: (_, d) => renderActions(d) },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Quyết định nhân sự</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Các quyết định bổ nhiệm, điều chuyển, miễn nhiệm, đổi quản lý trực tiếp kèm điều chỉnh lương của nhân sự công ty, xếp theo phòng ban.
          </p>
        </div>
        <Button
          permission="hrm.appointment.manage"
          size="sm"
          className="h-9 gap-1.5 text-xs font-semibold"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Tạo quyết định
        </Button>
      </div>

      <div aria-label="Tổng quan quyết định" className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(
          [
            ['total', 'Tổng quyết định', stats.total, 'bg-blue-50 text-blue-600', `${stats.units} phòng ban`],
            ['open', 'Đang xử lý', stats.open, 'bg-amber-50 text-amber-600', 'Nháp, đã duyệt, chờ áp dụng'],
            ['applied', 'Đã áp dụng', stats.applied, 'bg-emerald-50 text-emerald-600', 'Đã cập nhật hồ sơ'],
            ['closed', 'Từ chối / Hủy', stats.closed, 'bg-rose-50 text-rose-500', 'Không có hiệu lực'],
          ] as const
        ).map(([key, label, value, tone, note]) => (
          <div
            key={key}
            data-testid={`decision-stat-${key}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5"
          >
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <FileSignature className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
              <p className="font-mono text-xl font-bold leading-tight text-slate-900">{value}</p>
              <p className="truncate text-[11px] text-slate-500">{note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 pl-9 text-xs"
              aria-label="Tìm quyết định"
              placeholder="Tìm số quyết định, nhân viên, lý do"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SearchableSelect
            options={unitOptions}
            value={unitFilter}
            placeholder="Tất cả phòng ban"
            clearable
            onChange={setUnitFilter}
          />
          <SearchableSelect
            options={typeOptions}
            value={typeFilter}
            placeholder="Tất cả loại"
            clearable
            onChange={(v) => setTypeFilter(v as HrmPersonnelDecisionType | '')}
          />
          <SearchableSelect
            options={statusOptions}
            value={statusFilter}
            placeholder="Tất cả trạng thái"
            clearable
            onChange={(v) => setStatusFilter(v as HrmPersonnelDecisionStatus | '')}
          />
          <SearchableSelect
            options={employees}
            value={employeeFilter}
            placeholder="Tất cả nhân viên"
            clearable
            onChange={setEmployeeFilter}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Cách xem" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            {(
              [
                ['unit', 'Theo phòng ban'],
                ['flat', 'Danh sách'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`rounded-md px-3 py-1.5 transition ${
                  view === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'unit' && groups.length > 1 && (
            <div className="flex items-center gap-1 text-xs">
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setCollapsed(new Set())}>
                Mở rộng tất cả
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setCollapsed(new Set(groups.map((g) => g.unit)))}
              >
                Thu gọn tất cả
              </Button>
            </div>
          )}
        </div>
      </div>

      {list.error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {list.error}
        </div>
      )}

      {view === 'unit' ? (
        <div className="space-y-2">
          {list.loading && rows.length === 0 ? (
            <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
              Đang tải quyết định nhân sự...
            </p>
          ) : groups.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
              Chưa có quyết định nhân sự nào phù hợp với bộ lọc.
            </p>
          ) : (
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.unit);
              return (
                <section
                  key={group.unit}
                  aria-label={`Phòng ban ${group.unit}`}
                  data-testid={`decision-group-${group.unit}`}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                >
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleGroup(group.unit)}
                    className="flex w-full items-center gap-2.5 bg-slate-50/80 px-4 py-2.5 text-left hover:bg-slate-100/70"
                  >
                    <ChevronDown className={`size-4 shrink-0 text-slate-500 transition ${isCollapsed ? '-rotate-90' : ''}`} />
                    <Building2 className="size-4 shrink-0 text-blue-600" />
                    <span className="text-sm font-bold text-slate-900">{group.unit}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {group.rows.length} quyết định
                    </span>
                    {group.open > 0 && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        {group.open} đang xử lý
                      </span>
                    )}
                    {group.applied > 0 && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        {group.applied} đã áp dụng
                      </span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <Table<HrmPersonnelDecision>
                      size="small"
                      rowKey="id"
                      dataSource={[...group.rows]}
                      columns={columns}
                      scroll={{ x: 1300 }}
                      pagination={group.rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
                    />
                  )}
                </section>
              );
            })
          )}
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <Table<HrmPersonnelDecision>
            size="small"
            rowKey="id"
            loading={list.loading}
            dataSource={rows}
            columns={[
              {
                title: 'Phòng ban',
                width: 170,
                render: (_: unknown, d: HrmPersonnelDecision) => <span className="text-xs">{decisionUnitOf(d)}</span>,
              },
              ...columns,
            ]}
            scroll={{ x: 1470, y: 'calc(100vh - 460px)' }}
            pagination={{ pageSize: 15, showSizeChanger: true }}
          />
        </section>
      )}

      <PersonnelDecisionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        decision={editing}
        onSaved={() => list.reload()}
      />

      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="border-b border-slate-200 p-4">
            <DialogTitle className="text-sm font-bold">
              Từ chối quyết định {rejecting?.decisionNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 p-4 text-xs">
            <label className="block font-semibold text-slate-700">
              Lý do từ chối
              <textarea
                className="mt-1 h-24 w-full rounded-lg border border-slate-200 p-2 text-xs outline-none focus:border-blue-500"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-3">
            <Button size="sm" variant="outline" onClick={() => setRejecting(null)}>
              Đóng
            </Button>
            <Popconfirm
              title="Xác nhận từ chối quyết định?"
              okText="Từ chối"
              disabled={!rejectReason.trim()}
              onConfirm={async () => {
                if (!rejecting) return;
                await run(rejecting, 'reject', 'Đã từ chối quyết định', {
                  reason: rejectReason.trim(),
                });
                setRejecting(null);
              }}
            >
              <Button size="sm" variant="destructive" disabled={!rejectReason.trim()}>
                Từ chối
              </Button>
            </Popconfirm>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full max-w-[680px] p-0">
          {detail && (
            <>
              <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-5">
                <div className="flex items-center justify-between pr-10">
                  <span className="font-mono text-xs font-bold text-blue-700">{detail.decisionNo}</span>
                  <StatusBadge status={detail.status} />
                </div>
                <SheetTitle className="text-base font-bold">
                  {DECISION_TYPE_LABELS[detail.decisionType]} · {detail.employeeName ?? detail.employeeId}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Hiệu lực từ {formatDateVn(detail.effectiveDate)}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-xs">
                <section>
                  <h4 className="mb-1 text-[11px] font-bold uppercase text-slate-700">Lý do / căn cứ</h4>
                  <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{detail.reason}</p>
                  {detail.rejectedReason && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                      Lý do từ chối: {detail.rejectedReason}
                    </p>
                  )}
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-bold uppercase text-slate-700">Trước / Sau</h4>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[11px] uppercase text-slate-400">
                        <th className="w-28 pb-1" />
                        <th className="pb-1">Trước</th>
                        <th className="pb-1">Sau</th>
                      </tr>
                    </thead>
                    <tbody>
                      <DetailRow
                        label="Chức danh"
                        before={detail.fromPositionName ?? '----'}
                        after={detail.toPositionName ?? detail.fromPositionName ?? '----'}
                      />
                      <DetailRow
                        label="Đơn vị"
                        before={detail.fromUnitName ?? '----'}
                        after={detail.toUnitName ?? detail.fromUnitName ?? '----'}
                      />
                      {detail.managerMode !== 'KEEP' && (
                        <DetailRow
                          label="Quản lý (cũ)"
                          before={detail.fromManagerName ?? '----'}
                          after={detail.managerMode === 'CLEAR' ? 'Không có' : (detail.toManagerName ?? '----')}
                        />
                      )}
                      <DetailRow
                        label="Lương cơ bản"
                        before={formatMoney(detail.fromBaseSalary)}
                        after={
                          detail.salaryChanged
                            ? `${formatMoney(detail.toBaseSalary)} (${detail.toSalaryType ?? ''})`
                            : formatMoney(detail.fromBaseSalary)
                        }
                      />
                      {detail.subordinateMode === 'REASSIGN' && (
                        <DetailRow
                          label="Cấp dưới (cũ)"
                          before="----"
                          after={`Chuyển cho ${detail.subordinateTargetName ?? '----'}`}
                        />
                      )}
                    </tbody>
                  </table>
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-bold uppercase text-slate-700">
                    Tiến độ áp dụng (số lần thử: {detail.applyAttempts})
                  </h4>
                  <ul className="space-y-1">
                    {applyStepLabels(detail).map(([key, label]) => {
                      const done = detail.appliedSteps?.[key];
                      return (
                        <li key={key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5">
                          <span>{label}</span>
                          <Badge
                            className={`border text-[10px] ${
                              done
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}
                          >
                            {done ? 'Hoàn tất' : 'Chưa áp dụng'}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                  {detail.applyError && (
                    <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 font-semibold text-red-700">
                      Lỗi áp dụng: {detail.applyError}
                    </p>
                  )}
                  {detail.appliedAt && (
                    <p className="mt-2 text-slate-500">Áp dụng lúc {formatDateVn(detail.appliedAt)}</p>
                  )}
                </section>
                <section className="text-slate-500">
                  <p>Duyệt bởi: {detail.approvedBy ?? '----'} ({formatDateVn(detail.approvedAt)})</p>
                  <p>Tạo bởi: {detail.createdBy ?? '----'} ({formatDateVn(detail.createdAt)})</p>
                </section>
              </div>
              <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-4">{renderActions(detail)}</div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
