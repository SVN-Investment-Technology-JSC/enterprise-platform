'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  CalendarDays,
  ChevronDown,
  Clock,
  ClipboardList,
  FileText,
  History,
  Plus,
  Search,
  Settings2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type {
  HrmLeaveType,
  HrmRequestReason,
  HrmRequestReasonKind,
  HrmRequestType,
  SaveRequestReasonRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { Button } from '../ui/button';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import {
  HrmActionDialog,
  type ActionField,
  type HrmAction,
} from '../ui/hrm-action-dialog';
import { Input } from '../ui/input';
import { LeaveReasonDialog } from '../ui/leave-reason-dialog';
import { PageTitle } from '../ui/page-title';
import { ActionMenu, DataList, type ActionItem, type DataColumn } from '../ui/payroll-settings/data-rows';
import { RequestTypeDialog, timeModeLabel } from '../ui/request-type-dialog';
import { EmptyPanel, IconTile, InfoNote, StatusPill, type KitTone } from '../ui/settings-kit';
import { toast } from '../ui/toast';

/**
 * Bốn loại đơn hệ thống có danh mục lý do cấu hình riêng (đơn nghỉ có danh mục lý do nghỉ, xem `LEAVE_CODE`).
 * Loại đơn do quản trị tạo cũng có danh mục lý do (mã loại là `kind`), được thêm vào danh sách khi tải danh mục loại đơn.
 */
export const REQUEST_REASON_KINDS: readonly {
  kind: HrmRequestReasonKind;
  label: string;
}[] = [
  { kind: 'OVERTIME', label: 'Làm thêm giờ' },
  { kind: 'BUSINESS_TRIP', label: 'Công tác' },
  { kind: 'ATTENDANCE_CORRECTION', label: 'Giải trình công' },
  { kind: 'SHIFT_CHANGE', label: 'Đổi ca' },
];

/** Mã loại đơn nghỉ: lý do của đơn này là loại nghỉ (có lương/không lương, trừ quỹ phép), quản lý qua `/leave-types`. */
const LEAVE_CODE = 'LEAVE';

const YES_NO = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];
const PAID_OPTIONS = [
  { value: 'true', label: 'Có lương' },
  { value: 'false', label: 'Không lương' },
];

const RATE_HINT =
  'Hệ số tính lương cho đơn tăng ca chọn lý do này (1 đến 10). Bỏ trống thì theo chính sách OT (ngày thường, ngày nghỉ, ngày lễ, ban đêm).';
const UNPAID_OT_HINT =
  'OT không lương được ghi nhận nhưng không tính tiền OT.';
const REQUIRES_DESCRIPTION_HINT =
  'Có: người làm đơn bắt buộc nhập Mô tả khi chọn lý do này (ví dụ lý do Khác).';

/** Các trường của form thêm/sửa lý do; `paid` chỉ có với làm thêm giờ, mã chỉ nhập khi thêm mới. */
export function reasonFormFields(
  kind: HrmRequestReasonKind,
  row?: HrmRequestReason,
): ActionField[] {
  return [
    {
      key: 'name',
      label: 'Tên lý do',
      value: row?.name ?? '',
      required: true,
    },
    ...(row
      ? []
      : [
          {
            key: 'code',
            label: 'Mã lý do (bỏ trống để tự sinh)',
            optional: true,
          },
        ]),
    {
      key: 'description',
      label: 'Diễn giải (hướng dẫn cho người chọn lý do, không phải Mô tả của đơn)',
      value: row?.description ?? '',
      colSpan: 2,
      optional: true,
    },
    ...(kind === 'OVERTIME'
      ? [
          {
            key: 'paid',
            label: 'Hưởng lương',
            options: PAID_OPTIONS,
            value: String(row?.paid ?? true),
            required: true,
          },
          {
            key: 'rateMultiplier',
            label: 'Hệ số tăng ca (bỏ trống = theo chính sách OT)',
            type: 'number' as const,
            min: 1,
            max: 10,
            step: '0.01',
            value: row?.rateMultiplier ?? '',
            optional: true,
          },
        ]
      : []),
    {
      key: 'requiresDescription',
      label: 'Bắt buộc nhập mô tả',
      options: YES_NO,
      value: String(row?.requiresDescription ?? false),
      required: true,
    },
    {
      key: 'active',
      label: 'Đang sử dụng',
      options: YES_NO,
      value: String(row?.active ?? true),
      required: true,
    },
    {
      key: 'sortOrder',
      label: 'Thứ tự hiển thị (bỏ trống để xếp cuối)',
      type: 'number',
      min: 0,
      value: row?.sortOrder ?? '',
      optional: true,
    },
  ];
}

/** Body của POST (có `kind`) và PATCH /request-reasons; PATCH không gửi `kind` và `code`. */
export function reasonPayload(
  kind: HrmRequestReasonKind,
  values: Record<string, string>,
  creating: boolean,
): SaveRequestReasonRequest {
  const code = values.code?.trim();
  const sortOrder = values.sortOrder?.trim();
  return {
    ...(creating ? { kind } : {}),
    ...(creating && code ? { code } : {}),
    name: values.name.trim(),
    description: values.description?.trim() || null,
    ...(kind === 'OVERTIME'
      ? {
          paid: values.paid === 'true',
          // Bỏ trống: lý do theo chính sách OT (gửi null để gỡ hệ số đã đặt trước đó).
          rateMultiplier: values.rateMultiplier?.trim() ? Number(values.rateMultiplier) : null,
        }
      : {}),
    requiresDescription: values.requiresDescription === 'true',
    active: values.active === 'true',
    ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
  };
}

type Notice = { tone: 'success' | 'warning'; text: string };

/** Một mục ở danh sách loại đơn bên trái. */
interface Entry {
  /** Mã loại đơn (LEAVE, OVERTIME, ... hoặc mã loại tuỳ chỉnh). */
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  type: HrmRequestType | null;
  /** Loại có danh mục lý do: nghỉ (loại nghỉ), 4 loại hệ thống và loại tuỳ chỉnh. */
  hasReasons: boolean;
  custom: boolean;
  icon: LucideIcon;
  tone: KitTone;
}

const ENTRY_STYLE: Record<string, { icon: LucideIcon; tone: KitTone }> = {
  [LEAVE_CODE]: { icon: CalendarDays, tone: 'blue' },
  OVERTIME: { icon: Clock, tone: 'violet' },
  BUSINESS_TRIP: { icon: Briefcase, tone: 'green' },
  SHIFT_CHANGE: { icon: ArrowLeftRight, tone: 'blue' },
  ATTENDANCE_CORRECTION: { icon: FileText, tone: 'amber' },
  ADVANCE: { icon: Banknote, tone: 'orange' },
  PROFILE_CORRECTION: { icon: ClipboardList, tone: 'blue' },
};
const DEFAULT_STYLE = { icon: FileText, tone: 'slate' as KitTone };
const SYSTEM_REASON_KINDS = new Set<string>(REQUEST_REASON_KINDS.map((k) => k.kind));

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'ACTIVE', label: 'Đang sử dụng' },
  { value: 'INACTIVE', label: 'Ngừng sử dụng' },
];

const errorText = (e: unknown, fallback = 'Thao tác thất bại') =>
  e instanceof Error ? e.message : fallback;

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

const matches = (keyword: string, ...parts: (string | null | undefined)[]) => {
  const needle = fold(keyword.trim());
  return !needle || fold(parts.filter(Boolean).join(' ')).includes(needle);
};

const pickStatus = (filter: string, active: boolean) =>
  filter === 'ALL' || (filter === 'ACTIVE' ? active : !active);

/**
 * Cấu hình LOẠI ĐƠN và danh mục LÝ DO của từng loại, dạng danh sách bên trái - chi tiết bên phải.
 *  - Loại đơn: 7 loại hệ thống (đổi tên, mô tả, bật/tắt) và các loại do quản trị tạo (đủ cấu hình: thời gian, chứng từ, trường bổ sung).
 *  - Lý do: danh mục do quản trị cấu hình, người làm đơn chỉ chọn; khác với Mô tả là văn bản tự do. Lý do của đơn xin nghỉ là
 *    loại nghỉ (có lương/không lương, trừ quỹ phép); chọn loại đơn bằng `?tab=<mã loại>`.
 */
export default function RequestReasonsScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canManage = can('hrm.leave.manage');
  const canAudit = can('hrm.audit.read');
  const [reasons, setReasons] = useState<HrmRequestReason[] | null>(null);
  /** null: chưa tải hoặc không tải được (khi đó chỉ có đơn nghỉ và 4 loại hệ thống có lý do). */
  const [types, setTypes] = useState<HrmRequestType[] | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<HrmLeaveType[] | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [typeSearch, setTypeSearch] = useState('');
  const [reasonSearch, setReasonSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<HrmAction | null>(null);
  const [typeDialog, setTypeDialog] = useState<{ row?: HrmRequestType } | null>(null);
  const [leaveDialog, setLeaveDialog] = useState<{ row?: HrmLeaveType } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmRequestReason[] }>('/request-reasons');
    setReasons(result.data);
  }, []);
  const loadTypes = useCallback(async () => {
    try {
      const result = await hrmFetch<{ data: HrmRequestType[] }>('/request-types/manage');
      setTypes(Array.isArray(result.data) ? result.data : null);
    } catch {
      setTypes(null);
    }
  }, []);
  const loadLeave = useCallback(async () => {
    const result = await hrmFetch<{ data: HrmLeaveType[] }>('/leave-types');
    setLeaveTypes(result.data);
  }, []);

  // Phụ thuộc giá trị boolean: hàm can() đổi danh tính mỗi lần render sẽ gây tải lặp vô hạn.
  useEffect(() => {
    if (!canManage) return;
    void load().catch((e) => setError(errorText(e, 'Không tải được danh mục lý do')));
    void loadLeave().catch((e) => setError(errorText(e, 'Không tải được danh sách lý do nghỉ')));
    void loadTypes();
  }, [canManage, load, loadLeave, loadTypes]);

  // Loại đơn đang chọn đồng bộ `?tab=<mã loại>` (đọc khi mở, ghi khi chọn, nghe popstate).
  useEffect(() => {
    const sync = () => setSelectedCode(new URLSearchParams(window.location.search).get('tab'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const byKind = useMemo(() => {
    const groups = new Map<string, HrmRequestReason[]>();
    for (const item of reasons ?? []) {
      const list = groups.get(item.kind) ?? [];
      list.push(item);
      groups.set(item.kind, list);
    }
    return groups;
  }, [reasons]);

  /** Danh sách loại đơn: theo danh mục loại đơn nếu đã tải được, nếu không thì đơn nghỉ và 4 loại hệ thống. */
  const entries = useMemo<Entry[]>(() => {
    const build = (
      code: string,
      name: string,
      description: string | null,
      active: boolean,
      type: HrmRequestType | null,
      hasReasons: boolean,
      custom: boolean,
    ): Entry => ({
      code,
      name,
      description,
      active,
      type,
      hasReasons,
      custom,
      ...(ENTRY_STYLE[code] ?? DEFAULT_STYLE),
    });
    if (!types)
      return [
        build(LEAVE_CODE, 'Đơn xin nghỉ', null, true, null, true, false),
        ...REQUEST_REASON_KINDS.map((k) => build(k.kind, k.label, null, true, null, true, false)),
      ];
    return types.map((t) =>
      build(
        t.code,
        t.name,
        t.description,
        t.active,
        t,
        t.code === LEAVE_CODE || SYSTEM_REASON_KINDS.has(t.code) || t.engine === 'GENERIC',
        t.engine === 'GENERIC',
      ),
    );
  }, [types]);

  const current = entries.find((e) => e.code === selectedCode) ?? entries[0];
  const isLeave = current?.code === LEAVE_CODE;

  function selectEntry(code: string) {
    setSelectedCode(code);
    setReasonSearch('');
    setStatusFilter('ALL');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', code);
    window.history.replaceState(null, '', url);
  }

  const countOf = (entry: Entry): number | null => {
    if (!entry.hasReasons) return null;
    if (entry.code === LEAVE_CODE) return leaveTypes ? leaveTypes.length : null;
    return reasons ? (byKind.get(entry.code)?.length ?? 0) : null;
  };

  /** Chạy một thao tác ghi: lỗi hiện ở hộp cảnh báo đầu trang, không ném tiếp (Popconfirm chờ promise này). */
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    if (!current) return;
    const label = current.name;
    const kind = current.code as HrmRequestReasonKind;
    setAction({
      title: `Thêm lý do cho đơn ${label}`,
      description:
        'Lý do là mục trong danh mục; người làm đơn chọn một lý do rồi có thể nhập thêm Mô tả (văn bản tự do).',
      columns: 2,
      fields: reasonFormFields(kind),
      submit: async (values) => {
        await hrmFetch('/request-reasons', {
          method: 'POST',
          body: JSON.stringify(reasonPayload(kind, values, true)),
        });
        await load();
        toast.success('Đã thêm lý do');
      },
    });
  }

  function openEdit(row: HrmRequestReason) {
    setAction({
      title: `Sửa lý do "${row.name}"`,
      description: `Mã ${row.code} và loại đơn không đổi được. Đơn đã gửi giữ nguyên lý do cũ; thay đổi chỉ áp dụng cho đơn mới.`,
      columns: 2,
      fields: reasonFormFields(row.kind, row),
      submit: async (values) => {
        await hrmFetch(`/request-reasons/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify(reasonPayload(row.kind, values, false)),
        });
        await load();
        toast.success('Đã lưu lý do');
      },
    });
  }

  function setActive(row: HrmRequestReason, active: boolean) {
    return run(async () => {
      await hrmFetch(`/request-reasons/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      });
      await load();
      toast.success(active ? 'Đã dùng lại lý do' : 'Đã ngừng sử dụng lý do');
    });
  }

  function remove(row: HrmRequestReason) {
    return run(async () => {
      const result = await hrmFetch<{
        data: { id: string; deleted: boolean; active: boolean; usageCount: number };
        message?: string;
      }>(`/request-reasons/${row.id}`, { method: 'DELETE' });
      // Lý do đã có đơn dùng thì server chỉ ngừng sử dụng: hiển thị đúng thông báo của server.
      setNotice({
        tone: result.data.deleted ? 'success' : 'warning',
        text:
          result.message ??
          (result.data.deleted
            ? `Đã xóa lý do "${row.name}".`
            : `Lý do "${row.name}" đã có đơn dùng nên chỉ được ngừng sử dụng.`),
      });
      await load();
    });
  }

  function createDefaults() {
    return run(async () => {
      const result = await hrmFetch<{ data: { created: number } }>(
        '/request-reasons/defaults',
        { method: 'POST', body: JSON.stringify({}) },
      );
      await load();
      toast.success(
        result.data.created > 0
          ? `Đã tạo ${result.data.created} lý do mặc định`
          : 'Không có lý do nào cần tạo: các loại đơn đều đã có lý do',
      );
    });
  }

  function setLeaveActive(row: HrmLeaveType, active: boolean, note?: string) {
    return run(async () => {
      await hrmFetch(`/leave-types/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          active,
          expectedUpdatedAt: row.updatedAt,
          reason:
            note ||
            (active ? 'Dùng lại lý do nghỉ' : 'Ngừng sử dụng lý do nghỉ'),
        }),
      });
      setNotice({
        tone: 'success',
        text: active
          ? `Đã cho dùng lại lý do nghỉ "${row.name}".`
          : `Đã ngừng lý do nghỉ "${row.name}" cho các đơn mới.`,
      });
      await loadLeave();
    });
  }

  function setTypeActive(row: HrmRequestType, active: boolean) {
    return run(async () => {
      await hrmFetch(`/request-types/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active, expectedUpdatedAt: row.updatedAt }),
      });
      await loadTypes();
      toast.success(active ? 'Đã dùng lại loại đơn' : 'Đã ngừng sử dụng loại đơn');
    });
  }

  function removeType(row: HrmRequestType) {
    return run(async () => {
      const result = await hrmFetch<{
        data: { id: string; deleted: boolean; usageCount: number };
        message?: string;
      }>(`/request-types/${row.id}`, { method: 'DELETE' });
      setNotice({
        tone: result.data.deleted ? 'success' : 'warning',
        text:
          result.message ??
          (result.data.deleted
            ? `Đã xóa loại đơn "${row.name}".`
            : `Loại đơn "${row.name}" đã có đơn nên chỉ được ngừng sử dụng.`),
      });
      if (selectedCode === row.code && result.data.deleted) selectEntry(LEAVE_CODE);
      await Promise.all([loadTypes(), load()]);
    });
  }

  // ---------------------------------------------------------------- Dòng của bảng lý do
  const kind = current?.code as HrmRequestReasonKind;
  const reasonRows = useMemo(
    () =>
      (byKind.get(current?.code ?? '') ?? []).filter(
        (r) => pickStatus(statusFilter, r.active) && matches(reasonSearch, r.name, r.code, r.description),
      ),
    [byKind, current?.code, statusFilter, reasonSearch],
  );
  const leaveRows = useMemo(
    () =>
      [...(leaveTypes ?? [])]
        .sort(
          (a, b) =>
            Number(Boolean(b.isAnnual)) - Number(Boolean(a.isAnnual)) || Number(b.active) - Number(a.active),
        )
        .filter((r) => pickStatus(statusFilter, r.active) && matches(reasonSearch, r.name, r.code)),
    [leaveTypes, statusFilter, reasonSearch],
  );

  if (!permissionsLoading && !canManage) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[1600px] rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
      >
        Bạn không có quyền cấu hình lý do đơn từ.
      </div>
    );
  }

  const reasonColumns: DataColumn<HrmRequestReason>[] = [
    {
      key: 'name',
      header: 'Tên lý do',
      width: 'minmax(0,1.4fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-slate-900">{r.name}</span>
          {r.description ? <span className="block text-[11px] text-slate-500">{r.description}</span> : null}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Mã',
      width: 'minmax(0,1fr)',
      cardLabel: true,
      cell: (r) => <span className="font-mono text-[11px] text-slate-600">{r.code}</span>,
    },
    ...(kind === 'OVERTIME'
      ? [
          {
            key: 'paid',
            header: 'Hưởng lương',
            width: '6.5rem',
            cardLabel: true,
            cell: (r: HrmRequestReason) => (
              <span title={r.paid ? undefined : UNPAID_OT_HINT}>
                <StatusPill tone={r.paid ? 'green' : 'amber'}>{r.paid ? 'Có lương' : 'Không lương'}</StatusPill>
              </span>
            ),
          },
          {
            key: 'rate',
            header: 'Hệ số',
            width: '6.5rem',
            cardLabel: true,
            cell: (r: HrmRequestReason) =>
              r.rateMultiplier != null ? (
                <span className="font-mono font-semibold text-slate-900" title={RATE_HINT}>
                  x{String(r.rateMultiplier).replace('.', ',')}
                </span>
              ) : (
                <span className="text-slate-500" title={RATE_HINT}>
                  Theo chính sách OT
                </span>
              ),
          } satisfies DataColumn<HrmRequestReason>,
        ]
      : []),
    {
      key: 'requiresDescription',
      header: 'Cần mô tả',
      width: '5rem',
      cardLabel: true,
      cell: (r) => <span title={REQUIRES_DESCRIPTION_HINT}>{r.requiresDescription ? 'Có' : 'Không'}</span>,
    },
    {
      key: 'usage',
      header: 'Số đơn đã dùng',
      width: '6rem',
      align: 'right',
      cardLabel: true,
      cell: (r) => <span className="tabular-nums">{r.usageCount ?? 0}</span>,
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '7.5rem',
      cell: (r) => (
        <StatusPill tone={r.active ? 'green' : 'slate'}>{r.active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</StatusPill>
      ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '2.5rem',
      align: 'right',
      cardEnd: true,
      cardOrder: -1,
      cell: (r) => <ActionMenu label={`Thao tác với lý do ${r.name}`} items={reasonActions(r)} />,
    },
  ];

  const leaveColumns: DataColumn<HrmLeaveType>[] = [
    {
      key: 'name',
      header: 'Tên lý do',
      width: 'minmax(0,1.4fr)',
      cardGrow: true,
      cardOrder: -1,
      cell: (r) => (
        <span className={`font-semibold ${r.active ? 'text-slate-900' : 'text-slate-500'}`}>{r.name}</span>
      ),
    },
    {
      key: 'code',
      header: 'Mã',
      width: 'minmax(0,1fr)',
      cardLabel: true,
      cell: (r) => <span className="font-mono text-[11px] text-slate-600">{r.code}</span>,
    },
    {
      key: 'paid',
      header: 'Hưởng lương',
      width: '6.5rem',
      cardLabel: true,
      cell: (r) => <StatusPill tone={r.paid ? 'green' : 'slate'}>{r.paid ? 'Có lương' : 'Không lương'}</StatusPill>,
    },
    {
      key: 'deduct',
      header: 'Trừ quỹ phép',
      width: '7rem',
      cardLabel: true,
      cell: (r) =>
        r.isAnnual ? (
          <span className="flex items-center gap-1.5">
            Có <StatusPill tone="blue">Phép năm</StatusPill>
          </span>
        ) : (
          <span className="text-slate-500">Không</span>
        ),
    },
    {
      key: 'attachment',
      header: 'Cần chứng từ',
      width: '6rem',
      cardLabel: true,
      cell: (r) => (r.requiresAttachment ? 'Có' : 'Không'),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '7.5rem',
      cell: (r) =>
        r.mergedIntoId ? (
          <StatusPill tone="slate">Đã gộp</StatusPill>
        ) : r.active ? (
          <StatusPill tone="green">Đang dùng</StatusPill>
        ) : (
          <StatusPill tone="slate">Đã ngừng</StatusPill>
        ),
    },
    {
      key: 'actions',
      header: 'Thao tác',
      width: '2.5rem',
      align: 'right',
      cardEnd: true,
      cardOrder: -1,
      cell: (r) => <ActionMenu label={`Thao tác với lý do nghỉ ${r.name}`} items={leaveActions(r)} />,
    },
  ];

  function reasonActions(r: HrmRequestReason): ActionItem[] {
    return [
      { key: 'edit', label: 'Sửa', onSelect: () => openEdit(r) },
      r.active
        ? {
            key: 'deactivate',
            label: 'Ngừng sử dụng',
            confirm: {
              title: `Ngừng sử dụng lý do "${r.name}"?`,
              description:
                'Lý do ẩn khỏi danh sách chọn của đơn mới; có thể dùng lại bất cứ lúc nào. Đơn đã gửi không bị ảnh hưởng.',
              okText: 'Ngừng sử dụng',
              cancelText: 'Quay lại',
              okType: 'warning',
              onConfirm: () => setActive(r, false),
            },
          }
        : { key: 'activate', label: 'Dùng lại', onSelect: () => void setActive(r, true) },
      {
        key: 'delete',
        label: 'Xóa',
        tone: 'danger',
        confirm: {
          title: `Xóa lý do "${r.name}"?`,
          description:
            (r.usageCount ?? 0) > 0
              ? `Lý do đã được dùng trong ${r.usageCount} đơn nên không xóa được; hệ thống chỉ ngừng sử dụng lý do này.`
              : 'Lý do biến mất khỏi danh mục. Đơn đã gửi không bị ảnh hưởng.',
          okText: 'Xóa lý do',
          cancelText: 'Quay lại',
          okType: 'danger',
          onConfirm: () => remove(r),
        },
      },
    ];
  }

  function leaveActions(r: HrmLeaveType): ActionItem[] {
    const lockedActive = r.isAnnual || r.mergedIntoId;
    return [
      { key: 'edit', label: 'Sửa', onSelect: () => setLeaveDialog({ row: r }) },
      {
        key: 'deactivate',
        label: 'Ngừng',
        hidden: Boolean(lockedActive) || !r.active,
        confirm: {
          title: 'Ngừng lý do nghỉ này cho các đơn mới?',
          description: 'Đơn đã tạo và sổ phép hiện có được giữ nguyên.',
          okText: 'Xác nhận',
          cancelText: 'Quay lại',
          okType: 'danger',
          reason: { label: 'Ghi chú thay đổi', placeholder: 'Ví dụ: không còn áp dụng', required: true },
          onConfirm: (note) => setLeaveActive(r, false, note),
        },
      },
      {
        key: 'activate',
        label: 'Dùng lại',
        hidden: Boolean(lockedActive) || r.active,
        confirm: {
          title: 'Cho dùng lại lý do nghỉ này?',
          okText: 'Xác nhận',
          cancelText: 'Quay lại',
          okType: 'primary',
          reason: { label: 'Ghi chú thay đổi', placeholder: 'Ví dụ: áp dụng lại từ tháng này', required: true },
          onConfirm: (note) => setLeaveActive(r, true, note),
        },
      },
    ];
  }

  function typeActions(t: HrmRequestType): ActionItem[] {
    return [
      { key: 'edit', label: 'Sửa loại đơn', onSelect: () => setTypeDialog({ row: t }) },
      {
        key: 'deactivate',
        label: 'Ngừng sử dụng loại đơn',
        hidden: t.code === LEAVE_CODE || !t.active,
        confirm: {
          title: `Ngừng sử dụng loại đơn "${t.name}"?`,
          description:
            'Loại đơn ẩn khỏi danh sách chọn của đơn mới; có thể dùng lại bất cứ lúc nào. Đơn đã gửi không bị ảnh hưởng.',
          okText: 'Ngừng sử dụng',
          cancelText: 'Quay lại',
          okType: 'warning',
          onConfirm: () => setTypeActive(t, false),
        },
      },
      {
        key: 'activate',
        label: 'Dùng lại loại đơn',
        hidden: t.code === LEAVE_CODE || t.active,
        onSelect: () => void setTypeActive(t, true),
      },
      {
        key: 'delete',
        label: 'Xóa loại đơn',
        tone: 'danger',
        hidden: t.isSystem,
        confirm: {
          title: `Xóa loại đơn "${t.name}"?`,
          description:
            (t.usageCount ?? 0) > 0
              ? `Loại đơn đã có ${t.usageCount} đơn nên không xóa được; hệ thống chỉ ngừng sử dụng loại này.`
              : 'Loại đơn và danh mục lý do của loại này biến mất. Không thể hoàn tác.',
          okText: 'Xóa loại đơn',
          cancelText: 'Quay lại',
          okType: 'danger',
          onConfirm: () => removeType(t),
        },
      },
    ];
  }

  const visibleEntries = entries.filter((e) => matches(typeSearch, e.name, e.description, e.code));
  const entryOptions = entries.map((e) => {
    const count = countOf(e);
    return { value: e.code, label: count == null ? e.name : `${e.name} (${count})` };
  });

  const addReason = () => {
    if (!current?.hasReasons) return;
    if (isLeave) setLeaveDialog({});
    else openCreate();
  };

  const loadingList = isLeave ? leaveTypes === null : reasons === null;
  const totalInEntry = isLeave ? (leaveTypes?.length ?? 0) : (byKind.get(current?.code ?? '')?.length ?? 0);
  const filteredCount = isLeave ? leaveRows.length : reasonRows.length;

  return (
    <div className="@container mx-auto max-w-[1600px] space-y-4">
      <PageTitle
        title="Loại đơn & lý do"
        description="Quản lý loại đơn và danh mục lý do được nhân viên lựa chọn khi tạo đơn."
        actions={
          <>
            {canAudit ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setHistoryOpen(true)}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
              >
                <History className="size-4" aria-hidden />
                Lịch sử thay đổi
              </Button>
            ) : null}
            {current?.hasReasons ? (
              <Button
                permission="hrm.leave.manage"
                disabled={busy}
                onClick={addReason}
                className="h-9 gap-1.5 px-4 text-xs font-semibold"
              >
                <Plus className="size-4" aria-hidden />
                <span>Thêm lý do</span>
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      ) : null}
      {notice ? (
        <InfoNote tone={notice.tone === 'success' ? 'green' : 'amber'} role="status">
          {notice.text}
        </InfoNote>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        {/* Danh sách loại đơn (màn rộng); màn hẹp dùng ô chọn loại đơn ở đầu thẻ chi tiết */}
        <section
          aria-label="Danh mục loại đơn"
          className="hidden min-w-0 rounded-xl border border-slate-200 bg-white p-4 @3xl:block"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-slate-900">Loại đơn</h2>
              <p className="mt-0.5 text-xs text-slate-500">Chọn loại đơn để quản lý danh sách lý do.</p>
            </div>
            {types !== null ? (
              <Button
                permission="hrm.leave.manage"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setTypeDialog({})}
                className="shrink-0 gap-1 text-xs font-semibold"
              >
                <Plus className="size-3.5" aria-hidden />
                Thêm loại
              </Button>
            ) : null}
          </div>
          <div className="relative mt-3">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Tìm loại đơn"
              placeholder="Tìm loại đơn..."
              value={typeSearch}
              onChange={(e) => setTypeSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <ul className="mt-3 space-y-1.5" aria-label="Loại đơn">
            {visibleEntries.map((entry) => {
              const selected = entry.code === current?.code;
              const count = countOf(entry);
              return (
                <li key={entry.code}>
                  <button
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    data-testid={`type-${entry.code}`}
                    onClick={() => selectEntry(entry.code)}
                    className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      selected ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-slate-50'
                    } ${entry.active ? '' : 'opacity-60'}`}
                  >
                    <IconTile icon={entry.icon} tone={entry.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {entry.name}
                        {entry.active ? null : <span className="ml-1.5 text-[11px] font-medium text-slate-500">(ngừng)</span>}
                      </span>
                      {entry.description ? (
                        <span className="block truncate text-[11px] text-slate-500">{entry.description}</span>
                      ) : null}
                    </span>
                    {count != null ? (
                      <span
                        aria-label={`${count} lý do`}
                        className={`inline-flex min-w-6 items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${
                          selected ? 'border-blue-300 bg-white text-blue-700' : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {visibleEntries.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-slate-500">Không có loại đơn nào khớp.</li>
            ) : null}
          </ul>
        </section>

        {/* Chi tiết loại đơn đang chọn */}
        {current ? (
          <section
            aria-label={`Lý do của ${current.name}`}
            data-testid="type-detail"
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 @xl:p-5"
          >
            <div className="mb-3 @3xl:hidden">
              <SearchableSelect
                height={36}
                value={current.code}
                options={entryOptions}
                clearable={false}
                placeholder="Chọn loại đơn"
                onChange={(code) => code && selectEntry(code)}
              />
            </div>

            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
              <div className="min-w-0 flex-1 basis-56">
                <h2 className="text-base font-bold tracking-tight text-slate-900">
                  {current.hasReasons ? `Lý do của ${current.name.toLowerCase()}` : current.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {current.hasReasons
                    ? `Các lý do nhân viên được chọn khi tạo ${current.name.toLowerCase()}.`
                    : (current.description ?? 'Loại đơn này không dùng danh mục lý do.')}
                </p>
              </div>
              {current.hasReasons ? (
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @2xl:w-auto">
                  <div className="relative min-w-0 flex-1 basis-40 @2xl:w-48 @2xl:flex-none">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      aria-label="Tìm lý do"
                      placeholder="Tìm lý do..."
                      value={reasonSearch}
                      onChange={(e) => setReasonSearch(e.target.value)}
                      className="h-9 pl-9"
                    />
                  </div>
                  <div className="min-w-0 flex-1 basis-40 @2xl:w-52 @2xl:flex-none">
                    <SearchableSelect
                      height={36}
                      value={statusFilter}
                      options={STATUS_FILTERS}
                      clearable={false}
                      onChange={(v) => setStatusFilter(v || 'ALL')}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {current.type ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <StatusPill tone={current.type.isSystem ? 'slate' : 'blue'}>
                  {current.type.isSystem ? 'Hệ thống' : 'Tuỳ chỉnh'}
                </StatusPill>
                <StatusPill tone={current.active ? 'green' : 'slate'}>
                  {current.active ? 'Đang sử dụng' : 'Ngừng sử dụng'}
                </StatusPill>
                <span>Thời gian: {timeModeLabel(current.type.timeMode)}</span>
                {current.type.isSystem ? null : <span>{current.type.fields.length} trường bổ sung</span>}
                {current.type.isSystem ? null : <span>{current.type.usageCount ?? 0} đơn đã tạo</span>}
                <span className="ml-auto">
                  <ActionMenu
                    label="Thiết lập loại đơn"
                    items={typeActions(current.type)}
                    buttonClassName="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    trigger={
                      <>
                        <Settings2 className="size-3.5" aria-hidden />
                        Thiết lập loại đơn
                        <ChevronDown className="size-3 text-slate-400" aria-hidden />
                      </>
                    }
                  />
                </span>
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {!current.hasReasons ? (
                <InfoNote tone="slate">
                  Loại đơn này không có danh mục lý do: người làm đơn không phải chọn lý do. Có thể đổi tên, mô tả hoặc ngừng sử dụng
                  ở mục Thiết lập loại đơn.
                </InfoNote>
              ) : loadingList ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  {error ? 'Không tải được danh mục lý do.' : 'Đang tải danh mục lý do...'}
                </p>
              ) : totalInEntry === 0 ? (
                isLeave ? (
                  <EmptyPanel
                    icon={CalendarDays}
                    title="Chưa có lý do nghỉ nào"
                    description="Bấm Thêm lý do để tạo."
                  />
                ) : (
                  <EmptyPanel
                    icon={ClipboardList}
                    title={`Đơn ${current.name.toLowerCase()} chưa có lý do nào`}
                    description={
                      current.custom
                        ? 'Loại đơn tuỳ chỉnh không bắt buộc có lý do: khi chưa có lý do nào, người làm đơn không phải chọn lý do. Thêm lý do nếu muốn người làm đơn chọn từ danh sách.'
                        : 'Người làm đơn phải chọn một lý do trong danh mục nên cần có ít nhất một lý do. Tạo bộ lý do mặc định cho các loại đơn đang trống, hoặc thêm lý do riêng.'
                    }
                    action={
                      current.custom ? undefined : (
                        <Button
                          permission="hrm.leave.manage"
                          disabled={busy}
                          onClick={() => void createDefaults()}
                          className="gap-1.5 text-xs font-semibold"
                        >
                          <WandSparkles className="size-3.5" aria-hidden />
                          <span>Tạo lý do mặc định</span>
                        </Button>
                      )
                    }
                  />
                )
              ) : filteredCount === 0 ? (
                <EmptyPanel icon={Search} title="Không có lý do nào khớp" description="Thử đổi từ khóa hoặc bộ lọc trạng thái." />
              ) : isLeave ? (
                <DataList
                  label="Lý do nghỉ"
                  rows={leaveRows}
                  columns={leaveColumns}
                  rowKey={(r) => r.id}
                  pageSize={12}
                />
              ) : (
                <DataList
                  label={`Lý do của ${current.name}`}
                  rows={reasonRows}
                  columns={reasonColumns}
                  rowKey={(r) => r.id}
                  pageSize={12}
                />
              )}

              {current.hasReasons ? (
                isLeave ? (
                  <InfoNote tone="blue">
                    Chỉ lý do Phép năm trừ quỹ phép; các lý do khác không làm thay đổi số dư phép. Cách tính phép năm cấu hình ở{' '}
                    <Link
                      href="/settings?view=leave"
                      className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                    >
                      Chính sách phép năm
                    </Link>
                    .
                  </InfoNote>
                ) : (
                  <InfoNote tone="blue">
                    Lý do là danh mục do quản trị cấu hình; người làm đơn chọn một lý do rồi có thể nhập thêm Mô tả. Mô tả là văn bản tự do,
                    không phải lý do. Lý do đặt Cần mô tả là Có thì người làm đơn bắt buộc nhập Mô tả khi chọn lý do đó.
                    {kind === 'OVERTIME' ? ` ${UNPAID_OT_HINT}` : ''}
                  </InfoNote>
                )
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {action && <HrmActionDialog action={action} onClose={() => setAction(null)} />}
      {typeDialog && (
        <RequestTypeDialog
          row={typeDialog.row}
          onClose={() => setTypeDialog(null)}
          onSaved={async (text) => {
            setNotice({ tone: 'success', text });
            await Promise.all([loadTypes(), load()]);
          }}
        />
      )}
      {leaveDialog && (
        <LeaveReasonDialog
          row={leaveDialog.row}
          onClose={() => setLeaveDialog(null)}
          onSaved={async (text) => {
            setNotice({ tone: 'success', text });
            await loadLeave();
          }}
        />
      )}
      {canAudit ? (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Lịch sử thay đổi loại đơn và lý do"
          description="Loại đơn, lý do đơn từ và lý do nghỉ (tối đa 100 bản ghi, mới nhất ở trên)."
          actionPrefixes={['REQUEST_REASON_', 'REQUEST_TYPE_', 'LEAVE_TYPE_']}
        />
      ) : null}
    </div>
  );
}
