'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer, Popconfirm, Table, Tag } from 'antd';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmAction as Permission } from '@enterprise-platform/contracts-identity';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { HrmActionDialog, type HrmAction } from '../ui/hrm-action-dialog';

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
    [detail, setDetail] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<React.Key[]>([]),
    [action, setAction] = useState<HrmAction | null>(null);
  const [linkedId, setLinkedId] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('request');
    if (id) {
      setSearch(id);
      setStatus('');
    }
  }, []);
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
      hrmEmployeeOptions(),
      hrmFetch<{ data: Link[] }>('/request-workflows'),
      ...available.map((s) => hrmFetch<{ data: Raw[] }>(`/${s.path}`)),
    ]);
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
  }, [permissionKey]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const eligible = (r: Row) =>
    permissions.can(r.source.permission) &&
    ['PENDING', 'PEER_CONFIRMED'].includes(r.status) &&
    !r.link;
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
      setError(e instanceof Error ? e.message : 'Không duyệt được đơn');
    } finally {
      setBusy(false);
    }
  }
  function reject(r: Row) {
    setAction({
      title: `Từ chối ${r.source.label.toLowerCase()}`,
      fields: [{ key: 'reason', label: 'Lý do từ chối' }],
      submit: async (v) => {
        await transition(r, 'reject', v);
        setDetail(null);
        await load();
      },
    });
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
        `Đã duyệt ${done} đơn; dừng tại lỗi: ${e instanceof Error ? e.message : 'Không xác định'}`,
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
  return (
    <main className="space-y-3">
      <header className="flex justify-between">
        <div>
          <h1 className="text-lg font-semibold">Hộp xử lý đơn từ</h1>
          <p className="text-xs text-slate-500">
            Kiểm tra nội dung, chứng từ và quy trình trước khi áp dụng vào công,
            phép, lương.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Làm mới
        </Button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          aria-label="Tìm đơn"
          placeholder="Tìm nhân viên, mã đơn, lý do…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SearchableSelect
          value={kind}
          onChange={(v) => setKind(v || '')}
          clearable
          placeholder="Tất cả loại đơn"
          options={sources.map((s) => ({ value: s.kind, label: s.label }))}
        />
        <SearchableSelect
          value={status}
          onChange={(v) => setStatus(v || '')}
          clearable
          placeholder="Tất cả trạng thái"
          options={Object.entries(states)
            .filter(([v]) => v !== 'PEER_CONFIRMED')
            .map(([value, label]) => ({ value, label }))}
        />
        <Popconfirm
          title={`Duyệt ${selected.length} đơn đã chọn?`}
          description="Các đơn liên kết Procedure được xử lý tại quy trình tương ứng."
          onConfirm={batch}
        >
          <Button disabled={busy || !selected.length}>Duyệt đã chọn</Button>
        </Popconfirm>
        <a className="text-xs text-blue-700" href="/modules/hrm/leave-settings">
          Quỹ phép và sổ phép
        </a>
      </div>
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
          showTotal: (t) => `${t} đơn`,
        }}
        scroll={{ x: 1450, y: 'calc(100dvh - 295px)' }}
        columns={[
          {
            title: 'Nhân viên',
            dataIndex: 'employeeName',
            fixed: 'left',
            width: 225,
            sorter: (a, b) => a.employeeName.localeCompare(b.employeeName),
          },
          { title: 'Loại đơn', width: 145, render: (_, r) => r.source.label },
          { title: 'Thời gian', dataIndex: 'period', width: 190 },
          {
            title: 'Khối lượng',
            width: 100,
            render: (_, r) =>
              r.requestedAmount !== undefined
                ? Number(r.requestedAmount).toLocaleString('vi-VN') + ' đ'
                : r.plannedMinutes !== undefined
                  ? `${r.plannedMinutes} phút`
                  : r.duration !== undefined
                    ? String(r.duration)
                    : '—',
          },
          { title: 'Lý do', dataIndex: 'reason', ellipsis: true },
          {
            title: 'Trạng thái',
            width: 145,
            render: (_, r) => <Tag>{states[r.status] || r.status}</Tag>,
          },
          {
            title: 'Quy trình',
            width: 160,
            render: (_, r) =>
              r.link ? (
                <a className="text-blue-700" href="/modules/procedure">
                  {r.link.instance_code || 'Chờ khởi tạo'} · {r.link.status}
                </a>
              ) : (
                'Duyệt trực tiếp'
              ),
          },
          {
            title: 'Thao tác',
            fixed: 'right',
            width: 205,
            render: (_, r) => (
              <div className="flex gap-1">
                <Button variant="outline" onClick={() => setDetail(r)}>
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
                      disabled={busy}
                      onClick={() => reverse(r)}
                    >
                      Hủy hiệu lực
                    </Button>
                  )}
                {eligible(r) && (
                  <>
                    <Popconfirm
                      title="Phê duyệt đơn này?"
                      onConfirm={() => approve(r)}
                    >
                      <Button disabled={busy}>Duyệt</Button>
                    </Popconfirm>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => reject(r)}
                    >
                      Từ chối
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      <Drawer
        size={660}
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.source.label} · ${detail.employeeName}` : ''}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[140px_1fr] gap-2">
              <dt>Mã đơn</dt>
              <dd className="break-all">{detail.id}</dd>
              <dt>Trạng thái</dt>
              <dd>{states[detail.status] || detail.status}</dd>
              <dt>Ngày gửi</dt>
              <dd>
                {detail.created
                  ? new Date(detail.created).toLocaleString('vi-VN')
                  : '—'}
              </dd>
              <dt>Thời gian</dt>
              <dd>{detail.period || '—'}</dd>
              <dt>Lý do</dt>
              <dd>{detail.reason || '—'}</dd>
            </dl>
            <dl className="grid grid-cols-[170px_1fr] gap-2">
              {Object.entries(detailFields)
                .filter(
                  ([key]) => detail[key] !== undefined && detail[key] !== null,
                )
                .map(([key, label]) => (
                  <div key={key} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="whitespace-pre-wrap break-all">
                      {typeof detail[key] === 'boolean'
                        ? detail[key]
                          ? 'Có'
                          : 'Không'
                        : typeof detail[key] === 'object'
                          ? JSON.stringify(detail[key], null, 2)
                          : String(detail[key])}
                    </dd>
                  </div>
                ))}
            </dl>
            {detail.link && (
              <div className="rounded border p-3">
                Quy trình: {detail.link.instance_code || 'Đang khởi tạo'} ·{' '}
                {detail.link.status}
                <p>{detail.link.last_error}</p>
                <a href="/modules/procedure" className="text-blue-700">
                  Mở Procedure Engine
                </a>
              </div>
            )}
            {detail.changes && (
              <dl className="grid grid-cols-2 gap-2">
                {Object.entries(detail.changes).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd>{String(v ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.attachmentFileId && (
              <Button
                variant="outline"
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
                Xem chứng từ
              </Button>
            )}
            {eligible(detail) && (
              <div className="flex gap-2 border-t pt-3">
                <Popconfirm
                  title="Phê duyệt và áp dụng đơn?"
                  onConfirm={() => approve(detail)}
                >
                  <Button disabled={busy}>Phê duyệt</Button>
                </Popconfirm>
                <Button variant="outline" onClick={() => reject(detail)}>
                  Từ chối
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
      {action && (
        <HrmActionDialog action={action} onClose={() => setAction(null)} />
      )}
    </main>
  );
}
