'use client';
import { useEffect, useMemo, useState } from 'react';
import { Table, type TableColumnsType } from 'antd';
import { FileSignature, Plus, Search } from 'lucide-react';
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
  APPLY_STEP_LABELS,
  DECISION_STATUSES,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TONES,
  DECISION_TYPES,
  DECISION_TYPE_LABELS,
  decisionRowActions,
  decisionSummary,
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
    const all = list.data ?? [];
    if (!q) return all;
    return all.filter((d) =>
      `${d.decisionNo} ${d.employeeCode ?? ''} ${d.employeeName ?? ''} ${d.reason}`
        .toLocaleLowerCase('vi')
        .includes(q),
    );
  }, [list.data, search]);

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
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <FileSignature className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Quyết định nhân sự</h1>
            <p className="text-xs text-slate-500">
              Bổ nhiệm, điều chuyển, miễn nhiệm, đổi quản lý trực tiếp kèm điều chỉnh lương.
            </p>
          </div>
        </div>
        <Button
          permission="hrm.appointment.manage"
          className="bg-blue-600 text-xs text-white hover:bg-blue-700"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" />
          Tạo quyết định
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs md:grid-cols-4">
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

      {list.error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {list.error}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <Table<HrmPersonnelDecision>
          size="small"
          rowKey="id"
          loading={list.loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1300, y: 'calc(100vh - 420px)' }}
          pagination={{ pageSize: 15, showSizeChanger: true }}
        />
      </section>

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
                      <DetailRow
                        label="Quản lý"
                        before={detail.fromManagerName ?? '----'}
                        after={
                          detail.managerMode === 'KEEP'
                            ? (detail.fromManagerName ?? '----')
                            : detail.managerMode === 'CLEAR'
                              ? 'Không có'
                              : (detail.toManagerName ?? '----')
                        }
                      />
                      <DetailRow
                        label="Lương cơ bản"
                        before={formatMoney(detail.fromBaseSalary)}
                        after={
                          detail.salaryChanged
                            ? `${formatMoney(detail.toBaseSalary)} (${detail.toSalaryType ?? ''})`
                            : formatMoney(detail.fromBaseSalary)
                        }
                      />
                      <DetailRow
                        label="Cấp dưới"
                        before="----"
                        after={
                          detail.subordinateMode === 'REASSIGN'
                            ? `Chuyển cho ${detail.subordinateTargetName ?? '----'}`
                            : 'Giữ nguyên'
                        }
                      />
                    </tbody>
                  </table>
                </section>
                <section>
                  <h4 className="mb-1 text-[11px] font-bold uppercase text-slate-700">
                    Tiến độ áp dụng (số lần thử: {detail.applyAttempts})
                  </h4>
                  <ul className="space-y-1">
                    {Object.entries(APPLY_STEP_LABELS).map(([key, label]) => {
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
