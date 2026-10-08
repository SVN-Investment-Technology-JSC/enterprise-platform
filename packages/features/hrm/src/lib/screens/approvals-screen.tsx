'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table } from 'antd';
import { SearchableSelect, Popconfirm } from '@enterprise-platform/shared-ui';
import {
  RefreshCw,
  CheckCircle2,
  FileText,
  ExternalLink,
  Clock,
  Calendar,
  Paperclip,
  Workflow,
  Layers,
} from 'lucide-react';
import type { HrmAction as Permission } from '@enterprise-platform/contracts-identity';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../ui/sheet';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';
import {
  ProcedureProgressPanel,
  useProcedureProgress,
} from '../ui/procedure-progress-panel';
import { ProcedureActionBar } from '../ui/procedure-action-bar';
import {
  approvalErrorMessage,
  procedureActionBody,
  procedureFieldsOf,
  workflowFilterQuery,
  waitingApproverLabel,
  isTerminalProcedureStatus,
  type ProcedureActionKind,
} from '../procedure-progress-view';

type Source = {
  kind: string;
  label: string;
  path: string;
  permission: Permission;
};
const sources: Source[] = [
  {
    kind: 'LEAVE',
    label: 'Nghỉ phép',
    path: 'leave-requests',
    permission: 'hrm.leave.approve',
  },
  {
    kind: 'OT',
    label: 'Tăng ca',
    path: 'ot-requests',
    permission: 'hrm.ot.approve',
  },
  {
    kind: 'BUSINESS_TRIP',
    label: 'Công tác',
    path: 'business-trip-requests',
    permission: 'hrm.trip.approve',
  },
  {
    kind: 'SHIFT_CHANGE',
    label: 'Đổi ca',
    path: 'shift-change-requests',
    permission: 'hrm.shift.approve',
  },
  {
    kind: 'ATTENDANCE',
    label: 'Giải trình công',
    path: 'attendance-corrections',
    permission: 'hrm.attendance.approve',
  },
  {
    kind: 'PROFILE',
    label: 'Sửa hồ sơ',
    path: 'profile-corrections',
    permission: 'hrm.profile.approve',
  },
  {
    kind: 'ADVANCE',
    label: 'Tạm ứng',
    path: 'salary-advance-requests',
    permission: 'hrm.advance.approve',
  },
];
type Raw = {
  id: string;
  employeeId?: string;
  employee_id?: string;
  status: string;
  reason?: string;
  createdAt?: string;
  created_at?: string;
  fromDate?: string;
  toDate?: string;
  workDate?: string;
  requestDate?: string;
  duration?: number;
  plannedMinutes?: number;
  requestedAmount?: number;
  attachmentFileId?: string;
  changes?: Record<string, unknown>;
  [key: string]: unknown;
};
type Link = {
  id: string;
  request_kind: string;
  request_id: string;
  instance_code: string;
  status: string;
  last_error: string;
  instance_id?: string;
  revision?: number;
};
type Row = Raw & {
  key: string;
  source: Source;
  employeeName: string;
  employeeCode: string;
  created: string;
  period: string;
  link?: Link;
};
const detailFields: Record<string, string> = {
  duration: 'Số lượng nghỉ',
  startTime: 'Bắt đầu',
  endTime: 'Kết thúc',
  plannedMinutes: 'Phút OT đăng ký',
  approvedMinutes: 'Phút OT được duyệt',
  destination: 'Địa điểm công tác',
  allowOt: 'Cho phép OT',
  daysCount: 'Số ngày công tác',
  workReference: 'Đầu việc liên kết',
  requestedAmount: 'Tạm ứng đề nghị',
  approvedAmount: 'Tạm ứng được duyệt',
  numberOfInstallments: 'Số kỳ thu hồi',
  currentShiftId: 'Mã ca hiện tại',
  requestedShiftId: 'Mã ca đề nghị',
  swapWithEmployeeId: 'Mã người đổi cùng',
  correctedSessions: 'Các phiên công đề nghị',
  newCheckInAt: 'Giờ vào đề nghị',
  newCheckOutAt: 'Giờ ra đề nghị',
};
const states: Record<string, string> = {
  PENDING: 'Chờ duyệt',
  PEER_CONFIRMED: 'Đã xác nhận đổi ca',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã rút / hủy',
  DISBURSED: 'Đã giải ngân',
  REPAID: 'Đã thu hồi',
};
export default function ApprovalsScreen() {
  const permissions = useHrmPermissions(),
    permissionKey = permissions.actions.join('|');
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState(''),
    [status, setStatus] = useState('PENDING'),
    [assignee, setAssignee] = useState(''),
    [currentStep, setCurrentStep] = useState(''),
    [debouncedAssignee, setDebouncedAssignee] = useState(''),
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<React.Key[]>([]),
    [action, setAction] = useState<HrmAction | null>(null);
  const [linkedId, setLinkedId] = useState('');
  // Cảnh báo khi người duyệt không có cấp dưới do thiếu "Báo cáo cho"/trưởng đơn vị.
  const [scopeWarning, setScopeWarning] = useState('');
  useEffect(() => {
    let active = true;
    hrmFetch<{ data: { noReportingLine: boolean; message: string | null } }>(
      '/approval-scope',
    )
      .then((res) => {
        if (active) setScopeWarning(res.data.noReportingLine ? (res.data.message ?? '') : '');
      })
      .catch(() => {
        if (active) setScopeWarning('');
      });
    return () => {
      active = false;
    };
  }, []);
  // Bước đã gặp: giữ lại để danh sách chọn không co lại sau khi lọc.
  const [stepOptions, setStepOptions] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAssignee(assignee), 300);
    return () => clearTimeout(timer);
  }, [assignee]);
  const [linkedRequestId, setLinkedRequestId] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('request');
    if (id) {
      setLinkedRequestId(id);
      setStatus('');
    }
  }, []);
  useEffect(() => {
    if (!linkedRequestId) return;
    const row = rows.find((item) => item.id === linkedRequestId);
    if (row) { setDetail(row); setLinkedRequestId(''); }
  }, [rows, linkedRequestId]);
  useEffect(
    () =>
      setLinkedId(
        new URLSearchParams(window.location.search).get('workflow') || '',
      ),
    [],
  );
  useEffect(() => {
    if (!linkedId) return;
    const row = rows.find((r) => r.link?.id === linkedId);
    if (row) {
      setDetail(row);
      setLinkedId('');
    }
  }, [rows, linkedId]);
  const load = useCallback(async () => {
    const available = sources.filter((s) =>
      s.kind === 'ADVANCE'
        ? permissionKey.split('|').includes('hrm.advance.read')
        : permissionKey.split('|').includes('hrm.request.read'),
    );
    const [employees, links, ...lists] = await Promise.all([
      hrmEmployeeOptions(true),
      hrmFetch<{ data: Link[] }>('/request-workflows'),
      ...available.map((s) =>
        hrmFetch<{ data: Raw[] }>(
          `/${s.path}?${[
            'forApproval=1',
            workflowFilterQuery({ assignee: debouncedAssignee, currentStep }),
          ]
            .filter(Boolean)
            .join('&')}`,
        ),
      ),
    ]);
    const seenSteps = lists.flatMap((list) =>
      list.data
        .map((r) => procedureFieldsOf(r).currentStepName)
        .filter((name): name is string => Boolean(name)),
    );
    if (seenSteps.length)
      setStepOptions((prev) =>
        [...new Set([...prev, ...seenSteps])].sort((a, b) => a.localeCompare(b, 'vi')),
      );
    const names = new Map(employees.map((e) => [e.value, e.label]));
    setRows(
      lists
        .flatMap((list, i) =>
          list.data.map((r) => ({
            ...r,
            key: `${available[i].kind}:${r.id}`,
            source: available[i],
            employeeName:
              names.get(r.employeeId || r.employee_id || '') ||
              r.employeeId ||
              r.employee_id ||
              '—',
            employeeCode: '',
            created: r.createdAt || r.created_at || '',
            period: r.fromDate
              ? `${r.fromDate} → ${r.toDate}`
              : r.workDate || r.requestDate || '',
            link: links.data.find(
              (l) =>
                l.request_id === r.id && l.request_kind === available[i].kind,
            ),
          })),
        )
        .sort((a, b) => b.created.localeCompare(a.created)),
    );
  }, [permissionKey, debouncedAssignee, currentStep]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const eligible = (r: Row) =>
    permissions.can(r.source.permission) &&
    ['PENDING', 'PEER_CONFIRMED'].includes(r.status) &&
    !r.link;
  const instanceIdOf = (r: Row) =>
    procedureFieldsOf(r).instanceId ?? r.link?.instance_id;
  // Đơn đi theo quy trình PE: thao tác qua PE khi quy trình còn chạy; PE kiểm quyền.
  const procedureActionable = (r: Row) =>
    permissions.can(r.source.permission) &&
    ['PENDING', 'PEER_CONFIRMED'].includes(r.status) &&
    r.link?.status === 'RUNNING';
  const detailInstanceId = detail ? instanceIdOf(detail) : undefined;
  const {
    progress: detailProgress,
    loading: detailProgressLoading,
    refresh: refreshDetailProgress,
  } = useProcedureProgress({
    instanceId: detailInstanceId,
    kind: detail?.source.kind ?? '',
    requestId: detail?.id ?? '',
    open: Boolean(detail),
  });
  async function procedureAction(
    r: Row,
    action: ProcedureActionKind,
    comment: string,
  ) {
    setBusy(true);
    setError('');
    try {
      await hrmFetch(`/requests/${r.source.kind}/${r.id}/actions`, {
        method: 'POST',
        body: JSON.stringify(
          procedureActionBody(action, {
            comment,
            idempotencyKey: crypto.randomUUID(),
            revision: procedureFieldsOf(r).revision ?? r.link?.revision,
          }),
        ),
      });
      await Promise.all([refreshDetailProgress(true), load()]);
    } catch (e) {
      setError(approvalErrorMessage(e, 'procedure'));
      // 403/409: tiến độ có thể đã đổi (đã có người xử lý), làm mới để phản ánh.
      void refreshDetailProgress(true);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setDetail((current) =>
      current ? (rows.find((r) => r.key === current.key) ?? current) : current,
    );
  }, [rows]);
  const normalized = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .toLowerCase();
  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!kind || r.source.kind === kind) &&
          (!status ||
            (status === 'PENDING'
              ? ['PENDING', 'PEER_CONFIRMED'].includes(r.status)
              : r.status === status)) &&
          normalized(`${r.employeeName} ${r.reason || ''} ${r.id}`).includes(
            normalized(search),
          ),
      ),
    [rows, kind, status, search],
  );
  async function transition(
    r: Row,
    target: 'approve' | 'reject',
    body: unknown = {},
  ) {
    await hrmFetch(`/${r.source.path}/${r.id}/${target}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  async function approve(r: Row) {
    setBusy(true);
    setError('');
    try {
      await transition(r, 'approve');
      setDetail(null);
      await load();
    } catch (e) {
      setError(approvalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function reject(r: Row, reason: string) {
    setBusy(true);
    setError('');
    try {
      await transition(r, 'reject', { reason });
      setDetail(null);
      await load();
    } catch (e) {
      setError(approvalErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function batch() {
    setBusy(true);
    setError('');
    let done = 0;
    try {
      for (const r of rows.filter(
        (r) => selected.includes(r.key) && eligible(r),
      )) {
        await transition(r, 'approve');
        done++;
      }
      setSelected([]);
      await load();
    } catch (e) {
      setError(
        `Đã duyệt ${done} đơn; dừng tại lỗi: ${approvalErrorMessage(e)}`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  function reverse(r: Row) {
    const kind =
      r.source.kind === 'ATTENDANCE'
        ? 'correction'
        : r.source.kind.toLowerCase();
    setAction({
      title: `Hủy hiệu lực ${r.source.label.toLowerCase()}`,
      description:
        'Giữ lịch sử phê duyệt, đảo hiệu lực nghiệp vụ và yêu cầu tính lại kỳ công. Kỳ đã khóa hoặc tạm ứng đã chi không thể hủy.',
      confirmTitle: 'Xác nhận hủy hiệu lực đơn đã duyệt?',
      fields: [{ key: 'reason', label: 'Lý do hủy hiệu lực' }],
      submit: async (v) => {
        await hrmFetch(`/requests/${kind}/${r.id}/reverse`, {
          method: 'POST',
          body: JSON.stringify({
            reason: v.reason,
            expectedUpdatedAt: r.updatedAt || r.updated_at,
          }),
        });
        setDetail(null);
        await load();
      },
    });
  }

  const statusBadgeClass = (s: string) => {
    switch (s) {
      case 'APPROVED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'REJECTED':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'CANCELLED':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'PENDING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'PEER_CONFIRMED':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'DISBURSED':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'REPAID':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const pendingCount = visible.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Page Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Hộp Xử lý Đơn từ & Phê duyệt
            </h1>
            <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-xs font-semibold">
              {pendingCount} đơn chờ duyệt
            </Badge>
          </div>
          <p className="text-xs text-slate-500 max-w-[85ch]">
            Kiểm tra nội dung, hạn mức chính sách và đối soát quy trình tự động trước khi phê duyệt áp dụng vào công, phép, lương.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => void load().catch((e) => setError(e.message))}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            <span>Làm mới</span>
          </Button>
          <a
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-blue-600 transition-colors shadow-xs"
            href="/modules/hrm/leave-settings"
          >
            <FileText className="size-3.5" />
            <span>Quỹ phép & Sổ phép</span>
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs">
          {error}
        </div>
      )}

      {scopeWarning && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800 shadow-xs"
        >
          {scopeWarning}
        </div>
      )}

      {/* 2. Main Data Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Controls & Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
            <div className="relative min-w-[240px] max-w-sm flex-1">
              <Input
                aria-label="Tìm đơn"
                placeholder="Tìm nhân viên, mã đơn, lý do…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-3"
              />
            </div>
            <div className="w-48">
              <SearchableSelect
                value={kind}
                onChange={(v) => setKind(v || '')}
                clearable
                placeholder="Tất cả loại đơn"
                options={sources.map((s) => ({ value: s.kind, label: s.label }))}
              />
            </div>
            <div className="min-w-[200px] w-52">
              <Input
                aria-label="Đang chờ ai duyệt"
                placeholder="Đang chờ ai duyệt (tên, chức danh)"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="pl-3"
              />
            </div>
            <div className="w-52">
              <SearchableSelect
                value={currentStep}
                onChange={(v) => setCurrentStep(v || '')}
                clearable
                placeholder="Bước hiện tại"
                options={stepOptions.map((name) => ({ value: name, label: name }))}
              />
            </div>
            <div className="w-48">
              <SearchableSelect
                value={status}
                onChange={(v) => setStatus(v || '')}
                clearable
                placeholder="Tất cả trạng thái"
                options={Object.entries(states)
                  .filter(([v]) => v !== 'PEER_CONFIRMED')
                  .map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Popconfirm
              title={`Duyệt ${selected.length} đơn đã chọn?`}
              description="Các đơn liên kết Procedure được xử lý tại quy trình tương ứng."
              onConfirm={batch}
            >
              <Button disabled={busy || !selected.length} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <CheckCircle2 className="size-3.5 mr-1.5" />
                Duyệt đã chọn ({selected.length})
              </Button>
            </Popconfirm>
          </div>
        </div>

        {/* Data Table */}
        <Table<Row>
          rowKey="key"
          dataSource={visible}
          size="small"
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (r) => ({ disabled: busy || !eligible(r) }),
          }}
          pagination={{
            pageSize: 30,
            showSizeChanger: true,
            showTotal: (t, range) => `Hiển thị ${range[0]}–${range[1]} / ${t} đơn`,
          }}
          scroll={{ x: 1450, y: 'calc(100dvh - 350px)' }}
          columns={[
            {
              title: 'Nhân viên',
              dataIndex: 'employeeName',
              fixed: 'left',
              width: 220,
              sorter: (a, b) => a.employeeName.localeCompare(b.employeeName),
              render: (_, r) => (
                <div>
                  <strong className="text-slate-900 font-semibold">{r.employeeName}</strong>
                  <p className="text-[11px] text-slate-500 font-mono">{r.employeeCode}</p>
                </div>
              ),
            },
            {
              title: 'Loại đơn',
              width: 140,
              render: (_, r) => (
                <span className="font-medium text-slate-800">{r.source.label}</span>
              ),
            },
            {
              title: 'Thời gian',
              dataIndex: 'period',
              width: 180,
              render: (v) => <span className="text-xs text-slate-700 font-mono">{v || '—'}</span>,
            },
            {
              title: 'Khối lượng',
              width: 120,
              render: (_, r) =>
                r.requestedAmount !== undefined ? (
                  <span className="font-semibold text-emerald-700 font-mono">
                    {Number(r.requestedAmount).toLocaleString('vi-VN')} đ
                  </span>
                ) : r.plannedMinutes !== undefined ? (
                  <span className="font-medium text-slate-700 font-mono">{r.plannedMinutes} phút</span>
                ) : r.duration !== undefined ? (
                  <span className="font-medium text-slate-700">{r.duration}</span>
                ) : (
                  '—'
                ),
            },
            {
              title: 'Lý do',
              dataIndex: 'reason',
              ellipsis: true,
              render: (v) => <span className="text-xs text-slate-600">{v || '—'}</span>,
            },
            {
              title: 'Trạng thái',
              width: 140,
              render: (_, r) => (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass(r.status)}`}>
                  {states[r.status] || r.status}
                </span>
              ),
            },
            {
              title: 'Quy trình',
              width: 240,
              render: (_, r) =>
                r.link ? (
                  <div className="space-y-0.5">
                    <a
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-mono"
                      href="/modules/procedure"
                    >
                      <span>{r.link.instance_code || 'Chờ khởi tạo'}</span>
                      <ExternalLink className="size-3" />
                    </a>
                    {(() => {
                      const f = procedureFieldsOf(r);
                      const label = waitingApproverLabel({
                        assigneeName: f.currentAssigneeName,
                        stepName: f.currentStepName,
                      });
                      return label ? (
                        <p className="text-[11px] text-slate-600">{label}</p>
                      ) : null;
                    })()}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">Duyệt trực tiếp</span>
                ),
            },
            {
              title: 'Thao tác',
              fixed: 'right',
              width: 210,
              render: (_, r) => (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setDetail(r)}
                  >
                    Chi tiết
                  </Button>
                  {r.status === 'APPROVED' &&
                    [
                      'LEAVE',
                      'OT',
                      'BUSINESS_TRIP',
                      'ATTENDANCE',
                      'ADVANCE',
                    ].includes(r.source.kind) &&
                    permissions.can(r.source.permission) && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busy}
                        onClick={() => reverse(r)}
                        className="text-amber-700 border-amber-200 hover:bg-amber-50"
                      >
                        Hủy hiệu lực
                      </Button>
                    )}
                  {eligible(r) && (
                    <>
                      <Popconfirm
                        title="Phê duyệt đơn này?"
                        description="Hành động này sẽ áp dụng các thay đổi vào hồ sơ công/phép/lương."
                        onConfirm={() => approve(r)}
                        okText="Phê duyệt"
                        cancelText="Bỏ qua"
                      >
                        <Button
                          size="xs"
                          disabled={busy}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Duyệt
                        </Button>
                      </Popconfirm>
                      <Popconfirm
                        title="Từ chối yêu cầu?"
                        description="Vui lòng cung cấp lý do từ chối."
                        okText="Từ chối"
                        cancelText="Hủy"
                        okType="danger"
                        reasonRequired
                        reasonPlaceholder="Nhập lý do từ chối..."
                        onConfirm={(reason) => reject(r, reason || '')}
                      >
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          className="text-red-700 border-red-200 hover:bg-red-50"
                        >
                          Từ chối
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* DRAWER CHI TIẾT ĐƠN DUYỆT */}
      <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-[680px] p-0 h-full max-h-screen overflow-hidden bg-white flex flex-col shadow-2xl">
          {detail && (
            <>
              {/* 1. Header */}
              <SheetHeader className="shrink-0 p-5 border-b border-slate-200 bg-slate-50/80">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs font-semibold px-2.5 py-0.5">
                      {detail.source.label}
                    </Badge>
                    <span className="text-slate-300">•</span>
                    <span className="font-mono text-xs text-slate-500 font-medium">
                      #{detail.id.slice(-8).toUpperCase()}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeClass(
                      detail.status,
                    )}`}
                  >
                    {states[detail.status] || detail.status}
                  </span>
                </div>

                <div className="mt-3">
                  <SheetTitle className="text-base font-bold text-slate-900 flex items-center gap-2.5">
                    <div className="size-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-200/60">
                      {detail.employeeName
                        ? detail.employeeName.charAt(0).toUpperCase()
                        : 'U'}
                    </div>
                    <div>
                      <span>{detail.employeeName}</span>
                      {detail.employeeCode && (
                        <span className="font-mono text-xs font-normal text-slate-500 ml-2">
                          ({detail.employeeCode})
                        </span>
                      )}
                    </div>
                  </SheetTitle>
                  <SheetDescription className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
                    <Clock className="size-3.5 text-slate-400" />
                    <span>
                      Ngày gửi:{' '}
                      {detail.created
                        ? new Date(detail.created).toLocaleString('vi-VN')
                        : '—'}
                    </span>
                  </SheetDescription>
                </div>
              </SheetHeader>

              {/* 2. Scrollable Body */}
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 text-xs">
                {/* Block 1: Thẻ thông tin thời gian áp dụng */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                    <span className="text-[11px] text-slate-400 block font-medium flex items-center gap-1">
                      <Calendar className="size-3.5 text-blue-600" />
                      Thời gian áp dụng
                    </span>
                    <span className="font-semibold text-slate-900 block text-xs">
                      {detail.period || '—'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                    <span className="text-[11px] text-slate-400 block font-medium flex items-center gap-1">
                      <Workflow className="size-3.5 text-indigo-600" />
                      Phương thức duyệt
                    </span>
                    <span className="font-semibold text-slate-900 block text-xs">
                      {detail.link ? 'Liên kết Procedure Engine' : 'Phê duyệt trực tiếp'}
                    </span>
                  </div>
                </div>

                {/* Block 2: Lý do & Mục đích */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <FileText className="size-3.5 text-blue-600" />
                    Lý do & Nội dung đề xuất
                  </span>
                  <p className="text-xs text-slate-800 leading-relaxed font-medium whitespace-pre-wrap">
                    {detail.reason || 'Không có lý do kèm theo.'}
                  </p>
                </div>

                {/* Block 3: Chi tiết các thông số kỹ thuật */}
                {Object.entries(detailFields).some(
                  ([k]) => detail[k] !== undefined && detail[k] !== null,
                ) && (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                      <div className="p-3.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <Layers className="size-3.5 text-blue-600" />
                          Thông số chi tiết
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {Object.entries(detailFields)
                          .filter(
                            ([key]) =>
                              detail[key] !== undefined && detail[key] !== null,
                          )
                          .map(([key, label]) => {
                            const val = detail[key];
                            return (
                              <div
                                key={key}
                                className="px-4 py-2.5 flex items-start justify-between gap-4 text-xs hover:bg-slate-50/50 transition-colors"
                              >
                                <span className="text-slate-500 font-medium shrink-0">
                                  {label}
                                </span>
                                <span className="font-semibold text-slate-900 text-right break-all">
                                  {typeof val === 'boolean' ? (
                                    val ? (
                                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                                        Có
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-[10px]">
                                        Không
                                      </Badge>
                                    )
                                  ) : typeof val === 'number' && key.toLowerCase().includes('amount') ? (
                                    <span className="font-mono text-emerald-700">
                                      {val.toLocaleString('vi-VN')} đ
                                    </span>
                                  ) : typeof val === 'number' && key.toLowerCase().includes('minutes') ? (
                                    <span className="font-mono text-blue-700">
                                      {val} phút
                                    </span>
                                  ) : typeof val === 'object' ? (
                                    <pre className="font-mono text-[11px] bg-slate-50 p-2 rounded border border-slate-200 text-left max-w-full overflow-x-auto">
                                      {JSON.stringify(val, null, 2)}
                                    </pre>
                                  ) : (
                                    String(val)
                                  )}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                {/* Block 4: Đề xuất sửa đổi thông tin (Nếu có) */}
                {detail.changes && Object.keys(detail.changes).length > 0 && (
                  <div className="rounded-xl border border-blue-200/80 bg-blue-50/30 p-4 space-y-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                      <Layers className="size-3.5 text-blue-600" />
                      Nội dung đề xuất cập nhật hồ sơ
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {Object.entries(detail.changes).map(([k, v]) => (
                        <div
                          key={k}
                          className="p-2.5 rounded-lg bg-white border border-slate-200/80 space-y-1"
                        >
                          <span className="text-[11px] text-slate-500 block">
                            {k}
                          </span>
                          <span className="font-semibold text-slate-900 block break-all">
                            {String(v ?? '—')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Block 5: Tệp chứng từ đính kèm (Nếu có) */}
                {detail.attachmentFileId && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between shadow-2xs">
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                        <Paperclip className="size-4" />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 block text-xs">
                          Tệp chứng từ / Minh chứng đính kèm
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          ID: {detail.attachmentFileId}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-8 text-blue-700 border-blue-200 hover:bg-blue-50 flex items-center gap-1.5"
                      onClick={async () => {
                        try {
                          const file = await hrmFetch<{ data: { url: string } }>(
                            `/attachments/${detail.attachmentFileId}/download`,
                          );
                          window.open(file.data.url, '_blank', 'noopener,noreferrer');
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : 'Không tải được chứng từ',
                          );
                        }
                      }}
                    >
                      <ExternalLink className="size-3.5" />
                      <span>Xem chứng từ</span>
                    </Button>
                  </div>
                )}

                {/* Block 6: Liên kết Procedure Engine */}
                {detail.link && (
                  <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-950 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                        <Workflow className="size-3.5 text-indigo-600" />
                        Quy trình Procedure Engine liên kết
                      </span>
                      <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-[10px] font-mono">
                        {detail.link.status}
                      </Badge>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                      <div>
                        <span className="text-slate-500 text-[11px]">
                          Mã phiên chạy:{' '}
                        </span>
                        <span className="font-mono font-bold text-slate-800">
                          {detail.link.instance_code || 'Chờ khởi tạo'}
                        </span>
                      </div>
                      <a
                        href="/modules/procedure"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 shrink-0"
                      >
                        <span>Mở Procedure Engine</span>
                        <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Tiến độ: danh sách bước, người xử lý, SLA (dùng chung với chi tiết đơn nhân viên) */}
                {detail.link && (
                  <ProcedureProgressPanel
                    progress={detailProgress}
                    loading={detailProgressLoading}
                    hasInstance={Boolean(detailInstanceId)}
                    onRefresh={() => void refreshDetailProgress(false)}
                    syncStatus={detail.link.status}
                    lastError={detail.link.last_error}
                    fallbackStepName={procedureFieldsOf(detail).currentStepName}
                    fallbackAssigneeName={
                      procedureFieldsOf(detail).currentAssigneeName
                    }
                  />
                )}

                {/* Block 7: Thông tin định danh kỹ thuật */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-3 space-y-1 text-[11px] text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Mã định danh hệ thống (ID):</span>
                    <span className="font-mono text-slate-600">{detail.id}</span>
                  </div>
                  {detail.employeeId && (
                    <div className="flex items-center justify-between">
                      <span>Mã định danh nhân viên:</span>
                      <span className="font-mono text-slate-600">{detail.employeeId}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Sticky Footer */}
              <div className="shrink-0 p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setDetail(null)}
                >
                  Đóng
                </Button>

                {procedureActionable(detail) &&
                detailProgress?.canAct !== false &&
                !isTerminalProcedureStatus(detailProgress?.status) ? (
                  <div className="flex-1 ml-4 space-y-1.5">
                    {error && (
                      <p role="alert" className="text-xs font-semibold text-red-700">
                        {error}
                      </p>
                    )}
                    <ProcedureActionBar
                      busy={busy}
                      onAction={(action, comment) =>
                        procedureAction(detail, action, comment)
                      }
                    />
                  </div>
                ) : eligible(detail) ? (
                  <div className="flex items-center gap-2">
                    <Popconfirm
                      title="Từ chối yêu cầu?"
                      description="Vui lòng cung cấp lý do từ chối yêu cầu này."
                      okText="Từ chối"
                      cancelText="Hủy"
                      okType="danger"
                      reasonRequired
                      reasonPlaceholder="Nhập lý do từ chối..."
                      onConfirm={(reason) => reject(detail, reason || '')}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        className="text-xs h-8 text-rose-700 border-rose-200 hover:bg-rose-50 font-medium"
                      >
                        Từ chối
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="Phê duyệt đơn này?"
                      description="Hành động này sẽ áp dụng các thay đổi vào hồ sơ công/phép/lương tương ứng."
                      okText="Phê duyệt"
                      cancelText="Quay lại"
                      onConfirm={() => approve(detail)}
                    >
                      <Button
                        size="sm"
                        disabled={busy}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 font-semibold shadow-xs flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="size-3.5" />
                        <span>Phê duyệt đơn</span>
                      </Button>
                    </Popconfirm>
                  </div>
                ) : detail.status === 'APPROVED' &&
                  ['LEAVE', 'OT', 'BUSINESS_TRIP', 'ATTENDANCE', 'ADVANCE'].includes(
                    detail.source.kind,
                  ) &&
                  permissions.can(detail.source.permission) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => reverse(detail)}
                    className="text-xs h-8 text-amber-700 border-amber-200 hover:bg-amber-50 font-medium"
                  >
                    Hủy hiệu lực đơn
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </div>
  );
}
